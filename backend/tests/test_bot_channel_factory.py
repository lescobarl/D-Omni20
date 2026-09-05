"""Pruebas de la fábrica tenant-aware de canales (Fase 6.1 — D2).

Cubre :class:`ChannelSenderFactory`: resolución del adaptador por ``channel_id``
(``resolve``) y del sender de WhatsApp por tenant (``resolve_sender_for_tenant``)
usando canales reales en el SQLite compartido de los tests (secretos cifrados en
reposo). Todo el flujo es fail-closed: sin canal, tipo no soportado, canal
deshabilitado o credenciales incompletas devuelven ``None`` y registran un evento
estructurado de auditoría.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.bot.channels.factory import ChannelSenderFactory
from app.bot.channels.instagram import InstagramChannelAdapter
from app.bot.channels.messenger import MessengerChannelAdapter
from app.bot.channels.sms import SmsChannelAdapter
from app.bot.channels.webchat import WebchatChannelAdapter
from app.bot.channels.whatsapp import WhatsAppCloudChannelAdapter
from app.core.di import Container
from app.core.logging import ILogger
from app.models.tenant_config import TenantChannel
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantChannelRepository
from app.services.providers import WhatsAppCloudSender


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


def _build_factory(container: Container) -> tuple[ChannelSenderFactory, FakeLogger]:
    """Construye la fábrica con el contenedor real y un logger en memoria."""
    logger = FakeLogger()
    factory = ChannelSenderFactory(
        database=container.database,
        settings=container.settings,
        logger=logger,
        cipher=container.token_cipher,
    )
    return factory, logger


def _create_channel(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    channel_type: str = "whatsapp",
    enabled: bool = True,
    access_token: str | None = None,
    phone_number: str | None = None,
) -> TenantChannel:
    """Crea un canal real en el SQLite compartido (secretos únicos por defecto)."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantChannelRepository(session, cipher=container.token_cipher)
        return repo.create(
            tenant_id=tenant_id,
            channel_type=channel_type,
            external_id=f"ch-f61-{uuid.uuid4().hex}",
            phone_number=(phone_number if phone_number is not None else "5215500000000"),
            phone_number_id=f"f61-{uuid.uuid4().hex}",
            access_token=(
                access_token if access_token is not None else f"EAAG-f61-{uuid.uuid4().hex}"
            ),
            webhook_secret=f"secret-{uuid.uuid4().hex}",
            enabled=enabled,
        )


def test_resolve_returns_whatsapp_adapter(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4())

    adapter = factory.resolve(channel_id=channel.id)

    assert isinstance(adapter, WhatsAppCloudChannelAdapter)
    assert any(event == "bot.factory.resolved" for event, _, _ in logger.events)


def test_resolve_unknown_channel_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)

    adapter = factory.resolve(channel_id=uuid.uuid4())

    assert adapter is None
    assert any(event == "bot.factory.channel_not_found" for event, _, _ in logger.events)


def test_resolve_disabled_channel_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), enabled=False)

    adapter = factory.resolve(channel_id=channel.id)

    assert adapter is None
    assert any(event == "bot.factory.channel_not_found" for event, _, _ in logger.events)


def test_resolve_unsupported_channel_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), channel_type="telegram")

    adapter = factory.resolve(channel_id=channel.id)

    assert adapter is None
    assert any(event == "bot.factory.unsupported_channel" for event, _, _ in logger.events)


def test_resolve_missing_credentials_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), access_token="")

    adapter = factory.resolve(channel_id=channel.id)

    assert adapter is None
    assert any(event == "bot.factory.missing_credentials" for event, _, _ in logger.events)


def test_resolve_returns_sms_adapter(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), channel_type="sms")

    adapter = factory.resolve(channel_id=channel.id)

    assert isinstance(adapter, SmsChannelAdapter)
    assert any(event == "bot.factory.resolved" for event, _, _ in logger.events)


def test_resolve_returns_instagram_adapter(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), channel_type="instagram")

    adapter = factory.resolve(channel_id=channel.id)

    assert isinstance(adapter, InstagramChannelAdapter)
    assert any(event == "bot.factory.resolved" for event, _, _ in logger.events)


def test_resolve_returns_messenger_adapter(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), channel_type="messenger")

    adapter = factory.resolve(channel_id=channel.id)

    assert isinstance(adapter, MessengerChannelAdapter)
    assert any(event == "bot.factory.resolved" for event, _, _ in logger.events)


def test_resolve_returns_webchat_adapter(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(container, uuid.uuid4(), channel_type="webchat")

    adapter = factory.resolve(channel_id=channel.id)

    assert isinstance(adapter, WebchatChannelAdapter)
    assert any(event == "bot.factory.resolved" for event, _, _ in logger.events)


def test_resolve_sms_missing_phone_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(
        container, uuid.uuid4(), channel_type="sms", phone_number=""
    )

    adapter = factory.resolve(channel_id=channel.id)

    assert adapter is None
    assert any(event == "bot.factory.missing_credentials" for event, _, _ in logger.events)


def test_resolve_instagram_missing_token_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    channel = _create_channel(
        container, uuid.uuid4(), channel_type="instagram", access_token=""
    )

    adapter = factory.resolve(channel_id=channel.id)

    assert adapter is None
    assert any(event == "bot.factory.missing_credentials" for event, _, _ in logger.events)


def test_resolve_sender_for_tenant_returns_sender(container: Container) -> None:
    factory, logger = _build_factory(container)
    tenant = uuid.uuid4()
    _create_channel(container, tenant)

    sender = factory.resolve_sender_for_tenant(tenant_id=tenant)

    assert isinstance(sender, WhatsAppCloudSender)
    assert any(event == "bot.factory.sender_resolved" for event, _, _ in logger.events)


def test_resolve_sender_for_tenant_no_channels_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)

    sender = factory.resolve_sender_for_tenant(tenant_id=uuid.uuid4())

    assert sender is None
    assert any(event == "bot.factory.no_sender_for_tenant" for event, _, _ in logger.events)


def test_resolve_sender_for_tenant_disabled_channel_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    tenant = uuid.uuid4()
    _create_channel(container, tenant, enabled=False)

    sender = factory.resolve_sender_for_tenant(tenant_id=tenant)

    assert sender is None
    assert any(event == "bot.factory.no_sender_for_tenant" for event, _, _ in logger.events)


def test_resolve_sender_for_tenant_missing_credentials_returns_none(container: Container) -> None:
    factory, logger = _build_factory(container)
    tenant = uuid.uuid4()
    _create_channel(container, tenant, access_token="")

    sender = factory.resolve_sender_for_tenant(tenant_id=tenant)

    assert sender is None
    assert any(event == "bot.factory.no_sender_for_tenant" for event, _, _ in logger.events)


def test_resolve_sender_for_tenant_skips_invalid_uses_valid(container: Container) -> None:
    factory, logger = _build_factory(container)
    tenant = uuid.uuid4()
    _create_channel(container, tenant, enabled=False)
    _create_channel(container, tenant, access_token="")
    _create_channel(container, tenant)

    sender = factory.resolve_sender_for_tenant(tenant_id=tenant)

    assert isinstance(sender, WhatsAppCloudSender)
    assert any(event == "bot.factory.sender_resolved" for event, _, _ in logger.events)
    assert any(event == "bot.factory.no_sender_for_tenant" for event, _, _ in logger.events) is False
