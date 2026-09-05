"""Tests del endpoint de validación de JSON Schemas (Fase 6)."""

from __future__ import annotations

import uuid

import pytest


_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id), **_AUTH}


class TestSchemaValidateEndpoint:
    def test_valid_schema_without_data_is_valid(self, client, tenant_id):
        payload = {
            "schema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            }
        }
        response = client.post("/api/v1/schemas/validate", json=payload, headers=_tenant_headers(tenant_id))
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is True
        assert body["errors"] == 0
        assert body["issues"] == []

    def test_invalid_schema_reports_schema_error(self, client, tenant_id):
        payload = {"schema": {"type": "object", "properties": "not-an-object"}}
        response = client.post("/api/v1/schemas/validate", json=payload, headers=_tenant_headers(tenant_id))
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is False
        assert body["errors"] == 1
        assert len(body["issues"]) == 1
        assert body["issues"][0]["path"] == "$"

    def test_data_against_schema_reports_issues(self, client, tenant_id):
        payload = {
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "age": {"type": "integer", "minimum": 0},
                },
                "required": ["name"],
            },
            "data": {"name": 42, "age": -3},
        }
        response = client.post("/api/v1/schemas/validate", json=payload, headers=_tenant_headers(tenant_id))
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is False
        assert body["errors"] == 2
        paths = {issue["path"] for issue in body["issues"]}
        assert paths == {"name", "age"}

    def test_valid_data_is_valid(self, client, tenant_id):
        payload = {
            "schema": {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
            "data": {"name": "Ana"},
        }
        response = client.post("/api/v1/schemas/validate", json=payload, headers=_tenant_headers(tenant_id))
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is True
        assert body["errors"] == 0

    def test_rejects_extra_fields(self, client, tenant_id):
        payload = {
            "schema": {"type": "object"},
            "data": {},
            "unexpected": True,
        }
        response = client.post("/api/v1/schemas/validate", json=payload, headers=_tenant_headers(tenant_id))
        assert response.status_code == 422

    def test_missing_tenant_header_is_forbidden(self, client, super_admin_token):
        payload = {"schema": {"type": "object"}}
        response = client.post(
            "/api/v1/schemas/validate",
            headers={"Authorization": f"Bearer {super_admin_token}"},
            json=payload,
        )
        assert response.status_code == 403


class TestSchemaValidatorService:
    def test_service_validates_schema_only(self, container):
        from app.services.schema_validator import SchemaValidatorService

        validator = SchemaValidatorService()
        result = validator.validate(schema={"type": "object"})
        assert result.valid is True
        assert result.errors == 0

    def test_service_collects_multiple_errors(self, container):
        from app.services.schema_validator import SchemaValidatorService

        validator = SchemaValidatorService()
        result = validator.validate(
            schema={"type": "object", "required": ["a", "b"]},
            data={},
        )
        assert result.valid is False
        assert result.errors == 2
