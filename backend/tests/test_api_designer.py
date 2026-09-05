"""Tests de los endpoints del diseñador (CRUD + publicar + compilar) vía HTTP."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}


@pytest.fixture(autouse=True)
def _auth_headers(tenant_admin_token: str) -> None:
    """Añade el Bearer del tenant-admin a las cabeceras por defecto (RBAC)."""
    TENANT_HEADERS["Authorization"] = f"Bearer {tenant_admin_token}"


def _payload(
    campaign_id: uuid.UUID | None = None, name: str = "Landing de prueba"
) -> dict[str, Any]:
    """Payload válido con campaign_id fresco por defecto (evita colisiones entre tests)."""
    return {
        "campaign_id": str(campaign_id or uuid.uuid4()),
        "name": name,
        "config": {"title": "Landing API", "blocks": []},
    }


def _create_landing(
    client: TestClient, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = _payload(**overrides)
    response = client.post("/api/v1/designer", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_create_landing_returns_201(client: TestClient) -> None:
    """Crea una landing y devuelve la tupla sync inicial (revision == 1)."""
    payload, body = _create_landing(client)
    assert body["name"] == payload["name"]
    assert body["campaign_id"] == payload["campaign_id"]
    assert body["revision"] == 1
    assert body["published"] is False
    assert body["published_at"] is None
    assert body["id"]


def test_create_duplicate_campaign_returns_409(client: TestClient) -> None:
    """Un mismo campaign_id dentro del tenant genera conflicto (409)."""
    campaign_id = uuid.uuid4()
    _create_landing(client, campaign_id=campaign_id, name="Primera")

    response = client.post(
        "/api/v1/designer",
        json=_payload(campaign_id=campaign_id, name="Duplicada"),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "landing.create"


def test_create_missing_tenant_header_returns_403(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id el acceso se deniega (aislamiento multi-tenant)."""
    response = client.post(
        "/api/v1/designer",
        json=_payload(),
        headers={"Authorization": f"Bearer {tenant_admin_token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"


def test_create_invalid_payload_returns_422(client: TestClient) -> None:
    """Un payload inválido devuelve 422 con código de error estructurado."""
    response = client.post(
        "/api/v1/designer",
        json={"campaign_id": "not-a-uuid", "name": ""},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.request_error"


def test_list_landings_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye la landing recién creada del tenant activo."""
    payload, created = _create_landing(client, name="Listable")

    response = client.get("/api/v1/designer", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body
    assert "total" in body
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])
    assert any(item["name"] == payload["name"] for item in body["items"])


def test_get_landing_roundtrip(client: TestClient) -> None:
    """GET por id devuelve la landing creada (roundtrip)."""
    payload, created = _create_landing(client, name="Roundtrip")

    response = client.get(
        f"/api/v1/designer/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == payload["name"]
    assert body["tenant_id"] == created["tenant_id"]


def test_get_missing_landing_returns_404(client: TestClient) -> None:
    """Pedir una landing inexistente devuelve 404 resource.not_found."""
    response = client.get(
        f"/api/v1/designer/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"


def test_update_landing_renames(client: TestClient) -> None:
    """PATCH parcial renombra la landing e incrementa la revisión."""
    _, created = _create_landing(client, name="Antes")

    response = client.patch(
        f"/api/v1/designer/{created['id']}",
        json={"name": "Después"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Después"
    assert body["revision"] == 2


def test_update_missing_landing_returns_404(client: TestClient) -> None:
    """Actualizar una landing inexistente devuelve 404."""
    response = client.patch(
        f"/api/v1/designer/{uuid.uuid4()}",
        json={"name": "Nadie"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


def test_publish_landing_toggle(client: TestClient) -> None:
    """Publicar fija published_at; despublicar lo limpia."""
    _, created = _create_landing(client, name="Publicable")

    published = client.post(
        f"/api/v1/designer/{created['id']}/publish",
        json={"published": True},
        headers=TENANT_HEADERS,
    )
    assert published.status_code == 200
    pub_body = published.json()
    assert pub_body["published"] is True
    assert pub_body["published_at"] is not None

    unpublished = client.post(
        f"/api/v1/designer/{created['id']}/publish",
        json={"published": False},
        headers=TENANT_HEADERS,
    )
    assert unpublished.status_code == 200
    unpub_body = unpublished.json()
    assert unpub_body["published"] is False
    assert unpub_body["published_at"] is None


def test_delete_landing_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y la landing deja de ser visible."""
    _, created = _create_landing(client, name="Descartable")

    response = client.delete(
        f"/api/v1/designer/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(
        f"/api/v1/designer/{created['id']}", headers=TENANT_HEADERS
    )
    assert after.status_code == 404


def test_compile_landing_returns_html(client: TestClient) -> None:
    """Compilar una configuración devuelve HTML renderizado + timestamp."""
    response = client.post(
        "/api/v1/designer/compile",
        json={"config": {"title": "Compilada", "blocks": []}, "template_name": "default"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert "<title>Compilada</title>" in body["html"]
    assert "compiled_at" in body
