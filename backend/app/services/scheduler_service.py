"""Scheduler de recordatorios de citas (Fase 1 del backlog).

Implementación con la stdlib (``threading`` + ``time``) para respetar la
filosofía de mínimas dependencias ("sin dependencias de terceros fuera de
``httpx``"): un hilo daemon hace *polling* de la base de datos cada
``reminder_poll_interval_seconds``.

Dos fases idempotentes por tick:
1. **Materializar**: se crea un ``AppointmentReminder`` por canal (email/sms)
   para cada cita que entra en la ventana ``starts_at - reminder_hours``.
2. **Enviar**: se despachan los recordatorios con ``scheduled_at <= now`` y se
   marcan ``SENT``/``FAILED``/``SKIPPED``.

El scheduler es a nivel de SISTEMA (sirve a todos los tenants); las consultas
del repositorio que lo soportan son la excepción documentada al contrato
multi-tenant. El contexto de request (contextvars) NO atraviesa hilos, por lo
que la auditoría pasa ``tenant_id`` de forma explícita.
"""

from __future__ import annotations

import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.core.database import Database
from app.core.logging import ILogger
from app.models.workflow import (
    Appointment,
    AppointmentReminder,
    AppointmentStatus,
    ReminderChannel,
    ReminderStatus,
)
from app.repositories.workflow_interfaces import IWorkflowRepository
from app.services.email_template_service import EmailTemplateService
from app.services.interfaces import IAuditService
from app.services.workflow_interfaces import IEmailSender, ISmsSender

# Operación de auditoría usada por el scheduler.
OPERATION_REMINDER = "workflow.appointment.reminder"
# Límite por tick para no hacer lotes infinitos.
_BATCH_LIMIT = 200


@dataclass(frozen=True)
class ReminderProcessingResult:
    """Resultado de una pasada de procesamiento de recordatorios."""

    reminders_materialized: int = 0
    reminders_sent: int = 0
    reminders_failed: int = 0
    reminders_skipped: int = 0


class IReminderScheduler(ABC):
    """Puerto del scheduler de recordatorios (regla CLAUDE: DI)."""

    @abstractmethod
    def process_due_reminders(self) -> ReminderProcessingResult:
        """Ejecuta un ciclo completo (materializar + enviar) de forma síncrona."""

    @abstractmethod
    def start(self) -> None:
        """Arranca el hilo de polling en segundo plano (no bloqueante)."""

    @abstractmethod
    def stop(self) -> None:
        """Detiene el hilo de polling y espera a que termine."""

    @property
    @abstractmethod
    def is_running(self) -> bool:
        """``True`` si el hilo de polling está activo."""


def _naive_utc(value: datetime) -> datetime:
    """Normaliza a UTC sin tzinfo para comparaciones consistentes con SQLite."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


class SchedulerService(IReminderScheduler):
    """Scheduler con polling de la stdlib y fail-closed por tick.

    Dependencias inyectadas (DI): ``database`` (acceso a sesiones), fábricas
    session-scoped de repositorio y auditoría, y los puertos de email/SMS.
    """

    def __init__(
        self,
        *,
        database: Database,
        repository_factory: "callable[[Any], IWorkflowRepository]",
        audit_factory: "callable[[Any], IAuditService]",
        email_sender: IEmailSender,
        sms_sender: ISmsSender,
        logger: ILogger,
        reminder_hours: int = 24,
        poll_interval_seconds: float = 60.0,
        template_service: EmailTemplateService | None = None,
    ) -> None:
        self._database = database
        self._repository_factory = repository_factory
        self._audit_factory = audit_factory
        self._email_sender = email_sender
        self._sms_sender = sms_sender
        self._logger = logger
        self._reminder_hours = reminder_hours
        self._poll_interval_seconds = poll_interval_seconds
        self._template_service = template_service
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    # ── Ciclo de procesamiento ───────────────────────────────────────────────
    def process_due_reminders(self) -> ReminderProcessingResult:
        with self._database.session_scope() as session:
            repository = self._repository_factory(session)
            audit = self._audit_factory(session)
            result = self._process_tick(session, repository, audit)
        self._logger.info(
            "scheduler.tick.completed",
            materialized=result.reminders_materialized,
            sent=result.reminders_sent,
            failed=result.reminders_failed,
            skipped=result.reminders_skipped,
        )
        return result

    def _process_tick(
        self,
        session: Any,
        repository: IWorkflowRepository,
        audit: IAuditService,
    ) -> ReminderProcessingResult:
        now = _naive_utc(datetime.now(timezone.utc))
        materialized = self._materialize(repository, now)
        sent, failed, skipped = self._dispatch(repository, audit, now, session)
        return ReminderProcessingResult(
            reminders_materialized=materialized,
            reminders_sent=sent,
            reminders_failed=failed,
            reminders_skipped=skipped,
        )

    # ── Fase 1: materializar ─────────────────────────────────────────────────
    def _materialize(self, repository: IWorkflowRepository, now: datetime) -> int:
        horizon = now + timedelta(hours=self._reminder_hours)
        appointments = repository.list_upcoming_appointments_for_reminders(
            now=now, horizon=horizon, limit=_BATCH_LIMIT
        )
        created = 0
        for appointment in appointments:
            created += self._materialize_for_appointment(repository, appointment)
        return created

    def _materialize_for_appointment(
        self, repository: IWorkflowRepository, appointment: Appointment
    ) -> int:
        tenant_id = appointment.tenant_id
        existing = set(
            repository.list_reminder_channels_for_appointment(
                tenant_id=tenant_id, appointment_id=appointment.id
            )
        )
        scheduled_at = _naive_utc(appointment.starts_at) - timedelta(
            hours=self._reminder_hours
        )
        created = 0
        if appointment.customer_email and ReminderChannel.EMAIL not in existing:
            repository.create_appointment_reminder(
                tenant_id=tenant_id,
                appointment_id=appointment.id,
                channel=ReminderChannel.EMAIL,
                scheduled_at=scheduled_at,
            )
            created += 1
        if appointment.customer_phone and ReminderChannel.SMS not in existing:
            repository.create_appointment_reminder(
                tenant_id=tenant_id,
                appointment_id=appointment.id,
                channel=ReminderChannel.SMS,
                scheduled_at=scheduled_at,
            )
            created += 1
        return created

    # ── Fase 2: enviar ───────────────────────────────────────────────────────
    def _dispatch(
        self,
        repository: IWorkflowRepository,
        audit: IAuditService,
        now: datetime,
        session: Any,
    ) -> tuple[int, int, int]:
        reminders = repository.list_due_reminders(now=now, limit=_BATCH_LIMIT)
        sent = failed = skipped = 0
        for reminder in reminders:
            outcome = self._send_one(repository, audit, reminder, session)
            sent += outcome == ReminderStatus.SENT
            failed += outcome == ReminderStatus.FAILED
            skipped += outcome == ReminderStatus.SKIPPED
        return sent, failed, skipped

    def _send_one(
        self,
        repository: IWorkflowRepository,
        audit: IAuditService,
        reminder: AppointmentReminder,
        session: Any,
    ) -> str:
        appointment = session.get(Appointment, reminder.appointment_id)
        if appointment is None:
            self._mark(
                repository,
                audit,
                reminder,
                ReminderStatus.SKIPPED,
                {"reason": "cita inexistente"},
            )
            return ReminderStatus.SKIPPED

        outcome = ReminderStatus.SKIPPED
        details: dict[str, object] = {"appointment_id": str(appointment.id)}
        try:
            if reminder.channel == ReminderChannel.EMAIL:
                if not appointment.customer_email:
                    details["reason"] = "sin email de contacto"
                elif self._send_email(appointment):
                    outcome = ReminderStatus.SENT
                else:
                    outcome = ReminderStatus.FAILED
                    details["reason"] = "proveedor de email no disponible"
            elif reminder.channel == ReminderChannel.SMS:
                if not appointment.customer_phone:
                    details["reason"] = "sin teléfono de contacto"
                elif self._send_sms(appointment):
                    outcome = ReminderStatus.SENT
                else:
                    outcome = ReminderStatus.FAILED
                    details["reason"] = "proveedor de SMS no disponible"
            else:
                details["reason"] = f"canal desconocido: {reminder.channel}"
        except Exception as exc:  # fail-closed: un recordatorio no tumba el tick
            outcome = ReminderStatus.FAILED
            details["reason"] = f"error de envío: {type(exc).__name__}: {exc}"
            self._logger.warning(
                "scheduler.reminder.error",
                reminder_id=str(reminder.id),
                channel=reminder.channel,
                error=str(exc),
            )

        self._mark(repository, audit, reminder, outcome, details)
        return outcome

    def _send_email(self, appointment: Appointment) -> bool:
        subject = f"Recordatorio de cita: {appointment.service}"
        html = self._email_html(appointment)
        return self._email_sender.send_email(
            to_email=appointment.customer_email or "",
            subject=subject,
            html_body=html,
        )

    def _send_sms(self, appointment: Appointment) -> bool:
        message = self._sms_text(appointment)
        return self._sms_sender.send_sms(
            to_phone=appointment.customer_phone or "",
            message=message,
        )

    def _mark(
        self,
        repository: IWorkflowRepository,
        audit: IAuditService,
        reminder: AppointmentReminder,
        status: str,
        details: dict[str, object],
    ) -> None:
        sent_at = datetime.now(timezone.utc) if status == ReminderStatus.SENT else None
        repository.mark_reminder_sent(
            reminder_id=reminder.id,
            status=status,
            sent_at=sent_at,
            details={k: str(v) for k, v in details.items()},
        )
        try:
            audit.record(
                tenant_id=reminder.tenant_id,
                operation=OPERATION_REMINDER,
                entity_type="appointment_reminder",
                entity_id=str(reminder.id),
                details={
                    "channel": reminder.channel,
                    "status": status,
                    **details,
                },
            )
        except Exception as exc:
            # La auditoría no debe romper el ciclo: se registra y se continúa.
            self._logger.error(
                "scheduler.audit.failed",
                reminder_id=str(reminder.id),
                error=str(exc),
            )

    # ── Plantillas de mensaje ────────────────────────────────────────────────
    @staticmethod
    def _format_local(appointment: Appointment) -> str:
        starts = appointment.starts_at
        if starts.tzinfo is None:
            starts = starts.replace(tzinfo=timezone.utc)
        return starts.astimezone(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")

    def _email_html(self, appointment: Appointment) -> str:
        customer = appointment.customer_name
        service = appointment.service
        when = self._format_local(appointment)
        tz = appointment.timezone
        if self._template_service is not None:
            return self._template_service.render(
                "appointment_reminder.html",
                context={
                    "customer_name": customer,
                    "service": service,
                    "when": when,
                    "tz": tz,
                },
            )
        return (
            f"<h2>Hola {customer},</h2>"
            f"<p>Te recordamos tu cita de <strong>{service}</strong>.</p>"
            f"<p><strong>Fecha:</strong> {when}</p>"
            f"<p><strong>Zona horaria:</strong> {tz}</p>"
            f"<p>¡Te esperamos!</p>"
        )

    def _sms_text(self, appointment: Appointment) -> str:
        when = self._format_local(appointment)
        return (
            f"Hola {appointment.customer_name}, recordatorio de tu cita "
            f"{appointment.service} el {when}."
        )

    # ── Ciclo de vida del hilo ───────────────────────────────────────────────
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="appointment-reminder-scheduler",
            daemon=True,
        )
        self._thread.start()
        self._logger.info("scheduler.started", interval=self._poll_interval_seconds)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=max(self._poll_interval_seconds * 2, 5.0))
        self._logger.info("scheduler.stopped")

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.process_due_reminders()
            except Exception as exc:
                # Fail-closed: un tick con error se loguea y se reintenta.
                self._logger.error(
                    "scheduler.tick.error",
                    error=str(exc),
                )
            self._stop_event.wait(timeout=self._poll_interval_seconds)


__all__ = [
    "IReminderScheduler",
    "OPERATION_REMINDER",
    "ReminderProcessingResult",
    "SchedulerService",
    "_naive_utc",
]
