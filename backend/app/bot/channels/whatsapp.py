"""Adaptador del canal WhatsApp (Cloud API de Meta) para el bot (Fase 5).

Implementa :class:`~app.bot.interfaces.IChannelAdapter` para la WhatsApp Cloud
API. Responsabilidades:

- ``verify_webhook``: valida la estructura del handshake ``GET`` de Meta
  (``hub.mode`` / ``hub.verify_token`` / ``hub.challenge``). La resolución del
  ``verify_token`` contra los canales configurados la hace el router (no hay
  verify_token local, plan §8.3).
- ``parse_inbound``: normaliza el payload del webhook ``POST`` a un
  :class:`~app.bot.interfaces.InboundMessage`. Requiere el ``channel_id`` real
  resuelto por el router (el payload de la Cloud API no lo incluye) y devuelve
  ``None`` cuando el evento no contiene mensaje entrante (p. ej. un estado de
  entrega/lectura), para que el router responda ``200`` sin procesar.
- ``send``: envía la respuesta del bot con ``IWhatsAppSender.send_text``.

Este adaptador es agnóstico de la base de datos: el envío se hace con el
``IWhatsAppSender`` inyectado y el parseo es puramente estructural.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from typing import Any

from app.bot.interfaces import BotResponse, IChannelAdapter, InboundMessage
from app.core.logging import ILogger
from app.services.workflow_interfaces import IWhatsAppSender


class WhatsAppCloudChannelAdapter(IChannelAdapter):
    """Adaptador del canal WhatsApp (Cloud API de Meta)."""

    def __init__(self, *, sender: IWhatsAppSender, logger: ILogger) -> None:
        self._sender = sender
        self._logger = logger

    @property
    def kind(self) -> str:
        """Tipo de canal: ``whatsapp``."""
        return "whatsapp"

    def verify_webhook(
        self,
        *,
        mode: str | None,
        verify_token: str | None,
        challenge: str | None,
    ) -> str | None:
        """Valida el handshake ``GET`` y devuelve el challenge a eco, o ``None``.

        Solo valida la estructura (modo ``subscribe`` + token/challenge no
        vacíos). La autenticidad del token ya fue comprobada por el router al
        resolver el canal con ``resolve_by_verify_token`` (fail-closed).
        """
        if mode != "subscribe" or not verify_token or not challenge:
            self._logger.warning(
                "bot.channel.webhook.verify.rejected",
                "Handshake del webhook de WhatsApp inválido",
                mode=mode,
                has_token=bool(verify_token),
                has_challenge=bool(challenge),
            )
            return None
        return challenge

    def verify_signature(
        self,
        *,
        webhook_secret: str,
        raw_body: bytes,
        signature: str | None,
    ) -> bool:
        """Verifica la firma ``X-Hub-Signature-256`` del webhook de Meta.

        La firma tiene el formato ``sha256=<hex>`` y se calcula con el
        ``webhook_secret`` del canal (descifrado por el router desde
        ``tenant_channels``), NO con el secret global del sender: cada canal
        puede tener el suyo. Se compara en tiempo constante
        (``hmac.compare_digest``) y falla cerrado: sin secret, sin firma o con
        formato inválido devuelve ``False``.
        """
        if not webhook_secret or not signature:
            self._logger.warning(
                "bot.channel.webhook.signature.missing",
                "Firma del webhook ausente o sin secret configurado",
                has_secret=bool(webhook_secret),
                has_signature=bool(signature),
            )
            return False
        prefix = "sha256="
        if not signature.startswith(prefix):
            return False
        expected = prefix + hmac.new(
            webhook_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def parse_inbound(
        self,
        *,
        payload: Any,
        channel_id: uuid.UUID,
    ) -> InboundMessage | None:
        """Normaliza el payload del webhook a un :class:`InboundMessage`.

        Devuelve ``None`` cuando el evento no trae mensaje entrante (solo un
        estado de entrega/lectura, o un cambio sin ``messages``): en ese caso el
        router confirma ``200`` sin despachar.
        """
        message = self._extract_message(payload)
        if message is None:
            return None
        message_id = message.get("id")
        external_contact_id = message.get("from") or ""
        text = message.get("text", {}).get("body", "") if isinstance(message.get("text"), dict) else ""
        message_type = message.get("type") or "text"
        metadata = self._build_metadata(payload, message_type=message_type)

        if not external_contact_id:
            self._logger.warning(
                "bot.channel.webhook.inbound.missing_sender",
                "Mensaje entrante sin remitente (from) en el payload",
                channel_id=str(channel_id),
                message_id=message_id,
            )
            return None

        self._logger.info(
            "bot.channel.webhook.inbound.parsed",
            "Mensaje entrante de WhatsApp normalizado",
            channel_id=str(channel_id),
            message_id=message_id,
            message_type=message_type,
        )
        return InboundMessage(
            channel_id=channel_id,
            external_contact_id=external_contact_id,
            text=text,
            message_id=message_id,
            metadata=metadata,
        )

    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        """Envía la respuesta del bot al contacto vía ``IWhatsAppSender``."""
        sent = self._sender.send_text(to_phone=message.external_contact_id, text=reply.content)
        if not sent:
            self._logger.error(
                "bot.channel.whatsapp.send.failed",
                "No se pudo enviar la respuesta por WhatsApp",
                channel_id=str(message.channel_id),
                to_phone=message.external_contact_id,
            )
        return sent

    # ------------------------------------------------------------------
    # Helpers de parseo del formato de la WhatsApp Cloud API
    # ------------------------------------------------------------------

    @staticmethod
    def extract_phone_number_id(payload: Any) -> str | None:
        """Extrae el ``phone_number_id`` del payload (para resolver el canal).

        El payload de la Cloud API no incluye el ``channel_id`` interno de
        OmniBotIA: el router usa el ``phone_number_id`` de ``value.metadata``
        para resolver el canal (``resolve_by_phone_number_id``) ANTES de
        ``parse_inbound``. Devuelve ``None`` si el payload no trae un número
        válido (fail-closed: el router confirmará ``200`` sin procesar).
        """
        if not isinstance(payload, dict):
            return None
        entry = payload.get("entry")
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], dict):
            return None
        changes = entry[0].get("changes")
        if not isinstance(changes, list) or not changes or not isinstance(changes[0], dict):
            return None
        value = changes[0].get("value")
        if not isinstance(value, dict):
            return None
        channel_meta = value.get("metadata")
        if not isinstance(channel_meta, dict):
            return None
        phone_number_id = channel_meta.get("phone_number_id")
        if isinstance(phone_number_id, str) and phone_number_id:
            return phone_number_id
        return None

    @staticmethod
    def _extract_message(payload: Any) -> dict[str, Any] | None:
        """Extrae el primer mensaje del payload; ``None`` si no hay mensaje."""
        if not isinstance(payload, dict):
            return None
        entry = payload.get("entry")
        if not isinstance(entry, list) or not entry:
            return None
        changes = entry[0].get("changes")
        if not isinstance(changes, list) or not changes:
            return None
        value = changes[0].get("value")
        if not isinstance(value, dict):
            return None
        messages = value.get("messages")
        if not isinstance(messages, list) or not messages:
            return None
        first = messages[0]
        return first if isinstance(first, dict) else None

    @staticmethod
    def _build_metadata(payload: Any, *, message_type: str) -> dict[str, Any]:
        """Extrae metadatos del canal (phone_number_id, contacto, timestamp)."""
        metadata: dict[str, Any] = {"message_type": message_type}
        if not isinstance(payload, dict):
            return metadata
        entry = payload.get("entry")
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], dict):
            return metadata
        changes = entry[0].get("changes")
        if not isinstance(changes, list) or not changes or not isinstance(changes[0], dict):
            return metadata
        value = changes[0].get("value")
        if not isinstance(value, dict):
            return metadata

        channel_meta = value.get("metadata")
        if isinstance(channel_meta, dict):
            if channel_meta.get("phone_number_id") is not None:
                metadata["phone_number_id"] = channel_meta["phone_number_id"]
            if channel_meta.get("display_phone_number") is not None:
                metadata["display_phone_number"] = channel_meta["display_phone_number"]

        contacts = value.get("contacts")
        if isinstance(contacts, list) and contacts and isinstance(contacts[0], dict):
            profile = contacts[0].get("profile")
            if isinstance(profile, dict) and profile.get("name") is not None:
                metadata["profile_name"] = profile["name"]

        message = WhatsAppCloudChannelAdapter._extract_message(payload)
        if isinstance(message, dict):
            for key in ("timestamp", "type"):
                if message.get(key) is not None:
                    metadata[key] = message[key]
        return metadata
