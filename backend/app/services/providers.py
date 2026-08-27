"""Proveedores de infraestructura externa para workflows.

Implementan los puertos de :mod:`app.services.workflow_interfaces` sin dependencias
de terceros fuera de ``httpx``:

- :class:`SandboxPaymentGateway` — pasarela de pago determinista (dev/tests).
- :class:`StripePaymentGateway` — REST real de Stripe (form-encoded, Bearer).
- :class:`PdfQuoteRenderer` — escritor PDF 1.4 puro Python (sin ``reportlab``).
- :class:`CalendarIcsProvider` — generador ICS (RFC 5545) puro Python.
- :class:`CrmWebhookSender` — notificación de prospectos vía HTTP (adaptadores
  CRM de la Fase 2 del backlog + reintentos con backoff exponencial).
- :class:`SmtpEmailSender` — correo SMTP con la stdlib (sin dependencias extra).
- :class:`TwilioSmsSender` — SMS vía la REST API de Twilio (form-encoded).
- :class:`WhatsAppCloudSender` — WhatsApp Cloud API (Meta) + firma de webhook.
- :class:`GoogleCalendarProvider` — OAuth 2.0 y eventos REST con respaldo ICS.

Regla CLAUDE: errores con contexto (``AppError``) y sin ``try/except`` vacíos.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import smtplib
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import httpx

from app.core.encryption import TokenCipher
from app.core.errors import ConfigValidationError, DependencyError
from app.core.logging import ILogger
from app.repositories.interfaces import IOAuthTokenStore, StoredOAuthToken
from app.schemas.workflow import AppointmentRead, LeadRead, QuoteRead
from app.services.crm_adapters import GenericWebhookAdapter
from app.services.crm_interfaces import ICrmAdapter
from app.services.email_template_service import EmailTemplateService
from app.services.workflow_interfaces import (
    CalendarEventResult,
    CheckoutSessionResult,
    EmailAttachment,
    ICalendarProvider,
    ICrmWebhookSender,
    IEmailSender,
    IGoogleCalendarProvider,
    IPaymentGateway,
    IQuoteRenderer,
    ISmsSender,
    IWhatsAppSender,
    QuoteDocumentResult,
)


# ---------------------------------------------------------------------------
# Utilidades del escritor PDF (PDF 1.4, objetos + tabla xref)
# ---------------------------------------------------------------------------


def _escape_pdf_text(value: str) -> str:
    """Escapa texto para un string PDF entre paréntesis (Latin-1)."""
    out: list[str] = []
    for char in value:
        if ord(char) > 0xFF:
            out.append("?")
        elif char in ("\\", "(", ")"):
            out.append("\\" + char)
        else:
            out.append(char)
    return "".join(out)


def _text_line(text: str, size: int, y: int) -> str:
    """Línea de texto PDF con coordenada absoluta ``x=72``."""
    return f"BT /F1 {size} Tf 72 {y} Td ({_escape_pdf_text(text)}) Tj ET"


def _build_quote_content(quote: QuoteRead) -> bytes:
    """Construye el stream de contenido (operadores de texto) de la cotización."""
    def money(minor: int) -> str:
        value = Decimal(minor) / Decimal("100")
        return f"{quote.currency.upper()} {value:.2f}"

    blocks: list[str] = []
    y = 740
    blocks.append(_text_line(f"Cotización #{quote.id.hex[:8].upper()}", 18, y))
    y -= 28
    blocks.append(_text_line(f"Cliente: {quote.customer_name}", 12, y))
    y -= 18
    if quote.customer_email:
        blocks.append(_text_line(f"Email: {quote.customer_email}", 12, y))
        y -= 18
    y -= 10
    for item in quote.services:
        name = str(item.get("name", ""))
        quantity = int(item.get("quantity", 1))
        unit = money(int(item.get("unit_price_minor", 0)))
        amount = money(int(item.get("unit_price_minor", 0)) * quantity)
        blocks.append(_text_line(f"- {name}  x{quantity}", 11, y))
        y -= 14
        blocks.append(_text_line(f"    {unit}  ->  {amount}", 11, y))
        y -= 18
    y -= 8
    blocks.append(_text_line(f"Subtotal: {money(quote.subtotal_minor)}", 11, y))
    y -= 16
    blocks.append(_text_line(f"Impuestos: {money(quote.tax_minor)}", 11, y))
    y -= 16
    blocks.append(_text_line(f"TOTAL: {money(quote.total_minor)}", 13, y))
    return "\n".join(blocks).encode("latin-1", "replace")


def _build_pdf_objects(content: bytes) -> list[bytes]:
    """Objetos PDF: catálogo, páginas, página, contenido y fuente Helvetica."""
    return [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ),
        (
            b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n"
            + content + b"\nendstream"
        ),
        (
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
            b"/Encoding /WinAnsiEncoding >>"
        ),
    ]


def _assemble_pdf(objects: list[bytes]) -> bytes:
    """Ensambla el PDF 1.4 con tabla xref y offsets de bytes correctos."""
    header = b"%PDF-1.4\n"
    body = bytearray()
    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(header) + len(body))
        body.extend(f"{index} 0 obj\n".encode("ascii"))
        body.extend(obj)
        body.extend(b"\nendobj\n")
    xref_offset = len(header) + len(body)
    count = len(objects) + 1
    xref = bytearray()
    xref.extend(f"xref\n0 {count}\n".encode("ascii"))
    xref.extend(b"0000000000 65535 f \n")
    for off in offsets:
        xref.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    trailer = (
        f"trailer\n<< /Size {count} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("ascii")
    return header + bytes(body) + bytes(xref) + trailer


class PdfQuoteRenderer(IQuoteRenderer):
    """Renderiza cotizaciones como PDF 1.4 válido en ``artifacts_dir``."""

    def __init__(self, *, artifacts_dir: str, base_url: str, logger: ILogger) -> None:
        self._artifacts_dir = Path(artifacts_dir)
        self._base_url = base_url.rstrip("/")
        self._logger = logger
        self._artifacts_dir.mkdir(parents=True, exist_ok=True)

    def render(self, *, quote: QuoteRead) -> QuoteDocumentResult:
        content = _build_quote_content(quote)
        objects = _build_pdf_objects(content)
        pdf_bytes = _assemble_pdf(objects)
        filename = f"quote-{quote.id}.pdf"
        (self._artifacts_dir / filename).write_bytes(pdf_bytes)
        self._logger.info(
            "workflow.quote.pdf_generated",
            message="PDF de cotización generado",
            quote_id=str(quote.id),
            filename=filename,
            bytes_size=len(pdf_bytes),
        )
        return QuoteDocumentResult(
            path=filename,
            url=f"{self._base_url}/{filename}",
            bytes_size=len(pdf_bytes),
        )


# ---------------------------------------------------------------------------
# Calendario ICS (RFC 5545)
# ---------------------------------------------------------------------------


def _format_utc(value: datetime) -> str:
    """Formatea una fecha como UTC en ``%Y%m%dT%H%M%SZ`` (RFC 5545)."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _escape_ics(value: str) -> str:
    """Escapa caracteres reservados de iCalendar (RFC 5545)."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


class CalendarIcsProvider(ICalendarProvider):
    """Genera invitaciones de calendario ICS (RFC 5545) en ``artifacts_dir``."""

    def __init__(self, *, artifacts_dir: str, base_url: str, logger: ILogger) -> None:
        self._artifacts_dir = Path(artifacts_dir)
        self._base_url = base_url.rstrip("/")
        self._logger = logger
        self._artifacts_dir.mkdir(parents=True, exist_ok=True)

    def create_event(self, *, appointment: AppointmentRead) -> CalendarEventResult:
        lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Omnibotia//Studio//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "BEGIN:VEVENT",
            f"UID:{appointment.id}@omnibotia",
            f"DTSTAMP:{_format_utc(datetime.now(timezone.utc))}",
            f"DTSTART:{_format_utc(appointment.starts_at)}",
            f"DTEND:{_format_utc(appointment.ends_at)}",
            f"SUMMARY:{_escape_ics(f'Cita: {appointment.service}')}",
        ]
        if appointment.notes:
            lines.append(f"DESCRIPTION:{_escape_ics(appointment.notes)}")
        lines.append("LOCATION:Virtual")
        lines.append("STATUS:CONFIRMED")
        if appointment.customer_email:
            lines.append(
                "ATTENDEE;CN="
                f"{_escape_ics(appointment.customer_name)}:mailto:{appointment.customer_email}"
            )
        lines.extend(["END:VEVENT", "END:VCALENDAR"])
        ics_bytes = ("\r\n".join(lines) + "\r\n").encode("utf-8")
        filename = f"appointment-{appointment.id}.ics"
        (self._artifacts_dir / filename).write_bytes(ics_bytes)
        self._logger.info(
            "workflow.appointment.ics_generated",
            message="Invitación ICS generada",
            appointment_id=str(appointment.id),
            filename=filename,
            bytes_size=len(ics_bytes),
        )
        return CalendarEventResult(
            path=filename,
            url=f"{self._base_url}/{filename}",
            bytes_size=len(ics_bytes),
        )


# ---------------------------------------------------------------------------
# Pasarela de pagos
# ---------------------------------------------------------------------------


class SandboxPaymentGateway(IPaymentGateway):
    """Pasarela sandbox determinista: no realiza cobros reales.

    La confirmación se hace vía ``POST /workflows/checkout/{id}/confirm``.
    """

    @property
    def provider_name(self) -> str:
        return "sandbox"

    def __init__(
        self,
        *,
        checkout_base_url: str = "http://localhost:8000/workflows/sandbox/",
        logger: ILogger,
    ) -> None:
        self._base_url = checkout_base_url.rstrip("/")
        self._logger = logger

    def create_checkout_session(
        self,
        *,
        amount_minor: int,
        currency: str,
        customer_email: str | None,
        customer_name: str | None,
        success_url: str | None,
        cancel_url: str | None,
        metadata: dict[str, object] | None,
    ) -> CheckoutSessionResult:
        session_id = f"sandbox_{uuid.uuid4().hex}"
        checkout_url = f"{self._base_url}/{session_id}"
        self._logger.info(
            "workflow.payment.sandbox_session",
            message="Sesión sandbox creada",
            session_id=session_id,
            amount_minor=amount_minor,
            currency=currency,
        )
        return CheckoutSessionResult(
            session_id=session_id,
            checkout_url=checkout_url,
            provider=self.provider_name,
        )

    def verify_webhook_signature(self, *, payload: bytes, signature: str | None) -> bool:
        # El sandbox no emite webhooks: la confirmación ocurre vía endpoint.
        return False


class StripePaymentGateway(IPaymentGateway):
    """Pasarela real de Stripe vía REST (form-encoded) con ``httpx``."""

    @property
    def provider_name(self) -> str:
        return "stripe"

    def __init__(
        self,
        *,
        secret_key: str,
        webhook_secret: str,
        checkout_success_url: str,
        checkout_cancel_url: str,
        base_url: str = "https://api.stripe.com/v1",
        timeout_seconds: float = 30.0,
        client: httpx.Client | None = None,
        logger: ILogger | None = None,
    ) -> None:
        if not secret_key:
            raise ConfigValidationError(
                message="STRIPE_SECRET_KEY no está configurada",
                operation="StripePaymentGateway.init",
                context={"payment_mode": "live"},
            )
        self._secret_key = secret_key
        self._webhook_secret = webhook_secret
        self._checkout_success_url = checkout_success_url
        self._checkout_cancel_url = checkout_cancel_url
        self._base_url = base_url.rstrip("/")
        self._timeout = httpx.Timeout(timeout_seconds)
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=self._timeout)
        self._logger = logger

    def create_checkout_session(
        self,
        *,
        amount_minor: int,
        currency: str,
        customer_email: str | None,
        customer_name: str | None,
        success_url: str | None,
        cancel_url: str | None,
        metadata: dict[str, object] | None,
    ) -> CheckoutSessionResult:
        data: dict[str, str] = {
            "mode": "payment",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": currency,
            "line_items[0][price_data][unit_amount]": str(amount_minor),
            "line_items[0][price_data][product_data][name]": (
                customer_name or "Pago OmniBotia"
            ),
            "success_url": success_url or self._checkout_success_url,
            "cancel_url": cancel_url or self._checkout_cancel_url,
        }
        if customer_email:
            data["customer_email"] = customer_email
        if metadata:
            for key, value in metadata.items():
                data[f"metadata[{key}]"] = str(value)
        try:
            response = self._client.post(
                f"{self._base_url}/checkout/sessions",
                data=data,
                auth=(self._secret_key, ""),
            )
        except httpx.HTTPError as exc:
            raise DependencyError(
                message="No se pudo contactar a la pasarela de Stripe",
                operation="StripePaymentGateway.create_checkout_session",
                context={"provider": "stripe"},
                cause=exc,
            ) from exc
        if response.status_code >= 400:
            raise DependencyError(
                message="La pasarela rechazó el checkout",
                operation="StripePaymentGateway.create_checkout_session",
                context={
                    "provider": "stripe",
                    "status_code": response.status_code,
                    "body": response.text[:300],
                },
            )
        payload = response.json()
        return CheckoutSessionResult(
            session_id=str(payload["id"]),
            checkout_url=str(payload["url"]),
            provider=self.provider_name,
        )

    def verify_webhook_signature(self, *, payload: bytes, signature: str | None) -> bool:
        if not self._webhook_secret or not signature:
            return False
        try:
            items = dict(item.split("=", 1) for item in signature.split(","))
            timestamp = items.get("t")
            provided = items.get("v1")
            if not timestamp or not provided:
                return False
            signed = f"{timestamp}.{payload.decode('utf-8')}"
            expected = hmac.new(
                self._webhook_secret.encode("utf-8"),
                signed.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(expected, provided)
        except (ValueError, UnicodeDecodeError):
            return False

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


# ---------------------------------------------------------------------------
# Webhook de CRM
# ---------------------------------------------------------------------------


class CrmWebhookSender(ICrmWebhookSender):
    """Notifica prospectos al CRM externo con adaptadores y reintentos con backoff.

    Delega el formato/autenticación en un :class:`ICrmAdapter` (Fase 2 del
    backlog) y orquesta el reintento exponencial: ante cada fallo (HTTP >= 400
    o error de red) espera ``retry_backoff_seconds * 2 ** (attempt - 1)`` antes
    del siguiente intento, hasta ``retry_max_attempts``.
    """

    def __init__(
        self,
        *,
        webhook_url: str = "",
        timeout_seconds: float = 5.0,
        logger: ILogger,
        client: httpx.Client | None = None,
        adapter: ICrmAdapter | None = None,
        retry_max_attempts: int = 3,
        retry_backoff_seconds: float = 0.5,
    ) -> None:
        self._adapter = adapter or GenericWebhookAdapter(
            endpoint_url=webhook_url,
            timeout_seconds=timeout_seconds,
            logger=logger,
            client=client,
        )
        self._logger = logger
        self._retry_max_attempts = max(1, retry_max_attempts)
        self._retry_backoff_seconds = retry_backoff_seconds

    def send_lead(self, *, lead: LeadRead) -> bool:
        if not self._adapter.is_configured():
            self._logger.debug(
                "workflow.lead.crm_skipped",
                message="CRM no configurado; prospecto no enviado",
                lead_id=str(lead.id),
                provider=self._adapter.provider_name,
            )
            return False
        for attempt in range(1, self._retry_max_attempts + 1):
            try:
                self._adapter.send_lead(lead=lead)
            except httpx.HTTPStatusError as exc:
                if self._handle_failure(
                    lead=lead,
                    attempt=attempt,
                    final_event="workflow.lead.crm_http_error",
                    message="El CRM respondió con error tras reintentos",
                    status_code=exc.response.status_code,
                ):
                    continue
                return False
            except httpx.HTTPError as exc:
                if self._handle_failure(
                    lead=lead,
                    attempt=attempt,
                    final_event="workflow.lead.crm_failed",
                    message="Fallo al notificar al CRM tras reintentos",
                    cause=str(exc),
                ):
                    continue
                return False
            self._logger.info(
                "workflow.lead.crm_sent",
                message="Prospecto notificado al CRM",
                lead_id=str(lead.id),
                provider=self._adapter.provider_name,
                attempt=attempt,
            )
            return True
        return False  # pragma: no cover - el bucle siempre retorna dentro

    def _handle_failure(
        self,
        *,
        lead: LeadRead,
        attempt: int,
        final_event: str,
        message: str,
        **fields: Any,
    ) -> bool:
        """Registra el fallo de un intento y devuelve True si hay que reintentar."""
        if attempt < self._retry_max_attempts:
            self._logger.warning(
                "workflow.lead.crm_retry",
                message="Fallo al notificar al CRM; reintentando",
                lead_id=str(lead.id),
                provider=self._adapter.provider_name,
                attempt=attempt,
                **fields,
            )
            time.sleep(self._retry_backoff_seconds * (2 ** (attempt - 1)))
            return True
        self._logger.warning(
            final_event,
            message=message,
            lead_id=str(lead.id),
            provider=self._adapter.provider_name,
            attempt=attempt,
            **fields,
        )
        return False

    def close(self) -> None:
        self._adapter.close()


# ---------------------------------------------------------------------------
# Correo SMTP (stdlib)
# ---------------------------------------------------------------------------


class SmtpEmailSender(IEmailSender):
    """Envía correos SMTP con la stdlib (``smtplib`` + ``EmailMessage``)."""

    def __init__(
        self,
        *,
        host: str = "",
        port: int = 587,
        username: str = "",
        password: str = "",
        from_email: str = "",
        use_tls: bool = True,
        timeout_seconds: float = 10.0,
        logger: ILogger,
        smtp_factory: Callable[..., smtplib.SMTP] | None = None,
        template_service: EmailTemplateService | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._from_email = from_email
        self._use_tls = use_tls
        self._timeout_seconds = timeout_seconds
        self._logger = logger
        self._smtp_factory = smtp_factory
        self._template_service = template_service

    def send_email(
        self,
        *,
        to_email: str,
        subject: str,
        html_body: str | None = None,
        template_name: str | None = None,
        template_context: dict[str, Any] | None = None,
        attachments: list[EmailAttachment] | None = None,
    ) -> bool:
        if not self._host or not self._from_email:
            self._logger.debug(
                "workflow.email.smtp_skipped",
                message="SMTP no configurado; correo no enviado",
                to_email=to_email,
            )
            return False
        if html_body is None:
            if template_name is None or self._template_service is None:
                if template_name is not None:
                    self._logger.warning(
                        "workflow.email.template_unavailable",
                        message="Plantilla solicitada sin servicio de plantillas",
                        template_name=template_name,
                        to_email=to_email,
                    )
                else:
                    self._logger.debug(
                        "workflow.email.body_missing",
                        message="Correo sin cuerpo HTML ni plantilla; omitido",
                        to_email=to_email,
                    )
                return False
            try:
                html_body = self._template_service.render(
                    template_name, context=template_context
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.email.template_failed",
                    message="Fallo al renderizar plantilla de email",
                    template_name=template_name,
                    to_email=to_email,
                    error=str(exc),
                )
                return False
        message = EmailMessage()
        message["From"] = self._from_email
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content("Este correo requiere un cliente con soporte HTML.")
        message.add_alternative(html_body, subtype="html")
        for attachment in attachments or []:
            message.add_attachment(
                attachment.content,
                maintype=attachment.maintype,
                subtype=attachment.subtype,
                filename=attachment.filename,
            )
        try:
            smtp = (
                self._smtp_factory(
                    host=self._host,
                    port=self._port,
                    timeout=self._timeout_seconds,
                )
                if self._smtp_factory
                else smtplib.SMTP(self._host, self._port, timeout=self._timeout_seconds)
            )
            with smtp:
                if self._use_tls:
                    smtp.starttls()
                if self._username:
                    smtp.login(self._username, self._password)
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException) as exc:
            self._logger.warning(
                "workflow.email.smtp_failed",
                message="Fallo al enviar correo SMTP",
                to_email=to_email,
                cause=str(exc),
            )
            return False
        self._logger.info(
            "workflow.email.smtp_sent",
            message="Correo SMTP enviado",
            to_email=to_email,
        )
        return True

    def close(self) -> None:
        return None


# ---------------------------------------------------------------------------
# SMS (Twilio)
# ---------------------------------------------------------------------------


class TwilioSmsSender(ISmsSender):
    """Envía SMS vía la REST API de Twilio (form-encoded + Basic Auth)."""

    _BASE_URL = "https://api.twilio.com/2010-04-01"

    def __init__(
        self,
        *,
        account_sid: str = "",
        auth_token: str = "",
        from_phone: str = "",
        timeout_seconds: float = 10.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        self._account_sid = account_sid
        self._auth_token = auth_token
        self._from_phone = from_phone
        self._timeout = httpx.Timeout(timeout_seconds)
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=self._timeout)
        self._logger = logger

    def send_sms(self, *, to_phone: str, message: str) -> bool:
        if not self._account_sid or not self._auth_token or not self._from_phone:
            self._logger.debug(
                "workflow.sms.twilio_skipped",
                message="Twilio no configurado; SMS no enviado",
                to_phone=to_phone,
            )
            return False
        url = f"{self._BASE_URL}/Accounts/{quote(self._account_sid)}/Messages.json"
        data = {"To": to_phone, "From": self._from_phone, "Body": message}
        try:
            response = self._client.post(
                url,
                data=data,
                auth=(self._account_sid, self._auth_token),
            )
        except httpx.HTTPError as exc:
            self._logger.warning(
                "workflow.sms.twilio_failed",
                message="Fallo al enviar SMS",
                to_phone=to_phone,
                cause=str(exc),
            )
            return False
        if response.status_code >= 400:
            self._logger.warning(
                "workflow.sms.twilio_http_error",
                message="Twilio respondió con error",
                to_phone=to_phone,
                status_code=response.status_code,
            )
            return False
        self._logger.info(
            "workflow.sms.twilio_sent",
            message="SMS enviado",
            to_phone=to_phone,
        )
        return True

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


# ---------------------------------------------------------------------------
# WhatsApp Cloud API (Meta)
# ---------------------------------------------------------------------------


class WhatsAppCloudSender(IWhatsAppSender):
    """Envía mensajes de plantilla vía la WhatsApp Cloud API (Meta)."""

    _BASE_URL = "https://graph.facebook.com/v21.0"

    def __init__(
        self,
        *,
        phone_number_id: str = "",
        access_token: str = "",
        webhook_secret: str = "",
        timeout_seconds: float = 10.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        self._phone_number_id = phone_number_id
        self._access_token = access_token
        self._webhook_secret = webhook_secret
        self._timeout = httpx.Timeout(timeout_seconds)
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=self._timeout)
        self._logger = logger

    def send_template_message(
        self,
        *,
        to_phone: str,
        template_name: str,
        template_variables: dict[str, str],
    ) -> bool:
        if not self._access_token or not self._phone_number_id:
            self._logger.debug(
                "workflow.whatsapp.skipped",
                message="WhatsApp Cloud no configurado; mensaje no enviado",
                to_phone=to_phone,
            )
            return False
        url = f"{self._BASE_URL}/{quote(self._phone_number_id)}/messages"
        components = [
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "text": value}
                    for value in template_variables.values()
                ],
            }
        ]
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": "es"},
                "components": components,
            },
        }
        headers = {"Authorization": f"Bearer {self._access_token}"}
        try:
            response = self._client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            self._logger.warning(
                "workflow.whatsapp.failed",
                message="Fallo al enviar WhatsApp",
                to_phone=to_phone,
                cause=str(exc),
            )
            return False
        if response.status_code >= 400:
            self._logger.warning(
                "workflow.whatsapp.http_error",
                message="WhatsApp Cloud respondió con error",
                to_phone=to_phone,
                status_code=response.status_code,
            )
            return False
        self._logger.info(
            "workflow.whatsapp.sent",
            message="Mensaje de WhatsApp enviado",
            to_phone=to_phone,
            template_name=template_name,
        )
        return True

    def verify_webhook_signature(
        self, *, payload: bytes, signature: str | None
    ) -> bool:
        if not self._webhook_secret or not signature:
            return False
        expected = "sha256=" + hmac.new(
            self._webhook_secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


# ---------------------------------------------------------------------------
# Google Calendar (OAuth 2.0 + REST) con respaldo ICS local
# ---------------------------------------------------------------------------


def encode_oauth_state(tenant_id: uuid.UUID) -> str:
    """Codifica el tenant en el parámetro ``state`` de OAuth (base64url)."""
    return base64.urlsafe_b64encode(str(tenant_id).encode("utf-8")).decode("ascii")


def decode_oauth_state(state: str) -> uuid.UUID | None:
    """Decodifica el tenant del parámetro ``state``; ``None`` si es inválido."""
    try:
        raw = base64.urlsafe_b64decode(state.encode("ascii"))
        return uuid.UUID(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


class GoogleCalendarProvider(IGoogleCalendarProvider):
    """Google Calendar (OAuth 2.0 + REST) con respaldo ICS local.

    Fase 3: cuando se inyectan ``token_store`` + ``cipher``, los tokens se
    persisten cifrados por tenant y se auto-refrescan en ``create_calendar_event``.
    Sin ``token_store`` el proveedor funciona igual que antes (solo en memoria).
    """

    _TOKEN_URL = "https://oauth2.googleapis.com/token"
    _AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    _EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    _SCOPE = "https://www.googleapis.com/auth/calendar.events"
    _PROVIDER = "google_calendar"

    def __init__(
        self,
        *,
        client_id: str = "",
        client_secret: str = "",
        redirect_uri: str = "",
        timeout_seconds: float = 30.0,
        logger: ILogger,
        ics_provider: ICalendarProvider,
        client: httpx.Client | None = None,
        token_store: IOAuthTokenStore | None = None,
        cipher: TokenCipher | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._timeout = httpx.Timeout(timeout_seconds)
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=self._timeout)
        self._logger = logger
        self._ics_provider = ics_provider
        self._token_store = token_store
        self._cipher = cipher
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expires_at: datetime | None = None

    @property
    def is_configured(self) -> bool:
        return bool(self._client_id and self._client_secret and self._redirect_uri)

    @property
    def is_authenticated(self) -> bool:
        return bool(self._access_token)

    @property
    def _is_expired(self) -> bool:
        """True cuando el token vigente venció (sin expiración = válido)."""
        if self._expires_at is None:
            return False
        expires_at = self._expires_at
        if expires_at.tzinfo is None:
            # SQLite no preserva la zona horaria; el valor se almacena como UTC.
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at <= datetime.now(timezone.utc)

    @property
    def authorization_url(self) -> str | None:
        return self.authorization_url_for()

    def authorization_url_for(
        self, *, tenant_id: uuid.UUID | None = None
    ) -> str | None:
        """URL de consentimiento; embebe el tenant en ``state`` cuando se da."""
        if not self.is_configured:
            return None
        params = (
            f"client_id={quote(self._client_id)}"
            f"&redirect_uri={quote(self._redirect_uri)}"
            f"&response_type=code&scope={quote(self._SCOPE)}"
            "&access_type=offline&prompt=consent"
        )
        if tenant_id is not None:
            params += f"&state={quote(encode_oauth_state(tenant_id))}"
        return f"{self._AUTH_URL}?{params}"

    def authenticate(
        self, *, auth_code: str, tenant_id: uuid.UUID | None = None
    ) -> bool:
        if not self.is_configured:
            self._logger.debug(
                "workflow.google.auth_skipped",
                message="Google Calendar no configurado; autenticación omitida",
            )
            return False
        data = {
            "code": auth_code,
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "redirect_uri": self._redirect_uri,
            "grant_type": "authorization_code",
        }
        try:
            response = self._client.post(self._TOKEN_URL, data=data)
        except httpx.HTTPError as exc:
            self._logger.warning(
                "workflow.google.auth_failed",
                message="Fallo al intercambiar el código de Google",
                cause=str(exc),
            )
            return False
        if response.status_code >= 400:
            self._logger.warning(
                "workflow.google.auth_http_error",
                message="Google respondió con error en el intercambio",
                status_code=response.status_code,
            )
            return False
        token = response.json()
        self._access_token = token.get("access_token")
        self._refresh_token = token.get("refresh_token")
        expires_in = token.get("expires_in")
        self._expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=float(expires_in))
            if expires_in is not None
            else None
        )
        if tenant_id is not None:
            self._store_token(
                tenant_id=tenant_id,
                access_token=self._access_token or "",
                refresh_token=self._refresh_token or "",
                expires_at=self._expires_at,
            )
        self._logger.info(
            "workflow.google.auth_success",
            message="Google Calendar autenticado",
        )
        return bool(self._access_token)

    def _store_token(
        self,
        *,
        tenant_id: uuid.UUID,
        access_token: str,
        refresh_token: str,
        expires_at: datetime | None,
    ) -> None:
        """Persiste los tokens cifrados (no-op sin ``token_store``/``cipher``)."""
        if self._token_store is None or self._cipher is None:
            return
        self._token_store.save(
            tenant_id=tenant_id,
            provider=self._PROVIDER,
            encrypted_access_token=self._cipher.encrypt(access_token),
            encrypted_refresh_token=self._cipher.encrypt(refresh_token),
            expires_at=expires_at,
        )

    def _load_token(self, *, tenant_id: uuid.UUID) -> StoredOAuthToken | None:
        """Carga y descifra el token del tenant; fija el estado en memoria."""
        if self._token_store is None or self._cipher is None:
            return None
        stored = self._token_store.load(
            tenant_id=tenant_id, provider=self._PROVIDER
        )
        if stored is None:
            return None
        try:
            self._access_token = self._cipher.decrypt(
                stored.encrypted_access_token
            )
            refresh = self._cipher.decrypt(stored.encrypted_refresh_token)
        except ConfigValidationError as exc:
            self._logger.warning(
                "workflow.google.token_load_failed",
                message="No se pudo descifrar el token almacenado",
                cause=str(exc),
            )
            return None
        self._refresh_token = refresh or None
        self._expires_at = stored.expires_at
        return stored

    def _refresh(self, *, refresh_token: str) -> bool:
        """Intercambia el refresh token por un access token nuevo."""
        if not self.is_configured or not refresh_token:
            return False
        data = {
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        try:
            response = self._client.post(self._TOKEN_URL, data=data)
        except httpx.HTTPError as exc:
            self._logger.warning(
                "workflow.google.refresh_failed",
                message="Fallo al renovar el token de Google",
                cause=str(exc),
            )
            return False
        if response.status_code >= 400:
            self._logger.warning(
                "workflow.google.refresh_http_error",
                message="Google respondió con error al renovar el token",
                status_code=response.status_code,
            )
            return False
        token = response.json()
        new_access = token.get("access_token")
        if not new_access:
            return False
        self._access_token = new_access
        expires_in = token.get("expires_in")
        self._expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=float(expires_in))
            if expires_in is not None
            else None
        )
        return True

    def _ensure_authenticated(self, *, tenant_id: uuid.UUID) -> None:
        """Carga el token persistido y lo refresca si venció (no-op sin store)."""
        if self._token_store is None or self._cipher is None:
            return
        if self._access_token and not self._is_expired:
            return
        stored = self._load_token(tenant_id=tenant_id)
        if stored is None:
            return
        if self._is_expired and self._refresh_token:
            if self._refresh(refresh_token=self._refresh_token):
                self._store_token(
                    tenant_id=tenant_id,
                    access_token=self._access_token or "",
                    refresh_token=self._refresh_token,
                    expires_at=self._expires_at,
                )

    def create_event(self, *, appointment: AppointmentRead) -> CalendarEventResult:
        return self._ics_provider.create_event(appointment=appointment)

    def create_calendar_event(
        self, *, appointment: AppointmentRead
    ) -> str | None:
        if appointment.tenant_id is not None:
            self._ensure_authenticated(tenant_id=appointment.tenant_id)
        if not self.is_authenticated:
            self._logger.debug(
                "workflow.google.event_skipped",
                message="Google Calendar no autenticado; evento real no creado",
            )
            return None
        payload = {
            "summary": appointment.service,
            "description": appointment.notes or "",
            "start": {"dateTime": appointment.starts_at.isoformat()},
            "end": {"dateTime": appointment.ends_at.isoformat()},
        }
        headers = {"Authorization": f"Bearer {self._access_token}"}
        try:
            response = self._client.post(
                self._EVENTS_URL, json=payload, headers=headers
            )
        except httpx.HTTPError as exc:
            self._logger.warning(
                "workflow.google.event_failed",
                message="Fallo al crear el evento en Google Calendar",
                cause=str(exc),
            )
            return None
        if response.status_code >= 400:
            self._logger.warning(
                "workflow.google.event_http_error",
                message="Google Calendar respondió con error",
                status_code=response.status_code,
            )
            return None
        event_id = response.json().get("id")
        self._logger.info(
            "workflow.google.event_created",
            message="Evento creado en Google Calendar",
            event_id=event_id,
        )
        return event_id

    def close(self) -> None:
        if self._owns_client:
            self._client.close()
