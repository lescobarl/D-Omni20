"""Endpoints del subsistema de workflows (checkout, leads, cotizaciones, citas).

Todos los endpoints requieren el tenant activo vía ``X-Tenant-Id``
(``get_current_tenant``) salvo el webhook de la pasarela, que no puede enviar
esa cabecera: el tenant se extrae del propio payload (``metadata.tenant_id``)
que la pasarela devuelve en la sesión (defensa en profundidad).
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Header, Request, status

from app.api.deps import get_container, get_current_tenant, get_workflow_service
from app.core.di import Container
from app.core.errors import InputValidationError, TenantIsolationError
from app.schemas.common import Page, Pagination
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
    ReminderProcessingResponse,
)
from app.services.workflow_interfaces import IWorkflowService

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _parse_webhook_tenant(payload: bytes) -> uuid.UUID:
    """Extrae y valida el tenant desde ``data.object.metadata.tenant_id``.

    Stripe no envía ``X-Tenant-Id`` en los webhooks; el tenant se fija en el
    ``metadata`` de la sesión al crearla. Si falta o es inválido se rechaza con
    :class:`TenantIsolationError` (nunca se procesa sin tenant).
    """
    try:
        body = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise InputValidationError(
            "Payload de webhook inválido",
            operation="workflow.checkout.webhook",
            context={"stage": "tenant_parse"},
            cause=exc,
        ) from exc
    metadata = body.get("data", {}).get("object", {}).get("metadata", {})
    raw_tenant = metadata.get("tenant_id")
    if not raw_tenant:
        raise TenantIsolationError(
            "Webhook sin tenant_id en metadata",
            operation="workflow.checkout.webhook",
            context={"stage": "tenant_parse"},
        )
    try:
        return uuid.UUID(str(raw_tenant))
    except (ValueError, AttributeError) as exc:
        raise TenantIsolationError(
            "tenant_id inválido en metadata del webhook",
            operation="workflow.checkout.webhook",
            context={"stage": "tenant_parse", "tenant_id": str(raw_tenant)},
            cause=exc,
        ) from exc


# ────────────────────────────────────────────────────────────────────────────
# CHECKOUT / PAGOS
# ────────────────────────────────────────────────────────────────────────────


@router.post("/checkout", response_model=CheckoutResponse, status_code=status.HTTP_201_CREATED)
def create_checkout(
    data: CheckoutRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> CheckoutResponse:
    """Inicia un checkout directo: crea la sesión en la pasarela y la transacción."""
    return service.create_checkout(tenant_id=tenant_id, data=data)


@router.post("/checkout/{payment_id}/confirm", response_model=PaymentRead)
def confirm_checkout(
    payment_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> PaymentRead:
    """Confirma manualmente un pago sandbox pendiente (idempotente)."""
    return service.confirm_checkout(tenant_id=tenant_id, payment_id=payment_id)


@router.post("/checkout/webhook", response_model=PaymentRead | None)
async def handle_checkout_webhook(
    request: Request,
    signature: str | None = Header(default=None, alias="Stripe-Signature"),
    service: IWorkflowService = Depends(get_workflow_service),
) -> PaymentRead | None:
    """Procesa un webhook de la pasarela (Stripe). El tenant sale del payload."""
    payload = await request.body()
    tenant_id = _parse_webhook_tenant(payload)
    return service.handle_checkout_webhook(
        tenant_id=tenant_id, payload=payload, signature=signature
    )


@router.get("/payments", response_model=Page[PaymentRead])
def list_payments(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> Page[PaymentRead]:
    """Página de transacciones de pago del tenant activo."""
    return service.list_payments(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.get("/payments/{payment_id}", response_model=PaymentRead)
def get_payment(
    payment_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> PaymentRead:
    """Devuelve una transacción de pago del tenant activo (404 si no existe)."""
    return service.get_payment(tenant_id=tenant_id, payment_id=payment_id)


# ────────────────────────────────────────────────────────────────────────────
# LEADS
# ────────────────────────────────────────────────────────────────────────────


@router.post("/lead", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
def capture_lead(
    data: LeadRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> LeadRead:
    """Captura un prospecto y lo notifica al CRM (si está configurado)."""
    return service.capture_lead(tenant_id=tenant_id, data=data)


@router.get("/leads", response_model=Page[LeadRead])
def list_leads(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> Page[LeadRead]:
    """Página de prospectos del tenant activo."""
    return service.list_leads(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.get("/leads/{lead_id}", response_model=LeadRead)
def get_lead(
    lead_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> LeadRead:
    """Devuelve un prospecto del tenant activo (404 si no existe)."""
    return service.get_lead(tenant_id=tenant_id, lead_id=lead_id)


# ────────────────────────────────────────────────────────────────────────────
# COTIZACIONES
# ────────────────────────────────────────────────────────────────────────────


@router.post("/quote", response_model=QuoteResponse, status_code=status.HTTP_201_CREATED)
def generate_quote(
    data: QuoteRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> QuoteResponse:
    """Calcula totales y genera el PDF de una cotización."""
    return service.generate_quote(tenant_id=tenant_id, data=data)


@router.get("/quotes", response_model=Page[QuoteRead])
def list_quotes(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> Page[QuoteRead]:
    """Página de cotizaciones del tenant activo."""
    return service.list_quotes(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.get("/quotes/{quote_id}", response_model=QuoteRead)
def get_quote(
    quote_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> QuoteRead:
    """Devuelve una cotización del tenant activo (404 si no existe)."""
    return service.get_quote(tenant_id=tenant_id, quote_id=quote_id)


# ────────────────────────────────────────────────────────────────────────────
# CITAS
# ────────────────────────────────────────────────────────────────────────────


@router.post("/appointment", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
def schedule_appointment(
    data: AppointmentRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> AppointmentResponse:
    """Agenda una cita y genera la invitación ICS."""
    return service.schedule_appointment(tenant_id=tenant_id, data=data)


@router.get("/appointments", response_model=Page[AppointmentRead])
def list_appointments(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> Page[AppointmentRead]:
    """Página de citas del tenant activo."""
    return service.list_appointments(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.get("/appointments/{appointment_id}", response_model=AppointmentRead)
def get_appointment(
    appointment_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IWorkflowService = Depends(get_workflow_service),
) -> AppointmentRead:
    """Devuelve una cita del tenant activo (404 si no existe)."""
    return service.get_appointment(tenant_id=tenant_id, appointment_id=appointment_id)


@router.post("/reminders/process", response_model=ReminderProcessingResponse)
def process_reminders(
    container: Container = Depends(get_container),
) -> ReminderProcessingResponse:
    """Ejecuta un ciclo de recordatorios (a nivel de sistema, sin tenant)."""
    return container.scheduler.process_due_reminders()
