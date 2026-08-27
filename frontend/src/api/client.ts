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
  ICdnDeployResponse,
  IAnalyticsEventCreateRequest,
  IAnalyticsEventRead,
  IAiGenerationRequest,
  IAiGenerationResponse,
  IAppointmentRequest,
  IAppointmentResponse,
  ICheckoutRequest,
  ICheckoutResponse,
  IDeveloperSchemaRead,
  IHealthResponse,
  ILandingCompileRequest,
  ILandingCompileResponse,
  ILandingCreate,
  ILandingPublishRequest,
  ILandingRead,
  ILandingUpdate,
  ILeadRequest,
  ILeadRead,
  IMarketplaceImportRequest,
  IMarketplaceImportResponse,
  IMarketplaceTemplateCreateRequest,
  IMarketplaceTemplateRead,
  IPage,
  IPageQuery,
  IPaymentRead,
  IQuoteRequest,
  IQuoteResponse,
  ISchemaGenerateRequest,
  ISchemaGenerateResponse,
  ISchemaValidateRequest,
  ISchemaValidateResponse,
  ISchemaVersionCreateRequest,
  ISchemaVersionRead,
  LandingId,
} from './types';

/** Función de fetch inyectable (DI — desacoplada para pruebas). */
export type IFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Métodos HTTP soportados por el cliente. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (options.tenant !== false) {
      headers[TENANT_HEADER] = this.tenantId;
    }

    const init: RequestInit = {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
