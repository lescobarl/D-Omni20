"""Modelos del subsistema de workflows (reglas CLAUDE: UUIDv4, tupla sync, RLS).

Contrato:
- Cuatro entidades de conversión, todas multi-tenant y con soft-delete:
  ``PaymentTransaction`` (pagos), ``Lead`` (prospectos), ``Quote`` (cotizaciones)
  y ``Appointment`` (citas).
- Cada entidad declara una *state machine* explícita mediante constantes de
  estado (strings) que el servicio de dominio valida — nunca valores libres.
- ``provider`` en pagos registra el proveedor real que procesó la transacción
  (``stripe`` o ``sandbox``); nunca es un campo decorativo.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class PaymentStatus:
    """Estados de una transacción de pago (state machine del dominio)."""

    PENDING = "pending"
    REQUIRES_CONFIRMATION = "requires_confirmation"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"


class LeadStatus:
    """Estados del ciclo de vida de un lead."""

    NEW = "new"
    CONTACTED = "contacted"
    CONVERTED = "converted"
    LOST = "lost"


class QuoteStatus:
    """Estados del ciclo de vida de una cotización."""

    DRAFT = "draft"
    SENT = "sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class AppointmentStatus:
    """Estados del ciclo de vida de una cita."""

    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELED = "canceled"


class ReminderStatus:
    """Estados del ciclo de vida de un recordatorio de cita."""

    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class ReminderChannel:
    """Canales de notificación para recordatorios de citas."""

    EMAIL = "email"
    SMS = "sms"


class PaymentTransaction(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Transacción de pago de un checkout directo (minor units).

    ``amount_minor`` se almacena en unidades menores (centavos) para evitar
    errores de coma flotante; ``currency`` es el código ISO 4217 en minúsculas.
    """

    __tablename__ = "workflow_payments"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount_minor: Mapped[int] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="usd")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=PaymentStatus.REQUIRES_CONFIRMATION, index=True
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="sandbox")
    provider_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONType, nullable=False, default=dict)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class Lead(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Prospecto capturado por un formulario (lead_capture)."""

    __tablename__ = "workflow_leads"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="landing")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=LeadStatus.NEW, index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONType, nullable=False, default=dict)
    ad_campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ad_campaigns.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )


class Quote(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Cotización generada a partir de servicios seleccionados (quote_generator).

    ``services`` es una lista de objetos ``{name, description?, quantity, unit_price_minor}``.
    ``pdf_path`` apunta al artefacto PDF generado (ruta relativa a ``workflow_artifacts_dir``).
    """

    __tablename__ = "workflow_quotes"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="usd")
    services: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, nullable=False, default=list)
    subtotal_minor: Mapped[int] = mapped_column(nullable=False, default=0)
    tax_minor: Mapped[int] = mapped_column(nullable=False, default=0)
    total_minor: Mapped[int] = mapped_column(nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=QuoteStatus.DRAFT, index=True)
    pdf_path: Mapped[str | None] = mapped_column(String(512), nullable=True)


class Appointment(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Cita agendada con calendario integrado (appointment_scheduler).

    ``starts_at`` / ``ends_at`` se almacenan en UTC (timezone-aware); la zona
    local del cliente se conserva en ``timezone`` (IANA, p. ej. ``America/Mexico_City``).
    ``ics_path`` apunta al artefacto de invitación iCalendar generado.
    """

    __tablename__ = "workflow_appointments"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service: Mapped[str] = mapped_column(String(255), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=AppointmentStatus.SCHEDULED, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ics_path: Mapped[str | None] = mapped_column(String(512), nullable=True)


class AppointmentReminder(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Recordatorio programado de una cita (un registro por canal).

    Se materializa de forma idempotente por el scheduler cuando la cita entra
    en la ventana ``starts_at - appointment_reminder_hours``; ``channel`` es
    ``email`` o ``sms``. ``scheduled_at`` indica cuándo debe enviarse el
    recordatorio; ``sent_at`` queda nulo hasta que se despacha. ``details``
    guarda metadatos de envío (destinatario, motivo de fallo, etc.).
    """

    __tablename__ = "workflow_appointment_reminders"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("workflow_appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ReminderStatus.PENDING, index=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
