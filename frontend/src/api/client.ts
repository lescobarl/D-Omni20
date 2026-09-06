/**
 * Cliente HTTP tipado de la API v1 del backend (puerto + implementación).
 *
 * Contrato:
 * - `IApiClient` es el puerto (interfaz) consumido por la lógica de negocio.
 * - `HttpApiClient` es la implementación con `fetch` inyectable (DI) y
 *   multi-tenancy vía cabecera `X-Tenant-Id` (regla CLAUDE: DI, sin hardcode).
 * - Las rutas de la API v1 son constantes de contrato; la URL base y el tenant
 *   provienen de `IAppConfig` (nunca valores quemados).
 */
import type { IAppConfig } from '@/types/config';
import type { ILogger } from '@/lib/logger';
import { ApiHttpError, ApiNetworkError, extractApiErrorMessage } from './errors';
import type {
  CampaignId,
  IAnalyticsDashboardResponse,
  IChangePasswordRequest,
  ILoginRequest,
  ILoginResponse,
  IMemberAddRequest,
  IMembershipCreate,
  IMembershipRead,
  IMembershipUpdate,
  IUserCreate,
  IUserRead,
  IUserUpdate,
  IBotProviderConfigRead,
  IBotProviderUpsert,
  ICdnDeployResponse,
  IContentItemCreate,
  IContentItemRead,
  IContentItemUpdate,
  IAnalyticsEventCreateRequest,
  IAnalyticsEventRead,
  IAiGenerationRequest,
  IAiGenerationResponse,
  IAppointmentRequest,
  IAppointmentResponse,
  ICatalogItemCreate,
  ICatalogItemRead,
  ICatalogItemUpdate,
  ICampaignCreate,
  ICampaignRead,
  ICampaignRecipientCreate,
  ICampaignRecipientRead,
  ICampaignRecipientUpdate,
  ICampaignUpdate,
  IAdCampaignCreate,
  IAdCampaignRead,
  IAdCampaignUpdate,
  IActiveConversationRead,
  ICrmDealsQuery,
  ICrmSummaryRead,
  ICrmTasksQuery,
  IDealCreate,
  IDealRead,
  IDealUpdate,
  IFunnelRead,
  IStageChangeRead,
  IStageCreate,
  IStageRead,
  IStageUpdate,
  ISlaRead,
  ISlaUpsert,
  ITaskCreate,
  ITaskRead,
  ITaskUpdate,
  ICheckoutRequest,
  ICheckoutResponse,
  IConversationRead,
  IContactCreate,
  IContactRead,
  IContactUpdate,
  ICsvImportRequest,
  IDeveloperSchemaRead,
  IDispatchResultRead,
  IDocumentContentRead,
  IDocumentRead,
  IDocumentSearchRequest,
  IDocumentSearchResult,
  ISynonymCreate,
  ISynonymImportRequest,
  ISynonymImportResultRead,
  ISynonymRead,
  ISynonymUpdate,
  IKeywordCreate,
  IKeywordRead,
  IKeywordUpdate,
  IHealthResponse,
  IImportResultRead,
  IIngestResultRead,
  IIngestUrlRequest,
  IIndividualSendInput,
  IInterventionAssignRequest,
  IInterventionCloseResult,
  IInterventionCreate,
  IInterventionPendingCountRead,
  IInterventionRead,
  IInterventionReplyRequest,
  IInterventionUpdate,
  ILandingCompileRequest,
  ILandingCompileResponse,
  ILandingCreate,
  ILandingPublishRequest,
  ILandingRead,
  ILandingUpdate,
  ILeadRequest,
  ILeadRead,
  ILeadAttributionRead,
  IMessageSendResultRead,
  IBackupMetaRead,
  IMaintenanceActionRead,
  IMaintenanceConfigRead,
  IMaintenanceConfigUpsert,
  IMarketplaceImportRequest,
  IPurgeRequest,
  IMarketplaceImportResponse,
  IMarketplaceTemplateCreateRequest,
  IMarketplaceTemplateRead,
  IMessageCreate,
  IMessageEnqueueResult,
  IMessageRead,
  INavigationTreeCreate,
  INavigationTreeRead,
  INavigationTreeUpdate,
  IPage,
  IPageQuery,
  IPaymentRead,
  IPortalPageAiGenerationRequest,
  IPortalPageAiGenerationResponse,
  IPortalPageCreate,
  IPortalPagePublishRequest,
  IPortalPageRead,
  IPortalPageUpdate,
  IPseoHostRead,
  IPseoHostRequest,
  IQueueStatsRead,
  IQuotaUsageResponse,
  IQuoteRequest,
  IQuoteResponse,
  IRouterTraceRead,
  ISchemaGenerateRequest,
  ISchemaGenerateResponse,
  ISchemaValidateRequest,
  ISchemaValidateResponse,
  ISchemaVersionCreateRequest,
  IRestoreResultRead,
  IScheduledRunResultRead,
  ISchemaVersionRead,
  IStatsOverviewRead,
  ITableStatsRead,
  ITemplateCreate,
  ITemplateRead,
  ITemplateUpdate,
  IAppearanceProposal,
  IRebrandingConfigCreate,
  IRebrandingConfigRead,
  IRecipientFileCreate,
  IRecipientFileDispatchInput,
  IRecipientFilePreviewRead,
  IRecipientFileRead,
  ITenantAppearanceRead,
  ITenantAppearanceUpsert,
  ITenantChannelCreate,
  ITenantChannelRead,
  ITenantChannelUpdate,
  ITenantCreate,
  ITenantRead,
  ITenantUpdate,
  LandingId,
} from './types';
import { getActiveTenantId } from '@/lib/tenantContext';
import { clearAccessToken, getAccessToken, setAccessToken } from '@/lib/tokenStore';

/** Función de fetch inyectable (DI — desacoplada para pruebas). */
export type IFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Métodos HTTP soportados por el cliente. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Prefijo de versión de la API (contrato con el backend). */
const API_PREFIX = '/api/v1';

/** Rutas relativas de la API v1 (contrato con el backend). */
const API_PATHS = {
  health: `${API_PREFIX}/health`,
  designer: `${API_PREFIX}/designer`,
  workflows: `${API_PREFIX}/workflows`,
  ai: `${API_PREFIX}/ai`,
  schemas: `${API_PREFIX}/schemas`,
  marketplace: `${API_PREFIX}/marketplace`,
  analytics: `${API_PREFIX}/analytics`,
  cdn: `${API_PREFIX}/cdn`,
  appearance: `${API_PREFIX}/tenant/appearance`,
  content: `${API_PREFIX}/content`,
  documentsIngestFile: `${API_PREFIX}/content/documents/ingest-file`,
  documentsIngestUrl: `${API_PREFIX}/content/documents/ingest-url`,
  documents: `${API_PREFIX}/content/documents`,
  documentsSearch: `${API_PREFIX}/content/documents/search`,
  synonyms: `${API_PREFIX}/content/synonyms`,
  synonymsImport: `${API_PREFIX}/content/synonyms/import`,
  synonymsExport: `${API_PREFIX}/content/synonyms/export`,
  catalog: `${API_PREFIX}/catalog`,
  channels: `${API_PREFIX}/channels`,
  botConversations: `${API_PREFIX}/bot/conversations`,
  botProviders: `${API_PREFIX}/bot/providers`,
  botQueueStats: `${API_PREFIX}/bot/queue/tenant-stats`,
  botQuotaUsage: `${API_PREFIX}/bot/quota/usage`,
  botRouterTest: `${API_PREFIX}/bot/router/test`,
  keywords: `${API_PREFIX}/bot/keywords`,
  operations: `${API_PREFIX}/operations`,
  ads: `${API_PREFIX}/ads`,
  pseoHosts: `${API_PREFIX}/pseo/hosts`,
  crm: `${API_PREFIX}/crm`,
  portalPages: `${API_PREFIX}/portal-pages`,
  tenants: `${API_PREFIX}/tenants`,
  // Autenticación de estudio (RBAC) — rutas disjuntas bajo `/auth`.
  authLogin: `${API_PREFIX}/auth/login`,
  authLogout: `${API_PREFIX}/auth/logout`,
  authMe: `${API_PREFIX}/auth/me`,
  authMyMemberships: `${API_PREFIX}/auth/me/memberships`,
  authChangePassword: `${API_PREFIX}/auth/change-password`,
  // Usuarios de plataforma (control plane, super-admin).
  users: `${API_PREFIX}/users`,
  // Miembros por tenant (RBAC, admin).
  members: `${API_PREFIX}/members`,
} as const;

/** Cabeceras base enviadas en toda petición JSON. */
const JSON_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json',
};

/** Cabecera de multi-tenancy obligatoria en endpoints protegidos. */
const TENANT_HEADER = 'X-Tenant-Id';

/** Puerto (interfaz) del cliente de la API del backend. */
export interface IApiClient {
  /** Consulta el estado de salud del backend (sin tenant). */
  health(): Promise<IHealthResponse>;
  /** Lista los tenants disponibles (control plane, sin cabecera de tenant). */
  listTenants(): Promise<ITenantRead[]>;
  /** Crea un tenant (control plane, sin cabecera de tenant). */
  createTenant(payload: ITenantCreate): Promise<ITenantRead>;
  /** Actualiza el nombre de un tenant por su slug (control plane, slug inmutable). */
  updateTenant(slug: string, payload: ITenantUpdate): Promise<ITenantRead>;
  /** Elimina (soft-delete) un tenant por su slug (control plane). */
  deleteTenant(slug: string): Promise<void>;
  /** Lista las landings del tenant activo (paginado). */
  listLandings(query?: IPageQuery): Promise<IPage<ILandingRead>>;
  /** Devuelve una landing del tenant activo por su identificador. */
  getLanding(landingId: LandingId): Promise<ILandingRead>;
  /** Crea una landing dentro del tenant activo. */
  createLanding(payload: ILandingCreate): Promise<ILandingRead>;
  /** Actualiza parcialmente una landing del tenant activo (PATCH). */
  updateLanding(landingId: LandingId, payload: ILandingUpdate): Promise<ILandingRead>;
  /** Elimina lógicamente una landing del tenant activo. */
  deleteLanding(landingId: LandingId): Promise<void>;
  /** Publica o despublica una landing del tenant activo. */
  publishLanding(landingId: LandingId, payload?: ILandingPublishRequest): Promise<ILandingRead>;
  /** Compila una configuración (config → HTML) sin persistirla. */
  compileLanding(payload: ILandingCompileRequest): Promise<ILandingCompileResponse>;
  /** Genera una configuración de landing con IA a partir de un prompt. */
  generateLanding(payload: IAiGenerationRequest): Promise<IAiGenerationResponse>;
  /** Lista las páginas del Portal del Cliente del tenant activo (paginado). */
  listPortalPages(query?: IPageQuery): Promise<IPage<IPortalPageRead>>;
  /** Devuelve una página del portal del tenant activo por su identificador. */
  getPortalPage(pageId: string): Promise<IPortalPageRead>;
  /** Crea una página del portal dentro del tenant activo. */
  createPortalPage(payload: IPortalPageCreate): Promise<IPortalPageRead>;
  /** Actualiza parcialmente una página del portal del tenant activo (PATCH). */
  updatePortalPage(pageId: string, payload: IPortalPageUpdate): Promise<IPortalPageRead>;
  /** Elimina una página del portal del tenant activo. */
  deletePortalPage(pageId: string): Promise<void>;
  /** Publica o despublica una página del portal del tenant activo. */
  publishPortalPage(pageId: string, payload?: IPortalPagePublishRequest): Promise<IPortalPageRead>;
  /** Genera una página del portal con IA a partir de un prompt. */
  generatePortalPage(
    payload: IPortalPageAiGenerationRequest,
  ): Promise<IPortalPageAiGenerationResponse>;
  /** Genera un JSON Schema (Draft 2020-12) con IA a partir de un prompt. */
  generateSchema(payload: ISchemaGenerateRequest): Promise<ISchemaGenerateResponse>;
  /** Lista los JSON Schemas generados del tenant activo (paginado). */
  listSchemas(query?: IPageQuery): Promise<IPage<IDeveloperSchemaRead>>;
  /** Valida un JSON Schema (Draft 2020-12) y, opcionalmente, datos contra él. */
  validateSchema(payload: ISchemaValidateRequest): Promise<ISchemaValidateResponse>;
  /** Lista las versiones de un schema del tenant activo (paginado, descendente). */
  listSchemaVersions(schemaId: string, query?: IPageQuery): Promise<IPage<ISchemaVersionRead>>;
  /** Crea una nueva versión de un schema del tenant activo. */
  createSchemaVersion(
    schemaId: string,
    payload: ISchemaVersionCreateRequest,
  ): Promise<ISchemaVersionRead>;
  /** Crea un checkout directo en la pasarela (workflow `direct_checkout`). */
  createCheckout(payload: ICheckoutRequest): Promise<ICheckoutResponse>;
  /** Confirma manualmente un pago sandbox pendiente (idempotente). */
  confirmCheckout(paymentId: string): Promise<IPaymentRead>;
  /** Captura un lead en el tenant activo (workflow `lead_capture`). */
  captureLead(payload: ILeadRequest): Promise<ILeadRead>;
  /** Devuelve el reporte de atribución por campaña (UTM) del tenant activo. */
  getLeadAttribution(): Promise<ILeadAttributionRead>;
  /** Genera una cotización y su PDF (workflow `quote_generator`). */
  generateQuote(payload: IQuoteRequest): Promise<IQuoteResponse>;
  /** Agenda una cita y genera su ICS (workflow `appointment_scheduler`). */
  scheduleAppointment(payload: IAppointmentRequest): Promise<IAppointmentResponse>;
  /** Lista los templates del catálogo del marketplace (opcional por categoría). */
  listMarketplaceTemplates(
    query?: IPageQuery,
    category?: string,
  ): Promise<IPage<IMarketplaceTemplateRead>>;
  /** Publica un template en el marketplace del tenant activo. */
  createMarketplaceTemplate(
    payload: IMarketplaceTemplateCreateRequest,
  ): Promise<IMarketplaceTemplateRead>;
  /** Importa un template del marketplace a una campaña (genera una landing). */
  importMarketplaceTemplate(
    templateId: string,
    payload: IMarketplaceImportRequest,
  ): Promise<IMarketplaceImportResponse>;
  /** Registra un evento de analítica en el tenant activo. */
  recordAnalyticsEvent(payload: IAnalyticsEventCreateRequest): Promise<IAnalyticsEventRead>;
  /** Obtiene el resumen del dashboard de analítica del tenant activo. */
  getAnalyticsDashboard(): Promise<IAnalyticsDashboardResponse>;
  /** Despliega la landing del tenant activo al CDN. */
  deployToCdn(landingId: LandingId): Promise<ICdnDeployResponse>;
  /** Devuelve la apariencia del tenant activo (404 si no está definida). */
  getTenantAppearance(): Promise<ITenantAppearanceRead>;
  /** Crea o reemplaza la apariencia del tenant activo (una fila por tenant). */
  upsertTenantAppearance(payload: ITenantAppearanceUpsert): Promise<ITenantAppearanceRead>;
  /** Extrae una propuesta de apariencia desde una URL de marca (Fase 5). */
  extractUrlStyles(url: string): Promise<IAppearanceProposal>;
  /** Lista las configuraciones de rebranding guardadas del tenant activo. */
  listRebrandingConfigs(): Promise<IRebrandingConfigRead[]>;
  /** Guarda una configuración de rebranding por URL (re-extrae y aplica). */
  createRebrandingConfig(payload: IRebrandingConfigCreate): Promise<IRebrandingConfigRead>;
  /** Elimina una configuración de rebranding del tenant activo. */
  deleteRebrandingConfig(configId: string): Promise<void>;
  /** Lista el contenido estructurado del tenant activo (paginado). */
  listContentItems(query?: IPageQuery): Promise<IPage<IContentItemRead>>;
  /** Crea un ítem de contenido en el tenant activo. */
  createContentItem(payload: IContentItemCreate): Promise<IContentItemRead>;
  /** Devuelve un ítem de contenido del tenant activo por su identificador. */
  getContentItem(itemId: string): Promise<IContentItemRead>;
  /** Actualiza un ítem de contenido del tenant activo (PUT). */
  updateContentItem(itemId: string, payload: IContentItemUpdate): Promise<IContentItemRead>;
  /** Elimina lógicamente un ítem de contenido del tenant activo. */
  deleteContentItem(itemId: string): Promise<void>;
  /** Ingiere un archivo (PDF/TXT/CSV) como documento de la base de conocimiento. */
  ingestDocumentFile(file: File): Promise<IIngestResultRead>;
  /** Ingiere una URL remota como documento de la base de conocimiento. */
  ingestDocumentUrl(payload: IIngestUrlRequest): Promise<IIngestResultRead>;
  /** Lista los documentos ingeridos del tenant activo (paginado). */
  listDocuments(query?: IPageQuery): Promise<IPage<IDocumentRead>>;
  /** Busca por texto sobre los documentos/chunks del tenant activo. */
  searchDocuments(payload: IDocumentSearchRequest): Promise<IDocumentSearchResult[]>;
  /** Devuelve un documento ingerido del tenant activo con su contenido completo. */
  getDocument(documentId: string): Promise<IDocumentContentRead>;
  /** Elimina lógicamente un documento ingerido del tenant activo. */
  deleteDocument(documentId: string): Promise<void>;
  /** Lista los sinónimos del bot del tenant activo (paginado). */
  listSynonyms(query?: IPageQuery): Promise<IPage<ISynonymRead>>;
  /** Crea un sinónimo del bot en el tenant activo (término único). */
  createSynonym(payload: ISynonymCreate): Promise<ISynonymRead>;
  /** Actualiza un sinónimo del bot del tenant activo (PUT). */
  updateSynonym(synonymId: string, payload: ISynonymUpdate): Promise<ISynonymRead>;
  /** Elimina lógicamente un sinónimo del bot del tenant activo. */
  deleteSynonym(synonymId: string): Promise<void>;
  /** Importa sinónimos en lote (CSV o JSON, texto crudo en el cuerpo). */
  importSynonyms(payload: ISynonymImportRequest): Promise<ISynonymImportResultRead>;
  /** Exporta los sinónimos del tenant activo como CSV o JSON (texto crudo). */
  exportSynonyms(format: 'csv' | 'json'): Promise<string>;
  /** Lista las keywords del bot del tenant activo (paginado). */
  listKeywords(query?: IPageQuery): Promise<IPage<IKeywordRead>>;
  /** Crea una keyword del bot en el tenant activo (término único). */
  createKeyword(payload: IKeywordCreate): Promise<IKeywordRead>;
  /** Actualiza una keyword del bot del tenant activo (PUT). */
  updateKeyword(keywordId: string, payload: IKeywordUpdate): Promise<IKeywordRead>;
  /** Elimina lógicamente una keyword del bot del tenant activo. */
  deleteKeyword(keywordId: string): Promise<void>;
  /** Lista el catálogo del tenant activo (paginado). */
  listCatalogItems(query?: IPageQuery): Promise<IPage<ICatalogItemRead>>;
  /** Crea un ítem del catálogo en el tenant activo (SKU único por tenant). */
  createCatalogItem(payload: ICatalogItemCreate): Promise<ICatalogItemRead>;
  /** Devuelve un ítem del catálogo del tenant activo por su identificador. */
  getCatalogItem(itemId: string): Promise<ICatalogItemRead>;
  /** Actualiza un ítem del catálogo del tenant activo (PUT). */
  updateCatalogItem(itemId: string, payload: ICatalogItemUpdate): Promise<ICatalogItemRead>;
  /** Elimina lógicamente un ítem del catálogo del tenant activo. */
  deleteCatalogItem(itemId: string): Promise<void>;
  /** Lista los canales del bot del tenant activo (paginado, sin secretos). */
  listChannels(query?: IPageQuery): Promise<IPage<ITenantChannelRead>>;
  /** Crea un canal del bot en el tenant activo (secretos write-only). */
  createChannel(payload: ITenantChannelCreate): Promise<ITenantChannelRead>;
  /** Devuelve un canal del tenant activo por su identificador (sin secretos). */
  getChannel(channelId: string): Promise<ITenantChannelRead>;
  /** Actualiza parcialmente un canal del tenant activo (PATCH). */
  updateChannel(channelId: string, payload: ITenantChannelUpdate): Promise<ITenantChannelRead>;
  /** Elimina lógicamente un canal del tenant activo. */
  deleteChannel(channelId: string): Promise<void>;
  /** Lista las conversaciones del bot del tenant activo (paginado). */
  listConversations(query?: IPageQuery): Promise<IPage<IConversationRead>>;
  /** Lista los mensajes de una conversación (paginado, ascendente). */
  listConversationMessages(
    conversationId: string,
    query?: IPageQuery,
  ): Promise<IPage<IMessageRead>>;
  /** Envía manualmente un mensaje de prueba a la cola D3 de una conversación. */
  sendConversationMessage(
    conversationId: string,
    payload: IMessageCreate,
  ): Promise<IMessageEnqueueResult>;
  /** Lista los proveedores de IA configurados del tenant activo (sin secretos). */
  listBotProviders(): Promise<IBotProviderConfigRead[]>;
  /** Crea o reemplaza un proveedor de IA del tenant activo (sin secretos). */
  upsertBotProvider(payload: IBotProviderUpsert): Promise<IBotProviderConfigRead>;
  /** Elimina lógicamente un proveedor de IA del tenant activo (por clave compuesta tipo/orden). */
  deleteBotProvider(providerKind: string, order: number): Promise<void>;
  /** Obtiene las estadísticas de la cola Redis D3 del tenant activo. */
  getBotQueueStats(): Promise<IQueueStatsRead>;
  /** Obtiene el uso de cuota L1 del tenant activo (proveedores + agregado). */
  getBotQuotaUsage(): Promise<IQuotaUsageResponse>;
  /** Prueba el router del bot con un mensaje crudo (sin persistir ni encolar). */
  testRouter(message: string): Promise<IRouterTraceRead>;
  /** Lista los contactos del tenant activo (paginado). */
  listContacts(query?: IPageQuery): Promise<IPage<IContactRead>>;
  /** Crea un contacto en el tenant activo (teléfono único por tenant). */
  createContact(payload: IContactCreate): Promise<IContactRead>;
  /** Devuelve un contacto del tenant activo por su identificador. */
  getContact(contactId: string): Promise<IContactRead>;
  /** Actualiza un contacto del tenant activo (PUT). */
  updateContact(contactId: string, payload: IContactUpdate): Promise<IContactRead>;
  /** Elimina lógicamente un contacto del tenant activo. */
  deleteContact(contactId: string): Promise<void>;
  /** Lista las plantillas de mensaje del tenant activo (paginado). */
  listTemplates(query?: IPageQuery): Promise<IPage<ITemplateRead>>;
  /** Crea una plantilla de mensaje en el tenant activo (nombre único por tenant). */
  createTemplate(payload: ITemplateCreate): Promise<ITemplateRead>;
  /** Devuelve una plantilla del tenant activo por su identificador. */
  getTemplate(templateId: string): Promise<ITemplateRead>;
  /** Actualiza una plantilla del tenant activo (PUT). */
  updateTemplate(templateId: string, payload: ITemplateUpdate): Promise<ITemplateRead>;
  /** Elimina lógicamente una plantilla del tenant activo. */
  deleteTemplate(templateId: string): Promise<void>;
  /** Lista los árboles de navegación del bot del tenant activo (paginado). */
  listNavigationTrees(query?: IPageQuery): Promise<IPage<INavigationTreeRead>>;
  /** Crea un árbol de navegación del bot en el tenant activo (nombre único por tenant). */
  createNavigationTree(payload: INavigationTreeCreate): Promise<INavigationTreeRead>;
  /** Devuelve un árbol de navegación del tenant activo por su identificador. */
  getNavigationTree(treeId: string): Promise<INavigationTreeRead>;
  /** Actualiza un árbol de navegación del tenant activo (PUT). */
  updateNavigationTree(
    treeId: string,
    payload: INavigationTreeUpdate,
  ): Promise<INavigationTreeRead>;
  /** Elimina lógicamente un árbol de navegación del tenant activo. */
  deleteNavigationTree(treeId: string): Promise<void>;
  /** Lista las campañas de envío del tenant activo (paginado). */
  listCampaigns(query?: IPageQuery): Promise<IPage<ICampaignRead>>;
  /** Crea una campaña de envío en el tenant activo. */
  createCampaign(payload: ICampaignCreate): Promise<ICampaignRead>;
  /** Devuelve una campaña del tenant activo por su identificador. */
  getCampaign(campaignId: string): Promise<ICampaignRead>;
  /** Actualiza una campaña del tenant activo (PUT). */
  updateCampaign(campaignId: string, payload: ICampaignUpdate): Promise<ICampaignRead>;
  /** Elimina lógicamente una campaña del tenant activo. */
  deleteCampaign(campaignId: string): Promise<void>;
  /** Añade un destinatario a una campaña del tenant activo. */
  addCampaignRecipient(
    campaignId: string,
    payload: ICampaignRecipientCreate,
  ): Promise<ICampaignRecipientRead>;
  /** Lista los destinatarios de una campaña del tenant activo (paginado). */
  listCampaignRecipients(
    campaignId: string,
    query?: IPageQuery,
  ): Promise<IPage<ICampaignRecipientRead>>;
  /** Actualiza el estado de un destinatario de campaña (PUT). */
  updateCampaignRecipient(
    recipientId: string,
    payload: ICampaignRecipientUpdate,
  ): Promise<ICampaignRecipientRead>;
  /** Despacha una campaña del tenant de forma inmediata (POST /campaigns/{id}/dispatch, C-2). */
  dispatchCampaign(campaignId: string): Promise<IDispatchResultRead>;
  /** Envía un mensaje individual a un teléfono reutilizando una plantilla del tenant (POST /messages/send-individual, B.4). */
  sendIndividualMessage(payload: IIndividualSendInput): Promise<IMessageSendResultRead>;
  /** Importa contactos en lote desde un CSV (POST /contacts/import-csv, B.6). */
  importContactsCsv(payload: ICsvImportRequest): Promise<IImportResultRead>;
  /** Importa destinatarios de una campaña en lote desde un CSV (POST /campaigns/{id}/recipients/import-csv, B.4). */
  importCampaignRecipientsCsv(
    campaignId: string,
    payload: ICsvImportRequest,
  ): Promise<IImportResultRead>;
  /** Sube un archivo de destinatarios reutilizable (POST /operations/recipient-files, GAP 2). */
  uploadRecipientFile(payload: IRecipientFileCreate): Promise<IRecipientFileRead>;
  /** Lista los archivos de destinatarios reutilizables del tenant activo (paginado). */
  listRecipientFiles(query?: IPageQuery): Promise<IPage<IRecipientFileRead>>;
  /** Vista previa de los contactos de un archivo (dry-run, sin insertar). */
  previewRecipientFile(fileId: string): Promise<IRecipientFilePreviewRead>;
  /** Despacha una campaña desde un archivo de destinatarios (POST /campaigns/{id}/dispatch-from-file, GAP 2). */
  dispatchCampaignFromFile(
    campaignId: string,
    payload: IRecipientFileDispatchInput,
  ): Promise<IDispatchResultRead>;
  /** Lista las intervenciones humanas del tenant activo (paginado, filtro por estado). */
  listInterventions(query?: IPageQuery & { state?: string }): Promise<IPage<IInterventionRead>>;
  /** Crea una intervención humana sobre una conversación (cola B.7 → eslabón ⑤). */
  createIntervention(payload: IInterventionCreate): Promise<IInterventionRead>;
  /** Devuelve una intervención del tenant activo por su identificador. */
  getIntervention(interventionId: string): Promise<IInterventionRead>;
  /** Actualiza una intervención humana del tenant activo (PUT). */
  updateIntervention(
    interventionId: string,
    payload: IInterventionUpdate,
  ): Promise<IInterventionRead>;
  /** Devuelve el contador de intervenciones pendientes del tenant activo (badge 🆕 del panel). */
  getInterventionsPendingCount(): Promise<IInterventionPendingCountRead>;
  /** Asigna una intervención pendiente a un operador humano (POST /assign, B.7). */
  assignIntervention(
    interventionId: string,
    payload: IInterventionAssignRequest,
  ): Promise<IInterventionRead>;
  /** Lista los mensajes de la conversación de una intervención (B.7 workspace "Atendiendo"). */
  listInterventionMessages(interventionId: string): Promise<IMessageRead[]>;
  /** Responde a la conversación de una intervención en nombre del operador (B.7). */
  replyIntervention(
    interventionId: string,
    payload: IInterventionReplyRequest,
  ): Promise<IMessageRead>;
  /** Cierra una intervención humana y marca su resolución (B.7). */
  closeIntervention(interventionId: string): Promise<IInterventionCloseResult>;
  /** Devuelve la configuración de mantenimiento del tenant activo (404 si no existe). */
  getMaintenanceConfig(): Promise<IMaintenanceConfigRead>;
  /** Crea o reemplaza la configuración de mantenimiento del tenant activo (una fila por tenant). */
  upsertMaintenanceConfig(payload: IMaintenanceConfigUpsert): Promise<IMaintenanceConfigRead>;
  /** Devuelve el resumen operativo del bot del tenant activo (B.1 Dashboard + B.2 Estadísticas). */
  getOperationsStatsOverview(): Promise<IStatsOverviewRead>;
  /** Ejecuta la purga por dominio del tenant activo (POST, reutiliza privacidad M4). */
  purgeMaintenance(payload: IPurgeRequest): Promise<IMaintenanceActionRead>;
  /** Ejecuta la optimización física del almacén del tenant activo (POST, VACUUM/reindex). */
  optimizeMaintenance(): Promise<IMaintenanceActionRead>;
  /** Lista las conversaciones activas del bot del tenant activo (paginado, Monitor Fase 7). */
  listActiveConversations(query?: IPageQuery): Promise<IPage<IActiveConversationRead>>;
  /** Descarga el backup de la configuración de operación del tenant activo (B.9). */
  createBackup(): Promise<IBackupMetaRead>;
  /** Restaura un backup de la configuración de operación del tenant activo (B.9). */
  restoreBackup(file: File): Promise<IRestoreResultRead>;
  /** Devuelve el conteo total/activo/inactivo por tabla del tenant activo (B.9 Estado). */
  getTableStats(): Promise<ITableStatsRead[]>;
  /** Ejecuta manualmente el mantenimiento programado configurado del tenant activo (B.9). */
  runScheduledMaintenance(): Promise<IScheduledRunResultRead>;
  /** Lista las campañas publicitarias del tenant activo (paginado, C-1). */
  listAdCampaigns(query?: IPageQuery): Promise<IPage<IAdCampaignRead>>;
  /** Crea una campaña publicitaria en el tenant activo (C-1). */
  createAdCampaign(payload: IAdCampaignCreate): Promise<IAdCampaignRead>;
  /** Devuelve una campaña publicitaria del tenant activo por su identificador (C-1). */
  getAdCampaign(adCampaignId: string): Promise<IAdCampaignRead>;
  /** Actualiza parcialmente una campaña publicitaria del tenant activo (PATCH, C-1). */
  updateAdCampaign(adCampaignId: string, payload: IAdCampaignUpdate): Promise<IAdCampaignRead>;
  /** Elimina lógicamente una campaña publicitaria del tenant activo (C-1). */
  deleteAdCampaign(adCampaignId: string): Promise<void>;
  /** Lista los dominios personalizados del tenant activo (PSEO hosts, sin paginar). */
  listPseoHosts(): Promise<IPseoHostRead[]>;
  /** Registra un dominio personalizado del tenant activo (PSEO hosts). */
  requestPseoHost(payload: IPseoHostRequest): Promise<IPseoHostRead>;
  /** Verifica la propiedad DNS de un dominio y lo activa (PSEO hosts). */
  verifyPseoHost(hostId: string): Promise<IPseoHostRead>;
  /** Elimina lógicamente un dominio personalizado del tenant activo (PSEO hosts). */
  deletePseoHost(hostId: string): Promise<void>;
  /** Lista las etapas del pipeline del tenant activo (P3, M1). */
  listStages(): Promise<IStageRead[]>;
  /** Crea una etapa del pipeline del tenant activo (P3, M1). */
  createStage(payload: IStageCreate): Promise<IStageRead>;
  /** Devuelve una etapa del pipeline por su identificador (P3, M1). */
  getStage(stageId: string): Promise<IStageRead>;
  /** Actualiza parcialmente una etapa del pipeline (PATCH, P3, M1). */
  updateStage(stageId: string, payload: IStageUpdate): Promise<IStageRead>;
  /** Elimina lógicamente una etapa del pipeline (P3, M1). */
  deleteStage(stageId: string): Promise<void>;
  /** Lista las oportunidades del tenant activo (paginado + filtros, P3, M1). */
  listDeals(query?: ICrmDealsQuery): Promise<IPage<IDealRead>>;
  /** Crea una oportunidad en el pipeline del tenant activo (P3, M1). */
  createDeal(payload: IDealCreate): Promise<IDealRead>;
  /** Devuelve una oportunidad por su identificador (P3, M1). */
  getDeal(dealId: string): Promise<IDealRead>;
  /** Actualiza parcialmente una oportunidad (PATCH, incluye mover de etapa, P3, M1). */
  updateDeal(dealId: string, payload: IDealUpdate): Promise<IDealRead>;
  /** Elimina lógicamente una oportunidad (P3, M1). */
  deleteDeal(dealId: string): Promise<void>;
  /** Devuelve el historial de movimientos de etapa de una oportunidad (P3, M1). */
  listDealHistory(dealId: string): Promise<IStageChangeRead[]>;
  /** Lista las tareas vinculadas a una oportunidad (paginado, P3, M2). */
  listDealTasks(dealId: string, query?: ICrmTasksQuery): Promise<IPage<ITaskRead>>;
  /** Crea una tarea anclada a una oportunidad (P3, M2). */
  createDealTask(dealId: string, payload: ITaskCreate): Promise<ITaskRead>;
  /** Lista las tareas del tenant activo (paginado + filtro por deal, P3, M2). */
  listTasks(query?: ICrmTasksQuery): Promise<IPage<ITaskRead>>;
  /** Crea una tarea de seguimiento en el tenant activo (P3, M2). */
  createTask(payload: ITaskCreate): Promise<ITaskRead>;
  /** Devuelve una tarea por su identificador (P3, M2). */
  getTask(taskId: string): Promise<ITaskRead>;
  /** Actualiza parcialmente una tarea (PATCH, P3, M2). */
  updateTask(taskId: string, payload: ITaskUpdate): Promise<ITaskRead>;
  /** Elimina lógicamente una tarea (P3, M2). */
  deleteTask(taskId: string): Promise<void>;
  /** Lista las políticas SLA por etapa del tenant activo (P3, M5). */
  listSla(): Promise<ISlaRead[]>;
  /** Crea o actualiza la política SLA de una etapa (PUT, P3, M5). */
  upsertSla(payload: ISlaUpsert): Promise<ISlaRead>;
  /** Devuelve el reporte del embudo comercial del tenant activo (P3, M4). */
  getFunnel(): Promise<IFunnelRead>;
  /** Devuelve el resumen de oportunidades de un cliente por email (P4, portal). */
  getCrmSummary(email: string): Promise<ICrmSummaryRead>;

  // ── Autenticación de estudio (RBAC) ────────────────────────────────────────
  /** Inicia sesión con email+password y devuelve el JWT + perfil (sin tenant). */
  login(payload: ILoginRequest): Promise<ILoginResponse>;
  /** Cierra la sesión actual invalidando el token (sin tenant). */
  logout(): Promise<void>;
  /** Devuelve el perfil del usuario autenticado (sin tenant). */
  getMe(): Promise<IUserRead>;
  /** Devuelve las membresías (tenant+rol) del usuario autenticado (sin tenant). */
  getMyMemberships(): Promise<IMembershipRead[]>;
  /** Cambia la contraseña del usuario autenticado (sin tenant). */
  changePassword(payload: IChangePasswordRequest): Promise<void>;
  /** Actualiza el perfil del usuario autenticado (sin tenant). */
  updateMe(payload: IUserUpdate): Promise<IUserRead>;

  // ── Usuarios de plataforma (control plane, super-admin) ────────────────────
  /** Lista los usuarios de la plataforma (sin cabecera de tenant). */
  listUsers(): Promise<IUserRead[]>;
  /** Crea un usuario de plataforma (sin cabecera de tenant). */
  createUser(payload: IUserCreate): Promise<IUserRead>;
  /** Actualiza parcialmente un usuario de plataforma (sin cabecera de tenant). */
  updateUser(userId: string, payload: IUserUpdate): Promise<IUserRead>;
  /** Elimina (soft-delete) un usuario de plataforma (sin cabecera de tenant). */
  deleteUser(userId: string): Promise<void>;
  /** Lista las membresías de un usuario (sin cabecera de tenant). */
  listUserMemberships(userId: string): Promise<IMembershipRead[]>;
  /** Añade una membresía (tenant+rol) a un usuario (sin cabecera de tenant). */
  addUserMembership(payload: IMembershipCreate): Promise<IMembershipRead>;
  /** Elimina la membresía (tenant+rol) de un usuario (sin cabecera de tenant). */
  deleteUserMembership(userId: string, membershipId: string): Promise<void>;

  // ── Miembros por tenant (RBAC, admin) ──────────────────────────────────────
  /** Lista los miembros del tenant activo (con cabecera de tenant). */
  listMembers(): Promise<IMembershipRead[]>;
  /** Añade un miembro al tenant activo por email (con cabecera de tenant). */
  addMember(payload: IMemberAddRequest): Promise<IMembershipRead>;
  /** Actualiza el rol de un miembro del tenant activo (con cabecera de tenant). */
  updateMember(membershipId: string, payload: IMembershipUpdate): Promise<IMembershipRead>;
  /** Elimina un miembro del tenant activo (con cabecera de tenant). */
  removeMember(membershipId: string): Promise<void>;
}

/** Opciones de construcción del cliente HTTP (composition root). */
export interface IHttpApiClientOptions {
  /** URL base de la API (sin barra final). */
  baseUrl: string;
  /** Identificador del tenant aislado (UUID o slug). */
  tenantId: string;
  /** Implementación de fetch (por defecto el `fetch` global). */
  fetcher?: IFetcher;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  logger?: ILogger;
}

/** Implementación HTTP del puerto `IApiClient` (fetch + X-Tenant-Id). */
export class HttpApiClient implements IApiClient {
  /** URL base normalizada (sin barra final). */
  private readonly baseUrl: string;
  /** Identificador del tenant aislado. */
  private readonly tenantId: string;
  /** Implementación de fetch inyectada (DI). */
  private readonly fetcher: IFetcher;
  /** Logger de auditoría opcional. */
  private readonly logger?: ILogger;

  constructor(options: IHttpApiClientOptions, defaultFetcher: IFetcher = fetch) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tenantId = options.tenantId;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.logger = options.logger;
  }

  /** Fábrica desde la configuración de la aplicación (composition root). */
  public static fromConfig(
    config: IAppConfig,
    fetcher?: IFetcher,
    logger?: ILogger,
  ): HttpApiClient {
    return new HttpApiClient(
      { baseUrl: config.apiBaseUrl, tenantId: config.tenantId, fetcher, logger },
      fetcher,
    );
  }

  /** Consulta el estado de salud del backend (no requiere tenant). */
  public async health(): Promise<IHealthResponse> {
    return this.request<IHealthResponse>('GET', API_PATHS.health, {
      operation: 'api.health',
      tenant: false,
    });
  }

  /** Lista los tenants disponibles (control plane, sin cabecera de tenant). */
  public async listTenants(): Promise<ITenantRead[]> {
    return this.request<ITenantRead[]>('GET', API_PATHS.tenants, {
      operation: 'api.tenant.list',
      tenant: false,
    });
  }

  /** Crea un tenant (control plane, sin cabecera de tenant). */
  public async createTenant(payload: ITenantCreate): Promise<ITenantRead> {
    return this.request<ITenantRead>('POST', API_PATHS.tenants, {
      operation: 'api.tenant.create',
      tenant: false,
      body: payload,
    });
  }

  /** Actualiza el nombre de un tenant por su slug (control plane, slug inmutable). */
  public async updateTenant(slug: string, payload: ITenantUpdate): Promise<ITenantRead> {
    return this.request<ITenantRead>('PATCH', `${API_PATHS.tenants}/${slug}`, {
      operation: 'api.tenant.update',
      tenant: false,
      body: payload,
    });
  }

  /** Elimina (soft-delete) un tenant por su slug (control plane). */
  public async deleteTenant(slug: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.tenants}/${slug}`, {
      operation: 'api.tenant.delete',
      tenant: false,
    });
  }

  /** Lista las landings del tenant activo (paginado). */
  public async listLandings(query: IPageQuery = {}): Promise<IPage<ILandingRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) {
      params.set('page', String(query.page));
    }
    if (query.page_size !== undefined) {
      params.set('page_size', String(query.page_size));
    }
    const queryString = params.toString();
    const path = `${API_PATHS.designer}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ILandingRead>>('GET', path, {
      operation: 'api.landing.list',
    });
  }

  /** Devuelve una landing del tenant activo por su identificador. */
  public async getLanding(landingId: LandingId): Promise<ILandingRead> {
    return this.request<ILandingRead>('GET', `${API_PATHS.designer}/${landingId}`, {
      operation: 'api.landing.get',
    });
  }

  /** Crea una landing dentro del tenant activo. */
  public async createLanding(payload: ILandingCreate): Promise<ILandingRead> {
    return this.request<ILandingRead>('POST', API_PATHS.designer, {
      operation: 'api.landing.create',
      body: payload,
    });
  }

  /** Actualiza parcialmente una landing del tenant activo (PATCH). */
  public async updateLanding(landingId: LandingId, payload: ILandingUpdate): Promise<ILandingRead> {
    return this.request<ILandingRead>('PATCH', `${API_PATHS.designer}/${landingId}`, {
      operation: 'api.landing.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una landing del tenant activo. */
  public async deleteLanding(landingId: LandingId): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.designer}/${landingId}`, {
      operation: 'api.landing.delete',
    });
  }

  /** Publica o despublica una landing del tenant activo. */
  public async publishLanding(
    landingId: LandingId,
    payload: ILandingPublishRequest = {},
  ): Promise<ILandingRead> {
    return this.request<ILandingRead>('POST', `${API_PATHS.designer}/${landingId}/publish`, {
      operation: 'api.landing.publish',
      body: payload,
    });
  }

  /** Compila una configuración (config → HTML) sin persistirla. */
  public async compileLanding(payload: ILandingCompileRequest): Promise<ILandingCompileResponse> {
    return this.request<ILandingCompileResponse>('POST', `${API_PATHS.designer}/compile`, {
      operation: 'api.landing.compile',
      body: payload,
    });
  }

  /** Genera una configuración de landing con IA a partir de un prompt. */
  public async generateLanding(payload: IAiGenerationRequest): Promise<IAiGenerationResponse> {
    return this.request<IAiGenerationResponse>('POST', `${API_PATHS.designer}/generate`, {
      operation: 'api.landing.generate',
      body: payload,
    });
  }

  /** Lista las páginas del Portal del Cliente del tenant activo (paginado). */
  public async listPortalPages(query: IPageQuery = {}): Promise<IPage<IPortalPageRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) {
      params.set('page', String(query.page));
    }
    if (query.page_size !== undefined) {
      params.set('page_size', String(query.page_size));
    }
    const queryString = params.toString();
    const path = `${API_PATHS.portalPages}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IPortalPageRead>>('GET', path, {
      operation: 'api.portalPage.list',
    });
  }

  /** Devuelve una página del portal del tenant activo por su identificador. */
  public async getPortalPage(pageId: string): Promise<IPortalPageRead> {
    return this.request<IPortalPageRead>('GET', `${API_PATHS.portalPages}/${pageId}`, {
      operation: 'api.portalPage.get',
    });
  }

  /** Crea una página del portal dentro del tenant activo. */
  public async createPortalPage(payload: IPortalPageCreate): Promise<IPortalPageRead> {
    return this.request<IPortalPageRead>('POST', API_PATHS.portalPages, {
      operation: 'api.portalPage.create',
      body: payload,
    });
  }

  /** Actualiza parcialmente una página del portal del tenant activo (PATCH). */
  public async updatePortalPage(
    pageId: string,
    payload: IPortalPageUpdate,
  ): Promise<IPortalPageRead> {
    return this.request<IPortalPageRead>('PATCH', `${API_PATHS.portalPages}/${pageId}`, {
      operation: 'api.portalPage.update',
      body: payload,
    });
  }

  /** Elimina una página del portal del tenant activo. */
  public async deletePortalPage(pageId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.portalPages}/${pageId}`, {
      operation: 'api.portalPage.delete',
    });
  }

  /** Publica o despublica una página del portal del tenant activo. */
  public async publishPortalPage(
    pageId: string,
    payload: IPortalPagePublishRequest = { published: true },
  ): Promise<IPortalPageRead> {
    return this.request<IPortalPageRead>('POST', `${API_PATHS.portalPages}/${pageId}/publish`, {
      operation: 'api.portalPage.publish',
      body: payload,
    });
  }

  /** Genera una página del portal con IA a partir de un prompt. */
  public async generatePortalPage(
    payload: IPortalPageAiGenerationRequest,
  ): Promise<IPortalPageAiGenerationResponse> {
    return this.request<IPortalPageAiGenerationResponse>(
      'POST',
      `${API_PATHS.portalPages}/generate`,
      {
        operation: 'api.portalPage.generate',
        body: payload,
      },
    );
  }

  /** Genera un JSON Schema (Draft 2020-12) con IA a partir de un prompt. */
  public async generateSchema(payload: ISchemaGenerateRequest): Promise<ISchemaGenerateResponse> {
    return this.request<ISchemaGenerateResponse>('POST', `${API_PATHS.ai}/generate-schema`, {
      operation: 'api.schema.generate',
      body: payload,
    });
  }

  /** Lista los JSON Schemas generados del tenant activo (paginado). */
  public async listSchemas(query: IPageQuery = {}): Promise<IPage<IDeveloperSchemaRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) {
      params.set('page', String(query.page));
    }
    if (query.page_size !== undefined) {
      params.set('page_size', String(query.page_size));
    }
    const queryString = params.toString();
    const path = `${API_PATHS.ai}/schemas${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IDeveloperSchemaRead>>('GET', path, {
      operation: 'api.schema.list',
    });
  }

  /** Valida un JSON Schema (Draft 2020-12) y, opcionalmente, datos contra él. */
  public async validateSchema(payload: ISchemaValidateRequest): Promise<ISchemaValidateResponse> {
    return this.request<ISchemaValidateResponse>('POST', `${API_PATHS.schemas}/validate`, {
      operation: 'api.schema.validate',
      body: payload,
    });
  }

  /** Lista las versiones de un schema del tenant activo (paginado, descendente). */
  public async listSchemaVersions(
    schemaId: string,
    query: IPageQuery = {},
  ): Promise<IPage<ISchemaVersionRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) {
      params.set('page', String(query.page));
    }
    if (query.page_size !== undefined) {
      params.set('page_size', String(query.page_size));
    }
    const queryString = params.toString();
    const path = `${API_PATHS.schemas}/${schemaId}/versions${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ISchemaVersionRead>>('GET', path, {
      operation: 'api.schema.version.list',
    });
  }

  /** Crea una nueva versión de un schema del tenant activo (instantánea + nota). */
  public async createSchemaVersion(
    schemaId: string,
    payload: ISchemaVersionCreateRequest,
  ): Promise<ISchemaVersionRead> {
    return this.request<ISchemaVersionRead>('POST', `${API_PATHS.schemas}/${schemaId}/versions`, {
      operation: 'api.schema.version.create',
      body: payload,
    });
  }

  /** Crea un checkout directo en la pasarela (workflow `direct_checkout`). */
  public async createCheckout(payload: ICheckoutRequest): Promise<ICheckoutResponse> {
    return this.request<ICheckoutResponse>('POST', `${API_PATHS.workflows}/checkout`, {
      operation: 'api.workflow.checkout.create',
      body: payload,
    });
  }

  /** Confirma manualmente un pago sandbox pendiente (idempotente). */
  public async confirmCheckout(paymentId: string): Promise<IPaymentRead> {
    return this.request<IPaymentRead>(
      'POST',
      `${API_PATHS.workflows}/checkout/${paymentId}/confirm`,
      {
        operation: 'api.workflow.checkout.confirm',
      },
    );
  }

  /** Captura un lead en el tenant activo (workflow `lead_capture`). */
  public async captureLead(payload: ILeadRequest): Promise<ILeadRead> {
    return this.request<ILeadRead>('POST', `${API_PATHS.workflows}/lead`, {
      operation: 'api.workflow.lead.capture',
      body: payload,
    });
  }

  /** Devuelve el reporte de atribución por campaña (UTM) del tenant activo. */
  public async getLeadAttribution(): Promise<ILeadAttributionRead> {
    return this.request<ILeadAttributionRead>('GET', `${API_PATHS.workflows}/leads/attribution`, {
      operation: 'api.workflow.lead.attribution',
    });
  }

  /** Genera una cotización y su PDF (workflow `quote_generator`). */
  public async generateQuote(payload: IQuoteRequest): Promise<IQuoteResponse> {
    return this.request<IQuoteResponse>('POST', `${API_PATHS.workflows}/quote`, {
      operation: 'api.workflow.quote.generate',
      body: payload,
    });
  }

  /** Agenda una cita y genera su ICS (workflow `appointment_scheduler`). */
  public async scheduleAppointment(payload: IAppointmentRequest): Promise<IAppointmentResponse> {
    return this.request<IAppointmentResponse>('POST', `${API_PATHS.workflows}/appointment`, {
      operation: 'api.workflow.appointment.schedule',
      body: payload,
    });
  }

  /** Lista los templates del catálogo del marketplace (opcional por categoría). */
  public async listMarketplaceTemplates(
    query: IPageQuery = {},
    category?: string,
  ): Promise<IPage<IMarketplaceTemplateRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    if (category !== undefined && category !== '') params.set('category', category);
    const queryString = params.toString();
    const path = `${API_PATHS.marketplace}/templates${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IMarketplaceTemplateRead>>('GET', path, {
      operation: 'api.marketplace.template.list',
    });
  }

  /** Publica un template en el marketplace del tenant activo. */
  public async createMarketplaceTemplate(
    payload: IMarketplaceTemplateCreateRequest,
  ): Promise<IMarketplaceTemplateRead> {
    return this.request<IMarketplaceTemplateRead>('POST', `${API_PATHS.marketplace}/templates`, {
      operation: 'api.marketplace.template.create',
      body: payload,
    });
  }

  /** Importa un template del marketplace a una campaña (genera una landing). */
  public async importMarketplaceTemplate(
    templateId: string,
    payload: IMarketplaceImportRequest,
  ): Promise<IMarketplaceImportResponse> {
    return this.request<IMarketplaceImportResponse>(
      'POST',
      `${API_PATHS.marketplace}/templates/${templateId}/import`,
      {
        operation: 'api.marketplace.template.import',
        body: payload,
      },
    );
  }

  /** Registra un evento de analítica en el tenant activo. */
  public async recordAnalyticsEvent(
    payload: IAnalyticsEventCreateRequest,
  ): Promise<IAnalyticsEventRead> {
    return this.request<IAnalyticsEventRead>('POST', `${API_PATHS.analytics}/events`, {
      operation: 'api.analytics.event.record',
      body: payload,
    });
  }

  /** Obtiene el resumen del dashboard de analítica del tenant activo. */
  public async getAnalyticsDashboard(): Promise<IAnalyticsDashboardResponse> {
    return this.request<IAnalyticsDashboardResponse>('GET', `${API_PATHS.analytics}/dashboard`, {
      operation: 'api.analytics.dashboard.get',
    });
  }

  /** Despliega la landing del tenant activo al CDN. */
  public async deployToCdn(landingId: LandingId): Promise<ICdnDeployResponse> {
    return this.request<ICdnDeployResponse>('POST', `${API_PATHS.cdn}/deploy/${landingId}`, {
      operation: 'api.cdn.deploy',
    });
  }

  /** Devuelve la apariencia del tenant activo (404 si no está definida). */
  public async getTenantAppearance(): Promise<ITenantAppearanceRead> {
    return this.request<ITenantAppearanceRead>('GET', API_PATHS.appearance, {
      operation: 'tenant.appearance.get',
    });
  }

  /** Crea o reemplaza la apariencia del tenant activo (una fila por tenant). */
  public async upsertTenantAppearance(
    payload: ITenantAppearanceUpsert,
  ): Promise<ITenantAppearanceRead> {
    return this.request<ITenantAppearanceRead>('PUT', API_PATHS.appearance, {
      operation: 'tenant.appearance.upsert',
      body: payload,
    });
  }

  /** Extrae una propuesta de apariencia desde una URL de marca (Fase 5). */
  public async extractUrlStyles(url: string): Promise<IAppearanceProposal> {
    return this.request<IAppearanceProposal>('POST', `${API_PATHS.appearance}/extract-url`, {
      operation: 'tenant.appearance.extract_url',
      body: { url },
    });
  }

  /** Lista las configuraciones de rebranding guardadas del tenant activo. */
  public async listRebrandingConfigs(): Promise<IRebrandingConfigRead[]> {
    return this.request<IRebrandingConfigRead[]>('GET', `${API_PATHS.appearance}/rebranding`, {
      operation: 'tenant.appearance.rebranding.list',
    });
  }

  /** Guarda una configuración de rebranding por URL (re-extrae y aplica). */
  public async createRebrandingConfig(
    payload: IRebrandingConfigCreate,
  ): Promise<IRebrandingConfigRead> {
    return this.request<IRebrandingConfigRead>('POST', `${API_PATHS.appearance}/rebranding`, {
      operation: 'tenant.appearance.rebranding.create',
      body: payload,
    });
  }

  /** Elimina una configuración de rebranding del tenant activo. */
  public async deleteRebrandingConfig(configId: string): Promise<void> {
    return this.request<void>('DELETE', `${API_PATHS.appearance}/rebranding/${configId}`, {
      operation: 'tenant.appearance.rebranding.delete',
    });
  }

  /** Lista el contenido estructurado del tenant activo (paginado). */
  public async listContentItems(query: IPageQuery = {}): Promise<IPage<IContentItemRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.content}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IContentItemRead>>('GET', path, {
      operation: 'content.list',
    });
  }

  /** Crea un ítem de contenido en el tenant activo. */
  public async createContentItem(payload: IContentItemCreate): Promise<IContentItemRead> {
    return this.request<IContentItemRead>('POST', API_PATHS.content, {
      operation: 'content.create',
      body: payload,
    });
  }

  /** Devuelve un ítem de contenido del tenant activo por su identificador. */
  public async getContentItem(itemId: string): Promise<IContentItemRead> {
    return this.request<IContentItemRead>('GET', `${API_PATHS.content}/${itemId}`, {
      operation: 'content.get',
    });
  }

  /** Actualiza un ítem de contenido del tenant activo (PUT). */
  public async updateContentItem(
    itemId: string,
    payload: IContentItemUpdate,
  ): Promise<IContentItemRead> {
    return this.request<IContentItemRead>('PUT', `${API_PATHS.content}/${itemId}`, {
      operation: 'content.update',
      body: payload,
    });
  }

  /** Elimina lógicamente un ítem de contenido del tenant activo. */
  public async deleteContentItem(itemId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.content}/${itemId}`, {
      operation: 'content.delete',
    });
  }

  /** Ingiere un archivo (PDF/TXT/CSV) como documento de la base de conocimiento. */
  public async ingestDocumentFile(file: File): Promise<IIngestResultRead> {
    const form = new FormData();
    form.append('file', file);
    return this.request<IIngestResultRead>('POST', API_PATHS.documentsIngestFile, {
      operation: 'documents.ingestFile',
      body: form,
    });
  }

  /** Ingiere una URL remota como documento de la base de conocimiento. */
  public async ingestDocumentUrl(payload: IIngestUrlRequest): Promise<IIngestResultRead> {
    return this.request<IIngestResultRead>('POST', API_PATHS.documentsIngestUrl, {
      operation: 'documents.ingestUrl',
      body: payload,
    });
  }

  /** Lista los documentos ingeridos del tenant activo (paginado). */
  public async listDocuments(query: IPageQuery = {}): Promise<IPage<IDocumentRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.documents}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IDocumentRead>>('GET', path, {
      operation: 'documents.list',
    });
  }

  /** Busca por texto sobre los documentos/chunks del tenant activo. */
  public async searchDocuments(payload: IDocumentSearchRequest): Promise<IDocumentSearchResult[]> {
    return this.request<IDocumentSearchResult[]>('POST', API_PATHS.documentsSearch, {
      operation: 'documents.search',
      body: payload,
    });
  }

  /** Devuelve un documento ingerido del tenant activo con su contenido completo. */
  public async getDocument(documentId: string): Promise<IDocumentContentRead> {
    return this.request<IDocumentContentRead>('GET', `${API_PATHS.documents}/${documentId}`, {
      operation: 'documents.get',
    });
  }

  /** Elimina lógicamente un documento ingerido del tenant activo. */
  public async deleteDocument(documentId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.documents}/${documentId}`, {
      operation: 'documents.delete',
    });
  }

  /** Lista los sinónimos del bot del tenant activo (paginado). */
  public async listSynonyms(query: IPageQuery = {}): Promise<IPage<ISynonymRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.synonyms}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ISynonymRead>>('GET', path, {
      operation: 'synonyms.list',
    });
  }

  /** Crea un sinónimo del bot en el tenant activo (término único). */
  public async createSynonym(payload: ISynonymCreate): Promise<ISynonymRead> {
    return this.request<ISynonymRead>('POST', API_PATHS.synonyms, {
      operation: 'synonyms.create',
      body: payload,
    });
  }

  /** Actualiza un sinónimo del bot del tenant activo (PUT). */
  public async updateSynonym(synonymId: string, payload: ISynonymUpdate): Promise<ISynonymRead> {
    return this.request<ISynonymRead>('PUT', `${API_PATHS.synonyms}/${synonymId}`, {
      operation: 'synonyms.update',
      body: payload,
    });
  }

  /** Elimina lógicamente un sinónimo del bot del tenant activo. */
  public async deleteSynonym(synonymId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.synonyms}/${synonymId}`, {
      operation: 'synonyms.delete',
    });
  }

  /** Importa sinónimos en lote (CSV o JSON, texto crudo en el cuerpo). */
  public async importSynonyms(payload: ISynonymImportRequest): Promise<ISynonymImportResultRead> {
    return this.request<ISynonymImportResultRead>('POST', API_PATHS.synonymsImport, {
      operation: 'synonyms.import',
      body: payload,
    });
  }

  /** Exporta los sinónimos del tenant activo como CSV o JSON (texto crudo). */
  public async exportSynonyms(format: 'csv' | 'json'): Promise<string> {
    return this.request<string>('GET', `${API_PATHS.synonymsExport}?file_format=${format}`, {
      operation: 'synonyms.export',
      rawText: true,
    });
  }

  /** Lista las keywords del bot del tenant activo (paginado). */
  public async listKeywords(query: IPageQuery = {}): Promise<IPage<IKeywordRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.keywords}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IKeywordRead>>('GET', path, {
      operation: 'keywords.list',
    });
  }

  /** Crea una keyword del bot en el tenant activo (término único). */
  public async createKeyword(payload: IKeywordCreate): Promise<IKeywordRead> {
    return this.request<IKeywordRead>('POST', API_PATHS.keywords, {
      operation: 'keywords.create',
      body: payload,
    });
  }

  /** Actualiza una keyword del bot del tenant activo (PUT). */
  public async updateKeyword(keywordId: string, payload: IKeywordUpdate): Promise<IKeywordRead> {
    return this.request<IKeywordRead>('PUT', `${API_PATHS.keywords}/${keywordId}`, {
      operation: 'keywords.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una keyword del bot del tenant activo. */
  public async deleteKeyword(keywordId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.keywords}/${keywordId}`, {
      operation: 'keywords.delete',
    });
  }

  /** Lista el catálogo del tenant activo (paginado). */
  public async listCatalogItems(query: IPageQuery = {}): Promise<IPage<ICatalogItemRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.catalog}${queryString ? `?${queryString}` : ''}`;
    const page = await this.request<IPage<ICatalogItemRead>>('GET', path, {
      operation: 'catalog.list',
    });
    return { ...page, items: page.items.map((item) => this.normalizeCatalogItem(item)) };
  }

  /** Crea un ítem del catálogo en el tenant activo (SKU único por tenant). */
  public async createCatalogItem(payload: ICatalogItemCreate): Promise<ICatalogItemRead> {
    const item = await this.request<ICatalogItemRead>('POST', API_PATHS.catalog, {
      operation: 'catalog.create',
      body: payload,
    });
    return this.normalizeCatalogItem(item);
  }

  /** Devuelve un ítem del catálogo del tenant activo por su identificador. */
  public async getCatalogItem(itemId: string): Promise<ICatalogItemRead> {
    const item = await this.request<ICatalogItemRead>('GET', `${API_PATHS.catalog}/${itemId}`, {
      operation: 'catalog.get',
    });
    return this.normalizeCatalogItem(item);
  }

  /** Actualiza un ítem del catálogo del tenant activo (PUT). */
  public async updateCatalogItem(
    itemId: string,
    payload: ICatalogItemUpdate,
  ): Promise<ICatalogItemRead> {
    const item = await this.request<ICatalogItemRead>('PUT', `${API_PATHS.catalog}/${itemId}`, {
      operation: 'catalog.update',
      body: payload,
    });
    return this.normalizeCatalogItem(item);
  }

  /** Elimina lógicamente un ítem del catálogo del tenant activo. */
  public async deleteCatalogItem(itemId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.catalog}/${itemId}`, {
      operation: 'catalog.delete',
    });
  }

  /** Lista los canales del bot del tenant activo (paginado, sin secretos). */
  public async listChannels(query: IPageQuery = {}): Promise<IPage<ITenantChannelRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.channels}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ITenantChannelRead>>('GET', path, {
      operation: 'channels.list',
    });
  }

  /** Crea un canal del bot en el tenant activo (secretos write-only). */
  public async createChannel(payload: ITenantChannelCreate): Promise<ITenantChannelRead> {
    return this.request<ITenantChannelRead>('POST', API_PATHS.channels, {
      operation: 'channels.create',
      body: payload,
    });
  }

  /** Devuelve un canal del tenant activo por su identificador (sin secretos). */
  public async getChannel(channelId: string): Promise<ITenantChannelRead> {
    return this.request<ITenantChannelRead>('GET', `${API_PATHS.channels}/${channelId}`, {
      operation: 'channels.get',
    });
  }

  /** Actualiza parcialmente un canal del tenant activo (PATCH). */
  public async updateChannel(
    channelId: string,
    payload: ITenantChannelUpdate,
  ): Promise<ITenantChannelRead> {
    return this.request<ITenantChannelRead>('PATCH', `${API_PATHS.channels}/${channelId}`, {
      operation: 'channels.update',
      body: payload,
    });
  }

  /** Elimina lógicamente un canal del tenant activo. */
  public async deleteChannel(channelId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.channels}/${channelId}`, {
      operation: 'channels.delete',
    });
  }

  /** Lista las conversaciones del bot del tenant activo (paginado). */
  public async listConversations(query: IPageQuery = {}): Promise<IPage<IConversationRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.botConversations}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IConversationRead>>('GET', path, {
      operation: 'bot.conversations.list',
    });
  }

  /** Lista los mensajes de una conversación (paginado, ascendente). */
  public async listConversationMessages(
    conversationId: string,
    query: IPageQuery = {},
  ): Promise<IPage<IMessageRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const base = `${API_PATHS.botConversations}/${conversationId}/messages`;
    const path = `${base}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IMessageRead>>('GET', path, {
      operation: 'bot.messages.list',
    });
  }

  /** Envía manualmente un mensaje de prueba a la cola D3 de una conversación. */
  public async sendConversationMessage(
    conversationId: string,
    payload: IMessageCreate,
  ): Promise<IMessageEnqueueResult> {
    return this.request<IMessageEnqueueResult>(
      'POST',
      `${API_PATHS.botConversations}/${conversationId}/messages`,
      {
        operation: 'bot.messages.send',
        body: payload,
      },
    );
  }

  /** Lista los proveedores de IA configurados del tenant activo (sin secretos). */
  public async listBotProviders(): Promise<IBotProviderConfigRead[]> {
    return this.request<IBotProviderConfigRead[]>('GET', API_PATHS.botProviders, {
      operation: 'bot.providers.list',
    });
  }

  /** Crea o reemplaza un proveedor de IA del tenant activo (sin secretos). */
  public async upsertBotProvider(payload: IBotProviderUpsert): Promise<IBotProviderConfigRead> {
    return this.request<IBotProviderConfigRead>('PUT', API_PATHS.botProviders, {
      operation: 'bot.providers.upsert',
      body: payload,
    });
  }

  /** Elimina lógicamente un proveedor de IA del tenant activo por clave compuesta tipo/orden. */
  public async deleteBotProvider(providerKind: string, order: number): Promise<void> {
    await this.request<void>(
      'DELETE',
      `${API_PATHS.botProviders}/${encodeURIComponent(providerKind)}/${order}`,
      {
        operation: 'bot.providers.delete',
      },
    );
  }

  /** Obtiene las estadísticas de la cola Redis D3 del tenant activo. */
  public async getBotQueueStats(): Promise<IQueueStatsRead> {
    return this.request<IQueueStatsRead>('GET', API_PATHS.botQueueStats, {
      operation: 'bot.queue.stats',
    });
  }

  /** Obtiene el uso de cuota L1 del tenant activo (proveedores + agregado). */
  public async getBotQuotaUsage(): Promise<IQuotaUsageResponse> {
    return this.request<IQuotaUsageResponse>('GET', API_PATHS.botQuotaUsage, {
      operation: 'bot.quota.usage',
    });
  }

  /** Prueba el router del bot con un mensaje crudo (sin persistir ni encolar). */
  public async testRouter(message: string): Promise<IRouterTraceRead> {
    return this.request<IRouterTraceRead>('POST', API_PATHS.botRouterTest, {
      body: { message },
      operation: 'bot.router.test',
    });
  }

  /** Lista los contactos del tenant activo (paginado). */
  public async listContacts(query: IPageQuery = {}): Promise<IPage<IContactRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/contacts${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IContactRead>>('GET', path, {
      operation: 'operations.contacts.list',
    });
  }

  /** Crea un contacto en el tenant activo (teléfono único por tenant). */
  public async createContact(payload: IContactCreate): Promise<IContactRead> {
    return this.request<IContactRead>('POST', `${API_PATHS.operations}/contacts`, {
      operation: 'operations.contacts.create',
      body: payload,
    });
  }

  /** Devuelve un contacto del tenant activo por su identificador. */
  public async getContact(contactId: string): Promise<IContactRead> {
    return this.request<IContactRead>('GET', `${API_PATHS.operations}/contacts/${contactId}`, {
      operation: 'operations.contacts.get',
    });
  }

  /** Actualiza un contacto del tenant activo (PUT). */
  public async updateContact(contactId: string, payload: IContactUpdate): Promise<IContactRead> {
    return this.request<IContactRead>('PUT', `${API_PATHS.operations}/contacts/${contactId}`, {
      operation: 'operations.contacts.update',
      body: payload,
    });
  }

  /** Elimina lógicamente un contacto del tenant activo. */
  public async deleteContact(contactId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.operations}/contacts/${contactId}`, {
      operation: 'operations.contacts.delete',
    });
  }

  /** Lista las plantillas de mensaje del tenant activo (paginado). */
  public async listTemplates(query: IPageQuery = {}): Promise<IPage<ITemplateRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/templates${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ITemplateRead>>('GET', path, {
      operation: 'operations.templates.list',
    });
  }

  /** Crea una plantilla de mensaje en el tenant activo (nombre único por tenant). */
  public async createTemplate(payload: ITemplateCreate): Promise<ITemplateRead> {
    return this.request<ITemplateRead>('POST', `${API_PATHS.operations}/templates`, {
      operation: 'operations.templates.create',
      body: payload,
    });
  }

  /** Devuelve una plantilla del tenant activo por su identificador. */
  public async getTemplate(templateId: string): Promise<ITemplateRead> {
    return this.request<ITemplateRead>('GET', `${API_PATHS.operations}/templates/${templateId}`, {
      operation: 'operations.templates.get',
    });
  }

  /** Actualiza una plantilla del tenant activo (PUT). */
  public async updateTemplate(
    templateId: string,
    payload: ITemplateUpdate,
  ): Promise<ITemplateRead> {
    return this.request<ITemplateRead>('PUT', `${API_PATHS.operations}/templates/${templateId}`, {
      operation: 'operations.templates.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una plantilla del tenant activo. */
  public async deleteTemplate(templateId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.operations}/templates/${templateId}`, {
      operation: 'operations.templates.delete',
    });
  }

  /** Lista los árboles de navegación del bot del tenant activo (paginado). */
  public async listNavigationTrees(query: IPageQuery = {}): Promise<IPage<INavigationTreeRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/navigation-trees${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<INavigationTreeRead>>('GET', path, {
      operation: 'operations.navigation-trees.list',
    });
  }

  /** Crea un árbol de navegación del bot en el tenant activo (nombre único por tenant). */
  public async createNavigationTree(payload: INavigationTreeCreate): Promise<INavigationTreeRead> {
    return this.request<INavigationTreeRead>('POST', `${API_PATHS.operations}/navigation-trees`, {
      operation: 'operations.navigation-trees.create',
      body: payload,
    });
  }

  /** Devuelve un árbol de navegación del tenant activo por su identificador. */
  public async getNavigationTree(treeId: string): Promise<INavigationTreeRead> {
    return this.request<INavigationTreeRead>(
      'GET',
      `${API_PATHS.operations}/navigation-trees/${treeId}`,
      {
        operation: 'operations.navigation-trees.get',
      },
    );
  }

  /** Actualiza un árbol de navegación del tenant activo (PUT). */
  public async updateNavigationTree(
    treeId: string,
    payload: INavigationTreeUpdate,
  ): Promise<INavigationTreeRead> {
    return this.request<INavigationTreeRead>(
      'PUT',
      `${API_PATHS.operations}/navigation-trees/${treeId}`,
      {
        operation: 'operations.navigation-trees.update',
        body: payload,
      },
    );
  }

  /** Elimina lógicamente un árbol de navegación del tenant activo. */
  public async deleteNavigationTree(treeId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.operations}/navigation-trees/${treeId}`, {
      operation: 'operations.navigation-trees.delete',
    });
  }

  /** Lista las campañas de envío del tenant activo (paginado). */
  public async listCampaigns(query: IPageQuery = {}): Promise<IPage<ICampaignRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/campaigns${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ICampaignRead>>('GET', path, {
      operation: 'operations.campaigns.list',
    });
  }

  /** Crea una campaña de envío en el tenant activo. */
  public async createCampaign(payload: ICampaignCreate): Promise<ICampaignRead> {
    return this.request<ICampaignRead>('POST', `${API_PATHS.operations}/campaigns`, {
      operation: 'operations.campaigns.create',
      body: payload,
    });
  }

  /** Devuelve una campaña del tenant activo por su identificador. */
  public async getCampaign(campaignId: string): Promise<ICampaignRead> {
    return this.request<ICampaignRead>('GET', `${API_PATHS.operations}/campaigns/${campaignId}`, {
      operation: 'operations.campaigns.get',
    });
  }

  /** Actualiza una campaña del tenant activo (PUT). */
  public async updateCampaign(
    campaignId: string,
    payload: ICampaignUpdate,
  ): Promise<ICampaignRead> {
    return this.request<ICampaignRead>('PUT', `${API_PATHS.operations}/campaigns/${campaignId}`, {
      operation: 'operations.campaigns.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una campaña del tenant activo. */
  public async deleteCampaign(campaignId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.operations}/campaigns/${campaignId}`, {
      operation: 'operations.campaigns.delete',
    });
  }

  /** Añade un destinatario a una campaña del tenant activo. */
  public async addCampaignRecipient(
    campaignId: string,
    payload: ICampaignRecipientCreate,
  ): Promise<ICampaignRecipientRead> {
    return this.request<ICampaignRecipientRead>(
      'POST',
      `${API_PATHS.operations}/campaigns/${campaignId}/recipients`,
      {
        operation: 'operations.recipients.add',
        body: payload,
      },
    );
  }

  /** Lista los destinatarios de una campaña del tenant activo (paginado). */
  public async listCampaignRecipients(
    campaignId: string,
    query: IPageQuery = {},
  ): Promise<IPage<ICampaignRecipientRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/campaigns/${campaignId}/recipients${
      queryString ? `?${queryString}` : ''
    }`;
    return this.request<IPage<ICampaignRecipientRead>>('GET', path, {
      operation: 'operations.recipients.list',
    });
  }

  /** Actualiza el estado de un destinatario de campaña (PUT). */
  public async updateCampaignRecipient(
    recipientId: string,
    payload: ICampaignRecipientUpdate,
  ): Promise<ICampaignRecipientRead> {
    return this.request<ICampaignRecipientRead>(
      'PUT',
      `${API_PATHS.operations}/recipients/${recipientId}`,
      {
        operation: 'operations.recipients.update',
        body: payload,
      },
    );
  }

  /** Despacha una campaña del tenant de forma inmediata (POST /campaigns/{id}/dispatch, C-2). */
  public async dispatchCampaign(campaignId: string): Promise<IDispatchResultRead> {
    return this.request<IDispatchResultRead>(
      'POST',
      `${API_PATHS.operations}/campaigns/${campaignId}/dispatch`,
      {
        operation: 'operations.campaigns.dispatch',
      },
    );
  }

  /** Envía un mensaje individual a un teléfono reutilizando una plantilla del tenant (B.4). */
  public async sendIndividualMessage(
    payload: IIndividualSendInput,
  ): Promise<IMessageSendResultRead> {
    return this.request<IMessageSendResultRead>(
      'POST',
      `${API_PATHS.operations}/messages/send-individual`,
      {
        operation: 'operations.messages.send-individual',
        body: payload,
      },
    );
  }

  /** Importa contactos en lote desde un CSV (texto crudo, POST /contacts/import-csv, B.6). */
  public async importContactsCsv(payload: ICsvImportRequest): Promise<IImportResultRead> {
    return this.request<IImportResultRead>('POST', `${API_PATHS.operations}/contacts/import-csv`, {
      operation: 'operations.contacts.import',
      body: payload,
    });
  }

  /** Importa destinatarios de una campaña en lote desde un CSV (texto crudo, B.4). */
  public async importCampaignRecipientsCsv(
    campaignId: string,
    payload: ICsvImportRequest,
  ): Promise<IImportResultRead> {
    return this.request<IImportResultRead>(
      'POST',
      `${API_PATHS.operations}/campaigns/${campaignId}/recipients/import-csv`,
      {
        operation: 'operations.recipients.import',
        body: payload,
      },
    );
  }

  /** Sube un archivo de destinatarios reutilizable (POST /operations/recipient-files, GAP 2). */
  public async uploadRecipientFile(payload: IRecipientFileCreate): Promise<IRecipientFileRead> {
    return this.request<IRecipientFileRead>('POST', `${API_PATHS.operations}/recipient-files`, {
      operation: 'operations.recipient-files.create',
      body: payload,
    });
  }

  /** Lista los archivos de destinatarios reutilizables del tenant activo (paginado). */
  public async listRecipientFiles(query: IPageQuery = {}): Promise<IPage<IRecipientFileRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/recipient-files${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IRecipientFileRead>>('GET', path, {
      operation: 'operations.recipient-files.list',
    });
  }

  /** Vista previa de los contactos de un archivo (dry-run, sin insertar). */
  public async previewRecipientFile(fileId: string): Promise<IRecipientFilePreviewRead> {
    return this.request<IRecipientFilePreviewRead>(
      'POST',
      `${API_PATHS.operations}/recipient-files/${fileId}/preview`,
      {
        operation: 'operations.recipient-files.preview',
      },
    );
  }

  /** Despacha una campaña desde un archivo de destinatarios (POST /campaigns/{id}/dispatch-from-file, GAP 2). */
  public async dispatchCampaignFromFile(
    campaignId: string,
    payload: IRecipientFileDispatchInput,
  ): Promise<IDispatchResultRead> {
    return this.request<IDispatchResultRead>(
      'POST',
      `${API_PATHS.operations}/campaigns/${campaignId}/dispatch-from-file`,
      {
        operation: 'operations.campaigns.dispatch-from-file',
        body: payload,
      },
    );
  }

  /** Lista las intervenciones humanas del tenant activo (paginado, filtro por estado). */
  public async listInterventions(
    query: IPageQuery & { state?: string } = {},
  ): Promise<IPage<IInterventionRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    if (query.state !== undefined) params.set('state', query.state);
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/interventions${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IInterventionRead>>('GET', path, {
      operation: 'operations.interventions.list',
    });
  }

  /** Crea una intervención humana sobre una conversación (cola B.7 → eslabón ⑤). */
  public async createIntervention(payload: IInterventionCreate): Promise<IInterventionRead> {
    return this.request<IInterventionRead>('POST', `${API_PATHS.operations}/interventions`, {
      operation: 'operations.interventions.create',
      body: payload,
    });
  }

  /** Devuelve una intervención del tenant activo por su identificador. */
  public async getIntervention(interventionId: string): Promise<IInterventionRead> {
    return this.request<IInterventionRead>(
      'GET',
      `${API_PATHS.operations}/interventions/${interventionId}`,
      {
        operation: 'operations.interventions.get',
      },
    );
  }

  /** Actualiza una intervención humana del tenant activo (PUT). */
  public async updateIntervention(
    interventionId: string,
    payload: IInterventionUpdate,
  ): Promise<IInterventionRead> {
    return this.request<IInterventionRead>(
      'PUT',
      `${API_PATHS.operations}/interventions/${interventionId}`,
      {
        operation: 'operations.interventions.update',
        body: payload,
      },
    );
  }

  /** Devuelve el contador de intervenciones pendientes del tenant activo (badge 🆕 del panel). */
  public async getInterventionsPendingCount(): Promise<IInterventionPendingCountRead> {
    return this.request<IInterventionPendingCountRead>(
      'GET',
      `${API_PATHS.operations}/interventions/pending-count`,
      {
        operation: 'operations.interventions.pending-count',
      },
    );
  }

  /** Asigna una intervención pendiente a un operador humano (POST /assign, B.7). */
  public async assignIntervention(
    interventionId: string,
    payload: IInterventionAssignRequest,
  ): Promise<IInterventionRead> {
    return this.request<IInterventionRead>(
      'POST',
      `${API_PATHS.operations}/interventions/${interventionId}/assign`,
      {
        operation: 'operations.interventions.assign',
        body: payload,
      },
    );
  }

  /** Lista los mensajes de la conversación de una intervención (B.7 workspace "Atendiendo"). */
  public async listInterventionMessages(interventionId: string): Promise<IMessageRead[]> {
    return this.request<IMessageRead[]>(
      'GET',
      `${API_PATHS.operations}/interventions/${interventionId}/messages`,
      {
        operation: 'operations.interventions.messages.list',
      },
    );
  }

  /** Responde a la conversación de una intervención en nombre del operador (B.7). */
  public async replyIntervention(
    interventionId: string,
    payload: IInterventionReplyRequest,
  ): Promise<IMessageRead> {
    return this.request<IMessageRead>(
      'POST',
      `${API_PATHS.operations}/interventions/${interventionId}/reply`,
      {
        operation: 'operations.interventions.reply',
        body: payload,
      },
    );
  }

  /** Cierra una intervención humana y marca su resolución (B.7). */
  public async closeIntervention(interventionId: string): Promise<IInterventionCloseResult> {
    return this.request<IInterventionCloseResult>(
      'POST',
      `${API_PATHS.operations}/interventions/${interventionId}/close`,
      {
        operation: 'operations.interventions.close',
      },
    );
  }

  /** Devuelve la configuración de mantenimiento del tenant activo (404 si no existe). */
  public async getMaintenanceConfig(): Promise<IMaintenanceConfigRead> {
    return this.request<IMaintenanceConfigRead>('GET', `${API_PATHS.operations}/maintenance`, {
      operation: 'operations.maintenance.get',
    });
  }

  /** Crea o reemplaza la configuración de mantenimiento del tenant activo (una fila por tenant). */
  public async upsertMaintenanceConfig(
    payload: IMaintenanceConfigUpsert,
  ): Promise<IMaintenanceConfigRead> {
    return this.request<IMaintenanceConfigRead>('PUT', `${API_PATHS.operations}/maintenance`, {
      operation: 'operations.maintenance.upsert',
      body: payload,
    });
  }

  /** Devuelve el resumen operativo del bot del tenant activo (B.1 Dashboard + B.2 Estadísticas). */
  public async getOperationsStatsOverview(): Promise<IStatsOverviewRead> {
    return this.request<IStatsOverviewRead>('GET', `${API_PATHS.operations}/stats/overview`, {
      operation: 'operations.stats.overview',
    });
  }

  /** Ejecuta la purga por dominio del tenant activo (POST, reutiliza privacidad M4). */
  public async purgeMaintenance(payload: IPurgeRequest): Promise<IMaintenanceActionRead> {
    return this.request<IMaintenanceActionRead>(
      'POST',
      `${API_PATHS.operations}/maintenance/purge`,
      {
        operation: 'operations.maintenance.purge',
        body: payload,
      },
    );
  }

  /** Ejecuta la optimización física del almacén del tenant activo (POST, VACUUM/reindex). */
  public async optimizeMaintenance(): Promise<IMaintenanceActionRead> {
    return this.request<IMaintenanceActionRead>(
      'POST',
      `${API_PATHS.operations}/maintenance/optimize`,
      {
        operation: 'operations.maintenance.optimize',
      },
    );
  }

  /** Lista las conversaciones activas del bot del tenant activo (paginado, Monitor Fase 7). */
  public async listActiveConversations(
    query: IPageQuery = {},
  ): Promise<IPage<IActiveConversationRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.operations}/monitor/active-conversations${
      queryString ? `?${queryString}` : ''
    }`;
    return this.request<IPage<IActiveConversationRead>>('GET', path, {
      operation: 'operations.monitor.active-conversations',
    });
  }

  /** Descarga el backup de la configuración de operación del tenant activo (B.9). */
  public async createBackup(): Promise<IBackupMetaRead> {
    return this.request<IBackupMetaRead>('GET', `${API_PATHS.operations}/maintenance/backup`, {
      operation: 'operations.maintenance.backup',
    });
  }

  /** Restaura un backup de la configuración de operación del tenant activo (B.9). */
  public async restoreBackup(file: File): Promise<IRestoreResultRead> {
    const form = new FormData();
    form.append('file', file);
    return this.request<IRestoreResultRead>('POST', `${API_PATHS.operations}/maintenance/restore`, {
      operation: 'operations.maintenance.restore',
      body: form,
    });
  }

  /** Devuelve el conteo total/activo/inactivo por tabla del tenant activo (B.9 Estado). */
  public async getTableStats(): Promise<ITableStatsRead[]> {
    return this.request<ITableStatsRead[]>(
      'GET',
      `${API_PATHS.operations}/maintenance/table-stats`,
      {
        operation: 'operations.maintenance.table-stats',
      },
    );
  }

  /** Ejecuta manualmente el mantenimiento programado configurado del tenant activo (B.9). */
  public async runScheduledMaintenance(): Promise<IScheduledRunResultRead> {
    return this.request<IScheduledRunResultRead>(
      'POST',
      `${API_PATHS.operations}/maintenance/run-scheduled`,
      {
        operation: 'operations.maintenance.run-scheduled',
      },
    );
  }

  /** Lista las campañas publicitarias del tenant activo (paginado, C-1 eslabón ①). */
  public async listAdCampaigns(query: IPageQuery = {}): Promise<IPage<IAdCampaignRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.ads}${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IAdCampaignRead>>('GET', path, {
      operation: 'ads.campaigns.list',
    });
  }

  /** Crea una campaña publicitaria en el tenant activo (C-1 eslabón ①). */
  public async createAdCampaign(payload: IAdCampaignCreate): Promise<IAdCampaignRead> {
    return this.request<IAdCampaignRead>('POST', `${API_PATHS.ads}`, {
      operation: 'ads.campaigns.create',
      body: payload,
    });
  }

  /** Devuelve una campaña publicitaria del tenant activo por su identificador (C-1). */
  public async getAdCampaign(adCampaignId: string): Promise<IAdCampaignRead> {
    return this.request<IAdCampaignRead>('GET', `${API_PATHS.ads}/${adCampaignId}`, {
      operation: 'ads.campaigns.get',
    });
  }

  /** Actualiza parcialmente una campaña publicitaria del tenant activo (PATCH, C-1). */
  public async updateAdCampaign(
    adCampaignId: string,
    payload: IAdCampaignUpdate,
  ): Promise<IAdCampaignRead> {
    return this.request<IAdCampaignRead>('PATCH', `${API_PATHS.ads}/${adCampaignId}`, {
      operation: 'ads.campaigns.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una campaña publicitaria del tenant activo (C-1). */
  public async deleteAdCampaign(adCampaignId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.ads}/${adCampaignId}`, {
      operation: 'ads.campaigns.delete',
    });
  }

  // ── Dominios personalizados (PSEO hosts) ──────────────────────────────────

  /** Lista los dominios personalizados del tenant activo (sin paginar). */
  public async listPseoHosts(): Promise<IPseoHostRead[]> {
    return this.request<IPseoHostRead[]>('GET', `${API_PATHS.pseoHosts}`, {
      operation: 'pseo.hosts.list',
    });
  }

  /** Registra un dominio personalizado del tenant activo (pendiente de verificar). */
  public async requestPseoHost(payload: IPseoHostRequest): Promise<IPseoHostRead> {
    return this.request<IPseoHostRead>('POST', `${API_PATHS.pseoHosts}`, {
      operation: 'pseo.hosts.request',
      body: payload,
    });
  }

  /** Verifica la propiedad DNS de un dominio y lo activa (idempotente). */
  public async verifyPseoHost(hostId: string): Promise<IPseoHostRead> {
    return this.request<IPseoHostRead>('POST', `${API_PATHS.pseoHosts}/${hostId}/verify`, {
      operation: 'pseo.hosts.verify',
    });
  }

  /** Elimina lógicamente un dominio personalizado del tenant activo. */
  public async deletePseoHost(hostId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.pseoHosts}/${hostId}`, {
      operation: 'pseo.hosts.delete',
    });
  }

  // ── CRM: etapas (P3, M1) ──────────────────────────────────────────────────

  /** Lista las etapas del pipeline del tenant activo (P3, M1). */
  public async listStages(): Promise<IStageRead[]> {
    return this.request<IStageRead[]>('GET', `${API_PATHS.crm}/stages`, {
      operation: 'crm.stages.list',
    });
  }

  /** Crea una etapa del pipeline del tenant activo (P3, M1). */
  public async createStage(payload: IStageCreate): Promise<IStageRead> {
    return this.request<IStageRead>('POST', `${API_PATHS.crm}/stages`, {
      operation: 'crm.stages.create',
      body: payload,
    });
  }

  /** Devuelve una etapa del pipeline por su identificador (P3, M1). */
  public async getStage(stageId: string): Promise<IStageRead> {
    return this.request<IStageRead>('GET', `${API_PATHS.crm}/stages/${stageId}`, {
      operation: 'crm.stages.get',
    });
  }

  /** Actualiza parcialmente una etapa del pipeline (PATCH, P3, M1). */
  public async updateStage(stageId: string, payload: IStageUpdate): Promise<IStageRead> {
    return this.request<IStageRead>('PATCH', `${API_PATHS.crm}/stages/${stageId}`, {
      operation: 'crm.stages.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una etapa del pipeline (P3, M1). */
  public async deleteStage(stageId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.crm}/stages/${stageId}`, {
      operation: 'crm.stages.delete',
    });
  }

  // ── CRM: oportunidades (P3, M1) ───────────────────────────────────────────

  /** Lista las oportunidades del tenant activo (paginado + filtros, P3, M1). */
  public async listDeals(query: ICrmDealsQuery = {}): Promise<IPage<IDealRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    if (query.stage_id !== undefined) params.set('stage_id', query.stage_id);
    if (query.owner_id !== undefined) params.set('owner_id', query.owner_id);
    if (query.status !== undefined) params.set('status', query.status);
    const queryString = params.toString();
    const path = `${API_PATHS.crm}/deals${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<IDealRead>>('GET', path, {
      operation: 'crm.deals.list',
    });
  }

  /** Crea una oportunidad en el pipeline del tenant activo (P3, M1). */
  public async createDeal(payload: IDealCreate): Promise<IDealRead> {
    return this.request<IDealRead>('POST', `${API_PATHS.crm}/deals`, {
      operation: 'crm.deals.create',
      body: payload,
    });
  }

  /** Devuelve una oportunidad por su identificador (P3, M1). */
  public async getDeal(dealId: string): Promise<IDealRead> {
    return this.request<IDealRead>('GET', `${API_PATHS.crm}/deals/${dealId}`, {
      operation: 'crm.deals.get',
    });
  }

  /** Actualiza parcialmente una oportunidad (PATCH, incluye mover de etapa, P3, M1). */
  public async updateDeal(dealId: string, payload: IDealUpdate): Promise<IDealRead> {
    return this.request<IDealRead>('PATCH', `${API_PATHS.crm}/deals/${dealId}`, {
      operation: 'crm.deals.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una oportunidad (P3, M1). */
  public async deleteDeal(dealId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.crm}/deals/${dealId}`, {
      operation: 'crm.deals.delete',
    });
  }

  /** Devuelve el historial de movimientos de etapa de una oportunidad (P3, M1). */
  public async listDealHistory(dealId: string): Promise<IStageChangeRead[]> {
    return this.request<IStageChangeRead[]>('GET', `${API_PATHS.crm}/deals/${dealId}/history`, {
      operation: 'crm.deals.history',
    });
  }

  /** Lista las tareas vinculadas a una oportunidad (paginado, P3, M2). */
  public async listDealTasks(
    dealId: string,
    query: ICrmTasksQuery = {},
  ): Promise<IPage<ITaskRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    const queryString = params.toString();
    const path = `${API_PATHS.crm}/deals/${dealId}/tasks${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ITaskRead>>('GET', path, {
      operation: 'crm.deals.tasks.list',
    });
  }

  /** Crea una tarea anclada a una oportunidad (P3, M2). */
  public async createDealTask(dealId: string, payload: ITaskCreate): Promise<ITaskRead> {
    return this.request<ITaskRead>('POST', `${API_PATHS.crm}/deals/${dealId}/tasks`, {
      operation: 'crm.deals.tasks.create',
      body: payload,
    });
  }

  // ── CRM: tareas (P3, M2) ──────────────────────────────────────────────────

  /** Lista las tareas del tenant activo (paginado + filtro por deal, P3, M2). */
  public async listTasks(query: ICrmTasksQuery = {}): Promise<IPage<ITaskRead>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
    if (query.deal_id !== undefined) params.set('deal_id', query.deal_id);
    const queryString = params.toString();
    const path = `${API_PATHS.crm}/tasks${queryString ? `?${queryString}` : ''}`;
    return this.request<IPage<ITaskRead>>('GET', path, {
      operation: 'crm.tasks.list',
    });
  }

  /** Crea una tarea de seguimiento en el tenant activo (P3, M2). */
  public async createTask(payload: ITaskCreate): Promise<ITaskRead> {
    return this.request<ITaskRead>('POST', `${API_PATHS.crm}/tasks`, {
      operation: 'crm.tasks.create',
      body: payload,
    });
  }

  /** Devuelve una tarea por su identificador (P3, M2). */
  public async getTask(taskId: string): Promise<ITaskRead> {
    return this.request<ITaskRead>('GET', `${API_PATHS.crm}/tasks/${taskId}`, {
      operation: 'crm.tasks.get',
    });
  }

  /** Actualiza parcialmente una tarea (PATCH, P3, M2). */
  public async updateTask(taskId: string, payload: ITaskUpdate): Promise<ITaskRead> {
    return this.request<ITaskRead>('PATCH', `${API_PATHS.crm}/tasks/${taskId}`, {
      operation: 'crm.tasks.update',
      body: payload,
    });
  }

  /** Elimina lógicamente una tarea (P3, M2). */
  public async deleteTask(taskId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.crm}/tasks/${taskId}`, {
      operation: 'crm.tasks.delete',
    });
  }

  // ── CRM: SLA (P3, M5) ─────────────────────────────────────────────────────

  /** Lista las políticas SLA por etapa del tenant activo (P3, M5). */
  public async listSla(): Promise<ISlaRead[]> {
    return this.request<ISlaRead[]>('GET', `${API_PATHS.crm}/sla`, {
      operation: 'crm.sla.list',
    });
  }

  /** Crea o actualiza la política SLA de una etapa (PUT, P3, M5). */
  public async upsertSla(payload: ISlaUpsert): Promise<ISlaRead> {
    return this.request<ISlaRead>('PUT', `${API_PATHS.crm}/sla`, {
      operation: 'crm.sla.upsert',
      body: payload,
    });
  }

  // ── CRM: embudo y resumen (P3/M4, P4) ─────────────────────────────────────

  /** Devuelve el reporte del embudo comercial del tenant activo (P3, M4). */
  public async getFunnel(): Promise<IFunnelRead> {
    return this.request<IFunnelRead>('GET', `${API_PATHS.crm}/funnel`, {
      operation: 'crm.funnel.get',
    });
  }

  /** Devuelve el resumen de oportunidades de un cliente por email (P4, portal). */
  public async getCrmSummary(email: string): Promise<ICrmSummaryRead> {
    const params = new URLSearchParams();
    params.set('email', email);
    const queryString = params.toString();
    const path = `${API_PATHS.crm}/summary?${queryString}`;
    return this.request<ICrmSummaryRead>('GET', path, {
      operation: 'crm.summary.get',
    });
  }

  // ── Autenticación de estudio (RBAC) ───────────────────────────────────────

  /** Inicia sesión con email+password; guarda el JWT y devuelve perfil (sin tenant). */
  public async login(payload: ILoginRequest): Promise<ILoginResponse> {
    const result = await this.request<ILoginResponse>('POST', API_PATHS.authLogin, {
      operation: 'api.auth.login',
      tenant: false,
      body: payload,
    });
    setAccessToken(result.access_token);
    return result;
  }

  /** Cierra la sesión actual invalidando el token (sin tenant). */
  public async logout(): Promise<void> {
    try {
      await this.request<void>('POST', API_PATHS.authLogout, {
        operation: 'api.auth.logout',
        tenant: false,
      });
    } finally {
      clearAccessToken();
    }
  }

  /** Devuelve el perfil del usuario autenticado (sin tenant). */
  public async getMe(): Promise<IUserRead> {
    return this.request<IUserRead>('GET', API_PATHS.authMe, {
      operation: 'api.auth.me',
      tenant: false,
    });
  }

  /** Devuelve las membresías (tenant+rol) del usuario autenticado (sin tenant). */
  public async getMyMemberships(): Promise<IMembershipRead[]> {
    return this.request<IMembershipRead[]>('GET', API_PATHS.authMyMemberships, {
      operation: 'api.auth.myMemberships',
      tenant: false,
    });
  }

  /** Cambia la contraseña del usuario autenticado (sin tenant). */
  public async changePassword(payload: IChangePasswordRequest): Promise<void> {
    await this.request<void>('POST', API_PATHS.authChangePassword, {
      operation: 'api.auth.changePassword',
      tenant: false,
      body: payload,
    });
  }

  /** Actualiza el perfil del usuario autenticado (sin tenant). */
  public async updateMe(payload: IUserUpdate): Promise<IUserRead> {
    return this.request<IUserRead>('PATCH', API_PATHS.authMe, {
      operation: 'api.auth.updateMe',
      tenant: false,
      body: payload,
    });
  }

  // ── Usuarios de plataforma (control plane, super-admin) ───────────────────

  /** Lista los usuarios de la plataforma (sin cabecera de tenant). */
  public async listUsers(): Promise<IUserRead[]> {
    return this.request<IUserRead[]>('GET', API_PATHS.users, {
      operation: 'api.users.list',
      tenant: false,
    });
  }

  /** Crea un usuario de plataforma (sin cabecera de tenant). */
  public async createUser(payload: IUserCreate): Promise<IUserRead> {
    return this.request<IUserRead>('POST', API_PATHS.users, {
      operation: 'api.users.create',
      tenant: false,
      body: payload,
    });
  }

  /** Actualiza parcialmente un usuario de plataforma (sin cabecera de tenant). */
  public async updateUser(userId: string, payload: IUserUpdate): Promise<IUserRead> {
    return this.request<IUserRead>('PATCH', `${API_PATHS.users}/${userId}`, {
      operation: 'api.users.update',
      tenant: false,
      body: payload,
    });
  }

  /** Elimina (soft-delete) un usuario de plataforma (sin cabecera de tenant). */
  public async deleteUser(userId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.users}/${userId}`, {
      operation: 'api.users.delete',
      tenant: false,
    });
  }

  /** Lista las membresías de un usuario (sin cabecera de tenant). */
  public async listUserMemberships(userId: string): Promise<IMembershipRead[]> {
    return this.request<IMembershipRead[]>('GET', `${API_PATHS.users}/${userId}/memberships`, {
      operation: 'api.users.memberships.list',
      tenant: false,
    });
  }

  /** Añade una membresía (tenant+rol) a un usuario (sin cabecera de tenant). */
  public async addUserMembership(payload: IMembershipCreate): Promise<IMembershipRead> {
    return this.request<IMembershipRead>(
      'POST',
      `${API_PATHS.users}/${payload.user_id}/memberships`,
      {
        operation: 'api.users.memberships.add',
        tenant: false,
        body: payload,
      },
    );
  }

  /** Elimina la membresía (tenant+rol) de un usuario (sin cabecera de tenant). */
  public async deleteUserMembership(userId: string, membershipId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.users}/${userId}/memberships/${membershipId}`, {
      operation: 'api.users.memberships.delete',
      tenant: false,
    });
  }

  // ── Miembros por tenant (RBAC, admin) ─────────────────────────────────────

  /** Lista los miembros del tenant activo (con cabecera de tenant). */
  public async listMembers(): Promise<IMembershipRead[]> {
    return this.request<IMembershipRead[]>('GET', API_PATHS.members, {
      operation: 'api.members.list',
    });
  }

  /** Añade un miembro al tenant activo por email (con cabecera de tenant). */
  public async addMember(payload: IMemberAddRequest): Promise<IMembershipRead> {
    return this.request<IMembershipRead>('POST', API_PATHS.members, {
      operation: 'api.members.add',
      body: payload,
    });
  }

  /** Actualiza el rol de un miembro del tenant activo (con cabecera de tenant). */
  public async updateMember(
    membershipId: string,
    payload: IMembershipUpdate,
  ): Promise<IMembershipRead> {
    return this.request<IMembershipRead>('PATCH', `${API_PATHS.members}/${membershipId}`, {
      operation: 'api.members.update',
      body: payload,
    });
  }

  /** Elimina un miembro del tenant activo (con cabecera de tenant). */
  public async removeMember(membershipId: string): Promise<void> {
    await this.request<void>('DELETE', `${API_PATHS.members}/${membershipId}`, {
      operation: 'api.members.remove',
    });
  }

  /**
   * Normaliza el precio del catálogo devuelto por el backend.
   *
   * Pydantic serializa `Decimal` como string en JSON (p. ej. `"99.90"`), pero
   * el contrato de dominio `ICatalogItemRead.price` es numérico. Esta frontera
   * (el cliente HTTP) traduce el cable a la forma tipada para que servicios,
   * store y componentes consuman siempre `price: number`.
   */
  private normalizeCatalogItem(item: ICatalogItemRead): ICatalogItemRead {
    if (typeof item.price === 'number' && Number.isFinite(item.price)) {
      return item;
    }
    const price = typeof item.price === 'string' ? Number(item.price) : Number.NaN;
    return { ...item, price: Number.isFinite(price) ? price : 0 };
  }

  /**
   * Ejecuta una petición HTTP tipada con multi-tenancy y manejo de errores.
   *
   * Envía `X-Tenant-Id` en todos los endpoints salvo los marcados
   * `tenant: false` (p. ej. health). Convierte respuestas no 2xx en
   * `ApiHttpError` y fallos de red en `ApiNetworkError` con contexto.
   */
  private async request<T>(
    method: HttpMethod,
    path: string,
    options: {
      operation: string;
      body?: unknown;
      tenant?: boolean;
      rawText?: boolean;
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // Los cuerpos `FormData` (subida de archivos) se envían tal cual: el navegador
    // fija la cabecera `Content-Type: multipart/form-data` con su propio boundary.
    const isFormData = options.body instanceof FormData;
    const headers: Record<string, string> = isFormData ? {} : { ...JSON_HEADERS };
    if (options.tenant !== false) {
      // El tenant se lee en tiempo de petición: si hay un tenant activo en runtime
      // (selector FASE D) se usa su UUID canónico (clave del backend); en caso
      // contrario se degrada al tenant de construcción (config), preservando el
      // comportamiento previo en pruebas. El backend resuelve tanto UUID como slug.
      headers[TENANT_HEADER] = getActiveTenantId() ?? this.tenantId;
    }
    // Autenticación de estudio (RBAC): si hay un JWT en sesión se adjunta como
    // `Authorization: Bearer <token>` en toda petición autenticada.
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const init: RequestInit = {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : isFormData
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    };
    const operation = options.operation;
    this.logger?.debug(operation, { method, url, tenant: options.tenant !== false });

    let response: Response;
    try {
      // `fetch` nativo exige que `this` sea `Window`; al guardarlo como campo se
      // pierde el receptor y el navegador lanza "Illegal invocation". Se invoca
      // con `globalThis` para que el fetch real y los mocks DI funcionen igual.
      response = await this.fetcher.call(globalThis, url, init);
    } catch (cause) {
      this.logger?.error(operation, { url, method, cause });
      throw new ApiNetworkError(operation, {
        url,
        method,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    if (!response.ok) {
      const body: unknown = await this.parseJson(response).catch(() => undefined);
      const message = extractApiErrorMessage(body) ?? `HTTP ${response.status}`;
      this.logger?.error(operation, { url, status: response.status, message });
      throw new ApiHttpError(message, operation, response.status, body, { url, method });
    }

    if (response.status === 204) {
      this.logger?.info(operation, { url, status: response.status });
      return undefined as T;
    }

    if (options.rawText === true) {
      const text = await response.text();
      this.logger?.info(operation, { url, status: response.status });
      return text as T;
    }

    const data = await this.parseJson<T>(response);
    this.logger?.info(operation, { url, status: response.status });
    return data;
  }

  /** Parsea el cuerpo JSON tolerando respuestas vacías. */
  private async parseJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

/** Fábrica del cliente HTTP desde la configuración (composition root). */
export function createApiClient(
  config: IAppConfig,
  fetcher?: IFetcher,
  logger?: ILogger,
): IApiClient {
  return HttpApiClient.fromConfig(config, fetcher, logger);
}

export type { CampaignId };
