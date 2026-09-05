"""Pruebas de los adaptadores de la Graph API de Meta (Instagram/Messenger).

Cubren :class:`InstagramChannelAdapter` y :class:`MessengerChannelAdapter` (que
comparten el adaptador base :class:`MetaMessagingChannelAdapter`) de forma
aislada (sin red ni base de datos): handshake del webhook (``verify_webhook``),
verificación de la firma ``X-Hub-Signature-256`` (``verify_signature``),
normalización de mensajes entrantes (``parse_inbound``) y envío de respuestas
(``send``). Se usan dobles en memoria de :class:`ILogger` e
:class:`IMetaGraphMessagesSender`.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from typing import Any

import pytest

from app.bot.channels.instagram import InstagramChannelAdapter
from app.bot.channels.messenger import MessengerChannelAdapter
from app.bot.channels.meta import MetaMessagingChannelAdapter
from app.bot.interfaces import BotResponse, InboundMessage
from app.core.logging import ILogger
from app.services.workflow_interfaces import IMetaGraphMessagesSender


class FakeLogger(ILogger):
    """Logger en memoria que registra todos los eventos estructurados."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def _record(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, dict(fields)))

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, **fields)


class FakeMetaSender(IMetaGraphMessagesSender):
    """Sender falso: registra las llamadas y devuelve un resultado configurable."""

    def __init__(self, *, send_text_result: bool = True) -> None:
        self.send_text_result = send_text_result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def send_text(self, *, recipient_id: str, text: str) -> bool:
        self.calls.append(("send_text", {"recipient_id": recipient_id, "text": text}))
        return self.send_text_result

    def verify_webhook_signature(self, *, payload: bytes, signature: str | None) -> bool:
        self.calls.append(("verify_webhook_signature", {"signature": signature}))
        return True

    def close(self) -> None:
        self.calls.append(("close", {}))


_ADAPTERS = [
    (InstagramChannelAdapter, "instagram"),
    (MessengerChannelAdapter, "messenger"),
]


def _build_adapter(
    adapter_cls: type[MetaMessagingChannelAdapter],
    *,
    send_text_result: bool = True,
) -> tuple[MetaMessagingChannelAdapter, FakeLogger, FakeMetaSender]:
    logger = FakeLogger()
    sender = FakeMetaSender(send_text_result=send_text_result)
    return adapter_cls(sender=sender, logger=logger), logger, sender


def _signature(secret: str, raw_body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def _webhook_payload(
    *,
    object_name: str = "page",
    entry_id: str = "PAGE_ID",
    sender_id: str | None = "PSID_123",
    recipient_id: str = "PAGE_ID",
    text: str = "Hola",
    mid: str = "mid.123",
    include_message: bool = True,
    include_text: bool = True,
) -> dict[str, Any]:
    """Construye un payload del webhook de mensajería de Meta (Instagram/Messenger)."""
    messaging: dict[str, Any] = {
        "sender": {} if sender_id is None else {"id": sender_id},
        "recipient": {"id": recipient_id},
        "timestamp": 1700000000,
        "mid": mid,
    }
    if include_message:
        message: dict[str, Any] = {}
        if include_text:
            message["text"] = text
        messaging["message"] = message
    return {
        "object": object_name,
        "entry": [
            {
                "id": entry_id,
                "time": 1700000000,
                "messaging": [messaging],
            }
        ],
    }


def _event_names(logger: FakeLogger) -> list[str]:
    return [event for event, _, _ in logger.events]


@pytest.mark.parametrize("adapter_cls,expected_kind", _ADAPTERS)
def test_kind_is_channel(adapter_cls: type[MetaMessagingChannelAdapter], expected_kind: str) -> None:
    """Cada subclase se identifica con su tipo de canal concreto."""
    adapter, _, _ = _build_adapter(adapter_cls)
    assert adapter.kind == expected_kind


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_webhook_returns_challenge(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un handshake válido devuelve el challenge exacto (eco para Meta)."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    challenge = adapter.verify_webhook(
        mode="subscribe", verify_token="secret-token", challenge="CHALLENGE_123"
    )
    assert challenge == "CHALLENGE_123"
    assert _event_names(logger) == []


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_webhook_rejects_bad_mode(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un modo distinto de ``subscribe`` se rechaza (fail-closed) y se loguea."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    challenge = adapter.verify_webhook(
        mode="unsubscribe", verify_token="secret-token", challenge="CHALLENGE_123"
    )
    assert challenge is None
    assert _event_names(logger) == ["bot.channel.webhook.verify.rejected"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_webhook_rejects_missing_token(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Sin ``verify_token`` el handshake se rechaza."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    challenge = adapter.verify_webhook(mode="subscribe", verify_token=None, challenge="CHALLENGE_123")
    assert challenge is None
    assert _event_names(logger) == ["bot.channel.webhook.verify.rejected"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_webhook_rejects_missing_challenge(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Sin ``challenge`` el handshake se rechaza."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    challenge = adapter.verify_webhook(mode="subscribe", verify_token="secret-token", challenge=None)
    assert challenge is None
    assert _event_names(logger) == ["bot.channel.webhook.verify.rejected"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_signature_accepts_valid(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Una firma HMAC-SHA256 correcta sobre el cuerpo crudo se acepta."""
    adapter, _, _ = _build_adapter(adapter_cls)
    raw = b'{"object":"page"}'
    assert adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature=_signature("secret", raw))


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_signature_rejects_wrong(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Una firma con otro secret o cuerpo no coincide (tiempo constante)."""
    adapter, _, _ = _build_adapter(adapter_cls)
    raw = b'{"object":"page"}'
    wrong = _signature("otro-secret", raw)
    assert not adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature=wrong)


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_signature_rejects_missing_secret(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Sin ``webhook_secret`` configurado se falla cerrado y se loguea."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    raw = b'{"object":"page"}'
    assert not adapter.verify_signature(webhook_secret="", raw_body=raw, signature=_signature("x", raw))
    assert _event_names(logger) == ["bot.channel.webhook.signature.missing"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_signature_rejects_missing_signature(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Sin cabecera de firma se falla cerrado y se loguea."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    raw = b'{"object":"page"}'
    assert not adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature=None)
    assert _event_names(logger) == ["bot.channel.webhook.signature.missing"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_verify_signature_rejects_bad_prefix(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Una firma sin el prefijo ``sha256=`` se rechaza."""
    adapter, _, _ = _build_adapter(adapter_cls)
    raw = b'{"object":"page"}'
    assert not adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature="deadbeef")


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_parse_inbound_returns_message(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un mensaje de texto se normaliza a :class:`InboundMessage` completo."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    channel_id = uuid.uuid4()
    payload = _webhook_payload(
        object_name="page",
        entry_id="PAGE_42",
        sender_id="PSID_123",
        recipient_id="PAGE_42",
        text="Hola, quiero un precio",
        mid="mid.456",
    )
    message = adapter.parse_inbound(payload=payload, channel_id=channel_id)
    assert message is not None
    assert message.channel_id == channel_id
    assert message.external_contact_id == "PSID_123"
    assert message.text == "Hola, quiero un precio"
    assert message.message_id == "mid.456"
    assert message.metadata["message_type"] == "text"
    assert message.metadata["object"] == "page"
    assert message.metadata["entry_id"] == "PAGE_42"
    assert message.metadata["recipient_id"] == "PAGE_42"
    assert message.metadata["messaging_timestamp"] == 1700000000
    assert _event_names(logger) == ["bot.channel.webhook.inbound.parsed"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_parse_inbound_none_without_message(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un evento sin ``message`` (reacción, entrega, lectura) se ignora (``None``)."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    payload = _webhook_payload(include_message=False)
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == []


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_parse_inbound_none_without_text(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un mensaje sin texto no se normaliza (``None``)."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    payload = _webhook_payload(include_text=False)
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == []


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_parse_inbound_none_without_sender(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un mensaje sin remitente (``sender.id``) se descarta con log de warning."""
    adapter, logger, _ = _build_adapter(adapter_cls)
    payload = _webhook_payload(sender_id=None)
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == ["bot.channel.webhook.inbound.missing_sender"]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_parse_inbound_none_for_non_dict(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Un payload que no es diccionario no se normaliza (``None``)."""
    adapter, _, _ = _build_adapter(adapter_cls)
    assert adapter.parse_inbound(payload=["not", "a", "dict"], channel_id=uuid.uuid4()) is None
    assert adapter.parse_inbound(payload="plain-string", channel_id=uuid.uuid4()) is None


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_send_calls_sender_and_returns_true(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """``send`` envía el contenido de la respuesta al id del remitente."""
    adapter, _, sender = _build_adapter(adapter_cls, send_text_result=True)
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="PSID_123", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is True
    assert sender.calls == [
        ("send_text", {"recipient_id": "PSID_123", "text": "Respuesta del bot"})
    ]


@pytest.mark.parametrize("adapter_cls,_", _ADAPTERS)
def test_send_logs_error_when_failed(adapter_cls: type[MetaMessagingChannelAdapter], _: str) -> None:
    """Si el sender falla, ``send`` devuelve ``False`` y loguea el error."""
    adapter, logger, _ = _build_adapter(adapter_cls, send_text_result=False)
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="PSID_123", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is False
    assert _event_names(logger) == ["bot.channel.meta.send.failed"]
