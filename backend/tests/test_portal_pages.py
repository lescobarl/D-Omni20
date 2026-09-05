"""Tests de los endpoints del configurador de páginas del Portal del Cliente.

Cubre el CRUD completo (listar, crear, obtener, actualizar, soft-delete),
la (des)publicación y la generación IA reutilizando el mismo motor que la
landing (UN configurador basado en IA generativa).

Prefijo ``/portal-pages`` (configurador) — no colisiona con ``/portal``
(API de autoservicio del Portal del Cliente, C-3).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_ai_service
from app.services.interfaces import AiGenerationResult

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"


def _payload(
    slug: str | None = None, title: str = "Página de prueba"
) -> dict[str, Any]:
    """Payload válido con slug fresco por defecto (evita colisiones entre tests)."""
    return {
        "slug": slug or f"pagina-{uuid.uuid4().hex[:8]}",
        "title": title,
        "blocks": {"title": "Página API", "blocks": []},
    }


def _create_page(
    client: TestClient, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = _payload(**overrides)
    response = client.post("/api/v1/portal-pages", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


class _StubAiService:
    """Stub de :class:`IAiService` que devuelve una página de portal fija."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def generate_portal(
        self, *, tenant_id: uuid.UUID, prompt: str, brand_voice: dict[str, Any] | None
    ) -> AiGenerationResult:
        self.calls.append(
            {"tenant_id": tenant_id, "prompt": prompt, "brand_voice": brand_voice}
        )
        return AiGenerationResult(
            config={
                "slug": "inicio",
                "title": "Página generada",
                "blocks": [{"type": "hero", "name": "Hero", "config": {}}],
            },
            model="deepseek-chat",
            cached=False,
            prompt_tokens=10,
            completion_tokens=20,
        )


def test_create_portal_page_returns_201(client: TestClient) -> None:
    """Crea una página del portal y devuelve la tupla sync inicial (revision == 1)."""
    payload, body = _create_page(client)
    assert body["slug"] == payload["slug"]
    assert body["title"] == payload["title"]
    assert body["revision"] == 1
    assert body["published"] is False
    assert body["published_at"] is None
    assert body["compiled_html"] is None
    assert body["id"]


def test_create_duplicate_slug_returns_409(client: TestClient) -> None:
    """Un mismo slug dentro del tenant genera conflicto (409)."""
    slug = f"duplicada-{uuid.uuid4().hex[:8]}"
    _create_page(client, slug=slug, title="Primera")

    response = client.post(
        "/api/v1/portal-pages",
        json=_payload(slug=slug, title="Duplicada"),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "portal_page.create"


def test_create_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id el acceso se deniega (aislamiento multi-tenant)."""
    response = client.post(
        "/api/v1/portal-pages",
        json=_payload(),
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"


def test_create_invalid_slug_returns_422(client: TestClient) -> None:
    """Un slug con caracteres inválidos devuelve 422 (patrón ``^[a-z0-9-]+$``)."""
    response = client.post(
        "/api/v1/portal-pages",
        json={"slug": "Con Mayúsculas!", "title": "Inválida"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.request_error"


def test_list_portal_pages_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye la página recién creada del tenant activo."""
    payload, created = _create_page(client, title="Listable")

    response = client.get("/api/v1/portal-pages", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body
    assert "total" in body
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])
    assert any(item["title"] == payload["title"] for item in body["items"])


def test_get_portal_page_roundtrip(client: TestClient) -> None:
    """GET por id devuelve la página creada (roundtrip)."""
    payload, created = _create_page(client, title="Roundtrip")

    response = client.get(
        f"/api/v1/portal-pages/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == payload["title"]
    assert body["tenant_id"] == created["tenant_id"]


def test_get_missing_portal_page_returns_404(client: TestClient) -> None:
    """Pedir una página inexistente devuelve 404 resource.not_found."""
    response = client.get(
        f"/api/v1/portal-pages/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"


def test_update_portal_page_renames(client: TestClient) -> None:
    """PATCH parcial renombra la página e incrementa la revisión."""
    _, created = _create_page(client, title="Antes")

    response = client.patch(
        f"/api/v1/portal-pages/{created['id']}",
        json={"title": "Después"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Después"
    assert body["revision"] == 2


def test_update_portal_page_forbids_extra_fields(client: TestClient) -> None:
    """PATCH con campos extra devuelve 422 (extra='forbid')."""
    _, created = _create_page(client, title="Estricta")

    response = client.patch(
        f"/api/v1/portal-pages/{created['id']}",
        json={"title": "Nuevo", "campo_inventado": True},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422


def test_update_missing_portal_page_returns_404(client: TestClient) -> None:
    """Actualizar una página inexistente devuelve 404."""
    response = client.patch(
        f"/api/v1/portal-pages/{uuid.uuid4()}",
        json={"title": "Nadie"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


def test_publish_portal_page_toggle(client: TestClient) -> None:
    """Publicar fija published_at; despublicar lo limpia."""
    _, created = _create_page(client, title="Publicable")

    published = client.post(
        f"/api/v1/portal-pages/{created['id']}/publish",
        json={"published": True},
        headers=TENANT_HEADERS,
    )
    assert published.status_code == 200
    pub_body = published.json()
    assert pub_body["published"] is True
    assert pub_body["published_at"] is not None

    unpublished = client.post(
        f"/api/v1/portal-pages/{created['id']}/publish",
        json={"published": False},
        headers=TENANT_HEADERS,
    )
    assert unpublished.status_code == 200
    unpub_body = unpublished.json()
    assert unpub_body["published"] is False
    assert unpub_body["published_at"] is None


def test_delete_portal_page_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y la página deja de ser visible."""
    _, created = _create_page(client, title="Descartable")

    response = client.delete(
        f"/api/v1/portal-pages/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(
        f"/api/v1/portal-pages/{created['id']}", headers=TENANT_HEADERS
    )
    assert after.status_code == 404


def test_generate_portal_page_uses_ai_service(client: TestClient) -> None:
    """El endpoint /generate delega en el motor IA y devuelve la página generada."""
    stub = _StubAiService()
    client.app.dependency_overrides[get_ai_service] = lambda: stub
    try:
        response = client.post(
            "/api/v1/portal-pages/generate",
            json={"prompt": "Crea una página de inicio para mi negocio"},
            headers=TENANT_HEADERS,
        )
    finally:
        client.app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 200
    body = response.json()
    assert body["slug"] == "inicio"
    assert body["title"] == "Página generada"
    # El router devuelve `blocks=config` (todo el dict de configuración generado).
    assert body["blocks"]["title"] == "Página generada"
    assert body["blocks"]["blocks"][0]["type"] == "hero"
    assert body["model"] == "deepseek-chat"
    assert body["cached"] is False
    assert body["prompt_tokens"] == 10
    assert body["completion_tokens"] == 20
    assert body["generated_at"]
    assert len(stub.calls) == 1
    assert stub.calls[0]["prompt"] == "Crea una página de inicio para mi negocio"


def test_generate_portal_page_invalid_prompt_returns_422(client: TestClient) -> None:
    """Un prompt vacío devuelve 422 (min_length=1)."""
    response = client.post(
        "/api/v1/portal-pages/generate",
        json={"prompt": ""},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
