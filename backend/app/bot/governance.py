"""Gobernanza del bot (Fase 9): cuota de tokens (9b/L1) y privacidad (9a/M4).

Fase 9 del plan §15.3:
- **9a (M4, LFPDPPP)** — privacidad por tenant: exportación (portabilidad,
  art. 15), borrado físico (cancelación, art. 16) y retención de datos
  (``bot_data_retention_days``; ``0`` = sin purgado automático).
- **9b (L1)** — cuota de tokens por tenant sobre los mensajes persistidos
  (``bot_quota_daily_tokens``; ``0`` = sin límite, solo reporte) con alertas
  estructuradas ``bot.quota.warning`` / ``bot.quota.exceeded``.

Reglas de alcance (aislamiento multi-tenant):
- El reporte y el export se acotan al ``tenant_id`` del request (RLS).
- El borrado físico (``delete_all``) y el purgado por retención
  (``delete_older_than``) se acotan SOLO por ``tenant_id`` (ignoran la bandera
  ``deleted``: es una cancelación física, no lógica).
- El export (``list_all``) usa el alcance activo: NO incluye datos borrados
  lógicamente (el ``deleted`` sigue siendo la fuente de verdad del soft-delete).

Regla CLAUDE: este módulo no instancia dependencias (``new``): recibe los
puertos y fábricas por DI (inversión de dependencias) y abre sus propias
sesiones vía ``Database.session_scope`` con ``set_app_current_tenant`` (el GUC
``app.current_tenant_id`` aplica RLS como defensa en profundidad).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy.orm import Session

from app.bot.repository_interfaces import (
    IBotConversationRepository,
    IBotMessageRepository,
)
from app.config.settings import Settings
from app.core.database import Database
from app.core.logging import ILogger
from app.core.tenancy import set_app_current_tenant
from app.models.base import utcnow
from app.schemas.bot import (
    BotDataExportRead,
    ConversationRead,
    MessageRead,
    PrivacyDeletionResult,
    QuotaUsageRead,
    QuotaUsageResponse,
)

# Umbral de advertencia: se emite ``bot.quota.warning`` al superar este %.
_WARNING_PERCENT = 80.0


def _quota_status(percent: float) -> Literal["ok", "warning", "exceeded"]:
    """Clasifica el consumo frente a la cuota (0 % ≤ 100 %)."""
    if percent >= 100.0:
        return "exceeded"
    if percent >= _WARNING_PERCENT:
        return "warning"
    return "ok"


class IQuotaService(ABC):
    """Puerto del reporte de consumo/cuota de tokens del bot (Fase 9b, L1)."""

    @abstractmethod
    def report(self, *, tenant_id: uuid.UUID) -> QuotaUsageResponse:
        """Reporte agregado de consumo de tokens del tenant en la ventana."""


class IPrivacyService(ABC):
    """Puerto de privacidad del bot (Fase 9a, M4 — LFPDPPP)."""

    @abstractmethod
    def export(self, *, tenant_id: uuid.UUID) -> BotDataExportRead:
        """Exporta (portabilidad) las conversaciones y mensajes del tenant."""

    @abstractmethod
    def erase(self, *, tenant_id: uuid.UUID) -> PrivacyDeletionResult:
        """Borra físicamente (cancelación) los datos del bot del tenant."""

    @abstractmethod
    def purge_expired(self, *, tenant_id: uuid.UUID) -> PrivacyDeletionResult:
        """Purgado por retención: borra datos anteriores al período configurado."""


class TokenQuotaService(IQuotaService):
    """Cuota de tokens por tenant sobre los mensajes persistidos (Fase 9b, L1).

    Agrega ``SUM(tokens_used)``/``COUNT()`` de ``BotMessage`` agrupado por
    ``provider_used`` (nombre visible del proveedor, p. ej. ``deepseek-chat``) en
    la ventana ``bot_quota_window_hours`` (por defecto 24 h) y compara cada
    agregado contra ``bot_quota_daily_tokens`` (0 = sin límite).
    """

    def __init__(
        self,
        *,
        database: Database,
        settings: Settings,
        logger: ILogger,
        message_repository_factory: Callable[[Session], IBotMessageRepository],
    ) -> None:
        self._database = database
        self._settings = settings
        self._logger = logger
        self._message_repository_factory = message_repository_factory

    def report(self, *, tenant_id: uuid.UUID) -> QuotaUsageResponse:
        now = datetime.now(UTC)
        window_hours = max(float(self._settings.bot_quota_window_hours), 1.0)
        period_start = now - timedelta(hours=window_hours)
        quota_limit = max(int(self._settings.bot_quota_daily_tokens), 0)

        with self._database.session_scope() as session:
            set_app_current_tenant(session.connection(), str(tenant_id))
            aggregates = self._message_repository_factory(session).aggregate_usage(
                tenant_id=tenant_id,
                since=period_start,
            )

        items: list[QuotaUsageRead] = []
        total_used = 0
        for aggregate in aggregates:
            tokens = int(aggregate.tokens_used or 0)
            total_used += tokens
            percent = (tokens / quota_limit * 100.0) if quota_limit > 0 else 0.0
            status = _quota_status(percent)
            items.append(
                QuotaUsageRead(
                    provider_used=aggregate.provider_used,
                    tokens_used=tokens,
                    message_count=int(aggregate.message_count),
                    quota_limit=quota_limit,
                    percent=round(percent, 2),
                    status=status,
                    period_start=period_start,
                    period_end=now,
                )
            )
            if status == "exceeded":
                self._logger.warning(
                    "bot.quota.exceeded",
                    "Cuota de tokens superada por el tenant",
                    tenant_id=str(tenant_id),
                    provider_used=aggregate.provider_used,
                    tokens_used=tokens,
                    quota_limit=quota_limit,
                    percent=round(percent, 2),
                )
            elif status == "warning":
                self._logger.warning(
                    "bot.quota.warning",
                    "Cuota de tokens próxima a superarse",
                    tenant_id=str(tenant_id),
                    provider_used=aggregate.provider_used,
                    tokens_used=tokens,
                    quota_limit=quota_limit,
                    percent=round(percent, 2),
                )

        total_percent = (total_used / quota_limit * 100.0) if quota_limit > 0 else 0.0
        return QuotaUsageResponse(
            tenant_id=tenant_id,
            period_start=period_start,
            period_end=now,
            quota_limit=quota_limit,
            total_tokens_used=total_used,
            total_percent=round(total_percent, 2),
            status=_quota_status(total_percent),
            items=items,
        )


class BotPrivacyService(IPrivacyService):
    """Privacidad del bot (Fase 9a, M4 — LFPDPPP): portabilidad, cancelación y retención.

    Operaciones por tenant (``X-Tenant-Id`` + RLS) con registro de auditoría
    estructurado (``bot.privacy.exported`` / ``bot.privacy.erased`` /
    ``bot.privacy.retention_purged``).
    """

    def __init__(
        self,
        *,
        database: Database,
        settings: Settings,
        logger: ILogger,
        conversation_repository_factory: Callable[[Session], IBotConversationRepository],
        message_repository_factory: Callable[[Session], IBotMessageRepository],
    ) -> None:
        self._database = database
        self._settings = settings
        self._logger = logger
        self._conversation_repository_factory = conversation_repository_factory
        self._message_repository_factory = message_repository_factory

    def export(self, *, tenant_id: uuid.UUID) -> BotDataExportRead:
        with self._database.session_scope() as session:
            set_app_current_tenant(session.connection(), str(tenant_id))
            conversations = self._conversation_repository_factory(session).list_all(
                tenant_id=tenant_id
            )
            messages = self._message_repository_factory(session).list_all(
                tenant_id=tenant_id
            )

        self._logger.info(
            "bot.privacy.exported",
            "Exportación de datos del bot solicitada",
            tenant_id=str(tenant_id),
            conversations=len(conversations),
            messages=len(messages),
        )
        return BotDataExportRead(
            tenant_id=tenant_id,
            exported_at=utcnow(),
            conversations=[ConversationRead.model_validate(row) for row in conversations],
            messages=[MessageRead.model_validate(row) for row in messages],
        )

    def erase(self, *, tenant_id: uuid.UUID) -> PrivacyDeletionResult:
        with self._database.session_scope() as session:
            set_app_current_tenant(session.connection(), str(tenant_id))
            message_repo = self._message_repository_factory(session)
            conversation_repo = self._conversation_repository_factory(session)
            # Primero mensajes (FK) y luego conversaciones, ambos con DELETE físico.
            deleted_messages = message_repo.delete_all(tenant_id=tenant_id)
            deleted_conversations = conversation_repo.delete_all(tenant_id=tenant_id)

        self._logger.info(
            "bot.privacy.erased",
            "Borrado físico de datos del bot completado (cancelación)",
            tenant_id=str(tenant_id),
            deleted_conversations=deleted_conversations,
            deleted_messages=deleted_messages,
        )
        return PrivacyDeletionResult(
            tenant_id=tenant_id,
            deleted_conversations=deleted_conversations,
            deleted_messages=deleted_messages,
        )

    def purge_expired(self, *, tenant_id: uuid.UUID) -> PrivacyDeletionResult:
        retention_days = int(self._settings.bot_data_retention_days)
        if retention_days <= 0:
            # Retención deshabilitada: nada que purgar (no emite log de borrado).
            return PrivacyDeletionResult(
                tenant_id=tenant_id,
                deleted_conversations=0,
                deleted_messages=0,
            )
        cutoff = utcnow() - timedelta(days=retention_days)
        with self._database.session_scope() as session:
            set_app_current_tenant(session.connection(), str(tenant_id))
            message_repo = self._message_repository_factory(session)
            conversation_repo = self._conversation_repository_factory(session)
            deleted_messages = message_repo.delete_older_than(
                tenant_id=tenant_id, before=cutoff
            )
            deleted_conversations = conversation_repo.delete_older_than(
                tenant_id=tenant_id, before=cutoff
            )

        self._logger.info(
            "bot.privacy.retention_purged",
            "Purgado por retención de datos del bot",
            tenant_id=str(tenant_id),
            retention_days=retention_days,
            deleted_conversations=deleted_conversations,
            deleted_messages=deleted_messages,
        )
        return PrivacyDeletionResult(
            tenant_id=tenant_id,
            deleted_conversations=deleted_conversations,
            deleted_messages=deleted_messages,
        )
