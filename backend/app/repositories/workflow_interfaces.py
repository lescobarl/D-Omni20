"""Puertos (ABC) del repositorio de workflows — inversión de dependencias (regla CLAUDE: DI).

La lógica de negocio depende de esta interfaz, nunca de implementaciones
concretas. La implementación vive en ``app.repositories.workflow_repositories``
y se inyecta desde el composition root (``app.api.deps``).

Contrato multi-tenant: toda query se acota por ``tenant_id`` y filtra
``deleted=False`` (defensa en profundidad junto con RLS de PostgreSQL).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import Any

from app.models.workflow import Appointment, AppointmentReminder, Lead, PaymentTransaction, Quote


class IWorkflowRepository(ABC):
    """Acceso a las 4 entidades de conversión SIEMPRE acotado al tenant."""

    # ── Pagos ────────────────────────────────────────────────────────────────
    @abstractmethod
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
    ) -> PaymentTransaction: ...

    @abstractmethod
    def get_payment(self, *, tenant_id: uuid.UUID, payment_id: uuid.UUID) -> PaymentTransaction | None: ...

    @abstractmethod
    def get_payment_by_session(
        self, *, tenant_id: uuid.UUID, provider_session_id: str
    ) -> PaymentTransaction | None: ...

    @abstractmethod
    def list_payments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[PaymentTransaction], int]: ...

    @abstractmethod
    def update_payment(
        self,
        *,
        tenant_id: uuid.UUID,
        payment_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> PaymentTransaction | None: ...

    # ── Leads ────────────────────────────────────────────────────────────────
    @abstractmethod
    def create_lead(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        email: str,
        phone: str | None = None,
        source: str = "landing",
        metadata: dict[str, Any] | None = None,
    ) -> Lead: ...

    @abstractmethod
    def get_lead(self, *, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None: ...

    @abstractmethod
    def list_leads(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Lead], int]: ...

    @abstractmethod
    def update_lead(
        self,
        *,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> Lead | None: ...

    # ── Cotizaciones ─────────────────────────────────────────────────────────
    @abstractmethod
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
    ) -> Quote: ...

    @abstractmethod
    def get_quote(self, *, tenant_id: uuid.UUID, quote_id: uuid.UUID) -> Quote | None: ...

    @abstractmethod
    def list_quotes(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Quote], int]: ...

    @abstractmethod
    def update_quote(
        self,
        *,
        tenant_id: uuid.UUID,
        quote_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> Quote | None: ...

    # ── Citas ────────────────────────────────────────────────────────────────
    @abstractmethod
    def create_appointment(
        self,
        *,
        tenant_id: uuid.UUID,
        service: str,
        starts_at: Any,
        ends_at: Any,
        timezone: str,
        customer_name: str,
        customer_email: str | None = None,
        customer_phone: str | None = None,
        status: str,
        notes: str | None = None,
        ics_path: str | None = None,
    ) -> Appointment: ...

    @abstractmethod
    def get_appointment(self, *, tenant_id: uuid.UUID, appointment_id: uuid.UUID) -> Appointment | None: ...

    @abstractmethod
    def list_appointments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Appointment], int]: ...

    @abstractmethod
    def update_appointment(
        self,
        *,
        tenant_id: uuid.UUID,
        appointment_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> Appointment | None: ...

    # ── Recordatorios de citas ────────────────────────────────────────────────
    # Excepción documentada al contrato multi-tenant: las consultas del
    # scheduler son a nivel de sistema (sirven a TODOS los tenants).
    @abstractmethod
    def create_appointment_reminder(
        self,
        *,
        tenant_id: uuid.UUID,
        appointment_id: uuid.UUID,
        channel: str,
        scheduled_at: Any,
    ) -> AppointmentReminder: ...

    @abstractmethod
    def list_reminder_channels_for_appointment(
        self, *, tenant_id: uuid.UUID, appointment_id: uuid.UUID
    ) -> list[str]: ...

    @abstractmethod
    def list_upcoming_appointments_for_reminders(
        self, *, now: Any, horizon: Any, limit: int
    ) -> list[Appointment]: ...

    @abstractmethod
    def list_due_reminders(self, *, now: Any, limit: int) -> list[AppointmentReminder]: ...

    @abstractmethod
    def mark_reminder_sent(
        self,
        *,
        reminder_id: uuid.UUID,
        status: str,
        sent_at: Any | None = None,
        details: dict[str, Any] | None = None,
    ) -> AppointmentReminder | None: ...
