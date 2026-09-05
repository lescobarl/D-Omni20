"""Implementación SQLAlchemy del repositorio de workflows (inyectada vía DI).

Reglas aplicadas:
- Toda query se acota por ``tenant_id`` y ``deleted=False`` (defensa en
  profundidad junto con RLS de PostgreSQL).
- Soft-delete nunca se usa explícitamente en workflows (los estados del dominio
  gobiernan el ciclo de vida), pero el scope activo sigue excluyendo borrados.
- Sin ``try/except`` vacío: los errores se propagan al servicio con contexto.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.workflow import (
    Appointment,
    AppointmentReminder,
    AppointmentStatus,
    Lead,
    LeadStatus,
    PaymentTransaction,
    Quote,
    ReminderStatus,
)
from app.repositories.workflow_interfaces import IWorkflowRepository, LeadAttributionItem


class SqlAlchemyWorkflowRepository(IWorkflowRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    # ── Helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _apply_fields(entity: Any, fields: dict[str, Any]) -> None:
        """Aplica solo los campos existentes en la entidad (fail-fast al resto)."""
        for key, value in fields.items():
            if not hasattr(entity, key):
                raise ValueError(f"Campo desconocido para la entidad: {key}")
            setattr(entity, key, value)

    # ── Pagos ────────────────────────────────────────────────────────────────
    def create_payment(
        self,
        *,
        tenant_id: uuid.UUID,
        amount_minor: int,
        currency: str,
        status: str,
        provider: str,
        provider_session_id: str | None = None,
        customer_email: str | None = None,
        customer_name: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> PaymentTransaction:
        payment = PaymentTransaction(
            tenant_id=tenant_id,
            amount_minor=amount_minor,
            currency=currency,
            status=status,
            provider=provider,
            provider_session_id=provider_session_id,
            customer_email=customer_email,
            customer_name=customer_name,
            metadata_json=dict(metadata or {}),
        )
        self._session.add(payment)
        self._session.flush()
        return payment

    def get_payment(self, *, tenant_id: uuid.UUID, payment_id: uuid.UUID) -> PaymentTransaction | None:
        statement = (
            select(PaymentTransaction)
            .where(
                PaymentTransaction.id == payment_id,
                PaymentTransaction.tenant_id == tenant_id,
                PaymentTransaction.deleted.is_(False),
            )
        )
        return self._session.scalars(statement).first()

    def get_payment_by_session(
        self, *, tenant_id: uuid.UUID, provider_session_id: str
    ) -> PaymentTransaction | None:
        statement = (
            select(PaymentTransaction)
            .where(
                PaymentTransaction.provider_session_id == provider_session_id,
                PaymentTransaction.tenant_id == tenant_id,
                PaymentTransaction.deleted.is_(False),
            )
        )
        return self._session.scalars(statement).first()

    def list_payments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[PaymentTransaction], int]:
        base = select(PaymentTransaction).where(
            PaymentTransaction.tenant_id == tenant_id, PaymentTransaction.deleted.is_(False)
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(PaymentTransaction.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def update_payment(
        self,
        *,
        tenant_id: uuid.UUID,
        payment_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> PaymentTransaction | None:
        payment = self.get_payment(tenant_id=tenant_id, payment_id=payment_id)
        if payment is None:
            return None
        self._apply_fields(payment, fields)
        self._session.flush()
        return payment

    # ── Leads ────────────────────────────────────────────────────────────────
    def create_lead(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        email: str,
        phone: str | None = None,
        source: str = "landing",
        metadata: dict[str, Any] | None = None,
    ) -> Lead:
        lead = Lead(
            tenant_id=tenant_id,
            name=name,
            email=email,
            phone=phone,
            source=source,
            metadata_json=dict(metadata or {}),
        )
        self._session.add(lead)
        self._session.flush()
        return lead

    def get_lead(self, *, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
        statement = (
            select(Lead)
            .where(
                Lead.id == lead_id,
                Lead.tenant_id == tenant_id,
                Lead.deleted.is_(False),
            )
        )
        return self._session.scalars(statement).first()

    def find_lead_by_phone(
        self, *, tenant_id: uuid.UUID, phone: str
    ) -> Lead | None:
        statement = (
            select(Lead)
            .where(
                Lead.tenant_id == tenant_id,
                Lead.phone == phone,
                Lead.deleted.is_(False),
            )
            .order_by(Lead.created_at.desc())
        )
        return self._session.scalars(statement).first()

    def list_leads(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Lead], int]:
        base = select(Lead).where(
            Lead.tenant_id == tenant_id, Lead.deleted.is_(False)
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(Lead.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def update_lead(
        self,
        *,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> Lead | None:
        lead = self.get_lead(tenant_id=tenant_id, lead_id=lead_id)
        if lead is None:
            return None
        self._apply_fields(lead, fields)
        self._session.flush()
        return lead

    def lead_attribution(self, *, tenant_id: uuid.UUID) -> list[LeadAttributionItem]:
        """Agrega leads activos del tenant por campaña (``utm_campaign``) y fuente.

        La agregación se hace en Python (no con GROUP BY de SQL) para mantener
        compatibilidad entre SQLite y PostgreSQL; el volumen de leads por tenant
        es bajo y la lectura es de solo-consulta.
        """
        base = select(Lead).where(
            Lead.tenant_id == tenant_id, Lead.deleted.is_(False)
        )
        rows = list(self._session.scalars(base).all())
        buckets: dict[tuple[str, str], dict[str, int]] = {}
        for lead in rows:
            metadata = lead.metadata_json or {}
            campaign = str(metadata.get("utm_campaign") or "(sin campaña)")
            source = lead.source or "landing"
            bucket = buckets.setdefault((campaign, source), {})
            status = lead.status or LeadStatus.NEW
            bucket[status] = bucket.get(status, 0) + 1
        items = [
            LeadAttributionItem(
                campaign=campaign,
                source=source,
                total=sum(bucket.values()),
                by_status=bucket,
            )
            for (campaign, source), bucket in buckets.items()
        ]
        items.sort(key=lambda item: (-item.total, item.campaign))
        return items

    # ── Cotizaciones ─────────────────────────────────────────────────────────
    def create_quote(
        self,
        *,
        tenant_id: uuid.UUID,
        customer_name: str,
        customer_email: str | None,
        currency: str,
        services: list[dict[str, Any]],
        subtotal_minor: int,
        tax_minor: int,
        total_minor: int,
        status: str,
        pdf_path: str | None = None,
    ) -> Quote:
        quote = Quote(
            tenant_id=tenant_id,
            customer_name=customer_name,
            customer_email=customer_email,
            currency=currency,
            services=services,
            subtotal_minor=subtotal_minor,
            tax_minor=tax_minor,
            total_minor=total_minor,
            status=status,
            pdf_path=pdf_path,
        )
        self._session.add(quote)
        self._session.flush()
        return quote

    def get_quote(self, *, tenant_id: uuid.UUID, quote_id: uuid.UUID) -> Quote | None:
        statement = (
            select(Quote)
            .where(
                Quote.id == quote_id,
                Quote.tenant_id == tenant_id,
                Quote.deleted.is_(False),
            )
        )
        return self._session.scalars(statement).first()

    def list_quotes(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Quote], int]:
        base = select(Quote).where(
            Quote.tenant_id == tenant_id, Quote.deleted.is_(False)
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(Quote.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def update_quote(
        self,
        *,
        tenant_id: uuid.UUID,
        quote_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> Quote | None:
        quote = self.get_quote(tenant_id=tenant_id, quote_id=quote_id)
        if quote is None:
            return None
        self._apply_fields(quote, fields)
        self._session.flush()
        return quote

    # ── Citas ────────────────────────────────────────────────────────────────
    def create_appointment(
        self,
        *,
        tenant_id: uuid.UUID,
        service: str,
        starts_at: datetime,
        ends_at: datetime,
        timezone: str,
        customer_name: str,
        customer_email: str | None = None,
        customer_phone: str | None = None,
        status: str,
        notes: str | None = None,
        ics_path: str | None = None,
    ) -> Appointment:
        appointment = Appointment(
            tenant_id=tenant_id,
            service=service,
            starts_at=starts_at,
            ends_at=ends_at,
            timezone=timezone,
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=customer_phone,
            status=status,
            notes=notes,
            ics_path=ics_path,
        )
        self._session.add(appointment)
        self._session.flush()
        return appointment

    def get_appointment(self, *, tenant_id: uuid.UUID, appointment_id: uuid.UUID) -> Appointment | None:
        statement = (
            select(Appointment)
            .where(
                Appointment.id == appointment_id,
                Appointment.tenant_id == tenant_id,
                Appointment.deleted.is_(False),
            )
        )
        return self._session.scalars(statement).first()

    def list_appointments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Appointment], int]:
        base = select(Appointment).where(
            Appointment.tenant_id == tenant_id, Appointment.deleted.is_(False)
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(Appointment.starts_at.desc(), Appointment.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def update_appointment(
        self,
        *,
        tenant_id: uuid.UUID,
        appointment_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> Appointment | None:
        appointment = self.get_appointment(tenant_id=tenant_id, appointment_id=appointment_id)
        if appointment is None:
            return None
        self._apply_fields(appointment, fields)
        self._session.flush()
        return appointment

    # ── Portal del cliente (C-3) ──────────────────────────────────────────────
    # Consultas acotadas por ``tenant_id`` + ``customer_email`` normalizada a
    # minúsculas en ambos lados. ``func.lower(col) == email.lower()`` es falso
    # ante ``NULL`` (SQL: ``NULL = 'x'``), así que no filtra ruido de filas sin
    # correo. La paginación replica la de los métodos ``list_*`` homólogos.
    def list_payments_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> tuple[list[PaymentTransaction], int]:
        base = select(PaymentTransaction).where(
            PaymentTransaction.tenant_id == tenant_id,
            PaymentTransaction.deleted.is_(False),
            func.lower(PaymentTransaction.customer_email) == email.lower(),
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(PaymentTransaction.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def list_leads_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> tuple[list[Lead], int]:
        base = select(Lead).where(
            Lead.tenant_id == tenant_id,
            Lead.deleted.is_(False),
            func.lower(Lead.email) == email.lower(),
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(Lead.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def list_quotes_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> tuple[list[Quote], int]:
        base = select(Quote).where(
            Quote.tenant_id == tenant_id,
            Quote.deleted.is_(False),
            func.lower(Quote.customer_email) == email.lower(),
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(Quote.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    def list_appointments_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> tuple[list[Appointment], int]:
        base = select(Appointment).where(
            Appointment.tenant_id == tenant_id,
            Appointment.deleted.is_(False),
            func.lower(Appointment.customer_email) == email.lower(),
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        ordered = (
            base.order_by(Appointment.starts_at.desc(), Appointment.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self._session.scalars(ordered).all()), total

    # ── Recordatorios de citas ────────────────────────────────────────────────
    # Excepción documentada al contrato multi-tenant: ``list_upcoming_*`` y
    # ``list_due_*`` son consultas a nivel de SISTEMA (el scheduler sirve a
    # todos los tenants). El resto de métodos se acota por tenant como siempre.
    def create_appointment_reminder(
        self,
        *,
        tenant_id: uuid.UUID,
        appointment_id: uuid.UUID,
        channel: str,
        scheduled_at: datetime,
    ) -> AppointmentReminder:
        reminder = AppointmentReminder(
            tenant_id=tenant_id,
            appointment_id=appointment_id,
            channel=channel,
            scheduled_at=scheduled_at,
            status=ReminderStatus.PENDING,
        )
        self._session.add(reminder)
        self._session.flush()
        return reminder

    def list_reminder_channels_for_appointment(
        self, *, tenant_id: uuid.UUID, appointment_id: uuid.UUID
    ) -> list[str]:
        statement = (
            select(AppointmentReminder.channel)
            .where(
                AppointmentReminder.appointment_id == appointment_id,
                AppointmentReminder.tenant_id == tenant_id,
                AppointmentReminder.deleted.is_(False),
            )
            .order_by(AppointmentReminder.channel)
        )
        return list(self._session.scalars(statement).all())

    def list_upcoming_appointments_for_reminders(
        self, *, now: datetime, horizon: datetime, limit: int
    ) -> list[Appointment]:
        """Citas que entran en la ventana de recordatorio y aún no tienen uno.

        Sistema-level (sin filtro de tenant): sirve a todos los tenants.
        Solo se consideran citas SCHEDULED/CONFIRMED con al menos un contacto
        (email o teléfono) y sin ningún recordatorio materializado.
        """
        existing = (
            select(AppointmentReminder.appointment_id)
            .where(AppointmentReminder.deleted.is_(False))
        )
        statement = (
            select(Appointment)
            .where(
                Appointment.deleted.is_(False),
                Appointment.starts_at > now,
                Appointment.starts_at <= horizon,
                Appointment.status.in_(
                    [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]
                ),
                (Appointment.customer_email.isnot(None))
                | (Appointment.customer_phone.isnot(None)),
                ~Appointment.id.in_(existing),
            )
            .order_by(Appointment.starts_at)
            .limit(limit)
        )
        return list(self._session.scalars(statement).all())

    def list_due_reminders(self, *, now: datetime, limit: int) -> list[AppointmentReminder]:
        """Recordatorios pendientes de enviar (scheduled_at <= now).

        Sistema-level (sin filtro de tenant). La cita asociada debe seguir
        activa y válida (SCHEDULED/CONFIRMED y no borrada).
        """
        statement = (
            select(AppointmentReminder)
            .join(Appointment, Appointment.id == AppointmentReminder.appointment_id)
            .where(
                AppointmentReminder.deleted.is_(False),
                AppointmentReminder.status == ReminderStatus.PENDING,
                AppointmentReminder.sent_at.is_(None),
                AppointmentReminder.scheduled_at <= now,
                Appointment.deleted.is_(False),
                Appointment.status.in_(
                    [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]
                ),
            )
            .order_by(AppointmentReminder.scheduled_at)
            .limit(limit)
        )
        return list(self._session.scalars(statement).all())

    def mark_reminder_sent(
        self,
        *,
        reminder_id: uuid.UUID,
        status: str,
        sent_at: datetime | None = None,
        details: dict[str, Any] | None = None,
    ) -> AppointmentReminder | None:
        reminder = self._session.get(AppointmentReminder, reminder_id)
        if reminder is None or reminder.deleted:
            return None
        reminder.status = status
        reminder.sent_at = sent_at
        reminder.details = details
        self._session.flush()
        return reminder
