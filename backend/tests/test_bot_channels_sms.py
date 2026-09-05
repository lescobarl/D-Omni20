"""Pruebas del adaptador del canal SMS (Twilio) — C-3 Portales multired.

Cubren :class:`SmsChannelAdapter` de forma aislada (sin red ni base de datos):
verificación de la firma ``X-Twilio-Signature`` (``verify_signature``),
normalización del formulario del webhook (``parse_inbound``) y envío de
respuestas (``send``). Se usan dobles en memoria de :class:`ILogger` e
:class:`ISmsSender`. No existe handshake ``GET`` en Twilio, por lo que este
adaptador NO implementa ``verify_webhook``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from typing import Any

from app.bot.channels.sms import SmsChannelAdapter
from app.bot.interfaces import BotResponse, InboundMessage
from app.core.logging import ILogger
from app.services.workflow_interfaces import ISmsSender


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


class FakeSmsSender(ISmsSender):
    """Sender falso: registra las llamadas y devuelve un resultado configurable."""

    def __init__(self, *, send_sms_result: bool = True) -> None:
        self.send_sms_result = send_sms_result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def send_sms(self, *, to_phone: str, message: str) -> bool:
        self.calls.append(("send_sms", {"to_phone": to_phone, "message": message}))
        return self.send_sms_result

    def close(self) -> None:
        self.calls.append(("close", {}))


def _build_adapter(
    *, send_sms_result: bool = True
) -> tuple[SmsChannelAdapter, FakeLogger, FakeSmsSender]:
    logger = FakeLogger()
    sender = FakeSmsSender(send_sms_result=send_sms_result)
    return SmsChannelAdapter(sender=sender, logger=logger), logger, sender


def _twilio_signature(auth_token: str, url: str, form_params: dict[str, str]) -> str:
    """Calcula la firma ``X-Twilio-Signature`` esperada (HMAC-SHA1 + base64)."""
    sorted_params = "".join(f"{key}{value}" for key, value in sorted(form_params.items()))
    digest = hmac.new(
        auth_token.encode("utf-8"),
        f"{url}{sorted_params}".encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("utf-8")


def _twilio_payload(
    *,
    from_number: str = "5215500000000",
    to_number: str = "+15550000000",
    body: str = "Hola",
    message_sid: str = "SM123",
    include_sender: bool = True,
) -> dict[str, Any]:
    """Construye el formulario de un webhook ``POST`` de Twilio (Messages)."""
    payload: dict[str, Any] = {
        "To": to_number,
        "Body": body,
        "MessageSid": message_sid,
        "SmsSid": message_sid,
        "MessageStatus": "received",
        "AccountSid": "AC123",
    }
    if include_sender:
        payload["From"] = from_number
    return payload


def _event_names(logger: FakeLogger) -> list[str]:
    return [event for event, _, _ in logger.events]


def test_kind_is_sms() -> None:
    """El adaptador se identifica como canal ``sms``."""
    adapter, _, _ = _build_adapter()
    assert adapter.kind == "sms"


def test_verify_signature_accepts_valid() -> None:
    """Una firma HMAC-SHA1 correcta sobre URL + parámetros ordenados se acepta."""
    adapter, _, _ = _build_adapter()
    url = "https://omni.example/api/v1/bot/webhooks/sms"
    params = {"From": "5215500000000", "Body": "Hola", "MessageSid": "SM123"}
    signature = _twilio_signature("auth-token", url, params)
    assert adapter.verify_signature(
        auth_token="auth-token", url=url, form_params=params, signature=signature
    )


def test_verify_signature_rejects_wrong_token() -> None:
    """Una firma generada con otro auth_token no coincide (tiempo constante)."""
    adapter, _, _ = _build_adapter()
    url = "https://omni.example/api/v1/bot/webhooks/sms"
    params = {"From": "5215500000000", "Body": "Hola", "MessageSid": "SM123"}
    signature = _twilio_signature("otro-token", url, params)
    assert not adapter.verify_signature(
        auth_token="auth-token", url=url, form_params=params, signature=signature
    )


def test_verify_signature_rejects_wrong_url() -> None:
    """Una firma generada con otra URL no coincide."""
    adapter, _, _ = _build_adapter()
    url = "https://omni.example/api/v1/bot/webhooks/sms"
    other_url = "https://omni.example/api/v1/bot/webhooks/sms?x=1"
    params = {"From": "5215500000000", "Body": "Hola", "MessageSid": "SM123"}
    signature = _twilio_signature("auth-token", other_url, params)
    assert not adapter.verify_signature(
        auth_token="auth-token", url=url, form_params=params, signature=signature
    )


def test_verify_signature_rejects_wrong_params() -> None:
    """Una firma generada con otros parámetros no coincide."""
    adapter, _, _ = _build_adapter()
    url = "https://omni.example/api/v1/bot/webhooks/sms"
    params = {"From": "5215500000000", "Body": "Hola", "MessageSid": "SM123"}
    tampered = {"From": "5215500000000", "Body": "Hola manipulada", "MessageSid": "SM123"}
    signature = _twilio_signature("auth-token", url, tampered)
    assert not adapter.verify_signature(
        auth_token="auth-token", url=url, form_params=params, signature=signature
    )


def test_verify_signature_rejects_missing_token() -> None:
    """Sin ``auth_token`` configurado se falla cerrado y se loguea."""
    adapter, logger, _ = _build_adapter()
    url = "https://omni.example/api/v1/bot/webhooks/sms"
    params = {"From": "5215500000000", "Body": "Hola", "MessageSid": "SM123"}
    signature = _twilio_signature("auth-token", url, params)
    assert not adapter.verify_signature(
        auth_token="", url=url, form_params=params, signature=signature
    )
    assert _event_names(logger) == ["bot.channel.webhook.signature.missing"]


def test_verify_signature_rejects_missing_signature() -> None:
    """Sin cabecera de firma se falla cerrado y se loguea."""
    adapter, logger, _ = _build_adapter()
    url = "https://omni.example/api/v1/bot/webhooks/sms"
    params = {"From": "5215500000000", "Body": "Hola", "MessageSid": "SM123"}
    assert not adapter.verify_signature(
        auth_token="auth-token", url=url, form_params=params, signature=None
    )
    assert _event_names(logger) == ["bot.channel.webhook.signature.missing"]


def test_parse_inbound_returns_message() -> None:
    """Un formulario de Twilio se normaliza a :class:`InboundMessage` completo."""
    adapter, logger, _ = _build_adapter()
    channel_id = uuid.uuid4()
    payload = _twilio_payload(
        from_number="5215500000000",
        to_number="+15550000000",
        body="Hola, quiero un precio",
        message_sid="SM456",
    )
    message = adapter.parse_inbound(payload=payload, channel_id=channel_id)
    assert message is not None
    assert message.channel_id == channel_id
    assert message.external_contact_id == "5215500000000"
    assert message.text == "Hola, quiero un precio"
    assert message.message_id == "SM456"
    assert message.metadata["message_type"] == "sms"
    assert message.metadata["To"] == "+15550000000"
    assert message.metadata["MessageStatus"] == "received"
    assert message.metadata["AccountSid"] == "AC123"
    assert message.metadata["SmsSid"] == "SM456"
    assert _event_names(logger) == ["bot.channel.webhook.inbound.parsed"]


def test_parse_inbound_none_without_sender() -> None:
    """Un formulario sin ``From`` se descarta con log de warning (fail-closed)."""
    adapter, logger, _ = _build_adapter()
    payload = _twilio_payload(include_sender=False)
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == ["bot.channel.webhook.inbound.missing_sender"]


def test_parse_inbound_none_for_non_dict() -> None:
    """Un payload que no es diccionario no se normaliza (``None``)."""
    adapter, _, _ = _build_adapter()
    assert adapter.parse_inbound(payload=["not", "a", "dict"], channel_id=uuid.uuid4()) is None
    assert adapter.parse_inbound(payload="plain-string", channel_id=uuid.uuid4()) is None


def test_send_calls_sender_and_returns_true() -> None:
    """``send`` envía el contenido de la respuesta al número del contacto."""
    adapter, _, sender = _build_adapter(send_sms_result=True)
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="5215500000000", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is True
    assert sender.calls == [
        ("send_sms", {"to_phone": "5215500000000", "message": "Respuesta del bot"})
    ]


def test_send_logs_error_when_failed() -> None:
    """Si el sender falla, ``send`` devuelve ``False`` y loguea el error."""
    adapter, logger, _ = _build_adapter(send_sms_result=False)
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="5215500000000", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is False
    assert _event_names(logger) == ["bot.channel.sms.send.failed"]
