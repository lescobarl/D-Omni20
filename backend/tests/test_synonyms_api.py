"""Tests de los endpoints de sinónimos del bot (Fase 2 — normalización).

Cubre ``/api/v1/content/synonyms``:

- CRUD individual: crear (201, recorte de espacios), duplicado case-insensitive
  (422 ``validation.input_error``), actualizar (200/404/conflicto excluyendo el
  propio registro), soft-delete (204/404).
- Importación en lote CSV y JSON (crea, salta existentes y valida formato).
- Exportación CSV y JSON (``StreamingResponse`` con ``Content-Disposition``).
- Regresión de ruteo: ``GET /synonyms`` NO queda ensombrecido por el
  ``GET /content/{item_id}`` preexistente.
- Aislamiento multi-tenant: cabecera ausente (403) y tenant aislado que nunca
  ve, lista ni modifica datos de ``dev-tenant``.

Notas de diseño:
- El tenant ``dev-tenant`` del conftest es de scope sesión y acumula filas entre
  tests, por lo que cada test usa términos únicos (sufijo UUID) para ser
  determinista e independiente del orden de ejecución.
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


def _unique_term(prefix: str) -> str:
    """Término único por test (el tenant dev comparte base entre tests)."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _create_synonym(
    client: TestClient,
    *,
    term: str | None = None,
    synonyms: list[str] | None = None,
    headers: dict[str, str] = TENANT_HEADERS,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "term": term if term is not None else _unique_term("term"),
        "synonyms": synonyms if synonyms is not None else ["variante-uno", "variante-dos"],
    }
    response = client.post("/api/v1/content/synonyms", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _import_csv(
    client: TestClient,
    content: str,
    *,
    headers: dict[str, str] = TENANT_HEADERS,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/content/synonyms/import",
        json={"content": content, "format": "csv"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# CRUD individual
# ---------------------------------------------------------------------------


def test_create_synonym_returns_201(client: TestClient, tenant_id: uuid.UUID) -> None:
    """Crear un término canónico devuelve el registro con su tupla sync."""
    body = _create_synonym(client, term="Computadora", synonyms=["PC", "ordenador"])
    assert body["term"] == "Computadora"
    assert body["synonyms"] == ["PC", "ordenador"]
    assert body["tenant_id"] == str(tenant_id)
    assert body["version"] == 1
    assert body["revision"] == 1
    assert body["id"]


def test_create_synonym_strips_whitespace(client: TestClient) -> None:
    """Los espacios alrededor de término y variantes se recortan."""
    body = _create_synonym(
        client, term="  Coche  ", synonyms=["  auto  ", "  carro  ", "   "]
    )
    assert body["term"] == "Coche"
    assert body["synonyms"] == ["auto", "carro"]  # las variantes vacías se descartan.


def test_create_duplicate_term_returns_422(client: TestClient) -> None:
    """Un término ya existente (comparado case-insensitive) se rechaza."""
    term = _unique_term("duplicado")
    _create_synonym(client, term=term, synonyms=["a"])
    response = client.post(
        "/api/v1/content/synonyms",
        json={"term": term.upper(), "synonyms": ["b"]},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "synonyms.create"


def test_list_synonyms_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye el sinónimo recién creado (ruteo correcto)."""
    created = _create_synonym(client)

    response = client.get("/api/v1/content/synonyms", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body and "total" in body
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_update_synonym_returns_200(client: TestClient) -> None:
    """Actualizar término y variantes del propio registro."""
    term_inicial = _unique_term("editar")
    created = _create_synonym(client, term=term_inicial, synonyms=["auto"])
    nuevo_term = _unique_term("editado")
    response = client.put(
        f"/api/v1/content/synonyms/{created['id']}",
        json={"term": nuevo_term, "synonyms": ["auto", "carro"]},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["term"] == nuevo_term
    assert body["synonyms"] == ["auto", "carro"]


def test_update_synonym_missing_returns_404(client: TestClient) -> None:
    """Actualizar un sinónimo inexistente devuelve 404."""
    response = client.put(
        f"/api/v1/content/synonyms/{uuid.uuid4()}",
        json={"term": "Nuevo"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "synonyms.update"


def test_update_term_conflict_excluding_self(client: TestClient) -> None:
    """Conflicto con otro término → 422; mantener el propio término → 200."""
    term_a = _unique_term("conflicto")
    first = _create_synonym(client, term=term_a, synonyms=["a"])
    second = _create_synonym(client, synonyms=["b"])

    # Renombrar `second` a `term_a` choca con `first`.
    conflict = client.put(
        f"/api/v1/content/synonyms/{second['id']}",
        json={"term": term_a},
        headers=TENANT_HEADERS,
    )
    assert conflict.status_code == 422
    assert conflict.json()["error"]["operation"] == "synonyms.update"

    # Reescribir el propio término no se considera conflicto.
    ok = client.put(
        f"/api/v1/content/synonyms/{first['id']}",
        json={"term": term_a, "synonyms": ["nuevo"]},
        headers=TENANT_HEADERS,
    )
    assert ok.status_code == 200
    assert ok.json()["synonyms"] == ["nuevo"]


def test_delete_synonym_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el sinónimo deja de listarse."""
    created = _create_synonym(client)
    response = client.delete(
        f"/api/v1/content/synonyms/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    listed = client.get("/api/v1/content/synonyms", headers=TENANT_HEADERS).json()
    assert all(item["id"] != created["id"] for item in listed["items"])


def test_delete_synonym_missing_returns_404(client: TestClient) -> None:
    """Borrar un sinónimo inexistente devuelve 404."""
    response = client.delete(
        f"/api/v1/content/synonyms/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "synonyms.delete"


# ---------------------------------------------------------------------------
# Importación en lote
# ---------------------------------------------------------------------------


def test_import_csv_creates_synonyms(client: TestClient) -> None:
    """Un CSV bien formado crea los términos (las variantes van con ``|``)."""
    term_a = _unique_term("csv")
    term_b = _unique_term("csv")
    result = _import_csv(
        client,
        f"term,synonyms\n{term_a},pc|ordenador\n{term_b},auto|carro\n",
    )
    assert result["imported"] == 2
    assert result["skipped"] == 0
    assert result["failed"] == 0

    listed = client.get("/api/v1/content/synonyms", headers=TENANT_HEADERS).json()
    terms = {item["term"] for item in listed["items"]}
    assert term_a in terms and term_b in terms


def test_import_csv_skips_existing_terms(client: TestClient) -> None:
    """Los términos ya existentes se saltan (idempotente, no falla)."""
    term = _unique_term("skips")
    _create_synonym(client, term=term, synonyms=["a"])

    result = _import_csv(client, f"term,synonyms\n{term},pc\n{term.upper()},otro\n")
    assert result["imported"] == 0
    assert result["skipped"] == 2  # el mismo término en dos variantes de mayúsculas.


def test_import_json_creates_synonyms(client: TestClient) -> None:
    """Un JSON (lista de objetos) crea los términos."""
    term = _unique_term("json")
    response = client.post(
        "/api/v1/content/synonyms/import",
        json={"content": f'[{{"term": "{term}", "synonyms": ["a", "b"]}}]', "format": "json"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["imported"] == 1
    assert result["skipped"] == 0


def test_import_invalid_json_returns_422(client: TestClient) -> None:
    """Un contenido JSON mal formado se rechaza con 422."""
    response = client.post(
        "/api/v1/content/synonyms/import",
        json={"content": "no-es-json", "format": "json"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["operation"] == "synonyms.import"


def test_import_invalid_csv_header_returns_422(client: TestClient) -> None:
    """Un CSV sin las columnas obligatorias se rechaza con 422."""
    response = client.post(
        "/api/v1/content/synonyms/import",
        json={"content": "columna,otra\nvalor,otro\n", "format": "csv"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["operation"] == "synonyms.import"


# ---------------------------------------------------------------------------
# Exportación
# ---------------------------------------------------------------------------


def test_export_synonyms_csv(client: TestClient) -> None:
    """Exporta CSV con cabecera ``term,synonyms`` y variantes unidas por ``|``."""
    term = _unique_term("export")
    _create_synonym(client, term=term, synonyms=["pc", "ordenador"])

    response = client.get("/api/v1/content/synonyms/export", headers=TENANT_HEADERS)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert 'attachment; filename="synonyms.csv"' in response.headers["content-disposition"]
    assert "term,synonyms" in response.text
    assert term in response.text
    assert "pc|ordenador" in response.text


def test_export_synonyms_json(client: TestClient) -> None:
    """Exporta JSON (lista de objetos term/synonyms)."""
    term = _unique_term("export")
    _create_synonym(client, term=term, synonyms=["auto", "carro"])

    response = client.get(
        "/api/v1/content/synonyms/export?file_format=json", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert 'attachment; filename="synonyms.json"' in response.headers["content-disposition"]
    assert term in response.text
    assert "auto" in response.text and "carro" in response.text


# ---------------------------------------------------------------------------
# Aislamiento multi-tenant
# ---------------------------------------------------------------------------


def test_synonyms_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la operación (aislamiento)."""
    response = client.post(
        "/api/v1/content/synonyms",
        json={"term": "Privado", "synonyms": ["x"]},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_synonyms_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve, lista ni modifica los sinónimos de dev-tenant."""
    created = _create_synonym(client, term=_unique_term("aislado"), synonyms=["p"])

    listed = client.get("/api/v1/content/synonyms", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []

    fetched = client.get("/api/v1/content/synonyms/export", headers=_other_tenant())
    assert fetched.status_code == 200
    assert created["term"] not in fetched.text

    updated = client.put(
        f"/api/v1/content/synonyms/{created['id']}",
        json={"term": "Hackeado"},
        headers=_other_tenant(),
    )
    assert updated.status_code == 404
    assert updated.json()["error"]["operation"] == "synonyms.update"

    deleted = client.delete(
        f"/api/v1/content/synonyms/{created['id']}", headers=_other_tenant()
    )
    assert deleted.status_code == 404
    assert deleted.json()["error"]["operation"] == "synonyms.delete"
