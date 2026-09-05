"""Pruebas del adaptador del canal WhatsApp (Fase 5).

Cubren :class:`WhatsAppCloudChannelAdapter` de forma aislada (sin red ni base de
datos): handshake del webhook (``verify_webhook``), verificación de la firma
``X-Hub-Signature-256`` (``verify_signature``), extracción del ``phone_number_id``,
normalización de mensajes entrantes (``parse_inbound``) y envío de respuestas
(``send``). Se usan dobles en memoria de :class:`ILogger` e :class:`IWhatsAppSender`.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from typing import Any

from app.bot.channels.whatsapp import WhatsAppCloudChannelAdapter
from app.bot.interfaces import BotResponse, InboundMessage
from app.core.logging import ILogger
from app.services.workflow_interfaces import IWhatsAppSender


class FakeLogger(ILogger):
    """Logger en memoria que registra todos los eventos estructurados."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def _record(self, event: str, message: str, **fields: Any) -> None:
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


class FakeSender(IWhatsAppSender):
    """Sender falso: registra las llamadas y devuelve un resultado configurable."""

    def __init__(self, *, send_text_result: bool = True) -> None:
        self.send_text_result = send_text_result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def send_template_message(
        self, *, to_phone: str, template_name: str, template_variables: list[str]
    ) -> bool:
        self.calls.append(
            (
                "send_template_message",
                {
                    "to_phone": to_phone,
                    "template_name": template_name,
                    "template_variables": template_variables,
                },
            )
        )
        return True

    def send_text(self, *, to_phone: str, text: str) -> bool:
        self.calls.append(("send_text", {"to_phone": to_phone, "text": text}))
        return self.send_text_result

    def verify_webhook_signature(self, *, payload: bytes, signature: str | None) -> bool:
        self.calls.append(("verify_webhook_signature", {"signature": signature}))
        return True


def _build_adapter(
    *, send_text_result: bool = True
) -> tuple[WhatsAppCloudChannelAdapter, FakeLogger, FakeSender]:
    logger = FakeLogger()
    sender = FakeSender(send_text_result=send_text_result)
    return WhatsAppCloudChannelAdapter(sender=sender, logger=logger), logger, sender


def _signature(secret: str, raw_body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def _webhook_payload(
    *,
    phone_number_id: str = "PHONE_NUMBER_ID",
    message_id: str = "wamid.HBgN",
    from_number: str = "5215500000000",
    text: str = "Hola",
    message_type: str = "text",
    include_message: bool = True,
) -> dict[str, Any]:
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
                "id": message_id,
                "timestamp": "1700000000",
                "text": {"body": text},
                "type": message_type,
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


def _event_names(logger: FakeLogger) -> list[str]:
    return [event for event, _, _ in logger.events]


def test_kind_is_whatsapp() -> None:
    """El adaptador se identifica como canal ``whatsapp``."""
    adapter, _, _ = _build_adapter()
    assert adapter.kind == "whatsapp"


def test_verify_webhook_returns_challenge() -> None:
    """Un handshake válido devuelve el challenge exacto (eco para Meta)."""
    adapter, logger, _ = _build_adapter()
    challenge = adapter.verify_webhook(
        mode="subscribe", verify_token="secret-token", challenge="CHALLENGE_123"
    )
    assert challenge == "CHALLENGE_123"
    assert _event_names(logger) == []


def test_verify_webhook_rejects_bad_mode() -> None:
    """Un modo distinto de ``subscribe`` se rechaza (fail-closed) y se loguea."""
    adapter, logger, _ = _build_adapter()
    challenge = adapter.verify_webhook(
        mode="unsubscribe", verify_token="secret-token", challenge="CHALLENGE_123"
    )
    assert challenge is None
    assert _event_names(logger) == ["bot.channel.webhook.verify.rejected"]


def test_verify_webhook_rejects_missing_token() -> None:
    """Sin ``verify_token`` el handshake se rechaza."""
    adapter, logger, _ = _build_adapter()
    challenge = adapter.verify_webhook(mode="subscribe", verify_token=None, challenge="CHALLENGE_123")
    assert challenge is None
    assert _event_names(logger) == ["bot.channel.webhook.verify.rejected"]


def test_verify_webhook_rejects_missing_challenge() -> None:
    """Sin ``challenge`` el handshake se rechaza."""
    adapter, logger, _ = _build_adapter()
    challenge = adapter.verify_webhook(mode="subscribe", verify_token="secret-token", challenge=None)
    assert challenge is None
    assert _event_names(logger) == ["bot.channel.webhook.verify.rejected"]


def test_verify_signature_accepts_valid() -> None:
    """Una firma HMAC-SHA256 correcta sobre el cuerpo crudo se acepta."""
    adapter, _, _ = _build_adapter()
    raw = b'{"object":"whatsapp_business_account"}'
    assert adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature=_signature("secret", raw))


def test_verify_signature_rejects_wrong() -> None:
    """Una firma con otro secret o cuerpo no coincide (tiempo constante)."""
    adapter, _, _ = _build_adapter()
    raw = b'{"object":"whatsapp_business_account"}'
    wrong = _signature("otro-secret", raw)
    assert not adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature=wrong)


def test_verify_signature_rejects_missing_secret() -> None:
    """Sin ``webhook_secret`` configurado se falla cerrado y se loguea."""
    adapter, logger, _ = _build_adapter()
    raw = b'{"object":"whatsapp_business_account"}'
    assert not adapter.verify_signature(webhook_secret="", raw_body=raw, signature=_signature("x", raw))
    assert _event_names(logger) == ["bot.channel.webhook.signature.missing"]


def test_verify_signature_rejects_missing_signature() -> None:
    """Sin cabecera de firma se falla cerrado y se loguea."""
    adapter, logger, _ = _build_adapter()
    raw = b'{"object":"whatsapp_business_account"}'
    assert not adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature=None)
    assert _event_names(logger) == ["bot.channel.webhook.signature.missing"]


def test_verify_signature_rejects_bad_prefix() -> None:
    """Una firma sin el prefijo ``sha256=`` se rechaza."""
    adapter, _, _ = _build_adapter()
    raw = b'{"object":"whatsapp_business_account"}'
    assert not adapter.verify_signature(webhook_secret="secret", raw_body=raw, signature="deadbeef")


def test_extract_phone_number_id_found() -> None:
    """Extrae el ``phone_number_id`` del payload anidado de la Cloud API."""
    adapter, _, _ = _build_adapter()
    payload = _webhook_payload(phone_number_id="1029384756")
    assert adapter.extract_phone_number_id(payload) == "1029384756"


def test_extract_phone_number_id_none_for_non_dict() -> None:
    """Un payload que no es diccionario no expone un ``phone_number_id``."""
    adapter, _, _ = _build_adapter()
    assert adapter.extract_phone_number_id(["not", "a", "dict"]) is None
    assert adapter.extract_phone_number_id("plain-string") is None


def test_extract_phone_number_id_none_without_metadata() -> None:
    """Sin ``value.metadata`` (o con valor vacío) se devuelve ``None``."""
    adapter, _, _ = _build_adapter()
    payload = _webhook_payload(phone_number_id="1029384756")
    payload["entry"][0]["changes"][0]["value"].pop("metadata")
    assert adapter.extract_phone_number_id(payload) is None

    payload2 = _webhook_payload(phone_number_id="")
    assert adapter.extract_phone_number_id(payload2) is None


def test_parse_inbound_returns_message() -> None:
    """Un mensaje de texto se normaliza a :class:`InboundMessage` completo."""
    adapter, logger, _ = _build_adapter()
    channel_id = uuid.uuid4()
    payload = _webhook_payload(
        phone_number_id="1029384756",
        message_id="wamid.ABC",
        from_number="5215500000000",
        text="Hola, quiero un precio",
    )
    message = adapter.parse_inbound(payload=payload, channel_id=channel_id)
    assert message is not None
    assert message.channel_id == channel_id
    assert message.external_contact_id == "5215500000000"
    assert message.text == "Hola, quiero un precio"
    assert message.message_id == "wamid.ABC"
    assert message.metadata["message_type"] == "text"
    assert message.metadata["phone_number_id"] == "1029384756"
    assert message.metadata["display_phone_number"] == "15550000000"
    assert message.metadata["profile_name"] == "John Doe"
    assert message.metadata["timestamp"] == "1700000000"
    assert message.metadata["type"] == "text"
    assert _event_names(logger) == ["bot.channel.webhook.inbound.parsed"]


def test_parse_inbound_none_for_status_event() -> None:
    """Un evento sin ``messages`` (estado de entrega/lectura) se ignora (``None``)."""
    adapter, logger, _ = _build_adapter()
    payload = _webhook_payload(include_message=False)
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == []


def test_parse_inbound_none_without_sender() -> None:
    """Un mensaje sin remitente (``from``) se descarta con log de warning."""
    adapter, logger, _ = _build_adapter()
    payload = _webhook_payload(from_number="")
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == ["bot.channel.webhook.inbound.missing_sender"]


def test_send_calls_sender_and_returns_true() -> None:
    """``send`` envía el contenido de la respuesta al contacto externo."""
    adapter, _, sender = _build_adapter(send_text_result=True)
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="5215500000000", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is True
    assert sender.calls == [("send_text", {"to_phone": "5215500000000", "text": "Respuesta del bot"})]


def test_send_logs_error_when_failed() -> None:
    """Si el sender falla, ``send`` devuelve ``False`` y loguea el error."""
    adapter, logger, _ = _build_adapter(send_text_result=False)
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="5215500000000", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is False
    assert _event_names(logger) == ["bot.channel.whatsapp.send.failed"]
