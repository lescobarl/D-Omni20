"""Tests de los endpoints de rebranding por URL (Fase 5).

Cubre ``/api/v1/tenant/appearance``:

- ``POST /extract-url``: devuelve la propuesta (paleta, tipografías, logo) sin
  persistir; valida la URL (422) y exige el tenant activo (403).
- ``POST /rebranding``: extrae y guarda la configuración como aplicada (201),
  con ``applied_at`` y ``version``; valida el payload (422).
- ``GET /rebranding``: lista las configuraciones guardadas, aisladas por tenant.
- ``DELETE /rebranding/{config_id}``: soft-delete (204) y 404 si no existe o
  pertenece a otro tenant.

El cliente HTTP real se sustituye por un stub vía ``dependency_overrides``
(regla CLAUDE: DI) para no depender de la red en los tests.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from app.api.deps import get_rebranding_service
from app.schemas.tenant_config import AppearanceProposal
from fastapi.testclient import TestClient

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"

_EXTRACTED: dict[str, Any] = {
    "primary_color": "#0055AA",
    "accent_color": "#FF6600",
    "surface_color": "#F5F5F5",
    "text_color": "#111111",
    "brand_badge": "#FF6600",
    "logo_url": "https://brand.example.com/logo-brand.png",
    "font_family": "Open Sans",
    "detected_fonts": ["Open Sans", "Roboto"],
}


def _other_tenant() -> dict[str, str]:
    """Cabeceras de un tenant aislado (UUID aleatorio válido, no sembrado)."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _unique_url() -> str:
    """URL única por test (el tenant dev comparte base entre tests)."""
    return f"https://brand-{uuid.uuid4().hex[:8]}.example.com/"


class _StubRebrandingService:
    """Sustituye la extracción HTTP real por una propuesta fija."""

    def extract_url_styles(self, *, url: str) -> AppearanceProposal:
        return AppearanceProposal(**_EXTRACTED)


@pytest.fixture()
def override_rebranding(client: TestClient):
    """Sustituye ``get_rebranding_service`` solo durante el test."""
    client.app.dependency_overrides[get_rebranding_service] = lambda: _StubRebrandingService()
    try:
        yield
    finally:
        client.app.dependency_overrides.pop(get_rebranding_service, None)


def test_extract_url_returns_proposal(
    client: TestClient, override_rebranding
) -> None:
    response = client.post(
        "/api/v1/tenant/appearance/extract-url",
        json={"url": _unique_url()},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["primary_color"] == "#0055AA"
    assert body["accent_color"] == "#FF6600"
    assert body["surface_color"] == "#F5F5F5"
    assert body["text_color"] == "#111111"
    assert body["brand_badge"] == "#FF6600"
    assert body["logo_url"] == "https://brand.example.com/logo-brand.png"
    assert body["font_family"] == "Open Sans"
    assert body["detected_fonts"] == ["Open Sans", "Roboto"]


def test_extract_url_invalid_url_returns_422(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tenant/appearance/extract-url",
        json={"url": "short"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation.request_error"


def test_extract_url_rejects_extra_fields(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tenant/appearance/extract-url",
        json={"url": _unique_url(), "extra": "x"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation.request_error"


def test_extract_url_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.post(
        "/api/v1/tenant/appearance/extract-url",
        json={"url": _unique_url()},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_rebranding_create_returns_201(
    client: TestClient, tenant_id: uuid.UUID, override_rebranding
) -> None:
    response = client.post(
        "/api/v1/tenant/appearance/rebranding",
        json={"name": "Mi Marca", "url": _unique_url()},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Mi Marca"
    assert body["version"] == 1
    assert body["applied_at"] is not None
    assert body["extracted"] == _EXTRACTED
    assert body["tenant_id"] == str(tenant_id)


def test_rebranding_create_invalid_payload_returns_422(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tenant/appearance/rebranding",
        json={"name": "", "url": _unique_url()},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation.request_error"


def test_rebranding_list_returns_saved(
    client: TestClient, override_rebranding
) -> None:
    created = client.post(
        "/api/v1/tenant/appearance/rebranding",
        json={"name": "Mi Marca", "url": _unique_url()},
        headers=TENANT_HEADERS,
    )
    assert created.status_code == 201, created.text
    created_id = created.json()["id"]

    response = client.get("/api/v1/tenant/appearance/rebranding", headers=TENANT_HEADERS)
    assert response.status_code == 200, response.text
    items = response.json()
    assert any(item["id"] == created_id for item in items)


def test_rebranding_list_isolated_per_tenant(client: TestClient) -> None:
    response = client.get(
        "/api/v1/tenant/appearance/rebranding", headers=_other_tenant()
    )
    assert response.status_code == 200, response.text
    assert response.json() == []


def test_rebranding_delete_returns_204(
    client: TestClient, override_rebranding
) -> None:
    created = client.post(
        "/api/v1/tenant/appearance/rebranding",
        json={"name": "Mi Marca", "url": _unique_url()},
        headers=TENANT_HEADERS,
    ).json()

    response = client.delete(
        f"/api/v1/tenant/appearance/rebranding/{created['id']}",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 204, response.text

    items = client.get(
        "/api/v1/tenant/appearance/rebranding", headers=TENANT_HEADERS
    ).json()
    assert all(item["id"] != created["id"] for item in items)


def test_rebranding_delete_missing_returns_404(client: TestClient) -> None:
    response = client.delete(
        f"/api/v1/tenant/appearance/rebranding/{uuid.uuid4()}",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404, response.text
    body = response.json()["error"]
    assert body["code"] == "resource.not_found"
    assert body["operation"] == "tenant.appearance.delete_rebranding"


def test_rebranding_delete_cross_tenant_returns_404(
    client: TestClient, override_rebranding
) -> None:
    created = client.post(
        "/api/v1/tenant/appearance/rebranding",
        json={"name": "Mi Marca", "url": _unique_url()},
        headers=TENANT_HEADERS,
    ).json()

    response = client.delete(
        f"/api/v1/tenant/appearance/rebranding/{created['id']}",
        headers=_other_tenant(),
    )
    assert response.status_code == 404, response.text


def test_rebranding_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.get(
        "/api/v1/tenant/appearance/rebranding",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "tenant.isolation_violation"
