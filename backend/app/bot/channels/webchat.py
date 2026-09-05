"""Adaptador del canal Webchat (widget embebido) para el bot (C-3 — Portal).

Implementa :class:`~app.bot.interfaces.IChannelAdapter` para el widget de chat
del portal del cliente. A diferencia de los canales push (WhatsApp, SMS,
Instagram, Messenger), el webchat es *pull*: la conversación persiste en el
backend y el widget la descarga, por lo que ``send`` no despacha contra un
proveedor externo sino que confirma la persistencia (el envío real lo hace el
worker de la cola D3). Responsabilidades:

- ``parse_inbound``: normaliza el ``POST`` del widget a un
  :class:`~app.bot.interfaces.InboundMessage`. Acepta claves en snake_case
  (``contact_id`` / ``message_id``) y camelCase (``contactId`` / ``messageId``).
  Devuelve ``None`` sin ``contact_id`` (fail-closed).
- ``send``: registra la respuesta como persistida y devuelve ``True`` (el
  widget lee el historial, no recibe push).

La validación de la clave del widget la hace la fábrica
(:class:`~app.bot.channels.factory.ChannelSenderFactory`) con ``_has_credentials``
(fail-closed: sin ``access_token`` el canal no resuelve).
"""

from __future__ import annotations

import uuid
from typing import Any

from app.bot.interfaces import BotResponse, IChannelAdapter, InboundMessage
from app.core.logging import ILogger


class WebchatChannelAdapter(IChannelAdapter):
    """Adaptador del canal Webchat (widget embebido del portal)."""

    def __init__(self, *, logger: ILogger) -> None:
        self._logger = logger

    @property
    def kind(self) -> str:
        """Tipo de canal: ``webchat``."""
        return "webchat"

    def parse_inbound(
        self,
        *,
        payload: Any,
        channel_id: uuid.UUID,
    ) -> InboundMessage | None:
        """Normaliza el ``POST`` del widget a un :class:`InboundMessage`.

        Devuelve ``None`` cuando el payload no es un dict o no trae
        ``contact_id``/``contactId`` (fail-closed: el router confirma ``200``
        sin despachar).
        """
        if not isinstance(payload, dict):
            return None

        external_contact_id = payload.get("contact_id") or payload.get("contactId") or ""
        text = payload.get("text") or ""
        message_id = payload.get("message_id") or payload.get("messageId")
        metadata: dict[str, Any] = {"message_type": "webchat"}

        if not external_contact_id:
            self._logger.warning(
                "bot.channel.webhook.inbound.missing_sender",
                "Mensaje del widget sin contact_id en el payload",
                channel_id=str(channel_id),
                message_id=message_id,
            )
            return None

        self._logger.info(
            "bot.channel.webhook.inbound.parsed",
            "Mensaje entrante del webchat normalizado",
            channel_id=str(channel_id),
            message_id=message_id,
            message_type="webchat",
        )
        return InboundMessage(
            channel_id=channel_id,
            external_contact_id=external_contact_id,
            text=text,
            message_id=message_id,
            metadata=metadata,
        )

    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        """Registra la respuesta como persistida; el widget la lee del historial.

        El webchat es pull: no hay envío push a un proveedor. El worker de la
        cola D3 ya persiste la respuesta; aquí solo se confirma y se audita.
        """
        self._logger.info(
            "bot.channel.webchat.send.persisted",
            "Respuesta del bot persistida para el webchat",
            channel_id=str(message.channel_id),
            contact_id=message.external_contact_id,
        )
        return True
