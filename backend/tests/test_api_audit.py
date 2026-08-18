"""Tests del endpoint de consulta del log de auditoría (solo lectura, por tenant)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi.testclient import TestClient

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}


def _create_landing(client: TestClient, name: str = "Landing auditable") -> None:
    """Crea una landing vía API; registra auditoría landing.create + http.post."""
    response = client.post(
        "/api/v1/designer",
        json={
            "campaign_id": str(uuid.uuid4()),
            "name": name,
            "config": {"title": "Audit", "blocks": []},
        },
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201, response.text


def test_audit_log_records_landing_create(client: TestClient) -> None:
    """El log de auditoría refleja la operación landing.create del tenant."""
    _create_landing(client)

    response = client.get(
        "/api/v1/audit?page_size=100", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    assert body["total"] >= 1
    assert any(item["operation"] == "landing.create" for item in body["items"])


def test_audit_log_filter_by_operation(client: TestClient) -> None:
    """El filtro ?operation= restringe las entradas devueltas."""
    _create_landing(client, name="Filtrable")

    response = client.get(
        "/api/v1/audit?operation=landing.create&page_size=100",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert all(item["operation"] == "landing.create" for item in body["items"])


def test_audit_log_missing_tenant_returns_403(client: TestClient) -> None:
    """Sin cabecera X-Tenant-Id el acceso al log se deniega (403)."""
    response = client.get("/api/v1/audit")
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"
