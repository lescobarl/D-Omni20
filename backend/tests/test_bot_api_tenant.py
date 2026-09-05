"""Pruebas de integración de los endpoints tenant-scoped del bot (Fase 7).

Cubre el visor de conversaciones y mensajes, el envío manual de prueba, el
CRUD de proveedores de IA por empresa (sin exponer secretos) y el monitor de
cola D3 (``/bot/queue/tenant-stats``).

La suite comparte un SQLite session-scoped, por lo que los tests de conteos
exactos usan tenants hermeticos (``uuid`` aleatorio) para aislarse del resto
de tests y evitar aserciones flaky por datos acumulados de ``dev-tenant``.
"""
from __future__ import annotations

import contextlib
import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

from app.api.deps import get_bot_queue_service, get_conversation_service
from app.bot.models import BotCompanyProvider, BotConversation, BotMessage
from app.bot.queue.service import (
    CONVERSATION_STATE_ACTIVE,
    DIRECTION_INBOUND,
    DIRECTION_OUTBOUND,
    QUEUE_FAILED,
    QUEUE_PENDING,
    QUEUE_SENT,
    BotQueueService,
)
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotProviderRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.core.di import Container
from app.models.tenant_config import TenantChannel
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyKeywordRepository,
    SqlAlchemyTenantChannelRepository,
)
import pytest
from fastapi.testclient import TestClient

from tests.test_bot_queue import FakeLogger, FakeQueue

BOT_API = "/api/v1/bot"
TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}
_PROVIDER_SECRET_KEYS = ("api_key", "api_key_ref")

# Cabeceras de autorización compartidas: el autouse las rellena con el token
# super-admin. Los endpoints /bot requieren ADMIN/CONFIGURADOR y el super-admin
# omite la comprobación de membresía, por lo que vale para tenants frescos.
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    """Añade el Bearer del super-admin a las cabeceras por defecto (RBAC)."""
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"


def _other_tenant() -> dict[str, str]:
    """Headers con un tenant aleatorio que nunca tiene datos (aislamiento)."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _assert_no_secrets(body: Any) -> None:
    """Recorre el JSON y falla si encuentra una clave de secretos del proveedor."""
    if isinstance(body, dict):
        for key, value in body.items():
            assert key not in _PROVIDER_SECRET_KEYS, f"secreto expuesto: {key}"
            _assert_no_secrets(value)
    elif isinstance(body, list):
        for item in body:
            _assert_no_secrets(item)


def _create_channel(container: Container, tenant_id: uuid.UUID) -> TenantChannel:
    """Crea un canal WhatsApp real en el SQLite compartido (secretos únicos)."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantChannelRepository(session, cipher=container.token_cipher)
        return repo.create(
            tenant_id=tenant_id,
            channel_type="whatsapp",
            external_id=f"wa-f7-{uuid.uuid4().hex}",
            phone_number="5215500000000",
            phone_number_id=f"f7-{uuid.uuid4().hex}",
            access_token=f"EAAG-f7-{uuid.uuid4().hex}",
            webhook_secret=f"secret-{uuid.uuid4().hex}",
            enabled=True,
        )


def _create_conversation(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    external_contact_id: str | None = None,
) -> tuple[BotConversation, TenantChannel]:
    """Crea una conversación activa vinculada a un canal real (tenant hermetico)."""
    channel = _create_channel(container, tenant_id)
    contact = external_contact_id or f"5215f7-{uuid.uuid4().hex[:10]}"
    with container.database.session_scope() as session:
        repository = SqlAlchemyBotConversationRepository(session)
        conversation = repository.upsert(
            tenant_id=tenant_id,
            channel_id=channel.id,
            external_contact_id=contact,
            state=CONVERSATION_STATE_ACTIVE,
            last_message_at=None,
        )
        return conversation, channel


def _create_message(
    container: Container,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    direction: str = DIRECTION_INBOUND,
    content: str = "Hola",
    queue_status: str = QUEUE_PENDING,
) -> BotMessage:
    """Siembra un mensaje del bot directamente en el SQLite compartido."""
    with container.database.session_scope() as session:
        repository = SqlAlchemyBotMessageRepository(session)
        return repository.create(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            direction=direction,
            content=content,
            provider_used=None,
            tokens_used=0,
            message_id=f"wamid.f7.{uuid.uuid4().hex}",
            queue_status=queue_status,
        )


def _provider_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido de un proveedor de IA (Fase 7) sin secretos."""
    payload: dict[str, Any] = {
        "provider_kind": "openai",
        "order": 0,
        "enabled": True,
        "model": "gpt-4o",
        "temperature": "0.7",
        "prompt_base": "Eres un asistente de ventas.",
    }
    payload.update(overrides)
    return payload


def _create_provider(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    provider_kind: str = "openai",
    order: int = 0,
    enabled: bool = True,
    model: str | None = None,
    temperature: Decimal | None = None,
    api_key_ref: str = "",
    prompt_base: str = "",
) -> BotCompanyProvider:
    """Siembra un proveedor de IA directamente en el SQLite compartido."""
    with container.database.session_scope() as session:
        repository = SqlAlchemyBotProviderRepository(session)
        return repository.upsert(
            tenant_id=tenant_id,
            provider_kind=provider_kind,
            order=order,
            enabled=enabled,
            model=model,
            temperature=temperature,
            api_key_ref=api_key_ref,
            prompt_base=prompt_base,
        )


@contextlib.contextmanager
def _fake_queue_service(client: TestClient, container: Container) -> Iterator[FakeQueue]:
    """Sustituye ``get_bot_queue_service`` por una cola en memoria (BD real).

    El servicio construido persiste en el SQLite compartido pero encola en el
    ``FakeQueue``: cubre la ruta completa BD → cola D3 sin depender de Redis.
    """
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


# ---------------------------------------------------------------------------
# Visor de conversaciones
# ---------------------------------------------------------------------------


def test_conversations_empty_returns_empty_page(client: TestClient) -> None:
    """Un tenant sin conversaciones recibe una página vacía (tenant hermetico)."""
    response = client.get(f"{BOT_API}/conversations", headers=_other_tenant())
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []
    assert body["page"] == 1
    assert body["page_size"] == 20


def test_conversations_list_returns_page(
    client: TestClient, container: Container
) -> None:
    """Las conversaciones creadas se listan con sus datos (tenant hermetico)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    conversation, channel = _create_conversation(container, tenant)

    response = client.get(f"{BOT_API}/conversations", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 20
    item = body["items"][0]
    assert item["id"] == str(conversation.id)
    assert item["tenant_id"] == str(tenant)
    assert item["channel_id"] == str(channel.id)
    assert item["external_contact_id"] == conversation.external_contact_id
    assert item["state"] == "active"
    assert item["created_at"] is not None
    _assert_no_secrets(item)


def test_conversations_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin ``X-Tenant-Id`` el tenant no se resuelve (aislamiento RLS)."""
    response = client.get(
        f"{BOT_API}/conversations",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_conversations_cross_tenant_isolation(
    client: TestClient, container: Container
) -> None:
    """Un tenant ajeno no ve las conversaciones de otro (aislamiento)."""
    conversation, _ = _create_conversation(container, uuid.uuid4())

    response = client.get(f"{BOT_API}/conversations", headers=_other_tenant())
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []
    assert conversation.id is not None


# ---------------------------------------------------------------------------
# Mensajes de una conversación
# ---------------------------------------------------------------------------


def test_messages_empty_returns_empty_list(
    client: TestClient, container: Container
) -> None:
    """Una conversación sin mensajes devuelve una lista vacía (tenant hermetico)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    conversation, _ = _create_conversation(container, tenant)

    response = client.get(
        f"{BOT_API}/conversations/{conversation.id}/messages", headers=headers
    )
    assert response.status_code == 200
    assert response.json() == []


def test_messages_roundtrip(client: TestClient, container: Container) -> None:
    """Mensajes entrantes y salientes se listan con su estado (tenant hermetico)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    conversation, _ = _create_conversation(container, tenant)
    _create_message(
        container,
        tenant,
        conversation.id,
        direction=DIRECTION_INBOUND,
        content="Hola",
    )
    _create_message(
        container,
        tenant,
        conversation.id,
        direction=DIRECTION_OUTBOUND,
        content="¿En qué puedo ayudarte?",
    )

    response = client.get(
        f"{BOT_API}/conversations/{conversation.id}/messages", headers=headers
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert {item["direction"] for item in body} == {"inbound", "outbound"}
    assert all(item["conversation_id"] == str(conversation.id) for item in body)
    assert all(item["queue_status"] == "pending" for item in body)
    assert {item["content"] for item in body} == {"Hola", "¿En qué puedo ayudarte?"}


def test_messages_missing_conversation_returns_404(client: TestClient) -> None:
    """Una conversación inexistente devuelve 404 con la operación correcta."""
    response = client.get(
        f"{BOT_API}/conversations/{uuid.uuid4()}/messages", headers=_other_tenant()
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "bot.conversations.messages"


def test_messages_cross_tenant_returns_404(
    client: TestClient, container: Container
) -> None:
    """Un tenant ajeno no puede leer los mensajes de otro (aislamiento, 404)."""
    tenant = uuid.uuid4()
    conversation, _ = _create_conversation(container, tenant)
    _create_message(container, tenant, conversation.id)

    response = client.get(
        f"{BOT_API}/conversations/{conversation.id}/messages", headers=_other_tenant()
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "bot.conversations.messages"


# ---------------------------------------------------------------------------
# Envío manual de prueba
# ---------------------------------------------------------------------------


def test_send_message_returns_202_accepted(
    client: TestClient, container: Container
) -> None:
    """El envío manual encola el mensaje saliente y lo persiste (BD + cola D3)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    conversation, _ = _create_conversation(container, tenant)

    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            f"{BOT_API}/conversations/{conversation.id}/messages",
            headers=headers,
            json={"content": "Hola de prueba"},
        )
    assert response.status_code == 202
    body = response.json()
    assert body["conversation_id"] == str(conversation.id)
    assert body["direction"] == "outbound"
    assert body["queue_status"] == "pending"
    assert body["accepted"] is True
    assert body["message_id"]

    stream = f"bot:queue:{tenant}"
    assert len(fake_queue.entries.get(stream, [])) == 1
    with container.database.session_scope() as session:
        row = SqlAlchemyBotMessageRepository(session).get_by_message_id(
            tenant_id=tenant, message_id=body["message_id"]
        )
        assert row is not None
        assert row.direction == "outbound"
        assert row.queue_status == "pending"
        assert row.content == "Hola de prueba"


def test_send_message_missing_conversation_returns_404(client: TestClient) -> None:
    """Enviar a una conversación inexistente devuelve 404 (sin encolar)."""
    response = client.post(
        f"{BOT_API}/conversations/{uuid.uuid4()}/messages",
        headers=_other_tenant(),
        json={"content": "Hola"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "bot.conversations.send"


def test_send_message_cross_tenant_returns_404(
    client: TestClient, container: Container
) -> None:
    """Un tenant ajeno no puede enviar en conversaciones de otro (aislamiento)."""
    tenant = uuid.uuid4()
    conversation, _ = _create_conversation(container, tenant)

    response = client.post(
        f"{BOT_API}/conversations/{conversation.id}/messages",
        headers=_other_tenant(),
        json={"content": "Hola"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "bot.conversations.send"


def test_send_message_empty_content_returns_422(client: TestClient) -> None:
    """Contenido vacío no pasa la validación del esquema (422)."""
    response = client.post(
        f"{BOT_API}/conversations/{uuid.uuid4()}/messages",
        headers=TENANT_HEADERS,
        json={"content": ""},
    )
    assert response.status_code == 422


def test_send_message_extra_fields_returns_422(client: TestClient) -> None:
    """Campos extra son rechazados (``extra=forbid`` en ``MessageCreate``)."""
    response = client.post(
        f"{BOT_API}/conversations/{uuid.uuid4()}/messages",
        headers=TENANT_HEADERS,
        json={"content": "Hola", "extra": True},
    )
    assert response.status_code == 422


def test_send_message_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin ``X-Tenant-Id`` el tenant no se resuelve (aislamiento RLS)."""
    response = client.post(
        f"{BOT_API}/conversations/{uuid.uuid4()}/messages",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"content": "Hola"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


# ---------------------------------------------------------------------------
# Proveedores de IA por empresa (sin secretos)
# ---------------------------------------------------------------------------


def test_providers_list_empty_returns_empty_list(
    client: TestClient, container: Container
) -> None:
    """Un tenant sin proveedores recibe una lista vacía (tenant hermetico)."""
    response = client.get(f"{BOT_API}/providers", headers=_other_tenant())
    assert response.status_code == 200
    assert response.json() == []


def test_providers_list_no_secrets(
    client: TestClient, container: Container
) -> None:
    """La lista de proveedores no expone ``api_key`` ni ``api_key_ref``."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    _create_provider(container, tenant, api_key_ref="ref-secreto", model="gpt-4o")

    response = client.get(f"{BOT_API}/providers", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    _assert_no_secrets(body)
    assert "ref-secreto" not in response.text


def test_provider_put_creates_roundtrip(client: TestClient) -> None:
    """PUT crea un proveedor y GET lo devuelve íntegro (tenant hermetico)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}

    put_response = client.put(f"{BOT_API}/providers", headers=headers, json=_provider_payload())
    assert put_response.status_code == 200
    body = put_response.json()
    assert body["tenant_id"] == str(tenant)
    assert body["provider_kind"] == "openai"
    assert body["order"] == 0
    assert body["enabled"] is True
    assert body["model"] == "gpt-4o"
    assert Decimal(body["temperature"]) == Decimal("0.7")
    assert body["prompt_base"] == "Eres un asistente de ventas."
    _assert_no_secrets(body)

    get_response = client.get(f"{BOT_API}/providers", headers=headers)
    assert get_response.status_code == 200
    listed = get_response.json()
    assert len(listed) == 1
    _assert_no_secrets(listed)


def test_provider_put_idempotent_same_id(client: TestClient) -> None:
    """PUT repetido con el mismo kind/order actualiza sin duplicar."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}

    first = client.put(f"{BOT_API}/providers", headers=headers, json=_provider_payload())
    second = client.put(f"{BOT_API}/providers", headers=headers, json=_provider_payload())
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


def test_provider_put_preserves_api_key_ref(
    client: TestClient, container: Container
) -> None:
    """El PUT preserva el ``api_key_ref`` existente y actualiza el modelo."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    _create_provider(container, tenant, api_key_ref="ref-preservar", model="gpt-4o")

    response = client.put(
        f"{BOT_API}/providers",
        headers=headers,
        json=_provider_payload(model="gpt-4-turbo"),
    )
    assert response.status_code == 200

    with container.database.session_scope() as session:
        row = SqlAlchemyBotProviderRepository(session).get_by_kind_order(
            tenant_id=tenant, provider_kind="openai", order=0
        )
        assert row is not None
        assert row.api_key_ref == "ref-preservar"
        assert row.model == "gpt-4-turbo"


def test_provider_put_invalid_temperature_returns_422(client: TestClient) -> None:
    """Una temperatura no decimal se rechaza (422)."""
    response = client.put(
        f"{BOT_API}/providers",
        headers=TENANT_HEADERS,
        json=_provider_payload(temperature="no-es-decimal"),
    )
    assert response.status_code == 422


def test_provider_put_empty_payload_returns_422(client: TestClient) -> None:
    """Un payload vacío no satisface los campos requeridos (422)."""
    response = client.put(f"{BOT_API}/providers", headers=TENANT_HEADERS, json={})
    assert response.status_code == 422


def test_provider_put_extra_fields_returns_422(client: TestClient) -> None:
    """El payload no acepta ``api_key`` (extra prohibido: secretos no entran)."""
    response = client.put(
        f"{BOT_API}/providers",
        headers=TENANT_HEADERS,
        json=_provider_payload(api_key="secret"),
    )
    assert response.status_code == 422


def test_provider_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin ``X-Tenant-Id`` el tenant no se resuelve (aislamiento RLS)."""
    response = client.put(
        f"{BOT_API}/providers",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json=_provider_payload(),
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_provider_delete_returns_204(
    client: TestClient, container: Container
) -> None:
    """DELETE elimina el proveedor (soft) y GET vuelve a estar vacío."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    _create_provider(container, tenant, model="gpt-4o")

    response = client.delete(f"{BOT_API}/providers/openai/0", headers=headers)
    assert response.status_code == 204

    list_response = client.get(f"{BOT_API}/providers", headers=headers)
    assert list_response.status_code == 200
    assert list_response.json() == []


def test_provider_delete_missing_returns_404(client: TestClient) -> None:
    """Eliminar un proveedor inexistente devuelve 404 con la operación."""
    response = client.delete(f"{BOT_API}/providers/openai/0", headers=TENANT_HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "bot.providers.delete"


def test_provider_delete_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin ``X-Tenant-Id`` el tenant no se resuelve (aislamiento RLS)."""
    response = client.delete(
        f"{BOT_API}/providers/openai/0",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_provider_cross_tenant_isolation(
    client: TestClient, container: Container
) -> None:
    """Un tenant ajeno no ve ni puede borrar proveedores de otro (aislamiento)."""
    _create_provider(container, uuid.uuid4(), model="gpt-4o")

    list_response = client.get(f"{BOT_API}/providers", headers=_other_tenant())
    assert list_response.status_code == 200
    assert list_response.json() == []

    delete_response = client.delete(f"{BOT_API}/providers/openai/0", headers=_other_tenant())
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["operation"] == "bot.providers.delete"


# ---------------------------------------------------------------------------
# Monitor de cola D3 del tenant activo
# ---------------------------------------------------------------------------


def test_tenant_queue_stats_returns_counts(
    client: TestClient, container: Container
) -> None:
    """El monitor de cola combina contadores BD por estado (tenant hermetico)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    conversation, _ = _create_conversation(container, tenant)
    _create_message(container, tenant, conversation.id, queue_status=QUEUE_PENDING)
    _create_message(container, tenant, conversation.id, queue_status=QUEUE_SENT)
    _create_message(container, tenant, conversation.id, queue_status=QUEUE_FAILED)

    with _fake_queue_service(client, container):
        response = client.get(f"{BOT_API}/queue/tenant-stats", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == str(tenant)
    assert body["stream"] == f"bot:queue:{tenant}"
    assert body["length"] == 0
    assert body["pending"] == 0
    assert body["consumer_lag"] == 0
    assert body["dlq_count"] == 0
    assert body["enqueued"] == 1
    assert body["processed"] == 1
    assert body["failed"] == 1


def test_tenant_queue_stats_reflects_dlq(
    client: TestClient, container: Container
) -> None:
    """El contador DLQ acumulado en BD se refleja en el monitor de cola."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    stream = f"bot:queue:{tenant}"
    with container.database.session_scope() as session:
        repository = SqlAlchemyBotQueueMetaRepository(session)
        repository.increment_dlq(tenant_id=tenant, stream=stream)
        repository.increment_dlq(tenant_id=tenant, stream=stream)

    with _fake_queue_service(client, container):
        response = client.get(f"{BOT_API}/queue/tenant-stats", headers=headers)
    assert response.status_code == 200
    assert response.json()["dlq_count"] == 2


def test_tenant_queue_stats_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin ``X-Tenant-Id`` el monitor de cola no se resuelve (aislamiento RLS)."""
    response = client.get(
        f"{BOT_API}/queue/tenant-stats",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


# ---------------------------------------------------------------------------
# Motor de prueba del router (Fase 4): POST /bot/router/test
# ---------------------------------------------------------------------------


def _create_keyword(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    term: str,
    response: str,
    priority: int = 100,
) -> None:
    """Siembra una keyword confirmada (commit) para un tenant aislado."""
    with container.database.session_scope() as session:
        SqlAlchemyKeywordRepository(session).create(
            tenant_id=tenant_id,
            term=term,
            response=response,
            priority=priority,
            enabled=True,
            version=1,
        )


def test_router_test_keyword_branch_returns_trace(
    client: TestClient, container: Container
) -> None:
    """Un mensaje que coincide con una keyword traza la rama keyword (Fase 4)."""
    tenant = uuid.uuid4()
    headers = {"X-Tenant-Id": str(tenant), **_AUTH}
    _create_keyword(
        container,
        tenant,
        term="precio especial",
        response="Tienes 20% de descuento este mes.",
        priority=10,
    )

    response = client.post(
        f"{BOT_API}/router/test",
        headers=headers,
        json={"message": "¿me das un precio especial?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["matched_route"] == "keyword"
    assert body["branch"] == "keyword"
    assert body["keyword"] == "precio especial"
    assert body["keyword_priority"] == 10
    assert body["intent"] is None
    assert body["confidence"] == 1.0
    assert body["response"] == "Tienes 20% de descuento este mes."
    assert len(body["steps"]) == 1
    assert body["steps"][0]["branch"] == "keyword"
    assert body["steps"][0]["outcome"] == "match"


def test_router_test_keyword_is_tenant_scoped(
    client: TestClient, container: Container
) -> None:
    """La keyword de un tenant no dispara el match en otro (aislamiento)."""
    _create_keyword(
        container, uuid.uuid4(), term="precio especial", response="descuento"
    )

    response = client.post(
        f"{BOT_API}/router/test",
        headers=_other_tenant(),
        json={"message": "¿me das un precio especial?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["matched_route"] == "intent"
    assert body["intent"] == "quote"
    assert body["keyword"] is None


def test_router_test_intent_branch_returns_trace(client: TestClient) -> None:
    """Un mensaje con intención de checkout traza la rama intent (Fase 4)."""
    response = client.post(
        f"{BOT_API}/router/test",
        headers=_other_tenant(),
        json={"message": "quiero comprar 150 pesos"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["matched_route"] == "intent"
    assert body["branch"] == "intent:checkout"
    assert body["intent"] == "checkout"
    assert body["keyword"] is None
    assert body["confidence"] == 1.0
    assert "monto" in (body["response"] or "")
    assert len(body["steps"]) == 2
    assert body["steps"][0]["outcome"] == "no_match"
    assert body["steps"][1]["outcome"] == "match"


def test_router_test_general_chat_fallthrough_returns_trace(client: TestClient) -> None:
    """Sin keyword ni intención la traza cae a general_chat sin LLM (Fase 4)."""
    response = client.post(
        f"{BOT_API}/router/test",
        headers=_other_tenant(),
        json={"message": "hola, ¿cómo estás hoy?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["matched_route"] == "general_chat"
    assert body["branch"] == "general_chat"
    assert body["keyword"] is None
    assert body["intent"] is None
    assert body["response"] is None
    assert body["confidence"] == 0.0
    assert len(body["steps"]) == 3
    assert body["steps"][2]["branch"] == "general_chat"
    assert body["steps"][2]["outcome"] == "fallthrough"


def test_router_test_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin ``X-Tenant-Id`` el motor de prueba no se resuelve (aislamiento RLS)."""
    response = client.post(
        f"{BOT_API}/router/test",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"message": "quiero comprar"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_router_test_empty_message_returns_422(client: TestClient) -> None:
    """Un mensaje vacío no pasa la validación del esquema (422)."""
    response = client.post(
        f"{BOT_API}/router/test",
        headers=_other_tenant(),
        json={"message": ""},
    )
    assert response.status_code == 422


def test_router_test_extra_fields_returns_422(client: TestClient) -> None:
    """Campos extra son rechazados (``extra=forbid`` en ``RouterTestRequest``)."""
    response = client.post(
        f"{BOT_API}/router/test",
        headers=_other_tenant(),
        json={"message": "hola", "extra": True},
    )
    assert response.status_code == 422


def test_router_test_service_unavailable_returns_503(client: TestClient) -> None:
    """Sin servicio de conversación el endpoint devuelve 503 dependency.failed."""
    client.app.dependency_overrides[get_conversation_service] = lambda: None
    try:
        response = client.post(
            f"{BOT_API}/router/test",
            headers=_other_tenant(),
            json={"message": "hola"},
        )
    finally:
        client.app.dependency_overrides.pop(get_conversation_service, None)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "dependency.failed"
    assert response.json()["error"]["operation"] == "dependency.failed"
