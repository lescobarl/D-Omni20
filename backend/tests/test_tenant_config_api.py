"""Tests de los endpoints de configuración del tenant para el bot (Fase 2).

Cubre los CRUD de ``/api/v1/tenant/appearance``, ``/api/v1/content``,
``/api/v1/catalog`` y ``/api/v1/channels``:

- Códigos de error estructurados (404/409/422/403) y su ``operation``.
- Aislamiento multi-tenant: un tenant aislado (UUID aleatorio válido) nunca
  ve ni lista datos de ``dev-tenant``.
- Secretos de canales *write-only*: ``access_token`` / ``webhook_secret`` y
  las columnas ``encrypted_*`` nunca se serializan en las respuestas.
- Regresión del ``_FIELD_MAP`` del catálogo: la ``metadata`` persiste en un
  ``PUT`` (columna ``metadata`` / atributo ORM ``metadata_json``).
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.tenant_config import TenantChannel

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"

_SECRET_KEYS = (
    "access_token",
    "webhook_secret",
    "encrypted_access_token",
    "encrypted_webhook_secret",
)

_APPEARANCE_PAYLOAD: dict[str, str] = {
    "primary_color": "#112233",
    "accent_color": "#223344",
    "surface_color": "#FFFFFF",
    "text_color": "#000000",
    "brand_badge": "#112233",
}


def _other_tenant() -> dict[str, str]:
    """Cabeceras de un tenant aislado (UUID aleatorio válido, no sembrado)."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _assert_no_secrets(body: Any) -> None:
    """Verifica recursivamente que ninguna clave de secreto esté en una respuesta."""
    if isinstance(body, dict):
        assert not any(key in body for key in _SECRET_KEYS), body
        for value in body.values():
            _assert_no_secrets(value)
    elif isinstance(body, list):
        for item in body:
            _assert_no_secrets(item)


def _assert_secret_text_absent(response: Any) -> None:
    """Verifica que ni los secretos enviados ni las columnas cifradas aparezcan."""
    text = response.text
    assert "sekret-token" not in text
    assert "sekret-webhook" not in text
    assert "encrypted_access_token" not in text
    assert "encrypted_webhook_secret" not in text


# ---------------------------------------------------------------------------
# Apariencia del tenant
# ---------------------------------------------------------------------------


def test_appearance_undefined_returns_404(client: TestClient) -> None:
    """Un tenant sin apariencia definida recibe 404 resource.not_found."""
    response = client.get("/api/v1/tenant/appearance", headers=_other_tenant())
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "tenant.appearance.get"


def test_appearance_put_creates_and_get_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """PUT crea la apariencia y GET devuelve la misma tupla sync."""
    created = client.put(
        "/api/v1/tenant/appearance", json=_APPEARANCE_PAYLOAD, headers=TENANT_HEADERS
    )
    assert created.status_code == 200
    created_body = created.json()
    assert created_body["primary_color"] == _APPEARANCE_PAYLOAD["primary_color"]
    assert created_body["accent_color"] == _APPEARANCE_PAYLOAD["accent_color"]
    assert created_body["version"] == 1
    assert created_body["revision"] == 1
    assert created_body["tenant_id"] == str(tenant_id)

    fetched = client.get("/api/v1/tenant/appearance", headers=TENANT_HEADERS)
    assert fetched.status_code == 200
    fetched_body = fetched.json()
    assert fetched_body["id"] == created_body["id"]
    assert fetched_body["primary_color"] == created_body["primary_color"]
    assert fetched_body["font_family"] is None


def test_appearance_put_idempotent_same_row(client: TestClient) -> None:
    """Un segundo PUT no duplica la fila: misma id, versión sin cambios."""
    first = client.put(
        "/api/v1/tenant/appearance", json=_APPEARANCE_PAYLOAD, headers=TENANT_HEADERS
    )
    assert first.status_code == 200
    first_body = first.json()

    second = client.put(
        "/api/v1/tenant/appearance", json=_APPEARANCE_PAYLOAD, headers=TENANT_HEADERS
    )
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["id"] == first_body["id"]
    assert second_body["tenant_id"] == first_body["tenant_id"]
    assert second_body["version"] == 1


def test_appearance_invalid_color_returns_422(client: TestClient) -> None:
    """Un color no hexadecimal es rechazado por validación del payload (422)."""
    payload = {**_APPEARANCE_PAYLOAD, "primary_color": "red"}
    response = client.put(
        "/api/v1/tenant/appearance", json=payload, headers=TENANT_HEADERS
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


def test_appearance_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega el acceso (aislamiento)."""
    response = client.put(
        "/api/v1/tenant/appearance",
        json=_APPEARANCE_PAYLOAD,
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_appearance_isolated_per_tenant(client: TestClient) -> None:
    """La apariencia de dev-tenant no se filtra a un tenant aislado (404)."""
    client.put(
        "/api/v1/tenant/appearance", json=_APPEARANCE_PAYLOAD, headers=TENANT_HEADERS
    )
    response = client.get("/api/v1/tenant/appearance", headers=_other_tenant())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


# ---------------------------------------------------------------------------
# Contenido estructurado del bot
# ---------------------------------------------------------------------------


def _create_content_item(
    client: TestClient, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "kind": "faq",
        "title": "Pregunta de prueba",
        "content": "Respuesta",
        "tags": ["api"],
        **overrides,
    }
    response = client.post("/api/v1/content", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_content_create_returns_201(client: TestClient, tenant_id: uuid.UUID) -> None:
    """Crea un ítem de contenido y devuelve la tupla sync inicial."""
    payload, body = _create_content_item(client)
    assert body["kind"] == payload["kind"]
    assert body["title"] == payload["title"]
    assert body["tags"] == payload["tags"]
    assert body["revision"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_content_list_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye el ítem recién creado del tenant activo."""
    _, created = _create_content_item(client, title="Listable")

    response = client.get("/api/v1/content", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body and "total" in body
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_content_get_roundtrip(client: TestClient) -> None:
    """GET por id devuelve el ítem creado."""
    payload, created = _create_content_item(client, title="Roundtrip")

    response = client.get(f"/api/v1/content/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == payload["title"]
    assert body["content"] == payload["content"]


def test_content_get_missing_returns_404(client: TestClient) -> None:
    """Pedir un ítem inexistente devuelve 404 con operation content.get."""
    response = client.get(f"/api/v1/content/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "content.get"


def test_content_update_renames(client: TestClient) -> None:
    """PUT parcial actualiza el título e incrementa la revisión."""
    _, created = _create_content_item(client, title="Antes")

    response = client.put(
        f"/api/v1/content/{created['id']}",
        json={"title": "Después"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Después"
    assert body["revision"] == 2


def test_content_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_content_item(client)

    response = client.put(
        f"/api/v1/content/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "content.update"


def test_content_delete_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el ítem deja de ser visible."""
    _, created = _create_content_item(client)

    response = client.delete(
        f"/api/v1/content/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(f"/api/v1/content/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_content_delete_missing_returns_404(client: TestClient) -> None:
    """Borrar un ítem inexistente devuelve 404 con operation content.delete."""
    response = client.delete(f"/api/v1/content/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "content.delete"


def test_content_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        "/api/v1/content",
        json={"kind": "faq", "title": "Sin tenant"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_content_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista el contenido de dev-tenant."""
    _, created = _create_content_item(client, title="Privado")

    fetched = client.get(
        f"/api/v1/content/{created['id']}", headers=_other_tenant()
    )
    assert fetched.status_code == 404

    listed = client.get("/api/v1/content", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_content_rejects_extra_fields(client: TestClient) -> None:
    """Campos no declarados son rechazados (extra='forbid')."""
    response = client.post(
        "/api/v1/content",
        json={"kind": "faq", "title": "Con extra", "unexpected": 1},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


# ---------------------------------------------------------------------------
# Catálogo de productos/servicios
# ---------------------------------------------------------------------------


def _create_catalog_item(
    client: TestClient, *, sku: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "sku": sku or f"SKU-{uuid.uuid4()}",
        "name": "Producto API",
        "description": "Descripción",
        "price": "99.90",
        "currency": "MXN",
        "available": True,
        "metadata": {"category": "general"},
        **overrides,
    }
    response = client.post("/api/v1/catalog", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_catalog_create_returns_201_roundtrip(client: TestClient) -> None:
    """Crea un ítem del catálogo; expone precio, metadata y tupla sync."""
    payload, body = _create_catalog_item(client)
    assert body["sku"] == payload["sku"]
    assert body["name"] == payload["name"]
    assert Decimal(str(body["price"])) == Decimal("99.90")
    assert body["metadata"] == payload["metadata"]
    assert body["available"] is True
    assert body["revision"] == 1


def test_catalog_duplicate_sku_returns_409(client: TestClient) -> None:
    """Un mismo SKU dentro del tenant genera conflicto (409)."""
    sku = f"SKU-{uuid.uuid4()}"
    _create_catalog_item(client, sku=sku)

    response = client.post(
        "/api/v1/catalog",
        json={"sku": sku, "name": "Duplicado"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "catalog.create"


def test_catalog_get_roundtrip(client: TestClient) -> None:
    """GET por id devuelve el ítem del catálogo con su metadata."""
    payload, created = _create_catalog_item(client)

    response = client.get(f"/api/v1/catalog/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["sku"] == payload["sku"]
    assert body["metadata"] == payload["metadata"]


def test_catalog_update_persists_metadata(client: TestClient) -> None:
    """PUT persiste la metadata en la columna (regresión del _FIELD_MAP)."""
    _, created = _create_catalog_item(client, metadata={"brand": "A"})

    response = client.put(
        f"/api/v1/catalog/{created['id']}",
        json={"metadata": {"brand": "B", "color": "red"}},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["metadata"] == {"brand": "B", "color": "red"}

    again = client.get(f"/api/v1/catalog/{created['id']}", headers=TENANT_HEADERS)
    assert again.status_code == 200
    assert again.json()["metadata"] == {"brand": "B", "color": "red"}


def test_catalog_update_duplicate_sku_returns_409(client: TestClient) -> None:
    """Renombrar a un SKU ya usado por otro ítem del tenant genera 409."""
    sku_a = f"SKU-{uuid.uuid4()}"
    sku_b = f"SKU-{uuid.uuid4()}"
    _, item_a = _create_catalog_item(client, sku=sku_a)
    _, item_b = _create_catalog_item(client, sku=sku_b)

    response = client.put(
        f"/api/v1/catalog/{item_b['id']}",
        json={"sku": sku_a},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "catalog.update"
    assert item_a["id"] != item_b["id"]


def test_catalog_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_catalog_item(client)

    response = client.put(
        f"/api/v1/catalog/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    assert response.status_code == 422
    assert response.json()["error"]["operation"] == "catalog.update"


def test_catalog_get_missing_returns_404(client: TestClient) -> None:
    """Pedir un ítem inexistente devuelve 404 con operation catalog.get."""
    response = client.get(f"/api/v1/catalog/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "catalog.get"


def test_catalog_delete_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el ítem deja de ser visible."""
    _, created = _create_catalog_item(client)

    response = client.delete(
        f"/api/v1/catalog/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(f"/api/v1/catalog/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_catalog_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        "/api/v1/catalog",
        json={"sku": "SKU-1", "name": "Sin tenant"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_catalog_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista el catálogo de dev-tenant."""
    _, created = _create_catalog_item(client)

    fetched = client.get(f"/api/v1/catalog/{created['id']}", headers=_other_tenant())
    assert fetched.status_code == 404

    listed = client.get("/api/v1/catalog", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


# ---------------------------------------------------------------------------
# Canales del bot (secretos write-only)
# ---------------------------------------------------------------------------


def _create_channel(
    client: TestClient, *, external_id: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "channel_type": "whatsapp",
        "external_id": external_id or f"wa-{uuid.uuid4()}",
        "phone_number": "5215500000000",
        "phone_number_id": "123456789",
        "access_token": "sekret-token",
        "webhook_secret": "sekret-webhook",
        "enabled": True,
        **overrides,
    }
    response = client.post("/api/v1/channels", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def _insert_raw_channel(
    db_session: Session, tenant_id: uuid.UUID, *, channel_type: str, external_id: str
) -> uuid.UUID:
    """Inserta un canal directamente en la BD (sin pasar por el API estricto).

    Permite sembrar tipos de canal no soportados (p. ej. ``instagram``, como hace
    ``scripts/seed_dev_ops.py``) para probar que la LECTURA no rompe (500).
    """
    channel = TenantChannel(
        tenant_id=tenant_id,
        channel_type=channel_type,
        external_id=external_id,
        phone_number="5215500000000",
        phone_number_id="123456789",
        enabled=True,
    )
    db_session.add(channel)
    db_session.commit()
    return channel.id


def test_channel_create_returns_201_no_secrets(client: TestClient) -> None:
    """Crea un canal; la respuesta nunca serializa secretos (write-only)."""
    payload, body = _create_channel(client)
    assert body["channel_type"] == payload["channel_type"]
    assert body["external_id"] == payload["external_id"]
    assert body["phone_number"] == payload["phone_number"]
    assert body["revision"] == 1
    _assert_no_secrets(body)


def test_channel_list_no_secrets(client: TestClient) -> None:
    """La lista paginada incluye el canal creado sin exponer secretos."""
    _, created = _create_channel(client)

    response = client.get("/api/v1/channels", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])
    _assert_no_secrets(body)


def test_channel_get_roundtrip_no_secrets(client: TestClient) -> None:
    """GET por id devuelve el canal sin secretos."""
    _, created = _create_channel(client)

    response = client.get(f"/api/v1/channels/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["enabled"] is True
    _assert_no_secrets(body)
    _assert_secret_text_absent(response)


def test_channel_read_tolerates_unsupported_channel_type(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """La lectura (lista y get) no revienta (500) ante tipos de canal no soportados.

    La BD puede contener tipos ajenos al producto (p. ej. ``instagram`` sembrado
    por ``scripts/seed_dev_ops.py``); la fábrica de canales los resuelve
    fail-closed y el esquema de lectura debe reflejar esa realidad sin lanzar
    ``ValidationError`` (contrato comando-estricto / consulta-permisiva).
    """
    channel_id = _insert_raw_channel(
        db_session, tenant_id, channel_type="instagram", external_id=f"ig-{uuid.uuid4()}"
    )

    listed = client.get("/api/v1/channels", headers=TENANT_HEADERS)
    assert listed.status_code == 200
    listed_body = listed.json()
    assert any(
        item["id"] == str(channel_id) and item["channel_type"] == "instagram"
        for item in listed_body["items"]
    )

    fetched = client.get(f"/api/v1/channels/{channel_id}", headers=TENANT_HEADERS)
    assert fetched.status_code == 200
    assert fetched.json()["channel_type"] == "instagram"
    _assert_no_secrets(fetched.json())


def test_channel_duplicate_external_id_returns_409(client: TestClient) -> None:
    """Un mismo external_id dentro del tenant genera conflicto (409)."""
    external_id = f"wa-{uuid.uuid4()}"
    _create_channel(client, external_id=external_id)

    response = client.post(
        "/api/v1/channels",
        json={"external_id": external_id, "phone_number": "5215500000001"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "channels.create"


def test_channel_patch_updates(client: TestClient) -> None:
    """PATCH parcial actualiza el canal e incrementa la revisión."""
    _, created = _create_channel(client)

    response = client.patch(
        f"/api/v1/channels/{created['id']}",
        json={"enabled": False, "phone_number": "5215511111111"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["phone_number"] == "5215511111111"
    assert body["revision"] == 2
    _assert_no_secrets(body)
    _assert_secret_text_absent(response)


def test_channel_patch_duplicate_external_id_returns_409(client: TestClient) -> None:
    """PATCH a un external_id ya usado por otro canal del tenant genera 409."""
    ext_a = f"wa-{uuid.uuid4()}"
    ext_b = f"wa-{uuid.uuid4()}"
    _, channel_a = _create_channel(client, external_id=ext_a)
    _, channel_b = _create_channel(client, external_id=ext_b)

    response = client.patch(
        f"/api/v1/channels/{channel_b['id']}",
        json={"external_id": ext_a},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "channels.update"
    assert channel_a["id"] != channel_b["id"]


def test_channel_patch_empty_payload_returns_422(client: TestClient) -> None:
    """Un PATCH sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_channel(client)

    response = client.patch(
        f"/api/v1/channels/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    assert response.status_code == 422
    assert response.json()["error"]["operation"] == "channels.update"


def test_channel_get_missing_returns_404(client: TestClient) -> None:
    """Pedir un canal inexistente devuelve 404 con operation channels.get."""
    response = client.get(f"/api/v1/channels/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "channels.get"


def test_channel_delete_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el canal deja de ser visible."""
    _, created = _create_channel(client)

    response = client.delete(
        f"/api/v1/channels/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(f"/api/v1/channels/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_channel_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        "/api/v1/channels",
        json={"phone_number": "5215500000000"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_channel_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista los canales de dev-tenant."""
    _, created = _create_channel(client)

    fetched = client.get(f"/api/v1/channels/{created['id']}", headers=_other_tenant())
    assert fetched.status_code == 404

    listed = client.get("/api/v1/channels", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []
