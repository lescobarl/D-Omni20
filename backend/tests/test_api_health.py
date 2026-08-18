"""Tests del endpoint de salud (liveness/readiness, sin tenant requerido)."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    """El endpoint /health reporta estado ok, versión y conectividad de la DB."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200

    body: dict[str, Any] = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "up"
    assert body["app_name"] == "OmniBotIA Studio API"
    assert body["app_version"] == "0.2.0"
    assert body["backend_env"] == "development"
    assert "time" in body


def test_health_does_not_require_tenant(client: TestClient) -> None:
    """El health check funciona sin cabecera X-Tenant-Id (no está acotado por tenant)."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
