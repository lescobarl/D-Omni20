"""Puertos (ABC) de repositorios del subsistema CRM (pipeline, tareas, SLA).

Regla CLAUDE: la capa de negocio depende de interfaces, no de implementaciones
(inversión de dependencias). Toda operación está SIEMPRE acotada al
``tenant_id`` activo (defensa en profundidad sobre RLS de PostgreSQL).

Contrato de dominio (PLAN_CRM_E2E_Y_UX §2):
- Mover un deal a una etapa terminal cierra el deal; todo movimiento escribe
  un ``CrmDealStageChange`` (append-only).
- ``outcome`` (won/lost) es el resultado estructural de una etapa terminal.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.models.crm import (
    CrmDeal,
    CrmDealStage,
    CrmDealStageChange,
    CrmSlaPolicy,
    CrmTask,
)


class IStageRepository(ABC):
    """Acceso a ``crm_deal_stages`` SIEMPRE acotado al tenant."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        order: int,
        default_probability: int,
        is_terminal: bool,
        outcome: str | None,
    ) -> CrmDealStage: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> CrmDealStage | None: ...

    @abstractmethod
    def get_by_name(self, *, tenant_id: uuid.UUID, name: str) -> CrmDealStage | None: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID) -> list[CrmDealStage]: ...

    @abstractmethod
    def update(
        self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID, fields: dict[str, Any]
    ) -> CrmDealStage | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> bool: ...


class IDealRepository(ABC):
    """Acceso a ``crm_deals`` + historial de movimientos, acotado al tenant."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        title: str,
        stage_id: uuid.UUID,
        amount_minor: int,
        currency: str,
        probability: int,
        owner_id: uuid.UUID | None,
        contact_id: uuid.UUID | None,
        lead_id: uuid.UUID | None,
        quote_id: uuid.UUID | None,
        payment_id: uuid.UUID | None,
        expected_close_at: date | None,
        metadata_json: dict[str, Any] | None,
    ) -> CrmDeal: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> CrmDeal | None: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        stage_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
        status: str | None = None,
    ) -> tuple[list[CrmDeal], int]: ...

    @abstractmethod
    def list_by_contact(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> list[CrmDeal]: ...

    @abstractmethod
    def update(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID, fields: dict[str, Any]
    ) -> CrmDeal | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> bool: ...

    @abstractmethod
    def append_stage_change(
        self,
        *,
        tenant_id: uuid.UUID,
        deal_id: uuid.UUID,
        from_stage_id: uuid.UUID | None,
        to_stage_id: uuid.UUID | None,
        changed_by: str,
        note: str | None,
    ) -> CrmDealStageChange: ...

    @abstractmethod
    def list_stage_changes(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID
    ) -> list[CrmDealStageChange]: ...


class ITaskRepository(ABC):
    """Acceso a ``crm_tasks`` SIEMPRE acotado al tenant."""

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        deal_id: uuid.UUID | None,
        contact_id: uuid.UUID | None,
        title: str,
        due_at: datetime | None,
        status: str,
        priority: str,
        assignee_id: uuid.UUID | None,
    ) -> CrmTask: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> CrmTask | None: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        deal_id: uuid.UUID | None = None,
    ) -> tuple[list[CrmTask], int]: ...

    @abstractmethod
    def list_by_deal(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> list[CrmTask]: ...

    @abstractmethod
    def list_by_contact(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> list[CrmTask]: ...

    @abstractmethod
    def update(
        self, *, tenant_id: uuid.UUID, task_id: uuid.UUID, fields: dict[str, Any]
    ) -> CrmTask | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> bool: ...


class ISlaRepository(ABC):
    """Acceso a ``crm_sla_policies`` SIEMPRE acotado al tenant (una por etapa)."""

    @abstractmethod
    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        stage_id: uuid.UUID,
        max_response_hours: int,
        max_stay_days: int,
    ) -> CrmSlaPolicy: ...

    @abstractmethod
    def get_by_stage(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> CrmSlaPolicy | None: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID) -> list[CrmSlaPolicy]: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, sla_id: uuid.UUID) -> bool: ...


@dataclass(frozen=True)
class FunnelStageAggregate:
    """Conteo y montos agregados por etapa del embudo (M4)."""

    stage_id: uuid.UUID
    stage_name: str
    order: int
    count: int
    total_amount_minor: int
    weighted_value_minor: int


@dataclass(frozen=True)
class FunnelAggregate:
    """Reporte del embudo comercial agregado por tenant (M4)."""

    stages: list[FunnelStageAggregate] = field(default_factory=list)
    total_deals: int = 0
    open_count: int = 0
    won_count: int = 0
    lost_count: int = 0
    won_amount_minor: int = 0
    avg_cycle_days: float | None = None


class IFunnelRepository(ABC):
    """Agregaciones del embudo comercial (M4) acotadas al tenant."""

    @abstractmethod
    def funnel(self, *, tenant_id: uuid.UUID) -> FunnelAggregate: ...
