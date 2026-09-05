"""Fábrica de adaptadores y senders de canal por tenant (C-3 — Portales multired).

Resuelve las credenciales de cada canal desde ``tenant_channels`` (secretos
cifrados en reposo) para habilitar multi-canal por empresa sin fallback global
de credenciales. Soporta WhatsApp Cloud API (Meta), SMS (Twilio), Instagram y
Messenger (Graph API de Meta) y Webchat (widget embebido del portal). Implementa
dos puertos:

- :class:`~app.bot.interfaces.IChannelSenderFactory`: resuelve el adaptador
  concreto de un canal por ``channel_id`` (lo usa el worker de la cola D3).
- :class:`~app.services.workflow_interfaces.IWhatsAppSenderFactory`: resuelve
  el sender de WhatsApp del tenant (lo usa ``WorkflowService.capture_lead``).

La fábrica es un singleton del composition root (DI): no posee recursos
reutilizables — construye un sender efímero con las credenciales del canal.
Cada resolución usa la sesión ligada si se provee (camino HTTP, evita un
segundo escritor en SQLite) o abre su propia sesión en el worker. Todo el
flujo es fail-closed: sin canal, sin credenciales o tipo no soportado
devuelven ``None`` y se registra un evento estructurado de auditoría.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session

from app.bot.interfaces import IChannelAdapter, IChannelSenderFactory
from app.config.settings import Settings
from app.core.database import Database
from app.core.encryption import TokenCipher
from app.core.logging import ILogger
from app.models.tenant_config import TenantChannel
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantChannelRepository
from app.services.providers import (
    MetaGraphMessagesSender,
    TwilioSmsSender,
    WhatsAppCloudSender,
)
from app.services.workflow_interfaces import (
    IMetaGraphMessagesSender,
    ISmsSender,
    IWhatsAppSender,
    IWhatsAppSenderFactory,
)


class ChannelSenderFactory(IChannelSenderFactory, IWhatsAppSenderFactory):
    """Fábrica tenant-aware de adaptadores y senders de canal (Fase 6.1)."""

    _WHATSAPP = "whatsapp"
    _SMS = "sms"
    _INSTAGRAM = "instagram"
    _MESSENGER = "messenger"
    _WEBCHAT = "webchat"

    def __init__(
        self,
        *,
        database: Database,
        settings: Settings,
        logger: ILogger,
        cipher: TokenCipher | None,
        session: Session | None = None,
    ) -> None:
        self._database = database
        self._settings = settings
        self._logger = logger
        self._cipher = cipher
        # Sesión ligada opcional (camino HTTP): cuando se provee, las
        # resoluciones reutilizan la transacción del request; cuando es
        # ``None`` (singleton del container / worker) cada resolución abre su
        # propia ``session_scope``. Evita un segundo escritor en SQLite, donde
        # la transacción del request ya abrió ``BEGIN IMMEDIATE``.
        self._session = session

    @contextmanager
    def _repository(self) -> Iterator[SqlAlchemyTenantChannelRepository]:
        """Construye el repositorio de canales sobre la sesión ligada o una propia.

        - Camino HTTP (``session`` ligada): reutiliza la transacción del
          request — sin segunda conexión, sin deadlock en SQLite.
        - Worker/singleton (``session=None``): abre su propia ``session_scope``.
        """
        if self._session is not None:
            yield SqlAlchemyTenantChannelRepository(self._session, cipher=self._cipher)
            return
        with self._database.session_scope() as session:
            yield SqlAlchemyTenantChannelRepository(session, cipher=self._cipher)

    def resolve(self, *, channel_id: uuid.UUID) -> IChannelAdapter | None:
        """Resuelve el adaptador concreto del canal (None si no existe/soportado)."""
        with self._repository() as repo:
            channel = repo.resolve_by_channel_id(channel_id=channel_id)

        if channel is None:
            self._logger.warning(
                "bot.factory.channel_not_found",
                message="No se encontró el canal configurado; envío no resuelto",
                channel_id=str(channel_id),
            )
            return None

        builder = self._adapter_builders().get(channel.channel_type)
        if builder is None:
            self._logger.warning(
                "bot.factory.unsupported_channel",
                message="Tipo de canal no soportado por la fábrica",
                channel_id=str(channel_id),
                channel_type=channel.channel_type,
            )
            return None

        if not self._has_credentials(channel):
            self._logger.warning(
                "bot.factory.missing_credentials",
                message="El canal no tiene credenciales completas; envío no resuelto",
                channel_id=str(channel_id),
                channel_type=channel.channel_type,
            )
            return None

        adapter = builder(channel)
        self._logger.info(
            "bot.factory.resolved",
            message="Adaptador de canal resuelto desde tenant_channels",
            channel_id=str(channel_id),
            channel_type=channel.channel_type,
        )
        return adapter

    def resolve_sender_for_tenant(self, *, tenant_id: uuid.UUID) -> IWhatsAppSender | None:
        """Resuelve el sender de WhatsApp del tenant (None si no hay canal habilitado)."""
        with self._repository() as repo:
            channels = repo.get_by_type(tenant_id=tenant_id, channel_type=self._WHATSAPP)

        # ``get_by_type`` filtra tenant+no-delete pero NO ``enabled``: se valida
        # explícitamente junto con las credenciales (fail-closed).
        for channel in channels:
            if channel.enabled and self._has_credentials(channel):
                sender = self._build_sender(channel=channel)
                self._logger.info(
                    "bot.factory.sender_resolved",
                    message="Sender de WhatsApp resuelto por tenant",
                    tenant_id=str(tenant_id),
                    channel_id=str(channel.id),
                    channel_type=channel.channel_type,
                )
                return sender

        self._logger.warning(
            "bot.factory.no_sender_for_tenant",
            message="El tenant no tiene canal WhatsApp habilitado con credenciales",
            tenant_id=str(tenant_id),
            channel_type=self._WHATSAPP,
        )
        return None

    @classmethod
    def _has_credentials(cls, channel: TenantChannel) -> bool:
        """Valida credenciales mínimas por tipo de canal (fail-closed).

        - WhatsApp: phone_number_id (WABA) + access_token (token de Meta).
        - SMS (Twilio): phone_number (From) + phone_number_id (Account SID) +
          access_token (auth token).
        - Instagram/Messenger: access_token (token de página/cuenta profesional).
        - Webchat: access_token (clave del widget).
        """
        if channel.channel_type == cls._WHATSAPP:
            return bool(channel.phone_number_id) and bool(channel.access_token)
        if channel.channel_type == cls._SMS:
            return (
                bool(channel.phone_number)
                and bool(channel.phone_number_id)
                and bool(channel.access_token)
            )
        if channel.channel_type in (cls._INSTAGRAM, cls._MESSENGER, cls._WEBCHAT):
            return bool(channel.access_token)
        return False

    def _build_sender(
        self, *, channel: TenantChannel
    ) -> IWhatsAppSender | ISmsSender | IMetaGraphMessagesSender:
        """Construye un sender efímero con las credenciales descifradas del canal."""
        if channel.channel_type == self._WHATSAPP:
            return WhatsAppCloudSender(
                phone_number_id=channel.phone_number_id or "",
                access_token=channel.access_token,
                webhook_secret=channel.webhook_secret or "",
                timeout_seconds=self._settings.whatsapp_timeout_seconds,
                base_url=self._settings.whatsapp_base_url,
                logger=self._logger,
            )
        if channel.channel_type == self._SMS:
            return TwilioSmsSender(
                account_sid=channel.phone_number_id or "",
                auth_token=channel.access_token,
                from_phone=channel.phone_number or "",
                timeout_seconds=self._settings.twilio_timeout_seconds,
                logger=self._logger,
            )
        if channel.channel_type in (self._INSTAGRAM, self._MESSENGER):
            return MetaGraphMessagesSender(
                access_token=channel.access_token,
                webhook_secret=channel.webhook_secret or "",
                timeout_seconds=self._settings.meta_graph_timeout_seconds,
                base_url=self._settings.meta_graph_base_url,
                logger=self._logger,
            )
        raise ValueError(f"Tipo de canal sin sender: {channel.channel_type}")

    def _adapter_builders(self) -> dict[str, Callable[[TenantChannel], IChannelAdapter]]:
        """Registro de adaptadores por tipo de canal (multired).

        Los imports son locales para romper el ciclo ``adaptador → app.core →
        di → factory``: cada adaptador importa ``app.core`` solo para un type
        hint (ILogger) y ``app.core.di`` importa esta fábrica — el import a
        nivel de módulo re-importaría un adaptador parcialmente inicializado.
        Cada closure captura ``self`` y delega la construcción del sender a
        ``_build_sender`` (excepto el webchat, que es pull y no requiere sender).
        """
        from app.bot.channels.instagram import InstagramChannelAdapter
        from app.bot.channels.messenger import MessengerChannelAdapter
        from app.bot.channels.sms import SmsChannelAdapter
        from app.bot.channels.webchat import WebchatChannelAdapter
        from app.bot.channels.whatsapp import WhatsAppCloudChannelAdapter

        def _whatsapp(channel: TenantChannel) -> IChannelAdapter:
            sender = self._build_sender(channel=channel)
            return WhatsAppCloudChannelAdapter(sender=sender, logger=self._logger)

        def _sms(channel: TenantChannel) -> IChannelAdapter:
            sender = self._build_sender(channel=channel)
            return SmsChannelAdapter(sender=sender, logger=self._logger)

        def _instagram(channel: TenantChannel) -> IChannelAdapter:
            sender = self._build_sender(channel=channel)
            return InstagramChannelAdapter(sender=sender, logger=self._logger)

        def _messenger(channel: TenantChannel) -> IChannelAdapter:
            sender = self._build_sender(channel=channel)
            return MessengerChannelAdapter(sender=sender, logger=self._logger)

        def _webchat(_channel: TenantChannel) -> IChannelAdapter:
            return WebchatChannelAdapter(logger=self._logger)

        return {
            self._WHATSAPP: _whatsapp,
            self._SMS: _sms,
            self._INSTAGRAM: _instagram,
            self._MESSENGER: _messenger,
            self._WEBCHAT: _webchat,
        }
