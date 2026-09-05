"""Pruebas de integración de los endpoints runtime del bot (Fase 5/5.1).

Cubre el contrato de ``app/api/v1/bot.py`` (plan §8.3):
- ``GET /api/v1/bot/channels/whatsapp/webhook``: handshake de Meta. El
  ``hub.verify_token`` se resuelve contra los canales configurados
  (``resolve_by_verify_token``), nunca localmente; fail-closed 403 si el token no
  corresponde o la estructura es inválida, y eco exacto del challenge en 200.
- ``POST /api/v1/bot/channels/whatsapp/webhook``: mensajes entrantes (Fase 5.1).
  La firma ``X-Hub-Signature-256`` se verifica con el ``webhook_secret`` del canal
  sobre el cuerpo crudo; el mensaje válido se persiste en BD y se encola en la
  cola D3 (``BotQueueService.enqueue_inbound``) confirmando 200. Los eventos de
  canal desconocido o sin mensaje se confirman 200 sin encolar.
- ``GET /api/v1/bot/queue/stats``: estadísticas combinadas BD + Redis de la cola
  D3 por tenant (solo-máquina, service credential + ``tenant_id`` obligatorio).
- ``GET /api/v1/bot/context/{channel_id}``: context bundle m2m (solo-máquina)
  autenticado con ``Authorization: Bearer <service_credential>``. Sin credential
  configurado el endpoint falla cerrado (403); con el override del service
  credential devuelve el bundle con los secretos descifrados solo en memoria.

El contenedor del conftest y el interno de ``create_app`` comparten el mismo
SQLite en archivo temporal, y ambos usan ``token_cipher = None`` (sin
``TOKEN_ENCRYPTION_KEY``): los secretos se persisten/leen en texto plano, por lo
que los canales creados aquí son visibles para la app del cliente.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import uuid
from collections.abc import Iterator
from typing import Any

from app.api.deps import get_bot_queue_service, require_service_credential
from app.bot.queue.service import QUEUE_PENDING, BotQueueService
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.core.di import Container
from app.models.tenant_config import TenantChannel
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantChannelRepository
from fastapi.testclient import TestClient

from tests.test_bot_queue import FakeLogger, FakeQueue

WEBHOOK_URL = "/api/v1/bot/channels/whatsapp/webhook"


def _create_channel(container: Container, tenant_id: uuid.UUID) -> TenantChannel:
    """Crea un canal WhatsApp real en el SQLite compartido (secretos únicos)."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantChannelRepository(session, cipher=container.token_cipher)
        return repo.create(
            tenant_id=tenant_id,
            channel_type="whatsapp",
            external_id=f"wa-f5-{uuid.uuid4().hex}",
            phone_number="5215500000000",
            phone_number_id=f"f5-{uuid.uuid4().hex}",
            access_token=f"EAAG-f5-{uuid.uuid4().hex}",
            webhook_secret=f"secret-{uuid.uuid4().hex}",
            enabled=True,
        )


def _signature(secret: str, raw_body: bytes) -> str:
    """Firma ``X-Hub-Signature-256`` de Meta (HMAC-SHA256) sobre el cuerpo crudo."""
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def _webhook_payload(
    *,
    phone_number_id: str,
    from_number: str = "5215500000000",
    text: str = "Hola",
    include_message: bool = True,
) -> dict[str, Any]:
    """Payload del webhook ``POST`` de la WhatsApp Cloud API."""
    value: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "metadata": {
            "display_phone_number": "15550000000",
            "phone_number_id": phone_number_id,
        },
        "contacts": [{"profile": {"name": "John Doe"}, "wa_id": from_number}],
    }
    if include_message:
        value["messages"] = [
            {
                "from": from_number,
                "id": f"wamid.f5.{uuid.uuid4().hex}",
                "timestamp": "1700000000",
                "text": {"body": text},
                "type": "text",
            }
        ]
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
                "changes": [{"field": "messages", "value": value}],
            }
        ],
    }


def _raw_payload(payload: dict[str, Any]) -> bytes:
    """Serializa el payload compacto: la firma debe cubrir EXACTAMENTE estos bytes."""
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


@contextlib.contextmanager
def _service_credential(client: TestClient, token: str = "svc-cred") -> Iterator[None]:
    """Habilita el service credential m2m solo durante el bloque (teardown garantizado)."""
    client.app.dependency_overrides[require_service_credential] = lambda: token
    try:
        yield
    finally:
        client.app.dependency_overrides.pop(require_service_credential, None)


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
# GET /channels/whatsapp/webhook — handshake de Meta
# ---------------------------------------------------------------------------


def test_verify_webhook_unknown_token_returns_403(client: TestClient) -> None:
    """Un ``verify_token`` sin canal correspondiente se rechaza (fail-closed)."""
    response = client.get(
        WEBHOOK_URL,
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "no-such-token",
            "hub.challenge": "challenge_123",
        },
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.verify"


def test_verify_webhook_valid_token_returns_challenge(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Con un token de un canal real el handshake devuelve el challenge exacto."""
    channel = _create_channel(container, tenant_id)
    response = client.get(
        WEBHOOK_URL,
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": channel.webhook_secret,
            "hub.challenge": "challenge_123",
        },
    )
    assert response.status_code == 200
    assert response.text == "challenge_123"


def test_verify_webhook_bad_mode_returns_403(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Token válido pero modo distinto de ``subscribe`` → 403 (fail-closed)."""
    channel = _create_channel(container, tenant_id)
    response = client.get(
        WEBHOOK_URL,
        params={
            "hub.mode": "unsubscribe",
            "hub.verify_token": channel.webhook_secret,
            "hub.challenge": "challenge_123",
        },
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.verify"


def test_verify_webhook_missing_token_returns_403(client: TestClient) -> None:
    """Sin ``verify_token`` el handshake se rechaza antes de resolver canal."""
    response = client.get(
        WEBHOOK_URL,
        params={"hub.mode": "subscribe", "hub.challenge": "challenge_123"},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.verify"


# ---------------------------------------------------------------------------
# POST /channels/whatsapp/webhook — mensajes entrantes
# ---------------------------------------------------------------------------


def test_post_webhook_valid_message_returns_200(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Un mensaje válido se persiste en BD y se encola en la cola D3 (Fase 5.1)."""
    channel = _create_channel(container, tenant_id)
    payload = _webhook_payload(phone_number_id=channel.phone_number_id)
    message_id = payload["entry"][0]["changes"][0]["value"]["messages"][0]["id"]
    raw = _raw_payload(payload)
    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            WEBHOOK_URL,
            content=raw,
            headers={"X-Hub-Signature-256": _signature(channel.webhook_secret, raw)},
        )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    stream = f"{container.settings.bot_queue_stream_prefix}:{tenant_id}"
    assert fake_queue.xlen(stream) == 1
    with container.database.session_scope() as session:
        repo = SqlAlchemyBotMessageRepository(session)
        message = repo.get_by_message_id(tenant_id=tenant_id, message_id=message_id)
    assert message is not None
    assert message.queue_status == QUEUE_PENDING
    assert message.direction == "inbound"


def test_post_webhook_invalid_signature_returns_403(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Una firma que no coincide con el secret del canal se rechaza (fail-closed)."""
    channel = _create_channel(container, tenant_id)
    raw = _raw_payload(_webhook_payload(phone_number_id=channel.phone_number_id))
    response = client.post(
        WEBHOOK_URL,
        content=raw,
        headers={"X-Hub-Signature-256": "sha256=deadbeef"},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.signature"


def test_post_webhook_unknown_channel_returns_200(client: TestClient) -> None:
    """Un canal desconocido se confirma 200 ANTES de verificar la firma."""
    payload = _webhook_payload(phone_number_id=f"unknown-{uuid.uuid4().hex}")
    response = client.post(WEBHOOK_URL, content=_raw_payload(payload))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_webhook_status_event_returns_200(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Un evento sin mensaje (estado de entrega/lectura) se confirma 200."""
    channel = _create_channel(container, tenant_id)
    raw = _raw_payload(
        _webhook_payload(phone_number_id=channel.phone_number_id, include_message=False)
    )
    response = client.post(
        WEBHOOK_URL,
        content=raw,
        headers={"X-Hub-Signature-256": _signature(channel.webhook_secret, raw)},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_webhook_invalid_json_returns_422(client: TestClient) -> None:
    """Un cuerpo que no es JSON válido se rechaza con 422 (input error)."""
    response = client.post(WEBHOOK_URL, content=b"not-json")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"


def test_post_webhook_non_object_returns_422(client: TestClient) -> None:
    """Un cuerpo JSON que no es un objeto se rechaza con 422 (input error)."""
    response = client.post(WEBHOOK_URL, content=b"[1, 2]")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"


# ---------------------------------------------------------------------------
# GET /queue/stats — estadísticas de la cola D3
# ---------------------------------------------------------------------------


def test_get_queue_stats_without_credential_returns_403(client: TestClient) -> None:
    """Sin service credential el endpoint de la cola falla cerrado (403)."""
    response = client.get(
        "/api/v1/bot/queue/stats",
        params={"tenant_id": str(uuid.uuid4())},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.service.authenticate"


def test_get_queue_stats_missing_tenant_returns_422(client: TestClient) -> None:
    """El ``tenant_id`` es obligatorio; sin él la validación de entrada falla (422)."""
    with _service_credential(client):
        response = client.get("/api/v1/bot/queue/stats")
    assert response.status_code == 422


def test_get_queue_stats_returns_stats(client: TestClient, container: Container) -> None:
    """Con credential y tenant válidos devuelve estadísticas combinadas BD + Redis."""
    tenant = uuid.uuid4()
    stream = f"{container.settings.bot_queue_stream_prefix}:{tenant}"
    with _service_credential(client), _fake_queue_service(client, container):
        response = client.get(
            "/api/v1/bot/queue/stats",
            params={"tenant_id": str(tenant)},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == str(tenant)
    assert body["stream"] == stream
    assert body["length"] == 0
    assert body["pending"] == 0
    assert body["consumer_lag"] == 0
    assert body["dlq_count"] == 0
    assert body["enqueued"] == 0
    assert body["processed"] == 0
    assert body["failed"] == 0


# ---------------------------------------------------------------------------
# GET /context/{channel_id} — context bundle m2m
# ---------------------------------------------------------------------------


def test_get_context_without_credential_returns_403(client: TestClient) -> None:
    """Sin service credential configurado el endpoint m2m falla cerrado (403)."""
    response = client.get(f"/api/v1/bot/context/{uuid.uuid4()}")
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.service.authenticate"


def test_get_context_unknown_channel_returns_404(client: TestClient) -> None:
    """Con credential válido pero canal inexistente → 404 (context resolve)."""
    with _service_credential(client):
        response = client.get(f"/api/v1/bot/context/{uuid.uuid4()}")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "resource.not_found"
    assert error["operation"] == "bot.context.resolve"


def test_get_context_returns_bundle(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """El bundle devuelve el canal con sus secretos descifrados y el grounding base."""
    channel = _create_channel(container, tenant_id)
    with _service_credential(client):
        response = client.get(f"/api/v1/bot/context/{channel.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == str(tenant_id)
    assert body["channel_id"] == str(channel.id)
    assert body["channel_type"] == "whatsapp"
    assert body["phone_number_id"] == channel.phone_number_id
    assert body["access_token"] == channel.access_token
    assert body["webhook_secret"] == channel.webhook_secret
    assert body["prompt_base"]
    assert body["providers"] == []
    assert body["content_items"] == []
    assert body["catalog_items"] == []
