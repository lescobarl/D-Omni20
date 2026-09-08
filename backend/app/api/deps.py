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
from collections.abc import Callable, Iterator

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.bot.channels import WhatsAppCloudChannelAdapter
from app.bot.channels.factory import ChannelSenderFactory
from app.bot.context_bundle import IContextBundleClient
from app.bot.context_bundle_service import ContextBundleService
from app.bot.governance import IPrivacyService, IQuotaService
from app.bot.interfaces import IChannelAdapter, IConversationService
from app.bot.queue.service import BotQueueService
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotProviderRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.bot.repository_interfaces import (
    IBotConversationRepository,
    IBotMessageRepository,
    IBotProviderRepository,
    IBotQueueMetaRepository,
)
from app.core.di import Container, build_container
from app.core.errors import (
    ForbiddenError,
    NotFoundError,
    TenantIsolationError,
    UnauthorizedError,
)
from app.core.tenancy import RequestContext, set_app_current_tenant
from app.models.user import Role, User
from app.repositories.ads_interfaces import IAdsRepository
from app.repositories.ads_repositories import SqlAlchemyAdsRepository
from app.repositories.crm_interfaces import (
    IDealRepository,
    IFunnelRepository,
    ISlaRepository,
    IStageRepository,
    ITaskRepository,
)
from app.repositories.crm_repositories import (
    SqlAlchemyDealRepository,
    SqlAlchemyFunnelRepository,
    SqlAlchemySlaRepository,
    SqlAlchemyStageRepository,
    SqlAlchemyTaskRepository,
)
from app.repositories.interfaces import (
    IAnalyticsRepository,
    IAuditRepository,
    ICatalogItemRepository,
    ICdnDeploymentRepository,
    IContentItemRepository,
    IDocumentRepository,
    IKeywordRepository,
    ILandingRepository,
    IMarketplaceRepository,
    IMembershipRepository,
    IPortalPageRepository,
    IUserRepository,
    IPseoBatchRepository,
    IPseoHostRepository,
    IPseoPageRepository,
    IRebrandingConfigRepository,
    ISchemaRepository,
    ISchemaVersionRepository,
    ISynonymRepository,
    ITenantAppearanceRepository,
    ITenantChannelRepository,
    ITenantRepository,
)
from app.repositories.operations_interfaces import (
    ICampaignRecipientRepository,
    ICampaignRepository,
    IContactRepository,
    IInterventionRepository,
    IMaintenanceConfigRepository,
    INavigationTreeRepository,
    IOperationsStatsRepository,
    IRecipientFileRepository,
    ITemplateRepository,
)
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAnalyticsRepository,
    SqlAlchemyAuditRepository,
    SqlAlchemyCampaignRecipientRepository,
    SqlAlchemyCampaignRepository,
    SqlAlchemyRecipientFileRepository,
    SqlAlchemyCatalogItemRepository,
    SqlAlchemyCdnDeploymentRepository,
    SqlAlchemyContactRepository,
    SqlAlchemyContentItemRepository,
    SqlAlchemyDocumentRepository,
    SqlAlchemyInterventionRepository,
    SqlAlchemyKeywordRepository,
    SqlAlchemyLandingRepository,
    SqlAlchemyMaintenanceConfigRepository,
    SqlAlchemyMembershipRepository,
    SqlAlchemyPortalPageRepository,
    SqlAlchemyMarketplaceRepository,
    SqlAlchemyNavigationTreeRepository,
    SqlAlchemyOperationsStatsRepository,
    SqlAlchemyPseoBatchRepository,
    SqlAlchemyPseoHostRepository,
    SqlAlchemyPseoPageRepository,
    SqlAlchemyRebrandingConfigRepository,
    SqlAlchemySchemaRepository,
    SqlAlchemySchemaVersionRepository,
    SqlAlchemySynonymRepository,
    SqlAlchemyTemplateRepository,
    SqlAlchemyTenantAppearanceRepository,
    SqlAlchemyTenantChannelRepository,
    SqlAlchemyTenantRepository,
    SqlAlchemyUserRepository,
)
from app.repositories.workflow_interfaces import IWorkflowRepository
from app.repositories.workflow_repositories import SqlAlchemyWorkflowRepository
from app.services.ads_service import AdsService
from app.services.audit_service import AuditService
from app.services.auth_service import AuthService
from app.services.campaign_service import ICampaignDispatcher
from app.services.maintenance_service import IMaintenanceService
from app.services.cdn_deployment_service import CdnDeploymentService
from app.services.compiler_service import JinjaCompilerService
from app.services.crm_interfaces import ICrmEventPublisher
from app.services.crm_service import CrmEventPublisher, CrmService
from app.services.data_matrix_service import DataMatrixService
from app.services.dns_verifier import AutoDnsVerifier, DnsVerifier
from app.services.interfaces import (
    IAdsService,
    IAiService,
    IAuditService,
    IAuthService,
    ICdnDeploymentService,
    ICompilerService,
    ICrmService,
    IDataMatrixService,
    IDnsVerifier,
    ILandingService,
    IPortalPageService,
    IPseoHostService,
    IPseoService,
    IRebrandingService,
    ISchemaGenerationService,
    ISchemaValidator,
)
from app.services.landing_service import LandingService
from app.services.portal_page_service import PortalPageService
from app.services.pseo_host_service import PseoHostService
from app.services.pseo_service import PseoService
from app.services.rebranding_service import RebrandingService
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
    IWhatsAppSenderFactory,
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


def get_portal_page_repository(
    session: Session = Depends(get_session),
) -> IPortalPageRepository:
    return SqlAlchemyPortalPageRepository(session)


def get_ad_campaign_repository(
    session: Session = Depends(get_session),
) -> IAdsRepository:
    return SqlAlchemyAdsRepository(session)


def get_audit_repository(session: Session = Depends(get_session)) -> IAuditRepository:
    return SqlAlchemyAuditRepository(session)


def get_audit_service(
    repository: IAuditRepository = Depends(get_audit_repository),
    container: Container = Depends(get_container),
) -> IAuditService:
    return AuditService(repository=repository, logger=container.logger)


def get_user_repository(session: Session = Depends(get_session)) -> IUserRepository:
    """Repositorio de usuarios del estudio (control-plane, sin RLS)."""
    return SqlAlchemyUserRepository(session)


def get_membership_repository(
    session: Session = Depends(get_session),
) -> IMembershipRepository:
    """Repositorio de membresías usuario↔tenant (RBAC por tenant, sin RLS)."""
    return SqlAlchemyMembershipRepository(session)


def get_auth_service(
    user_repository: IUserRepository = Depends(get_user_repository),
    container: Container = Depends(get_container),
) -> IAuthService:
    """Servicio de autenticación compuesto por request (repositorio sesión-scoped)."""
    return AuthService(
        user_repository=user_repository,
        settings=container.settings,
        logger=container.logger,
    )


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


def get_cdn_deployment_service(
    repository: ICdnDeploymentRepository = Depends(get_cdn_deployment_repository),
    landing_repository: ILandingRepository = Depends(get_landing_repository),
    tenant_repository: ITenantRepository = Depends(get_tenant_repository),
    compiler: ICompilerService = Depends(get_compiler_service),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> ICdnDeploymentService:
    """Servicio de despliegue al CDN compuesto por request (repo session-scoped)."""
    return CdnDeploymentService(
        repository=repository,
        landing_repository=landing_repository,
        tenant_repository=tenant_repository,
        compiler=compiler,
        settings=container.settings,
        audit=audit,
        logger=container.logger,
    )


def get_landing_service(
    repository: ILandingRepository = Depends(get_landing_repository),
    audit: IAuditService = Depends(get_audit_service),
    compiler: ICompilerService = Depends(get_compiler_service),
    cdn: ICdnDeploymentService = Depends(get_cdn_deployment_service),
    container: Container = Depends(get_container),
) -> ILandingService:
    return LandingService(
        repository=repository,
        audit=audit,
        compiler=compiler,
        cdn=cdn,
        logger=container.logger,
    )


def get_portal_page_service(
    repository: IPortalPageRepository = Depends(get_portal_page_repository),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> IPortalPageService:
    return PortalPageService(
        repository=repository,
        audit=audit,
        logger=container.logger,
    )


def get_ads_service(
    repository: IAdsRepository = Depends(get_ad_campaign_repository),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> IAdsService:
    return AdsService(
        repository=repository,
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


def get_pseo_host_service(
    host_repository: IPseoHostRepository = Depends(get_pseo_host_repository),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> IPseoHostService:
    """Servicio de dominios personalizados compuesto por request.

    Selecciona el verificador DNS según ``dns_verify_mode``:
    ``auto`` (dev/tests, sin dnspython) o ``dns`` (TXT real vía dnspython).
    """
    verifier: IDnsVerifier = (
        AutoDnsVerifier()
        if container.settings.dns_verify_mode == "auto"
        else DnsVerifier()
    )
    return PseoHostService(
        host_repository=host_repository,
        dns_verifier=verifier,
        audit=audit,
        logger=container.logger,
    )


def get_workflow_repository(
    session: Session = Depends(get_session),
) -> IWorkflowRepository:
    return SqlAlchemyWorkflowRepository(session)


def get_contact_repository(
    session: Session = Depends(get_session),
) -> IContactRepository:
    """Repositorio del directorio de contactos del bot (B.6)."""
    return SqlAlchemyContactRepository(session)


def get_stage_repository(session: Session = Depends(get_session)) -> IStageRepository:
    """Repositorio de etapas del pipeline CRM (M1) acotado al tenant."""
    return SqlAlchemyStageRepository(session)


def get_deal_repository(session: Session = Depends(get_session)) -> IDealRepository:
    """Repositorio de oportunidades del pipeline CRM (M1) acotado al tenant."""
    return SqlAlchemyDealRepository(session)


def get_task_repository(session: Session = Depends(get_session)) -> ITaskRepository:
    """Repositorio de tareas de seguimiento CRM (M2) acotado al tenant."""
    return SqlAlchemyTaskRepository(session)


def get_sla_repository(session: Session = Depends(get_session)) -> ISlaRepository:
    """Repositorio de políticas SLA por etapa (M5) acotado al tenant."""
    return SqlAlchemySlaRepository(session)


def get_funnel_repository(session: Session = Depends(get_session)) -> IFunnelRepository:
    """Repositorio de agregación del embudo comercial (M4) acotado al tenant."""
    return SqlAlchemyFunnelRepository(session)


def get_crm_service(
    stage_repository: IStageRepository = Depends(get_stage_repository),
    deal_repository: IDealRepository = Depends(get_deal_repository),
    task_repository: ITaskRepository = Depends(get_task_repository),
    sla_repository: ISlaRepository = Depends(get_sla_repository),
    funnel_repository: IFunnelRepository = Depends(get_funnel_repository),
    contact_repository: IContactRepository = Depends(get_contact_repository),
    audit: IAuditService = Depends(get_audit_service),
    container: Container = Depends(get_container),
) -> ICrmService:
    """Servicio de caso de uso del subsistema CRM compuesto por request
    (repositorios session-scoped; infraestructura provista por el container)."""
    return CrmService(
        stage_repository=stage_repository,
        deal_repository=deal_repository,
        task_repository=task_repository,
        sla_repository=sla_repository,
        funnel_repository=funnel_repository,
        contact_repository=contact_repository,
        audit=audit,
        logger=container.logger,
    )


def get_crm_event_publisher(
    crm_service: ICrmService = Depends(get_crm_service),
) -> ICrmEventPublisher:
    """Emisor de eventos de orquestación hacia el CRM (delega en CrmService)."""
    return CrmEventPublisher(crm_service=crm_service)


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


def get_channel_sender_factory(
    container: Container = Depends(get_container),
    session: Session = Depends(get_session),
) -> IWhatsAppSenderFactory:
    """Fábrica tenant-aware ligada a la sesión del request (Fase 6.1).

    Se construye por request con la sesión activa para reutilizar la
    transacción ya abierta (``get_current_tenant`` inicia ``BEGIN IMMEDIATE``
    en SQLite): un segundo escritor con sesión propia haría deadlock en SQLite;
    en PostgreSQL (MVCC) es agnóstico al dialecto. El singleton
    ``container.channel_sender_factory`` (sin sesión ligada) se conserva para
    el worker de la cola D3, que no vive dentro de un request HTTP.
    """
    return ChannelSenderFactory(
        database=container.database,
        settings=container.settings,
        logger=container.logger,
        cipher=container.token_cipher,
        session=session,
    )


def get_workflow_service(
    repository: IWorkflowRepository = Depends(get_workflow_repository),
    audit: IAuditService = Depends(get_audit_service),
    payment_gateway: IPaymentGateway = Depends(get_payment_gateway),
    quote_renderer: IQuoteRenderer = Depends(get_quote_renderer),
    calendar_provider: ICalendarProvider = Depends(get_calendar_provider),
    crm_webhook_sender: ICrmWebhookSender = Depends(get_crm_webhook_sender),
    email_sender: IEmailSender = Depends(get_email_sender),
    sms_sender: ISmsSender = Depends(get_sms_sender),
    whatsapp_sender_factory: IWhatsAppSenderFactory = Depends(get_channel_sender_factory),
    contact_repository: IContactRepository = Depends(get_contact_repository),
    ad_campaign_repository: IAdsRepository = Depends(get_ad_campaign_repository),
    crm_event_publisher: ICrmEventPublisher = Depends(get_crm_event_publisher),
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
        whatsapp_sender_factory=whatsapp_sender_factory,
        contact_repository=contact_repository,
        ads_repository=ad_campaign_repository,
        crm_event_publisher=crm_event_publisher,
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

    slug_resolved = False
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
        slug_resolved = True

    tenant_id_str = str(tenant_id)
    # Comunica el tenant resuelto a la auditoría exterior vía request.state: el
    # contextvar no atraviesa los hilos de los sync deps/endpoints (se pierde el
    # set), mientras que request.state es un State compartido por scope.
    request.state.tenant_id = tenant_id
    RequestContext.set_tenant(tenant_id_str)
    # UUID: el GUC se aplica de forma perezosa por el evento ``after_begin`` de
    # la sesión (lee ``RequestContext.tenant_id()``, ya fijado antes de que la
    # sesión abra su transacción). Se evita así abrir una transacción de
    # escritura (``BEGIN IMMEDIATE`` en SQLite) que bloquearía a otras sesiones
    # sobre el mismo archivo durante todo el request.
    if slug_resolved:
        # Slug: la sesión ya inició transacción al resolver el slug (antes de
        # fijar el contextvar); se aplica el GUC a esa transacción ya abierta.
        set_app_current_tenant(session.connection(), tenant_id_str)
    return tenant_id


_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: Session = Depends(get_session),
    user_repository: IUserRepository = Depends(get_user_repository),
    auth_service: IAuthService = Depends(get_auth_service),
) -> User:
    """Valida el Bearer JWT, carga el ``User`` y puebla ``RequestContext.set_user``.

    - Sin credenciales o token inválido/expirado → :class:`UnauthorizedError` (401).
    - Usuario inactivo o inexistente → :class:`UnauthorizedError` (401).
    - Fija ``request.state.user_id`` y ``RequestContext.set_user`` para auditoría.
    """
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError(
            "Credenciales de autenticación requeridas",
            operation="auth.current_user",
            context={"scheme": "bearer"},
        )
    try:
        user_id = auth_service.decode_token(credentials.credentials)
    except UnauthorizedError as exc:
        raise UnauthorizedError(
            "Token de acceso inválido o expirado",
            operation="auth.current_user",
            context={"detail": str(exc)},
        ) from exc

    user = user_repository.get_by_id(user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError(
            "Usuario no encontrado o inactivo",
            operation="auth.current_user",
            context={"user_id": str(user_id)},
        )

    # Comunica el usuario autenticado a la auditoría exterior (misma semántica
    # que el tenant: el contextvar no atraviesa los hilos de los sync deps).
    request.state.user_id = str(user.id)
    RequestContext.set_user(str(user.id))
    return user


def require_role(*roles: Role) -> Callable:
    """Devuelve una dependencia que exige uno de los ``roles`` en el tenant activo.

    - Super-admin: bypass (acceso total a cualquier tenant).
    - Miembro del tenant con rol en ``roles`` → autorizado.
    - Sin membresía o rol no permitido → :class:`ForbiddenError` (403).
    """

    def _dependency(
        user: User = Depends(get_current_user),
        tenant_id: uuid.UUID = Depends(get_current_tenant),
        membership_repository: IMembershipRepository = Depends(
            get_membership_repository
        ),
    ) -> User:
        if user.is_super_admin:
            return user
        membership = membership_repository.get_by_user_and_tenant(
            user_id=user.id,
            tenant_id=tenant_id,
        )
        if membership is None or membership.role not in roles:
            raise ForbiddenError(
                "No tiene permisos para esta operación en el tenant activo",
                operation="rbac.require_role",
                context={
                    "user_id": str(user.id),
                    "tenant_id": str(tenant_id),
                    "required_roles": [r.value for r in roles],
                    "actual_role": membership.role.value if membership else None,
                },
            )
        return user

    return _dependency


def require_super_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Exige ``is_super_admin=True`` (control-plane: tenants, users, membresías)."""
    if not user.is_super_admin:
        raise ForbiddenError(
            "Se requieren privilegios de super-admin (control-plane)",
            operation="rbac.require_super_admin",
            context={"user_id": str(user.id)},
        )
    return user


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

    # Normaliza el Host: la cabecera puede incluir el puerto (p. ej.
    # ``acme.clientes.omni2.app:8000`` en desarrollo local, donde el backend
    # escucha en un puerto no estándar). El mapeo ``pseo_hosts`` se registra sin
    # puerto para los subdominios de clientes, pero el host de desarrollo se
    # registra CON puerto (``localhost:8000``). Para resolver ambos casos se
    # intenta primero el host sin puerto y, si no coincide, el host original.
    raw_host = host.strip().lower()
    host_name = raw_host
    if ":" in host_name and not host_name.startswith("["):
        host_name = host_name.split(":", 1)[0]

    host_row = host_repository.get_by_host(host=host_name)
    if host_row is None and host_name != raw_host:
        host_row = host_repository.get_by_host(host=raw_host)
    if host_row is None:
        raise NotFoundError(
            "Host no registrado para el serving público PSEO",
            operation="pseo.host.resolve",
            context={"host": raw_host},
        )

    if host_row.deleted or host_row.status != "active":
        # Fail-closed: solo hosts verificados/activos son servidos públicamente.
        raise NotFoundError(
            "Host no activo para el serving público PSEO",
            operation="pseo.host.resolve",
            context={"host": host_name, "status": host_row.status},
        )

    tenant_id = host_row.tenant_id
    tenant_id_str = str(tenant_id)
    request.state.tenant_id = tenant_id
    RequestContext.set_tenant(tenant_id_str)
    set_app_current_tenant(session.connection(), tenant_id_str)
    return tenant_id


def get_tenant_appearance_repository(
    session: Session = Depends(get_session),
) -> ITenantAppearanceRepository:
    """Repositorio de apariencia del tenant (paleta, logo, tipografía)."""
    return SqlAlchemyTenantAppearanceRepository(session)


def get_rebranding_config_repository(
    session: Session = Depends(get_session),
) -> IRebrandingConfigRepository:
    """Repositorio de configuraciones de rebranding por URL (Fase 5)."""
    return SqlAlchemyRebrandingConfigRepository(session)


def get_rebranding_service(
    container: Container = Depends(get_container),
) -> IRebrandingService:
    """Servicio de extracción de estilos por URL (Fase 5), compuesto por request."""
    return RebrandingService(
        settings=container.settings,
        logger=container.logger,
    )


def get_content_item_repository(
    session: Session = Depends(get_session),
) -> IContentItemRepository:
    """Repositorio de contenido estructurado del bot (saludos, menús, FAQs)."""
    return SqlAlchemyContentItemRepository(session)


def get_document_repository(
    session: Session = Depends(get_session),
) -> IDocumentRepository:
    """Repositorio de documentos ingeridos para la base de conocimiento (RAG)."""
    return SqlAlchemyDocumentRepository(session)


def get_synonym_repository(
    session: Session = Depends(get_session),
) -> ISynonymRepository:
    """Repositorio de sinónimos del bot (normalización de vocabulario)."""
    return SqlAlchemySynonymRepository(session)


def get_keyword_repository(
    session: Session = Depends(get_session),
) -> IKeywordRepository:
    """Repositorio de keywords del bot (prioridades deterministas)."""
    return SqlAlchemyKeywordRepository(session)


def get_catalog_item_repository(
    session: Session = Depends(get_session),
) -> ICatalogItemRepository:
    """Repositorio del catálogo de productos/servicios del tenant."""
    return SqlAlchemyCatalogItemRepository(session)


def get_tenant_channel_repository(
    session: Session = Depends(get_session),
    container: Container = Depends(get_container),
) -> ITenantChannelRepository:
    """Repositorio de canales del bot con secretos cifrados en reposo."""
    return SqlAlchemyTenantChannelRepository(session, cipher=container.token_cipher)


def get_template_repository(
    session: Session = Depends(get_session),
) -> ITemplateRepository:
    """Repositorio de plantillas de mensaje del bot (B.5)."""
    return SqlAlchemyTemplateRepository(session)


def get_navigation_tree_repository(
    session: Session = Depends(get_session),
) -> INavigationTreeRepository:
    """Repositorio de árboles de navegación del bot (B.3)."""
    return SqlAlchemyNavigationTreeRepository(session)


def get_campaign_repository(
    session: Session = Depends(get_session),
) -> ICampaignRepository:
    """Repositorio de campañas de envío del bot (B.4)."""
    return SqlAlchemyCampaignRepository(session)


def get_campaign_recipient_repository(
    session: Session = Depends(get_session),
) -> ICampaignRecipientRepository:
    """Repositorio de destinatarios de campaña del bot (B.4)."""
    return SqlAlchemyCampaignRecipientRepository(session)


def get_recipient_file_repository(
    session: Session = Depends(get_session),
) -> IRecipientFileRepository:
    """Repositorio de archivos de destinatarios reutilizables (GAP 2)."""
    return SqlAlchemyRecipientFileRepository(session)


def get_campaign_dispatcher(
    container: Container = Depends(get_container),
) -> ICampaignDispatcher:
    """Dispatcher de campañas (C-2) — singleton del contenedor DI."""
    return container.campaign_dispatcher


def get_intervention_repository(
    session: Session = Depends(get_session),
) -> IInterventionRepository:
    """Repositorio de intervenciones humanas del bot (B.7)."""
    return SqlAlchemyInterventionRepository(session)


def get_maintenance_config_repository(
    session: Session = Depends(get_session),
) -> IMaintenanceConfigRepository:
    """Repositorio de configuración de mantenimiento del bot (B.9)."""
    return SqlAlchemyMaintenanceConfigRepository(session)


def get_operations_stats_repository(
    session: Session = Depends(get_session),
) -> IOperationsStatsRepository:
    """Repositorio de estadísticas agregadas del bot (B.1 + B.2)."""
    return SqlAlchemyOperationsStatsRepository(session)


def get_context_bundle_client(
    container: Container = Depends(get_container),
) -> IContextBundleClient:
    """Cliente m2m del context bundle del bot (resuelve config por canal)."""
    return container.context_bundle_client


def require_service_credential(
    container: Container = Depends(get_container),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> str:
    """Autentica llamadas solo-máquina (m2m) con el service credential.

    Diseño (plan M1/G3): los endpoints m2m (p. ej. ``GET /bot/context/{id}``) NO
    llevan cabecera ``X-Tenant-Id``; se autentican contra
    ``settings.omni2_service_credential`` mediante ``Authorization: Bearer
    <token>``. Fail-closed: si el credential no está configurado o el token no
    coincide, se rechaza con :class:`TenantIsolationError` (403).
    """
    expected = container.settings.omni2_service_credential
    if not expected:
        raise TenantIsolationError(
            "El service credential m2m no está configurado",
            operation="bot.service.authenticate",
            context={"header": "Authorization"},
        )
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip() or token.strip() != expected:
        raise TenantIsolationError(
            "Service credential inválido o ausente",
            operation="bot.service.authenticate",
            context={"header": "Authorization"},
        )
    return token.strip()


def get_context_bundle_service(
    container: Container = Depends(get_container),
) -> ContextBundleService:
    """Servicio que construye el context bundle (corre en contexto de servicio)."""
    return container.context_bundle_service


def get_whatsapp_channel_adapter(
    container: Container = Depends(get_container),
) -> IChannelAdapter:
    """Adaptador del canal WhatsApp del bot (regla CLAUDE: sin ``new`` en routers)."""
    return WhatsAppCloudChannelAdapter(
        sender=container.whatsapp_sender,
        logger=container.logger,
    )


def get_bot_message_repository(
    session: Session = Depends(get_session),
) -> IBotMessageRepository:
    """Repositorio de mensajes del bot (fuente de verdad de la cola D3)."""
    return SqlAlchemyBotMessageRepository(session)


def get_bot_conversation_repository(
    session: Session = Depends(get_session),
) -> IBotConversationRepository:
    """Repositorio de conversaciones del bot (estado + última actividad)."""
    return SqlAlchemyBotConversationRepository(session)


def get_bot_provider_repository(
    session: Session = Depends(get_session),
) -> IBotProviderRepository:
    """Repositorio de proveedores de IA configurados por empresa (Fase 7)."""
    return SqlAlchemyBotProviderRepository(session)


def get_bot_queue_meta_repository(
    session: Session = Depends(get_session),
) -> IBotQueueMetaRepository:
    """Repositorio de metadatos de la cola D3 (streams + DLQ por tenant)."""
    return SqlAlchemyBotQueueMetaRepository(session)


def get_bot_queue_service(
    container: Container = Depends(get_container),
) -> BotQueueService:
    """Servicio de la cola D3: punto único de entrada del webhook del bot."""
    return container.bot_queue_service


def get_conversation_service(
    container: Container = Depends(get_container),
) -> IConversationService | None:
    """Servicio de conversación del bot (Fase 6) o ``None`` (Fase 5.1).

    El webhook y el worker usan este puerto; en Fase 5.1 aún no hay
    implementación concreta (``container.conversation_service`` devuelve
    ``None``), así que el worker queda dormant y el router confirma ``200``
    (frontera deliberada entre Fase 5.1 y Fase 6).
    """
    return container.conversation_service


def get_bot_quota_service(
    container: Container = Depends(get_container),
) -> IQuotaService:
    """Servicio de cuota de tokens del bot (Fase 9b, L1) — reporte agregado + alertas."""
    return container.bot_quota_service


def get_bot_privacy_service(
    container: Container = Depends(get_container),
) -> IPrivacyService:
    """Servicio de privacidad del bot (Fase 9a, M4 — LFPDPPP): portabilidad/cancelación/retención."""
    return container.bot_privacy_service


def get_maintenance_service(
    container: Container = Depends(get_container),
) -> IMaintenanceService:
    """Servicio de backup/restauración de la configuración de operación del bot (B.9)."""
    return container.maintenance_service
