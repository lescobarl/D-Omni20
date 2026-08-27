"""Composition root de la capa HTTP (FastAPI ``Depends``) — regla CLAUDE: DI.

Contrato:
- ``get_container`` / ``get_session`` exponen la infraestructura compuesta.
- Los *providers* construyen los puertos (repositorios/servicios ABC) con sus
  dependencias inyectadas; la lógica de negocio nunca instancia con ``new``.
- ``get_current_tenant`` resuelve y valida el tenant activo (UUID o slug vía la
  cabecera ``X-Tenant-Id``), lo fija en el ``RequestContext`` y aplica el GUC
  ``app.current_tenant_id`` para que RLS lo evalúe (defensa en profundidad).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.di import Container, build_container
from app.core.errors import NotFoundError, TenantIsolationError
from app.core.tenancy import RequestContext, set_app_current_tenant
from app.repositories.interfaces import (
    IAnalyticsRepository,
    IAuditRepository,
    ICdnDeploymentRepository,
    ILandingRepository,
    IMarketplaceRepository,
    IPseoBatchRepository,
    IPseoHostRepository,
    IPseoPageRepository,
    ISchemaRepository,
    ISchemaVersionRepository,
    ITenantRepository,
)
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAnalyticsRepository,
    SqlAlchemyAuditRepository,
    SqlAlchemyCdnDeploymentRepository,
    SqlAlchemyLandingRepository,
    SqlAlchemyMarketplaceRepository,
    SqlAlchemyPseoBatchRepository,
    SqlAlchemyPseoHostRepository,
    SqlAlchemyPseoPageRepository,
    SqlAlchemySchemaRepository,
    SqlAlchemySchemaVersionRepository,
    SqlAlchemyTenantRepository,
)
from app.repositories.workflow_interfaces import IWorkflowRepository
from app.repositories.workflow_repositories import SqlAlchemyWorkflowRepository
from app.services.audit_service import AuditService
from app.services.cdn_deployment_service import CdnDeploymentService
from app.services.compiler_service import JinjaCompilerService
from app.services.data_matrix_service import DataMatrixService
from app.services.interfaces import (
    IAuditService,
    IAiService,
    ICdnDeploymentService,
    ICompilerService,
    IDataMatrixService,
    ILandingService,
    IPseoService,
    ISchemaGenerationService,
    ISchemaValidator,
)
from app.services.landing_service import LandingService
from app.services.pseo_service import PseoService
from app.services.schema_service import SchemaGenerationService
from app.services.schema_validator import SchemaValidatorService
from app.services.workflow_interfaces import (
    ICalendarProvider,
    ICrmWebhookSender,
    IEmailSender,
    IGoogleCalendarProvider,
    IPaymentGateway,
    IQuoteRenderer,
    ISmsSender,
    IWhatsAppSender,
    IWorkflowService,
)
from app.services.workflow_service import WorkflowService


def get_container(request: Request) -> Container:
    """Devuelve el contenedor DI del arranque (fail-fast si no existe)."""
    container = getattr(request.app.state, "container", None)
    if container is None:
        container = build_container()
        request.app.state.container = container
    return container


def get_session(request: Request) -> Iterator[Session]:
    """Abre la sesión del request (el evento ``after_begin`` aplica el GUC)."""
    container = get_container(request)
    with container.database.session_scope() as session:
        yield session


def get_tenant_repository(session: Session = Depends(get_session)) -> ITenantRepository:
    return SqlAlchemyTenantRepository(session)


def get_landing_repository(session: Session = Depends(get_session)) -> ILandingRepository:
    return SqlAlchemyLandingRepository(session)


def get_audit_repository(session: Session = Depends(get_session)) -> IAuditRepository:
    return SqlAlchemyAuditRepository(session)


def get_audit_service(
    repository: IAuditRepository = Depends(get_audit_repository),
    container: Container = Depends(get_container),
) -> IAuditService:
    return AuditService(repository=repository, logger=container.logger)


def get_compiler_service() -> ICompilerService:
    return JinjaCompilerService()


def get_ai_service(container: Container = Depends(get_container)) -> IAiService:
    """Devuelve el servicio de generación IA app-scoped (singleton del container)."""
    return container.ai_service


def get_schema_repository(session: Session = Depends(get_session)) -> ISchemaRepository:
    """Repositorio de JSON Schemas acotado al tenant (sesión del request)."""
    return SqlAlchemySchemaRepository(session)


def get_schema_version_repository(
    session: Session = Depends(get_session),
) -> ISchemaVersionRepository:
    """Repositorio de versiones de JSON Schemas acotado al tenant."""
    return SqlAlchemySchemaVersionRepository(session)


def get_marketplace_repository(
    session: Session = Depends(get_session),
) -> IMarketplaceRepository:
    """Repositorio del marketplace de templates (catálogo global + propios)."""
    return SqlAlchemyMarketplaceRepository(session)


def get_analytics_repository(
    session: Session = Depends(get_session),
) -> IAnalyticsRepository:
    """Repositorio de eventos de analítica acotado al tenant."""
    return SqlAlchemyAnalyticsRepository(session)


def get_cdn_deployment_repository(
    session: Session = Depends(get_session),
) -> ICdnDeploymentRepository:
    """Repositorio de despliegues al CDN acotado al tenant (append-only)."""
    return SqlAlchemyCdnDeploymentRepository(session)


def get_schema_generation_service(
    schema_repository: ISchemaRepository = Depends(get_schema_repository),
    container: Container = Depends(get_container),
) -> ISchemaGenerationService:
    """Servicio de generación IA de JSON Schemas construido por request
    (el repositorio es session-scoped; el resto proviene del container)."""
    return SchemaGenerationService(
        settings=container.settings,
        cache=container.ai_cache,
        logger=container.logger,
        repository=schema_repository,
    )


def get_schema_validator() -> ISchemaValidator:
    """Servicio de validación de JSON Schemas (stateless, sin dependencias)."""
    return SchemaValidatorService()


def get_landing_service(
    repository: ILandingRepository = Depends(get_landing_repository),
    audit: IAuditService = Depends(get_audit_service),
    compiler: ICompilerService = Depends(get_compiler_service),
    container: Container = Depends(get_container),
) -> ILandingService:
    return LandingService(
        repository=repository,
        audit=audit,
        compiler=compiler,
        logger=container.logger,
    )


def get_cdn_deployment_service(
    repository: ICdnDeploymentRepository = Depends(get_cdn_deployment_repository),
    landing_repository: ILandingRepository = Depends(get_landing_repository),
    compiler: ICompilerService = Depends(get_compiler_service),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> ICdnDeploymentService:
    """Servicio de despliegue al CDN compuesto por request (repo session-scoped)."""
    return CdnDeploymentService(
        repository=repository,
        landing_repository=landing_repository,
        compiler=compiler,
        settings=container.settings,
        audit=audit,
        logger=container.logger,
    )


def get_data_matrix_service(
    compiler: ICompilerService = Depends(get_compiler_service),
    validator: ISchemaValidator = Depends(get_schema_validator),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> IDataMatrixService:
    """Servicio de matriz programática PSEO compuesto por request (repo session-scoped)."""
    return DataMatrixService(
        compiler=compiler,
        validator=validator,
        audit=audit,
        logger=container.logger,
    )


def get_pseo_host_repository(
    session: Session = Depends(get_session),
) -> IPseoHostRepository:
    """Repositorio de hosts PSEO (mapeo ``host`` → ``tenant_id`` para serving público)."""
    return SqlAlchemyPseoHostRepository(session)


def get_pseo_batch_repository(
    session: Session = Depends(get_session),
) -> IPseoBatchRepository:
    """Repositorio de lotes PSEO acotado al tenant (idempotente por hash)."""
    return SqlAlchemyPseoBatchRepository(session)


def get_pseo_page_repository(
    session: Session = Depends(get_session),
) -> IPseoPageRepository:
    """Repositorio de páginas PSEO versionadas acotado al tenant."""
    return SqlAlchemyPseoPageRepository(session)


def get_pseo_service(
    batch_repository: IPseoBatchRepository = Depends(get_pseo_batch_repository),
    host_repository: IPseoHostRepository = Depends(get_pseo_host_repository),
    page_repository: IPseoPageRepository = Depends(get_pseo_page_repository),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> IPseoService:
    """Servicio PSEO compuesto por request (repos session-scoped)."""
    return PseoService(
        batch_repository=batch_repository,
        host_repository=host_repository,
        page_repository=page_repository,
        settings=container.settings,
        audit=audit,
        logger=container.logger,
    )


def get_workflow_repository(
    session: Session = Depends(get_session),
) -> IWorkflowRepository:
    return SqlAlchemyWorkflowRepository(session)


def get_payment_gateway(container: Container = Depends(get_container)) -> IPaymentGateway:
    """Devuelve la pasarela de pago del container (sandbox determinista o Stripe)."""
    return container.payment_gateway


def get_quote_renderer(container: Container = Depends(get_container)) -> IQuoteRenderer:
    """Devuelve el renderer de cotizaciones (PDF) del container."""
    return container.quote_renderer


def get_calendar_provider(container: Container = Depends(get_container)) -> ICalendarProvider:
    """Devuelve el proveedor de calendario (ICS RFC 5545) del container."""
    return container.calendar_provider


def get_crm_webhook_sender(container: Container = Depends(get_container)) -> ICrmWebhookSender:
    """Devuelve el emisor de webhooks a CRM externo del container."""
    return container.crm_webhook_sender


def get_email_sender(container: Container = Depends(get_container)) -> IEmailSender:
    """Devuelve el emisor de correos SMTP del container."""
    return container.email_sender


def get_sms_sender(container: Container = Depends(get_container)) -> ISmsSender:
    """Devuelve el emisor de SMS (Twilio) del container."""
    return container.sms_sender


def get_whatsapp_sender(container: Container = Depends(get_container)) -> IWhatsAppSender:
    """Devuelve el emisor de WhatsApp (Cloud API de Meta) del container."""
    return container.whatsapp_sender


def get_google_calendar_provider(
    container: Container = Depends(get_container),
) -> IGoogleCalendarProvider:
    """Devuelve el proveedor de Google Calendar (OAuth 2.0 + REST) del container."""
    return container.google_calendar_provider


def get_workflow_service(
    repository: IWorkflowRepository = Depends(get_workflow_repository),
    audit: IAuditService = Depends(get_audit_service),
    payment_gateway: IPaymentGateway = Depends(get_payment_gateway),
    quote_renderer: IQuoteRenderer = Depends(get_quote_renderer),
    calendar_provider: ICalendarProvider = Depends(get_calendar_provider),
    crm_webhook_sender: ICrmWebhookSender = Depends(get_crm_webhook_sender),
    email_sender: IEmailSender = Depends(get_email_sender),
    sms_sender: ISmsSender = Depends(get_sms_sender),
    whatsapp_sender: IWhatsAppSender = Depends(get_whatsapp_sender),
    container: Container = Depends(get_container),
) -> IWorkflowService:
    return WorkflowService(
        repository=repository,
        audit=audit,
        logger=container.logger,
        payment_gateway=payment_gateway,
        quote_renderer=quote_renderer,
        calendar_provider=calendar_provider,
        crm_webhook_sender=crm_webhook_sender,
        email_sender=email_sender,
        sms_sender=sms_sender,
        whatsapp_sender=whatsapp_sender,
        artifacts_dir=container.settings.workflow_artifacts_dir,
    )


def get_current_tenant(
    request: Request,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    session: Session = Depends(get_session),
    tenant_repository: ITenantRepository = Depends(get_tenant_repository),
) -> uuid.UUID:
    """Resuelve y fija el tenant activo del request (UUID o slug).

    - Cabecera ausente → :class:`TenantIsolationError` (403).
    - UUID válido → se usa directamente.
    - Slug → se resuelve contra la tabla ``tenants`` (404 si no existe).
    - Se fija en ``RequestContext`` y como GUC para RLS en PostgreSQL.
    """
    if not x_tenant_id or not x_tenant_id.strip():
        raise TenantIsolationError(
            "La cabecera X-Tenant-Id es requerida",
            operation="tenant.resolve",
            context={"header": "X-Tenant-Id"},
        )

    try:
        tenant_id = uuid.UUID(x_tenant_id.strip())
    except (ValueError, AttributeError):
        tenant = tenant_repository.get_by_slug(x_tenant_id.strip())
        if tenant is None:
            raise TenantIsolationError(
                "Tenant no encontrado para el slug indicado",
                operation="tenant.resolve",
                context={"x_tenant_id": x_tenant_id},
            ) from None
        tenant_id = tenant.id

    tenant_id_str = str(tenant_id)
    # Comunica el tenant resuelto a la auditoría exterior vía request.state: el
    # contextvar no atraviesa los hilos de los sync deps/endpoints (se pierde el
    # set), mientras que request.state es un State compartido por scope.
    request.state.tenant_id = tenant_id
    RequestContext.set_tenant(tenant_id_str)
    # Aplica el GUC a la transacción ya abierta (RLS de PostgreSQL).
    set_app_current_tenant(session.connection(), tenant_id_str)
    return tenant_id


def get_pseo_tenant_by_host(
    request: Request,
    host: str | None = Header(default=None, alias="Host"),
    session: Session = Depends(get_session),
    host_repository: IPseoHostRepository = Depends(get_pseo_host_repository),
) -> uuid.UUID:
    """Resuelve el tenant del request público PSEO a partir de la cabecera ``Host``.

    Serving público (sin ``X-Tenant-Id``): consulta el mapeo ``pseo_hosts``.
    Host ausente o no registrado → :class:`NotFoundError` (404), sin filtrar la
    existencia de otros tenants (no hay leak 403). Fija el tenant en
    ``request.state`` / ``RequestContext`` y aplica el GUC para RLS (misma
    semántica que ``get_current_tenant``, pero por Host).
    """
    if not host or not host.strip():
        raise NotFoundError(
            "Host ausente para el serving público PSEO",
            operation="pseo.host.resolve",
            context={"header": "Host"},
        )

    host_row = host_repository.get_by_host(host=host.strip())
    if host_row is None:
        raise NotFoundError(
            "Host no registrado para el serving público PSEO",
            operation="pseo.host.resolve",
            context={"host": host.strip()},
        )

    tenant_id = host_row.tenant_id
    tenant_id_str = str(tenant_id)
    request.state.tenant_id = tenant_id
    RequestContext.set_tenant(tenant_id_str)
    set_app_current_tenant(session.connection(), tenant_id_str)
    return tenant_id
