"""Pruebas del adaptador del canal Webchat (widget embebido) — C-3 Portal.

Cubren :class:`WebchatChannelAdapter` de forma aislada (sin red ni base de
datos): normalización del ``POST`` del widget (``parse_inbound``, acepta claves
snake_case y camelCase) y confirmación de persistencia de la respuesta
(``send``, canal *pull*). Se usa un doble en memoria de :class:`ILogger`.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.bot.channels.webchat import WebchatChannelAdapter
from app.bot.interfaces import BotResponse, InboundMessage
from app.core.logging import ILogger


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


def _build_adapter() -> tuple[WebchatChannelAdapter, FakeLogger]:
    logger = FakeLogger()
    return WebchatChannelAdapter(logger=logger), logger


def _event_names(logger: FakeLogger) -> list[str]:
    return [event for event, _, _ in logger.events]


def test_kind_is_webchat() -> None:
    """El adaptador se identifica como canal ``webchat``."""
    adapter, _ = _build_adapter()
    assert adapter.kind == "webchat"


def test_parse_inbound_returns_message_snake_case() -> None:
    """Un ``POST`` del widget en snake_case se normaliza a :class:`InboundMessage`."""
    adapter, logger = _build_adapter()
    channel_id = uuid.uuid4()
    payload: dict[str, Any] = {
        "contact_id": "contact-web-123",
        "text": "Hola, quiero un precio",
        "message_id": "msg-456",
    }
    message = adapter.parse_inbound(payload=payload, channel_id=channel_id)
    assert message is not None
    assert message.channel_id == channel_id
    assert message.external_contact_id == "contact-web-123"
    assert message.text == "Hola, quiero un precio"
    assert message.message_id == "msg-456"
    assert message.metadata["message_type"] == "webchat"
    assert _event_names(logger) == ["bot.channel.webhook.inbound.parsed"]


def test_parse_inbound_returns_message_camel_case() -> None:
    """Un ``POST`` del widget en camelCase también se normaliza."""
    adapter, logger = _build_adapter()
    channel_id = uuid.uuid4()
    payload: dict[str, Any] = {
        "contactId": "contact-web-789",
        "text": "Hola de nuevo",
        "messageId": "msg-abc",
    }
    message = adapter.parse_inbound(payload=payload, channel_id=channel_id)
    assert message is not None
    assert message.channel_id == channel_id
    assert message.external_contact_id == "contact-web-789"
    assert message.text == "Hola de nuevo"
    assert message.message_id == "msg-abc"
    assert message.metadata["message_type"] == "webchat"
    assert _event_names(logger) == ["bot.channel.webhook.inbound.parsed"]


def test_parse_inbound_none_without_contact_id() -> None:
    """Sin ``contact_id``/``contactId`` se descarta con log de warning (fail-closed)."""
    adapter, logger = _build_adapter()
    payload: dict[str, Any] = {"text": "Hola sin remitente"}
    assert adapter.parse_inbound(payload=payload, channel_id=uuid.uuid4()) is None
    assert _event_names(logger) == ["bot.channel.webhook.inbound.missing_sender"]


def test_parse_inbound_none_for_non_dict() -> None:
    """Un payload que no es diccionario no se normaliza (``None``)."""
    adapter, _ = _build_adapter()
    assert adapter.parse_inbound(payload=["not", "a", "dict"], channel_id=uuid.uuid4()) is None
    assert adapter.parse_inbound(payload="plain-string", channel_id=uuid.uuid4()) is None


def test_send_returns_true_and_logs_persisted() -> None:
    """``send`` confirma la persistencia y audita el evento (canal *pull*)."""
    adapter, logger = _build_adapter()
    message = InboundMessage(
        channel_id=uuid.uuid4(), external_contact_id="contact-web-123", text="Hola"
    )
    reply = BotResponse(content="Respuesta del bot")
    assert adapter.send(reply=reply, message=message) is True
    assert _event_names(logger) == ["bot.channel.webchat.send.persisted"]
