"""Tests de los endpoints del marketplace de templates (Fase 8)."""

from __future__ import annotations

import uuid

import pytest

from app.repositories.sqlalchemy_repositories import SqlAlchemyMarketplaceRepository


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _seed_template(
    db_session,
    tenant_id: uuid.UUID,
    *,
    name: str = "Template Base",
    category: str = "servicios",
    config: dict | None = None,
    is_public: bool = True,
):
    repo = SqlAlchemyMarketplaceRepository(db_session)
    template = repo.create(
        tenant_id=tenant_id,
        name=name,
        description="Plantilla de ejemplo",
        category=category,
        config=config or {"blocks": [{"type": "hero", "title": name}]},
        thumbnail_url=None,
        is_public=is_public,
    )
    db_session.commit()
    return template


class TestCreateTemplate:
    def test_create_template_returns_201(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
            json={
                "name": "Landing Servicios",
                "category": "servicios",
                "config": {"blocks": [{"type": "hero"}]},
                "is_public": True,
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Landing Servicios"
        assert body["category"] == "servicios"
        assert body["is_public"] is True
        assert body["downloads"] == 0
        assert body["tenant_id"] == str(tenant_id)
        assert "created_at" in body

    def test_create_template_defaults_public(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
            json={
                "name": "Landing Privada",
                "category": "servicios",
                "config": {},
            },
        )
        assert response.status_code == 201
        assert response.json()["is_public"] is True

    def test_create_template_rejects_extra_fields(self, client, tenant_id, db_session):
        response = client.post(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
            json={
                "name": "X",
                "category": "servicios",
                "config": {},
                "otro_campo": True,
            },
        )
        assert response.status_code == 422

    def test_missing_tenant_header_is_forbidden(self, client):
        response = client.post(
            "/api/v1/marketplace/templates",
            json={"name": "X", "category": "servicios", "config": {}},
        )
        assert response.status_code == 403


class TestListTemplates:
    def test_list_returns_paginated_page(self, client, tenant_id, db_session):
        _seed_template(db_session, tenant_id)
        response = client.get(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] >= 1
        assert body["page"] == 1
        assert body["page_size"] == 20
        assert any(item["name"] == "Template Base" for item in body["items"])

    def test_list_respects_pagination(self, client, tenant_id, db_session):
        for index in range(3):
            _seed_template(db_session, tenant_id, name=f"Template {index}")
        response = client.get(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
            params={"page": 1, "page_size": 2},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert len(body["items"]) == 2
        assert body["total"] >= 3

    def test_list_filters_by_category(self, client, tenant_id, db_session):
        _seed_template(db_session, tenant_id, name="Servicios", category="servicios")
        _seed_template(db_session, tenant_id, name="Tienda", category="ecommerce")
        response = client.get(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
            params={"category": "servicios"},
        )
        assert response.status_code == 200
        body = response.json()
        assert all(item["category"] == "servicios" for item in body["items"])
        assert any(item["name"] == "Servicios" for item in body["items"])

    def test_list_does_not_expose_private_templates_of_other_tenants(
        self, client, tenant_id, db_session
    ):
        other_tenant = uuid.uuid4()
        _seed_template(db_session, other_tenant, name="Privado", is_public=False)
        response = client.get(
            "/api/v1/marketplace/templates",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 200
        body = response.json()
        assert all(item["name"] != "Privado" for item in body["items"])

    def test_missing_tenant_header_is_forbidden(self, client):
        response = client.get("/api/v1/marketplace/templates")
        assert response.status_code == 403


class TestImportTemplate:
    def test_import_creates_landing_and_increments_downloads(
        self, client, tenant_id, db_session
    ):
        template = _seed_template(db_session, tenant_id)
        response = client.post(
            f"/api/v1/marketplace/templates/{template.id}/import",
            headers=_tenant_headers(tenant_id),
            json={"campaign_id": str(uuid.uuid4())},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["template"]["id"] == str(template.id)
        assert body["template"]["downloads"] == 1
        assert body["landing_id"]

    def test_import_uses_payload_name_when_provided(self, client, tenant_id, db_session):
        template = _seed_template(db_session, tenant_id)
        response = client.post(
            f"/api/v1/marketplace/templates/{template.id}/import",
            headers=_tenant_headers(tenant_id),
            json={
                "campaign_id": str(uuid.uuid4()),
                "name": "Mi landing importada",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["template"]["name"] == "Template Base"

    def test_import_missing_template_returns_404(self, client, tenant_id, db_session):
        response = client.post(
            f"/api/v1/marketplace/templates/{uuid.uuid4()}/import",
            headers=_tenant_headers(tenant_id),
            json={"campaign_id": str(uuid.uuid4())},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "resource.not_found"

    def test_import_private_template_of_other_tenant_returns_404(
        self, client, tenant_id, db_session
    ):
        other_tenant = uuid.uuid4()
        template = _seed_template(
            db_session, other_tenant, name="Privado", is_public=False
        )
        response = client.post(
            f"/api/v1/marketplace/templates/{template.id}/import",
            headers=_tenant_headers(tenant_id),
            json={"campaign_id": str(uuid.uuid4())},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "resource.not_found"

    def test_import_requires_campaign_id(self, client, tenant_id, db_session):
        template = _seed_template(db_session, tenant_id)
        response = client.post(
            f"/api/v1/marketplace/templates/{template.id}/import",
            headers=_tenant_headers(tenant_id),
            json={},
        )
        assert response.status_code == 422

    def test_missing_tenant_header_is_forbidden(self, client, tenant_id, db_session):
        template = _seed_template(db_session, tenant_id)
        response = client.post(
            f"/api/v1/marketplace/templates/{template.id}/import",
            json={"campaign_id": str(uuid.uuid4())},
        )
        assert response.status_code == 403
