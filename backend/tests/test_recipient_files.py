"""Tests de los archivos de destinatarios reutilizables (GAP 2).

Cubre los endpoints de ``/api/v1/operations`` para el envío masivo sobre
"archivos existentes":

- ``POST /recipient-files``: sube un CSV crudo reutilizable del tenant.
- ``GET /recipient-files``: lista paginada de archivos del tenant.
- ``POST /recipient-files/{id}/preview``: vista previa dry-run (sin insertar).
- ``POST /campaigns/{id}/dispatch-from-file``: materializa contactos del CSV,
  los registra como destinatarios (idempotente) y dispara el envío.

Patrones verificados frente a los endpoints reales:
- ``get_current_tenant`` fija ``operation="tenant.resolve"`` en los 403.
- El 404 de archivo/campaña inexistente pasa por ``NotFoundError`` con
  ``operation="operations.recipient_files.preview"`` o ``"campaign.dispatch"``.
- El 422 de ``RequestValidationError`` (campos extra) NO incluye ``operation``.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.test_operations import (
    TENANT_HEADERS,
    _API,
    _assert_error,
    _assert_missing_tenant_header,
    _assert_request_error,
    _create_campaign,
    _create_contact,
    _suffix,
)


# ---------------------------------------------------------------------------
# Helpers compartidos
# ---------------------------------------------------------------------------

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
    """Cabeceras de un tenant aleatorio distinto al de desarrollo."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _create_recipient_file(
    client: TestClient, *, name: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crea un archivo de destinatarios y devuelve (payload, body)."""
    payload: dict[str, Any] = {
        "name": name or f"archivo-{_suffix()}",
        "content_type": "text/csv",
        "raw_csv": "phone,name\n5215500000001,Ana\n5215500000002,Beto\n",
        "source_meta": {"origin": "test"},
        **overrides,
    }
    response = client.post(
        f"{_API}/recipient-files", json=payload, headers=TENANT_HEADERS
    )
    assert response.status_code == 201, response.text
    return payload, response.json()


# ---------------------------------------------------------------------------
# Archivos de destinatarios (GAP 2)
# ---------------------------------------------------------------------------


def test_recipient_file_create_returns_201_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Crea un archivo y devuelve la tupla sync inicial."""
    payload, body = _create_recipient_file(client, name="lista-vip")
    assert body["name"] == "lista-vip"
    assert body["content_type"] == "text/csv"
    assert body["source_meta"] == {"origin": "test"}
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]
    # El CSV crudo no se expone en la lectura (solo en la vista previa).
    assert "raw_csv" not in body


def test_recipient_file_list_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye el archivo recién creado del tenant activo."""
    _, created = _create_recipient_file(client, name="listable")
    response = client.get(f"{_API}/recipient-files", headers=TENANT_HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] >= 1
    ids = [item["id"] for item in body["items"]]
    assert created["id"] in ids


def test_recipient_file_rejects_extra_fields(client: TestClient) -> None:
    """Campos extra en el payload se rechazan con 422 (sin ``operation``)."""
    response = client.post(
        f"{_API}/recipient-files",
        json={
            "name": "x",
            "content_type": "text/csv",
            "raw_csv": "phone\n1\n",
            "extra": "no",
        },
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


def test_recipient_file_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        f"{_API}/recipient-files",
        json={"name": "x", "content_type": "text/csv", "raw_csv": "phone\n1\n"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_recipient_file_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve los archivos de dev-tenant."""
    _, created = _create_recipient_file(client)
    response = client.get(f"{_API}/recipient-files", headers=_other_tenant())
    assert response.status_code == 200, response.text
    ids = [item["id"] for item in response.json()["items"]]
    assert created["id"] not in ids


# ---------------------------------------------------------------------------
# Vista previa de contactos (GAP 2)
# ---------------------------------------------------------------------------


def test_recipient_file_preview_returns_contacts(client: TestClient) -> None:
    """La vista previa parsea el CSV y devuelve phone/name sin insertar."""
    _, created = _create_recipient_file(
        client,
        raw_csv="phone,name\n5215500000001,Ana\n5215500000002,Beto\n",
    )
    response = client.post(
        f"{_API}/recipient-files/{created['id']}/preview", headers=TENANT_HEADERS
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["file_id"] == created["id"]
    assert body["name"] == created["name"]
    assert body["total"] == 2
    assert body["contacts"] == [
        {"phone": "5215500000001", "name": "Ana"},
        {"phone": "5215500000002", "name": "Beto"},
    ]


def test_recipient_file_preview_skips_rows_without_phone(client: TestClient) -> None:
    """Filas sin ``phone`` se omiten en la vista previa."""
    _, created = _create_recipient_file(
        client,
        raw_csv="phone,name\n5215500000001,Ana\n,sin-telefono\n",
    )
    response = client.post(
        f"{_API}/recipient-files/{created['id']}/preview", headers=TENANT_HEADERS
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["contacts"] == [{"phone": "5215500000001", "name": "Ana"}]


def test_recipient_file_preview_missing_returns_404(client: TestClient) -> None:
    """Vista previa de un archivo inexistente devuelve 404."""
    response = client.post(
        f"{_API}/recipient-files/{uuid.uuid4()}/preview", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.recipient_files.preview",
    )


def test_recipient_file_preview_cross_tenant_returns_404(client: TestClient) -> None:
    """Un tenant aislado no puede previsualizar los archivos de dev-tenant."""
    _, created = _create_recipient_file(client)
    response = client.post(
        f"{_API}/recipient-files/{created['id']}/preview", headers=_other_tenant()
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.recipient_files.preview",
    )


def test_recipient_file_preview_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la vista previa (aislamiento)."""
    response = client.post(
        f"{_API}/recipient-files/{uuid.uuid4()}/preview",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


# ---------------------------------------------------------------------------
# Envío masivo desde archivo (GAP 2)
# ---------------------------------------------------------------------------


def test_dispatch_from_file_creates_contacts_and_dispatches(
    client: TestClient,
) -> None:
    """Materializa los contactos del CSV, los registra y dispara el envío."""
    _, campaign = _create_campaign(client, segment_type="event")
    _, file = _create_recipient_file(
        client,
        raw_csv="phone,name\n5215500000001,Ana\n5215500000002,Beto\n",
    )
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch-from-file",
        json={"file_id": file["id"]},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["campaigns_processed"] == 1
    # Sin plantilla ni canal configurado en el entorno de prueba, los contactos
    # materializados no pueden enviarse y se registran como omitidos (skipped).
    assert body["recipients_sent"] == 0
    assert body["recipients_failed"] == 0
    assert body["recipients_skipped"] == 2

    # Los contactos del CSV quedaron materializados en el directorio del tenant.
    contacts = client.get(f"{_API}/contacts", headers=TENANT_HEADERS)
    assert contacts.status_code == 200, contacts.text
    phones = {c["phone"] for c in contacts.json()["items"]}
    assert {"5215500000001", "5215500000002"} <= phones

    fetched = client.get(f"{_API}/campaigns/{campaign['id']}", headers=TENANT_HEADERS)
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["state"] == "completed"


def test_dispatch_from_file_is_idempotent_for_existing_recipients(
    client: TestClient,
) -> None:
    """Un contacto ya vinculado a la campaña se omite (skipped)."""
    phone = f"52155{_suffix()}"
    _, campaign = _create_campaign(client, segment_type="event")
    _, contact = _create_contact(client, phone=phone)
    _, file = _create_recipient_file(
        client,
        raw_csv=f"phone,name\n{phone},Ana\n",
    )
    # Primera ejecución: materializa y registra el contacto.
    first = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch-from-file",
        json={"file_id": file["id"]},
        headers=TENANT_HEADERS,
    )
    assert first.status_code == 200, first.text

    # Segunda ejecución: el contacto ya existe y ya está vinculado → se omite.
    second = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch-from-file",
        json={"file_id": file["id"]},
        headers=TENANT_HEADERS,
    )
    assert second.status_code == 200, second.text
    assert second.json()["recipients_skipped"] == 1


def test_dispatch_from_file_missing_campaign_returns_404(client: TestClient) -> None:
    """Despachar desde archivo con campaña inexistente devuelve 404."""
    _, file = _create_recipient_file(client)
    response = client.post(
        f"{_API}/campaigns/{uuid.uuid4()}/dispatch-from-file",
        json={"file_id": file["id"]},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="campaign.dispatch",
    )


def test_dispatch_from_file_missing_file_returns_404(client: TestClient) -> None:
    """Despachar desde archivo con archivo inexistente devuelve 404."""
    _, campaign = _create_campaign(client)
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch-from-file",
        json={"file_id": str(uuid.uuid4())},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="campaign.dispatch",
    )


def test_dispatch_from_file_cross_tenant_returns_404(client: TestClient) -> None:
    """Un tenant aislado no puede despachar campañas ni archivos de dev-tenant."""
    _, campaign = _create_campaign(client)
    _, file = _create_recipient_file(client)
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch-from-file",
        json={"file_id": file["id"]},
        headers=_other_tenant(),
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="campaign.dispatch",
    )


def test_dispatch_from_file_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega el envío desde archivo."""
    response = client.post(
        f"{_API}/campaigns/{uuid.uuid4()}/dispatch-from-file",
        json={"file_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)
