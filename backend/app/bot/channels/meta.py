"""Adaptador base de los canales de la Graph API de Meta (Instagram/Messenger).

Implementa :class:`~app.bot.interfaces.IChannelAdapter` para el webhook de
mensajería que comparten la Instagram Messaging API y la Messenger Platform:
``entry[0].messaging[0]`` con ``sender.id`` / ``recipient.id`` / ``message.text``
/ ``message.mid``. Los adaptadores concretos (:class:`InstagramChannelAdapter` y
:class:`MessengerChannelAdapter`) solo fijan el ``kind`` (regla CLAUDE: sin
duplicación). Responsabilidades:

- ``verify_webhook``: valida la estructura del handshake ``GET`` de Meta
  (``hub.mode`` / ``hub.verify_token`` / ``hub.challenge``); la autenticidad del
  token la resuelve el router contra los canales (fail-closed).
- ``verify_signature``: valida ``X-Hub-Signature-256`` (``sha256=<hex>``) con el
  ``webhook_secret`` del canal en tiempo constante.
- ``parse_inbound``: normaliza ``messaging`` a un
  :class:`~app.bot.interfaces.InboundMessage` (``sender.id`` → contacto externo,
  ``message.mid`` → id del mensaje). Devuelve ``None`` cuando el evento no trae
  mensaje de texto (p. ej. reacciones, entregas, mensajes no-dict).
- ``send``: envía la respuesta con ``IMetaGraphMessagesSender.send_text``.

Este adaptador es agnóstico de la base de datos: el envío se hace con el
``IMetaGraphMessagesSender`` inyectado y el parseo es puramente estructural.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from abc import abstractmethod
from typing import Any

from app.bot.interfaces import BotResponse, IChannelAdapter, InboundMessage
from app.core.logging import ILogger
from app.services.workflow_interfaces import IMetaGraphMessagesSender

# Eventos estructurados compartidos por Instagram y Messenger.
_VERIFY_REJECTED = "bot.channel.webhook.verify.rejected"
_SIGNATURE_MISSING = "bot.channel.webhook.signature.missing"
_INBOUND_MISSING_SENDER = "bot.channel.webhook.inbound.missing_sender"
_INBOUND_PARSED = "bot.channel.webhook.inbound.parsed"
_SEND_FAILED = "bot.channel.meta.send.failed"


class MetaMessagingChannelAdapter(IChannelAdapter):
    """Adaptador base de canales de mensajería de la Graph API de Meta."""

    def __init__(self, *, sender: IMetaGraphMessagesSender, logger: ILogger) -> None:
        self._sender = sender
        self._logger = logger

    @property
    @abstractmethod
    def kind(self) -> str:
        """Tipo de canal: ``instagram`` o ``messenger`` (fijado por la subclase)."""

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
                _VERIFY_REJECTED,
                "Handshake del webhook de Meta inválido",
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
        ``tenant_channels``). Se compara en tiempo constante
        (``hmac.compare_digest``) y falla cerrado: sin secret, sin firma o con
        formato inválido devuelve ``False``.
        """
        if not webhook_secret or not signature:
            self._logger.warning(
                _SIGNATURE_MISSING,
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
        """Normaliza el evento ``messaging`` a un :class:`InboundMessage`.

        Devuelve ``None`` cuando el evento no trae un mensaje de texto entrante
        (reacción, entrega, lectura o mensaje sin texto): el router confirma
        ``200`` sin despachar.
        """
        messaging = self._extract_messaging(payload)
        if messaging is None:
            return None

        message = messaging.get("message")
        if not isinstance(message, dict):
            return None
        text = message.get("text")
        if not isinstance(text, str) or not text:
            return None

        sender = messaging.get("sender")
        external_contact_id = sender.get("id") if isinstance(sender, dict) else ""
        message_id = messaging.get("mid")
        metadata = self._build_metadata(payload, messaging=messaging)

        if not external_contact_id:
            self._logger.warning(
                _INBOUND_MISSING_SENDER,
                "Mensaje entrante sin remitente (sender.id) en el payload",
                channel_id=str(channel_id),
                message_id=message_id,
            )
            return None

        self._logger.info(
            _INBOUND_PARSED,
            "Mensaje entrante de Meta normalizado",
            channel_id=str(channel_id),
            message_id=message_id,
            message_type="text",
        )
        return InboundMessage(
            channel_id=channel_id,
            external_contact_id=external_contact_id,
            text=text,
            message_id=message_id,
            metadata=metadata,
        )

    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        """Envía la respuesta del bot al contacto vía ``IMetaGraphMessagesSender``."""
        sent = self._sender.send_text(
            recipient_id=message.external_contact_id,
            text=reply.content,
        )
        if not sent:
            self._logger.error(
                _SEND_FAILED,
                "No se pudo enviar la respuesta por Meta Graph",
                channel_id=str(message.channel_id),
                recipient_id=message.external_contact_id,
            )
        return sent

    # ------------------------------------------------------------------
    # Helpers de parseo del formato del webhook de mensajería de Meta
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_messaging(payload: Any) -> dict[str, Any] | None:
        """Extrae el primer evento ``messaging`` del payload; ``None`` si no hay."""
        if not isinstance(payload, dict):
            return None
        entry = payload.get("entry")
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], dict):
            return None
        messaging_events = entry[0].get("messaging")
        if not isinstance(messaging_events, list) or not messaging_events:
            return None
        first = messaging_events[0]
        return first if isinstance(first, dict) else None

    @staticmethod
    def extract_entry_id(payload: Any) -> str | None:
        """Extrae el ``id`` de la primera ``entry`` del webhook de Meta.

        El ``entry[0].id`` identifica la página (Messenger) o la cuenta de
        Instagram que recibe el evento y equivale al ``external_id`` del canal;
        se usa para resolver el tenant en el webhook entrante. Fail-closed:
        devuelve ``None`` si el payload no tiene la forma esperada.
        """
        if not isinstance(payload, dict):
            return None
        entry = payload.get("entry")
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], dict):
            return None
        entry_id = entry[0].get("id")
        return entry_id if isinstance(entry_id, str) and entry_id else None

    @staticmethod
    def _build_metadata(payload: Any, *, messaging: dict[str, Any]) -> dict[str, Any]:
        """Extrae metadatos del evento (objeto, entrada, remitente, tiempos)."""
        metadata: dict[str, Any] = {"message_type": "text"}
        if isinstance(payload, dict):
            if payload.get("object") is not None:
                metadata["object"] = payload["object"]
            entry = payload.get("entry")
            if isinstance(entry, list) and entry and isinstance(entry[0], dict):
                if entry[0].get("id") is not None:
                    metadata["entry_id"] = entry[0]["id"]
                if entry[0].get("time") is not None:
                    metadata["entry_time"] = entry[0]["time"]

        if messaging.get("timestamp") is not None:
            metadata["messaging_timestamp"] = messaging["timestamp"]
        recipient = messaging.get("recipient")
        if isinstance(recipient, dict) and recipient.get("id") is not None:
            metadata["recipient_id"] = recipient["id"]
        return metadata
