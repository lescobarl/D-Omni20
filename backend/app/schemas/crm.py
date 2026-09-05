"""Esquemas del subsistema CRM (pipeline, tareas, SLA y embudo).

Contrato (reglas CLAUDE):
- ``extra="forbid"`` en toda petición (fail-fast ante payloads desconocidos).
- Los read models exponen la tupla sync (``revision``/``updated_at``) para que
  el cliente pueda sincronizar.
- ``metadata`` viaja como ``metadata_json`` en el ORM y se expone como
  ``metadata`` (patrón de ``schemas/workflow.py``).
- El resultado de una etapa terminal es estructural: ``outcome`` (``won``/
  ``lost``) en lugar de depender del nombre de la etapa (renombrable por
  tenant) — ver ``models/crm.py::StageOutcome``.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel

DealStatus = Literal["open", "won", "lost"]
TaskStatus = Literal["pending", "done", "cancelled"]
TaskPriority = Literal["low", "medium", "high"]
StageOutcome = Literal["won", "lost"]
ChangedBy = Literal["bot", "vendedor", "sistema"]
Currency = Literal["USD", "MXN"]

_CURRENCY_PATTERN = r"^[A-Z]{3}$"


# ────────────────────────────────────────────────────────────────────────────
# DEAL (oportunidad comercial)
# ────────────────────────────────────────────────────────────────────────────
class DealCreate(BaseModel):
    """Payload para crear una oportunidad en el pipeline del tenant activo."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    stage_id: uuid.UUID
    amount_minor: int = Field(default=0, ge=0)
    currency: Currency = Field(default="USD", pattern=_CURRENCY_PATTERN)
    probability: int = Field(default=0, ge=0, le=100)
    owner_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None
    quote_id: uuid.UUID | None = None
    payment_id: uuid.UUID | None = None
    expected_close_at: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DealUpdate(BaseModel):
    """Payload parcial para actualizar un deal (PATCH semantics).

    ``stage_id`` + ``note`` permiten mover de etapa en la misma operación;
    al mover a una etapa terminal, ``lost_reason`` es obligatorio si el cierre
    es ``lost``.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    stage_id: uuid.UUID | None = None
    amount_minor: int | None = Field(default=None, ge=0)
    currency: Currency | None = Field(default=None, pattern=_CURRENCY_PATTERN)
    probability: int | None = Field(default=None, ge=0, le=100)
    owner_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None
    quote_id: uuid.UUID | None = None
    payment_id: uuid.UUID | None = None
    expected_close_at: date | None = None
    metadata: dict[str, Any] | None = None
    note: str | None = Field(default=None, max_length=4000)
    lost_reason: str | None = Field(default=None, max_length=4000)


class DealRead(ORMModel):
    """Oportunidad comercial tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    stage_id: uuid.UUID
    amount_minor: int
    currency: str
    probability: int
    status: str
    owner_id: uuid.UUID | None
    contact_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    quote_id: uuid.UUID | None
    payment_id: uuid.UUID | None
    expected_close_at: date | None
    metadata: dict[str, Any] = Field(
        validation_alias="metadata_json",
        serialization_alias="metadata",
        description="Metadatos del deal (columna ORM ``metadata_json``).",
    )
    closed_at: datetime | None
    won_at: datetime | None
    lost_at: datetime | None
    lost_reason: str | None
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# DEAL STAGE (etapa del pipeline)
# ────────────────────────────────────────────────────────────────────────────
class StageCreate(BaseModel):
    """Payload para crear una etapa del pipeline del tenant activo."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    order: int = Field(default=0, ge=0)
    default_probability: int = Field(default=0, ge=0, le=100)
    is_terminal: bool = False
    # Resultado estructural del cierre; se exige cuando is_terminal=True.
    outcome: StageOutcome | None = None


class StageUpdate(BaseModel):
    """Payload parcial para actualizar una etapa (PATCH semantics)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)
    order: int | None = Field(default=None, ge=0)
    default_probability: int | None = Field(default=None, ge=0, le=100)
    is_terminal: bool | None = None
    outcome: StageOutcome | None = None


class StageRead(ORMModel):
    """Etapa del pipeline tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    order: int
    default_probability: int
    is_terminal: bool
    outcome: str | None
    created_at: datetime
    revision: int
    updated_at: datetime


class StageChangeRead(ORMModel):
    """Registro inmutable de un movimiento de etapa (append-only)."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    deal_id: uuid.UUID
    from_stage_id: uuid.UUID | None
    to_stage_id: uuid.UUID | None
    changed_by: str
    note: str | None
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# TASK (seguimiento del pipeline)
# ────────────────────────────────────────────────────────────────────────────
class TaskCreate(BaseModel):
    """Payload para crear una tarea de seguimiento del tenant activo."""

    model_config = ConfigDict(extra="forbid")

    deal_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=255)
    due_at: datetime | None = None
    status: TaskStatus = "pending"
    priority: TaskPriority = "medium"
    assignee_id: uuid.UUID | None = None


class TaskUpdate(BaseModel):
    """Payload parcial para actualizar una tarea (PATCH semantics)."""

    model_config = ConfigDict(extra="forbid")

    deal_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    due_at: datetime | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    assignee_id: uuid.UUID | None = None


class TaskRead(ORMModel):
    """Tarea de seguimiento tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    deal_id: uuid.UUID | None
    contact_id: uuid.UUID | None
    title: str
    due_at: datetime | None
    status: str
    priority: str
    assignee_id: uuid.UUID | None
    completed_at: datetime | None
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# SLA (política por etapa)
# ────────────────────────────────────────────────────────────────────────────
class SlaUpsert(BaseModel):
    """Payload para crear o actualizar la política de SLA de una etapa."""

    model_config = ConfigDict(extra="forbid")

    stage_id: uuid.UUID
    max_response_hours: int = Field(default=0, ge=0)
    max_stay_days: int = Field(default=0, ge=0)


class SlaRead(ORMModel):
    """Política de SLA tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    stage_id: uuid.UUID
    max_response_hours: int
    max_stay_days: int
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# FUNNEL (reporte M4)
# ────────────────────────────────────────────────────────────────────────────
class FunnelStageRead(BaseModel):
    """Agregación por etapa del embudo comercial."""

    stage_id: uuid.UUID
    stage_name: str
    count: int
    total_amount_minor: int
    weighted_value_minor: int
    conversion_rate: float | None
    avg_cycle_days: float | None


class FunnelRead(BaseModel):
    """Reporte del embudo: conteo, montos, conversión y tasas de cierre."""

    stages: list[FunnelStageRead]
    total_deals: int
    won_count: int
    lost_count: int
    open_count: int
    won_amount_minor: int
    close_rate: float
    avg_cycle_days: float | None


# ────────────────────────────────────────────────────────────────────────────
# SUMMARY (portal del cliente — P4)
# ────────────────────────────────────────────────────────────────────────────
class CrmSummaryRead(BaseModel):
    """Resumen de oportunidades de un cliente (filtrado por email)."""

    deals: list[DealRead]
    tasks: list[TaskRead]
    total_deals: int
    open_deals: int
    won_deals: int
