"""Tests del feature "Dominios personalizados" (PSEO hosts).

Cubre:
- Registro de dominio → estado ``pending`` con ``verify_token`` para el TXT.
- Duplicados globales (mismo host, mismo/otro tenant) → 409 sin violar la
  ``UniqueConstraint`` de ``pseo_hosts.host``.
- Validación de formato de host → 422.
- Verificación DNS (``dns_verify_mode="auto"``) → ``active`` + ``verified_at``.
- Aislamiento por tenant (RLS): listar/verificar/eliminar hosts ajenos → 404.
- Baja (soft-delete) + re-registro → re-activación en ``pending`` (nuevo token).
- Fail-closed del serving público: hosts ``pending`` NO resuelven tenant (404);
  un dominio personalizado ``active`` sirve páginas y alimenta el canonical.
- Seed de desarrollo: el host derivado de ``cdn_base_url`` queda ``active``.
"""

from __future__ import annotations

import uuid

import pytest
from app.models.landing import TenantLanding
from app.models.pseo_host import PseoHost
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyLandingRepository,
    SqlAlchemyPseoHostRepository,
    SqlAlchemyTenantRepository,
)
from sqlalchemy import delete, select

_DEV_HOST = "localhost:8000"
_CUSTOM_HOST = "portal.example.com"
_CUSTOM_HOST_2 = "landing.miempresa.com.mx"
_NOT_FOUND_CODE = "resource.not_found"


@pytest.fixture(autouse=True)
def _clean_pseo_hosts(container, tenant_id, test_settings) -> None:
    """Cada test parte de ``pseo_hosts`` vacío y con el host de desarrollo activo.

    El cliente HTTP (session-scoped) y el lifespan de la app corren una sola
    vez por sesión; sin re-sembrar, el estado acumulado de otros tests haría
    frágiles las aserciones (hosts duplicados/borrados).
    """
    with container.database.session_scope() as session:
        session.execute(delete(TenantLanding))
        session.execute(delete(PseoHost))
        SqlAlchemyPseoHostRepository(session).upsert(tenant_id=tenant_id, host=_DEV_HOST)
        session.commit()
    yield


_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    """Los endpoints de gestión (pseo/hosts) requieren RBAC.

    Se usa el token de super-admin porque varios tests operan sobre tenants
    desechables (sin membresía) además del tenant de desarrollo; el super-admin
    atraviesa la comprobación de membresía para cualquier tenant.
    """
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id), **_AUTH}


def _host_headers(host: str) -> dict[str, str]:
    return {"Host": host}


def _second_tenant(db_session) -> uuid.UUID:
    """Crea (y devuelve el id de) un tenant secundario con slug único."""
    slug = f"other-{uuid.uuid4().hex[:10]}"
    repo = SqlAlchemyTenantRepository(db_session)
    tenant = repo.create(slug=slug, name="Tenant Secundario")
    db_session.commit()
    return tenant.id


def _request_host(client, tenant_id: uuid.UUID, host: str):
    return client.post(
        "/api/v1/pseo/hosts", headers=_tenant_headers(tenant_id), json={"host": host}
    )


def _verify_host(client, tenant_id: uuid.UUID, host_id: str):
    return client.post(
        f"/api/v1/pseo/hosts/{host_id}/verify", headers=_tenant_headers(tenant_id)
    )


def _seed_landing(db_session, tenant_id: uuid.UUID):
    repo = SqlAlchemyLandingRepository(db_session)
    landing = repo.create(
        tenant_id=tenant_id,
        campaign_id=uuid.uuid4(),
        slug="landing-dominio-propio",
        name="Landing Dominio Propio",
        config={"title": "Landing", "blocks": []},
    )
    db_session.commit()
    return landing


def _post_matrix(client, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> None:
    payload = {
        "template_config": {
            "title": "{{ service_name }} en {{ city }}",
            "workflowType": "lead_capture",
            "blocks": [
                {
                    "type": "hero",
                    "config": {
                        "title": "{{ service_name }} en {{ city }}",
                        "subtitle": "{{ city }} — {{ offer_price }}",
                    },
                }
            ],
        },
        "rows": [
            {
                "city": "guadalajara",
                "service_slug": "plomeria",
                "service_name": "Plomería 24h",
                "offer_price": "1500",
            }
        ],
        "compile": True,
    }
    return client.post(
        f"/api/v1/generator/matrix-upload/{campaign_id}",
        headers=_tenant_headers(tenant_id),
        json=payload,
    )


class TestRequestHost:
    def test_request_creates_pending_host(self, client, tenant_id):
        response = _request_host(client, tenant_id, _CUSTOM_HOST)
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "pending"
        assert body["host"] == _CUSTOM_HOST
        assert body["tenant_id"] == str(tenant_id)
        assert body["verify_token"]
        assert body["deleted"] is False
        assert body["verified_at"] is None

    def test_request_normalizes_host(self, client, tenant_id):
        response = _request_host(client, tenant_id, "  HTTPS://Portal.Example.com/ ")
        assert response.status_code == 201
        assert response.json()["host"] == _CUSTOM_HOST

    def test_request_duplicate_same_tenant_409(self, client, tenant_id):
        assert _request_host(client, tenant_id, _CUSTOM_HOST).status_code == 201
        duplicate = _request_host(client, tenant_id, _CUSTOM_HOST)
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["operation"] == "pseo_hosts.request"

    def test_request_duplicate_other_tenant_409(self, client, tenant_id, db_session):
        other = _second_tenant(db_session)
        assert _request_host(client, tenant_id, _CUSTOM_HOST).status_code == 201
        duplicate = _request_host(client, other, _CUSTOM_HOST)
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["operation"] == "pseo_hosts.request"

    def test_request_invalid_host_422(self, client, tenant_id):
        for bad in ("not a host!", "http://", "solo-esquema://", "-starts-dash.com"):
            response = _request_host(client, tenant_id, bad)
            assert response.status_code == 422, bad

    def test_request_empty_host_422(self, client, tenant_id):
        assert _request_host(client, tenant_id, "").status_code == 422


class TestVerifyHost:
    def test_verify_pending_becomes_active(self, client, tenant_id):
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        assert created.status_code == 201
        body = created.json()

        verified = _verify_host(client, tenant_id, body["id"])
        assert verified.status_code == 200
        result = verified.json()
        assert result["status"] == "active"
        assert result["verified_at"] is not None

    def test_verify_already_active_is_idempotent(self, client, tenant_id):
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        host_id = created.json()["id"]
        assert _verify_host(client, tenant_id, host_id).status_code == 200
        second = _verify_host(client, tenant_id, host_id)
        assert second.status_code == 200
        assert second.json()["status"] == "active"

    def test_verify_missing_host_404(self, client, tenant_id):
        response = _verify_host(client, tenant_id, str(uuid.uuid4()))
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE

    def test_verify_other_tenant_host_404(self, client, tenant_id, db_session):
        other = _second_tenant(db_session)
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        host_id = created.json()["id"]

        response = _verify_host(client, other, host_id)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE


class TestListAndRemove:
    def test_list_only_own_tenant(self, client, tenant_id, db_session):
        other = _second_tenant(db_session)
        assert _request_host(client, tenant_id, _CUSTOM_HOST).status_code == 201
        assert _request_host(client, tenant_id, _CUSTOM_HOST_2).status_code == 201
        assert _request_host(client, other, "otro-ejemplo.com").status_code == 201

        response = client.get("/api/v1/pseo/hosts", headers=_tenant_headers(tenant_id))
        assert response.status_code == 200
        hosts = response.json()
        # El host de desarrollo (sembrado por el fixture autouse) también
        # pertenece al tenant; el del tenant secundario NO debe aparecer.
        assert {h["host"] for h in hosts} == {
            _DEV_HOST,
            _CUSTOM_HOST,
            _CUSTOM_HOST_2,
        }
        assert all(h["deleted"] is False for h in hosts)

    def test_remove_soft_deletes(self, client, container, tenant_id):
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        host_id = created.json()["id"]

        removed = client.delete(
            f"/api/v1/pseo/hosts/{host_id}", headers=_tenant_headers(tenant_id)
        )
        assert removed.status_code == 204

        listing = client.get("/api/v1/pseo/hosts", headers=_tenant_headers(tenant_id))
        assert listing.status_code == 200
        remaining = listing.json()
        # Solo queda el host de desarrollo sembrado; el dominio personalizado
        # eliminado ya no se lista (soft-delete filtra por ``deleted is False``).
        assert {h["host"] for h in remaining} == {_DEV_HOST}

        with container.database.session_scope() as session:
            row = session.scalar(
                select(PseoHost).where(PseoHost.id == uuid.UUID(host_id))
            )
            assert row is not None
            assert row.deleted is True

    def test_remove_other_tenant_host_404(self, client, tenant_id, db_session):
        other = _second_tenant(db_session)
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        host_id = created.json()["id"]

        response = client.delete(
            f"/api/v1/pseo/hosts/{host_id}", headers=_tenant_headers(other)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE

    def test_remove_missing_host_404(self, client, tenant_id):
        response = client.delete(
            f"/api/v1/pseo/hosts/{uuid.uuid4()}", headers=_tenant_headers(tenant_id)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE

    def test_remove_and_requeue_reactivates_pending(self, client, container, tenant_id):
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        original = created.json()
        assert original["verify_token"]
        assert (
            client.delete(
                f"/api/v1/pseo/hosts/{original['id']}",
                headers=_tenant_headers(tenant_id),
            ).status_code
            == 204
        )

        # Re-registrar el mismo dominio NO debe violar uq_pseo_host_host: la
        # fila soft-deleted se re-activa en pending con un token nuevo.
        again = _request_host(client, tenant_id, _CUSTOM_HOST)
        assert again.status_code == 201
        reactivated = again.json()
        assert reactivated["id"] == original["id"]
        assert reactivated["status"] == "pending"
        assert reactivated["verify_token"] != original["verify_token"]
        assert reactivated["deleted"] is False


class TestPublicServingGuard:
    def test_pending_host_not_served_404(self, client, tenant_id):
        assert _request_host(client, tenant_id, _CUSTOM_HOST).status_code == 201

        response = client.get(
            "/pseo/guadalajara/plomeria", headers=_host_headers(_CUSTOM_HOST)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE
        assert response.json()["error"]["operation"] == "pseo.host.resolve"

    def test_active_custom_host_serves_and_feeds_canonical(
        self, client, container, tenant_id, db_session
    ):
        landing = _seed_landing(db_session, tenant_id)

        # Quitar el host de desarrollo para que solo el dominio personalizado
        # activo participe en el canonical.
        with container.database.session_scope() as session:
            repo = SqlAlchemyPseoHostRepository(session)
            dev_host = repo.get_by_tenant(tenant_id=tenant_id)
            assert dev_host is not None
            assert repo.soft_delete(tenant_id=tenant_id, host_id=dev_host.id)
            session.commit()

        # Registrar + verificar el dominio propio → active.
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        assert created.status_code == 201
        verified = _verify_host(client, tenant_id, created.json()["id"])
        assert verified.status_code == 200
        assert verified.json()["status"] == "active"

        # Persistir la matriz: el canonical queda con el dominio activo.
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        # Servir por el dominio personalizado.
        response = client.get(
            "/pseo/guadalajara/plomeria", headers=_host_headers(_CUSTOM_HOST)
        )
        assert response.status_code == 200
        assert "Plomería 24h" in response.text
        assert (
            f'<link rel="canonical" href="http://{_CUSTOM_HOST}/guadalajara/plomeria">'
            in response.text
        )


class TestRepoIsolation:
    def test_dev_seeded_host_is_active(self, container, tenant_id):
        with container.database.session_scope() as session:
            row = SqlAlchemyPseoHostRepository(session).get_by_tenant(tenant_id=tenant_id)
            assert row is not None
            assert row.status == "active"
            assert row.deleted is False

    def test_cross_tenant_access_denied(self, client, container, tenant_id, db_session):
        other = _second_tenant(db_session)
        created = _request_host(client, tenant_id, _CUSTOM_HOST)
        host_id = created.json()["id"]

        with container.database.session_scope() as session:
            repo = SqlAlchemyPseoHostRepository(session)
            # get_by_id está acotado al tenant → otro tenant no lo ve.
            assert repo.get_by_id(tenant_id=other, host_id=uuid.UUID(host_id)) is None
            # get_by_tenant (un host por tenant) → None para el ajeno.
            assert repo.get_by_tenant(tenant_id=other) is None
            # list_by_tenant → [] para el ajeno.
            assert repo.list_by_tenant(tenant_id=other) == []
