"""Pruebas del asistente de marca (POST /tenant/appearance/generate).

El endpoint delega en el puerto IA (DeepSeek) y devuelve una
``AppearanceProposal`` validada sin persistir. Solo admin/configurador del
tenant activo pueden usarlo (RBAC, misma regla que el resto de apariencia).
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi.testclient import TestClient

from app.api.deps import get_ai_service
from app.services.interfaces import AiGenerationResult

TENANT_HEADERS = {"X-Tenant-Id": "dev-tenant"}


class _StubAiService:
    """Stub de :class:`IAiService` que devuelve una propuesta de apariencia fija."""

    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.calls: list[dict[str, Any]] = []

    def generate_landing(
        self, *, tenant_id: uuid.UUID, prompt: str, workflow_type: str | None, brand_voice: dict | None
    ) -> AiGenerationResult:
        raise NotImplementedError

    def generate_portal(
        self, *, tenant_id: uuid.UUID, prompt: str, brand_voice: dict[str, Any] | None
    ) -> AiGenerationResult:
        raise NotImplementedError

    def generate_appearance(
        self, *, tenant_id: uuid.UUID, prompt: str
    ) -> AiGenerationResult:
        self.calls.append({"tenant_id": tenant_id, "prompt": prompt})
        return AiGenerationResult(
            config=self.config,
            model="deepseek-chat",
            cached=False,
            prompt_tokens=10,
            completion_tokens=20,
        )


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", **TENANT_HEADERS}


def test_generate_appearance_delegates_in_ai_service(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Genera la propuesta, llama al motor IA con tenant+prompt y no persiste."""
    stub = _StubAiService(
        config={
            "primary_color": "#1f2937",
            "accent_color": "#4f46e5",
            "surface_color": "#ffffff",
            "text_color": "#0f172a",
            "brand_badge": "#111827",
            "logo_url": None,
            "font_family": "Inter",
            "detected_fonts": ["Inter", "Georgia"],
        }
    )
    client.app.dependency_overrides[get_ai_service] = lambda: stub
    try:
        response = client.post(
            "/api/v1/tenant/appearance/generate",
            json={"prompt": "Paleta sobria para una inmobiliaria de lujo"},
            headers=_auth(tenant_admin_token),
        )
    finally:
        client.app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 200
    body = response.json()
    assert body["primary_color"] == "#1f2937"
    assert body["accent_color"] == "#4f46e5"
    assert body["surface_color"] == "#ffffff"
    assert body["text_color"] == "#0f172a"
    assert body["brand_badge"] == "#111827"
    assert body["font_family"] == "Inter"
    assert body["detected_fonts"] == ["Inter", "Georgia"]
    assert len(stub.calls) == 1
    assert stub.calls[0]["prompt"] == "Paleta sobria para una inmobiliaria de lujo"
    assert isinstance(stub.calls[0]["tenant_id"], uuid.UUID)


def test_generate_appearance_rejects_empty_prompt(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Un prompt demasiado corto devuelve 422 (min_length=3)."""
    response = client.post(
        "/api/v1/tenant/appearance/generate",
        json={"prompt": "ab"},
        headers=_auth(tenant_admin_token),
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.request_error"


def test_generate_appearance_requires_tenant_header(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Sin la cabecera X-Tenant-Id el acceso se deniega (aislamiento multi-tenant)."""
    response = client.post(
        "/api/v1/tenant/appearance/generate",
        json={"prompt": "paleta para una cafetería artesanal"},
        headers={"Authorization": f"Bearer {tenant_admin_token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"
