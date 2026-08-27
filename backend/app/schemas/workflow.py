"""Esquemas del subsistema de workflows (checkout, leads, cotizaciones, citas).

Contrato:
- Los montos viajan en unidades mayores (``Decimal``) y se convierten a minor
  units dentro del servicio de dominio (nunca en el esquema).
- ``extra="forbid"`` en toda petición (fail-fast ante payloads desconocidos).
- Los read models exponen la tupla sync (``revision``/``updated_at``) para que
  el cliente pueda sincronizar (regla CLAUDE).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel

_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_CURRENCY_PATTERN = r"^[a-z]{3}$"

Currency = Literal["usd", "mxn", "eur"]


# ────────────────────────────────────────────────────────────────────────────
# CHECKOUT (pasarela de pago)
# ────────────────────────────────────────────────────────────────────────────
class CheckoutRequest(BaseModel):
    """Solicitud de checkout directo (monto en unidades mayores)."""

    model_config = ConfigDict(extra="forbid")

    amount: Decimal = Field(gt=0, description="Monto en unidades mayores (p. ej. 99.50 USD)")
    currency: str = Field(default="usd", pattern=_CURRENCY_PATTERN)
    customer_email: str | None = Field(default=None, pattern=_EMAIL_PATTERN, max_length=255)
    customer_name: str | None = Field(default=None, max_length=255)
    success_url: str | None = Field(default=None, max_length=2048)
    cancel_url: str | None = Field(default=None, max_length=2048)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CheckoutResponse(BaseModel):
    """Respuesta del checkout: URL de la pasarela + estado inicial."""

    payment_id: uuid.UUID
    status: str
    checkout_url: str
    provider: str


class PaymentRead(ORMModel):
    """Transacción de pago tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    amount_minor: int
    currency: str
    status: str
    provider: str
    provider_session_id: str | None
    customer_email: str | None
    customer_name: str | None
    metadata: dict[str, Any] = Field(
        validation_alias="metadata_json",
        serialization_alias="metadata",
        description="Metadatos de la transacción (columna ORM ``metadata_json``).",
    )
    failure_reason: str | None
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# LEAD (captura de prospectos)
# ────────────────────────────────────────────────────────────────────────────
class LeadRequest(BaseModel):
    """Solicitud de captura de un lead."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=1, max_length=255, pattern=_EMAIL_PATTERN)
    phone: str | None = Field(default=None, max_length=32)
    source: str = Field(default="landing", min_length=1, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class LeadRead(ORMModel):
    """Lead capturado tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    email: str
    phone: str | None
    source: str
    status: str
    metadata: dict[str, Any] = Field(
        validation_alias="metadata_json",
        serialization_alias="metadata",
        description="Metadatos del lead (columna ORM ``metadata_json``).",
    )
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# QUOTE (generador de cotizaciones)
# ────────────────────────────────────────────────────────────────────────────
class QuoteLineItem(BaseModel):
    """Línea de servicio/producto de una cotización."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    quantity: int = Field(default=1, ge=1)
    unit_price: Decimal = Field(gt=0, description="Precio unitario en unidades mayores")


class QuoteRequest(BaseModel):
    """Solicitud de generación de cotización."""

    model_config = ConfigDict(extra="forbid")

    customer_name: str = Field(min_length=1, max_length=255)
    customer_email: str | None = Field(default=None, pattern=_EMAIL_PATTERN, max_length=255)
    currency: str = Field(default="usd", pattern=_CURRENCY_PATTERN)
    services: list[QuoteLineItem] = Field(min_length=1, description="Al menos un servicio")
    tax_rate_bps: int = Field(default=0, ge=0, le=10_000, description="Tasa de impuesto en puntos base (0-10000 = 0-100%)")


class QuoteResponse(BaseModel):
    """Respuesta de generación de cotización: línea + URL del PDF."""

    quote_id: uuid.UUID
    status: str
    subtotal: Decimal
    tax: Decimal
    total: Decimal
    currency: str
    pdf_url: str | None = None


class QuoteRead(ORMModel):
    """Cotización tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    customer_name: str
    customer_email: str | None
    currency: str
    services: list[dict[str, Any]]
    subtotal_minor: int
    tax_minor: int
    total_minor: int
    status: str
    pdf_path: str | None
    created_at: datetime
    revision: int
    updated_at: datetime


# ────────────────────────────────────────────────────────────────────────────
# APPOINTMENT (agendador de citas)
# ────────────────────────────────────────────────────────────────────────────
class AppointmentRequest(BaseModel):
    """Solicitud de agendamiento de cita."""

    model_config = ConfigDict(extra="forbid")

    service: str = Field(min_length=1, max_length=255)
    starts_at: datetime
    duration_minutes: int = Field(default=30, ge=5, le=480)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    customer_name: str = Field(min_length=1, max_length=255)
    customer_email: str | None = Field(default=None, pattern=_EMAIL_PATTERN, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class AppointmentResponse(BaseModel):
    """Respuesta de agendamiento: cita + URL del calendario (ICS)."""

    appointment_id: uuid.UUID
    status: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    ics_url: str | None = None


class AppointmentRead(ORMModel):
    """Cita tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    service: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    customer_name: str
    customer_email: str | None
    customer_phone: str | None
    status: str
    notes: str | None
    ics_path: str | None
    created_at: datetime
    revision: int
    updated_at: datetime


class ReminderProcessingResponse(BaseModel):
    """Resultado de una pasada de procesamiento de recordatorios de citas."""

    reminders_materialized: int = 0
    reminders_sent: int = 0
    reminders_failed: int = 0
    reminders_skipped: int = 0
