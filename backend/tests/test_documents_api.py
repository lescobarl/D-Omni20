"""Tests de los endpoints de la base de conocimiento (Fase 1 — RAG).

Cubre la ingesta ``/api/v1/content/documents``:

- Ingesta por tipo de archivo: TXT, CSV y PDF (este último con ``_extract_pdf``
  monkeypatcheado para no depender de un PDF real) y por URL (``_fetch_url``
  monkeypatcheado para no hacer red).
- Validaciones de entrada: formato no soportado, archivo vacío y archivo que
  supera el límite de bytes (``_MAX_FILE_BYTES`` monkeypatcheado).
- Aislamiento multi-tenant: cabecera ausente (403) y tenant aislado que nunca
  ve, lista ni busca datos de ``dev-tenant``.
- Regresión de ruteo: ``GET /documents`` NO queda ensombrecido por el
  ``GET /content/{item_id}`` preexistente.
- Códigos de error estructurados (404/422/403) y su ``operation``.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}

# Cabeceras de autenticación por defecto (RBAC). El super-admin omite la
# comprobación de membresía, por lo que vale tanto para el tenant de desarrollo
# como para tenants UUID frescos.
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    """Añade el Bearer del super-admin a las cabeceras por defecto (RBAC)."""
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"


def _other_tenant() -> dict[str, str]:
    """Cabeceras de un tenant aislado (UUID aleatorio válido, no sembrado)."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _ingest_file(
    client: TestClient,
    *,
    content: bytes = b"Contenido de ejemplo para la base de conocimiento del bot.",
    filename: str = "manual.txt",
    content_type: str = "text/plain",
    headers: dict[str, str] = TENANT_HEADERS,
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = {"filename": filename, "content": content, "content_type": content_type}
    response = client.post(
        "/api/v1/content/documents/ingest-file",
        files={"file": (filename, content, content_type)},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return payload, response.json()


def _ingest_url(
    client: TestClient,
    *,
    url: str = "https://example.com/articulo-prueba",
    title: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {"url": url}
    if title is not None:
        payload["title"] = title
    response = client.post(
        "/api/v1/content/documents/ingest-url", json=payload, headers=TENANT_HEADERS
    )
    assert response.status_code == 201, response.text
    return payload, response.json()


# ---------------------------------------------------------------------------
# Ingesta por archivo
# ---------------------------------------------------------------------------


def test_ingest_file_txt_returns_201(client: TestClient, tenant_id: uuid.UUID) -> None:
    """Un TXT se ingesta como documento ``txt`` con su tupla sync inicial."""
    payload, body = _ingest_file(client, content=b"Bienvenidos a la base de conocimiento.")
    document = body["document"]
    assert document["title"] == "manual"
    assert document["source_type"] == "txt"
    assert document["source_ref"] == "manual.txt"
    assert document["metadata"] == {
        "filename": "manual.txt",
        "content_type": payload["content_type"],
    }
    assert document["content"] == "Bienvenidos a la base de conocimiento."
    assert document["tenant_id"] == str(tenant_id)
    assert document["version"] == 1
    assert document["revision"] == 1
    assert body["chunks_created"] >= 1


def test_ingest_file_csv_returns_201(client: TestClient) -> None:
    """Un CSV se ingesta normalizando columnas a texto plano."""
    _, body = _ingest_file(
        client,
        filename="productos.csv",
        content=b"producto,precio\nPluma,10\nLapiz,5",
        content_type="text/csv",
    )
    document = body["document"]
    assert document["source_type"] == "csv"
    assert document["title"] == "productos"
    assert "Pluma" in document["content"]
    assert "Lapiz" in document["content"]


def test_ingest_file_pdf_returns_201(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Un PDF se ingesta extrayendo el texto (``_extract_pdf`` simulado)."""
    monkeypatch.setattr(
        "app.api.v1.content._extract_pdf", lambda raw: "Texto extraído del PDF de ejemplo."
    )
    _, body = _ingest_file(
        client,
        filename="manual.pdf",
        content=b"%PDF-bytes-de-prueba",
        content_type="application/pdf",
    )
    document = body["document"]
    assert document["source_type"] == "pdf"
    assert document["title"] == "manual"
    assert document["metadata"]["filename"] == "manual.pdf"
    assert "Texto extraído del PDF de ejemplo." in document["content"]


def test_ingest_file_unsupported_format_returns_422(client: TestClient) -> None:
    """Un formato no soportado es rechazado con 422 validation.input_error."""
    response = client.post(
        "/api/v1/content/documents/ingest-file",
        files={"file": ("virus.exe", b"MZ...", "application/octet-stream")},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "documents.ingest_file"


def test_ingest_file_empty_content_returns_422(client: TestClient) -> None:
    """Un archivo sin texto extraíble es rechazado (no genera un documento vacío)."""
    response = client.post(
        "/api/v1/content/documents/ingest-file",
        files={"file": ("vacio.txt", b"   \n  ", "text/plain")},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.input_error"


def test_ingest_file_oversize_returns_422(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Un archivo que supera el límite de bytes es rechazado (límite simulado)."""
    monkeypatch.setattr("app.api.v1.content._MAX_FILE_BYTES", 10)
    response = client.post(
        "/api/v1/content/documents/ingest-file",
        files={"file": ("grande.txt", b"x" * 100, "text/plain")},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.input_error"


def test_ingest_file_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la ingesta (aislamiento)."""
    response = client.post(
        "/api/v1/content/documents/ingest-file",
        files={"file": ("manual.txt", b"contenido", "text/plain")},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


# ---------------------------------------------------------------------------
# Ingesta por URL
# ---------------------------------------------------------------------------


def test_ingest_url_returns_201(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Una URL se ingesta como documento ``url`` con su metadata."""

    async def fake_fetch(url: str) -> str:
        return "Texto visible extraído de la URL de ejemplo."

    monkeypatch.setattr("app.api.v1.content._fetch_url", fake_fetch)

    payload, body = _ingest_url(client)
    document = body["document"]
    assert document["source_type"] == "url"
    assert document["source_ref"] == payload["url"]
    assert document["metadata"] == {"url": payload["url"]}
    assert document["title"] == "articulo-prueba"
    assert body["chunks_created"] >= 1


def test_ingest_url_custom_title(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Un ``title`` explícito tiene prioridad sobre el derivado de la URL."""

    async def fake_fetch(url: str) -> str:
        return "Texto de la página."

    monkeypatch.setattr("app.api.v1.content._fetch_url", fake_fetch)

    _, body = _ingest_url(client, url="https://example.com/ruta", title="Título Personalizado")
    assert body["document"]["title"] == "Título Personalizado"


def test_ingest_url_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la ingesta de URL (aislamiento)."""
    response = client.post(
        "/api/v1/content/documents/ingest-url",
        json={"url": "https://example.com"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_ingest_url_empty_url_returns_422(client: TestClient) -> None:
    """Una URL vacía es rechazada por validación del payload (422)."""
    response = client.post(
        "/api/v1/content/documents/ingest-url",
        json={"url": ""},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


def test_ingest_url_rejects_extra_fields(client: TestClient) -> None:
    """Campos no declarados son rechazados (extra='forbid')."""
    response = client.post(
        "/api/v1/content/documents/ingest-url",
        json={"url": "https://example.com", "unexpected": 1},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


# ---------------------------------------------------------------------------
# Listado, detalle, búsqueda y borrado
# ---------------------------------------------------------------------------


def test_documents_list_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye el documento recién ingerido y NO expone content."""
    _, ingested = _ingest_file(client, content=b"Documento para listar.")

    response = client.get("/api/v1/content/documents", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body and "total" in body
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == ingested["document"]["id"] for item in body["items"])
    assert all("content" not in item for item in body["items"])


def test_documents_get_roundtrip(client: TestClient) -> None:
    """GET por id devuelve el documento con su contenido completo."""
    _, ingested = _ingest_file(client, content=b"Contenido unico get roundtrip.")
    document_id = ingested["document"]["id"]

    response = client.get(f"/api/v1/content/documents/{document_id}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == document_id
    assert body["content"] == "Contenido unico get roundtrip."
    assert body["metadata"]["filename"] == "manual.txt"


def test_documents_get_missing_returns_404(client: TestClient) -> None:
    """Pedir un documento inexistente devuelve 404 con operation documents.get."""
    response = client.get(
        f"/api/v1/content/documents/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "documents.get"


def test_documents_search_returns_results(client: TestClient) -> None:
    """La búsqueda por texto encuentra el documento ingerido (término único)."""
    unique = f"términoúnico-{uuid.uuid4().hex[:8]}"
    _, ingested = _ingest_file(client, content=f"Documento con {unique} dentro.")
    document_id = ingested["document"]["id"]

    response = client.post(
        "/api/v1/content/documents/search",
        json={"query": unique, "limit": 5},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert any(result["document_id"] == document_id for result in body)
    assert all(result["score"] >= 1.0 for result in body)


def test_documents_search_rejects_empty_query(client: TestClient) -> None:
    """Una query vacía es rechazada por validación del payload (422)."""
    response = client.post(
        "/api/v1/content/documents/search",
        json={"query": ""},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


def test_documents_delete_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el documento deja de ser visible."""
    _, ingested = _ingest_file(client, content=b"Documento a eliminar.")
    document_id = ingested["document"]["id"]

    response = client.delete(
        f"/api/v1/content/documents/{document_id}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(f"/api/v1/content/documents/{document_id}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_documents_delete_missing_returns_404(client: TestClient) -> None:
    """Borrar un documento inexistente devuelve 404 con operation documents.delete."""
    response = client.delete(
        f"/api/v1/content/documents/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "documents.delete"


def test_documents_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve, lista ni busca los documentos de dev-tenant."""
    _, ingested = _ingest_file(client, content=b"Documento privado del tenant dev.")
    document_id = ingested["document"]["id"]

    fetched = client.get(f"/api/v1/content/documents/{document_id}", headers=_other_tenant())
    assert fetched.status_code == 404

    listed = client.get("/api/v1/content/documents", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []

    searched = client.post(
        "/api/v1/content/documents/search",
        json={"query": "privado", "limit": 10},
        headers=_other_tenant(),
    )
    assert searched.status_code == 200
    assert searched.json() == []
