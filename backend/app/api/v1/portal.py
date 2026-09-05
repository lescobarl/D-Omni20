"""Endpoints del Portal del Cliente (C-3): login, autoservicio y privacidad (ARCO).

Área privada y con login donde el comprador final consulta el estado de su
pedido/oportunidad (pagos, leads, cotizaciones y citas) y ejerce sus derechos
ARCO de la LFPDPPP (exportar o borrar sus datos).

Autenticación: token firmado con HMAC-SHA256 (:mod:`app.services.portal_tokens`)
enviado como ``Authorization: Bearer <token>``. El tenant se resuelve con
``get_current_tenant`` (cabecera ``X-Tenant-Id``) y el token debe pertenecer a ese
mismo tenant; cualquier fallo es fail-closed con :class:`TenantIsolationError`
(403) y nunca revela la existencia de datos ajenos.

Reuso (regla CLAUDE — sin duplicación): las consultas por correo usan los métodos
``*_by_email`` del :class:`IWorkflowService` y los derechos ARCO reutilizan
:class:`IPrivacyService` (los mismos flujos de ``/bot/privacy/*``).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header

from app.api.deps import (
    get_bot_privacy_service,
    get_container,
    get_crm_service,
    get_current_tenant,
    get_workflow_service,
)
from app.bot.governance import IPrivacyService
from app.core.di import Container
from app.core.errors import NotFoundError, TenantIsolationError
from app.schemas.bot import BotDataExportRead, PrivacyDeletionResult
from app.schemas.common import Page, Pagination
from app.schemas.portal import (
    PortalLoginRequest,
    PortalLoginResponse,
    PortalOpportunityRead,
    PortalSummaryRead,
)
from app.schemas.workflow import (
    AppointmentRead,
    LeadRead,
    PaymentRead,
    QuoteRead,
)
from app.services.portal_tokens import (
    PortalTokenClaims,
    sign_portal_token,
    verify_portal_token,
)
from app.services.interfaces import ICrmService
from app.services.workflow_interfaces import IWorkflowService

router = APIRouter(prefix="/portal", tags=["portal"])

_OPERATION_AUTH = "portal.client.authenticate"
_OPERATION_LOGIN = "portal.login"
_OPERATION_PAYMENT = "portal.payment.get"

_EMAIL_PROBES: tuple = (
    "list_payments_by_email",
    "list_leads_by_email",
    "list_quotes_by_email",
    "list_appointments_by_email",
)


def get_current_portal_client(
    container: Container = Depends(get_container),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> PortalTokenClaims:
    """Resuelve el cliente autenticado del portal desde el Bearer token.

    Fail-closed: rechaza con 403 si el encabezado no es ``Bearer``, si el token no
    es válido/expiró o si el token pertenece a otro tenant (no filtra la
    existencia de ninguna identidad). Devuelve las reclamaciones verificadas
    (``tenant_id`` y ``email``) que acotan todas las consultas del portal.
    """
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise TenantIsolationError(
            "Token del portal ausente o inválido",
            operation=_OPERATION_AUTH,
            context={"header": "Authorization"},
        )
    secret = container.settings.portal_token_secret
    try:
        claims = verify_portal_token(secret=secret, token=token.strip())
    except TenantIsolationError as exc:
        # Fail-closed: normaliza cualquier fallo de verificación a la operación
        # de autenticación para no revelar la etapa exacta del rechazo.
        raise TenantIsolationError(
            str(exc),
            operation=_OPERATION_AUTH,
            context={"header": "Authorization"},
            cause=exc,
        ) from exc
    if claims.tenant_id != tenant_id:
        raise TenantIsolationError(
            "El token del portal no corresponde al tenant activo",
            operation=_OPERATION_AUTH,
            context={"header": "Authorization"},
        )
    return claims


def _client_exists(
    *,
    service: IWorkflowService,
    tenant_id: uuid.UUID,
    email: str,
) -> bool:
    """Comprueba si el correo tiene algún registro en el tenant activo.

    Sondea las cuatro colecciones del portal (pagos, leads, cotizaciones y citas)
    con ``page_size=1``; basta con que una tenga resultados para autenticar el
    login. No distingue cuál colección existe para no filtrar información.
    """
    for name in _EMAIL_PROBES:
        page = getattr(service, name)(
            tenant_id=tenant_id,
            email=email,
            page=1,
            page_size=1,
        )
        if page.total > 0:
            return True
    return False


@router.post("/login", response_model=PortalLoginResponse)
def portal_login(
    data: PortalLoginRequest,
    tenant_id: Annotated[uuid.UUID, Depends(get_current_tenant)],
    container: Annotated[Container, Depends(get_container)],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
) -> PortalLoginResponse:
    """Inicia sesión en el portal con el correo del comprador final.

    Normaliza el correo a minúsculas y solo emite token si ese correo tiene
    registros en el tenant activo; en caso contrario responde 403 sin distinguir
    si el correo existe o no (no revela la existencia de datos ajenos).
    """
    email = data.email.strip().lower()
    if not _client_exists(service=service, tenant_id=tenant_id, email=email):
        raise TenantIsolationError(
            "El correo no tiene acceso al portal de este tenant",
            operation=_OPERATION_LOGIN,
            context={"email": email},
        )
    secret = container.settings.portal_token_secret
    token = sign_portal_token(secret=secret, tenant_id=tenant_id, email=email)
    # Re-verifica el token recién firmado para devolver la vigencia exacta que
    # quedó embebida en ``exp`` (fuente única de verdad).
    claims = verify_portal_token(secret=secret, token=token)
    return PortalLoginResponse(
        token=token,
        email=email,
        expires_at=claims.expires_at,
    )


@router.get("/summary", response_model=PortalSummaryRead)
def get_portal_summary(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    pagination: Annotated[Pagination, Depends()],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
    crm_service: Annotated[ICrmService, Depends(get_crm_service)],
) -> PortalSummaryRead:
    """Estado del pedido/oportunidad del cliente.

    Workflows (pagos, leads, cotizaciones y citas) + CRM (oportunidades abiertas
    con nombre de etapa y próximos pasos pendientes). Acota todas las consultas al
    correo autenticado (``claims.email``) dentro del tenant del token (defensa en
    profundidad sobre la RLS del tenant).
    """
    payments = service.list_payments_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    leads = service.list_leads_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    quotes = service.list_quotes_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    appointments = service.list_appointments_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    crm = crm_service.summary(tenant_id=claims.tenant_id, email=claims.email)
    stage_names = {
        stage.id: stage.name
        for stage in crm_service.list_stages(tenant_id=claims.tenant_id)
    }
    opportunities: list[PortalOpportunityRead] = []
    for deal in crm.deals:
        if deal.status != "open":
            continue
        # ``DealRead.metadata`` usa validation_alias="metadata_json" sin
        # populate_by_name: la validación desde instancia falla (pydantic 2.10).
        # Se reconstruye desde el dict con la clave de alias para que la
        # serialización devuelva de nuevo ``metadata``.
        payload = deal.model_dump()
        payload["metadata_json"] = payload.pop("metadata")
        opportunity = PortalOpportunityRead.model_validate(payload)
        opportunity.stage_name = stage_names.get(deal.stage_id)
        opportunities.append(opportunity)
    next_steps = [task for task in crm.tasks if task.status == "pending"]
    return PortalSummaryRead(
        email=claims.email,
        payments=payments.items,
        leads=leads.items,
        quotes=quotes.items,
        appointments=appointments.items,
        opportunities=opportunities,
        next_steps=next_steps,
    )


@router.get("/payments", response_model=Page[PaymentRead])
def portal_list_payments(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    pagination: Annotated[Pagination, Depends()],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
) -> Page[PaymentRead]:
    """Página de pagos del cliente autenticado (recibos e historial)."""
    return service.list_payments_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/payments/{payment_id}", response_model=PaymentRead)
def portal_get_payment(
    payment_id: uuid.UUID,
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
) -> PaymentRead:
    """Devuelve un pago del cliente autenticado (404 si no existe o es ajeno).

    Verifica la propiedad del pago contra el correo autenticado tras recuperarlo;
    si el pago pertenece a otro cliente responde 404 (mismo código que "no
    existe") para no filtrar la existencia de transacciones ajenas.
    """
    payment = service.get_payment(tenant_id=claims.tenant_id, payment_id=payment_id)
    if (payment.customer_email or "").lower() != claims.email:
        raise NotFoundError(
            "Pago no encontrado",
            operation=_OPERATION_PAYMENT,
            context={"payment_id": str(payment_id)},
        )
    return payment


@router.get("/leads", response_model=Page[LeadRead])
def portal_list_leads(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    pagination: Annotated[Pagination, Depends()],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
) -> Page[LeadRead]:
    """Página de leads (solicitudes) del cliente autenticado."""
    return service.list_leads_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/quotes", response_model=Page[QuoteRead])
def portal_list_quotes(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    pagination: Annotated[Pagination, Depends()],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
) -> Page[QuoteRead]:
    """Página de cotizaciones del cliente autenticado."""
    return service.list_quotes_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/appointments", response_model=Page[AppointmentRead])
def portal_list_appointments(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    pagination: Annotated[Pagination, Depends()],
    service: Annotated[IWorkflowService, Depends(get_workflow_service)],
) -> Page[AppointmentRead]:
    """Página de citas del cliente autenticado."""
    return service.list_appointments_by_email(
        tenant_id=claims.tenant_id,
        email=claims.email,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/privacy/export", response_model=BotDataExportRead)
def export_portal_privacy_data(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    service: Annotated[IPrivacyService, Depends(get_bot_privacy_service)],
) -> BotDataExportRead:
    """Exporta los datos del cliente (derecho de portabilidad, LFPDPPP).

    Reutiliza :class:`BotPrivacyService` (mismo flujo que ``/bot/privacy/export``)
    acotado al tenant del token del portal.
    """
    return service.export(tenant_id=claims.tenant_id)


@router.delete("/privacy/data", response_model=PrivacyDeletionResult)
def erase_portal_privacy_data(
    claims: Annotated[PortalTokenClaims, Depends(get_current_portal_client)],
    service: Annotated[IPrivacyService, Depends(get_bot_privacy_service)],
) -> PrivacyDeletionResult:
    """Borra los datos del cliente (derecho de cancelación, LFPDPPP).

    Reutiliza :class:`BotPrivacyService` (mismo flujo que ``/bot/privacy/data``)
    acotado al tenant del token del portal.
    """
    return service.erase(tenant_id=claims.tenant_id)
