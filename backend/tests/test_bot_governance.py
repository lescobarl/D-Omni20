"""Pruebas de gobernanza del bot (Fase 9): cuota de tokens (9b/L1) y privacidad (9a/M4).

Cubre:
- ``TokenQuotaService.report``: estados ``ok`` / ``warning`` / ``exceeded`` / sin-límite,
  cálculo de la ventana (``since ≈ now - window_hours``) y alertas estructuradas.
- ``BotPrivacyService.export`` / ``erase`` / ``purge_expired``: portabilidad (art. 15),
  cancelación (art. 16) y retención LFPDPPP, todas acotadas por tenant.
- Endpoints tenant-scoped: ``GET /bot/quota/usage``, ``GET /bot/privacy/export``,
  ``DELETE /bot/privacy/data`` y el aislamiento 403 sin cabecera ``X-Tenant-Id``.

Los tests de servicio usan el SQLite compartido del contenedor DI
(``set_app_current_tenant`` es NO-OP en SQLite, así que el aislamiento lo
garantizan los repositorios por tenant). Los tests de endpoint usan el
``TestClient`` de la app contra el mismo archivo SQLite.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.bot.governance import BotPrivacyService, TokenQuotaService, _quota_status
from app.bot.queue import (
    CONVERSATION_STATE_ACTIVE,
    DIRECTION_OUTBOUND,
    QUEUE_PENDING,
)
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
)
from app.bot.repository_interfaces import BotUsageAggregate
from app.config.settings import Settings
from app.core.di import Container
from app.models.base import utcnow
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantChannelRepository
from tests.test_bot_queue import FakeLogger


class _FakeMessageRepo:
    """Falso duck-typed del puerto de mensajes: solo expone ``aggregate_usage``."""

    def __init__(
        self,
        aggregates: list[BotUsageAggregate],
        calls: list[tuple[uuid.UUID, datetime]],
    ) -> None:
        self._aggregates = aggregates
        self._calls = calls

    def aggregate_usage(
        self, *, tenant_id: uuid.UUID, since: datetime
    ) -> list[BotUsageAggregate]:
        self._calls.append((tenant_id, since))
        return list(self._aggregates)


def _events_by_name(
    logger: FakeLogger, name: str
) -> list[tuple[str, str, dict[str, Any]]]:
    return [event for event in logger.events if event[0] == name]


def _build_quota_service(
    container: Container,
    *,
    daily_tokens: int,
    window_hours: float,
    aggregates: list[BotUsageAggregate],
    calls: list[tuple[uuid.UUID, datetime]],
) -> tuple[TokenQuotaService, FakeLogger]:
    """Servicio de cuota con repositorio falso + logger de prueba (settings aislados)."""
    settings = Settings(
        database_url="sqlite:///:memory:",
        backend_env="development",
        bot_quota_daily_tokens=daily_tokens,
        bot_quota_window_hours=window_hours,
    )
    logger = FakeLogger()
    service = TokenQuotaService(
        database=container.database,
        settings=settings,
        logger=logger,
        message_repository_factory=lambda _session: _FakeMessageRepo(aggregates, calls),
    )
    return service, logger


def _build_privacy_service(
    container: Container, *, retention_days: int
) -> tuple[BotPrivacyService, FakeLogger]:
    """Servicio de privacidad con repositorios reales sobre el SQLite compartido."""
    settings = Settings(
        database_url="sqlite:///:memory:",
        backend_env="development",
        bot_data_retention_days=retention_days,
    )
    logger = FakeLogger()
    service = BotPrivacyService(
        database=container.database,
        settings=settings,
        logger=logger,
        conversation_repository_factory=lambda session: SqlAlchemyBotConversationRepository(
            session
        ),
        message_repository_factory=lambda session: SqlAlchemyBotMessageRepository(session),
    )
    return service, logger


def _seed_bot_data(
    container: Container,
    tenant_id: uuid.UUID,
    *,
    message_count: int = 2,
    created_at: datetime | None = None,
) -> uuid.UUID:
    """Siembra canal → conversación → mensajes (orden FK) para un tenant.

    Si ``created_at`` se proporciona, se aplica a la conversación (via
    ``last_message_at``) y a cada mensaje; en caso contrario se usan timestamps
    actuales. Devuelve el ``id`` de la conversación creada.
    """
    with container.database.session_scope() as session:
        channel_repo = SqlAlchemyTenantChannelRepository(
            session, cipher=container.token_cipher
        )
        channel = channel_repo.create(
            tenant_id=tenant_id,
            channel_type="whatsapp",
            external_id=f"gov-wa-{uuid.uuid4().hex}",
            phone_number="5215500000001",
            phone_number_id=f"gov-phone-{uuid.uuid4().hex}",
            access_token=f"gov-token-{uuid.uuid4().hex}",
            webhook_secret=f"gov-secret-{uuid.uuid4().hex}",
            enabled=True,
        )
        conv_repo = SqlAlchemyBotConversationRepository(session)
        conversation = conv_repo.upsert(
            tenant_id=tenant_id,
            channel_id=channel.id,
            external_contact_id=f"gov-contact-{uuid.uuid4().hex}",
            state=CONVERSATION_STATE_ACTIVE,
            last_message_at=created_at or utcnow(),
        )
        msg_repo = SqlAlchemyBotMessageRepository(session)
        for index in range(message_count):
            msg_repo.create(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction=DIRECTION_OUTBOUND,
                content=f"Mensaje de prueba {index}",
                provider_used="deepseek-chat",
                tokens_used=100 + index,
                message_id=f"msg-gov-{uuid.uuid4().hex}",
                queue_status=QUEUE_PENDING,
                created_at=created_at,
            )
    return conversation.id


@pytest.mark.parametrize(
    ("percent", "expected"),
    [
        (0.0, "ok"),
        (79.99, "ok"),
        (80.0, "warning"),
        (99.99, "warning"),
        (100.0, "exceeded"),
        (150.0, "exceeded"),
    ],
)
def test_quota_status_boundaries(percent: float, expected: str) -> None:
    """Límites del clasificador de estado: 80 % → warning, 100 % → exceeded."""
    assert _quota_status(percent) == expected


def test_quota_report_ok_no_alerts(container: Container) -> None:
    """Bajo el 80 % devuelve ``ok`` sin alertas y propaga tenant + ventana."""
    tenant = uuid.uuid4()
    calls: list[tuple[uuid.UUID, datetime]] = []
    service, logger = _build_quota_service(
        container,
        daily_tokens=1000,
        window_hours=24.0,
        aggregates=[BotUsageAggregate("deepseek-chat", 700, 5)],
        calls=calls,
    )

    response = service.report(tenant_id=tenant)

    assert response.tenant_id == tenant
    assert response.quota_limit == 1000
    assert response.total_tokens_used == 700
    assert response.total_percent == 70.0
    assert response.status == "ok"
    assert len(response.items) == 1
    item = response.items[0]
    assert item.provider_used == "deepseek-chat"
    assert item.tokens_used == 700
    assert item.message_count == 5
    assert item.percent == 70.0
    assert item.status == "ok"
    assert item.quota_limit == 1000

    assert len(calls) == 1
    called_tenant, since = calls[0]
    assert called_tenant == tenant
    expected_since = datetime.now(timezone.utc) - timedelta(hours=24.0)
    assert abs((since - expected_since).total_seconds()) < 5.0

    assert _events_by_name(logger, "bot.quota.warning") == []
    assert _events_by_name(logger, "bot.quota.exceeded") == []


def test_quota_report_warning_emits_warning(container: Container) -> None:
    """Al superar el 80 % emite ``bot.quota.warning`` con el desglose por tenant."""
    tenant = uuid.uuid4()
    calls: list[tuple[uuid.UUID, datetime]] = []
    service, logger = _build_quota_service(
        container,
        daily_tokens=1000,
        window_hours=24.0,
        aggregates=[BotUsageAggregate("deepseek-chat", 850, 8)],
        calls=calls,
    )

    response = service.report(tenant_id=tenant)

    assert response.status == "warning"
    assert response.total_percent == 85.0

    events = _events_by_name(logger, "bot.quota.warning")
    assert len(events) == 1
    _, message, fields = events[0]
    assert message == "Cuota de tokens próxima a superarse"
    assert fields["tenant_id"] == str(tenant)
    assert fields["provider_used"] == "deepseek-chat"
    assert fields["tokens_used"] == 850
    assert fields["quota_limit"] == 1000
    assert fields["percent"] == 85.0
    assert _events_by_name(logger, "bot.quota.exceeded") == []


def test_quota_report_exceeded_emits_exceeded_only(container: Container) -> None:
    """Al superar el 100 % emite SOLO ``bot.quota.exceeded`` (sin warning)."""
    tenant = uuid.uuid4()
    calls: list[tuple[uuid.UUID, datetime]] = []
    service, logger = _build_quota_service(
        container,
        daily_tokens=1000,
        window_hours=24.0,
        aggregates=[BotUsageAggregate("deepseek-chat", 1200, 10)],
        calls=calls,
    )

    response = service.report(tenant_id=tenant)

    assert response.status == "exceeded"
    assert response.total_percent == 120.0

    events = _events_by_name(logger, "bot.quota.exceeded")
    assert len(events) == 1
    _, message, fields = events[0]
    assert message == "Cuota de tokens superada por el tenant"
    assert fields["tenant_id"] == str(tenant)
    assert fields["tokens_used"] == 1200
    assert fields["quota_limit"] == 1000
    assert fields["percent"] == 120.0
    assert _events_by_name(logger, "bot.quota.warning") == []


def test_quota_report_unlimited_emits_no_alerts(container: Container) -> None:
    """Cuota 0 = sin límite: solo reporte, sin alertas ni porcentajes."""
    tenant = uuid.uuid4()
    calls: list[tuple[uuid.UUID, datetime]] = []
    service, logger = _build_quota_service(
        container,
        daily_tokens=0,
        window_hours=24.0,
        aggregates=[BotUsageAggregate("deepseek-chat", 1200, 10)],
        calls=calls,
    )

    response = service.report(tenant_id=tenant)

    assert response.quota_limit == 0
    assert response.total_tokens_used == 1200
    assert response.total_percent == 0.0
    assert response.status == "ok"
    assert response.items[0].percent == 0.0
    assert response.items[0].status == "ok"
    assert _events_by_name(logger, "bot.quota.warning") == []
    assert _events_by_name(logger, "bot.quota.exceeded") == []


def test_privacy_export_returns_validated_data(container: Container) -> None:
    """La exportación devuelve conversaciones/mensajes validados del tenant."""
    tenant = uuid.uuid4()
    conv_id = _seed_bot_data(container, tenant, message_count=2)
    service, logger = _build_privacy_service(container, retention_days=180)

    result = service.export(tenant_id=tenant)

    assert result.tenant_id == tenant
    assert result.exported_at is not None
    assert len(result.conversations) == 1
    assert result.conversations[0].id == conv_id
    assert result.conversations[0].tenant_id == tenant
    assert len(result.messages) == 2
    assert all(message.tenant_id == tenant for message in result.messages)
    assert all(
        message.conversation_id == conv_id for message in result.messages
    )

    events = _events_by_name(logger, "bot.privacy.exported")
    assert len(events) == 1
    fields = events[0][2]
    assert fields["conversations"] == 1
    assert fields["messages"] == 2


def test_privacy_erase_deletes_physically(container: Container) -> None:
    """El borrado físico (cancelación) elimina mensajes y conversaciones del tenant."""
    tenant = uuid.uuid4()
    _seed_bot_data(container, tenant, message_count=2)
    service, logger = _build_privacy_service(container, retention_days=180)

    result = service.erase(tenant_id=tenant)

    assert result.tenant_id == tenant
    assert result.deleted_conversations == 1
    assert result.deleted_messages == 2

    with container.database.session_scope() as session:
        conv_repo = SqlAlchemyBotConversationRepository(session)
        msg_repo = SqlAlchemyBotMessageRepository(session)
        assert conv_repo.list_all(tenant_id=tenant) == []
        assert msg_repo.list_all(tenant_id=tenant) == []

    events = _events_by_name(logger, "bot.privacy.erased")
    assert len(events) == 1
    fields = events[0][2]
    assert fields["deleted_conversations"] == 1
    assert fields["deleted_messages"] == 2


def test_privacy_purge_expired_retention_disabled(container: Container) -> None:
    """Retención 0 = deshabilitada: devuelve ceros y NO emite log de purgado."""
    tenant = uuid.uuid4()
    _seed_bot_data(container, tenant, message_count=1)
    service, logger = _build_privacy_service(container, retention_days=0)

    result = service.purge_expired(tenant_id=tenant)

    assert result.deleted_conversations == 0
    assert result.deleted_messages == 0
    assert _events_by_name(logger, "bot.privacy.retention_purged") == []


def test_privacy_purge_expired_deletes_only_old(container: Container) -> None:
    """El purgado por retención borra solo lo anterior al cutoff y conserva lo reciente."""
    tenant = uuid.uuid4()
    old = utcnow() - timedelta(days=30)
    _seed_bot_data(container, tenant, message_count=1, created_at=old)
    _seed_bot_data(container, tenant, message_count=1, created_at=None)
    service, logger = _build_privacy_service(container, retention_days=1)

    result = service.purge_expired(tenant_id=tenant)

    assert result.deleted_conversations == 1
    assert result.deleted_messages == 1

    with container.database.session_scope() as session:
        conv_repo = SqlAlchemyBotConversationRepository(session)
        msg_repo = SqlAlchemyBotMessageRepository(session)
        remaining_convs = conv_repo.list_all(tenant_id=tenant)
        remaining_msgs = msg_repo.list_all(tenant_id=tenant)
    assert len(remaining_convs) == 1
    assert len(remaining_msgs) == 1

    events = _events_by_name(logger, "bot.privacy.retention_purged")
    assert len(events) == 1
    fields = events[0][2]
    assert fields["retention_days"] == 1
    assert fields["deleted_conversations"] == 1
    assert fields["deleted_messages"] == 1


def test_get_quota_usage_endpoint_returns_200(
    client: TestClient, container: Container, super_admin_token: str
) -> None:
    """``GET /bot/quota/usage`` reporta el consumo del tenant del request."""
    tenant = uuid.uuid4()
    _seed_bot_data(container, tenant, message_count=2)

    response = client.get(
        "/api/v1/bot/quota/usage",
        headers={
            "X-Tenant-Id": str(tenant),
            "Authorization": f"Bearer {super_admin_token}",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tenant_id"] == str(tenant)
    assert payload["quota_limit"] == 100000
    assert payload["total_tokens_used"] == 201
    assert payload["total_percent"] == 0.2
    assert payload["status"] == "ok"
    assert len(payload["items"]) == 1
    assert payload["items"][0]["provider_used"] == "deepseek-chat"
    assert payload["items"][0]["tokens_used"] == 201


def test_export_privacy_endpoint_returns_data(
    client: TestClient, container: Container, super_admin_token: str
) -> None:
    """``GET /bot/privacy/export`` devuelve la portabilidad del tenant."""
    tenant = uuid.uuid4()
    _seed_bot_data(container, tenant, message_count=2)

    response = client.get(
        "/api/v1/bot/privacy/export",
        headers={
            "X-Tenant-Id": str(tenant),
            "Authorization": f"Bearer {super_admin_token}",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tenant_id"] == str(tenant)
    assert payload["exported_at"] is not None
    assert len(payload["conversations"]) == 1
    assert len(payload["messages"]) == 2


def test_erase_privacy_endpoint_deletes(
    client: TestClient, container: Container, super_admin_token: str
) -> None:
    """``DELETE /bot/privacy/data`` borra físicamente los datos del tenant."""
    tenant = uuid.uuid4()
    _seed_bot_data(container, tenant, message_count=2)

    response = client.delete(
        "/api/v1/bot/privacy/data",
        headers={
            "X-Tenant-Id": str(tenant),
            "Authorization": f"Bearer {super_admin_token}",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tenant_id"] == str(tenant)
    assert payload["deleted_conversations"] == 1
    assert payload["deleted_messages"] == 2

    with container.database.session_scope() as session:
        conv_repo = SqlAlchemyBotConversationRepository(session)
        msg_repo = SqlAlchemyBotMessageRepository(session)
        assert conv_repo.list_all(tenant_id=tenant) == []
        assert msg_repo.list_all(tenant_id=tenant) == []


def test_governance_endpoints_missing_tenant_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera ``X-Tenant-Id`` el endpoint rechaza con 403 (aislamiento RLS)."""
    response = client.get(
        "/api/v1/bot/quota/usage",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )

    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "tenant.resolve"
