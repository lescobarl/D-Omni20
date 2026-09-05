"""Pruebas de integración de los webhooks multired del bot (C-3 — Portales multired).

Cubre el contrato de ``app/api/v1/channel_webhooks.py`` (plan §8.3 extendido a
SMS/Instagram/Messenger/Webchat):
- ``GET /api/v1/bot/channels/{instagram|messenger}/webhook``: handshake de Meta. El
  ``hub.verify_token`` se resuelve contra los canales configurados del tipo dado
  (``resolve_by_verify_token``), nunca localmente; fail-closed 403 si el token no
  corresponde o la estructura es inválida, y eco exacto del challenge en 200.
- ``POST /api/v1/bot/channels/{instagram|messenger}/webhook``: mensajes entrantes de
  la Graph API de Meta. Se extrae ``entry[0].id`` (equivale al ``external_id`` del
  canal) → se resuelve canal → tenant, se verifica la firma ``X-Hub-Signature-256``
  con el ``webhook_secret`` del canal, se normaliza, se fija el contexto de empresa y
  se encola en la cola D3. Eventos sin mensaje o de canal desconocido → 200.
- ``POST /api/v1/bot/channels/sms/webhook``: mensajes entrantes de Twilio (SMS). Ruteo
  por ``To`` contra ``phone_number`` y autenticación por ``X-Twilio-Signature``
  (HMAC-SHA1 de la URL completa + parámetros del formulario ordenados, clave =
  ``auth_token`` del canal).
- ``POST /api/v1/bot/channels/webchat/webhook``: mensajes del widget del portal.
  Resolución por ``channel_id`` (UUID, snake_case o camelCase) y validación de la
  clave del widget (``X-Widget-Key``) en tiempo constante cuando el canal tiene
  ``access_token``.

El contenedor del conftest y el interno de ``create_app`` comparten el mismo SQLite
en archivo temporal y ambos usan ``token_cipher = None`` (secretos en texto plano),
por lo que los canales creados aquí son visibles para la app del cliente.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_bot_queue_service
from app.bot.queue.service import QUEUE_PENDING, BotQueueService
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.core.di import Container
from app.models.tenant_config import TenantChannel
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantChannelRepository

from tests.test_bot_queue import FakeLogger, FakeQueue

INSTAGRAM_WEBHOOK_URL = "/api/v1/bot/channels/instagram/webhook"
MESSENGER_WEBHOOK_URL = "/api/v1/bot/channels/messenger/webhook"
SMS_WEBHOOK_URL = "/api/v1/bot/channels/sms/webhook"
WEBCHAT_WEBHOOK_URL = "/api/v1/bot/channels/webchat/webhook"

# URL completa del request de Twilio tal como la ve el router (``str(request.url)``).
SMS_FULL_URL = "http://testserver" + SMS_WEBHOOK_URL

META_CHANNELS = [
    ("instagram", INSTAGRAM_WEBHOOK_URL),
    ("messenger", MESSENGER_WEBHOOK_URL),
]


def _create_channel(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    channel_type: str,
    external_id: str | None = None,
    phone_number: str = "5215500000000",
    phone_number_id: str | None = None,
    access_token: str | None = None,
    webhook_secret: str | None = None,
) -> TenantChannel:
    """Crea un canal real en el SQLite compartido (secretos únicos).

    ``phone_number`` es NOT NULL en el modelo: los canales no-SMS pasan un
    placeholder. ``access_token`` y ``webhook_secret`` son obligatorios en
    ``create`` y se generan únicos si no se proveen.
    """
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantChannelRepository(session, cipher=container.token_cipher)
        return repo.create(
            tenant_id=tenant_id,
            channel_type=channel_type,
            external_id=external_id,
            phone_number=phone_number,
            phone_number_id=phone_number_id,
            access_token=access_token or f"tok-{uuid.uuid4().hex}",
            webhook_secret=webhook_secret or f"sec-{uuid.uuid4().hex}",
            enabled=True,
        )


def _meta_signature(secret: str, raw_body: bytes) -> str:
    """Firma ``X-Hub-Signature-256`` de Meta (HMAC-SHA256) sobre el cuerpo crudo."""
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def _twilio_signature(
    auth_token: str,
    url: str,
    form_params: dict[str, str],
) -> str:
    """Firma ``X-Twilio-Signature``: HMAC-SHA1 (clave = auth_token) de la URL +
    parámetros del formulario ordenados (``keyvalue``) codificado en base64."""
    sorted_params = "".join(f"{key}{value}" for key, value in sorted(form_params.items()))
    digest = hmac.new(
        auth_token.encode("utf-8"),
        f"{url}{sorted_params}".encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("utf-8")


def _raw_payload(payload: dict[str, Any]) -> bytes:
    """Serializa el payload compacto: la firma debe cubrir EXACTAMENTE estos bytes."""
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _meta_payload(
    *,
    external_id: str,
    sender_id: str = "1234567890",
    text: str = "Hola",
    include_message: bool = True,
) -> dict[str, Any]:
    """Payload del webhook ``POST`` de la Graph API de Meta (IG/Messenger).

    ``entry[0].id`` equivale al ``external_id`` del canal; el ``mid`` del mensaje se
    lee a nivel de ``messaging`` (no dentro de ``message``), tal como lo hace
    ``MetaMessagingChannelAdapter.parse_inbound``.
    """
    messaging: dict[str, Any] = {
        "sender": {"id": sender_id},
        "recipient": {"id": "page_123"},
        "timestamp": 1700000000,
    }
    if include_message:
        messaging["mid"] = f"mid.{uuid.uuid4().hex}"
        messaging["message"] = {
            "mid": f"mid.{uuid.uuid4().hex}",
            "text": text,
        }
    return {
        "object": "instagram",
        "entry": [{"id": external_id, "messaging": [messaging]}],
    }


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
# GET /channels/{instagram|messenger}/webhook — handshake de Meta
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_verify_webhook_unknown_token_returns_403(
    client: TestClient, channel_type: str, webhook_url: str
) -> None:
    """Un ``verify_token`` sin canal correspondiente se rechaza (fail-closed)."""
    response = client.get(
        webhook_url,
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


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_verify_webhook_valid_token_returns_challenge(
    client: TestClient,
    container: Container,
    tenant_id: uuid.UUID,
    channel_type: str,
    webhook_url: str,
) -> None:
    """Con un token de un canal real del tipo dado el handshake devuelve el challenge."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type=channel_type,
        external_id=f"{channel_type}-{uuid.uuid4().hex}",
    )
    response = client.get(
        webhook_url,
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": channel.webhook_secret,
            "hub.challenge": "challenge_123",
        },
    )
    assert response.status_code == 200
    assert response.text == "challenge_123"


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_verify_webhook_bad_mode_returns_403(
    client: TestClient,
    container: Container,
    tenant_id: uuid.UUID,
    channel_type: str,
    webhook_url: str,
) -> None:
    """Token válido pero modo distinto de ``subscribe`` → 403 (fail-closed)."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type=channel_type,
        external_id=f"{channel_type}-{uuid.uuid4().hex}",
    )
    response = client.get(
        webhook_url,
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


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_verify_webhook_missing_token_returns_403(
    client: TestClient, channel_type: str, webhook_url: str
) -> None:
    """Sin ``verify_token`` el handshake se rechaza antes de resolver canal."""
    response = client.get(
        webhook_url,
        params={"hub.mode": "subscribe", "hub.challenge": "challenge_123"},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.verify"


# ---------------------------------------------------------------------------
# POST /channels/{instagram|messenger}/webhook — mensajes entrantes de Meta
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_post_webhook_valid_message_returns_200(
    client: TestClient,
    container: Container,
    tenant_id: uuid.UUID,
    channel_type: str,
    webhook_url: str,
) -> None:
    """Un mensaje válido se persiste en BD y se encola en la cola D3."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type=channel_type,
        external_id=f"{channel_type}-{uuid.uuid4().hex}",
    )
    payload = _meta_payload(external_id=channel.external_id)
    message_id = payload["entry"][0]["messaging"][0]["mid"]
    raw = _raw_payload(payload)
    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            webhook_url,
            content=raw,
            headers={"X-Hub-Signature-256": _meta_signature(channel.webhook_secret, raw)},
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


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_post_webhook_invalid_signature_returns_403(
    client: TestClient,
    container: Container,
    tenant_id: uuid.UUID,
    channel_type: str,
    webhook_url: str,
) -> None:
    """Una firma que no coincide con el secret del canal se rechaza (fail-closed)."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type=channel_type,
        external_id=f"{channel_type}-{uuid.uuid4().hex}",
    )
    raw = _raw_payload(_meta_payload(external_id=channel.external_id))
    response = client.post(
        webhook_url,
        content=raw,
        headers={"X-Hub-Signature-256": "sha256=deadbeef"},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.signature"


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_post_webhook_unknown_channel_returns_200(
    client: TestClient, channel_type: str, webhook_url: str
) -> None:
    """Un canal desconocido se confirma 200 ANTES de verificar la firma."""
    payload = _meta_payload(external_id=f"unknown-{uuid.uuid4().hex}")
    response = client.post(webhook_url, content=_raw_payload(payload))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_post_webhook_status_event_returns_200(
    client: TestClient,
    container: Container,
    tenant_id: uuid.UUID,
    channel_type: str,
    webhook_url: str,
) -> None:
    """Un evento sin mensaje (estado de entrega/lectura) se confirma 200."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type=channel_type,
        external_id=f"{channel_type}-{uuid.uuid4().hex}",
    )
    raw = _raw_payload(_meta_payload(external_id=channel.external_id, include_message=False))
    response = client.post(
        webhook_url,
        content=raw,
        headers={"X-Hub-Signature-256": _meta_signature(channel.webhook_secret, raw)},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_post_webhook_invalid_json_returns_422(
    client: TestClient, channel_type: str, webhook_url: str
) -> None:
    """Un cuerpo que no es JSON válido se rechaza con 422 (input error)."""
    response = client.post(webhook_url, content=b"not-json")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"


@pytest.mark.parametrize("channel_type,webhook_url", META_CHANNELS)
def test_post_webhook_non_object_returns_422(
    client: TestClient, channel_type: str, webhook_url: str
) -> None:
    """Un cuerpo JSON que no es un objeto se rechaza con 422 (input error)."""
    response = client.post(webhook_url, content=b"[1, 2]")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"


# ---------------------------------------------------------------------------
# POST /channels/sms/webhook — mensajes entrantes de Twilio (SMS)
# ---------------------------------------------------------------------------


def test_post_sms_valid_message_returns_200(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Un SMS válido se persiste en BD y se encola en la cola D3."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type="sms",
        phone_number="5215500000000",
        phone_number_id=f"AC{uuid.uuid4().hex}",
    )
    form: dict[str, str] = {
        "To": channel.phone_number,
        "From": "5215512345678",
        "Body": "Hola",
        "MessageSid": f"SM{uuid.uuid4().hex}",
    }
    signature = _twilio_signature(channel.access_token, SMS_FULL_URL, form)
    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            SMS_WEBHOOK_URL,
            data=form,
            headers={"X-Twilio-Signature": signature},
        )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    stream = f"{container.settings.bot_queue_stream_prefix}:{tenant_id}"
    assert fake_queue.xlen(stream) == 1
    with container.database.session_scope() as session:
        repo = SqlAlchemyBotMessageRepository(session)
        message = repo.get_by_message_id(tenant_id=tenant_id, message_id=form["MessageSid"])
    assert message is not None
    assert message.queue_status == QUEUE_PENDING
    assert message.direction == "inbound"


def test_post_sms_invalid_signature_returns_403(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Una firma ``X-Twilio-Signature`` que no coincide se rechaza (fail-closed)."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type="sms",
        phone_number="5215500000000",
        phone_number_id=f"AC{uuid.uuid4().hex}",
    )
    form: dict[str, str] = {
        "To": channel.phone_number,
        "From": "5215512345678",
        "Body": "Hola",
        "MessageSid": f"SM{uuid.uuid4().hex}",
    }
    response = client.post(
        SMS_WEBHOOK_URL,
        data=form,
        headers={"X-Twilio-Signature": "deadbeef"},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.signature"


def test_post_sms_missing_signature_returns_403(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Sin firma ``X-Twilio-Signature`` el webhook se rechaza (fail-closed)."""
    channel = _create_channel(
        container,
        tenant_id,
        channel_type="sms",
        phone_number="5215500000000",
        phone_number_id=f"AC{uuid.uuid4().hex}",
    )
    form: dict[str, str] = {
        "To": channel.phone_number,
        "From": "5215512345678",
        "Body": "Hola",
        "MessageSid": f"SM{uuid.uuid4().hex}",
    }
    response = client.post(SMS_WEBHOOK_URL, data=form)
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.signature"


def test_post_sms_unknown_channel_returns_200(client: TestClient) -> None:
    """Un ``To`` sin canal resoluble se confirma 200 ANTES de verificar la firma."""
    form: dict[str, str] = {
        "To": f"unknown-{uuid.uuid4().hex}",
        "From": "5215512345678",
        "Body": "Hola",
        "MessageSid": f"SM{uuid.uuid4().hex}",
    }
    response = client.post(SMS_WEBHOOK_URL, data=form)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_sms_invalid_utf8_returns_422(client: TestClient) -> None:
    """Un cuerpo que no es UTF-8 válido se rechaza con 422 (input error)."""
    response = client.post(SMS_WEBHOOK_URL, content=b"\xff\xfe\x00")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"


# ---------------------------------------------------------------------------
# POST /channels/webchat/webhook — mensajes del widget del portal
# ---------------------------------------------------------------------------


def test_post_webchat_valid_message_returns_200(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Un mensaje válido del widget (snake_case) se persiste y encola en la cola D3."""
    channel = _create_channel(container, tenant_id, channel_type="webchat")
    message_id = f"wc-{uuid.uuid4().hex}"
    payload = {
        "channel_id": str(channel.id),
        "contact_id": f"webchat-{uuid.uuid4().hex}",
        "text": "Hola",
        "message_id": message_id,
    }
    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            WEBCHAT_WEBHOOK_URL,
            json=payload,
            headers={"X-Widget-Key": channel.access_token},
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


def test_post_webchat_camel_case_returns_200(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """El payload en camelCase (``channelId``/``contactId``/``messageId``) también se
    normaliza y encola."""
    channel = _create_channel(container, tenant_id, channel_type="webchat")
    message_id = f"wc-{uuid.uuid4().hex}"
    payload = {
        "channelId": str(channel.id),
        "contactId": f"webchat-{uuid.uuid4().hex}",
        "text": "Hola",
        "messageId": message_id,
    }
    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            WEBCHAT_WEBHOOK_URL,
            json=payload,
            headers={"X-Widget-Key": channel.access_token},
        )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    stream = f"{container.settings.bot_queue_stream_prefix}:{tenant_id}"
    assert fake_queue.xlen(stream) == 1


def test_post_webchat_missing_contact_returns_200(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Sin ``contact_id`` se confirma 200 sin despachar (canal pull)."""
    channel = _create_channel(container, tenant_id, channel_type="webchat")
    payload = {
        "channel_id": str(channel.id),
        "text": "Hola",
    }
    with _fake_queue_service(client, container) as fake_queue:
        response = client.post(
            WEBCHAT_WEBHOOK_URL,
            json=payload,
            headers={"X-Widget-Key": channel.access_token},
        )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    stream = f"{container.settings.bot_queue_stream_prefix}:{tenant_id}"
    assert fake_queue.xlen(stream) == 0


def test_post_webchat_invalid_widget_key_returns_403(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Una clave de widget que no coincide con el ``access_token`` se rechaza."""
    channel = _create_channel(container, tenant_id, channel_type="webchat")
    payload = {
        "channel_id": str(channel.id),
        "contact_id": f"webchat-{uuid.uuid4().hex}",
        "text": "Hola",
    }
    response = client.post(
        WEBCHAT_WEBHOOK_URL,
        json=payload,
        headers={"X-Widget-Key": "wrong-widget-key"},
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.signature"


def test_post_webchat_missing_widget_key_returns_403(
    client: TestClient, container: Container, tenant_id: uuid.UUID
) -> None:
    """Sin ``X-Widget-Key`` el webhook de webchat se rechaza (fail-closed)."""
    channel = _create_channel(container, tenant_id, channel_type="webchat")
    payload = {
        "channel_id": str(channel.id),
        "contact_id": f"webchat-{uuid.uuid4().hex}",
        "text": "Hola",
    }
    response = client.post(WEBCHAT_WEBHOOK_URL, json=payload)
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "bot.webhook.signature"


def test_post_webchat_unknown_channel_returns_200(client: TestClient) -> None:
    """Un ``channel_id`` sin canal resoluble se confirma 200 ANTES de la clave."""
    payload = {
        "channel_id": str(uuid.uuid4()),
        "contact_id": "webchat-unknown",
        "text": "Hola",
    }
    response = client.post(WEBCHAT_WEBHOOK_URL, json=payload)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_webchat_invalid_channel_id_returns_200(client: TestClient) -> None:
    """Un ``channel_id`` que no es UUID válido se trata como canal desconocido (200)."""
    payload = {
        "channel_id": "not-a-uuid",
        "contact_id": "webchat-unknown",
        "text": "Hola",
    }
    response = client.post(WEBCHAT_WEBHOOK_URL, json=payload)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_webchat_invalid_json_returns_422(client: TestClient) -> None:
    """Un cuerpo que no es JSON válido se rechaza con 422 (input error)."""
    response = client.post(WEBCHAT_WEBHOOK_URL, content=b"not-json")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"


def test_post_webchat_non_object_returns_422(client: TestClient) -> None:
    """Un cuerpo JSON que no es un objeto se rechaza con 422 (input error)."""
    response = client.post(WEBCHAT_WEBHOOK_URL, content=b"[1, 2]")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation.input_error"
    assert error["operation"] == "bot.webhook.inbound"
