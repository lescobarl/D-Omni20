"""Servicio de dominio de workflows (checkout, leads, cotizaciones y citas).

Caso de uso de conversión multi-tenant. Convierte montos a minor units, delega
la infraestructura externa a los puertos (pasarela, PDF, ICS, CRM) y registra
auditoría + logs estructurados (regla CLAUDE). Nunca usa ``new`` para
infraestructura: todo llega por inyección.
"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from app.core.errors import InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.models.workflow import (
    AppointmentStatus,
    LeadStatus,
    PaymentStatus,
    QuoteStatus,
)
from app.repositories.workflow_interfaces import IWorkflowRepository
from app.schemas.common import Page
from app.schemas.workflow import (
    AppointmentRead,
    AppointmentRequest,
    AppointmentResponse,
    CheckoutRequest,
    CheckoutResponse,
    LeadRead,
    LeadRequest,
    PaymentRead,
    QuoteRead,
    QuoteRequest,
    QuoteResponse,
)
from app.services.interfaces import IAuditService
from app.services.workflow_interfaces import (
    EmailAttachment,
    ICalendarProvider,
    ICrmWebhookSender,
    IEmailSender,
    IPaymentGateway,
    IQuoteRenderer,
    ISmsSender,
    IWhatsAppSender,
    IWorkflowService,
)

_HUNDRED = Decimal("100")
_TAX_BASE = Decimal("10000")
_FRACTION = Decimal("0.01")


def to_minor(value: Decimal) -> int:
    """Convierte unidades mayores a minor units (redondeo mitad hacia arriba)."""
    return int((value * _HUNDRED).to_integral_value(rounding=ROUND_HALF_UP))


def from_minor(value: int) -> Decimal:
    """Convierte minor units a unidades mayores (2 decimales)."""
    return (Decimal(value) / _HUNDRED).quantize(_FRACTION)


class WorkflowService(IWorkflowService):
    """Implementación del caso de uso de workflows (regla CLAUDE: DI)."""

    def __init__(
        self,
        *,
        repository: IWorkflowRepository,
        audit: IAuditService,
        logger: ILogger,
        payment_gateway: IPaymentGateway,
        quote_renderer: IQuoteRenderer,
        calendar_provider: ICalendarProvider,
        crm_webhook_sender: ICrmWebhookSender,
        email_sender: IEmailSender | None = None,
        sms_sender: ISmsSender | None = None,
        whatsapp_sender: IWhatsAppSender | None = None,
        artifacts_dir: str = "artifacts",
    ) -> None:
        self._repository = repository
        self._audit = audit
        self._logger = logger
        self._payment_gateway = payment_gateway
        self._quote_renderer = quote_renderer
        self._calendar_provider = calendar_provider
        self._crm_webhook_sender = crm_webhook_sender
        self._email_sender = email_sender
        self._sms_sender = sms_sender
        self._whatsapp_sender = whatsapp_sender
        self._artifacts_dir = Path(artifacts_dir)

    # ── Checkout / pagos ───────────────────────────────────────────────────
    def create_checkout(
        self, *, tenant_id: uuid.UUID, data: CheckoutRequest
    ) -> CheckoutResponse:
        amount_minor = to_minor(data.amount)
        metadata = dict(data.metadata)
        metadata["tenant_id"] = str(tenant_id)
        session = self._payment_gateway.create_checkout_session(
            amount_minor=amount_minor,
            currency=data.currency,
            customer_email=data.customer_email,
            customer_name=data.customer_name,
            success_url=data.success_url,
            cancel_url=data.cancel_url,
            metadata=metadata,
        )
        payment = self._repository.create_payment(
            tenant_id=tenant_id,
            amount_minor=amount_minor,
            currency=data.currency,
            status=PaymentStatus.REQUIRES_CONFIRMATION,
            provider=session.provider,
            provider_session_id=session.session_id,
            customer_email=data.customer_email,
            customer_name=data.customer_name,
            metadata=data.metadata,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.checkout.create",
            entity_type="workflow_payment",
            entity_id=str(payment.id),
            details={
                "provider": session.provider,
                "amount_minor": amount_minor,
                "currency": data.currency,
            },
        )
        self._logger.info(
            "workflow.checkout.created",
            message="Checkout iniciado",
            payment_id=str(payment.id),
            tenant_id=str(tenant_id),
            provider=session.provider,
            amount_minor=amount_minor,
        )
        return CheckoutResponse(
            payment_id=payment.id,
            status=payment.status,
            checkout_url=session.checkout_url,
            provider=session.provider,
        )

    def confirm_checkout(
        self, *, tenant_id: uuid.UUID, payment_id: uuid.UUID
    ) -> PaymentRead:
        payment = self._repository.get_payment(
            tenant_id=tenant_id, payment_id=payment_id
        )
        if payment is None:
            raise NotFoundError(
                "Pago no encontrado",
                operation="workflow.checkout.confirm",
                context={
                    "tenant_id": str(tenant_id),
                    "payment_id": str(payment_id),
                },
            )
        if payment.status in (
            PaymentStatus.SUCCEEDED,
            PaymentStatus.FAILED,
            PaymentStatus.CANCELED,
        ):
            # Idempotente: los estados terminales no se re-procesan.
            return PaymentRead.model_validate(payment)
        if payment.provider != "sandbox":
            self._logger.info(
                "workflow.checkout.confirm_deferred",
                message="Confirmación delegada a la pasarela (webhook)",
                payment_id=str(payment.id),
                provider=payment.provider,
            )
            return PaymentRead.model_validate(payment)
        updated = self._repository.update_payment(
            tenant_id=tenant_id,
            payment_id=payment_id,
            fields={"status": PaymentStatus.SUCCEEDED},
        )
        if updated is None:
            raise NotFoundError(
                "Pago no encontrado",
                operation="workflow.checkout.confirm",
                context={
                    "tenant_id": str(tenant_id),
                    "payment_id": str(payment_id),
                },
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.checkout.confirm",
            entity_type="workflow_payment",
            entity_id=str(updated.id),
            details={"status": PaymentStatus.SUCCEEDED, "provider": "sandbox"},
        )
        self._logger.info(
            "workflow.checkout.confirmed",
            message="Pago confirmado (sandbox)",
            payment_id=str(updated.id),
            tenant_id=str(tenant_id),
        )
        return PaymentRead.model_validate(updated)

    def handle_checkout_webhook(
        self, *, tenant_id: uuid.UUID, payload: bytes, signature: str | None
    ) -> PaymentRead | None:
        if not self._payment_gateway.verify_webhook_signature(
            payload=payload, signature=signature
        ):
            raise InputValidationError(
                "Firma de webhook inválida",
                operation="workflow.checkout.webhook",
                context={"tenant_id": str(tenant_id)},
            )
        try:
            body = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise InputValidationError(
                "Payload de webhook inválido",
                operation="workflow.checkout.webhook",
                context={"tenant_id": str(tenant_id)},
                cause=exc,
            ) from exc
        if body.get("type") != "checkout.session.completed":
            self._logger.info(
                "workflow.checkout.webhook_ignored",
                message="Webhook de tipo no relevante ignorado",
                event_type=body.get("type"),
            )
            return None
        data_object = body.get("data", {}).get("object", {})
        session_id = data_object.get("id")
        if not session_id:
            raise InputValidationError(
                "Webhook sin id de sesión",
                operation="workflow.checkout.webhook",
                context={"tenant_id": str(tenant_id)},
            )
        payment = self._repository.get_payment_by_session(
            tenant_id=tenant_id, provider_session_id=str(session_id)
        )
        if payment is None:
            self._logger.warning(
                "workflow.checkout.webhook_unknown_session",
                message="Sesión desconocida en webhook",
                session_id=str(session_id),
            )
            return None
        if payment.status == PaymentStatus.SUCCEEDED:
            return PaymentRead.model_validate(payment)
        updated = self._repository.update_payment(
            tenant_id=tenant_id,
            payment_id=payment.id,
            fields={"status": PaymentStatus.SUCCEEDED},
        )
        if updated is None:
            raise NotFoundError(
                "Pago no encontrado",
                operation="workflow.checkout.webhook",
                context={
                    "tenant_id": str(tenant_id),
                    "payment_id": str(payment.id),
                },
            )
        payment_read = PaymentRead.model_validate(updated)
        email_delivered = False
        if self._email_sender is not None and payment_read.customer_email:
            try:
                email_delivered = self._email_sender.send_email(
                    to_email=payment_read.customer_email,
                    subject="Pago confirmado",
                    html_body=(
                        "<p>Hola, tu pago fue confirmado correctamente.</p>"
                        f"<p>Referencia: <code>{payment_read.id}</code></p>"
                    ),
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.checkout.email_failed",
                    message="No se pudo enviar el correo de confirmación",
                    payment_id=str(updated.id),
                    error=str(exc),
                )
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.checkout.webhook",
            entity_type="workflow_payment",
            entity_id=str(updated.id),
            details={
                "status": PaymentStatus.SUCCEEDED,
                "provider": "stripe",
                "email_delivered": email_delivered,
            },
        )
        self._logger.info(
            "workflow.checkout.webhook_completed",
            message="Pago completado vía webhook",
            payment_id=str(updated.id),
            tenant_id=str(tenant_id),
            session_id=str(session_id),
            email_delivered=email_delivered,
        )
        return payment_read

    def get_payment(
        self, *, tenant_id: uuid.UUID, payment_id: uuid.UUID
    ) -> PaymentRead:
        payment = self._repository.get_payment(
            tenant_id=tenant_id, payment_id=payment_id
        )
        if payment is None:
            raise NotFoundError(
                "Pago no encontrado",
                operation="workflow.payment.get",
                context={
                    "tenant_id": str(tenant_id),
                    "payment_id": str(payment_id),
                },
            )
        return PaymentRead.model_validate(payment)

    def list_payments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[PaymentRead]:
        items, total = self._repository.list_payments(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[PaymentRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    # ── Leads ──────────────────────────────────────────────────────────────
    def capture_lead(
        self, *, tenant_id: uuid.UUID, data: LeadRequest
    ) -> LeadRead:
        lead = self._repository.create_lead(
            tenant_id=tenant_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            source=data.source,
            metadata=data.metadata,
        )
        lead_read = LeadRead.model_validate(lead)
        crm_delivered = self._crm_webhook_sender.send_lead(lead=lead_read)
        whatsapp_delivered = False
        if self._whatsapp_sender is not None and lead_read.phone:
            template_name = str(
                (data.metadata or {}).get("whatsapp_template") or "lead_notificacion"
            )
            try:
                whatsapp_delivered = self._whatsapp_sender.send_template_message(
                    to_phone=lead_read.phone,
                    template_name=template_name,
                    template_variables={"name": lead_read.name},
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.lead.whatsapp_failed",
                    message="No se pudo enviar la notificación de WhatsApp",
                    lead_id=str(lead.id),
                    error=str(exc),
                )
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.lead.capture",
            entity_type="workflow_lead",
            entity_id=str(lead.id),
            details={
                "source": data.source,
                "crm_delivered": crm_delivered,
                "whatsapp_delivered": whatsapp_delivered,
            },
        )
        self._logger.info(
            "workflow.lead.captured",
            message="Lead capturado",
            lead_id=str(lead.id),
            tenant_id=str(tenant_id),
            source=data.source,
            crm_delivered=crm_delivered,
            whatsapp_delivered=whatsapp_delivered,
        )
        return lead_read

    def get_lead(
        self, *, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> LeadRead:
        lead = self._repository.get_lead(tenant_id=tenant_id, lead_id=lead_id)
        if lead is None:
            raise NotFoundError(
                "Lead no encontrado",
                operation="workflow.lead.get",
                context={"tenant_id": str(tenant_id), "lead_id": str(lead_id)},
            )
        return LeadRead.model_validate(lead)

    def list_leads(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[LeadRead]:
        items, total = self._repository.list_leads(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[LeadRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    # ── Cotizaciones ───────────────────────────────────────────────────────
    def generate_quote(
        self, *, tenant_id: uuid.UUID, data: QuoteRequest
    ) -> QuoteResponse:
        services: list[dict[str, object]] = []
        subtotal_minor = 0
        for item in data.services:
            unit_minor = to_minor(item.unit_price)
            subtotal_minor += unit_minor * item.quantity
            services.append(
                {
                    "name": item.name,
                    "description": item.description,
                    "quantity": item.quantity,
                    "unit_price_minor": unit_minor,
                }
            )
        tax_minor = int(
            (Decimal(subtotal_minor) * Decimal(data.tax_rate_bps) / _TAX_BASE)
            .to_integral_value(rounding=ROUND_HALF_UP)
        )
        total_minor = subtotal_minor + tax_minor
        quote = self._repository.create_quote(
            tenant_id=tenant_id,
            customer_name=data.customer_name,
            customer_email=data.customer_email,
            currency=data.currency,
            services=services,
            subtotal_minor=subtotal_minor,
            tax_minor=tax_minor,
            total_minor=total_minor,
            status=QuoteStatus.DRAFT,
        )
        quote_read = QuoteRead.model_validate(quote)
        document = self._quote_renderer.render(quote=quote_read)
        updated = self._repository.update_quote(
            tenant_id=tenant_id,
            quote_id=quote.id,
            fields={"pdf_path": document.path},
        )
        if updated is None:
            raise NotFoundError(
                "Cotización no encontrada",
                operation="workflow.quote.generate",
                context={"tenant_id": str(tenant_id), "quote_id": str(quote.id)},
            )
        email_delivered = False
        if self._email_sender is not None and quote_read.customer_email:
            try:
                with open(self._artifacts_dir / document.path, "rb") as pdf_file:
                    attachment = EmailAttachment(
                        filename=Path(document.path).name,
                        content=pdf_file.read(),
                        maintype="application",
                        subtype="pdf",
                    )
                email_delivered = self._email_sender.send_email(
                    to_email=quote_read.customer_email,
                    subject=f"Cotización {quote_read.id}",
                    html_body=(
                        f"<p>Hola {quote_read.customer_name},</p>"
                        "<p>Tu cotización está lista.</p>"
                        f"<p><a href='{document.url}'>Descargar PDF</a></p>"
                    ),
                    attachments=[attachment],
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.quote.email_failed",
                    message="No se pudo enviar la cotización por correo",
                    quote_id=str(quote.id),
                    error=str(exc),
                )
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.quote.generate",
            entity_type="workflow_quote",
            entity_id=str(quote.id),
            details={
                "subtotal_minor": subtotal_minor,
                "tax_minor": tax_minor,
                "total_minor": total_minor,
                "email_delivered": email_delivered,
            },
        )
        self._logger.info(
            "workflow.quote.generated",
            message="Cotización generada",
            quote_id=str(quote.id),
            tenant_id=str(tenant_id),
            total_minor=total_minor,
            pdf_path=document.path,
            email_delivered=email_delivered,
        )
        return QuoteResponse(
            quote_id=quote.id,
            status=QuoteStatus.DRAFT,
            subtotal=from_minor(subtotal_minor),
            tax=from_minor(tax_minor),
            total=from_minor(total_minor),
            currency=data.currency,
            pdf_url=document.url,
        )

    def get_quote(
        self, *, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> QuoteRead:
        quote = self._repository.get_quote(tenant_id=tenant_id, quote_id=quote_id)
        if quote is None:
            raise NotFoundError(
                "Cotización no encontrada",
                operation="workflow.quote.get",
                context={"tenant_id": str(tenant_id), "quote_id": str(quote_id)},
            )
        return QuoteRead.model_validate(quote)

    def list_quotes(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[QuoteRead]:
        items, total = self._repository.list_quotes(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[QuoteRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    # ── Citas ──────────────────────────────────────────────────────────────
    def schedule_appointment(
        self, *, tenant_id: uuid.UUID, data: AppointmentRequest
    ) -> AppointmentResponse:
        starts_at = data.starts_at
        if starts_at.tzinfo is None:
            starts_at = starts_at.replace(tzinfo=timezone.utc)
        else:
            starts_at = starts_at.astimezone(timezone.utc)
        ends_at = starts_at + timedelta(minutes=data.duration_minutes)
        appointment = self._repository.create_appointment(
            tenant_id=tenant_id,
            service=data.service,
            starts_at=starts_at,
            ends_at=ends_at,
            timezone=data.timezone,
            customer_name=data.customer_name,
            customer_email=data.customer_email,
            customer_phone=data.customer_phone,
            status=AppointmentStatus.SCHEDULED,
            notes=data.notes,
        )
        appointment_read = AppointmentRead.model_validate(appointment)
        event = self._calendar_provider.create_event(appointment=appointment_read)
        updated = self._repository.update_appointment(
            tenant_id=tenant_id,
            appointment_id=appointment.id,
            fields={"ics_path": event.path},
        )
        if updated is None:
            raise NotFoundError(
                "Cita no encontrada",
                operation="workflow.appointment.schedule",
                context={
                    "tenant_id": str(tenant_id),
                    "appointment_id": str(appointment.id),
                },
            )
        email_delivered = False
        sms_delivered = False
        if self._email_sender is not None and appointment_read.customer_email:
            try:
                with open(self._artifacts_dir / event.path, "rb") as ics_file:
                    attachment = EmailAttachment(
                        filename=Path(event.path).name,
                        content=ics_file.read(),
                        maintype="text",
                        subtype="calendar",
                    )
                email_delivered = self._email_sender.send_email(
                    to_email=appointment_read.customer_email,
                    subject=f"Cita agendada: {appointment_read.service}",
                    template_name="appointment_scheduled.html",
                    template_context={
                        "customer_name": appointment_read.customer_name,
                        "service": appointment_read.service,
                        "starts_at": starts_at.isoformat(),
                        "ics_url": event.url,
                    },
                    attachments=[attachment],
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.appointment.email_failed",
                    message="No se pudo enviar el correo de la cita",
                    appointment_id=str(appointment.id),
                    error=str(exc),
                )
        if self._sms_sender is not None and appointment_read.customer_phone:
            try:
                sms_delivered = self._sms_sender.send_sms(
                    to_phone=appointment_read.customer_phone,
                    message=(
                        f"Tu cita ({appointment_read.service}) está confirmada "
                        f"para {starts_at.isoformat()}."
                    ),
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.appointment.sms_failed",
                    message="No se pudo enviar el SMS de la cita",
                    appointment_id=str(appointment.id),
                    error=str(exc),
                )
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.appointment.schedule",
            entity_type="workflow_appointment",
            entity_id=str(appointment.id),
            details={
                "service": data.service,
                "starts_at": starts_at.isoformat(),
                "email_delivered": email_delivered,
                "sms_delivered": sms_delivered,
            },
        )
        self._logger.info(
            "workflow.appointment.scheduled",
            message="Cita agendada",
            appointment_id=str(appointment.id),
            tenant_id=str(tenant_id),
            service=data.service,
            ics_path=event.path,
            email_delivered=email_delivered,
            sms_delivered=sms_delivered,
        )
        return AppointmentResponse(
            appointment_id=appointment.id,
            status=AppointmentStatus.SCHEDULED,
            starts_at=starts_at,
            ends_at=ends_at,
            timezone=data.timezone,
            ics_url=event.url,
        )

    def get_appointment(
        self, *, tenant_id: uuid.UUID, appointment_id: uuid.UUID
    ) -> AppointmentRead:
        appointment = self._repository.get_appointment(
            tenant_id=tenant_id, appointment_id=appointment_id
        )
        if appointment is None:
            raise NotFoundError(
                "Cita no encontrada",
                operation="workflow.appointment.get",
                context={
                    "tenant_id": str(tenant_id),
                    "appointment_id": str(appointment_id),
                },
            )
        return AppointmentRead.model_validate(appointment)

    def list_appointments(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[AppointmentRead]:
        items, total = self._repository.list_appointments(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[AppointmentRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )
