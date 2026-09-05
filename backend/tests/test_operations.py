"""Tests de los endpoints de operación del bot (Bloque B de LAE Omni2.0).

Cubre las 7 tablas de operación expuestas por ``/api/v1/operations``:

- Contactos (B.6), Plantillas (B.5) y Árboles de navegación (B.3): CRUD
  completo acotado al tenant, con unicidad por nombre/phone → 409.
- Campañas y Destinatarios (B.4): campañas sin unicidad; destinatarios
  únicos por campaña+contacto.
- Intervención humana (B.7): cola por estado, contador de pendientes,
  asignación, historial de chat, respuesta saliente y cierre (sin borrado).
- Mantenimiento (B.9): *upsert* por tenant (PUT idempotente → 200).

Patrones verificados frente a los endpoints reales:
- ``get_current_tenant`` fija ``operation="tenant.resolve"`` en los 403.
- El 422 de ``RequestValidationError`` (campos extra) NO incluye
  ``operation`` (solo ``code="validation.request_error"``).
- Los 409 por unicidad pasan por el handler global de ``IntegrityError``
  (``operation="resource.conflict"``).
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

from app.api.deps import get_bot_queue_service
from app.bot.models import BotConversation, BotMessage
from app.bot.queue.service import BotQueueService
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.core.di import Container
from app.models.bot_operations import BotIntervention
from app.models.tenant_config import TenantChannel
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.test_bot_queue import FakeLogger, FakeQueue

_API = "/api/v1/operations"
TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}

# Cabeceras de autenticación por defecto (RBAC). El super-admin omite la
# comprobación de membresía, por lo que vale tanto para el tenant de desarrollo
# como para tenants UUID frescos.
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    """Añade el Bearer del super-admin a las cabeceras por defecto (RBAC)."""
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"


# ---------------------------------------------------------------------------
# Helpers compartidos
# ---------------------------------------------------------------------------


def _other_tenant() -> dict[str, str]:
    """Cabeceras de un tenant aleatorio distinto al de desarrollo."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _maintenance_tenant() -> tuple[dict[str, str], str]:
    """Tenant aleatorio fresco para B.9 (no contamina al tenant de desarrollo)."""
    tenant_uuid = uuid.uuid4()
    return {"X-Tenant-Id": str(tenant_uuid), **_AUTH}, str(tenant_uuid)


def _suffix() -> str:
    """Sufijo único para evitar colisiones de unicidad entre tests."""
    return uuid.uuid4().hex[:10]


def _assert_error(
    response: Any,
    *,
    status_code: int,
    code: str,
    operation: str,
) -> None:
    """Valida una respuesta de error derivada de ``AppError``."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["operation"] == operation


def _assert_request_error(response: Any) -> None:
    """Valida el 422 de ``RequestValidationError`` (sin campo ``operation``)."""
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation.request_error"


def _assert_missing_tenant_header(response: Any) -> None:
    """Valida el 403 por cabecera ``X-Tenant-Id`` ausente."""
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"
    assert body["error"]["operation"] == "tenant.resolve"


def _create_conversation(db_session: Session, tenant_id: uuid.UUID) -> uuid.UUID:
    """Crea un canal y una conversación real para el tenant (B.7)."""
    channel = TenantChannel(
        tenant_id=tenant_id,
        channel_type="whatsapp",
        external_id=f"waba-{_suffix()}",
        phone_number=f"52155{_suffix()}",
        phone_number_id=f"pid-{_suffix()}",
        encrypted_access_token="",
        encrypted_webhook_secret="",
        enabled=True,
    )
    db_session.add(channel)
    db_session.flush()
    conversation = BotConversation(
        tenant_id=tenant_id,
        channel_id=channel.id,
        external_contact_id=f"ext-{_suffix()}",
        state="new",
    )
    db_session.add(conversation)
    db_session.commit()
    return conversation.id


# ---------------------------------------------------------------------------
# Contactos (B.6)
# ---------------------------------------------------------------------------


def _create_contact(
    client: TestClient, *, phone: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "phone": phone or f"52155{_suffix()}",
        "name": "Contacto API",
        "tags": ["api"],
        **overrides,
    }
    response = client.post(f"{_API}/contacts", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_contact_create_returns_201_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Crea un contacto y devuelve la tupla sync inicial."""
    payload, body = _create_contact(client, name="Ana", tags=["vip"])
    assert body["phone"] == payload["phone"]
    assert body["name"] == "Ana"
    assert body["tags"] == ["vip"]
    assert body["state"] == "new"
    assert body["source"] == "manual"
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_contact_list_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye el contacto recién creado del tenant activo."""
    _, created = _create_contact(client, name="Listable")

    response = client.get(f"{_API}/contacts", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body and "total" in body
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_contact_get_roundtrip(client: TestClient) -> None:
    """GET por id devuelve el contacto creado."""
    payload, created = _create_contact(client, name="Roundtrip")

    response = client.get(f"{_API}/contacts/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["phone"] == payload["phone"]
    assert body["name"] == "Roundtrip"


def test_contact_duplicate_phone_returns_409(client: TestClient) -> None:
    """El ``phone`` es único por tenant: duplicar devuelve 409 por unicidad."""
    payload, _ = _create_contact(client)
    response = client.post(f"{_API}/contacts", json=payload, headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=409,
        code="resource.conflict",
        operation="resource.conflict",
    )


def test_contact_update_persists_fields(client: TestClient) -> None:
    """PUT parcial actualiza campos e incrementa la revisión."""
    _, created = _create_contact(client, tags=["a", "b"])

    response = client.put(
        f"{_API}/contacts/{created['id']}",
        json={"tags": ["a", "b", "c"], "state": "qualified"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tags"] == ["a", "b", "c"]
    assert body["state"] == "qualified"
    assert body["revision"] == 2
    assert body["version"] == 1


def test_contact_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_contact(client)

    response = client.put(
        f"{_API}/contacts/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=422,
        code="validation.input_error",
        operation="operations.contact.update",
    )


def test_contact_get_missing_returns_404(client: TestClient) -> None:
    """Pedir un contacto inexistente devuelve 404 con operation contact.get."""
    response = client.get(f"{_API}/contacts/{uuid.uuid4()}", headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.contact.get",
    )


def test_contact_update_missing_returns_404(client: TestClient) -> None:
    """Actualizar un contacto inexistente devuelve 404 con operation contact.update."""
    response = client.put(
        f"{_API}/contacts/{uuid.uuid4()}", json={"name": "X"}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.contact.update",
    )


def test_contact_delete_returns_204_then_404(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el contacto deja de ser visible."""
    _, created = _create_contact(client)

    response = client.delete(f"{_API}/contacts/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 204

    after = client.get(f"{_API}/contacts/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_contact_delete_missing_returns_404(client: TestClient) -> None:
    """Borrar un contacto inexistente devuelve 404 con operation contact.delete."""
    response = client.delete(f"{_API}/contacts/{uuid.uuid4()}", headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.contact.delete",
    )


def test_contact_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        f"{_API}/contacts",
        json={"phone": f"52155{_suffix()}"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_contact_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista los contactos de dev-tenant."""
    _, created = _create_contact(client, name="Privado")

    fetched = client.get(f"{_API}/contacts/{created['id']}", headers=_other_tenant())
    _assert_error(
        fetched,
        status_code=404,
        code="resource.not_found",
        operation="operations.contact.get",
    )

    listed = client.get(f"{_API}/contacts", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_contact_rejects_extra_fields(client: TestClient) -> None:
    """Campos no declarados son rechazados (extra='forbid')."""
    response = client.post(
        f"{_API}/contacts",
        json={"phone": f"52155{_suffix()}", "unexpected": 1},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


def test_contacts_import_csv_creates_contacts(client: TestClient) -> None:
    """CSV con dos filas válidas crea dos contactos (created=2)."""
    csv_text = (
        "phone,name,email,tags\n"
        f"52155{_suffix()},Juan,juan@example.com,cliente|premium\n"
        f"52155{_suffix()},Ana,ana@example.com,cliente\n"
    )
    response = client.post(
        f"{_API}/contacts/import-csv",
        json={"csv": csv_text, "delimiter": ","},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 2
    assert body["skipped"] == 0
    assert body["failed"] == 0
    assert body["errors"] == []


def test_contacts_import_csv_dedupes_existing_phone(client: TestClient) -> None:
    """Un teléfono ya existente en el tenant se omite (skipped)."""
    payload, _ = _create_contact(client)
    existing_phone = payload["phone"]
    csv_text = (
        "phone,name\n"
        f"{existing_phone},Duplicado\n"
        f"52155{_suffix()},Nuevo\n"
    )
    response = client.post(
        f"{_API}/contacts/import-csv",
        json={"csv": csv_text, "delimiter": ","},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 1
    assert body["skipped"] == 1
    assert body["failed"] == 0
    assert body["errors"] == []


def test_contacts_import_csv_missing_phone_fails_row(client: TestClient) -> None:
    """Una fila sin 'phone' se cuenta como failed y acumula su error."""
    csv_text = "name,email\nSinTelefono,nuevo@example.com\n"
    response = client.post(
        f"{_API}/contacts/import-csv",
        json={"csv": csv_text, "delimiter": ","},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 0
    assert body["skipped"] == 0
    assert body["failed"] == 1
    assert len(body["errors"]) == 1
    assert "falta el campo 'phone'" in body["errors"][0]


def test_contacts_import_csv_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la importación (aislamiento)."""
    response = client.post(
        f"{_API}/contacts/import-csv",
        json={"csv": "phone\n5215500000000\n"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_contacts_import_csv_empty_body_returns_422(client: TestClient) -> None:
    """Un cuerpo sin 'csv' es un error de validación (422)."""
    response = client.post(
        f"{_API}/contacts/import-csv",
        json={},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


# ---------------------------------------------------------------------------
# Plantillas (B.5)
# ---------------------------------------------------------------------------


def _create_template(
    client: TestClient, *, name: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "name": name or f"plantilla-{_suffix()}",
        "body": "Hola {{nombre}}",
        "template_type": "text",
        "variables": ["nombre"],
        **overrides,
    }
    response = client.post(f"{_API}/templates", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_template_create_returns_201_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Crea una plantilla y devuelve la tupla sync inicial."""
    payload, body = _create_template(client, variables=["nombre", "empresa"])
    assert body["name"] == payload["name"]
    assert body["body"] == "Hola {{nombre}}"
    assert body["template_type"] == "text"
    assert body["variables"] == ["nombre", "empresa"]
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_template_list_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye la plantilla recién creada del tenant activo."""
    _, created = _create_template(client, name="Listable")

    response = client.get(f"{_API}/templates", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_template_get_roundtrip(client: TestClient) -> None:
    """GET por id devuelve la plantilla creada."""
    payload, created = _create_template(client, name="Roundtrip")

    response = client.get(f"{_API}/templates/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == "Roundtrip"
    assert body["body"] == payload["body"]


def test_template_duplicate_name_returns_409(client: TestClient) -> None:
    """El ``name`` es único por tenant: duplicar devuelve 409 por unicidad."""
    payload, _ = _create_template(client)
    response = client.post(f"{_API}/templates", json=payload, headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=409,
        code="resource.conflict",
        operation="resource.conflict",
    )


def test_template_update_partial(client: TestClient) -> None:
    """PUT parcial actualiza el cuerpo e incrementa la revisión."""
    _, created = _create_template(client)

    response = client.put(
        f"{_API}/templates/{created['id']}",
        json={"body": "Nuevo cuerpo", "variables": ["nombre", "ciudad"]},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["body"] == "Nuevo cuerpo"
    assert body["variables"] == ["nombre", "ciudad"]
    assert body["revision"] == 2


def test_template_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_template(client)

    response = client.put(
        f"{_API}/templates/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=422,
        code="validation.input_error",
        operation="operations.template.update",
    )


def test_template_get_missing_returns_404(client: TestClient) -> None:
    """Pedir una plantilla inexistente devuelve 404 con operation template.get."""
    response = client.get(f"{_API}/templates/{uuid.uuid4()}", headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.template.get",
    )


def test_template_update_missing_returns_404(client: TestClient) -> None:
    """Actualizar una plantilla inexistente devuelve 404 con operation template.update."""
    response = client.put(
        f"{_API}/templates/{uuid.uuid4()}", json={"body": "X"}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.template.update",
    )


def test_template_delete_returns_204_then_404(client: TestClient) -> None:
    """Soft-delete devuelve 204 y la plantilla deja de ser visible."""
    _, created = _create_template(client)

    response = client.delete(f"{_API}/templates/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 204

    after = client.get(f"{_API}/templates/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_template_delete_missing_returns_404(client: TestClient) -> None:
    """Borrar una plantilla inexistente devuelve 404 con operation template.delete."""
    response = client.delete(f"{_API}/templates/{uuid.uuid4()}", headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.template.delete",
    )


def test_template_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        f"{_API}/templates",
        json={"name": f"plantilla-{_suffix()}"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_template_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista las plantillas de dev-tenant."""
    _, created = _create_template(client, name="Privado")

    fetched = client.get(f"{_API}/templates/{created['id']}", headers=_other_tenant())
    _assert_error(
        fetched,
        status_code=404,
        code="resource.not_found",
        operation="operations.template.get",
    )

    listed = client.get(f"{_API}/templates", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_template_rejects_extra_fields(client: TestClient) -> None:
    """Campos no declarados son rechazados (extra='forbid')."""
    response = client.post(
        f"{_API}/templates",
        json={"name": f"plantilla-{_suffix()}", "unexpected": 1},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


# ---------------------------------------------------------------------------
# Árboles de navegación (B.3)
# ---------------------------------------------------------------------------


def _create_navigation_tree(
    client: TestClient, *, name: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "name": name or f"arbol-{_suffix()}",
        "num_options": 2,
        "options": [
            {"label": "Opción 1", "target": "menu_1"},
            {"label": "Opción 2", "target": "menu_2"},
        ],
        **overrides,
    }
    response = client.post(
        f"{_API}/navigation-trees", json=payload, headers=TENANT_HEADERS
    )
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_navigation_tree_create_returns_201_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Crea un árbol de navegación y devuelve la tupla sync inicial."""
    payload, body = _create_navigation_tree(client, num_options=1)
    assert body["name"] == payload["name"]
    assert body["num_options"] == 1
    assert body["options"] == payload["options"]
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_navigation_tree_duplicate_name_returns_409(client: TestClient) -> None:
    """El ``name`` es único por tenant: duplicar devuelve 409 por unicidad."""
    payload, _ = _create_navigation_tree(client)
    response = client.post(
        f"{_API}/navigation-trees", json=payload, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=409,
        code="resource.conflict",
        operation="resource.conflict",
    )


def test_navigation_tree_update_partial(client: TestClient) -> None:
    """PUT parcial actualiza opciones e incrementa la revisión."""
    _, created = _create_navigation_tree(client)

    response = client.put(
        f"{_API}/navigation-trees/{created['id']}",
        json={"num_options": 3, "options": [{"label": "Única", "target": "menu_0"}]},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["num_options"] == 3
    assert body["options"] == [{"label": "Única", "target": "menu_0"}]
    assert body["revision"] == 2


def test_navigation_tree_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_navigation_tree(client)

    response = client.put(
        f"{_API}/navigation-trees/{created['id']}",
        json={},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=422,
        code="validation.input_error",
        operation="operations.navigation_tree.update",
    )


def test_navigation_tree_get_missing_returns_404(client: TestClient) -> None:
    """Pedir un árbol inexistente devuelve 404 con operation navigation_tree.get."""
    response = client.get(
        f"{_API}/navigation-trees/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.navigation_tree.get",
    )


def test_navigation_tree_update_missing_returns_404(client: TestClient) -> None:
    """Actualizar un árbol inexistente devuelve 404 con operation navigation_tree.update."""
    response = client.put(
        f"{_API}/navigation-trees/{uuid.uuid4()}",
        json={"num_options": 1},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.navigation_tree.update",
    )


def test_navigation_tree_delete_returns_204_then_404(client: TestClient) -> None:
    """Soft-delete devuelve 204 y el árbol deja de ser visible."""
    _, created = _create_navigation_tree(client)

    response = client.delete(
        f"{_API}/navigation-trees/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    after = client.get(
        f"{_API}/navigation-trees/{created['id']}", headers=TENANT_HEADERS
    )
    assert after.status_code == 404


def test_navigation_tree_delete_missing_returns_404(client: TestClient) -> None:
    """Borrar un árbol inexistente devuelve 404 con operation navigation_tree.delete."""
    response = client.delete(
        f"{_API}/navigation-trees/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.navigation_tree.delete",
    )


def test_navigation_tree_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        f"{_API}/navigation-trees",
        json={"name": f"arbol-{_suffix()}"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_navigation_tree_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista los árboles de dev-tenant."""
    _, created = _create_navigation_tree(client, name="Privado")

    fetched = client.get(
        f"{_API}/navigation-trees/{created['id']}", headers=_other_tenant()
    )
    _assert_error(
        fetched,
        status_code=404,
        code="resource.not_found",
        operation="operations.navigation_tree.get",
    )

    listed = client.get(f"{_API}/navigation-trees", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_navigation_tree_rejects_extra_fields(client: TestClient) -> None:
    """Campos no declarados son rechazados (extra='forbid')."""
    response = client.post(
        f"{_API}/navigation-trees",
        json={"name": f"arbol-{_suffix()}", "unexpected": 1},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


# ---------------------------------------------------------------------------
# Campañas (B.4)
# ---------------------------------------------------------------------------


def _create_campaign(
    client: TestClient, *, name: str | None = None, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "name": name or f"campana-{_suffix()}",
        "state": "draft",
        **overrides,
    }
    response = client.post(f"{_API}/campaigns", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_campaign_create_returns_201_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Crea una campaña y devuelve la tupla sync inicial."""
    payload, body = _create_campaign(client, state="scheduled")
    assert body["name"] == payload["name"]
    assert body["state"] == "scheduled"
    assert body["template_id"] is None
    assert body["schedule"] is None
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_campaign_duplicate_name_allowed_returns_201(client: TestClient) -> None:
    """Las campañas NO tienen unicidad de nombre: duplicar sigue siendo 201."""
    payload, _ = _create_campaign(client)
    response = client.post(f"{_API}/campaigns", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201
    assert response.json()["name"] == payload["name"]


def test_campaign_update_partial(client: TestClient) -> None:
    """PUT parcial actualiza el estado e incrementa la revisión."""
    _, created = _create_campaign(client)

    response = client.put(
        f"{_API}/campaigns/{created['id']}",
        json={"state": "active"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "active"
    assert body["revision"] == 2


def test_campaign_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, created = _create_campaign(client)

    response = client.put(
        f"{_API}/campaigns/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=422,
        code="validation.input_error",
        operation="operations.campaign.update",
    )


def test_campaign_get_missing_returns_404(client: TestClient) -> None:
    """Pedir una campaña inexistente devuelve 404 con operation campaign.get."""
    response = client.get(f"{_API}/campaigns/{uuid.uuid4()}", headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.campaign.get",
    )


def test_campaign_update_missing_returns_404(client: TestClient) -> None:
    """Actualizar una campaña inexistente devuelve 404 con operation campaign.update."""
    response = client.put(
        f"{_API}/campaigns/{uuid.uuid4()}", json={"state": "active"}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.campaign.update",
    )


def test_campaign_delete_returns_204_then_404(client: TestClient) -> None:
    """Soft-delete devuelve 204 y la campaña deja de ser visible."""
    _, created = _create_campaign(client)

    response = client.delete(f"{_API}/campaigns/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 204

    after = client.get(f"{_API}/campaigns/{created['id']}", headers=TENANT_HEADERS)
    assert after.status_code == 404


def test_campaign_delete_missing_returns_404(client: TestClient) -> None:
    """Borrar una campaña inexistente devuelve 404 con operation campaign.delete."""
    response = client.delete(f"{_API}/campaigns/{uuid.uuid4()}", headers=TENANT_HEADERS)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.campaign.delete",
    )


def test_campaign_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        f"{_API}/campaigns",
        json={"name": f"campana-{_suffix()}"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_campaign_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve ni lista las campañas de dev-tenant."""
    _, created = _create_campaign(client, name="Privado")

    fetched = client.get(f"{_API}/campaigns/{created['id']}", headers=_other_tenant())
    _assert_error(
        fetched,
        status_code=404,
        code="resource.not_found",
        operation="operations.campaign.get",
    )

    listed = client.get(f"{_API}/campaigns", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_campaign_rejects_extra_fields(client: TestClient) -> None:
    """Campos no declarados son rechazados (extra='forbid')."""
    response = client.post(
        f"{_API}/campaigns",
        json={"name": f"campana-{_suffix()}", "unexpected": 1},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


def test_campaign_dispatch_returns_totals(client: TestClient) -> None:
    """Despacho manual devuelve totales y marca la campaña como completada."""
    _, campaign = _create_campaign(client, segment_type="event")
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch", headers=TENANT_HEADERS
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["campaigns_processed"] == 1
    assert body["recipients_sent"] == 0
    assert body["recipients_failed"] == 0
    assert body["recipients_skipped"] == 0

    fetched = client.get(f"{_API}/campaigns/{campaign['id']}", headers=TENANT_HEADERS)
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["state"] == "completed"


def test_campaign_dispatch_missing_returns_404(client: TestClient) -> None:
    """Despachar una campaña inexistente devuelve 404 con operation campaign.dispatch."""
    response = client.post(
        f"{_API}/campaigns/{uuid.uuid4()}/dispatch", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="campaign.dispatch",
    )


def test_campaign_dispatch_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no puede despachar las campañas de dev-tenant."""
    _, campaign = _create_campaign(client)
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/dispatch", headers=_other_tenant()
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="campaign.dispatch",
    )


# ---------------------------------------------------------------------------
# Destinatarios de campaña (B.4)
# ---------------------------------------------------------------------------


def _create_recipient(
    client: TestClient,
    campaign_id: str,
    contact_id: str,
    **overrides: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {"contact_id": contact_id, **overrides}
    response = client.post(
        f"{_API}/campaigns/{campaign_id}/recipients",
        json=payload,
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201, response.text
    return payload, response.json()


def test_recipient_create_returns_201_roundtrip(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Asocia un contacto a una campaña y devuelve la tupla sync inicial."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    payload, body = _create_recipient(client, campaign["id"], contact["id"])

    assert body["campaign_id"] == campaign["id"]
    assert body["contact_id"] == contact["id"]
    assert body["state"] == "pending"
    assert body["attempts"] == 0
    assert body["result"] is None
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_recipient_duplicate_returns_409(client: TestClient) -> None:
    """Un contacto es único por campaña: duplicar devuelve 409 por unicidad."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    payload, _ = _create_recipient(client, campaign["id"], contact["id"])

    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/recipients",
        json=payload,
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=409,
        code="resource.conflict",
        operation="resource.conflict",
    )


def test_recipient_list_by_campaign_returns_page(client: TestClient) -> None:
    """Lista paginada de destinatarios de una campaña del tenant activo."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    _, recipient = _create_recipient(client, campaign["id"], contact["id"])

    response = client.get(
        f"{_API}/campaigns/{campaign['id']}/recipients", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == recipient["id"] for item in body["items"])


def test_recipient_update_state_returns_revision_2(client: TestClient) -> None:
    """PUT parcial actualiza el estado del envío e incrementa la revisión."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    _, recipient = _create_recipient(client, campaign["id"], contact["id"])

    response = client.put(
        f"{_API}/recipients/{recipient['id']}",
        json={"state": "sent", "result": "delivered", "attempts": 1},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "sent"
    assert body["result"] == "delivered"
    assert body["attempts"] == 1
    assert body["revision"] == 2


def test_recipient_update_empty_payload_returns_422(client: TestClient) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    _, recipient = _create_recipient(client, campaign["id"], contact["id"])

    response = client.put(
        f"{_API}/recipients/{recipient['id']}", json={}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=422,
        code="validation.input_error",
        operation="operations.recipient.update",
    )


def test_recipient_update_missing_returns_404(client: TestClient) -> None:
    """Actualizar un destinatario inexistente devuelve 404 con operation recipient.update."""
    response = client.put(
        f"{_API}/recipients/{uuid.uuid4()}",
        json={"state": "sent"},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.recipient.update",
    )


def test_recipient_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/recipients",
        json={"contact_id": contact["id"]},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_recipient_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve los destinatarios de las campañas de dev-tenant."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    _create_recipient(client, campaign["id"], contact["id"])

    listed = client.get(
        f"{_API}/campaigns/{campaign['id']}/recipients", headers=_other_tenant()
    )
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_campaign_recipients_import_csv_creates(client: TestClient) -> None:
    """CSV con contact_id válido vincula el contacto como destinatario (created=1)."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    csv_text = f"contact_id\n{contact['id']}\n"
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/recipients/import-csv",
        json={"csv": csv_text, "delimiter": ","},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 1
    assert body["skipped"] == 0
    assert body["failed"] == 0
    assert body["errors"] == []

    listed = client.get(
        f"{_API}/campaigns/{campaign['id']}/recipients", headers=TENANT_HEADERS
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] >= 1


def test_campaign_recipients_import_csv_dedupes_existing(client: TestClient) -> None:
    """Un contacto ya vinculado a la campaña se omite (skipped)."""
    _, campaign = _create_campaign(client)
    _, contact = _create_contact(client)
    _create_recipient(client, campaign["id"], contact["id"])
    csv_text = f"contact_id\n{contact['id']}\n"
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/recipients/import-csv",
        json={"csv": csv_text, "delimiter": ","},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 0
    assert body["skipped"] == 1
    assert body["failed"] == 0
    assert body["errors"] == []


def test_campaign_recipients_import_csv_unknown_contact_fails_row(
    client: TestClient,
) -> None:
    """Un contact_id inexistente en el tenant se cuenta como failed con su error."""
    _, campaign = _create_campaign(client)
    csv_text = f"contact_id\n{uuid.uuid4()}\n"
    response = client.post(
        f"{_API}/campaigns/{campaign['id']}/recipients/import-csv",
        json={"csv": csv_text, "delimiter": ","},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 0
    assert body["skipped"] == 0
    assert body["failed"] == 1
    assert len(body["errors"]) == 1
    assert "contacto no encontrado" in body["errors"][0]


def test_campaign_recipients_import_csv_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la importación (aislamiento)."""
    response = client.post(
        f"{_API}/campaigns/{uuid.uuid4()}/recipients/import-csv",
        json={"csv": "contact_id\nxxx\n"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


# ---------------------------------------------------------------------------
# Intervención humana (B.7)
# ---------------------------------------------------------------------------


def _create_intervention(
    client: TestClient, conversation_id: uuid.UUID, **overrides: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload: dict[str, Any] = {
        "conversation_id": str(conversation_id),
        **overrides,
    }
    response = client.post(f"{_API}/interventions", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 201, response.text
    return payload, response.json()


@contextlib.contextmanager
def _fake_queue_service(client: TestClient, container: Container) -> Iterator[FakeQueue]:
    """Sustituye ``get_bot_queue_service`` por una cola en memoria (BD real)."""
    fake_queue = FakeQueue()
    service = BotQueueService(
        database=container.database,
        queue=fake_queue,
        message_repository_factory=SqlAlchemyBotMessageRepository,
        conversation_repository_factory=SqlAlchemyBotConversationRepository,
        queue_meta_repository_factory=SqlAlchemyBotQueueMetaRepository,
        settings=container.settings,
        logger=FakeLogger(),
    )
    client.app.dependency_overrides[get_bot_queue_service] = lambda: service
    try:
        yield fake_queue
    finally:
        client.app.dependency_overrides.pop(get_bot_queue_service, None)


def test_intervention_create_returns_201_roundtrip(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Crea una intervención sobre una conversación real y valida la tupla sync."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, body = _create_intervention(
        client, conversation_id, operator="Operador A", notes="En cola"
    )

    assert body["conversation_id"] == str(conversation_id)
    assert body["state"] == "pending"
    assert body["operator"] == "Operador A"
    assert body["notes"] == "En cola"
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == str(tenant_id)
    assert body["id"]


def test_intervention_duplicate_conversation_allowed_returns_201(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Las intervenciones NO tienen unicidad por conversación: duplicar es 201."""
    conversation_id = _create_conversation(db_session, tenant_id)
    payload, _ = _create_intervention(client, conversation_id)
    response = client.post(
        f"{_API}/interventions", json=payload, headers=TENANT_HEADERS
    )
    assert response.status_code == 201


def test_intervention_list_filters_by_state(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Lista filtrada por estado: incluye la intervención pendiente creada."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.get(
        f"{_API}/interventions", params={"state": "pending"}, headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_intervention_get_roundtrip(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """GET por id devuelve la intervención creada."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.get(
        f"{_API}/interventions/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["conversation_id"] == str(conversation_id)


def test_intervention_update_resolves_returns_revision_2(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """PUT resuelve la intervención e incrementa la revisión."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.put(
        f"{_API}/interventions/{created['id']}",
        json={"state": "resolved", "operator": "Operador A", "notes": "Cerrado"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "resolved"
    assert body["operator"] == "Operador A"
    assert body["notes"] == "Cerrado"
    assert body["revision"] == 2


def test_intervention_update_empty_payload_returns_422(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Un PUT sin campos es un error de entrada (422 validation.input_error)."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.put(
        f"{_API}/interventions/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=422,
        code="validation.input_error",
        operation="operations.intervention.update",
    )


def test_intervention_get_missing_returns_404(client: TestClient) -> None:
    """Pedir una intervención inexistente devuelve 404 con operation intervention.get."""
    response = client.get(
        f"{_API}/interventions/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.get",
    )


def test_intervention_update_missing_returns_404(client: TestClient) -> None:
    """Actualizar una intervención inexistente devuelve 404 con operation intervention.update."""
    response = client.put(
        f"{_API}/interventions/{uuid.uuid4()}",
        json={"state": "resolved"},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.update",
    )


def test_intervention_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la creación (aislamiento)."""
    response = client.post(
        f"{_API}/interventions",
        json={"conversation_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_intervention_cross_tenant_isolation(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Un tenant aislado no ve ni lista las intervenciones de dev-tenant."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    fetched = client.get(
        f"{_API}/interventions/{created['id']}", headers=_other_tenant()
    )
    _assert_error(
        fetched,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.get",
    )

    listed = client.get(f"{_API}/interventions", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []


def test_intervention_pending_count_reflects_pending(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """El contador de pendientes incluye las intervenciones recién creadas."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _create_intervention(client, conversation_id)

    response = client.get(
        f"{_API}/interventions/pending-count", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "pending"
    assert body["count"] >= 1


def test_intervention_pending_count_is_tenant_scoped(client: TestClient) -> None:
    """Un tenant fresco sin intervenciones ve un contador a cero."""
    response = client.get(
        f"{_API}/interventions/pending-count", headers=_other_tenant()
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "pending"
    assert body["count"] == 0


def test_intervention_pending_count_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega el contador (aislamiento)."""
    response = client.get(
        f"{_API}/interventions/pending-count",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_intervention_assign_returns_assigned(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Asignar a un operador pasa la intervención a assigned (revisión 2)."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.post(
        f"{_API}/interventions/{created['id']}/assign",
        json={"operator": "Operador A"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["state"] == "assigned"
    assert body["operator"] == "Operador A"
    assert body["assigned_at"] is not None
    assert body["revision"] == 2


def test_intervention_assign_missing_returns_404(client: TestClient) -> None:
    """Asignar una intervención inexistente devuelve 404 con operation assign."""
    response = client.post(
        f"{_API}/interventions/{uuid.uuid4()}/assign",
        json={"operator": "Operador A"},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.assign",
    )


def test_intervention_assign_rejects_extra_fields(client: TestClient) -> None:
    """Campos no permitidos en el payload de asignación devuelven 422."""
    response = client.post(
        f"{_API}/interventions/{uuid.uuid4()}/assign",
        json={"operator": "Operador A", "extra": 1},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


def test_intervention_assign_missing_operator_returns_422(client: TestClient) -> None:
    """Sin ``operator`` el payload de asignación es inválido (422)."""
    response = client.post(
        f"{_API}/interventions/{uuid.uuid4()}/assign",
        json={},
        headers=TENANT_HEADERS,
    )
    _assert_request_error(response)


def test_intervention_messages_returns_history(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Lista el historial de chat de la conversación de la intervención."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    db_session.add(
        BotMessage(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            direction="inbound",
            content="Hola, necesito ayuda",
            message_id=str(uuid.uuid4()),
            queue_status="pending",
        )
    )
    db_session.commit()

    response = client.get(
        f"{_API}/interventions/{created['id']}/messages", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body
    assert any(
        item["direction"] == "inbound"
        and item["content"] == "Hola, necesito ayuda"
        for item in body
    )


def test_intervention_messages_missing_returns_404(client: TestClient) -> None:
    """Historial de una intervención inexistente devuelve 404 (operation messages)."""
    response = client.get(
        f"{_API}/interventions/{uuid.uuid4()}/messages", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.messages",
    )


def test_intervention_messages_cross_tenant_returns_404(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """El historial es fail-closed: otro tenant recibe 404 (operation messages)."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.get(
        f"{_API}/interventions/{created['id']}/messages", headers=_other_tenant()
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.messages",
    )


def test_intervention_reply_enqueues_outbound(
    client: TestClient,
    container: Container,
    db_session: Session,
    tenant_id: uuid.UUID,
) -> None:
    """Responder encola un mensaje saliente en la cola D3 (direction outbound)."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    with _fake_queue_service(client, container):
        response = client.post(
            f"{_API}/interventions/{created['id']}/reply",
            json={"content": "Respuesta del operador"},
            headers=TENANT_HEADERS,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["direction"] == "outbound"
    assert body["content"] == "Respuesta del operador"
    assert body["queue_status"] == "pending"
    assert body["message_id"]
    assert body["conversation_id"] == str(conversation_id)


def test_intervention_reply_missing_returns_404(client: TestClient) -> None:
    """Responder a una intervención inexistente devuelve 404 (operation reply)."""
    response = client.post(
        f"{_API}/interventions/{uuid.uuid4()}/reply",
        json={"content": "Hola"},
        headers=TENANT_HEADERS,
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.reply",
    )


def test_intervention_close_returns_resolved(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Cerrar una intervención la marca como resuelta (revisión 2)."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.post(
        f"{_API}/interventions/{created['id']}/close", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["intervention_id"] == created["id"]
    assert body["state"] == "resolved"
    assert body["resolved_at"] is not None
    assert body["message"] == "Intervención cerrada"


def test_intervention_close_missing_returns_404(client: TestClient) -> None:
    """Cerrar una intervención inexistente devuelve 404 (operation close)."""
    response = client.post(
        f"{_API}/interventions/{uuid.uuid4()}/close", headers=TENANT_HEADERS
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.close",
    )


def test_intervention_close_cross_tenant_returns_404(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """El cierre es fail-closed: otro tenant recibe 404 (operation close)."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _, created = _create_intervention(client, conversation_id)

    response = client.post(
        f"{_API}/interventions/{created['id']}/close", headers=_other_tenant()
    )
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.intervention.close",
    )


# ---------------------------------------------------------------------------
# Monitor — Conversaciones activas (Fase 7)
# ---------------------------------------------------------------------------


def _create_message(
    db_session: Session,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    direction: str,
    content: str,
) -> None:
    """Crea un mensaje real del bot para la conversación (Fase 7)."""
    message = BotMessage(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        direction=direction,
        content=content,
        message_id=str(uuid.uuid4()),
        queue_status="pending",
    )
    db_session.add(message)
    db_session.flush()
    conversation = db_session.get(BotConversation, conversation_id)
    if conversation is not None:
        conversation.last_message_at = message.created_at
    db_session.commit()


def test_active_conversations_returns_page(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Lista las conversaciones activas con su vista de negocio agregada."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _create_message(
        db_session, tenant_id, conversation_id, direction="inbound", content="Hola"
    )
    _create_message(
        db_session, tenant_id, conversation_id, direction="outbound", content="Adiós"
    )

    response = client.get(
        f"{_API}/monitor/active-conversations", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    item = next(
        (i for i in body["items"] if i["id"] == str(conversation_id)), None
    )
    assert item is not None
    assert item["state"] == "new"
    assert item["is_active"] is True
    assert item["message_count"] == 2
    assert item["unread_count"] == 0
    assert item["last_message_content"] == "Adiós"
    assert item["last_message_direction"] == "outbound"


def test_active_conversations_unread_counts_inbound_after_outbound(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Los no leídos son los entrantes posteriores al último saliente."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _create_message(
        db_session, tenant_id, conversation_id, direction="inbound", content="1"
    )
    _create_message(
        db_session, tenant_id, conversation_id, direction="outbound", content="2"
    )
    _create_message(
        db_session, tenant_id, conversation_id, direction="inbound", content="3"
    )
    _create_message(
        db_session, tenant_id, conversation_id, direction="inbound", content="4"
    )

    response = client.get(
        f"{_API}/monitor/active-conversations", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    item = next(
        (i for i in body["items"] if i["id"] == str(conversation_id)), None
    )
    assert item is not None
    assert item["message_count"] == 4
    assert item["unread_count"] == 2
    assert item["last_message_content"] == "4"
    assert item["last_message_direction"] == "inbound"


def test_active_conversations_inactive_without_messages(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Una conversación sin mensajes aparece como inactiva (is_active False)."""
    conversation_id = _create_conversation(db_session, tenant_id)

    # La conversación sin mensajes tiene ``last_message_at`` NULL y se ordena al
    # final (nullslast). Como la BD es compartida entre toda la suite (session
    # scope) y el tenant acumula conversaciones con mensajes de otros tests,
    # recorremos todas las páginas (page_size máximo 100) hasta localizarla.
    page = 1
    item = None
    while True:
        response = client.get(
            f"{_API}/monitor/active-conversations",
            params={"page": page, "page_size": 100},
            headers=TENANT_HEADERS,
        )
        assert response.status_code == 200
        body = response.json()
        item = next(
            (i for i in body["items"] if i["id"] == str(conversation_id)), None
        )
        if item is not None or not body["items"]:
            break
        page += 1

    assert item is not None
    assert item["is_active"] is False
    assert item["message_count"] == 0
    assert item["unread_count"] == 0
    assert item["last_message_content"] is None


def test_active_conversations_cross_tenant_isolation(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """Otro tenant no ve las conversaciones activas del tenant de desarrollo."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _create_message(
        db_session, tenant_id, conversation_id, direction="inbound", content="Hola"
    )

    response = client.get(
        f"{_API}/monitor/active-conversations", headers=_other_tenant()
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []


def test_active_conversations_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera ``X-Tenant-Id`` el endpoint devuelve 403 (tenant.resolve)."""
    response = client.get(
        f"{_API}/monitor/active-conversations",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_active_conversations_pagination(
    client: TestClient, db_session: Session, tenant_id: uuid.UUID
) -> None:
    """La paginación respeta page/page_size y devuelve la página pedida."""
    conversation_id = _create_conversation(db_session, tenant_id)
    _create_message(
        db_session, tenant_id, conversation_id, direction="inbound", content="Hola"
    )

    response = client.get(
        f"{_API}/monitor/active-conversations",
        params={"page": 1, "page_size": 5},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 5
    assert body["total"] >= 1
    assert any(item["id"] == str(conversation_id) for item in body["items"])


# ---------------------------------------------------------------------------
# Mantenimiento (B.9)
# ---------------------------------------------------------------------------


def test_maintenance_get_unset_returns_404(client: TestClient) -> None:
    """Sin configuración previa, GET de mantenimiento devuelve 404."""
    headers, _ = _maintenance_tenant()
    response = client.get(f"{_API}/maintenance", headers=headers)
    _assert_error(
        response,
        status_code=404,
        code="resource.not_found",
        operation="operations.maintenance.get",
    )


def test_maintenance_put_creates_then_get_roundtrip(client: TestClient) -> None:
    """PUT (200) crea la configuración; GET la devuelve con la tupla sync inicial."""
    headers, tenant_uuid = _maintenance_tenant()
    payload = {
        "retention_rules": {"conversations_days": 30, "messages_days": 90},
        "maintenance_schedule": "0 3 * * *",
    }

    response = client.put(f"{_API}/maintenance", json=payload, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["retention_rules"] == payload["retention_rules"]
    assert body["maintenance_schedule"] == payload["maintenance_schedule"]
    assert body["revision"] == 1
    assert body["version"] == 1
    assert body["tenant_id"] == tenant_uuid
    assert body["id"]

    fetched = client.get(f"{_API}/maintenance", headers=headers)
    assert fetched.status_code == 200
    fetched_body = fetched.json()
    assert fetched_body["id"] == body["id"]
    assert fetched_body["revision"] == 1
    assert fetched_body["retention_rules"] == payload["retention_rules"]


def test_maintenance_put_is_idempotent_same_row(client: TestClient) -> None:
    """Un segundo PUT actualiza la misma fila e incrementa la revisión."""
    headers, _ = _maintenance_tenant()

    first = client.put(
        f"{_API}/maintenance", json={"retention_rules": {"a": 1}}, headers=headers
    )
    assert first.status_code == 200
    first_id = first.json()["id"]

    second = client.put(
        f"{_API}/maintenance",
        json={"retention_rules": {"a": 1, "b": 2}, "maintenance_schedule": "0 2 * * *"},
        headers=headers,
    )
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["id"] == first_id
    assert second_body["revision"] == 2
    assert second_body["retention_rules"] == {"a": 1, "b": 2}


def test_maintenance_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega el upsert (aislamiento)."""
    response = client.put(
        f"{_API}/maintenance",
        json={"retention_rules": {}},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)


def test_maintenance_purge_returns_result(client: TestClient) -> None:
    """POST purge reutiliza la purga por retención y devuelve el resultado."""
    headers, tenant_uuid = _maintenance_tenant()
    response = client.post(
        f"{_API}/maintenance/purge",
        headers=headers,
        json={"scope": "conversations"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant_id"] == tenant_uuid
    assert body["action"] == "purge"
    assert body["deleted_conversations"] >= 0
    assert body["deleted_messages"] >= 0
    assert "Purga" in body["message"]


def test_maintenance_optimize_returns_result(client: TestClient) -> None:
    """POST optimize ejecuta VACUUM + REINDEX y devuelve la duración."""
    headers, tenant_uuid = _maintenance_tenant()
    response = client.post(f"{_API}/maintenance/optimize", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant_id"] == tenant_uuid
    assert body["action"] == "optimize"
    assert body["duration_ms"] >= 0
    assert "Optimización" in body["message"]


def test_maintenance_actions_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniegan la purga y la optimización."""
    purge = client.post(
        f"{_API}/maintenance/purge",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(purge)
    optimize = client.post(
        f"{_API}/maintenance/optimize",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(optimize)


# ---------------------------------------------------------------------------
# Backup / Restaurar (B.9)
# ---------------------------------------------------------------------------


def test_maintenance_backup_restore_roundtrip(client: TestClient) -> None:
    """Descarga un backup y lo restaura en el mismo tenant (round-trip B.9)."""
    headers, tenant_uuid = _maintenance_tenant()

    # 1) Crear datos de operación vía API (contacto + plantilla) en el MISMO
    #    tenant del backup (el helper _create_contact usa el tenant por defecto).
    contact_payload = {
        "phone": f"52155{_suffix()}",
        "name": "Backup",
        "tags": ["bkp"],
    }
    contact_response = client.post(
        f"{_API}/contacts", json=contact_payload, headers=headers
    )
    assert contact_response.status_code == 201, contact_response.text
    template_payload = {
        "name": f"Plantilla-{_suffix()}",
        "body": "Hola {{nombre}}",
        "template_type": "text",
    }
    template_response = client.post(
        f"{_API}/templates", json=template_payload, headers=headers
    )
    assert template_response.status_code == 201, template_response.text
    template_body = template_response.json()

    # 2) Descargar el backup (StreamingResponse octet-stream + cabecera meta).
    backup = client.get(f"{_API}/maintenance/backup", headers=headers)
    assert backup.status_code == 200, backup.text
    assert backup.headers["content-type"].startswith("application/octet-stream")
    assert "X-Backup-Meta" in backup.headers
    payload = backup.content
    assert payload

    # 3) Restaurar el backup vía multipart.
    restore = client.post(
        f"{_API}/maintenance/restore",
        headers=headers,
        files={"file": ("backup.json", payload, "application/octet-stream")},
    )
    assert restore.status_code == 200, restore.text
    body = restore.json()
    assert body["tenant_id"] == tenant_uuid
    assert body["restored"]["bot_contacts"] == 1
    assert body["restored"]["bot_templates"] == 1
    assert "Backup restaurado" in body["message"]

    # 4) Verificar que los datos siguen presentes tras el restore.
    contacts = client.get(f"{_API}/contacts", headers=headers).json()
    assert any(c["phone"] == contact_payload["phone"] for c in contacts["items"])
    templates = client.get(f"{_API}/templates", headers=headers).json()
    assert any(t["id"] == template_body["id"] for t in templates["items"])


def test_maintenance_backup_restore_cross_tenant_isolation(
    client: TestClient,
) -> None:
    """Un backup de un tenant no puede restaurarse en otro (aislamiento)."""
    source_headers, source_uuid = _maintenance_tenant()
    target_headers, _ = _maintenance_tenant()

    _create_contact(client, phone=f"52155{_suffix()}", name="Origen")
    backup = client.get(f"{_API}/maintenance/backup", headers=source_headers)
    assert backup.status_code == 200, backup.text

    restore = client.post(
        f"{_API}/maintenance/restore",
        headers=target_headers,
        files={"file": ("backup.json", backup.content, "application/octet-stream")},
    )
    _assert_error(
        restore,
        status_code=422,
        code="validation.input_error",
        operation="operations.maintenance.backup.restore",
    )
    assert "otro tenant" in restore.json()["error"]["message"]


def test_maintenance_backup_restore_invalid_json_returns_422(
    client: TestClient,
) -> None:
    """Restaurar un archivo que no es JSON devuelve 422."""
    headers, _ = _maintenance_tenant()
    restore = client.post(
        f"{_API}/maintenance/restore",
        headers=headers,
        files={"file": ("backup.json", b"no-json", "application/octet-stream")},
    )
    _assert_error(
        restore,
        status_code=422,
        code="validation.input_error",
        operation="operations.maintenance.backup.restore",
    )


def test_maintenance_backup_restore_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniegan backup y restore."""
    backup = client.get(
        f"{_API}/maintenance/backup",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(backup)
    restore = client.post(
        f"{_API}/maintenance/restore",
        files={"file": ("backup.json", b"{}", "application/octet-stream")},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(restore)


# ---------------------------------------------------------------------------
# Estadísticas del bot (B.1 Dashboard + B.2 Estadísticas)
# ---------------------------------------------------------------------------


def _stats_tenant() -> tuple[dict[str, str], uuid.UUID]:
    """Tenant aleatorio fresco para B.1/B.2 (agregados deterministas)."""
    tenant_uuid = uuid.uuid4()
    return {"X-Tenant-Id": str(tenant_uuid), **_AUTH}, tenant_uuid


def _seed_stats_data(
    db_session: Session, tenant_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    """Siembra canales, conversaciones, mensajes e intervenciones (B.1/B.2).

    Devuelve ``(channel_a_id, channel_b_id)``. El canal B tiene una
    conversación sin mensajes (probar ``by_channel`` con conteo 0).
    """
    channel_a = TenantChannel(
        tenant_id=tenant_id,
        channel_type="whatsapp",
        external_id=f"waba-{_suffix()}",
        phone_number=f"52155{_suffix()}",
        phone_number_id=f"pid-{_suffix()}",
        encrypted_access_token="",
        encrypted_webhook_secret="",
        enabled=True,
    )
    channel_b = TenantChannel(
        tenant_id=tenant_id,
        channel_type="instagram",
        external_id=f"ig-{_suffix()}",
        phone_number=f"52155{_suffix()}",
        phone_number_id=f"pid-{_suffix()}",
        encrypted_access_token="",
        encrypted_webhook_secret="",
        enabled=True,
    )
    db_session.add_all([channel_a, channel_b])
    db_session.flush()

    conversation = BotConversation(
        tenant_id=tenant_id,
        channel_id=channel_a.id,
        external_contact_id=f"ext-{_suffix()}",
        state="active",
    )
    conversation_sin_mensajes = BotConversation(
        tenant_id=tenant_id,
        channel_id=channel_b.id,
        external_contact_id=f"ext-{_suffix()}",
        state="new",
    )
    db_session.add_all([conversation, conversation_sin_mensajes])
    db_session.flush()

    db_session.add_all(
        [
            BotMessage(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction="inbound",
                content="hola",
            ),
            BotMessage(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction="inbound",
                content="¿precio?",
            ),
            BotMessage(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction="outbound",
                content="te paso la cotización",
            ),
        ]
    )
    db_session.add_all(
        [
            BotIntervention(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                state="pending",
            ),
            BotIntervention(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                state="resolved",
                operator="operador-1",
            ),
        ]
    )
    db_session.commit()
    return channel_a.id, channel_b.id


def test_stats_overview_returns_aggregates(
    client: TestClient, db_session: Session
) -> None:
    """El overview agrega conversaciones, mensajes e intervenciones (B.1 + B.2)."""
    headers, tenant_uuid = _stats_tenant()
    channel_a, channel_b = _seed_stats_data(db_session, tenant_uuid)

    response = client.get(f"{_API}/stats/overview", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant_id"] == str(tenant_uuid)
    assert body["active_conversations"] == 2
    assert body["inbound_messages"] == 2
    assert body["outbound_messages"] == 1
    assert body["total_messages"] == 3
    assert body["escalated"] == 2
    assert body["resolved"] == 1
    assert body["resolved_ratio"] == 0.5
    assert body["unique_contacts"] == 2
    assert len(body["daily"]) == 1
    day = body["daily"][0]
    assert day["date"] == datetime.now(UTC).date().isoformat()
    assert day["inbound"] == 2
    assert day["outbound"] == 1
    assert day["total"] == 3
    by_channel = {row["channel_id"]: row for row in body["by_channel"]}
    assert set(by_channel) == {str(channel_a), str(channel_b)}
    assert by_channel[str(channel_a)]["conversation_count"] == 1
    assert by_channel[str(channel_a)]["message_count"] == 3
    assert by_channel[str(channel_b)]["conversation_count"] == 1
    assert by_channel[str(channel_b)]["message_count"] == 0


def test_stats_overview_empty_tenant_returns_zeros(client: TestClient) -> None:
    """Tenant sin actividad: KPIs en cero, series vacías y ratio 0.0."""
    headers, _ = _stats_tenant()
    response = client.get(f"{_API}/stats/overview", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["active_conversations"] == 0
    assert body["inbound_messages"] == 0
    assert body["outbound_messages"] == 0
    assert body["total_messages"] == 0
    assert body["escalated"] == 0
    assert body["resolved"] == 0
    assert body["resolved_ratio"] == 0.0
    assert body["unique_contacts"] == 0
    assert body["daily"] == []
    assert body["by_channel"] == []


def test_stats_overview_cross_tenant_isolation(
    client: TestClient, db_session: Session
) -> None:
    """Los agregados no filtran actividad de otros tenants (aislamiento)."""
    headers_a, tenant_a = _stats_tenant()
    _seed_stats_data(db_session, tenant_a)
    headers_b, _ = _stats_tenant()

    response = client.get(f"{_API}/stats/overview", headers=headers_b)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["active_conversations"] == 0
    assert body["total_messages"] == 0
    assert body["escalated"] == 0
    assert body["unique_contacts"] == 0
    assert body["daily"] == []
    assert body["by_channel"] == []


def test_stats_overview_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega el overview (aislamiento)."""
    response = client.get(
        f"{_API}/stats/overview",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    _assert_missing_tenant_header(response)
