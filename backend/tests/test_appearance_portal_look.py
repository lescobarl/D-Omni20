"""Pruebas del look del portal de configuración (PUT /tenant/appearance/portal-look).

Preferencias por tenant, aplicadas a todos los miembros y editables SOLO por
admin (RBAC). Persisten en ``tenant_appearance`` junto a la apariencia.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

TENANT_HEADERS = {"X-Tenant-Id": "dev-tenant"}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", **TENANT_HEADERS}


def test_admin_updates_portal_look_and_persists(
    client: TestClient, tenant_admin_token: str
) -> None:
    """El admin fija acento/superficie y el GET de apariencia los refleja."""
    response = client.put(
        "/api/v1/tenant/appearance/portal-look",
        json={"portal_accent": "neutral", "portal_surface": "tint"},
        headers=_auth(tenant_admin_token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["portal_accent"] == "neutral"
    assert body["portal_surface"] == "tint"

    read = client.get(
        "/api/v1/tenant/appearance",
        headers=_auth(tenant_admin_token),
    )
    assert read.status_code == 200
    assert read.json()["portal_accent"] == "neutral"
    assert read.json()["portal_surface"] == "tint"


def test_configurador_cannot_update_portal_look(
    client: TestClient, configurador_token: str
) -> None:
    """Un configurador no puede cambiar el look del portal (solo admin)."""
    response = client.put(
        "/api/v1/tenant/appearance/portal-look",
        json={"portal_accent": "neutral", "portal_surface": "tint"},
        headers=_auth(configurador_token),
    )
    assert response.status_code == 403


def test_portal_look_rejects_invalid_value(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Un valor fuera del enum devuelve 422."""
    response = client.put(
        "/api/v1/tenant/appearance/portal-look",
        json={"portal_accent": "arcoiris", "portal_surface": "light"},
        headers=_auth(tenant_admin_token),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"
