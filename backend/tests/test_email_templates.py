"""Pruebas de las plantillas Jinja2 de email y del servicio de render (FASE 4).

Cubre:
- Renderizado correcto de las 4 plantillas (contexto + autoescape).
- Fail-fast del servicio (directorio inexistente -> ``ConfigValidationError``).
- Plantilla inexistente -> ``jinja2.TemplateNotFound``.
- ``SmtpEmailSender`` renderiza desde plantilla (ruta template) y mantiene la
  compatibilidad con ``html_body``.
- Fallos de render / plantilla sin servicio -> ``False`` con logs estructurados.
- Wiring DI del ``EmailTemplateService`` en el contenedor.
- El scheduler usa la plantilla ``appointment_reminder.html`` cuando el servicio
  de plantillas está inyectado.

Contrato (regla CLAUDE): sin red real en los tests — se inyecta una fábrica
SMTP falsa y un logger de grabación.
"""

from __future__ import annotations

import html
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator

import jinja2
import pytest

from app.core.database import Database
from app.core.di import build_container
from app.core.errors import ConfigValidationError
from app.core.logging import ILogger
from app.models.base import Base
from app.models.workflow import Appointment, AppointmentStatus
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyTenantRepository,
)
from app.repositories.workflow_repositories import SqlAlchemyWorkflowRepository
from app.services.audit_service import AuditService
from app.services.email_template_service import EmailTemplateService
from app.services.providers import SmtpEmailSender
from app.services.scheduler_service import SchedulerService, _naive_utc
from app.services.workflow_interfaces import IEmailSender, ISmsSender

# Directorio real de plantillas (independiente del CWD al correr pytest).
TEMPLATES_DIR = str(Path(__file__).resolve().parent.parent / "email_templates")

EMAIL = "ana@example.com"
PHONE = "+52 55 1234 5678"


# --------------------------------------------------------------------------
# Fakes / Dummies (sin dependencias de terceros)
# --------------------------------------------------------------------------
class _RecordingLogger(ILogger):
    """Logger de prueba que solo acumula eventos (sin E/S)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def events_named(self, name: str) -> list[tuple[str, dict[str, Any]]]:
        return [(event, fields) for (event, _m, fields) in self.events if event == name]

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))


class _FakeSmtp:
    """Sesión SMTP falsa (context manager) inyectada vía ``smtp_factory``."""

    def __init__(self, *, fail_with: Exception | None = None) -> None:
        self.fail_with = fail_with
        self.host = ""
        self.port = 0
        self.timeout = 0.0
        self.starttls_called = False
        self.login_called = False
        self.sent_messages: list[Any] = []
        self.closed = False

    def __enter__(self) -> "_FakeSmtp":
        return self

    def __exit__(self, *args: Any) -> bool:
        self.closed = True
        return False

    def starttls(self) -> None:
        self.starttls_called = True

    def login(self, username: str, password: str) -> None:
        self.login_called = True

    def send_message(self, message: Any) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.sent_messages.append(message)


def _smtp_factory(smtp: _FakeSmtp):
    """Fábrica compatible con el parámetro ``smtp_factory`` de SmtpEmailSender."""

    def factory(*, host: str = "", port: int = 0, timeout: float = 0.0) -> _FakeSmtp:
        smtp.host = host
        smtp.port = port
        smtp.timeout = timeout
        return smtp

    return factory


class _FakeEmailSender(IEmailSender):
    """Emisor falso que registra llamadas (compatible con el scheduler)."""

    def __init__(self, *, ok: bool = True, raise_error: Exception | None = None) -> None:
        self.ok = ok
        self.raise_error = raise_error
        self.calls: list[dict[str, Any]] = []

    def send_email(
        self,
        *,
        to_email: str,
        subject: str,
        html_body: str | None = None,
        attachments: list[Any] | None = None,
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
    """Emisor SMS falso que registra llamadas (compatible con el scheduler)."""

    def __init__(self, *, ok: bool = True) -> None:
        self.ok = ok
        self.calls: list[dict[str, Any]] = []

    def send_sms(self, *, to_phone: str, message: str) -> bool:
        self.calls.append({"to_phone": to_phone, "message": message})
        return self.ok


class _FailingTemplateService:
    """Servicio de plantillas que falla en render (para rutas de error)."""

    def render(self, template_name: str, *, context: dict[str, Any] | None = None) -> str:
        raise RuntimeError("boom de plantilla")


def _make_smtp(**overrides: Any) -> SmtpEmailSender:
    params: dict[str, Any] = {
        "host": "smtp.example.com",
        "port": 587,
        "username": "user",
        "password": "pass",
        "from_email": "no-reply@example.com",
        "use_tls": True,
        "timeout_seconds": 5.0,
        "logger": _RecordingLogger(),
        "smtp_factory": None,
        "template_service": None,
    }
    params.update(overrides)
    return SmtpEmailSender(**params)


def _html_part(message: Any) -> str:
    """Extrae el cuerpo HTML de un ``EmailMessage`` (parte alternativa)."""
    body = message.get_body(preferencelist=("html",))
    assert body is not None
    return body.get_content()


# --------------------------------------------------------------------------
# Renderizado de plantillas
# --------------------------------------------------------------------------
def test_reminder_template_renders_context() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    html = service.render(
        "appointment_reminder.html",
        context={
            "customer_name": "Ana Pérez",
            "service": "Consulta dental",
            "when": "01/09/2026 15:00 UTC",
            "tz": "UTC",
        },
    )

    assert "Recordatorio de tu cita, Ana Pérez" in html
    assert "Consulta dental" in html
    assert "01/09/2026 15:00 UTC" in html
    assert "UTC" in html


def test_scheduled_template_renders_context() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    html = service.render(
        "appointment_scheduled.html",
        context={
            "customer_name": "Ana Pérez",
            "service": "Consulta dental",
            "starts_at": "2026-09-01T15:00:00+00:00",
            "ics_url": "http://test/event.ics",
        },
    )

    assert "¡Cita agendada, Ana Pérez!" in html
    assert "Consulta dental" in html
    assert "2026-09-01T15:00:00+00:00" in html
    assert "Agregar a mi calendario" in html
    assert "http://test/event.ics" in html


def test_scheduled_template_omits_ics_link_without_url() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    html = service.render(
        "appointment_scheduled.html",
        context={
            "customer_name": "Ana Pérez",
            "service": "Consulta dental",
            "starts_at": "2026-09-01T15:00:00+00:00",
            "ics_url": None,
        },
    )

    assert "Agregar a mi calendario" not in html


def test_checkout_confirmation_renders_context() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    html = service.render(
        "checkout_confirmation.html",
        context={
            "customer_name": "Ana Pérez",
            "amount": "$1,500.00",
            "currency": "MXN",
        },
    )

    assert "¡Gracias por tu compra, Ana Pérez!" in html
    assert "$1,500.00" in html
    assert "MXN" in html


def test_quote_generated_renders_context() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    html = service.render(
        "quote_generated.html",
        context={
            "customer_name": "Ana Pérez",
            "quote_id": "QT-0001",
            "total": "$3,200.00",
        },
    )

    assert "Tu cotización está lista, Ana Pérez" in html
    assert "QT-0001" in html
    assert "$3,200.00" in html


def test_render_autoescapes_context_values() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    rendered = service.render(
        "appointment_reminder.html",
        context={
            "customer_name": "<b>Ana</b>",
            "service": "<script>alert(1)</script>",
            "when": "01/09/2026 15:00 UTC",
            "tz": "UTC",
        },
    )

    assert "<script>" not in rendered
    assert html.escape("<script>alert(1)</script>") in rendered
    assert "<b>Ana</b>" not in rendered
    assert html.escape("<b>Ana</b>") in rendered


# --------------------------------------------------------------------------
# Fail-fast del servicio de plantillas
# --------------------------------------------------------------------------
def test_missing_templates_dir_raises_config_error() -> None:
    with pytest.raises(ConfigValidationError) as exc_info:
        EmailTemplateService(
            templates_dir="/ruta/que/no/existe/plantillas", logger=_RecordingLogger()
        )

    assert "directorio de plantillas de email no existe" in str(exc_info.value)
    assert exc_info.value.operation == "email_template_service.init"


def test_missing_template_raises_template_not_found() -> None:
    service = EmailTemplateService(templates_dir=TEMPLATES_DIR, logger=_RecordingLogger())

    with pytest.raises(jinja2.TemplateNotFound):
        service.render("plantilla_inexistente.html", context={})


# --------------------------------------------------------------------------
# SmtpEmailSender: ruta template vs html_body
# --------------------------------------------------------------------------
def test_smtp_sends_rendered_template() -> None:
    smtp = _FakeSmtp()
    logger = _RecordingLogger()
    sender = _make_smtp(
        smtp_factory=_smtp_factory(smtp),
        logger=logger,
        template_service=EmailTemplateService(
            templates_dir=TEMPLATES_DIR, logger=logger
        ),
    )

    delivered = sender.send_email(
        to_email=EMAIL,
        subject="Recordatorio de cita: Consulta dental",
        template_name="appointment_reminder.html",
        template_context={
            "customer_name": "Ana Pérez",
            "service": "Consulta dental",
            "when": "01/09/2026 15:00 UTC",
            "tz": "UTC",
        },
    )

    assert delivered is True
    assert len(smtp.sent_messages) == 1
    html = _html_part(smtp.sent_messages[0])
    assert "Ana Pérez" in html
    assert "Consulta dental" in html
    assert "01/09/2026 15:00 UTC" in html
    assert smtp.sent_messages[0]["Subject"] == "Recordatorio de cita: Consulta dental"
    assert len(logger.events_named("workflow.email.smtp_sent")) == 1
    assert len(logger.events_named("workflow.email.template_rendered")) == 1


def test_smtp_template_without_service_returns_false() -> None:
    logger = _RecordingLogger()
    sender = _make_smtp(logger=logger)  # sin template_service

    delivered = sender.send_email(
        to_email=EMAIL,
        subject="Recordatorio",
        template_name="appointment_reminder.html",
        template_context={"customer_name": "Ana"},
    )

    assert delivered is False
    unavailable = logger.events_named("workflow.email.template_unavailable")
    assert len(unavailable) == 1
    assert unavailable[0][1]["template_name"] == "appointment_reminder.html"


def test_smtp_template_render_failure_returns_false() -> None:
    logger = _RecordingLogger()
    sender = _make_smtp(
        logger=logger,
        template_service=_FailingTemplateService(),  # type: ignore[arg-type]
    )

    delivered = sender.send_email(
        to_email=EMAIL,
        subject="Recordatorio",
        template_name="appointment_reminder.html",
        template_context={"customer_name": "Ana"},
    )

    assert delivered is False
    failed = logger.events_named("workflow.email.template_failed")
    assert len(failed) == 1
    assert failed[0][1]["template_name"] == "appointment_reminder.html"
    assert "boom de plantilla" in failed[0][1]["error"]


def test_smtp_html_body_backward_compatible() -> None:
    smtp = _FakeSmtp()
    sender = _make_smtp(smtp_factory=_smtp_factory(smtp))

    delivered = sender.send_email(
        to_email=EMAIL,
        subject="Hola",
        html_body="<p>Hola Ana</p>",
    )

    assert delivered is True
    assert len(smtp.sent_messages) == 1
    assert "Hola Ana" in _html_part(smtp.sent_messages[0])


def test_smtp_disabled_short_circuits_before_render() -> None:
    logger = _RecordingLogger()
    # SMTP desconfigurado (host vacío) + servicio de plantillas presente.
    sender = _make_smtp(
        host="",
        logger=logger,
        template_service=EmailTemplateService(
            templates_dir=TEMPLATES_DIR, logger=logger
        ),
    )

    delivered = sender.send_email(
        to_email=EMAIL,
        subject="Recordatorio",
        template_name="appointment_reminder.html",
        template_context={"customer_name": "Ana"},
    )

    assert delivered is False
    assert len(logger.events_named("workflow.email.template_rendered")) == 0
    assert len(logger.events_named("workflow.email.smtp_skipped")) == 1


# --------------------------------------------------------------------------
# Wiring DI
# --------------------------------------------------------------------------
def test_di_email_template_service_is_singleton_and_wired(test_settings) -> None:
    container = build_container(test_settings)

    assert container.email_template_service is container.email_template_service
    # El emisor SMTP del contenedor usa el mismo servicio de plantillas.
    assert container.email_sender._template_service is container.email_template_service  # type: ignore[attr-defined]
    assert container.email_template_service.templates_dir.is_dir()

    container.dispose()


# --------------------------------------------------------------------------
# Scheduler: usa la plantilla cuando el servicio está inyectado
# --------------------------------------------------------------------------
def _in_window() -> datetime:
    return _naive_utc(datetime.now(timezone.utc)) + timedelta(hours=2)


def _create_appointment(db: Database, *, tenant_id: uuid.UUID) -> Appointment:
    with db.session_scope() as session:
        return SqlAlchemyWorkflowRepository(session).create_appointment(
            tenant_id=tenant_id,
            service="Consulta inicial",
            starts_at=_in_window(),
            ends_at=_in_window() + timedelta(hours=1),
            timezone="America/Mexico_City",
            customer_name="Ana Pérez",
            customer_email=EMAIL,
            customer_phone=PHONE,
            status=AppointmentStatus.SCHEDULED,
            notes="Primera reunión",
        )


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
    scheduler = SchedulerService(
        database=database,
        repository_factory=lambda s: SqlAlchemyWorkflowRepository(s),
        audit_factory=lambda s: AuditService(
            repository=SqlAlchemyAuditRepository(s), logger=logger
        ),
        email_sender=email_sender,
        sms_sender=_FakeSmsSender(),
        logger=logger,
        reminder_hours=24,
        poll_interval_seconds=0.05,
        template_service=EmailTemplateService(
            templates_dir=TEMPLATES_DIR, logger=logger
        ),
    )
    env: dict[str, Any] = {
        "database": database,
        "scheduler": scheduler,
        "logger": logger,
        "email_sender": email_sender,
        "tenant_id": tenant_id,
    }
    yield env
    scheduler.stop()
    database.dispose()


def test_scheduler_renders_reminder_template_when_injected(
    scheduler_env: dict[str, Any],
) -> None:
    env = scheduler_env
    _create_appointment(env["database"], tenant_id=env["tenant_id"])

    result = env["scheduler"].process_due_reminders()

    assert result.reminders_sent == 2
    assert result.reminders_failed == 0
    assert len(env["email_sender"].calls) == 1
    html_body = env["email_sender"].calls[0]["html_body"]
    # La plantilla (no el HTML inline) fue usada para el recordatorio.
    assert "Recordatorio de tu cita" in html_body
    assert "Ana Pérez" in html_body
    assert "Consulta inicial" in html_body
    assert "America/Mexico_City" in html_body
