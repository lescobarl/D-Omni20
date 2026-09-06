"""Tests de campañas publicitarias (C-1, eslabón ①) + atribución UTM vía HTTP.

Cubre el caso de uso de captación publicitaria end-to-end:
- CRUD de ``/api/v1/ads`` (crear, listar, obtener, actualizar, soft-delete).
- Reglas de negocio: nombre único por tenant, aislamiento multi-tenant,
  PATCH vacío (422) y payloads con campos desconocidos rechazados
  (``extra="forbid"``, fail-fast).
- Atribución UTM integral: capturar un lead con firma UTM liga su
  ``ad_campaign_id`` (eslabón ① → ②) y persiste en el roundtrip; un lead sin
  campaña habilitada queda ``null`` (fail-closed).
- Nivel repositorio: ``resolve_by_utm`` con prioridad de firma exacta,
  acotado al tenant y solo a campañas habilitadas y no eliminadas.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.repositories.ads_repositories import SqlAlchemyAdsRepository

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}


@pytest.fixture(autouse=True)
def _auth_headers(tenant_admin_token: str) -> None:
    """Añade el Bearer del tenant-admin a las cabeceras por defecto (RBAC)."""
    TENANT_HEADERS["Authorization"] = f"Bearer {tenant_admin_token}"


def _fresh_tenant(token: str) -> dict[str, str]:
    """Cabeceras de un tenant UUID fresco (aisla el test de datos de desarrollo).

    Usa el token super-admin porque el tenant-admin no tiene membresía en
    tenants frescos; el super-admin omite la comprobación de membresía.
    """
    return {
        "X-Tenant-Id": str(uuid.uuid4()),
        "Authorization": f"Bearer {token}",
    }


# ────────────────────────────────────────────────────────────────────────────
# Helpers de payload
# ────────────────────────────────────────────────────────────────────────────


def _campaign_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido con nombre y UTM únicos (evita colisiones por tenant)."""
    payload: dict[str, Any] = {
        "name": f"Campaña {uuid.uuid4().hex[:8]}",
        "status": "active",
        "enabled": True,
        "utm_source": "meta",
        "utm_medium": "cpc",
        "utm_campaign": f"verano_{uuid.uuid4().hex[:8]}",
    }
    payload.update(overrides)
    return payload


def _create_campaign(
    client: TestClient,
    headers: dict[str, str] | None = None,
    **overrides: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crea una campaña y devuelve ``(payload, body)`` — 201 esperado."""
    headers = headers or TENANT_HEADERS
    payload = _campaign_payload(**overrides)
    response = client.post("/api/v1/ads", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return payload, response.json()


def _lead_payload(**overrides: Any) -> dict[str, Any]:
    """Payload de captura de lead (misma convención que test_workflows)."""
    payload: dict[str, Any] = {
        "name": "Ana Pérez",
        "email": "ana@example.com",
        "phone": "+52 55 1234 5678",
        "source": "landing",
    }
    payload.update(overrides)
    return payload


def _repo_create(
    repo: SqlAlchemyAdsRepository,
    tenant_id: uuid.UUID,
    **overrides: Any,
) -> Any:
    """Crea una campaña a nivel repositorio con valores por defecto sanos."""
    kwargs: dict[str, Any] = {
        "tenant_id": tenant_id,
        "name": f"Repo {uuid.uuid4().hex[:8]}",
        "status": "active",
        "enabled": True,
        "utm_source": None,
        "utm_medium": None,
        "utm_campaign": None,
        "utm_content": None,
        "utm_term": None,
        "landing_id": None,
        "budget_minor": None,
        "start_at": None,
        "end_at": None,
        "notes": None,
    }
    kwargs.update(overrides)
    return repo.create(**kwargs)


# ────────────────────────────────────────────────────────────────────────────
# CRUD /api/v1/ads
# ────────────────────────────────────────────────────────────────────────────


def test_create_campaign_returns_201(client: TestClient) -> None:
    """Crea una campaña y devuelve la tupla sync inicial (revision == 1)."""
    payload, body = _create_campaign(client)
    assert body["name"] == payload["name"]
    assert body["status"] == "active"
    assert body["enabled"] is True
    assert body["utm_source"] == payload["utm_source"]
    assert body["utm_medium"] == payload["utm_medium"]
    assert body["utm_campaign"] == payload["utm_campaign"]
    assert body["revision"] == 1
    assert body["id"]
    assert body["tenant_id"]


def test_create_duplicate_name_returns_409(
    client: TestClient, super_admin_token: str
) -> None:
    """Un mismo nombre dentro del tenant genera conflicto (409, op ads.create)."""
    headers = _fresh_tenant(super_admin_token)
    name = f"Duplicada {uuid.uuid4().hex[:8]}"
    _create_campaign(client, headers=headers, name=name)

    response = client.post(
        "/api/v1/ads",
        json=_campaign_payload(name=name),
        headers=headers,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "ads.create"


def test_same_name_allowed_in_other_tenant(
    client: TestClient, super_admin_token: str
) -> None:
    """El mismo nombre es válido en otro tenant (unique por tenant, no global)."""
    name = f"Multitenant {uuid.uuid4().hex[:8]}"
    _create_campaign(client, headers=_fresh_tenant(super_admin_token), name=name)
    _, body = _create_campaign(
        client, headers=_fresh_tenant(super_admin_token), name=name
    )
    assert body["name"] == name
    assert body["id"]


def test_create_missing_tenant_header_returns_403(
    client: TestClient, tenant_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id el acceso se deniega (aislamiento multi-tenant)."""
    response = client.post(
        "/api/v1/ads",
        json=_campaign_payload(),
        headers={"Authorization": f"Bearer {tenant_admin_token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"


def test_create_invalid_payload_returns_422(client: TestClient) -> None:
    """Payload inválido (nombre vacío o campo desconocido) devuelve 422."""
    response = client.post(
        "/api/v1/ads",
        json={"name": "", "enabled": True},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"

    response_extra = client.post(
        "/api/v1/ads",
        json={"name": "Con extra", "unknown_field": 1},
        headers=TENANT_HEADERS,
    )
    assert response_extra.status_code == 422
    assert response_extra.json()["error"]["code"] == "validation.request_error"


def test_list_campaigns_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye la campaña recién creada del tenant activo."""
    payload, created = _create_campaign(client, name="Listable")

    response = client.get("/api/v1/ads", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body
    assert "total" in body
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])
    assert any(item["name"] == payload["name"] for item in body["items"])


def test_get_campaign_roundtrip(client: TestClient) -> None:
    """GET por id devuelve la campaña creada (roundtrip)."""
    payload, created = _create_campaign(client, name="Roundtrip")

    response = client.get(f"/api/v1/ads/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == payload["name"]
    assert body["tenant_id"] == created["tenant_id"]
    assert body["utm_campaign"] == payload["utm_campaign"]


def test_get_missing_campaign_returns_404(client: TestClient) -> None:
    """Pedir una campaña inexistente devuelve 404 resource.not_found (op ads.get)."""
    response = client.get(f"/api/v1/ads/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "ads.get"


def test_update_campaign_patches_and_bumps_revision(client: TestClient) -> None:
    """PATCH parcial actualiza campos e incrementa la revisión."""
    _, created = _create_campaign(client, name="Antes")

    response = client.patch(
        f"/api/v1/ads/{created['id']}",
        json={"enabled": False, "status": "paused", "utm_campaign": "invierno_2026"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["status"] == "paused"
    assert body["utm_campaign"] == "invierno_2026"
    assert body["revision"] == 2


def test_update_duplicate_name_returns_409(
    client: TestClient, super_admin_token: str
) -> None:
    """Renombrar a un nombre ya usado en el tenant genera 409 (op ads.update)."""
    headers = _fresh_tenant(super_admin_token)
    _, first = _create_campaign(client, headers=headers, name="Primera")
    name = f"Ocupada {uuid.uuid4().hex[:8]}"
    _create_campaign(client, headers=headers, name=name)

    response = client.patch(
        f"/api/v1/ads/{first['id']}",
        json={"name": name},
        headers=headers,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "ads.update"


def test_update_missing_campaign_returns_404(client: TestClient) -> None:
    """Actualizar una campaña inexistente devuelve 404 (op ads.update)."""
    response = client.patch(
        f"/api/v1/ads/{uuid.uuid4()}",
        json={"status": "paused"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "ads.update"


def test_update_empty_patch_returns_422(client: TestClient) -> None:
    """Un PATCH sin campos devuelve 422 validation.input_error (op ads.update)."""
    _, created = _create_campaign(client, name="Vacío")

    response = client.patch(
        f"/api/v1/ads/{created['id']}",
        json={},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "ads.update"


def test_delete_campaign_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y la campaña deja de ser visible."""
    _, created = _create_campaign(client, name="Descartable")

    response = client.delete(f"/api/v1/ads/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 204

    after = client.get(f"/api/v1/ads/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_delete_missing_campaign_returns_404(client: TestClient) -> None:
    """Eliminar una campaña inexistente devuelve 404 (op ads.delete)."""
    response = client.delete(f"/api/v1/ads/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "ads.delete"


# ────────────────────────────────────────────────────────────────────────────
# Atribución UTM integral (eslabón ① → ②): lead capturado con firma UTM
# ────────────────────────────────────────────────────────────────────────────


def test_capture_lead_links_ad_campaign_by_utm(
    client: TestClient, super_admin_token: str
) -> None:
    """Un lead con firma UTM se liga a la campaña activa del tenant."""
    headers = _fresh_tenant(super_admin_token)
    utm_campaign = f"verano_{uuid.uuid4().hex[:8]}"
    _, campaign = _create_campaign(
        client,
        headers=headers,
        name=f"Verano {utm_campaign}",
        utm_campaign=utm_campaign,
        utm_source="meta",
        utm_medium="cpc",
    )

    response = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(
            email=f"utm-{uuid.uuid4().hex[:6]}@example.com",
            phone=f"+52 55 9300 {uuid.uuid4().hex[:4]}",
            metadata={
                "utm_campaign": utm_campaign,
                "utm_source": "meta",
                "utm_medium": "cpc",
            },
        ),
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["ad_campaign_id"] == campaign["id"]
    assert body["metadata"]["utm_campaign"] == utm_campaign

    # Roundtrip: el vínculo persiste y se ve en GET /leads/{id}.
    roundtrip = client.get(f"/api/v1/workflows/leads/{body['id']}", headers=headers)
    assert roundtrip.status_code == 200
    assert roundtrip.json()["ad_campaign_id"] == campaign["id"]


def test_capture_lead_without_utm_keeps_campaign_null(
    client: TestClient, super_admin_token: str
) -> None:
    """Un lead sin firma UTM queda sin campaña (ad_campaign_id null, no rompe)."""
    headers = _fresh_tenant(super_admin_token)
    _create_campaign(
        client,
        headers=headers,
        name=f"Orfana {uuid.uuid4().hex[:8]}",
        utm_campaign="campaña_existente",
    )

    response = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(
            email=f"plain-{uuid.uuid4().hex[:6]}@example.com",
            phone=f"+52 55 9400 {uuid.uuid4().hex[:4]}",
        ),
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["ad_campaign_id"] is None


def test_capture_lead_links_campaign_by_context_id(
    client: TestClient, super_admin_token: str
) -> None:
    """Un lead sin UTM pero con `campaign_id` de contexto se atribuye a esa campaña.

    Cubre el preview del editor: adjunta el `campaign_id` de la landing como
    contexto; sin esta resolución el lead quedaría huérfano aunque exista la
    campaña (eslabón ② por contexto directo).
    """
    headers = _fresh_tenant(super_admin_token)
    _payload, campaign = _create_campaign(
        client,
        headers=headers,
        name=f"Contexto {uuid.uuid4().hex[:8]}",
        utm_campaign=f"ctx_{uuid.uuid4().hex[:8]}",
    )
    campaign_id = campaign["id"]

    response = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(
            email=f"ctx-{uuid.uuid4().hex[:6]}@example.com",
            phone=f"+52 55 9555 {uuid.uuid4().hex[:4]}",
            metadata={"campaign_id": campaign_id},
        ),
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["ad_campaign_id"] == campaign_id


def test_capture_lead_ignores_disabled_campaign(
    client: TestClient, super_admin_token: str
) -> None:
    """Una campaña deshabilitada no se atribuye (fail-closed)."""
    headers = _fresh_tenant(super_admin_token)
    utm_campaign = f"pausada_{uuid.uuid4().hex[:8]}"
    _create_campaign(
        client,
        headers=headers,
        name=f"Pausada {utm_campaign}",
        utm_campaign=utm_campaign,
        enabled=False,
    )

    response = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(
            email=f"off-{uuid.uuid4().hex[:6]}@example.com",
            phone=f"+52 55 9500 {uuid.uuid4().hex[:4]}",
            metadata={
                "utm_campaign": utm_campaign,
                "utm_source": "meta",
                "utm_medium": "cpc",
            },
        ),
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["ad_campaign_id"] is None


# ────────────────────────────────────────────────────────────────────────────
# Repositorio: resolve_by_utm (prioridad de firma + scoping)
# ────────────────────────────────────────────────────────────────────────────


def test_resolve_by_utm_prefers_exact_campaign(db_session) -> None:
    """La firma exacta de utm_campaign gana sobre source+medium."""
    repo = SqlAlchemyAdsRepository(db_session)
    tenant_id = uuid.uuid4()

    exact = _repo_create(
        repo,
        tenant_id,
        name="Exacta",
        utm_campaign="c_exacta",
        utm_source="meta",
        utm_medium="cpc",
    )
    _repo_create(
        repo,
        tenant_id,
        name="Fuente",
        utm_campaign=None,
        utm_source="meta",
        utm_medium="cpc",
    )

    found = repo.resolve_by_utm(
        tenant_id=tenant_id,
        utm_campaign="c_exacta",
        utm_source="meta",
        utm_medium="cpc",
    )
    assert found is not None
    assert found.id == exact.id


def test_resolve_by_utm_falls_back_to_source_medium(db_session) -> None:
    """Sin utm_campaign, resuelve por la pareja utm_source+utm_medium."""
    repo = SqlAlchemyAdsRepository(db_session)
    tenant_id = uuid.uuid4()

    target = _repo_create(
        repo,
        tenant_id,
        name="Fuente",
        utm_campaign=None,
        utm_source="google",
        utm_medium="cpc",
    )

    found = repo.resolve_by_utm(
        tenant_id=tenant_id,
        utm_campaign=None,
        utm_source="google",
        utm_medium="cpc",
    )
    assert found is not None
    assert found.id == target.id


def test_resolve_by_utm_ignores_disabled_and_deleted(db_session) -> None:
    """Campañas deshabilitadas o eliminadas no se atribuyen (fail-closed)."""
    repo = SqlAlchemyAdsRepository(db_session)
    tenant_id = uuid.uuid4()

    _repo_create(
        repo,
        tenant_id,
        name="Pausada",
        utm_campaign="c_off",
        utm_source="meta",
        utm_medium="cpc",
        enabled=False,
    )
    deleted = _repo_create(
        repo,
        tenant_id,
        name="Borrada",
        utm_campaign="c_del",
        utm_source="meta",
        utm_medium="cpc",
    )
    repo.soft_delete(tenant_id=tenant_id, ad_campaign_id=deleted.id)

    assert (
        repo.resolve_by_utm(
            tenant_id=tenant_id,
            utm_campaign="c_off",
            utm_source="meta",
            utm_medium="cpc",
        )
        is None
    )
    assert (
        repo.resolve_by_utm(
            tenant_id=tenant_id,
            utm_campaign="c_del",
            utm_source="meta",
            utm_medium="cpc",
        )
        is None
    )


def test_resolve_by_utm_is_tenant_scoped(db_session) -> None:
    """Nunca devuelve campañas de otro tenant (aislamiento multi-tenant)."""
    repo = SqlAlchemyAdsRepository(db_session)
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()

    _repo_create(
        repo,
        tenant_a,
        name="Solo A",
        utm_campaign="c_a",
        utm_source="meta",
        utm_medium="cpc",
    )

    found = repo.resolve_by_utm(
        tenant_id=tenant_b,
        utm_campaign="c_a",
        utm_source="meta",
        utm_medium="cpc",
    )
    assert found is None
