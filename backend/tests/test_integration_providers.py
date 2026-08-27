"""Pruebas de los proveedores de integración externa (FASE 4).

Cubre los cuatro proveedores reales sin dependencias de terceros (solo
``httpx`` + stdlib) implementados en :mod:`app.services.providers`:

- :class:`SmtpEmailSender` — correo SMTP (``smtplib``) con fábrica inyectable.
- :class:`TwilioSmsSender` — SMS vía REST de Twilio (form-encoded + Basic Auth).
- :class:`WhatsAppCloudSender` — WhatsApp Cloud API (Meta) + firma de webhook.
- :class:`GoogleCalendarProvider` — OAuth 2.0 + eventos REST con respaldo ICS.

Contrato (regla CLAUDE): sin red real en los tests — se inyectan clientes HTTP
falsos y una fábrica SMTP falsa; configuración vacía = no-op seguro (``False``).
"""

from __future__ import annotations

import hashlib
import hmac
import smtplib
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.logging import ILogger
from app.schemas.workflow import AppointmentRead
from app.services.providers import (
    GoogleCalendarProvider,
    SmtpEmailSender,
    TwilioSmsSender,
    WhatsAppCloudSender,
)
from app.services.workflow_interfaces import (
    CalendarEventResult,
    EmailAttachment,
    ICalendarProvider,
)


class _RecordingLogger(ILogger):
    """Logger de prueba que solo acumula eventos (sin E/S)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

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


class _FakeResponse:
    """Respuesta HTTP falsa con la superficie que usan los proveedores."""

    def __init__(self, payload: Any = None, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self._payload


class _FakeClient:
    """Cliente httpx falso con la superficie común de todos los proveedores.

    Soporta ``post(url, *, headers, json, data, auth)`` y registra cada llamada.
    """

    def __init__(
        self,
        response: _FakeResponse | None = None,
        *,
        error: httpx.HTTPError | None = None,
        responses: list[_FakeResponse] | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self._responses = list(responses or [])
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        auth: tuple[str, str] | None = None,
    ) -> _FakeResponse:
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "data": data, "auth": auth}
        )
        if self._error is not None:
            raise self._error
        if self._responses:
            return self._responses.pop(0)
        assert self._response is not None
        return self._response

    def close(self) -> None:
        self.closed = True


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
    """Devuelve una fábrica compatible con el parámetro ``smtp_factory``."""

    def factory(*, host: str = "", port: int = 0, timeout: float = 0.0) -> _FakeSmtp:
        smtp.host = host
        smtp.port = port
        smtp.timeout = timeout
        return smtp

    return factory


class _FakeIcsProvider(ICalendarProvider):
    """Proveedor ICS falso que registra llamadas (respaldo local de Google)."""

    def __init__(self) -> None:
        self.calls: list[AppointmentRead] = []

    def create_event(self, *, appointment: AppointmentRead) -> CalendarEventResult:
        self.calls.append(appointment)
        return CalendarEventResult(
            url="http://test/event.ics",
            path="artifacts/event.ics",
            bytes_size=42,
        )


def _appointment() -> AppointmentRead:
    """Cita válida para los proveedores de calendario."""
    return AppointmentRead(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        service="Consulta dental",
        starts_at=datetime(2026, 9, 1, 15, 0, tzinfo=timezone.utc),
        ends_at=datetime(2026, 9, 1, 16, 0, tzinfo=timezone.utc),
        timezone="UTC",
        customer_name="Ana Pérez",
        customer_email="ana@example.com",
        customer_phone="+5215500000000",
        status="scheduled",
        notes="Primera consulta",
        ics_path=None,
        created_at=datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc),
        revision=1,
        updated_at=datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc),
    )


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
    }
    params.update(overrides)
    return SmtpEmailSender(**params)


def _make_twilio(**overrides: Any) -> TwilioSmsSender:
    params: dict[str, Any] = {
        "account_sid": "AC123",
        "auth_token": "token",
        "from_phone": "+15000000000",
        "timeout_seconds": 5.0,
        "logger": _RecordingLogger(),
        "client": None,
    }
    params.update(overrides)
    return TwilioSmsSender(**params)


def _make_whatsapp(**overrides: Any) -> WhatsAppCloudSender:
    params: dict[str, Any] = {
        "phone_number_id": "123456789",
        "access_token": "EAAtoken",
        "webhook_secret": "secret",
        "timeout_seconds": 5.0,
        "logger": _RecordingLogger(),
        "client": None,
    }
    params.update(overrides)
    return WhatsAppCloudSender(**params)


def _make_google(**overrides: Any) -> GoogleCalendarProvider:
    params: dict[str, Any] = {
        "client_id": "client.apps.googleusercontent.com",
        "client_secret": "client-secret",
        "redirect_uri": "http://localhost:5173/auth/google/callback",
        "timeout_seconds": 5.0,
        "logger": _RecordingLogger(),
        "ics_provider": _FakeIcsProvider(),
        "client": None,
    }
    params.update(overrides)
    return GoogleCalendarProvider(**params)


# ── SMTP ─────────────────────────────────────────────────────────────────────


def test_smtp_disabled_returns_false() -> None:
    logger = _RecordingLogger()
    sender = _make_smtp(host="", from_email="", logger=logger)
    assert (
        sender.send_email(
            to_email="ana@example.com", subject="Hola", html_body="<p>Hola</p>"
        )
        is False
    )
    assert any(event == "workflow.email.smtp_skipped" for event, _, _ in logger.events)


def test_smtp_sends_email_success() -> None:
    smtp = _FakeSmtp()
    sender = _make_smtp(smtp_factory=_smtp_factory(smtp))
    result = sender.send_email(
        to_email="ana@example.com", subject="Hola", html_body="<p>Hola</p>"
    )
    assert result is True
    assert smtp.starttls_called is True
    assert smtp.login_called is True
    assert len(smtp.sent_messages) == 1
    message = smtp.sent_messages[0]
    assert message["To"] == "ana@example.com"
    assert message["Subject"] == "Hola"
    assert message["From"] == "no-reply@example.com"


def test_smtp_sends_email_with_attachment() -> None:
    smtp = _FakeSmtp()
    sender = _make_smtp(smtp_factory=_smtp_factory(smtp))
    attachment = EmailAttachment(
        filename="quote.pdf", content=b"%PDF-1.4", maintype="application", subtype="pdf"
    )
    result = sender.send_email(
        to_email="ana@example.com",
        subject="Cotización",
        html_body="<p>PDF adjunto</p>",
        attachments=[attachment],
    )
    assert result is True
    payload = smtp.sent_messages[0].as_string()
    assert "quote.pdf" in payload
    assert "application/pdf" in payload


def test_smtp_failure_returns_false() -> None:
    logger = _RecordingLogger()
    smtp = _FakeSmtp(fail_with=smtplib.SMTPException("boom"))
    sender = _make_smtp(logger=logger, smtp_factory=_smtp_factory(smtp))
    assert (
        sender.send_email(
            to_email="ana@example.com", subject="Hola", html_body="<p>Hola</p>"
        )
        is False
    )
    assert any(event == "workflow.email.smtp_failed" for event, _, _ in logger.events)


# ── Twilio SMS ───────────────────────────────────────────────────────────────


def test_twilio_disabled_returns_false() -> None:
    logger = _RecordingLogger()
    sender = _make_twilio(account_sid="", auth_token="", from_phone="", logger=logger)
    assert sender.send_sms(to_phone="+5215500000000", message="Hola") is False
    assert any(event == "workflow.sms.twilio_skipped" for event, _, _ in logger.events)


def test_twilio_sends_sms_success() -> None:
    fake = _FakeClient(_FakeResponse({}, 200))
    sender = _make_twilio(client=fake)
    result = sender.send_sms(to_phone="+5215500000000", message="Hola")
    assert result is True
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert (
        call["url"]
        == "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json"
    )
    assert call["data"] == {
        "To": "+5215500000000",
        "From": "+15000000000",
        "Body": "Hola",
    }
    assert call["auth"] == ("AC123", "token")


def test_twilio_http_error_returns_false() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(_FakeResponse({"message": "error"}, 400))
    sender = _make_twilio(logger=logger, client=fake)
    assert sender.send_sms(to_phone="+5215500000000", message="Hola") is False
    assert any(
        event == "workflow.sms.twilio_http_error" for event, _, _ in logger.events
    )


def test_twilio_network_error_returns_false() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(error=httpx.ConnectError("no route to host"))
    sender = _make_twilio(logger=logger, client=fake)
    assert sender.send_sms(to_phone="+5215500000000", message="Hola") is False
    assert any(event == "workflow.sms.twilio_failed" for event, _, _ in logger.events)


# ── WhatsApp Cloud API ───────────────────────────────────────────────────────


def test_whatsapp_disabled_returns_false() -> None:
    logger = _RecordingLogger()
    sender = _make_whatsapp(
        phone_number_id="", access_token="", logger=logger
    )
    assert (
        sender.send_template_message(
            to_phone="+5215500000000",
            template_name="lead_notificacion",
            template_variables={"name": "Ana"},
        )
        is False
    )
    assert any(event == "workflow.whatsapp.skipped" for event, _, _ in logger.events)


def test_whatsapp_sends_template_success() -> None:
    fake = _FakeClient(_FakeResponse({"messages": [{"id": "wamid.1"}]}, 200))
    sender = _make_whatsapp(client=fake)
    result = sender.send_template_message(
        to_phone="+5215500000000",
        template_name="lead_notificacion",
        template_variables={"name": "Ana"},
    )
    assert result is True
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["url"] == "https://graph.facebook.com/v21.0/123456789/messages"
    assert call["headers"] == {"Authorization": "Bearer EAAtoken"}
    payload = call["json"]
    assert payload["messaging_product"] == "whatsapp"
    assert payload["to"] == "+5215500000000"
    assert payload["type"] == "template"
    assert payload["template"]["name"] == "lead_notificacion"
    assert payload["template"]["language"] == {"code": "es"}
    assert payload["template"]["components"][0]["parameters"] == [
        {"type": "text", "text": "Ana"}
    ]


def test_whatsapp_http_error_returns_false() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(_FakeResponse({"error": {"message": "invalid"}}, 400))
    sender = _make_whatsapp(logger=logger, client=fake)
    assert (
        sender.send_template_message(
            to_phone="+5215500000000",
            template_name="lead_notificacion",
            template_variables={"name": "Ana"},
        )
        is False
    )
    assert any(
        event == "workflow.whatsapp.http_error" for event, _, _ in logger.events
    )


def test_whatsapp_network_error_returns_false() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(error=httpx.ConnectError("timeout"))
    sender = _make_whatsapp(logger=logger, client=fake)
    assert (
        sender.send_template_message(
            to_phone="+5215500000000",
            template_name="lead_notificacion",
            template_variables={"name": "Ana"},
        )
        is False
    )
    assert any(event == "workflow.whatsapp.failed" for event, _, _ in logger.events)


def test_whatsapp_verify_webhook_signature_valid() -> None:
    payload = b'{"object":"whatsapp_business_account"}'
    secret = "clave-secreta"
    signature = "sha256=" + hmac.new(
        secret.encode("utf-8"), payload, hashlib.sha256
    ).hexdigest()
    sender = _make_whatsapp(webhook_secret=secret)
    assert sender.verify_webhook_signature(payload=payload, signature=signature) is True


def test_whatsapp_verify_webhook_signature_invalid() -> None:
    sender = _make_whatsapp(webhook_secret="clave-secreta")
    assert (
        sender.verify_webhook_signature(
            payload=b'{"object":"whatsapp_business_account"}',
            signature="sha256=deadbeef",
        )
        is False
    )


def test_whatsapp_verify_webhook_signature_without_secret_or_signature() -> None:
    sender = _make_whatsapp(webhook_secret="")
    payload = b'{"object":"whatsapp_business_account"}'
    signature = "sha256=" + hmac.new(
        b"clave-secreta", payload, hashlib.sha256
    ).hexdigest()
    assert (
        sender.verify_webhook_signature(payload=payload, signature=signature) is False
    )
    assert sender.verify_webhook_signature(payload=payload, signature=None) is False


# ── Google Calendar ──────────────────────────────────────────────────────────


def test_google_disabled_authorization_url_none() -> None:
    provider = _make_google(client_id="", client_secret="", redirect_uri="")
    assert provider.is_configured is False
    assert provider.authorization_url is None
    assert provider.authenticate(auth_code="code") is False


def test_google_authorization_url_configured() -> None:
    provider = _make_google()
    assert provider.is_configured is True
    url = provider.authorization_url
    assert url is not None
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=client.apps.googleusercontent.com" in url
    assert "access_type=offline" in url


def test_google_authenticate_success() -> None:
    fake = _FakeClient(_FakeResponse({"access_token": "ya29.token"}, 200))
    provider = _make_google(client=fake)
    assert provider.is_authenticated is False
    assert provider.authenticate(auth_code="code123") is True
    assert provider.is_authenticated is True
    call = fake.calls[0]
    assert call["url"] == "https://oauth2.googleapis.com/token"
    assert call["data"] == {
        "code": "code123",
        "client_id": "client.apps.googleusercontent.com",
        "client_secret": "client-secret",
        "redirect_uri": "http://localhost:5173/auth/google/callback",
        "grant_type": "authorization_code",
    }


def test_google_authenticate_http_error_returns_false() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(_FakeResponse({"error": "invalid_grant"}, 400))
    provider = _make_google(logger=logger, client=fake)
    assert provider.authenticate(auth_code="bad") is False
    assert provider.is_authenticated is False
    assert any(
        event == "workflow.google.auth_http_error" for event, _, _ in logger.events
    )


def test_google_authenticate_network_error_returns_false() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(error=httpx.ConnectError("connection refused"))
    provider = _make_google(logger=logger, client=fake)
    assert provider.authenticate(auth_code="code") is False
    assert any(
        event == "workflow.google.auth_failed" for event, _, _ in logger.events
    )


def test_google_create_event_delegates_to_ics_provider() -> None:
    ics = _FakeIcsProvider()
    provider = _make_google(ics_provider=ics)
    result = provider.create_event(appointment=_appointment())
    assert result.url == "http://test/event.ics"
    assert result.path == "artifacts/event.ics"
    assert len(ics.calls) == 1


def test_google_create_calendar_event_unauthenticated_returns_none() -> None:
    logger = _RecordingLogger()
    provider = _make_google(logger=logger)
    assert provider.create_calendar_event(appointment=_appointment()) is None
    assert any(
        event == "workflow.google.event_skipped" for event, _, _ in logger.events
    )


def test_google_create_calendar_event_success() -> None:
    fake = _FakeClient(
        responses=[
            _FakeResponse({"access_token": "ya29.token"}, 200),
            _FakeResponse({"id": "evt_123"}, 200),
        ]
    )
    provider = _make_google(client=fake)
    assert provider.authenticate(auth_code="code") is True
    event_id = provider.create_calendar_event(appointment=_appointment())
    assert event_id == "evt_123"
    call = fake.calls[1]
    assert call["url"] == "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    assert call["headers"] == {"Authorization": "Bearer ya29.token"}
    assert call["json"]["summary"] == "Consulta dental"
    assert call["json"]["description"] == "Primera consulta"


def test_google_create_calendar_event_http_error_returns_none() -> None:
    logger = _RecordingLogger()
    fake = _FakeClient(
        responses=[
            _FakeResponse({"access_token": "ya29.token"}, 200),
            _FakeResponse({"error": "quota"}, 429),
        ]
    )
    provider = _make_google(logger=logger, client=fake)
    assert provider.authenticate(auth_code="code") is True
    assert provider.create_calendar_event(appointment=_appointment()) is None
    assert any(
        event == "workflow.google.event_http_error" for event, _, _ in logger.events
    )


# ── Ciclo de vida (close) ────────────────────────────────────────────────────


def test_close_does_not_close_injected_clients() -> None:
    fake = _FakeClient(_FakeResponse({}, 200))
    twilio = _make_twilio(client=fake)
    twilio.close()
    assert fake.closed is False

    whatsapp = _make_whatsapp(client=fake)
    whatsapp.close()
    assert fake.closed is False

    google = _make_google(client=fake)
    google.close()
    assert fake.closed is False
