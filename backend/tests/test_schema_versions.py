"""Tests de los endpoints de versionado de JSON Schemas (Fase 7).

Los schemas se siembran directamente contra la base compartida y se confirman
(``commit``) para que el cliente HTTP — que usa su propio contenedor sobre el
mismo archivo SQLite — pueda verlos.
"""

from __future__ import annotations

import uuid

from app.repositories.sqlalchemy_repositories import SqlAlchemySchemaRepository

BASE_SCHEMA_JSON = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {"name": {"type": "string"}},
}


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _seed_schema(
    db_session,
    tenant_id: uuid.UUID,
    *,
    name: str = "Schema base",
    version: str = "1.0.0",
    schema_json: dict | None = None,
):
    """Crea un DeveloperSchema persistido y visible para el cliente HTTP."""
    repo = SqlAlchemySchemaRepository(db_session)
    schema = repo.save(
        tenant_id=tenant_id,
        name=name,
        schema_json=schema_json or BASE_SCHEMA_JSON,
        version=version,
    )
    db_session.commit()
    return schema


class TestCreateSchemaVersion:
    def test_create_version_bumps_schema_and_returns_201(
        self, client, tenant_id, db_session
    ):
        schema = _seed_schema(db_session, tenant_id)
        payload = {"version": "1.1.0", "change_note": "Añade campo opcional"}

        response = client.post(
            f"/api/v1/schemas/{schema.id}/versions",
            json=payload,
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["schema_id"] == str(schema.id)
        assert body["tenant_id"] == str(tenant_id)
        assert body["version"] == "1.1.0"
        assert body["change_note"] == "Añade campo opcional"
        assert body["schema_json"]["type"] == "object"
        assert body["created_at"]

        # El schema padre se marcó con la nueva versión (bump semántico).
        # Con ``expire_on_commit=False`` el objeto del identity map conserva el
        # valor en memoria; expiramos antes de releer para ver el dato persistido.
        db_session.expire(schema)
        repo = SqlAlchemySchemaRepository(db_session)
        reloaded = repo.get(tenant_id=tenant_id, schema_id=schema.id)
        assert reloaded is not None
        assert reloaded.version == "1.1.0"

    def test_create_version_snapshots_current_schema_when_omitted(
        self, client, tenant_id, db_session
    ):
        schema = _seed_schema(db_session, tenant_id, version="2.0.0")
        response = client.post(
            f"/api/v1/schemas/{schema.id}/versions",
            json={"version": "2.0.1"},
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["schema_json"]["properties"]["name"]["type"] == "string"

    def test_create_version_with_explicit_schema_json_overrides_snapshot(
        self, client, tenant_id, db_session
    ):
        schema = _seed_schema(db_session, tenant_id)
        custom = {"$schema": BASE_SCHEMA_JSON["$schema"], "type": "array"}
        response = client.post(
            f"/api/v1/schemas/{schema.id}/versions",
            json={"version": "1.2.0", "schema_json": custom},
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["schema_json"]["type"] == "array"
        assert "properties" not in body["schema_json"]

    def test_create_version_for_missing_schema_returns_404(self, client, tenant_id):
        response = client.post(
            f"/api/v1/schemas/{uuid.uuid4()}/versions",
            json={"version": "1.0.0"},
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "resource.not_found"

    def test_create_version_for_other_tenant_schema_returns_404(
        self, client, tenant_id, db_session
    ):
        other_tenant = uuid.uuid4()
        schema = _seed_schema(db_session, other_tenant, name="Schema ajeno")
        response = client.post(
            f"/api/v1/schemas/{schema.id}/versions",
            json={"version": "1.0.0"},
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404

    def test_rejects_extra_fields(self, client, tenant_id, db_session):
        schema = _seed_schema(db_session, tenant_id)
        response = client.post(
            f"/api/v1/schemas/{schema.id}/versions",
            json={"version": "1.0.0", "unexpected": True},
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 422

    def test_missing_tenant_header_is_forbidden(self, client, tenant_id, db_session):
        schema = _seed_schema(db_session, tenant_id)
        response = client.post(
            f"/api/v1/schemas/{schema.id}/versions",
            json={"version": "1.0.0"},
        )
        assert response.status_code == 403


class TestListSchemaVersions:
    def test_list_versions_returns_paginated_page(self, client, tenant_id, db_session):
        schema = _seed_schema(db_session, tenant_id, version="1.0.0")
        for tag in ("1.1.0", "1.2.0"):
            client.post(
                f"/api/v1/schemas/{schema.id}/versions",
                json={"version": tag},
                headers=_tenant_headers(tenant_id),
            )

        response = client.get(
            f"/api/v1/schemas/{schema.id}/versions",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["page"] == 1
        assert body["page_size"] == 20
        assert body["total"] == 2
        assert len(body["items"]) == 2
        # Orden descendente por fecha de creación: la más reciente primero.
        assert body["items"][0]["version"] == "1.2.0"
        assert body["items"][1]["version"] == "1.1.0"

    def test_list_versions_respects_pagination(self, client, tenant_id, db_session):
        schema = _seed_schema(db_session, tenant_id, version="1.0.0")
        for tag in ("1.1.0", "1.2.0"):
            client.post(
                f"/api/v1/schemas/{schema.id}/versions",
                json={"version": tag},
                headers=_tenant_headers(tenant_id),
            )

        response = client.get(
            f"/api/v1/schemas/{schema.id}/versions?page=2&page_size=1",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["page"] == 2
        assert body["page_size"] == 1
        assert body["total"] == 2
        assert len(body["items"]) == 1
        assert body["items"][0]["version"] == "1.1.0"

    def test_list_versions_for_missing_schema_returns_404(self, client, tenant_id):
        response = client.get(
            f"/api/v1/schemas/{uuid.uuid4()}/versions",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "resource.not_found"

    def test_list_versions_for_other_tenant_schema_returns_404(
        self, client, tenant_id, db_session
    ):
        other_tenant = uuid.uuid4()
        schema = _seed_schema(db_session, other_tenant, name="Schema ajeno")
        response = client.get(
            f"/api/v1/schemas/{schema.id}/versions",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404

    def test_missing_tenant_header_is_forbidden(self, client, tenant_id, db_session):
        schema = _seed_schema(db_session, tenant_id)
        response = client.get(f"/api/v1/schemas/{schema.id}/versions")
        assert response.status_code == 403
