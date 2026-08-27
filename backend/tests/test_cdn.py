"""Tests de los endpoints de despliegue al CDN (Fase 10)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from app.models.cdn_deployment import CdnDeployment
from app.repositories.sqlalchemy_repositories import SqlAlchemyLandingRepository


@pytest.fixture(autouse=True)
def _clean_cdn_deployments(container) -> None:
    """Cada test parte de una tabla de despliegues vacía (los insert vía HTTP commit).

    El cliente HTTP (session-scoped) commitea los despliegues a la base temporal
    compartida y ``db_session`` también hace commit al finalizar; sin limpiar,
    las aserciones de versión incremental (v1, v2, ...) fallarían por acumulación.
    """
    with container.database.session_scope() as session:
        session.execute(delete(CdnDeployment))
        session.commit()
    yield


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _seed_landing(db_session, tenant_id: uuid.UUID, *, name: str = "Landing CDN"):
    repo = SqlAlchemyLandingRepository(db_session)
    landing = repo.create(
        tenant_id=tenant_id,
        campaign_id=uuid.uuid4(),
        name=name,
        config={"title": name, "blocks": []},
    )
    db_session.commit()
    return landing


class TestDeployLanding:
    def test_deploy_returns_201_with_versioned_url(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["landing_id"] == str(landing.id)
        assert body["version"] == 1
        assert body["status"] == "deployed"
        assert body["url"] == f"http://localhost:8000/cdn/{landing.id}/v1"
        assert "deployed_at" in body
        assert "created_at" in body

    def test_deploy_increments_version_on_second_deploy(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        first = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert first.status_code == 201
        assert first.json()["version"] == 1

        second = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert second.status_code == 201
        body = second.json()
        assert body["version"] == 2
        assert body["url"] == f"http://localhost:8000/cdn/{landing.id}/v2"

    def test_deploy_landing_not_found_returns_404(self, client, tenant_id):
        missing = uuid.uuid4()
        response = client.post(
            f"/api/v1/cdn/deploy/{missing}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404

    def test_deploy_landing_of_other_tenant_returns_404(self, client, tenant_id, db_session):
        other_tenant = uuid.uuid4()
        landing = _seed_landing(db_session, other_tenant)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404

    def test_deploy_audits_operation(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        audit_response = client.get(
            "/api/v1/audit?operation=cdn.deploy&page_size=100",
            headers=_tenant_headers(tenant_id),
        )
        assert audit_response.status_code == 200
        assert audit_response.json()["total"] >= 1

    def test_missing_tenant_header_is_forbidden(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(f"/api/v1/cdn/deploy/{landing.id}")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "tenant.isolation_violation"
