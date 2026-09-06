"""Servicio de dominio de workflows (checkout, leads, cotizaciones y citas).

Caso de uso de conversión multi-tenant. Convierte montos a minor units, delega
la infraestructura externa a los puertos (pasarela, PDF, ICS, CRM) y registra
auditoría + logs estructurados (regla CLAUDE). Nunca usa ``new`` para
infraestructura: todo llega por inyección.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from app.core.errors import InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.models.workflow import (
    AppointmentStatus,
    Lead,
    LeadStatus,
    PaymentStatus,
    QuoteStatus,
)
from app.repositories.ads_interfaces import IAdsRepository
from app.repositories.operations_interfaces import IContactRepository
from app.repositories.workflow_interfaces import IWorkflowRepository
from app.schemas.common import Page
from app.schemas.workflow import (
    AppointmentRead,
    AppointmentRequest,
    AppointmentResponse,
    CheckoutRequest,
    CheckoutResponse,
    LeadAttributionRead,
    LeadAttributionRow,
    LeadRead,
    LeadRequest,
    PaymentRead,
    QuoteRead,
    QuoteRequest,
    QuoteResponse,
)
from app.services.crm_interfaces import (
    ICrmEventPublisher,
    LeadNeedsHumanEvent,
    PaymentConfirmedEvent,
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
    IWhatsAppSenderFactory,
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
        whatsapp_sender_factory: IWhatsAppSenderFactory | None = None,
        contact_repository: IContactRepository | None = None,
        ads_repository: IAdsRepository | None = None,
        crm_event_publisher: ICrmEventPublisher | None = None,
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
        self._whatsapp_sender_factory = whatsapp_sender_factory
        self._contact_repository = contact_repository
        self._ads_repository = ads_repository
        self._crm_event_publisher = crm_event_publisher
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
        self._emit_payment_confirmed(tenant_id=tenant_id, payment=updated)
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
        self._emit_payment_confirmed(tenant_id=tenant_id, payment=updated)
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
        # Se resuelve el sender ANTES de la escritura del lead: la fábrica
        # tenant-aware se liga a la sesión del request (``get_channel_sender_factory``
        # en deps), por lo que reutiliza la transacción ya abierta por
        # ``get_current_tenant`` — sin segunda conexión, sin deadlock en SQLite
        # (``BEGIN IMMEDIATE``, un solo escritor a la vez). En PostgreSQL (MVCC)
        # el orden es irrelevante; el reorder es solo higiene del camino HTTP.
        sender = (
            self._whatsapp_sender_factory.resolve_sender_for_tenant(tenant_id=tenant_id)
            if self._whatsapp_sender_factory is not None
            else None
        )
        lead = self._repository.create_lead(
            tenant_id=tenant_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            source=data.source,
            metadata=data.metadata,
        )
        # Atribución UTM (eslabón ①): resuelve la campaña publicitaria activa del
        # tenant por la firma UTM persistida en ``metadata_json`` y liga el lead.
        # Best-effort: sin repositorio inyectado o sin firma UTM, el lead queda
        # sin campaña (``ad_campaign_id`` NULL, FK nullable) sin romper la captura.
        ad_campaign_id: str | None = None
        ads_repo = self._ads_repository
        if ads_repo is not None:
            utm_meta = lead.metadata_json or {}
            try:
                campaign = ads_repo.resolve_by_utm(
                    tenant_id=tenant_id,
                    utm_campaign=utm_meta.get("utm_campaign"),
                    utm_source=utm_meta.get("utm_source"),
                    utm_medium=utm_meta.get("utm_medium"),
                )
            except Exception as exc:
                self._logger.warning(
                    "workflow.lead.attribution_failed",
                    message="No se pudo resolver la campaña publicitaria del lead",
                    lead_id=str(lead.id),
                    error=str(exc),
                )
                campaign = None
            if campaign is None:
                # Atribución por contexto directo (eslabón ②): cuando el lead no
                # lleva firma UTM pero referencia un `campaign_id` (p. ej. el
                # preview del editor adjunta el `campaign_id` de la landing), se
                # liga a esa campaña del tenant si existe y está activa.
                context_campaign_id = utm_meta.get("campaign_id")
                if context_campaign_id:
                    try:
                        campaign = ads_repo.get(
                            tenant_id=tenant_id,
                            ad_campaign_id=uuid.UUID(str(context_campaign_id)),
                        )
                    except (ValueError, TypeError):
                        campaign = None
            if campaign is not None:
                lead.ad_campaign_id = campaign.id
                ad_campaign_id = str(campaign.id)
        self._propagate_contact(tenant_id=tenant_id, lead=lead, data=data)
        lead_read = LeadRead.model_validate(lead)
        crm_delivered = self._crm_webhook_sender.send_lead(lead=lead_read)
        # Orquestación (P2): un lead marcado ``needs_human`` dispara la
        # auto-creación de la oportunidad + tarea en el subsistema CRM (M3/M5).
        # Best-effort: sin emisor inyectado o ante un fallo, la captura del lead
        # no se rompe (el evento nunca altera el flujo principal).
        if (data.metadata or {}).get("needs_human"):
            self._emit_lead_needs_human(tenant_id=tenant_id, lead=lead)
        whatsapp_delivered = False
        if sender is not None and lead_read.phone:
            template_name = str(
                (data.metadata or {}).get("whatsapp_template") or "lead_notificacion"
            )
            try:
                whatsapp_delivered = sender.send_template_message(
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
                "ad_campaign_id": ad_campaign_id,
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
            ad_campaign_id=ad_campaign_id,
            crm_delivered=crm_delivered,
            whatsapp_delivered=whatsapp_delivered,
        )
        return lead_read

    def _propagate_contact(
        self, *, tenant_id: uuid.UUID, lead: Lead, data: LeadRequest
    ) -> None:
        """Propaga el lead al directorio de contactos (eslabón ②) si tiene teléfono.

        Best-effort: un fallo aquí no rompe la captura del lead. Los tags UTM se
        adjuntan como ``clave:valor`` y se fusionan con los existentes (sin
        duplicados) porque ``IContactRepository.update`` reemplaza la lista completa.
        """
        repo = self._contact_repository
        if repo is None or not lead.phone:
            return
        try:
            utm_tags = self._utm_tags(lead)
            existing = repo.get_by_phone(tenant_id=tenant_id, phone=lead.phone)
            if existing is None:
                repo.create(
                    tenant_id=tenant_id,
                    phone=lead.phone,
                    name=lead.name,
                    email=lead.email,
                    tags=utm_tags,
                    state="new",
                    source=data.source,
                    external_contact_id=str(
                        (data.metadata or {}).get("external_contact_id") or ""
                    )
                    or None,
                    last_contact_at=datetime.now(UTC),
                )
            else:
                tags = list(dict.fromkeys([*(existing.tags or []), *utm_tags]))
                repo.update(
                    tenant_id=tenant_id,
                    contact_id=existing.id,
                    fields={
                        "name": lead.name,
                        "email": lead.email,
                        "tags": tags,
                        "source": data.source,
                        "last_contact_at": datetime.now(UTC),
                    },
                )
        except Exception as exc:
            self._logger.warning(
                "workflow.lead.contact_propagation_failed",
                message="No se pudo propagar el lead al directorio de contactos",
                lead_id=str(lead.id),
                error=str(exc),
            )

    @staticmethod
    def _utm_tags(lead: Lead) -> list[str]:
        """Convierte los parámetros UTM persistidos en tags ``clave:valor``."""
        metadata = lead.metadata_json or {}
        tags: list[str] = []
        for key in (
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
            "utm_term",
        ):
            value = metadata.get(key)
            if value:
                tags.append(f"{key}:{value}")
        return tags

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

    def find_lead_by_phone(
        self, *, tenant_id: uuid.UUID, phone: str
    ) -> LeadRead | None:
        """Devuelve el lead más reciente del tenant con ese teléfono (o ``None``).

        Permite al BOT heredar la atribución de campaña de un lead capturado en
        la landing hacia la conversación del mismo contacto (eslabón ① → ③).
        """
        lead = self._repository.find_lead_by_phone(
            tenant_id=tenant_id, phone=phone
        )
        if lead is None:
            return None
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

    def lead_attribution(self, *, tenant_id: uuid.UUID) -> LeadAttributionRead:
        """Reporte de atribución por campaña (UTM) del tenant activo.

        Conteos de leads activos agrupados por campaña (``utm_campaign``) y
        fuente, desglosados por estado; agrega el eslabón ② (lead → conversación).
        """
        items = self._repository.lead_attribution(tenant_id=tenant_id)
        rows = [
            LeadAttributionRow(
                campaign=item.campaign,
                source=item.source,
                total=item.total,
                new=item.by_status.get(LeadStatus.NEW, 0),
                contacted=item.by_status.get(LeadStatus.CONTACTED, 0),
                converted=item.by_status.get(LeadStatus.CONVERTED, 0),
                lost=item.by_status.get(LeadStatus.LOST, 0),
            )
            for item in items
        ]
        total_leads = sum(row.total for row in rows)
        self._audit.record(
            tenant_id=tenant_id,
            operation="workflow.lead.attribution",
            entity_type="workflow_lead",
            entity_id=None,
            details={"rows": len(rows), "total_leads": total_leads},
        )
        return LeadAttributionRead(
            rows=rows,
            total_leads=total_leads,
            generated_at=datetime.now(UTC),
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
            starts_at = starts_at.replace(tzinfo=UTC)
        else:
            starts_at = starts_at.astimezone(UTC)
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

    # ---- Portal del cliente (C-3) ───────────────────────────────────────────
    # Consultas acotadas por ``tenant_id`` + ``customer_email`` (identidad del
    # cliente en el portal privado). Reutilizan la paginación estándar de los
    # métodos ``list_*`` homólogos.
    def list_payments_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[PaymentRead]:
        items, total = self._repository.list_payments_by_email(
            tenant_id=tenant_id, email=email, page=page, page_size=page_size
        )
        return Page(
            items=[PaymentRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def list_leads_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[LeadRead]:
        items, total = self._repository.list_leads_by_email(
            tenant_id=tenant_id, email=email, page=page, page_size=page_size
        )
        return Page(
            items=[LeadRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def list_quotes_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[QuoteRead]:
        items, total = self._repository.list_quotes_by_email(
            tenant_id=tenant_id, email=email, page=page, page_size=page_size
        )
        return Page(
            items=[QuoteRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def list_appointments_by_email(
        self, *, tenant_id: uuid.UUID, email: str, page: int, page_size: int
    ) -> Page[AppointmentRead]:
        items, total = self._repository.list_appointments_by_email(
            tenant_id=tenant_id, email=email, page=page, page_size=page_size
        )
        return Page(
            items=[AppointmentRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    # ── Orquestación (P2): emisión best-effort de eventos hacia el CRM ─────
    # Sin importaciones cruzadas: el emisor (``ICrmEventPublisher``) es un puerto
    # inyectado por DI y delegado a :class:`CrmService` en el composition root.
    def _emit_lead_needs_human(self, *, tenant_id: uuid.UUID, lead: Lead) -> None:
        """Notifica ``lead.needs_human`` al subsistema CRM (best-effort)."""
        publisher = self._crm_event_publisher
        if publisher is None:
            return
        try:
            publisher.publish_lead_needs_human(
                event=LeadNeedsHumanEvent(
                    tenant_id=tenant_id,
                    lead_id=lead.id,
                    name=lead.name,
                    email=lead.email,
                    phone=lead.phone,
                    source=lead.source,
                    metadata=lead.metadata_json or {},
                )
            )
        except Exception as exc:
            self._logger.warning(
                "workflow.lead.crm_event_failed",
                message="No se pudo notificar el lead con atención humana al CRM",
                lead_id=str(lead.id),
                error=str(exc),
            )

    def _emit_payment_confirmed(self, *, tenant_id: uuid.UUID, payment: Payment) -> None:
        """Notifica ``payment.confirmed`` al subsistema CRM (best-effort)."""
        publisher = self._crm_event_publisher
        if publisher is None:
            return
        try:
            publisher.publish_payment_confirmed(
                event=PaymentConfirmedEvent(
                    tenant_id=tenant_id,
                    payment_id=payment.id,
                    customer_email=payment.customer_email,
                    customer_name=payment.customer_name,
                    amount_minor=payment.amount_minor,
                    currency=payment.currency,
                    metadata=payment.metadata_json or {},
                )
            )
        except Exception as exc:
            self._logger.warning(
                "workflow.checkout.crm_event_failed",
                message="No se pudo notificar el pago confirmado al CRM",
                payment_id=str(payment.id),
                error=str(exc),
            )
