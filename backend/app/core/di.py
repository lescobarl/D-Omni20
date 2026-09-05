"""Contenedor de dependencias (composition root) — regla CLAUDE: NO ``new``.

Contrato:
- Único lugar (junto con ``app.api.deps``) donde se componen dependencias.
- :class:`Container` expone singletons de infraestructura (logger, database,
  RLS) mediante propiedades perezosas; la lógica de negocio recibe puertos
  (ABC) y nunca instancia implementaciones.
- ``build_container`` es la fábrica única de arranque (FastAPI / tests / CLI).
"""

from __future__ import annotations

from app.bot.channels.factory import ChannelSenderFactory
from app.bot.context_bundle import HttpContextBundleClient, IContextBundleClient
from app.bot.context_bundle_service import ContextBundleService
from app.bot.conversation_service import ConversationService
from app.bot.governance import (
    BotPrivacyService,
    IPrivacyService,
    IQuotaService,
    TokenQuotaService,
)
from app.bot.interfaces import IConversationService
from app.bot.queue.redis_stream_queue import RedisStreamQueue
from app.bot.queue.service import BotQueueService
from app.bot.queue.worker import BotWorkerPool
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotQueueMetaRepository,
)
from app.config.settings import Settings, get_settings
from app.core.database import Database
from app.core.encryption import TokenCipher
from app.core.logging import ILogger, build_logger
from app.core.rls import RLSManager
from app.repositories.interfaces import IOAuthTokenStore
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyCampaignRecipientRepository,
    SqlAlchemyCampaignRepository,
    SqlAlchemyContactRepository,
    SqlAlchemyKeywordRepository,
    SqlAlchemyOAuthTokenStore,
    SqlAlchemyRecipientFileRepository,
)
from app.repositories.workflow_repositories import SqlAlchemyWorkflowRepository
from app.services.ai_service import DeepSeekGenerationService, LruAiResponseCache
from app.services.audit_service import AuditService
from app.services.crm_adapters import build_crm_adapter
from app.services.email_template_service import EmailTemplateService
from app.services.interfaces import IAiResponseCache, IAiService
from app.services.providers import (
    CalendarIcsProvider,
    CrmWebhookSender,
    GoogleCalendarProvider,
    PdfQuoteRenderer,
    SandboxPaymentGateway,
    SmtpEmailSender,
    StripePaymentGateway,
    TwilioSmsSender,
    WhatsAppCloudSender,
)
from app.services.campaign_service import CampaignDispatcher, ICampaignDispatcher
from app.services.maintenance_service import IMaintenanceService, MaintenanceService
from app.services.scheduler_service import IReminderScheduler, SchedulerService
from app.services.workflow_interfaces import (
    ICalendarProvider,
    ICrmWebhookSender,
    IEmailSender,
    IGoogleCalendarProvider,
    IPaymentGateway,
    IQuoteRenderer,
    ISmsSender,
    IWhatsAppSender,
)
from app.services.workflow_service import WorkflowService


class Container:
    """Composition root de la aplicación (singletons de infraestructura).

    La caché de IA y el servicio de IA son singletons *app-scoped*: se crean una
    sola vez por arranque y se comparten entre todos los requests, de modo que la
    caché realmente acierte (una caché por request jamás tendría hits).
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._logger: ILogger | None = None
        self._database: Database | None = None
        self._rls: RLSManager | None = None
        self._ai_cache: IAiResponseCache | None = None
        self._ai_service: IAiService | None = None
        self._payment_gateway: IPaymentGateway | None = None
        self._quote_renderer: IQuoteRenderer | None = None
        self._crm_webhook_sender: ICrmWebhookSender | None = None
        self._email_sender: IEmailSender | None = None
        self._email_template_service: EmailTemplateService | None = None
        self._sms_sender: ISmsSender | None = None
        self._whatsapp_sender: IWhatsAppSender | None = None
        self._google_calendar_provider: IGoogleCalendarProvider | None = None
        self._scheduler: IReminderScheduler | None = None
        self._campaign_dispatcher: ICampaignDispatcher | None = None
        self._token_cipher: TokenCipher | None = None
        self._context_bundle_client: IContextBundleClient | None = None
        self._context_bundle_service: ContextBundleService | None = None
        self._queue: RedisStreamQueue | None = None
        self._bot_queue_service: BotQueueService | None = None
        self._bot_worker_pool: BotWorkerPool | None = None
        self._conversation_service: IConversationService | None = None
        self._channel_sender_factory: ChannelSenderFactory | None = None
        self._bot_quota_service: IQuotaService | None = None
        self._bot_privacy_service: IPrivacyService | None = None
        self._maintenance_service: IMaintenanceService | None = None

    @property
    def logger(self) -> ILogger:
        if self._logger is None:
            self._logger = build_logger("omnibotia", self.settings)
        return self._logger

    @property
    def database(self) -> Database:
        if self._database is None:
            self._database = Database(self.settings.database_url)
        return self._database

    @property
    def rls(self) -> RLSManager:
        if self._rls is None:
            self._rls = RLSManager()
        return self._rls

    @property
    def ai_cache(self) -> IAiResponseCache:
        """Caché de IA app-scoped (LRU con TTL configurable por settings)."""
        if self._ai_cache is None:
            self._ai_cache = LruAiResponseCache(max_entries=self.settings.ai_cache_max_entries)
        return self._ai_cache

    @property
    def ai_service(self) -> IAiService:
        """Servicio de generación IA app-scoped (cliente HTTP reutilizable)."""
        if self._ai_service is None:
            self._ai_service = DeepSeekGenerationService(
                settings=self.settings,
                cache=self.ai_cache,
                logger=self.logger,
            )
        return self._ai_service

    @property
    def payment_gateway(self) -> IPaymentGateway:
        """Pasarela de pago según ``payment_mode`` (sandbox determinista o Stripe)."""
        if self._payment_gateway is None:
            if self.settings.payment_mode == "sandbox":
                self._payment_gateway = SandboxPaymentGateway(
                    checkout_base_url=self.settings.workflow_checkout_base_url,
                    logger=self.logger,
                )
            else:
                self._payment_gateway = StripePaymentGateway(
                    secret_key=self.settings.stripe_secret_key,
                    webhook_secret=self.settings.stripe_webhook_secret,
                    checkout_success_url=self.settings.stripe_checkout_success_url,
                    checkout_cancel_url=self.settings.stripe_checkout_cancel_url,
                    timeout_seconds=self.settings.stripe_timeout_seconds,
                    logger=self.logger,
                )
        return self._payment_gateway

    @property
    def quote_renderer(self) -> IQuoteRenderer:
        """Renderer de cotizaciones (PDF) con artefactos servidos por URL."""
        if self._quote_renderer is None:
            self._quote_renderer = PdfQuoteRenderer(
                artifacts_dir=self.settings.workflow_artifacts_dir,
                base_url=self.settings.workflow_artifacts_base_url,
                logger=self.logger,
            )
        return self._quote_renderer

    @property
    def calendar_provider(self) -> ICalendarProvider:
        """Proveedor de calendario (ICS local + Google Calendar si hay OAuth)."""
        return self.google_calendar_provider

    @property
    def email_template_service(self) -> EmailTemplateService:
        """Renderizador de plantillas Jinja2 de email (Fase 4 del backlog)."""
        if self._email_template_service is None:
            self._email_template_service = EmailTemplateService(
                templates_dir=self.settings.email_templates_dir,
                logger=self.logger,
            )
        return self._email_template_service

    @property
    def email_sender(self) -> IEmailSender:
        """Emisor de correos SMTP (no-op si no hay host configurado)."""
        if self._email_sender is None:
            self._email_sender = SmtpEmailSender(
                host=self.settings.smtp_host,
                port=self.settings.smtp_port,
                username=self.settings.smtp_username,
                password=self.settings.smtp_password,
                from_email=self.settings.smtp_from_email,
                use_tls=self.settings.smtp_use_tls,
                timeout_seconds=self.settings.smtp_timeout_seconds,
                logger=self.logger,
                template_service=self.email_template_service,
            )
        return self._email_sender

    @property
    def sms_sender(self) -> ISmsSender:
        """Emisor de SMS vía Twilio (no-op si no hay credenciales)."""
        if self._sms_sender is None:
            self._sms_sender = TwilioSmsSender(
                account_sid=self.settings.twilio_account_sid,
                auth_token=self.settings.twilio_auth_token,
                from_phone=self.settings.twilio_phone_number,
                timeout_seconds=self.settings.twilio_timeout_seconds,
                logger=self.logger,
            )
        return self._sms_sender

    @property
    def whatsapp_sender(self) -> IWhatsAppSender:
        """Emisor de WhatsApp Cloud API (no-op si no hay credenciales)."""
        if self._whatsapp_sender is None:
            self._whatsapp_sender = WhatsAppCloudSender(
                phone_number_id=self.settings.whatsapp_phone_number_id,
                access_token=self.settings.whatsapp_access_token,
                webhook_secret=self.settings.whatsapp_webhook_secret,
                timeout_seconds=self.settings.whatsapp_timeout_seconds,
                base_url=self.settings.whatsapp_base_url,
                logger=self.logger,
            )
        return self._whatsapp_sender

    @property
    def context_bundle_client(self) -> IContextBundleClient:
        """Cliente m2m del context bundle del bot (resuelve config por canal)."""
        if self._context_bundle_client is None:
            self._context_bundle_client = HttpContextBundleClient(
                base_url=self.settings.omni2_api_base_url,
                service_credential=self.settings.omni2_service_credential,
                timeout_seconds=self.settings.bot_context_timeout_seconds,
                logger=self.logger,
            )
        return self._context_bundle_client

    @property
    def token_cipher(self) -> TokenCipher | None:
        """Cifrador de secretos del tenant; ``None`` si no hay clave configurada."""
        if self._token_cipher is None and self.settings.token_encryption_key:
            self._token_cipher = TokenCipher(self.settings.token_encryption_key)
        return self._token_cipher

    @property
    def context_bundle_service(self) -> ContextBundleService:
        """Servicio que arma el context bundle en contexto de servicio (m2m)."""
        if self._context_bundle_service is None:
            self._context_bundle_service = ContextBundleService(
                database=self.database,
                cipher=self.token_cipher,
                logger=self.logger,
            )
        return self._context_bundle_service

    @property
    def channel_sender_factory(self) -> ChannelSenderFactory:
        """Fábrica tenant-aware de adaptadores/senders de canal (Fase 6.1).

        Resuelve el adaptador del canal por ``channel_id`` y el sender de
        WhatsApp por tenant desde ``tenant_channels`` (credenciales cifradas
        en reposo) para el envío multi-WABA sin fallback global.
        """
        if self._channel_sender_factory is None:
            self._channel_sender_factory = ChannelSenderFactory(
                database=self.database,
                settings=self.settings,
                logger=self.logger,
                cipher=self.token_cipher,
            )
        return self._channel_sender_factory

    @property
    def queue(self) -> RedisStreamQueue:
        """Cola D3 (Redis Streams) del bot — stream ``bot:queue:{tenant_id}``."""
        if self._queue is None:
            self._queue = RedisStreamQueue(settings=self.settings, logger=self.logger)
        return self._queue

    @property
    def bot_queue_service(self) -> BotQueueService:
        """Punto único de entrada del webhook: persiste en BD y encola en Redis.

        Los repositorios se inyectan por factoría para respetar la sesión de la
        transacción (regla CLAUDE: DI, sin ``new`` dentro del servicio).
        """
        if self._bot_queue_service is None:
            self._bot_queue_service = BotQueueService(
                database=self.database,
                queue=self.queue,
                message_repository_factory=lambda session: SqlAlchemyBotMessageRepository(session),
                conversation_repository_factory=lambda session: SqlAlchemyBotConversationRepository(session),
                queue_meta_repository_factory=lambda session: SqlAlchemyBotQueueMetaRepository(session),
                settings=self.settings,
                logger=self.logger,
            )
        return self._bot_queue_service

    @property
    def conversation_service(self) -> IConversationService:
        """Servicio de conversación del bot (Fase 6) — delega en workflows por DI.

        Un solo dueño por transacción: el bot invoca los servicios de workflows
        existentes (checkout, leads, cotizaciones, citas) vía ``IWorkflowService``.
        El worker de la cola D3 usa este servicio como procesador (Fase 6.1
        conecta el adaptador de envío concreto por tenant).
        """
        if self._conversation_service is None:
            self._conversation_service = ConversationService(
                database=self.database,
                context_bundle_service=self.context_bundle_service,
                settings=self.settings,
                logger=self.logger,
                conversation_repository_factory=lambda session: SqlAlchemyBotConversationRepository(session),
                message_repository_factory=lambda session: SqlAlchemyBotMessageRepository(session),
                keyword_repository_factory=lambda session: SqlAlchemyKeywordRepository(session),
                audit_service_factory=lambda session: AuditService(
                    repository=SqlAlchemyAuditRepository(session),
                    logger=self.logger,
                ),
                workflow_service_factory=lambda session: WorkflowService(
                    repository=SqlAlchemyWorkflowRepository(session),
                    audit=AuditService(
                        repository=SqlAlchemyAuditRepository(session),
                        logger=self.logger,
                    ),
                    logger=self.logger,
                    payment_gateway=self.payment_gateway,
                    quote_renderer=self.quote_renderer,
                    calendar_provider=self.calendar_provider,
                    crm_webhook_sender=self.crm_webhook_sender,
                    email_sender=self.email_sender,
                    sms_sender=self.sms_sender,
                    whatsapp_sender_factory=self.channel_sender_factory,
                    artifacts_dir=self.settings.workflow_artifacts_dir,
                ),
            )
        return self._conversation_service

    @property
    def bot_quota_service(self) -> IQuotaService:
        """Cuota de tokens por tenant (Fase 9b, L1) — reporte agregado + alertas."""
        if self._bot_quota_service is None:
            self._bot_quota_service = TokenQuotaService(
                database=self.database,
                settings=self.settings,
                logger=self.logger,
                message_repository_factory=lambda session: SqlAlchemyBotMessageRepository(
                    session
                ),
            )
        return self._bot_quota_service

    @property
    def bot_privacy_service(self) -> IPrivacyService:
        """Privacidad del bot (Fase 9a, M4 — LFPDPPP): portabilidad/cancelación/retención."""
        if self._bot_privacy_service is None:
            self._bot_privacy_service = BotPrivacyService(
                database=self.database,
                settings=self.settings,
                logger=self.logger,
                conversation_repository_factory=lambda session: SqlAlchemyBotConversationRepository(
                    session
                ),
                message_repository_factory=lambda session: SqlAlchemyBotMessageRepository(
                    session
                ),
            )
        return self._bot_privacy_service

    @property
    def maintenance_service(self) -> IMaintenanceService:
        """Backup/restauración de la configuración de operación del bot (B.9)."""
        if self._maintenance_service is None:
            self._maintenance_service = MaintenanceService(
                database=self.database,
                logger=self.logger,
                audit_factory=lambda session: AuditService(
                    repository=SqlAlchemyAuditRepository(session),
                    logger=self.logger,
                ),
            )
        return self._maintenance_service

    @property
    def bot_worker_pool(self) -> BotWorkerPool:
        """Pool de consumidores de la cola D3 (dormant sin procesador/adaptador)."""
        if self._bot_worker_pool is None:
            self._bot_worker_pool = BotWorkerPool(
                queue=self.queue,
                service=self.bot_queue_service,
                processor=self.conversation_service,
                adapter_factory=self.channel_sender_factory,
                settings=self.settings,
                logger=self.logger,
            )
        return self._bot_worker_pool

    @property
    def google_calendar_provider(self) -> IGoogleCalendarProvider:
        """Google Calendar (OAuth 2.0 + REST) sobre el proveedor ICS local."""
        if self._google_calendar_provider is None:
            cipher: TokenCipher | None = self.token_cipher
            token_store: IOAuthTokenStore | None = (
                SqlAlchemyOAuthTokenStore(database=self.database, cipher=cipher)
                if cipher is not None
                else None
            )
            self._google_calendar_provider = GoogleCalendarProvider(
                client_id=self.settings.google_client_id,
                client_secret=self.settings.google_client_secret,
                redirect_uri=self.settings.google_redirect_uri,
                timeout_seconds=self.settings.google_timeout_seconds,
                logger=self.logger,
                token_store=token_store,
                cipher=cipher,
                ics_provider=CalendarIcsProvider(
                    artifacts_dir=self.settings.workflow_artifacts_dir,
                    base_url=self.settings.workflow_artifacts_base_url,
                    logger=self.logger,
                ),
            )
        return self._google_calendar_provider

    @property
    def crm_webhook_sender(self) -> ICrmWebhookSender:
        """Emisor de webhooks a CRM externo (adaptadores + retry — Fase 2)."""
        if self._crm_webhook_sender is None:
            self._crm_webhook_sender = CrmWebhookSender(
                webhook_url=self.settings.crm_webhook_url,
                timeout_seconds=self.settings.crm_webhook_timeout_seconds,
                logger=self.logger,
                adapter=build_crm_adapter(settings=self.settings, logger=self.logger),
                retry_max_attempts=self.settings.crm_retry_max_attempts,
                retry_backoff_seconds=self.settings.crm_retry_backoff_seconds,
            )
        return self._crm_webhook_sender

    @property
    def scheduler(self) -> IReminderScheduler:
        """Scheduler de recordatorios de citas (Fase 1 del backlog)."""
        if self._scheduler is None:
            self._scheduler = SchedulerService(
                database=self.database,
                repository_factory=lambda session: SqlAlchemyWorkflowRepository(session),
                audit_factory=lambda session: AuditService(
                    repository=SqlAlchemyAuditRepository(session),
                    logger=self.logger,
                ),
                email_sender=self.email_sender,
                sms_sender=self.sms_sender,
                logger=self.logger,
                reminder_hours=self.settings.appointment_reminder_hours,
                poll_interval_seconds=self.settings.reminder_poll_interval_seconds,
            )
        return self._scheduler

    @property
    def campaign_dispatcher(self) -> ICampaignDispatcher:
        """Dispatcher de campañas de recompra/postventa/recuperación (C-2)."""
        if self._campaign_dispatcher is None:
            self._campaign_dispatcher = CampaignDispatcher(
                database=self.database,
                campaign_repository_factory=lambda session: SqlAlchemyCampaignRepository(
                    session
                ),
                contact_repository_factory=lambda session: SqlAlchemyContactRepository(
                    session
                ),
                recipient_repository_factory=lambda session: SqlAlchemyCampaignRecipientRepository(
                    session
                ),
                recipient_file_repository_factory=lambda session: SqlAlchemyRecipientFileRepository(
                    session
                ),
                audit_factory=lambda session: AuditService(
                    repository=SqlAlchemyAuditRepository(session),
                    logger=self.logger,
                ),
                sender_factory=self.channel_sender_factory,
                logger=self.logger,
                poll_interval_seconds=self.settings.campaign_poll_interval_seconds,
            )
        return self._campaign_dispatcher

    def dispose(self) -> None:
        """Cierra recursos (pool, HTTP de IA/Stripe/CRM/WhatsApp/Twilio/Google)."""
        # Detener primero el scheduler para que el hilo no use emisores cerrados.
        if self._scheduler is not None:
            self._scheduler.stop()
            self._scheduler = None
        if self._campaign_dispatcher is not None:
            self._campaign_dispatcher.stop()
            self._campaign_dispatcher = None
        if self._payment_gateway is not None:
            self._payment_gateway.close()
            self._payment_gateway = None
        if self._crm_webhook_sender is not None:
            self._crm_webhook_sender.close()
            self._crm_webhook_sender = None
        if self._email_sender is not None:
            self._email_sender.close()
            self._email_sender = None
        if self._sms_sender is not None:
            self._sms_sender.close()
            self._sms_sender = None
        if self._whatsapp_sender is not None:
            self._whatsapp_sender.close()
            self._whatsapp_sender = None
        if self._google_calendar_provider is not None:
            self._google_calendar_provider.close()
            self._google_calendar_provider = None
        if self._ai_service is not None:
            self._ai_service.close()
            self._ai_service = None
        if self._context_bundle_client is not None:
            self._context_bundle_client.close()
            self._context_bundle_client = None
        # El ContextBundleService abre sus propias sesiones (no cierra recursos
        # de infraestructura externos), solo se libera la referencia.
        self._context_bundle_service = None
        # La fábrica de canales no posee recursos closables (abre sus propias
        # sesiones y crea senders efímeros por resolución); se libera la ref.
        self._channel_sender_factory = None
        # Detener primero el worker para que no use la conexión Redis cerrada.
        if self._bot_worker_pool is not None:
            self._bot_worker_pool.stop()
            self._bot_worker_pool = None
        if self._queue is not None:
            self._queue.close()
            self._queue = None
        self._bot_queue_service = None
        # Los servicios de gobernanza no poseen recursos closables (abren sus
        # propias sesiones); solo se liberan las referencias.
        self._bot_quota_service = None
        self._bot_privacy_service = None
        self._maintenance_service = None
        if self._database is not None:
            self._database.dispose()


def build_container(settings: Settings | None = None) -> Container:
    """Fábrica única de :class:`Container` (fail-fast con settings validados)."""
    return Container(settings or get_settings())
