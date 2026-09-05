"""Adaptador del canal SMS (Twilio) para el bot (C-3 — Portales multired).

Implementa :class:`~app.bot.interfaces.IChannelAdapter` para la REST API de
Twilio (Messages). Responsabilidades:

- ``verify_signature``: valida el header ``X-Twilio-Signature`` de cada request
  del webhook. Twilio firma el ``POST`` con HMAC-SHA1 de la URL completa + los
  parámetros del formulario ordenados alfabéticamente (``keyvalue`` sin
  delimitadores) y codifica el digest en base64. No existe handshake ``GET`` en
  Twilio (por eso este adaptador NO implementa ``verify_webhook``).
- ``parse_inbound``: normaliza el formulario del webhook ``POST`` a un
  :class:`~app.bot.interfaces.InboundMessage`` (``From`` → contacto externo,
  ``Body`` → texto, ``MessageSid`` → id del mensaje).
- ``send``: envía la respuesta del bot con ``ISmsSender.send_sms``.

Este adaptador es agnóstico de la base de datos: el envío se hace con el
``ISmsSender`` inyectado y el parseo es puramente estructural.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from typing import Any

from app.bot.interfaces import BotResponse, IChannelAdapter, InboundMessage
from app.core.logging import ILogger
from app.services.workflow_interfaces import ISmsSender


class SmsChannelAdapter(IChannelAdapter):
    """Adaptador del canal SMS (Twilio)."""

    def __init__(self, *, sender: ISmsSender, logger: ILogger) -> None:
        self._sender = sender
        self._logger = logger

    @property
    def kind(self) -> str:
        """Tipo de canal: ``sms``."""
        return "sms"

    def verify_signature(
        self,
        *,
        auth_token: str,
        url: str,
        form_params: dict[str, str],
        signature: str | None,
    ) -> bool:
        """Verifica la firma ``X-Twilio-Signature`` del webhook de Twilio.

        Twilio firma con HMAC-SHA1 (clave = ``auth_token`` del canal, no el
        secret global) sobre la URL completa del request concatenada con los
        parámetros del formulario ordenados alfabéticamente por clave
        (``keyvalue``, sin delimitadores); el digest se codifica en base64. Se
        compara en tiempo constante (``hmac.compare_digest``) y falla cerrado:
        sin auth_token, sin firma o con payload vacío devuelve ``False``.
        """
        if not auth_token or not signature or not url:
            self._logger.warning(
                "bot.channel.webhook.signature.missing",
                "Firma del webhook ausente o sin auth_token configurado",
                has_auth_token=bool(auth_token),
                has_signature=bool(signature),
                has_url=bool(url),
            )
            return False

        sorted_params = "".join(f"{key}{value}" for key, value in sorted(form_params.items()))
        digest = hmac.new(
            auth_token.encode("utf-8"),
            f"{url}{sorted_params}".encode("utf-8"),
            hashlib.sha1,
        ).digest()
        expected = base64.b64encode(digest).decode("utf-8")
        return hmac.compare_digest(expected, signature)

    def parse_inbound(
        self,
        *,
        payload: Any,
        channel_id: uuid.UUID,
    ) -> InboundMessage | None:
        """Normaliza el formulario del webhook de Twilio a un :class:`InboundMessage`.

        Devuelve ``None`` cuando el payload no trae remitente (``From``): en ese
        caso el router confirma ``200`` sin despachar (fail-closed).
        """
        if not isinstance(payload, dict):
            return None

        external_contact_id = payload.get("From") or ""
        text = payload.get("Body") or ""
        message_id = payload.get("MessageSid") or payload.get("SmsSid")
        metadata = self._build_metadata(payload)

        if not external_contact_id:
            self._logger.warning(
                "bot.channel.webhook.inbound.missing_sender",
                "SMS entrante sin remitente (From) en el payload",
                channel_id=str(channel_id),
                message_id=message_id,
            )
            return None

        self._logger.info(
            "bot.channel.webhook.inbound.parsed",
            "SMS entrante normalizado",
            channel_id=str(channel_id),
            message_id=message_id,
            message_type="sms",
        )
        return InboundMessage(
            channel_id=channel_id,
            external_contact_id=external_contact_id,
            text=text,
            message_id=message_id,
            metadata=metadata,
        )

    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        """Envía la respuesta del bot al contacto vía ``ISmsSender.send_sms``."""
        sent = self._sender.send_sms(
            to_phone=message.external_contact_id,
            message=reply.content,
        )
        if not sent:
            self._logger.error(
                "bot.channel.sms.send.failed",
                "No se pudo enviar la respuesta por SMS",
                channel_id=str(message.channel_id),
                to_phone=message.external_contact_id,
            )
        return sent

    # ------------------------------------------------------------------
    # Helpers de parseo del formato del webhook de Twilio
    # ------------------------------------------------------------------

    @staticmethod
    def _build_metadata(payload: dict[str, Any]) -> dict[str, Any]:
        """Extrae metadatos del formulario de Twilio (To, estado, cuenta)."""
        metadata: dict[str, Any] = {"message_type": "sms"}
        for key in ("To", "MessageStatus", "AccountSid", "SmsSid"):
            if payload.get(key) is not None:
                metadata[key] = payload[key]
        return metadata
