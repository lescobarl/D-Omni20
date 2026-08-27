"""Pruebas del scheduler de recordatorios de citas (FASE 1 del backlog).

Cubre materialización, dispatch, fallos de proveedores, auditoría, ciclo de
vida del hilo y E2E HTTP. Cada prueba usa una base SQLite en memoria aislada
(StaticPool -> una sola conexión) para no contaminar la suite compartida.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import Database
from app.core.logging import ILogger
from app.models.audit_log import AuditLog
from app.models.base import Base
from app.models.workflow import (
    Appointment,
    AppointmentReminder,
    AppointmentStatus,
    ReminderChannel,
    ReminderStatus,
)
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyTenantRepository,
)
from app.repositories.workflow_repositories import SqlAlchemyWorkflowRepository
from app.services.audit_service import AuditService
from app.services.scheduler_service import (
    OPERATION_REMINDER,
    ReminderProcessingResult,
    SchedulerService,
    _naive_utc,
)
from app.services.workflow_interfaces import IEmailSender, ISmsSender

TENANT_HEADERS = {"X-Tenant-Id": "dev-tenant"}
EMAIL = "ana@example.com"
PHONE = "+52 55 1234 5678"


# --------------------------------------------------------------------------
# Helpers de tiempo (misma convención naive-UTC del scheduler)
# --------------------------------------------------------------------------
def _now() -> datetime:
    return _naive_utc(datetime.now(timezone.utc))


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc)


def _in_window() -> datetime:
    return _now() + timedelta(hours=2)


# --------------------------------------------------------------------------
# Fakes / Dummies (sin dependencias de terceros)
# --------------------------------------------------------------------------
class _RecordingLogger(ILogger):
    """Registra cada llamada (evento, campos) para aserciones."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def events_named(self, name: str) -> list[dict[str, Any]]:
        return [fields for (event, fields) in self.events if event == name]

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, fields))


class _FakeEmailSender(IEmailSender):
    def __init__(self, *, ok: bool = True, raise_error: Exception | None = None) -> None:
        self.ok = ok
        self.raise_error = raise_error
        self.calls: list[dict[str, Any]] = []

    def send_email(
        self, *, to_email: str, subject: str, html_body: str, attachments: list[Any] | None = None
    ) -> bool:
        if self.raise_error is not None:
            raise self.raise_error
        self.calls.append(
            {
                "to_email": to_email,
                "subject": subject,
                "html_body": html_body,
                "attachments": attachments,
            }
        )
        return self.ok


class _FakeSmsSender(ISmsSender):
    def __init__(self, *, ok: bool = True, raise_error: Exception | None = None) -> None:
        self.ok = ok
        self.raise_error = raise_error
        self.calls: list[dict[str, Any]] = []

    def send_sms(self, *, to_phone: str, message: str) -> bool:
        if self.raise_error is not None:
            raise self.raise_error
        self.calls.append({"to_phone": to_phone, "message": message})
        return self.ok


def _make_appointment(
    repo: SqlAlchemyWorkflowRepository,
    *,
    tenant_id: uuid.UUID,
    starts_at: datetime,
    status: str = AppointmentStatus.SCHEDULED,
    customer_email: str | None = EMAIL,
    customer_phone: str | None = PHONE,
    service: str = "Consulta inicial",
) -> Appointment:
    return repo.create_appointment(
        tenant_id=tenant_id,
        service=service,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
        timezone="America/Mexico_City",
        customer_name="Ana Pérez",
        customer_email=customer_email,
        customer_phone=customer_phone,
        status=status,
        notes="Primera reunión",
    )


def _create_appointment(env: dict[str, Any], *, starts_at: datetime | None = None, **overrides: Any) -> Appointment:
    with env["database"].session_scope() as session:
        return _make_appointment(
            SqlAlchemyWorkflowRepository(session),
            tenant_id=env["tenant_id"],
            starts_at=starts_at or _in_window(),
            **overrides,
        )


def _list_reminders(env: dict[str, Any]) -> list[AppointmentReminder]:
    with env["database"].session_scope() as session:
        return list(
            session.scalars(select(AppointmentReminder).order_by(AppointmentReminder.channel)).all()
        )


# --------------------------------------------------------------------------
# Fixture: entorno aislado por prueba
# --------------------------------------------------------------------------
@pytest.fixture
def scheduler_env() -> Generator[dict[str, Any], None, None]:
    database = Database("sqlite:///:memory:")
    Base.metadata.create_all(database.engine)
    with database.session_scope() as session:
        tenant = SqlAlchemyTenantRepository(session).create(
            slug="dev-tenant", name="Tenant de Desarrollo"
        )
        tenant_id = tenant.id

    logger = _RecordingLogger()
    email_sender = _FakeEmailSender()
    sms_sender = _FakeSmsSender()
    scheduler = SchedulerService(
        database=database,
        repository_factory=lambda s: SqlAlchemyWorkflowRepository(s),
        audit_factory=lambda s: AuditService(
            repository=SqlAlchemyAuditRepository(s), logger=logger
        ),
        email_sender=email_sender,
        sms_sender=sms_sender,
        logger=logger,
        reminder_hours=24,
        poll_interval_seconds=0.05,
    )
    env: dict[str, Any] = {
        "database": database,
        "scheduler": scheduler,
        "logger": logger,
        "email_sender": email_sender,
        "sms_sender": sms_sender,
        "tenant_id": tenant_id,
    }
    yield env
    scheduler.stop()
    database.dispose()


# --------------------------------------------------------------------------
# 1. Materialización
# --------------------------------------------------------------------------
def test_materialize_creates_email_and_sms_rows(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    appointment = _create_appointment(env)
    with env["database"].session_scope() as session:
        count = env["scheduler"]._materialize(SqlAlchemyWorkflowRepository(session), _now())

    assert count == 2
    reminders = _list_reminders(env)
    assert [r.channel for r in reminders] == [ReminderChannel.EMAIL, ReminderChannel.SMS]
    assert all(r.status == ReminderStatus.PENDING for r in reminders)
    for reminder in reminders:
        expected = _naive_utc(appointment.starts_at) - timedelta(hours=24)
        assert _naive_utc(reminder.scheduled_at) == expected


def test_materialize_is_idempotent(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    _create_appointment(env)
    with env["database"].session_scope() as session:
        repo = SqlAlchemyWorkflowRepository(session)
        first = env["scheduler"]._materialize(repo, _now())
        second = env["scheduler"]._materialize(repo, _now())

    assert first == 2
    assert second == 0
    assert len(_list_reminders(env)) == 2


def test_materialize_excludes_out_of_window_and_invalid(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    _create_appointment(env, starts_at=_in_window() + timedelta(hours=46))  # 48 h adelante
    _create_appointment(env, customer_email=None, customer_phone=None)  # sin contactos
    _create_appointment(env, status=AppointmentStatus.CANCELED)  # cancelada
    with env["database"].session_scope() as session:
        count = env["scheduler"]._materialize(SqlAlchemyWorkflowRepository(session), _now())

    assert count == 0
    assert _list_reminders(env) == []


# --------------------------------------------------------------------------
# 2. Dispatch completo
# --------------------------------------------------------------------------
def test_process_due_reminders_sends_email_and_sms(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    appointment = _create_appointment(env)

    result = env["scheduler"].process_due_reminders()

    assert isinstance(result, ReminderProcessingResult)
    assert result.reminders_materialized == 2
    assert result.reminders_sent == 2
    assert result.reminders_failed == 0
    assert result.reminders_skipped == 0

    assert len(env["email_sender"].calls) == 1
    email_call = env["email_sender"].calls[0]
    assert email_call["to_email"] == EMAIL
    assert email_call["subject"] == "Recordatorio de cita: Consulta inicial"
    assert "Ana Pérez" in email_call["html_body"]

    assert len(env["sms_sender"].calls) == 1
    assert env["sms_sender"].calls[0]["to_phone"] == PHONE

    reminders = _list_reminders(env)
    assert all(r.status == ReminderStatus.SENT for r in reminders)
    assert all(r.sent_at is not None for r in reminders)
    assert all(r.details is not None for r in reminders)
    assert all(r.details["appointment_id"] == str(appointment.id) for r in reminders)


def test_process_due_reminders_is_idempotent(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    _create_appointment(env)

    first = env["scheduler"].process_due_reminders()
    second = env["scheduler"].process_due_reminders()

    assert (first.reminders_materialized, first.reminders_sent) == (2, 2)
    assert (second.reminders_materialized, second.reminders_sent) == (0, 0)
    assert (second.reminders_failed, second.reminders_skipped) == (0, 0)
    assert len(env["email_sender"].calls) == 1
    assert len(env["sms_sender"].calls) == 1


def test_provider_unavailable_marks_failed(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    env["email_sender"].ok = False
    _create_appointment(env, customer_phone=None)  # solo canal email

    result = env["scheduler"].process_due_reminders()

    assert result.reminders_materialized == 1
    assert result.reminders_failed == 1
    assert result.reminders_sent == 0
    reminders = _list_reminders(env)
    assert reminders[0].status == ReminderStatus.FAILED
    assert reminders[0].details["reason"] == "proveedor de email no disponible"


def test_provider_raises_logs_and_marks_failed(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    env["email_sender"].raise_error = RuntimeError("SMTP caído")
    _create_appointment(env, customer_phone=None)  # solo canal email

    result = env["scheduler"].process_due_reminders()

    assert result.reminders_failed == 1
    reminders = _list_reminders(env)
    assert reminders[0].status == ReminderStatus.FAILED
    assert "SMTP caído" in reminders[0].details["reason"]
    error_events = env["logger"].events_named("scheduler.reminder.error")
    assert len(error_events) == 1
    assert "SMTP caído" in error_events[0]["error"]


def test_email_removed_only_sms_materialized_and_sent(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    _create_appointment(env, customer_email=None)  # sin email -> solo canal SMS

    result = env["scheduler"].process_due_reminders()

    assert result.reminders_materialized == 1
    assert result.reminders_sent == 1
    assert result.reminders_failed == 0
    assert result.reminders_skipped == 0
    assert len(env["email_sender"].calls) == 0
    assert len(env["sms_sender"].calls) == 1
    reminders = _list_reminders(env)
    assert len(reminders) == 1
    assert reminders[0].channel == ReminderChannel.SMS
    assert reminders[0].status == ReminderStatus.SENT


def test_dangling_appointment_is_skipped(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    with env["database"].session_scope() as session:
        reminder = AppointmentReminder(
            tenant_id=env["tenant_id"],
            appointment_id=uuid.uuid4(),  # cita inexistente (FK solo en disco)
            channel=ReminderChannel.EMAIL,
            scheduled_at=_now(),
            status=ReminderStatus.PENDING,
        )
        session.add(reminder)
        session.flush()
        session.refresh(reminder)
        reminder_id = reminder.id

        repo = SqlAlchemyWorkflowRepository(session)
        audit = AuditService(
            repository=SqlAlchemyAuditRepository(session), logger=env["logger"]
        )
        outcome = env["scheduler"]._send_one(repo, audit, reminder, session)
        session.flush()

    assert outcome == ReminderStatus.SKIPPED
    with env["database"].session_scope() as session:
        row = session.get(AppointmentReminder, reminder_id)
        assert row.status == ReminderStatus.SKIPPED
        assert row.details["reason"] == "cita inexistente"


# --------------------------------------------------------------------------
# 3. Auditoría
# --------------------------------------------------------------------------
def test_audit_log_records_reminder_operations(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    appointment = _create_appointment(env)
    env["scheduler"].process_due_reminders()

    with env["database"].session_scope() as session:
        rows = list(
            session.scalars(select(AuditLog).where(AuditLog.operation == OPERATION_REMINDER)).all()
        )

    assert len(rows) == 2
    for row in rows:
        assert row.tenant_id == env["tenant_id"]
        assert row.entity_type == "appointment_reminder"
        assert row.details["appointment_id"] == str(appointment.id)
        assert row.details["status"] == "sent"
        assert row.details["channel"] in (ReminderChannel.EMAIL, ReminderChannel.SMS)


# --------------------------------------------------------------------------
# 4. Ciclo de vida del hilo
# --------------------------------------------------------------------------
def test_scheduler_thread_lifecycle(scheduler_env: dict[str, Any]) -> None:
    env = scheduler_env
    scheduler = env["scheduler"]

    assert scheduler.is_running is False
    scheduler.start()
    assert scheduler.is_running is True
    scheduler.start()  # idempotente: no lanza ni duplica el hilo
    scheduler.stop()
    assert scheduler.is_running is False
    scheduler.stop()  # seguro repetir

    events = [event for (event, _fields) in env["logger"].events]
    assert "scheduler.started" in events
    assert "scheduler.stopped" in events


def test_scheduler_loop_logs_tick_errors() -> None:
    logger = _RecordingLogger()

    def boom_factory(_session: Any) -> Any:
        raise RuntimeError("base de datos caída")

    database = Database("sqlite:///:memory:")
    Base.metadata.create_all(database.engine)
    scheduler = SchedulerService(
        database=database,
        repository_factory=boom_factory,
        audit_factory=lambda s: AuditService(
            repository=SqlAlchemyAuditRepository(s), logger=logger
        ),
        email_sender=_FakeEmailSender(),
        sms_sender=_FakeSmsSender(),
        logger=logger,
        reminder_hours=24,
        poll_interval_seconds=0.02,
    )
    try:
        scheduler.start()
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline and not logger.events_named("scheduler.tick.error"):
            time.sleep(0.05)
        errors = logger.events_named("scheduler.tick.error")
        assert len(errors) >= 1
        assert "base de datos caída" in errors[0]["error"]
    finally:
        scheduler.stop()
    assert scheduler.is_running is False
    database.dispose()


# --------------------------------------------------------------------------
# 5. E2E HTTP
# --------------------------------------------------------------------------
def test_process_reminders_endpoint_roundtrip(client: TestClient) -> None:
    starts_at = _utc(_now() + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "service": "Consulta inicial",
        "starts_at": starts_at,
        "duration_minutes": 60,
        "timezone": "America/Mexico_City",
        "customer_name": "Ana Pérez",
        "customer_email": EMAIL,
        "customer_phone": PHONE,
        "notes": "Primera reunión",
    }
    response = client.post("/api/v1/workflows/appointment", headers=TENANT_HEADERS, json=payload)
    assert response.status_code == 201

    process = client.post("/api/v1/workflows/reminders/process")
    assert process.status_code == 200
    body = process.json()
    assert isinstance(body["reminders_materialized"], int)
    assert isinstance(body["reminders_sent"], int)
    assert isinstance(body["reminders_failed"], int)
    assert isinstance(body["reminders_skipped"], int)
    assert body["reminders_materialized"] >= 2
