"""Modelos del subsistema CRM (reglas CLAUDE: UUIDv4, tupla sync, RLS).

Pipeline comercial (M1), tareas (M2) y políticas de SLA (M5). El módulo
agrega el embudo Deals ↔ Leads ↔ Pagos ↔ Cotizaciones (M3) mediante FKs
opcionales hacia los subsistemas de workflows y operaciones del bot.

Regla de dominio: mover un deal a una etapa terminal (``is_terminal``)
cierra el deal (``won``/``lost``); todo movimiento escribe un
``DealStageChange`` (append-only).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class DealStatus:
    """Estados del ciclo de vida de un deal (etapa terminal cierra el deal)."""

    OPEN = "open"
    WON = "won"
    LOST = "lost"


class TaskStatus:
    """Estados de una tarea del pipeline (M2)."""

    PENDING = "pending"
    DONE = "done"
    CANCELLED = "cancelled"


class TaskPriority:
    """Prioridad de una tarea del pipeline (M2)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class StageOutcome:
    """Resultado de una etapa terminal (``None`` si la etapa no es terminal).

    Distingue estructuralmente Ganado/Perdido sin depender del nombre de la
    etapa (los tenants pueden renombrar sus etapas); se fija sólo cuando
    ``is_terminal`` es verdadero.
    """

    WON = "won"
    LOST = "lost"


class CrmDeal(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Oportunidad comercial del pipeline (M1).

    Agrega opcionalmente la cadena Lead → Pago → Cotización (M3) mediante
    FKs opcionales; ``owner_id``/``assignee_id`` son UUIDs libres (el agente
    real se difiere a v2 según el diseño PLAN_CRM_E2E_Y_UX §2.4).
    """

    __tablename__ = "crm_deals"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("crm_deal_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    probability: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=DealStatus.OPEN, index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("bot_contacts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("workflow_leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    quote_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("workflow_quotes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("workflow_payments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    expected_close_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONType, nullable=False, default=dict)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    won_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lost_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lost_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class CrmDealStage(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Etapa configurable del pipeline (M1).

    ``is_terminal`` marca Ganado/Perdido: mover un deal a una etapa terminal
    cierra el deal. ``outcome`` (``won``/``lost``) distingue estructuralmente
    el cierre sin depender del nombre de la etapa (renombrable por tenant);
    es no-nulo si y sólo si ``is_terminal`` es verdadero. Seed por defecto:
    Nuevo → Calificado → Cotización → Negociación + terminales Ganado/Perdido.
    """

    __tablename__ = "crm_deal_stages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_crm_deal_stages_tenant_name"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_probability: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_terminal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Resultado estructural del cierre: "won"/"lost" — no-nulo si y sólo si is_terminal.
    outcome: Mapped[str | None] = mapped_column(String(8), nullable=True)


class CrmDealStageChange(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Historial de movimientos del deal (append-only, inmutable).

    Cada cambio de etapa o cierre escribe un registro; el histórico se
    reconstruye desde aquí (``/crm/deals/{id}/history``).
    """

    __tablename__ = "crm_deal_stage_changes"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    deal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("crm_deals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("crm_deal_stages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    to_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("crm_deal_stages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    changed_by: Mapped[str] = mapped_column(String(32), nullable=False, default="sistema")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class CrmTask(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Tarea de seguimiento del pipeline (M2).

    ``assignee_id`` es un UUID libre (el agente real se difiere a v2);
    ``deal_id``/``contact_id`` son opcionales para tareas sueltas.
    """

    __tablename__ = "crm_tasks"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    deal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("crm_deals.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("bot_contacts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=TaskStatus.PENDING, index=True)
    priority: Mapped[str] = mapped_column(String(8), nullable=False, default=TaskPriority.MEDIUM)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CrmSlaPolicy(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Política de SLA por etapa (M5).

    Define el tiempo máximo de respuesta (horas) y de permanencia (días) en
    una etapa; una por etapa por tenant.
    """

    __tablename__ = "crm_sla_policies"
    __table_args__ = (
        UniqueConstraint("tenant_id", "stage_id", name="uq_crm_sla_policies_tenant_stage"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("crm_deal_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    max_response_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_stay_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
