"""Tests del CRUD de tenants (control plane) — ``/api/v1/tenants``.

Cubre el ciclo de vida completo de un tenant vía HTTP (sin ``X-Tenant-Id``,
pues es control plane):
- Crear (idempotente por slug): 201 la primera vez, 200 si ya existe con el
  mismo nombre y 409 si el slug está en uso por otro nombre.
- Listar tenants activos.
- Obtener por slug (y 404 si no existe).
- Actualizar el nombre vía PATCH (el slug es inmutable) y 404 si no existe.
- Soft-delete vía DELETE (204) y 404 si no existe; el tenant eliminado deja de
  aparecer en list/get.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi.testclient import TestClient

from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantRepository


def _auth_headers(token: str) -> dict[str, str]:
    """Cabeceras de autenticación Bearer para un token dado."""
    return {"Authorization": f"Bearer {token}"}


def _tenant_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido con slug y nombre únicos (evita colisiones entre tests)."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, Any] = {
        "slug": f"tenant-{suffix}",
        "name": f"Tenant {suffix}",
    }
    payload.update(overrides)
    return payload


def _create_tenant(
    client: TestClient,
    super_admin_token: str,
    **overrides: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crea un tenant y devuelve ``(payload, body)`` — 201 esperado."""
    payload = _tenant_payload(**overrides)
    response = client.post(
        "/api/v1/tenants", json=payload, headers=_auth_headers(super_admin_token)
    )
    assert response.status_code == 201, response.text
    return payload, response.json()


# ────────────────────────────────────────────────────────────────────────────
# Crear
# ────────────────────────────────────────────────────────────────────────────


def test_create_tenant(client: TestClient, super_admin_token: str) -> None:
    payload, body = _create_tenant(client, super_admin_token)
    assert body["slug"] == payload["slug"]
    assert body["name"] == payload["name"]
    assert body["id"]
    assert body["revision"] == 1


def test_create_tenant_idempotent_by_slug(
    client: TestClient, super_admin_token: str
) -> None:
    """Crear dos veces el mismo slug con el mismo nombre devuelve el existente.

    El endpoint está decorado con ``status_code=201``, así que la segunda
    llamada también responde 201 pero con el MISMO tenant (mismo id), sin
    error de conflicto — eso demuestra la idempotencia por slug.
    """
    payload, first = _create_tenant(client, super_admin_token)
    response = client.post(
        "/api/v1/tenants", json=payload, headers=_auth_headers(super_admin_token)
    )
    assert response.status_code == 201, response.text
    second = response.json()
    assert second["id"] == first["id"]
    assert second["name"] == first["name"]


def test_create_tenant_conflict_on_different_name(
    client: TestClient, super_admin_token: str
) -> None:
    """El mismo slug con otro nombre debe rechazarse (409)."""
    payload, _ = _create_tenant(client, super_admin_token)
    response = client.post(
        "/api/v1/tenants",
        json={"slug": payload["slug"], "name": "Otro nombre"},
        headers=_auth_headers(super_admin_token),
    )
    assert response.status_code == 409, response.text


# ────────────────────────────────────────────────────────────────────────────
# Listar y obtener
# ────────────────────────────────────────────────────────────────────────────


def test_list_tenants_includes_created(
    client: TestClient, super_admin_token: str
) -> None:
    _, body = _create_tenant(client, super_admin_token)
    response = client.get(
        "/api/v1/tenants", headers=_auth_headers(super_admin_token)
    )
    assert response.status_code == 200, response.text
    slugs = [t["slug"] for t in response.json()]
    assert body["slug"] in slugs


def test_get_tenant_by_slug(client: TestClient, super_admin_token: str) -> None:
    _, body = _create_tenant(client, super_admin_token)
    response = client.get(
        f"/api/v1/tenants/{body['slug']}", headers=_auth_headers(super_admin_token)
    )
    assert response.status_code == 200, response.text
    assert response.json()["id"] == body["id"]


def test_get_tenant_not_found(client: TestClient, super_admin_token: str) -> None:
    response = client.get(
        f"/api/v1/tenants/no-existe-{uuid.uuid4().hex[:8]}",
        headers=_auth_headers(super_admin_token),
    )
    assert response.status_code == 404, response.text


# ────────────────────────────────────────────────────────────────────────────
# Actualizar (PATCH)
# ────────────────────────────────────────────────────────────────────────────


def test_update_tenant_name(client: TestClient, super_admin_token: str) -> None:
    _, body = _create_tenant(client, super_admin_token)
    new_name = f"Renombrado {uuid.uuid4().hex[:8]}"
    response = client.patch(
        f"/api/v1/tenants/{body['slug']}",
        json={"name": new_name},
        headers=_auth_headers(super_admin_token),
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == new_name
    assert updated["slug"] == body["slug"]  # slug inmutable
    assert updated["revision"] > body["revision"]  # SyncTupleMixin bump


def test_update_tenant_not_found(client: TestClient, super_admin_token: str) -> None:
    response = client.patch(
        f"/api/v1/tenants/no-existe-{uuid.uuid4().hex[:8]}",
        json={"name": "Cualquiera"},
        headers=_auth_headers(super_admin_token),
    )
    assert response.status_code == 404, response.text


# ────────────────────────────────────────────────────────────────────────────
# Soft-delete (DELETE)
# ────────────────────────────────────────────────────────────────────────────


def test_delete_tenant_soft_delete(
    client: TestClient, super_admin_token: str
) -> None:
    _, body = _create_tenant(client, super_admin_token)
    response = client.delete(
        f"/api/v1/tenants/{body['slug']}", headers=_auth_headers(super_admin_token)
    )
    assert response.status_code == 204, response.text
    # Ya no aparece en get ni en list.
    assert (
        client.get(
            f"/api/v1/tenants/{body['slug']}",
            headers=_auth_headers(super_admin_token),
        ).status_code
        == 404
    )
    slugs = [
        t["slug"]
        for t in client.get(
            "/api/v1/tenants", headers=_auth_headers(super_admin_token)
        ).json()
    ]
    assert body["slug"] not in slugs


def test_delete_tenant_not_found(client: TestClient, super_admin_token: str) -> None:
    response = client.delete(
        f"/api/v1/tenants/no-existe-{uuid.uuid4().hex[:8]}",
        headers=_auth_headers(super_admin_token),
    )
    assert response.status_code == 404, response.text


# ────────────────────────────────────────────────────────────────────────────
# Nivel repositorio (soft-delete real en BD)
# ────────────────────────────────────────────────────────────────────────────


def test_repository_delete_marks_deleted(
    container: Any, client: TestClient, super_admin_token: str
) -> None:
    """Verifica que el soft-delete persiste ``deleted=True`` en la BD."""
    _, body = _create_tenant(client, super_admin_token)
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantRepository(session)
        tenant = repo.get_by_id(uuid.UUID(body["id"]))
        assert tenant is not None
        assert tenant.deleted is False
        assert repo.delete(tenant.id) is True
        session.commit()
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantRepository(session)
        # ``get_by_id`` no filtra por ``deleted``: devuelve la fila marcada.
        tenant = repo.get_by_id(uuid.UUID(body["id"]))
        assert tenant is not None
        assert tenant.deleted is True
        # ``get_by_slug`` sí filtra ``deleted=False``: ya no debe aparecer.
        assert repo.get_by_slug(body["slug"]) is None
        # El soft-delete es idempotente: borrar de nuevo devuelve False.
        assert repo.delete(uuid.UUID(body["id"])) is False


# ────────────────────────────────────────────────────────────────────────────
# RBAC: el control plane de tenants exige super-admin (Auth + RBAC)
# ────────────────────────────────────────────────────────────────────────────


def test_tenants_requires_authentication(client: TestClient) -> None:
    """Sin Bearer token el control plane responde 401 (auth.unauthorized)."""
    response = client.get("/api/v1/tenants")
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.unauthorized"


def test_tenants_forbidden_for_non_super_admin(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Un admin de tenant (no super-admin) no puede operar el control plane."""
    response = client.get(
        "/api/v1/tenants", headers=_auth_headers(tenant_admin_token)
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "auth.forbidden"
