"""Puertos (ABC) de repositorios del dominio de operación del bot (Bloque B).

Inversión de dependencias (regla CLAUDE: DI): la capa HTTP depende de estas
interfaces, nunca de las implementaciones SQLAlchemy. Todo acceso queda SIEMPRE
acotado al ``tenant_id`` y respeta el soft-delete (tupla sync) excepto donde el
dominio lo exige (config de mantenimiento: upsert por tenant).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from app.models.bot_operations import (
    BotCampaign,
    BotCampaignRecipient,
    BotCampaignRecipientFile,
    BotContact,
    BotIntervention,
    BotMaintenanceConfig,
    BotNavigationTree,
    BotTemplate,
)


class IContactRepository(ABC):
    """Directorios de contactos del tenant (B.6) — ``phone`` único por tenant."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        phone: str,
        name: str | None,
        email: str | None,
        tags: list[str],
        state: str,
        source: str,
        external_contact_id: str | None,
        last_contact_at: datetime | None,
    ) -> BotContact: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> BotContact | None: ...

    @abstractmethod
    def get_by_phone(self, *, tenant_id: uuid.UUID, phone: str) -> BotContact | None: ...

    @abstractmethod
    def get_by_email(self, *, tenant_id: uuid.UUID, email: str) -> BotContact | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotContact], int]: ...

    @abstractmethod
    def list_by_tags(
        self, *, tenant_id: uuid.UUID, tags: list[str], match: str
    ) -> list[BotContact]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        contact_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotContact | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> bool: ...


class ITemplateRepository(ABC):
    """Plantillas de mensajes del bot (B.5) — ``name`` único por tenant."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        body: str,
        template_type: str,
        variables: list[str],
    ) -> BotTemplate: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, template_id: uuid.UUID) -> BotTemplate | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotTemplate], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        template_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotTemplate | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, template_id: uuid.UUID) -> bool: ...


class INavigationTreeRepository(ABC):
    """Árboles de navegación del bot (B.3) — fuente de menús (LocalResponse)."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        num_options: int,
        options: list[dict[str, Any]],
    ) -> BotNavigationTree: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, tree_id: uuid.UUID
    ) -> BotNavigationTree | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotNavigationTree], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        tree_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotNavigationTree | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, tree_id: uuid.UUID) -> bool: ...


class ICampaignRepository(ABC):
    """Campañas de envío (B.4/C-2) — plantilla + estado + agenda + segmentación.

    Las consultas ``list_due_for_dispatch`` y ``list_by_trigger_event`` son de
    sistema (multi-tenant, sin scope de tenant): las usa el dispatcher global
    para procesar todas las campañas vencidas o disparadas por evento.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        template_id: uuid.UUID | None,
        state: str,
        schedule: datetime | None,
        segment_type: str | None,
        segment_config: dict[str, Any] | None,
        trigger_type: str | None,
        trigger_event: str | None,
        landing_id: uuid.UUID | None = None,
    ) -> BotCampaign: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> BotCampaign | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotCampaign], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotCampaign | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> bool: ...

    @abstractmethod
    def list_due_for_dispatch(
        self, *, now: datetime, batch_limit: int
    ) -> list[BotCampaign]: ...

    @abstractmethod
    def list_by_trigger_event(
        self, *, event_type: str, limit: int
    ) -> list[BotCampaign]: ...


class ICampaignRecipientRepository(ABC):
    """Estado por destinatario de campaña (B.4) — único por campaña+contacto."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        contact_id: uuid.UUID,
        state: str,
        result: str | None,
        attempts: int,
    ) -> BotCampaignRecipient: ...

    @abstractmethod
    def list_by_campaign(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotCampaignRecipient], int]: ...

    @abstractmethod
    def list_pending_by_campaign(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID
    ) -> list[BotCampaignRecipient]: ...

    @abstractmethod
    def get_by_campaign_and_contact(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID, contact_id: uuid.UUID
    ) -> BotCampaignRecipient | None: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        recipient_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotCampaignRecipient | None: ...


class IRecipientFileRepository(ABC):
    """Archivos de destinatarios reutilizables (GAP 2) — CSV crudo + vista previa."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        content_type: str,
        raw_csv: str,
        source_meta: dict[str, Any],
    ) -> BotCampaignRecipientFile: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, file_id: uuid.UUID) -> BotCampaignRecipientFile | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotCampaignRecipientFile], int]: ...


class IInterventionRepository(ABC):
    """Intervención humana (B.7) — cola pendiente y resolución por operador."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
        state: str,
        operator: str | None,
        notes: str | None,
        assigned_at: datetime | None,
        resolved_at: datetime | None,
    ) -> BotIntervention: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, intervention_id: uuid.UUID) -> BotIntervention | None: ...

    @abstractmethod
    def list_by_state(
        self, *, tenant_id: uuid.UUID, state: str, page: int, page_size: int
    ) -> tuple[list[BotIntervention], int]: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotIntervention], int]: ...

    @abstractmethod
    def count_by_state(self, *, tenant_id: uuid.UUID, state: str) -> int: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        intervention_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotIntervention | None: ...


class IMaintenanceConfigRepository(ABC):
    """Configuración de mantenimiento del tenant (B.9) — una por tenant."""

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID) -> BotMaintenanceConfig | None: ...

    @abstractmethod
    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        retention_rules: dict[str, Any],
        maintenance_schedule: str | None,
    ) -> BotMaintenanceConfig: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID) -> bool:
        """Soft-delete de la configuración de mantenimiento del tenant."""
        ...


@dataclass(frozen=True)
class ChannelStatsAggregate:
    """Agregado de mensajes y conversaciones por canal (B.1/B.2)."""

    channel_id: uuid.UUID
    conversation_count: int
    message_count: int


@dataclass(frozen=True)
class DailyStatsAggregate:
    """Mensajes entrantes/salientes por día (B.2 estadísticas por periodo)."""

    date: date
    inbound: int
    outbound: int
    total: int


@dataclass(frozen=True)
class OperationsStatsAggregate:
    """KPIs del dashboard operativo y estadísticas del bot (B.1 + B.2)."""

    tenant_id: uuid.UUID
    active_conversations: int
    inbound_messages: int
    outbound_messages: int
    total_messages: int
    escalated: int
    resolved: int
    resolved_ratio: float
    unique_contacts: int
    daily: tuple[DailyStatsAggregate, ...]
    by_channel: tuple[ChannelStatsAggregate, ...]


@dataclass(frozen=True)
class TableStatsAggregate:
    """Métricas de una tabla de operación del tenant (B.9 — Estado).

    ``total`` incluye las filas soft-deleted; ``active`` son las filas con
    ``deleted = false`` y ``inactive`` las soft-deleted (total - active).
    """

    table_name: str
    total: int
    active: int
    inactive: int


class IOperationsStatsRepository(ABC):
    """Estadísticas agregadas del bot por tenant (B.1 + B.2).

    Todo agregado queda acotado por ``tenant_id`` y soft-delete (defensa en
    profundidad junto con RLS); no expone filas, solo KPIs y series.
    """

    @abstractmethod
    def overview(self, *, tenant_id: uuid.UUID) -> OperationsStatsAggregate: ...

    @abstractmethod
    def table_stats(self, *, tenant_id: uuid.UUID) -> tuple[TableStatsAggregate, ...]: ...
