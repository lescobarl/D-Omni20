"""Tests de los endpoints de analítica avanzada (Fase 9)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete

from app.models.analytics_event import AnalyticsEvent
from app.repositories.sqlalchemy_repositories import SqlAlchemyAnalyticsRepository


@pytest.fixture(autouse=True)
def _clean_analytics_events(container) -> None:
    """Cada test parte de una tabla de eventos vacía (los insert vía HTTP commit).

    El cliente HTTP (session-scoped) commitea los eventos a la base temporal
    compartida y ``db_session`` también hace commit al finalizar; sin limpiar,
    las aserciones de totales exactos del dashboard fallarían por acumulación.
    """
    with container.database.session_scope() as session:
        session.execute(delete(AnalyticsEvent))
        session.commit()
    yield


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _seed_event(
    db_session,
    tenant_id: uuid.UUID,
    *,
    event_type: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    properties: dict | None = None,
    occurred_at: datetime | None = None,
):
    repo = SqlAlchemyAnalyticsRepository(db_session)
    event = repo.record(
        tenant_id=tenant_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        properties=properties,
        occurred_at=occurred_at,
    )
    db_session.commit()
    return event


class TestRecordEvent:
    def test_record_event_returns_201(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/analytics/events",
            headers=_tenant_headers(tenant_id),
            json={
                "event_type": "landing.view",
                "entity_type": "tenant_landing",
                "entity_id": str(uuid.uuid4()),
                "properties": {"source": "email", "campaign": "verano"},
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["event_type"] == "landing.view"
        assert body["tenant_id"] == str(tenant_id)
        assert body["entity_type"] == "tenant_landing"
        assert body["properties"]["source"] == "email"
        assert "occurred_at" in body
        assert "created_at" in body

    def test_record_event_defaults_properties_and_occurred_at(
        self, client, tenant_id, db_session
    ):
        response = client.post(
            "/api/v1/analytics/events",
            headers=_tenant_headers(tenant_id),
            json={"event_type": "conversion"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["properties"] == {}
        assert "occurred_at" in body

    def test_record_event_rejects_extra_fields(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/analytics/events",
            headers=_tenant_headers(tenant_id),
            json={"event_type": "conversion", "otro_campo": True},
        )
        assert response.status_code == 422

    def test_record_event_rejects_empty_event_type(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/analytics/events",
            headers=_tenant_headers(tenant_id),
            json={"event_type": ""},
        )
        assert response.status_code == 422

    def test_record_event_audits_operation(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/analytics/events",
            headers=_tenant_headers(tenant_id),
            json={"event_type": "landing.view"},
        )
        assert response.status_code == 201
        audit_response = client.get(
            "/api/v1/audit?operation=analytics.event.record&page_size=100",
            headers=_tenant_headers(tenant_id),
        )
        assert audit_response.status_code == 200
        assert audit_response.json()["total"] >= 1

    def test_missing_tenant_header_is_forbidden(self, client):
        response = client.post(
            "/api/v1/analytics/events",
            json={"event_type": "landing.view"},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "tenant.isolation_violation"


class TestDashboard:
    def test_dashboard_empty_returns_zeros(self, client, tenant_id, db_session):
        response = client.get(
            "/api/v1/analytics/dashboard", headers=_tenant_headers(tenant_id)
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total_events"] == 0
        assert body["by_event_type"] == []
        assert body["recent"] == []

    def test_dashboard_aggregates_by_event_type(self, client, tenant_id, db_session):
        _seed_event(db_session, tenant_id, event_type="landing.view")
        _seed_event(db_session, tenant_id, event_type="landing.view")
        _seed_event(db_session, tenant_id, event_type="conversion")

        response = client.get(
            "/api/v1/analytics/dashboard", headers=_tenant_headers(tenant_id)
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total_events"] == 3
        counts = {item["event_type"]: item["count"] for item in body["by_event_type"]}
        assert counts["landing.view"] == 2
        assert counts["conversion"] == 1

    def test_dashboard_lists_recent_events_desc(self, client, tenant_id, db_session):
        now = datetime.now(timezone.utc)
        _seed_event(
            db_session, tenant_id, event_type="primero", occurred_at=now - timedelta(seconds=5)
        )
        _seed_event(
            db_session, tenant_id, event_type="segundo", occurred_at=now
        )

        response = client.get(
            "/api/v1/analytics/dashboard", headers=_tenant_headers(tenant_id)
        )
        assert response.status_code == 200
        recent = response.json()["recent"]
        assert [event["event_type"] for event in recent] == ["segundo", "primero"]

    def test_dashboard_isolates_other_tenant(self, client, tenant_id, db_session):
        other_tenant = uuid.uuid4()
        _seed_event(db_session, other_tenant, event_type="ajeno")

        response = client.get(
            "/api/v1/analytics/dashboard", headers=_tenant_headers(tenant_id)
        )
        assert response.status_code == 200
        assert response.json()["total_events"] == 0

    def test_dashboard_missing_tenant_header_is_forbidden(self, client):
        response = client.get("/api/v1/analytics/dashboard")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "tenant.isolation_violation"
