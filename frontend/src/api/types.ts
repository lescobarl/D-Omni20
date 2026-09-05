/**
 * Tipos DTO de la capa de API — espejo de los esquemas pydantic del backend.
 *
 * Contrato:
 * - Cada interfaz refleja 1:1 la respuesta/payload del backend (`/api/v1`).
 * - Los UUID y fechas se modelan como `string` (serialización JSON estándar).
 * - `config` es un diccionario libre (`Record<string, unknown>`) igual que
 *   `dict[str, Any]` en pydantic.
 */
import type { WorkflowType } from '@/types/editor';

/** Identificador UUIDv4 de una landing. */
export type LandingId = string;

/** Identificador UUIDv4 de una campaña. */
export type CampaignId = string;

/** Respuesta del endpoint de salud (`GET /api/v1/health`). */
export interface IHealthResponse {
  /** Estado general de la aplicación (`ok`). */
  status: string;
  /** Estado de conectividad con la base de datos. */
  database: string;
  /** Marca de tiempo UTC en formato ISO 8601. */
  time: string;
  /** Nombre público de la aplicación backend. */
  app_name: string;
  /** Versión del backend. */
  app_version: string;
  /** Entorno del backend (`development|staging|production`). */
  backend_env: string;
}

/** Tenant tal como lo expone el backend (`TenantRead`, control plane). */
export interface ITenantRead {
  /** Identificador UUIDv4 del tenant. */
  id: string;
  /** Slug único del tenant (identificador de cabecera `X-Tenant-Id`). */
  slug: string;
  /** Nombre visible del tenant. */
  name: string;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización (se incrementa en cada update). */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Payload de creación de un tenant (`TenantCreate`, control plane). */
export interface ITenantCreate {
  /** Slug único del tenant (identificador de cabecera `X-Tenant-Id`). */
  slug: string;
  /** Nombre visible del tenant. */
  name: string;
}

/** Payload de actualización parcial de un tenant (`TenantUpdate`, control plane). */
export interface ITenantUpdate {
  /** Nuevo nombre visible del tenant (el slug es inmutable). */
  name: string;
}

/** Landing tal como la expone el backend (`LandingRead`). */
export interface ILandingRead {
  /** Identificador UUIDv4 de la landing. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Identificador UUIDv4 de la campaña asociada. */
  campaign_id: string;
  /** Nombre visible de la landing. */
  name: string;
  /** Configuración del editor (bloques, título, workflow). */
  config: Record<string, unknown>;
  /** HTML compilado (null hasta la primera compilación). */
  compiled_html: string | null;
  /** Indica si la landing está publicada. */
  published: boolean;
  /** Fecha de publicación (null si nunca se publicó). */
  published_at: string | null;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización (se incrementa en cada update). */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Página paginada genérica (`Page[T]` del backend). */
export interface IPage<T> {
  /** Elementos de la página actual. */
  items: T[];
  /** Total de elementos disponibles en el backend. */
  total: number;
  /** Página solicitada (base 1). */
  page: number;
  /** Tamaño de página devuelto. */
  page_size: number;
}

/** Parámetros de paginación (`Pagination` del backend). */
export interface IPageQuery {
  /** Página a solicitar (>= 1). */
  page?: number;
  /** Tamaño de página (1-100). */
  page_size?: number;
}

/** Payload para crear una landing (`LandingCreate`). */
export interface ILandingCreate {
  /** Identificador UUIDv4 de la campaña asociada. */
  campaign_id: string;
  /** Nombre visible de la landing (1-255 caracteres). */
  name: string;
  /** Configuración inicial del editor. */
  config?: Record<string, unknown>;
}

/** Payload parcial para actualizar una landing (`LandingUpdate`, PATCH). */
export interface ILandingUpdate {
  /** Nuevo nombre de la landing (opcional). */
  name?: string;
  /** Nueva configuración del editor (opcional). */
  config?: Record<string, unknown>;
  /** Nuevo estado de publicación (opcional). */
  published?: boolean;
}

/** Solicitud de compilación (`LandingCompileRequest`). */
export interface ILandingCompileRequest {
  /** Configuración del editor a compilar (config → HTML). */
  config: Record<string, unknown>;
  /** Nombre de la plantilla de compilación (por defecto `default`). */
  template_name?: string;
  /** Indica si se debe minimizar el HTML resultante. */
  minify?: boolean;
}

/** Respuesta de compilación (`LandingCompileResponse`). */
export interface ILandingCompileResponse {
  /** HTML renderizado de la configuración. */
  html: string;
  /** Marca de tiempo UTC de la compilación. */
  compiled_at: string;
  /** Duración de la compilación en milisegundos. */
  duration_ms: number;
}

/** Solicitud de generación IA (`LandingAiGenerationRequest`). */
export interface IAiGenerationRequest {
  /** Prompt descriptivo de la landing a generar (1-4000 caracteres). */
  prompt: string;
  /** Tipo de workflow opcional que condiciona la generación. */
  workflow_type?: WorkflowType;
}

/** Respuesta de generación IA (`LandingAiGenerationResponse`). */
export interface IAiGenerationResponse {
  /** Configuración de la landing generada por el modelo. */
  config: Record<string, unknown>;
  /** Modelo de IA que generó la respuesta. */
  model: string;
  /** Indica si la respuesta provino de la caché del backend. */
  cached: boolean;
  /** Tokens de entrada consumidos por la generación. */
  prompt_tokens: number;
  /** Tokens de salida producidos por la generación. */
  completion_tokens: number;
  /** Marca de tiempo UTC de la generación. */
  generated_at: string;
}

/** Página del Portal del Cliente tal como se expone a los clientes. */
export interface IPortalPageRead {
  /** Identificador único de la página. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Slug único dentro del tenant (patrón `[a-z0-9-]+`). */
  slug: string;
  /** Título de la página. */
  title: string;
  /** Configuración de bloques de la página. */
  blocks: Record<string, unknown>;
  /** HTML compilado (null si aún no se publicó). */
  compiled_html: string | null;
  /** Indica si la página está publicada. */
  published: boolean;
  /** Marca de tiempo de la última publicación. */
  published_at: string | null;
  /** Marca de tiempo de creación. */
  created_at: string;
  /** Número de revisión de la página. */
  revision: number;
  /** Marca de tiempo de la última actualización. */
  updated_at: string;
}

/** Payload para crear una página del portal dentro del tenant activo. */
export interface IPortalPageCreate {
  /** Slug único dentro del tenant (patrón `[a-z0-9-]+`). */
  slug: string;
  /** Título de la página (1-255 caracteres). */
  title: string;
  /** Configuración de bloques de la página. */
  blocks?: Record<string, unknown>;
}

/** Payload parcial para actualizar una página del portal (PATCH semantics). */
export interface IPortalPageUpdate {
  /** Slug único dentro del tenant (patrón `[a-z0-9-]+`). */
  slug?: string;
  /** Título de la página (1-255 caracteres). */
  title?: string;
  /** Configuración de bloques de la página. */
  blocks?: Record<string, unknown>;
  /** Indica si la página está publicada. */
  published?: boolean;
}

/** Solicitud de (des)publicación de una página del portal. */
export interface IPortalPagePublishRequest {
  /** Indica si la página debe publicarse (true) o despublicarse (false). */
  published: boolean;
}

/** Solicitud de generación IA de una página del portal (prompt + voz de marca). */
export interface IPortalPageAiGenerationRequest {
  /** Prompt descriptivo de la página a generar (1-4000 caracteres). */
  prompt: string;
  /** Voz de marca opcional que condiciona la generación. */
  brand_voice?: Record<string, unknown>;
}

/** Respuesta de generación IA de una página del portal. */
export interface IPortalPageAiGenerationResponse {
  /** Slug de la página generada. */
  slug: string;
  /** Título de la página generada. */
  title: string;
  /** Configuración de bloques de la página generada. */
  blocks: Record<string, unknown>;
  /** Modelo de IA que generó la respuesta. */
  model: string;
  /** Indica si la respuesta provino de la caché del backend. */
  cached: boolean;
  /** Voz de marca usada en la generación. */
  brand_voice?: Record<string, unknown> | null;
  /** Tokens de entrada consumidos por la generación. */
  prompt_tokens: number;
  /** Tokens de salida producidos por la generación. */
  completion_tokens: number;
  /** Marca de tiempo UTC de la generación. */
  generated_at: string;
}

/** Solicitud de generación de JSON Schema (`SchemaGenerateRequest`). */
export interface ISchemaGenerateRequest {
  /** Prompt descriptivo del JSON Schema a generar (1-4000 caracteres). */
  prompt: string;
  /** Nombre opcional del schema (1-255 caracteres). */
  name?: string;
}

/** Respuesta de generación de JSON Schema (`SchemaGenerateResponse`). */
export interface ISchemaGenerateResponse {
  /** JSON Schema generado (Draft 2020-12). */
  schema: Record<string, unknown>;
  /** Modelo de IA que generó la respuesta. */
  model: string;
  /** Indica si la respuesta provino de la caché del backend. */
  cached: boolean;
  /** Tokens de entrada consumidos por la generación. */
  prompt_tokens: number;
  /** Tokens de salida producidos por la generación. */
  completion_tokens: number;
  /** Marca de tiempo UTC de la generación. */
  generated_at: string;
}

/** JSON Schema persistido expuesto por el backend (`DeveloperSchemaRead`). */
export interface IDeveloperSchemaRead {
  /** Identificador UUIDv4 del schema. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Nombre visible del schema. */
  name: string;
  /** Descripción opcional del schema. */
  description: string | null;
  /** JSON Schema (Draft 2020-12). */
  schema_json: Record<string, unknown>;
  /** Versión semver del schema. */
  version: string;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización. */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Incidencia individual de validación (`SchemaValidationIssue`). */
export interface ISchemaValidationIssue {
  /** Ruta del error dentro del JSON (p. ej. `properties.email` o `$`). */
  path: string;
  /** Mensaje legible del error de validación. */
  message: string;
  /** Palabra clave JSON Schema que falló (o `null` para errores de esquema). */
  keyword: string | null;
}

/** Solicitud de validación de JSON Schema (`SchemaValidateRequest`). */
export interface ISchemaValidateRequest {
  /** JSON Schema (Draft 2020-12) a validar. */
  schema: Record<string, unknown>;
  /** Datos opcionales a validar contra el esquema. */
  data?: Record<string, unknown>;
}

/** Respuesta de validación de JSON Schema (`SchemaValidateResponse`). */
export interface ISchemaValidateResponse {
  /** Indica si el esquema (y los datos, si se enviaron) son válidos. */
  valid: boolean;
  /** Número total de errores detectados. */
  errors: number;
  /** Incidencias de validación encontradas. */
  issues: ISchemaValidationIssue[];
}

/** Solicitud de creación de versión de schema (`SchemaVersionCreateRequest`). */
export interface ISchemaVersionCreateRequest {
  /** Versión semver (1-32 caracteres). */
  version: string;
  /** Instantánea JSON opcional (si se omite, se usa el schema actual). */
  schema_json?: Record<string, unknown>;
  /** Nota del cambio (máx. 2000 caracteres). */
  change_note?: string;
}

/** Versión de JSON Schema expuesta por el backend (`SchemaVersionRead`). */
export interface ISchemaVersionRead {
  /** Identificador UUIDv4 de la versión. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Identificador UUIDv4 del schema padre. */
  schema_id: string;
  /** Versión semver de la instantánea. */
  version: string;
  /** Instantánea del JSON Schema (Draft 2020-12) en esa versión. */
  schema_json: Record<string, unknown>;
  /** Nota del cambio (o `null` si no se registró). */
  change_note: string | null;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
}

/** Solicitud de (des)publicación (`LandingPublishRequest`). */
export interface ILandingPublishRequest {
  /** Estado de publicación deseado (por defecto `true`). */
  published?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// WORKFLOWS (checkout, leads, cotizaciones, citas)
// Espejo 1:1 de `app/schemas/workflow.py` del backend.
// ────────────────────────────────────────────────────────────────────────────

/** Solicitud de checkout directo (`CheckoutRequest`). Monto en unidades mayores. */
export interface ICheckoutRequest {
  /** Monto en unidades mayores (p. ej. 99.5 USD). */
  amount: number;
  /** Moneda ISO 4217 en minúsculas (por defecto `usd`). */
  currency?: string;
  /** Correo del cliente (opcional). */
  customer_email?: string | null;
  /** Nombre del cliente (opcional). */
  customer_name?: string | null;
  /** URL de retorno tras pago exitoso (opcional). */
  success_url?: string | null;
  /** URL de retorno tras cancelación (opcional). */
  cancel_url?: string | null;
  /** Metadatos libres de la transacción. */
  metadata?: Record<string, unknown>;
}

/** Respuesta del checkout (`CheckoutResponse`): URL de la pasarela + estado. */
export interface ICheckoutResponse {
  /** Identificador UUIDv4 del pago. */
  payment_id: string;
  /** Estado inicial del pago (p. ej. `pending`). */
  status: string;
  /** URL de la pasarela de pago. */
  checkout_url: string;
  /** Proveedor de pago (p. ej. `sandbox`). */
  provider: string;
}

/** Transacción de pago expuesta por el backend (`PaymentRead`). */
export interface IPaymentRead {
  /** Identificador UUIDv4 del pago. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Monto en unidades menores (centavos). */
  amount_minor: number;
  /** Moneda ISO 4217 en minúsculas. */
  currency: string;
  /** Estado del pago (`pending|paid|failed|cancelled`). */
  status: string;
  /** Proveedor de pago. */
  provider: string;
  /** Identificador de sesión del proveedor (opcional). */
  provider_session_id: string | null;
  /** Correo del cliente (opcional). */
  customer_email: string | null;
  /** Nombre del cliente (opcional). */
  customer_name: string | null;
  /** Metadatos libres de la transacción. */
  metadata: Record<string, unknown>;
  /** Motivo de fallo (opcional). */
  failure_reason: string | null;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización. */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Solicitud de captura de lead (`LeadRequest`). */
export interface ILeadRequest {
  /** Nombre del prospecto (1-255 caracteres). */
  name: string;
  /** Correo del prospecto (patrón de email). */
  email: string;
  /** Teléfono del prospecto (opcional, máx. 32). */
  phone?: string | null;
  /** Origen del lead (por defecto `landing`). */
  source?: string;
  /** Metadatos libres del lead. */
  metadata?: Record<string, unknown>;
}

/** Lead capturado expuesto por el backend (`LeadRead`). */
export interface ILeadRead {
  /** Identificador UUIDv4 del lead. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Nombre del prospecto. */
  name: string;
  /** Correo del prospecto. */
  email: string;
  /** Teléfono del prospecto (opcional). */
  phone: string | null;
  /** Origen del lead. */
  source: string;
  /** Estado del lead. */
  status: string;
  /** Metadatos libres del lead. */
  metadata: Record<string, unknown>;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización. */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Fila de atribución de un lead por campaña y fuente (`LeadAttributionRow`). */
export interface ILeadAttributionRow {
  /** Campaña de la que provino el lead (por defecto `direct`). */
  campaign: string;
  /** Fuente del lead (p. ej. `landing`, `facebook`, `google`). */
  source: string;
  /** Total de leads de la campaña/fuente. */
  total: number;
  /** Leads nuevos (estado `new`). */
  new: number;
  /** Leads contactados. */
  contacted: number;
  /** Leads convertidos. */
  converted: number;
  /** Leads perdidos. */
  lost: number;
}

/** Reporte de atribución por campaña del tenant activo (`LeadAttributionRead`). */
export interface ILeadAttributionRead {
  /** Filas de atribución agrupadas por campaña y fuente. */
  rows: ILeadAttributionRow[];
  /** Total de leads considerados en el reporte. */
  total_leads: number;
  /** Fecha de generación del reporte en formato ISO 8601. */
  generated_at: string;
}

/** Línea de servicio/producto de una cotización (`QuoteLineItem`). */
export interface IQuoteLineItem {
  /** Nombre del servicio (1-255 caracteres). */
  name: string;
  /** Descripción del servicio (opcional, máx. 2000). */
  description?: string | null;
  /** Cantidad (>= 1). */
  quantity: number;
  /** Precio unitario en unidades mayores (> 0). */
  unit_price: number;
}

/** Solicitud de generación de cotización (`QuoteRequest`). */
export interface IQuoteRequest {
  /** Nombre del cliente (1-255 caracteres). */
  customer_name: string;
  /** Correo del cliente (opcional). */
  customer_email?: string | null;
  /** Moneda ISO 4217 en minúsculas (por defecto `usd`). */
  currency?: string;
  /** Líneas de servicio (al menos una). */
  services: IQuoteLineItem[];
  /** Tasa de impuesto en puntos base (0-10000 = 0-100%). */
  tax_rate_bps?: number;
}

/** Respuesta de generación de cotización (`QuoteResponse`). */
export interface IQuoteResponse {
  /** Identificador UUIDv4 de la cotización. */
  quote_id: string;
  /** Estado de la cotización. */
  status: string;
  /** Subtotal en unidades mayores. */
  subtotal: number;
  /** Impuesto en unidades mayores. */
  tax: number;
  /** Total en unidades mayores. */
  total: number;
  /** Moneda de la cotización. */
  currency: string;
  /** URL de descarga del PDF (opcional). */
  pdf_url: string | null;
}

/** Cotización expuesta por el backend (`QuoteRead`). */
export interface IQuoteRead {
  /** Identificador UUIDv4 de la cotización. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Nombre del cliente. */
  customer_name: string;
  /** Correo del cliente (opcional). */
  customer_email: string | null;
  /** Moneda de la cotización. */
  currency: string;
  /** Líneas de servicio serializadas. */
  services: Array<Record<string, unknown>>;
  /** Subtotal en unidades menores. */
  subtotal_minor: number;
  /** Impuesto en unidades menores. */
  tax_minor: number;
  /** Total en unidades menores. */
  total_minor: number;
  /** Estado de la cotización. */
  status: string;
  /** Ruta del PDF generado (opcional). */
  pdf_path: string | null;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización. */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Solicitud de agendamiento de cita (`AppointmentRequest`). */
export interface IAppointmentRequest {
  /** Nombre del servicio (1-255 caracteres). */
  service: string;
  /** Fecha/hora de inicio en formato ISO 8601. */
  starts_at: string;
  /** Duración en minutos (5-480, por defecto 30). */
  duration_minutes?: number;
  /** Zona horaria IANA (por defecto `UTC`). */
  timezone?: string;
  /** Nombre del cliente (1-255 caracteres). */
  customer_name: string;
  /** Correo del cliente (opcional). */
  customer_email?: string | null;
  /** Teléfono del cliente (opcional, máx. 32). */
  customer_phone?: string | null;
  /** Notas de la cita (opcional, máx. 2000). */
  notes?: string | null;
}

/** Respuesta de agendamiento (`AppointmentResponse`): cita + URL del ICS. */
export interface IAppointmentResponse {
  /** Identificador UUIDv4 de la cita. */
  appointment_id: string;
  /** Estado de la cita. */
  status: string;
  /** Fecha/hora de inicio en formato ISO 8601. */
  starts_at: string;
  /** Fecha/hora de fin en formato ISO 8601. */
  ends_at: string;
  /** Zona horaria de la cita. */
  timezone: string;
  /** URL de descarga del calendario ICS (opcional). */
  ics_url: string | null;
}

/** Cita expuesta por el backend (`AppointmentRead`). */
export interface IAppointmentRead {
  /** Identificador UUIDv4 de la cita. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Nombre del servicio. */
  service: string;
  /** Fecha/hora de inicio en formato ISO 8601. */
  starts_at: string;
  /** Fecha/hora de fin en formato ISO 8601. */
  ends_at: string;
  /** Zona horaria de la cita. */
  timezone: string;
  /** Nombre del cliente. */
  customer_name: string;
  /** Correo del cliente (opcional). */
  customer_email: string | null;
  /** Teléfono del cliente (opcional). */
  customer_phone: string | null;
  /** Estado de la cita. */
  status: string;
  /** Notas de la cita (opcional). */
  notes: string | null;
  /** Ruta del ICS generado (opcional). */
  ics_path: string | null;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
  /** Versión de sincronización. */
  revision: number;
  /** Fecha de última actualización en formato ISO 8601. */
  updated_at: string;
}

/** Template del marketplace expuesto por el backend (`MarketplaceTemplateRead`). */
export interface IMarketplaceTemplateRead {
  /** Identificador UUIDv4 del template. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Nombre del template. */
  name: string;
  /** Descripción del template (opcional). */
  description: string | null;
  /** Categoría del template (filtrable por backend). */
  category: string;
  /** Configuración de landing que importa el template. */
  config: Record<string, unknown>;
  /** URL de la imagen miniatura (opcional). */
  thumbnail_url: string | null;
  /** Indica si el template es visible para otros tenants. */
  is_public: boolean;
  /** Número de descargas acumuladas. */
  downloads: number;
  /** Fecha de creación en formato ISO 8601. */
  created_at: string;
}

/** Petición de alta de template en el marketplace (`MarketplaceTemplateCreateRequest`). */
export interface IMarketplaceTemplateCreateRequest {
  /** Nombre del template. */
  name: string;
  /** Descripción del template (opcional). */
  description?: string;
  /** Categoría del template. */
  category: string;
  /** Configuración de landing que importa el template. */
  config: Record<string, unknown>;
  /** URL de la imagen miniatura (opcional). */
  thumbnail_url?: string;
  /** Indica si el template es visible para otros tenants. */
  is_public?: boolean;
}

/** Petición de importación de un template a una campaña (`MarketplaceImportRequest`). */
export interface IMarketplaceImportRequest {
  /** Identificador UUIDv4 de la campaña destino (genera una landing). */
  campaign_id: string;
  /** Nombre opcional para la landing generada. */
  name?: string;
}

/** Respuesta de importación de un template (`MarketplaceImportResponse`). */
export interface IMarketplaceImportResponse {
  /** Template importado (con descargas incrementadas). */
  template: IMarketplaceTemplateRead;
  /** Identificador UUIDv4 de la landing generada. */
  landing_id: string;
}

/** Petición de registro de un evento de analítica (`AnalyticsEventCreateRequest`). */
export interface IAnalyticsEventCreateRequest {
  /** Tipo del evento (máx. 64 caracteres). */
  event_type: string;
  /** Tipo de entidad asociada (p. ej. `landing`, `workflow`). */
  entity_type?: string;
  /** Identificador de la entidad asociada. */
  entity_id?: string;
  /** Propiedades arbitrarias del evento (metadatos). */
  properties?: Record<string, unknown>;
  /** Marca de tiempo del evento (por defecto, el servidor usa la actual). */
  occurred_at?: string;
}

/** Evento de analítica leído desde el backend (`AnalyticsEventRead`). */
export interface IAnalyticsEventRead {
  /** Identificador UUIDv4 del evento. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Tipo del evento. */
  event_type: string;
  /** Tipo de entidad asociada. */
  entity_type: string | null;
  /** Identificador de la entidad asociada. */
  entity_id: string | null;
  /** Propiedades arbitrarias del evento. */
  properties: Record<string, unknown>;
  /** Marca de tiempo del evento. */
  occurred_at: string;
  /** Marca de tiempo de creación (append-only). */
  created_at: string;
}

/** Conteo de eventos agregado por tipo (`AnalyticsEventTypeCount`). */
export interface IAnalyticsEventTypeCount {
  /** Tipo de evento agregado. */
  event_type: string;
  /** Número de eventos de ese tipo. */
  count: number;
}

/** Respuesta del dashboard de analítica (`AnalyticsDashboardResponse`). */
export interface IAnalyticsDashboardResponse {
  /** Total de eventos registrados por el tenant. */
  total_events: number;
  /** Conteo de eventos agrupados por tipo. */
  by_event_type: IAnalyticsEventTypeCount[];
  /** Eventos recientes (descendente por fecha). */
  recent: IAnalyticsEventRead[];
}

/** Respuesta de un despliegue al CDN (`CdnDeployResponse`, Fase 10). */
export interface ICdnDeployResponse {
  /** Identificador del despliegue. */
  id: string;
  /** Identificador de la landing desplegada. */
  landing_id: string;
  /** Número de versión del despliegue. */
  version: number;
  /** URL pública del recurso en el CDN. */
  url: string;
  /** Estado del despliegue (p. ej. `deployed`). */
  status: string;
  /** Marca de tiempo del despliegue. */
  deployed_at: string;
  /** Marca de tiempo de creación (append-only). */
  created_at: string;
}

// ============================================================================
// Configuración del tenant para el bot (Fase 2) — espejo de
// backend/app/schemas/tenant_config.py
// ============================================================================

/** Tipos de canal del bot (solo WhatsApp Cloud API por ahora). */
export type IChannelType = 'whatsapp';

/** Tipos de contenido estructurado del bot. */
export type IContentKind = 'faq' | 'document' | 'rule' | 'product';

/** Campos de la tupla de sincronización (regla CLAUDE: tupla sync). */
export interface IConfigSyncFields {
  /** Versión de sincronización del registro. */
  revision: number;
  /** Marca de tiempo de la última actualización (ISO 8601). */
  updated_at: string;
  /** Marca de soft-delete (nunca borrado físico). */
  deleted: boolean;
}

/** Payload de apariencia del tenant (rebranding: paleta, logo y tipografía). */
export interface ITenantAppearanceUpsert {
  /** Color primario (hex #RRGGBB o #RRGGBBAA). */
  primary_color: string;
  /** Color de acento (hex #RRGGBB o #RRGGBBAA). */
  accent_color: string;
  /** Color de superficie (hex #RRGGBB o #RRGGBBAA). */
  surface_color: string;
  /** Color de texto (hex #RRGGBB o #RRGGBBAA). */
  text_color: string;
  /** Texto/logo de la insignia de marca. */
  brand_badge: string;
  /** URL opcional del logo. */
  logo_url?: string;
  /** Familia tipográfica opcional. */
  font_family?: string;
}

/** Lectura de la apariencia del tenant (incluye versión y tupla sync). */
export interface ITenantAppearanceRead extends ITenantAppearanceUpsert, IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Propuesta de apariencia derivada de una URL de marca (Fase 5). */
export interface IAppearanceProposal {
  /** Color primario detectado (hex, o `null` si no se encontró). */
  primary_color: string | null;
  /** Color de acento detectado (hex, o `null`). */
  accent_color: string | null;
  /** Color de superficie detectado (hex, o `null`). */
  surface_color: string | null;
  /** Color de texto detectado (hex, o `null`). */
  text_color: string | null;
  /** Color de insignia de marca detectado (hex, o `null`). */
  brand_badge: string | null;
  /** URL del logo detectado (o `null`). */
  logo_url: string | null;
  /** Familia tipográfica principal detectada (o `null`). */
  font_family: string | null;
  /** Tipografías declaradas en la página, ordenadas por frecuencia. */
  detected_fonts: string[];
}

/** Payload para guardar una configuración de rebranding (Fase 5). */
export interface IRebrandingConfigCreate {
  /** Nombre descriptivo de la configuración. */
  name: string;
  /**
   * URL de la marca desde la que se extrajeron los estilos. Opcional: si se
   * omite, el backend guarda una instantánea de los estilos actuales (GAP 3).
   */
  url?: string;
}

/** Configuración de rebranding guardada, tal como se expone al cliente (Fase 5). */
export interface IRebrandingConfigRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Nombre descriptivo de la configuración. */
  name: string;
  /** URL de la marca desde la que se extrajeron los estilos. */
  url: string;
  /** Estilos extraídos (paleta, tipografía y logo detectados). */
  extracted: Record<string, unknown>;
  /** Marca de tiempo en que la configuración se aplicó al tema (o `null`). */
  applied_at: string | null;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload de creación de un ítem de contenido. */
export interface IContentItemCreate {
  /** Tipo de contenido (faq | document | rule | product). */
  kind: IContentKind;
  /** Título del ítem. */
  title: string;
  /** Cuerpo opcional del ítem. */
  content?: string;
  /** Etiquetas opcionales. */
  tags?: string[];
}

/** Payload de actualización parcial de un ítem de contenido. */
export interface IContentItemUpdate {
  /** Tipo de contenido (faq | document | rule | product). */
  kind?: IContentKind;
  /** Título del ítem. */
  title?: string;
  /** Cuerpo opcional del ítem. */
  content?: string;
  /** Etiquetas opcionales. */
  tags?: string[];
}

/** Lectura de un ítem de contenido (incluye versión y tupla sync). */
export interface IContentItemRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Tipo de contenido (faq | document | rule | product). */
  kind: IContentKind;
  /** Título del ítem. */
  title: string;
  /** Cuerpo del ítem (vacío si no se definió). */
  content: string;
  /** Etiquetas del ítem. */
  tags: string[];
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload de creación de un ítem del catálogo. */
export interface ICatalogItemCreate {
  /** Código de producto único por tenant. */
  sku: string;
  /** Nombre del producto/servicio. */
  name: string;
  /** Descripción opcional. */
  description?: string;
  /** Precio (moneda: decimal → número JSON). */
  price: number;
  /** Código de moneda ISO 4217 (por defecto `MXN`). */
  currency?: string;
  /** Disponibilidad (por defecto `true`). */
  available?: boolean;
  /** Metadata opcional del producto. */
  metadata?: Record<string, unknown>;
}

/** Payload de actualización parcial de un ítem del catálogo. */
export interface ICatalogItemUpdate {
  /** Código de producto único por tenant. */
  sku?: string;
  /** Nombre del producto/servicio. */
  name?: string;
  /** Descripción opcional. */
  description?: string;
  /** Precio (moneda: decimal → número JSON). */
  price?: number;
  /** Código de moneda ISO 4217. */
  currency?: string;
  /** Disponibilidad. */
  available?: boolean;
  /** Metadata opcional del producto. */
  metadata?: Record<string, unknown>;
}

/** Lectura de un ítem del catálogo (incluye versión y tupla sync). */
export interface ICatalogItemRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Código de producto único por tenant. */
  sku: string;
  /** Nombre del producto/servicio. */
  name: string;
  /** Descripción opcional (null si no se definió). */
  description: string | null;
  /** Precio (moneda: decimal → número JSON). */
  price: number;
  /** Código de moneda ISO 4217. */
  currency: string;
  /** Disponibilidad del producto. */
  available: boolean;
  /** Metadata del producto. */
  metadata: Record<string, unknown>;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload de creación de un canal del bot (secretos write-only). */
export interface ITenantChannelCreate {
  /** Tipo de canal (por defecto `whatsapp`). */
  channel_type?: IChannelType;
  /** Identificador externo opcional (p. ej. número de negocio). */
  external_id?: string;
  /** Número de teléfono del canal (requerido). */
  phone_number: string;
  /** Identificador del número de teléfono de Meta (opcional). */
  phone_number_id?: string;
  /** Token de acceso de la WhatsApp Cloud API (write-only). */
  access_token?: string;
  /** Secreto del webhook (write-only). */
  webhook_secret?: string;
  /** Habilitado (por defecto `true`). */
  enabled?: boolean;
}

/** Payload de actualización parcial de un canal (secretos write-only). */
export interface ITenantChannelUpdate {
  /** Tipo de canal. */
  channel_type?: IChannelType;
  /** Identificador externo opcional. */
  external_id?: string;
  /** Número de teléfono del canal. */
  phone_number?: string;
  /** Identificador del número de teléfono de Meta. */
  phone_number_id?: string;
  /** Token de acceso de la WhatsApp Cloud API (write-only). */
  access_token?: string;
  /** Secreto del webhook (write-only). */
  webhook_secret?: string;
  /** Habilitado. */
  enabled?: boolean;
}

/** Lectura de un canal del bot (NUNCA incluye secretos). */
export interface ITenantChannelRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Tipo de canal (lectura permisiva: la BD puede contener tipos no soportados). */
  channel_type: string;
  /** Identificador externo (null si no se definió). */
  external_id: string | null;
  /** Número de teléfono del canal. */
  phone_number: string;
  /** Identificador del número de teléfono de Meta (null si no se definió). */
  phone_number_id: string | null;
  /** Habilitado. */
  enabled: boolean;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

// ============================================================================
// Documentos ingeridos (Fase 1 — RAG) — espejo de backend/app/schemas/documents.py
// ============================================================================

/** Fuentes de conocimiento soportadas por la ingesta (Fase 1). */
export type IDocumentSourceType = 'pdf' | 'txt' | 'csv' | 'url';

/** Documento ingerido tal como se expone a los clientes (sin `content`). */
export interface IDocumentRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Título legible del documento. */
  title: string;
  /** Tipo de fuente (pdf, txt, csv o url). */
  source_type: IDocumentSourceType;
  /** Referencia de la fuente (ruta del archivo o URL). */
  source_ref: string | null;
  /** Tamaño en bytes del contenido fuente. */
  size_bytes: number;
  /** Metadatos de la ingesta (p. ej. páginas o filas extraídas). */
  metadata: Record<string, unknown>;
  /** Versión de ingesta del documento. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Documento ingerido con su texto completo extraído (detalle). */
export interface IDocumentContentRead extends IDocumentRead {
  /** Texto completo extraído del documento. */
  content: string;
}

/** Payload para ingerir una URL (recurso remoto). */
export interface IIngestUrlRequest {
  /** URL del recurso remoto (1-2048 caracteres). */
  url: string;
  /** Título opcional del documento (1-255 caracteres). */
  title?: string;
}

/** Resultado de una ingestión (archivo o URL). */
export interface IIngestResultRead {
  /** Documento ingerido con su contenido completo. */
  document: IDocumentContentRead;
  /** Número de fragmentos (chunks) creados para el RAG. */
  chunks_created: number;
  /** Advertencias no bloqueantes de la ingesta. */
  warnings: string[];
}

/** Payload de búsqueda por texto sobre documentos/chunks del tenant. */
export interface IDocumentSearchRequest {
  /** Consulta de texto (1-512 caracteres). */
  query: string;
  /** Número máximo de resultados (1-50, por defecto 10). */
  limit?: number;
}

/** Fragmento coincidente de un documento (búsqueda granular). */
export interface IDocumentSearchResult {
  /** Identificador del documento propietario del fragmento. */
  document_id: string;
  /** Título del documento. */
  title: string;
  /** Fragmento de texto alrededor de la coincidencia. */
  snippet: string;
  /** Puntuación de relevancia normalizada. */
  score: number;
}

// ============================================================================
// Sinónimos del bot (Fase 2 — normalización) — espejo de backend/app/schemas/synonyms.py
// ============================================================================

/** Payload para crear un sinónimo del bot en el tenant activo. */
export interface ISynonymCreate {
  /** Término canónico normalizado (1-255 caracteres, único por tenant). */
  term: string;
  /** Variantes del término que se normalizan hacia el canónico (0-200). */
  synonyms: string[];
}

/** Payload para actualizar parcialmente un sinónimo del bot. */
export interface ISynonymUpdate {
  /** Nuevo término canónico (1-255 caracteres, único por tenant). */
  term?: string;
  /** Nuevas variantes normalizadas hacia el término canónico (0-200). */
  synonyms?: string[];
}

/** Sinónimo del bot leído del backend (hereda la tupla de sync). */
export interface ISynonymRead extends IConfigSyncFields {
  /** Identificador del sinónimo. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Término canónico normalizado. */
  term: string;
  /** Variantes que se normalizan hacia el término canónico. */
  synonyms: string[];
  /** Versión de concurrencia optimista gestionada por el backend. */
  version: number;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
}

/** Payload de importación masiva de sinónimos (texto crudo CSV/JSON). */
export interface ISynonymImportRequest {
  /** Contenido del archivo (CSV con cabecera `term,synonyms` o JSON). */
  content: string;
  /** Formato del contenido (`csv` por defecto o `json`). */
  format?: 'csv' | 'json';
  /** Delimitador CSV (una coma por defecto, `;` para variantes). */
  delimiter?: string;
}

/** Resultado de una importación masiva de sinónimos. */
export interface ISynonymImportResultRead {
  /** Sinónimos creados. */
  imported: number;
  /** Sinónimos omitidos (términos ya existentes). */
  skipped: number;
  /** Filas con error. */
  failed: number;
  /** Mensajes de error por fila. */
  errors: string[];
}

// ============================================================================
// Keywords con prioridades del bot (Fase 3) — espejo de backend/app/schemas/keywords.py
// ============================================================================

/** Datos para crear una keyword del bot (término único por tenant). */
export interface IKeywordCreate {
  /** Término clave que activa la respuesta (1-255 caracteres). */
  term: string;
  /** Respuesta inteligente asociada al término (1-2000 caracteres). */
  response: string;
  /** Prioridad de coincidencia (0-1000, menor = más prioritario). */
  priority?: number;
  /** Habilita o deshabilita la keyword (por defecto true). */
  enabled?: boolean;
}

/** Datos para actualizar parcialmente una keyword del bot. */
export interface IKeywordUpdate {
  /** Término clave que activa la respuesta. */
  term?: string;
  /** Respuesta inteligente asociada al término. */
  response?: string;
  /** Prioridad de coincidencia (0-1000). */
  priority?: number;
  /** Habilita o deshabilita la keyword. */
  enabled?: boolean;
}

/** Keyword del bot con prioridades (Fase 3) — persistida y versionada. */
export interface IKeywordRead extends IConfigSyncFields {
  /** Identificador de la keyword. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Término clave que activa la respuesta. */
  term: string;
  /** Respuesta inteligente asociada al término. */
  response: string;
  /** Prioridad de coincidencia (0-1000, menor = más prioritario). */
  priority: number;
  /** Habilita o deshabilita la keyword. */
  enabled: boolean;
  /** Versión de sincronización optimista. */
  version: number;
  /** Fecha de creación (UTC). */
  created_at: string;
}

// ============================================================================
// Bots y conversaciones (Fase 7) — espejo de backend/app/schemas/bot.py
// ============================================================================

/** Estadísticas de la cola Redis D3 de un tenant (monitor de cola). */
export interface IQueueStatsRead {
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Nombre del stream Redis de la cola. */
  stream: string;
  /** Longitud actual del stream. */
  length: number;
  /** Mensajes pendientes de confirmar (pending). */
  pending: number;
  /** Rezago del consumidor (null si no aplica). */
  consumer_lag: number | null;
  /** Mensajes enviados a la cola de fallidos (DLQ). */
  dlq_count: number;
  /** Mensajes encolados acumulados. */
  enqueued: number;
  /** Mensajes procesados acumulados. */
  processed: number;
  /** Mensajes fallidos acumulados. */
  failed: number;
}

/** Conversación del bot por canal y contacto externo (visor Fase 7). */
export interface IConversationRead extends IConfigSyncFields {
  /** Identificador de la conversación. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Canal por el que ocurre la conversación. */
  channel_id: string;
  /** Identificador externo del contacto (p. ej. número de WhatsApp). */
  external_contact_id: string;
  /** Estado de la conversación (p. ej. `new`). */
  state: string;
  /**
   * Procedencia del lead (eslabón ① → ③): campaña publicitaria que originó el
   * contacto (null si no se resolvió atribución). Permite calificar/derivar con
   * contexto en el visor de conversaciones del BOT.
   */
  ad_campaign_id: string | null;
  /** Marca de tiempo de la última actividad (null si no hay aún). */
  last_message_at: string | null;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Vista de negocio de una conversación activa para el Monitor (Fase 7). */
export interface IActiveConversationRead {
  /** Identificador de la conversación. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Canal por el que ocurre la conversación. */
  channel_id: string;
  /** Identificador externo del contacto (p. ej. número de WhatsApp). */
  external_contact_id: string;
  /** Estado de la conversación (p. ej. `new`). */
  state: string;
  /** Indica si la conversación tiene al menos un mensaje. */
  is_active: boolean;
  /** Cantidad total de mensajes de la conversación. */
  message_count: number;
  /** Mensajes entrantes sin responder desde el último saliente. */
  unread_count: number;
  /** Contenido del último mensaje (null si no hay aún). */
  last_message_content: string | null;
  /** Dirección del último mensaje: `inbound` | `outbound` (null si no hay). */
  last_message_direction: string | null;
  /** Marca de tiempo del último mensaje (null si no hay aún). */
  last_message_at: string | null;
  /** Marca de tiempo de la última actualización (ISO 8601, null si no aplica). */
  updated_at: string | null;
}

/** Mensaje del bot (entrante/saliente) — fuente de verdad de la cola D3. */
export interface IMessageRead extends IConfigSyncFields {
  /** Identificador del mensaje. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Conversación a la que pertenece. */
  conversation_id: string;
  /** Dirección: `inbound` | `outbound`. */
  direction: string;
  /** Contenido textual del mensaje. */
  content: string;
  /** Proveedor de IA usado (null si no aplica). */
  provider_used: string | null;
  /** Tokens consumidos (0 si no aplica). */
  tokens_used: number;
  /** Identificador de mensaje de la cola D3 (null si no aplica). */
  message_id: string | null;
  /** Estado de la cola (`pending`, `processed`, `failed`...). */
  queue_status: string;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Proveedor de IA configurado por empresa (NUNCA incluye secretos). */
export interface IBotProviderConfigRead extends IConfigSyncFields {
  /** Identificador del proveedor. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Tipo de proveedor (p. ej. `openai`, `deepseek`). */
  provider_kind: string;
  /** Orden de prioridad entre proveedores. */
  order: number;
  /** Habilitado. */
  enabled: boolean;
  /** Modelo a usar (null si usa el predeterminado). */
  model: string | null;
  /** Temperatura como decimal legible (null si no se definió). */
  temperature: string | null;
  /** Prompt base de la empresa. */
  prompt_base: string;
}

/** Payload de creación/actualización de un proveedor de IA (sin secretos). */
export interface IBotProviderUpsert {
  /** Tipo de proveedor (1-16 caracteres). */
  provider_kind: string;
  /** Orden de prioridad (>= 0). */
  order: number;
  /** Habilitado (por defecto `true`). */
  enabled: boolean;
  /** Modelo a usar (opcional, máximo 128 caracteres). */
  model: string | null;
  /** Temperatura como decimal legible ('' → null). */
  temperature: string | null;
  /** Prompt base de la empresa. */
  prompt_base: string;
}

/** Mensaje de prueba enviado manualmente a la cola D3. */
export interface IMessageCreate {
  /** Contenido textual del mensaje (mínimo 1 carácter). */
  content: string;
}

/** Resultado del envío manual de un mensaje a la cola D3. */
export interface IMessageEnqueueResult {
  /** Identificador de mensaje de la cola D3. */
  message_id: string;
  /** Conversación de destino. */
  conversation_id: string;
  /** Dirección del mensaje. */
  direction: string;
  /** Estado de la cola. */
  queue_status: string;
  /** Indica si el mensaje fue aceptado por la cola. */
  accepted: boolean;
}

// ============================================================================
// Motor de prueba del router (Fase 4) — espejo de backend/app/schemas/router_test.py
// ============================================================================

/** Payload para probar el router con un mensaje crudo (sin efectos). */
export interface IRouterTestRequest {
  /** Contenido del mensaje a enrutar (mínimo 1, máximo 4000 caracteres). */
  message: string;
}

/** Un paso evaluado por el motor de ruteo (traza de prueba). */
export interface IRouterStepRead {
  /** Orden de evaluación dentro de la jerarquía (keyword → intent → general_chat). */
  order: number;
  /** Rama evaluada (p. ej. `keyword`, `intent:checkout`, `general_chat`). */
  branch: string;
  /** Resultado del paso (`matched`, `skipped`, `fallthrough`, …). */
  outcome: string;
  /** Detalle legible del paso (mensaje, score, motivo). */
  detail: string;
}

/** Resultado del motor de prueba: qué rama decide y por qué (Fase 4). */
export interface IRouterTraceRead {
  /** Rama ganadora (`keyword`, `intent` o `general_chat`). */
  matched_route: string;
  /** Rama concreta que ganó (p. ej. `keyword`, `intent:checkout`). */
  branch: string;
  /** Keyword que coincidió (si la rama ganadora fue `keyword`). */
  keyword: string | null;
  /** Prioridad de la keyword coincidente (si aplica). */
  keyword_priority: number | null;
  /** Intención detectada (si la rama ganadora fue `intent`). */
  intent: string | null;
  /** Respuesta que devolvería el bot (null si no hay respuesta). */
  response: string | null;
  /** Confianza de la decisión (0.0–1.0). */
  confidence: number;
  /** Pasos evaluados por el motor en orden. */
  steps: IRouterStepRead[];
}

// ============================================================================
// Operación del bot (Bloque B) — espejo de backend/app/schemas/operations.py
// ============================================================================

/** Payload para crear un contacto del directorio (B.6). */
export interface IContactCreate {
  /** Teléfono del contacto (1-32 caracteres). */
  phone: string;
  /** Nombre opcional del contacto. */
  name?: string;
  /** Correo opcional del contacto. */
  email?: string;
  /** Etiquetas del contacto (por defecto vacío). */
  tags?: string[];
  /** Estado del contacto (por defecto `new`). */
  state?: string;
  /** Origen (por defecto `manual`). */
  source?: string;
  /** Identificador externo opcional. */
  external_contact_id?: string;
  /** Último contacto (ISO 8601, opcional). */
  last_contact_at?: string;
}

/** Payload parcial para actualizar un contacto (PATCH/PUT). */
export interface IContactUpdate {
  /** Teléfono del contacto (1-32 caracteres). */
  phone?: string;
  /** Nombre opcional del contacto. */
  name?: string;
  /** Correo opcional del contacto. */
  email?: string;
  /** Etiquetas del contacto. */
  tags?: string[];
  /** Estado del contacto. */
  state?: string;
  /** Origen del contacto. */
  source?: string;
  /** Identificador externo opcional. */
  external_contact_id?: string;
  /** Último contacto (ISO 8601, opcional). */
  last_contact_at?: string;
}

/** Contacto del directorio tal como se expone a los clientes. */
export interface IContactRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Teléfono del contacto. */
  phone: string;
  /** Nombre del contacto (null si no se definió). */
  name: string | null;
  /** Correo del contacto (null si no se definió). */
  email: string | null;
  /** Etiquetas del contacto. */
  tags: string[];
  /** Estado del contacto. */
  state: string;
  /** Origen del contacto. */
  source: string;
  /** Identificador externo (null si no se definió). */
  external_contact_id: string | null;
  /** Último contacto (null si no hay aún). */
  last_contact_at: string | null;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload para crear una plantilla de mensaje (B.5). */
export interface ITemplateCreate {
  /** Nombre único de la plantilla (1-255 caracteres). */
  name: string;
  /** Cuerpo del mensaje (por defecto vacío). */
  body?: string;
  /** Tipo de plantilla (por defecto `text`). */
  template_type?: string;
  /** Variables `{{ }}` de la plantilla (por defecto vacío). */
  variables?: string[];
}

/** Payload parcial para actualizar una plantilla (PATCH/PUT). */
export interface ITemplateUpdate {
  /** Nombre único de la plantilla (1-255 caracteres). */
  name?: string;
  /** Cuerpo del mensaje. */
  body?: string;
  /** Tipo de plantilla. */
  template_type?: string;
  /** Variables `{{ }}` de la plantilla. */
  variables?: string[];
}

/** Plantilla de mensaje tal como se expone a los clientes. */
export interface ITemplateRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Nombre único de la plantilla. */
  name: string;
  /** Cuerpo del mensaje. */
  body: string;
  /** Tipo de plantilla. */
  template_type: string;
  /** Variables `{{ }}` de la plantilla. */
  variables: string[];
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload para crear un árbol de navegación (B.3). */
export interface INavigationTreeCreate {
  /** Nombre único del árbol (1-255 caracteres). */
  name: string;
  /** Número de opciones (por defecto 0, >= 0). */
  num_options?: number;
  /** Opciones del árbol (por defecto vacío). */
  options?: Array<Record<string, unknown>>;
}

/** Payload parcial para actualizar un árbol de navegación (PATCH/PUT). */
export interface INavigationTreeUpdate {
  /** Nombre único del árbol (1-255 caracteres). */
  name?: string;
  /** Número de opciones (>= 0). */
  num_options?: number;
  /** Opciones del árbol. */
  options?: Array<Record<string, unknown>>;
}

/** Árbol de navegación tal como se expone a los clientes. */
export interface INavigationTreeRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Nombre único del árbol. */
  name: string;
  /** Número de opciones. */
  num_options: number;
  /** Opciones del árbol. */
  options: Array<Record<string, unknown>>;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload para crear una campaña de envío (B.4/C-2). */
export interface ICampaignCreate {
  /** Nombre de la campaña (1-255 caracteres). */
  name: string;
  /** Plantilla asociada (opcional). */
  template_id?: string;
  /** Estado de la campaña (por defecto `draft`). */
  state?: string;
  /** Programación de envío (ISO 8601, opcional). */
  schedule?: string;
  /** Tipo de segmentación (C-2): `tags`, `event` o sin valor (todas las audiencias). */
  segment_type?: string;
  /** Configuración de segmentación (C-2): etiquetas o contexto del evento. */
  segment_config?: Record<string, unknown>;
  /** Tipo de disparo (C-2): `scheduled`, `event` o sin valor. */
  trigger_type?: string;
  /** Evento de workflow que dispara la campaña (C-2). */
  trigger_event?: string;
  /** Landing/pasarela que origina la campaña (C-2, GAP-12). */
  landing_id?: string;
}

/** Payload parcial para actualizar una campaña (PATCH/PUT). */
export interface ICampaignUpdate {
  /** Nombre de la campaña (1-255 caracteres). */
  name?: string;
  /** Plantilla asociada (opcional). */
  template_id?: string;
  /** Estado de la campaña. */
  state?: string;
  /** Programación de envío (ISO 8601, opcional). */
  schedule?: string;
  /** Tipo de segmentación (C-2): `tags`, `event` o sin valor. */
  segment_type?: string;
  /** Configuración de segmentación (C-2): etiquetas o contexto del evento. */
  segment_config?: Record<string, unknown>;
  /** Tipo de disparo (C-2): `scheduled`, `event` o sin valor. */
  trigger_type?: string;
  /** Evento de workflow que dispara la campaña (C-2). */
  trigger_event?: string;
  /** Landing/pasarela que origina la campaña (C-2, GAP-12). */
  landing_id?: string;
}

/** Campaña de envío tal como se expone a los clientes (B.4/C-2). */
export interface ICampaignRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Nombre de la campaña. */
  name: string;
  /** Plantilla asociada (null si no se definió). */
  template_id: string | null;
  /** Estado de la campaña. */
  state: string;
  /** Programación de envío (null si no se definió). */
  schedule: string | null;
  /** Tipo de segmentación (C-2): `tags`, `event` o null (todas las audiencias). */
  segment_type: string | null;
  /** Configuración de segmentación (C-2): etiquetas o contexto del evento. */
  segment_config: Record<string, unknown> | null;
  /** Tipo de disparo (C-2): `scheduled`, `event` o null. */
  trigger_type: string | null;
  /** Evento de workflow que dispara la campaña (C-2). */
  trigger_event: string | null;
  /** Landing/pasarela que origina la campaña (C-2, GAP-12). */
  landing_id: string | null;
  /** Marca de tiempo del último disparo (ISO 8601, null si nunca se disparó). */
  last_triggered_at: string | null;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload para crear una campaña publicitaria (C-1, eslabón ① de atribución UTM). */
export interface IAdCampaignCreate {
  /** Nombre de la campaña (1-255 caracteres, obligatorio). */
  name: string;
  /** Estado (`active`|`paused`, por defecto `active`). */
  status?: string;
  /** Indica si la campaña participa en la atribución UTM (por defecto `true`). */
  enabled?: boolean;
  /** Origen UTM (p. ej. `meta`, `google`). */
  utm_source?: string;
  /** Medio UTM (p. ej. `cpc`, `cpm`). */
  utm_medium?: string;
  /** Campaña UTM (p. ej. `tequesquitengo-lago`). */
  utm_campaign?: string;
  /** Contenido UTM (variante creativa, opcional). */
  utm_content?: string;
  /** Término UTM (palabra clave, opcional). */
  utm_term?: string;
  /** Landing asociada (null si no se definió). */
  landing_id?: string;
  /** Presupuesto en unidades menores (>= 0, opcional). */
  budget_minor?: number;
  /** Inicio programado (ISO 8601, opcional). */
  start_at?: string;
  /** Fin programado (ISO 8601, opcional). */
  end_at?: string;
  /** Notas internas (máx. 4000 caracteres). */
  notes?: string;
}

/** Payload parcial para actualizar una campaña publicitaria (PATCH, C-1). */
export interface IAdCampaignUpdate {
  /** Nombre de la campaña (1-255 caracteres). */
  name?: string;
  /** Estado (`active`|`paused`). */
  status?: string;
  /** Indica si la campaña participa en la atribución UTM. */
  enabled?: boolean;
  /** Origen UTM. */
  utm_source?: string;
  /** Medio UTM. */
  utm_medium?: string;
  /** Campaña UTM. */
  utm_campaign?: string;
  /** Contenido UTM. */
  utm_content?: string;
  /** Término UTM. */
  utm_term?: string;
  /** Landing asociada. */
  landing_id?: string;
  /** Presupuesto en unidades menores (>= 0). */
  budget_minor?: number;
  /** Inicio programado (ISO 8601). */
  start_at?: string;
  /** Fin programado (ISO 8601). */
  end_at?: string;
  /** Notas internas (máx. 4000 caracteres). */
  notes?: string;
}

/**
 * Campaña publicitaria tal como la expone el backend (C-1, eslabón ①).
 *
 * Espeja `AdCampaignRead` (schemas/ads.py): el backend NO expone `deleted` ni
 * `version`, solo `revision`/`updated_at` como campos de sincronización, por lo
 * que esta interfaz es independiente de `IConfigSyncFields`.
 */
export interface IAdCampaignRead {
  /** Identificador UUIDv4 de la campaña. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Nombre de la campaña. */
  name: string;
  /** Estado (`active`|`paused`). */
  status: string;
  /** Indica si la campaña participa en la atribución UTM. */
  enabled: boolean;
  /** Origen UTM (null si no se definió). */
  utm_source: string | null;
  /** Medio UTM (null si no se definió). */
  utm_medium: string | null;
  /** Campaña UTM (null si no se definió). */
  utm_campaign: string | null;
  /** Contenido UTM (null si no se definió). */
  utm_content: string | null;
  /** Término UTM (null si no se definió). */
  utm_term: string | null;
  /** Landing asociada (null si no se definió). */
  landing_id: string | null;
  /** Presupuesto en unidades menores (null si no se definió). */
  budget_minor: number | null;
  /** Inicio programado (null si no se definió). */
  start_at: string | null;
  /** Fin programado (null si no se definió). */
  end_at: string | null;
  /** Notas internas (null si no se definió). */
  notes: string | null;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
  /** Versión de sincronización (se incrementa en cada update). */
  revision: number;
  /** Marca de tiempo de última actualización (ISO 8601). */
  updated_at: string;
}

/**
 * Solicitud de registro de un dominio personalizado del tenant (PSEO hosts).
 *
 * Espeja `PseoHostRequest` (schemas/pseo.py): el backend normaliza el `host`
 * (minúsculas, sin esquema, sin `/` final, <= 255 caracteres).
 */
export interface IPseoHostRequest {
  /** Dominio personalizado a registrar (p. ej. `portal.miempresa.com`). */
  host: string;
}

/**
 * Dominio personalizado tal como lo expone el backend (PSEO hosts).
 *
 * Espeja `PseoHostRead` (schemas/pseo.py): incluye el token de verificación DNS
 * (TXT `_omni2-verify.{host}`) y el estado de activación. Solo los hosts con
 * `status === 'active'` se sirven públicamente.
 */
export interface IPseoHostRead {
  /** Identificador UUIDv4 del host. */
  id: string;
  /** Identificador UUIDv4 del tenant propietario. */
  tenant_id: string;
  /** Dominio personalizado (normalizado por el backend). */
  host: string;
  /** Estado (`pending`|`active`). Solo los activos se sirven públicamente. */
  status: string;
  /** Token de verificación DNS (TXT `_omni2-verify.{host}`) o `null`. */
  verify_token: string | null;
  /** Marca de tiempo de verificación (ISO 8601) o `null` si no verificado. */
  verified_at: string | null;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
  /** Marca de tiempo de última actualización (ISO 8601). */
  updated_at: string;
  /** Versión de sincronización (se incrementa en cada update). */
  revision: number;
  /** Indica si el host fue eliminado lógicamente. */
  deleted: boolean;
}

/** Payload para asociar un contacto a una campaña (B.4). */
export interface ICampaignRecipientCreate {
  /** Contacto destinatario. */
  contact_id: string;
  /** Estado del envío (por defecto `pending`). */
  state?: string;
  /** Resultado del envío (opcional). */
  result?: string;
  /** Intentos de envío (por defecto 0, >= 0). */
  attempts?: number;
}

/** Payload parcial para actualizar el estado de un destinatario (PATCH/PUT). */
export interface ICampaignRecipientUpdate {
  /** Estado del envío. */
  state?: string;
  /** Resultado del envío (opcional). */
  result?: string;
  /** Intentos de envío (>= 0). */
  attempts?: number;
}

/** Destinatario de campaña tal como se expone a los clientes. */
export interface ICampaignRecipientRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Campaña a la que pertenece. */
  campaign_id: string;
  /** Contacto destinatario. */
  contact_id: string;
  /** Estado del envío. */
  state: string;
  /** Resultado del envío (null si no se definió). */
  result: string | null;
  /** Intentos de envío. */
  attempts: number;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload para subir un archivo de destinatarios reutilizable (GAP 2). */
export interface IRecipientFileCreate {
  /** Nombre legible del archivo. */
  name: string;
  /** Tipo de contenido (p. ej. `text/csv`). */
  content_type: string;
  /** Contenido del CSV crudo (con cabecera `phone` y opcionalmente `name`). */
  raw_csv: string;
  /** Metadatos de origen (delimitador, columnas detectadas, etc.). */
  source_meta?: Record<string, unknown>;
}

/** Archivo de destinatarios reutilizable tal como se expone a los clientes. */
export interface IRecipientFileRead extends IConfigSyncFields {
  /** Identificador del archivo. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Nombre legible del archivo. */
  name: string;
  /** Tipo de contenido (p. ej. `text/csv`). */
  content_type: string;
  /** Metadatos de origen (delimitador, columnas detectadas, etc.). */
  source_meta: Record<string, unknown>;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Vista previa de contactos de un archivo (dry-run, sin insertar). */
export interface IRecipientFilePreviewRead {
  /** Identificador del archivo. */
  file_id: string;
  /** Nombre legible del archivo. */
  name: string;
  /** Total de contactos detectados. */
  total: number;
  /** Contactos detectados (teléfono, nombre opcional y estado). */
  contacts: Array<{ phone: string; name?: string | null; state?: string }>;
}

/** Payload para disparar una campaña desde un archivo de destinatarios (GAP 2). */
export interface IRecipientFileDispatchInput {
  /** Identificador del archivo de destinatarios reutilizable. */
  file_id: string;
}

/** Solicitud de importación masiva CSV (texto crudo, sin multipart). */
export interface ICsvImportRequest {
  /** Contenido del archivo CSV (con cabecera). */
  csv: string;
  /** Delimitador de campos (por defecto `,`). */
  delimiter?: string;
}

/** Resultado de una importación masiva (contactos o destinatarios de campaña). */
export interface IImportResultRead {
  /** Filas creadas. */
  created: number;
  /** Filas omitidas por duplicado. */
  skipped: number;
  /** Filas con error. */
  failed: number;
  /** Errores por fila (máx. 100). */
  errors: string[];
}

/** Resultado de un despacho de campaña (agendado, por evento o manual, C-2). */
export interface IDispatchResultRead {
  /** Campañas procesadas. */
  campaigns_processed: number;
  /** Mensajes enviados. */
  recipients_sent: number;
  /** Mensajes fallidos. */
  recipients_failed: number;
  /** Mensajes omitidos (sin plantilla o fuera de segmento). */
  recipients_skipped: number;
}

/** Payload para un envío individual reutilizando una plantilla del tenant (B.4). */
export interface IIndividualSendInput {
  /** Teléfono del destinatario en formato internacional. */
  phone: string;
  /** Plantilla de mensaje a reutilizar. */
  template_id: string;
  /** Contacto del directorio (opcional; si no se indica se resuelve/crea por `phone`). */
  contact_id?: string;
  /** Variables de la plantilla (opcionales; se completan con datos del contacto). */
  variables?: Record<string, string>;
}

/** Resultado de un envío individual (B.4). */
export interface IMessageSendResultRead {
  /** Estado del envío: `sent`, `failed` o `skipped`. */
  state: 'sent' | 'failed' | 'skipped';
  /** Descripción del resultado. */
  result: string;
  /** Contacto del directorio utilizado para el envío. */
  contact_id: string;
  /** Teléfono del destinatario. */
  phone: string;
}

/** Payload para crear una intervención humana (B.7). */
export interface IInterventionCreate {
  /** Conversación a intervenir. */
  conversation_id: string;
  /** Estado (por defecto `pending`). */
  state?: string;
  /** Operador asignado (opcional). */
  operator?: string;
  /** Notas de la intervención (opcional). */
  notes?: string;
  /** Asignación (ISO 8601, opcional). */
  assigned_at?: string;
  /** Resolución (ISO 8601, opcional). */
  resolved_at?: string;
}

/** Payload parcial para actualizar una intervención (PATCH/PUT). */
export interface IInterventionUpdate {
  /** Estado. */
  state?: string;
  /** Operador asignado (opcional). */
  operator?: string;
  /** Notas de la intervención (opcional). */
  notes?: string;
  /** Asignación (ISO 8601, opcional). */
  assigned_at?: string;
  /** Resolución (ISO 8601, opcional). */
  resolved_at?: string;
}

/** Intervención humana tal como se expone a los clientes. */
export interface IInterventionRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Conversación intervenida. */
  conversation_id: string;
  /** Estado de la intervención. */
  state: string;
  /** Operador asignado (null si no se definió). */
  operator: string | null;
  /** Notas de la intervención (null si no hay). */
  notes: string | null;
  /** Asignación (null si no se definió). */
  assigned_at: string | null;
  /** Resolución (null si no se resolvió). */
  resolved_at: string | null;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Contador de intervenciones pendientes para el badge 🆕 del panel (espejo de ``InterventionPendingCountRead``). */
export interface IInterventionPendingCountRead {
  /** Estado contado (normalmente `pending`). */
  state: string;
  /** Cantidad de intervenciones en ese estado. */
  count: number;
}

/** Payload para asignar una intervención humana a un operador (B.7). */
export interface IInterventionAssignRequest {
  /** Operador que tomará la intervención. */
  operator: string;
}

/** Payload para responder a la conversación de una intervención (B.7). */
export interface IInterventionReplyRequest {
  /** Contenido del mensaje a enviar al cliente. */
  content: string;
}

/** Resultado del cierre de una intervención humana (B.7). */
export interface IInterventionCloseResult {
  /** Identificador de la intervención cerrada. */
  intervention_id: string;
  /** Estado resultante (normalmente `resolved`). */
  state: string;
  /** Resolución (ISO 8601, null si no se resolvió). */
  resolved_at: string | null;
  /** Mensaje de confirmación del cierre. */
  message: string;
}

/** Uso de cuota L1 de un proveedor de IA del tenant activo (espejo de ``QuotaUsageRead``). */
export interface IQuotaUsageRead {
  /** Clave del proveedor (p. ej. `openai`). */
  provider_used: string | null;
  /** Tokens consumidos por el proveedor. */
  tokens_used: number;
  /** Mensajes procesados por el proveedor. */
  message_count: number;
  /** Límite de cuota del proveedor. */
  quota_limit: number;
  /** Porcentaje de consumo sobre el límite (0-100+). */
  percent: number;
  /** Estado derivado del porcentaje. */
  status: 'ok' | 'warning' | 'exceeded';
  /** Inicio del periodo de facturación (ISO 8601). */
  period_start: string;
  /** Fin del periodo de facturación (ISO 8601). */
  period_end: string;
}

/** Resumen de uso de cuota L1 agregado por tenant (espejo de ``QuotaUsageResponse``). */
export interface IQuotaUsageResponse {
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Inicio del periodo de facturación (ISO 8601). */
  period_start: string;
  /** Fin del periodo de facturación (ISO 8601). */
  period_end: string;
  /** Límite de cuota agregado. */
  quota_limit: number;
  /** Tokens totales consumidos por el tenant. */
  total_tokens_used: number;
  /** Porcentaje agregado de consumo sobre el límite. */
  total_percent: number;
  /** Estado agregado derivado del porcentaje. */
  status: 'ok' | 'warning' | 'exceeded';
  /** Desglose por proveedor. */
  items: IQuotaUsageRead[];
}

/** Conteo de una conversación por canal (espejo de ``StatsChannelRead``). */
export interface IStatsChannelRead {
  /** Identificador del canal (null si no se resolvió el canal). */
  channel_id: string;
  /** Conversaciones del canal en el periodo. */
  conversation_count: number;
  /** Mensajes del canal en el periodo. */
  message_count: number;
}

/** Serie diaria de mensajes entrantes/salientes (espejo de ``StatsDailyRead``). */
export interface IStatsDailyRead {
  /** Fecha del día (ISO 8601, `YYYY-MM-DD`). */
  date: string;
  /** Mensajes entrantes del día. */
  inbound: number;
  /** Mensajes salientes del día. */
  outbound: number;
  /** Total de mensajes del día. */
  total: number;
}

/** Resumen operativo del bot por tenant (B.1 Dashboard + B.2 Estadísticas). */
export interface IStatsOverviewRead {
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Conversaciones activas (no eliminadas) del tenant. */
  active_conversations: number;
  /** Mensajes entrantes en el periodo. */
  inbound_messages: number;
  /** Mensajes salientes en el periodo. */
  outbound_messages: number;
  /** Total de mensajes en el periodo. */
  total_messages: number;
  /** Intervenciones humanas escaladas (no eliminadas). */
  escalated: number;
  /** Intervenciones humanas resueltas. */
  resolved: number;
  /** Ratio resuelto/escalado (0.0 si no hubo escalados). */
  resolved_ratio: number;
  /** Contactos únicos con conversación en el periodo. */
  unique_contacts: number;
  /** Serie diaria de mensajes (orden cronológico). */
  daily: IStatsDailyRead[];
  /** Conteo por canal (conversaciones y mensajes). */
  by_channel: IStatsChannelRead[];
}

/** Payload completo de configuración de mantenimiento (PUT idempotente, B.9). */
export interface IMaintenanceConfigUpsert {
  /** Reglas de retención (por defecto vacío). */
  retention_rules?: Record<string, unknown>;
  /** Programación de mantenimiento (opcional). */
  maintenance_schedule?: string;
}

/** Configuración de mantenimiento del tenant tal como se expone. */
export interface IMaintenanceConfigRead extends IConfigSyncFields {
  /** Identificador de la fila. */
  id: string;
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Reglas de retención. */
  retention_rules: Record<string, unknown>;
  /** Programación de mantenimiento (null si no se definió). */
  maintenance_schedule: string | null;
  /** Versión optimista de la fila. */
  version: number;
  /** Marca de tiempo de creación (ISO 8601). */
  created_at: string;
}

/** Payload de purga por dominio en Mantenimiento (B.9 — Limpieza). */
export interface IPurgeRequest {
  /** Dominio a purgar: conversaciones, base de conocimiento o configuraciones. */
  scope: 'conversations' | 'knowledge_base' | 'configurations';
}

/** Resultado de una acción de mantenimiento del tenant (B.9). */
export interface IMaintenanceActionRead {
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Acción ejecutada: purga por dominio u optimización física. */
  action:
    | 'purge'
    | 'purge_knowledge_base'
    | 'purge_configurations'
    | 'optimize';
  /** Conversaciones eliminadas por la purga (solo purge). */
  deleted_conversations: number;
  /** Mensajes eliminados por la purga (solo purge). */
  deleted_messages: number;
  /** Documentos eliminados por la purga de la base de conocimiento (solo purge_knowledge_base). */
  deleted_documents: number;
  /** Sinónimos eliminados por la purga de la base de conocimiento (solo purge_knowledge_base). */
  deleted_synonyms: number;
  /** Configuraciones eliminadas por la purga de configuraciones (solo purge_configurations). */
  deleted_configs: number;
  /** Duración de la acción en milisegundos. */
  duration_ms: number;
  /** Mensaje legible con el resultado de la acción. */
  message: string;
}

/** Métricas de una tabla de operación del tenant (B.9 — Estado). */
export interface ITableStatsRead {
  /** Nombre de la tabla de operación (p. ej. `bot_contacts`). */
  table_name: string;
  /** Total de filas del tenant (incluye soft-deleted). */
  total: number;
  /** Filas activas del tenant (`deleted = false`). */
  active: number;
  /** Filas inactivas del tenant (soft-deleted). */
  inactive: number;
}

/** Resultado de una tarea individual del mantenimiento programado (B.9). */
export interface IScheduledTaskResultRead {
  /** Tabla sobre la que se ejecutó la tarea. */
  table: string;
  /** Operación ejecutada (purge, optimize, backup, ...). */
  operation: string;
  /** Estado de la tarea: ok, error o skipped. */
  status: 'ok' | 'error' | 'skipped';
  /** Instante en que se intentó ejecutar (ISO 8601). */
  executed_at: string;
  /** Mensaje legible con el resultado o el error. */
  message: string;
}

/** Resultado del lote de mantenimiento programado ejecutado manualmente (B.9). */
export interface IScheduledRunResultRead {
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Resultado de cada tarea configurada (orden de ejecución). */
  tasks: IScheduledTaskResultRead[];
  /** Duración total del lote en milisegundos. */
  duration_ms: number;
  /** Mensaje legible con el resultado del lote. */
  message: string;
}

/** Metadatos del documento de backup generado (B.9 backup/restaurar). */
export interface IBackupMetaRead {
  /** Formato del documento (p. ej. "omnibotia-operations"). */
  format: string;
  /** Versión del formato del backup. */
  version: number;
  /** Identificador del tenant propietario del backup. */
  tenant_id: string;
  /** Marca de tiempo de creación del backup (ISO 8601). */
  created_at: string;
}

/** Resultado de la restauración de un backup (B.9 backup/restaurar). */
export interface IRestoreResultRead {
  /** Identificador del tenant propietario. */
  tenant_id: string;
  /** Número de filas restauradas por tabla. */
  restored: Record<string, number>;
  /** Mensaje legible con el resultado de la restauración. */
  message: string;
}

// ────────────────────────────────────────────────────────────────────────────
// SUBSISTEMA CRM (P3) — pipeline "Ventas", tareas, SLA y embudo.
// Los read models exponen la tupla sync (revision/updated_at) que el backend
// publica (patrón de `IAdCampaignRead`: sin `deleted`/`version`).
// ────────────────────────────────────────────────────────────────────────────

/** Estado de una oportunidad comercial. */
export type CrmDealStatus = 'open' | 'won' | 'lost';
/** Estado de una tarea de seguimiento. */
export type CrmTaskStatus = 'pending' | 'done' | 'cancelled';
/** Prioridad de una tarea de seguimiento. */
export type CrmTaskPriority = 'low' | 'medium' | 'high';
/** Resultado estructural de una etapa terminal. */
export type CrmStageOutcome = 'won' | 'lost';
/** Actor que registró un movimiento de etapa. */
export type CrmChangedBy = 'bot' | 'vendedor' | 'sistema';
/** Moneda soportada por el pipeline. */
export type CrmCurrency = 'USD' | 'MXN';

// ── Etapas del pipeline (M1) ────────────────────────────────────────────────

/** Payload para crear una etapa del pipeline del tenant activo. */
export interface IStageCreate {
  /** Nombre de la etapa (1-64 caracteres, obligatorio). */
  name: string;
  /** Orden de presentación (>= 0, por defecto 0). */
  order?: number;
  /** Probabilidad por defecto 0-100 (por defecto 0). */
  default_probability?: number;
  /** Indica si la etapa cierra la oportunidad (por defecto `false`). */
  is_terminal?: boolean;
  /** Resultado estructural del cierre; exigido si `is_terminal` es `true`. */
  outcome?: CrmStageOutcome | null;
}

/** Payload parcial para actualizar una etapa (PATCH). */
export interface IStageUpdate {
  /** Nombre de la etapa (1-64 caracteres). */
  name?: string;
  /** Orden de presentación (>= 0). */
  order?: number;
  /** Probabilidad por defecto 0-100. */
  default_probability?: number;
  /** Indica si la etapa cierra la oportunidad. */
  is_terminal?: boolean;
  /** Resultado estructural del cierre; exigido si `is_terminal` es `true`. */
  outcome?: CrmStageOutcome | null;
}

/** Etapa del pipeline tal como se expone a los clientes. */
export interface IStageRead {
  /** Identificador único de la etapa. */
  id: string;
  /** Identificador del tenant al que pertenece. */
  tenant_id: string;
  /** Nombre de la etapa (1-64 caracteres). */
  name: string;
  /** Orden de presentación (>= 0). */
  order: number;
  /** Probabilidad por defecto 0-100. */
  default_probability: number;
  /** Indica si la etapa cierra la oportunidad. */
  is_terminal: boolean;
  /** Resultado estructural del cierre (`won` | `lost`) o `null`. */
  outcome: CrmStageOutcome | null;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Revisión optimista (concurrency control). */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

// ── Oportunidades (M1) ───────────────────────────────────────────────────────

/** Payload para crear una oportunidad en el pipeline del tenant activo. */
export interface IDealCreate {
  /** Título de la oportunidad (1-255 caracteres, obligatorio). */
  title: string;
  /** Etapa inicial de la oportunidad. */
  stage_id: string;
  /** Importe en unidades menores (>= 0, por defecto 0). */
  amount_minor?: number;
  /** Moneda (por defecto `USD`). */
  currency?: CrmCurrency;
  /** Probabilidad 0-100 (por defecto 0). */
  probability?: number;
  /** Vendedor responsable (opcional). */
  owner_id?: string | null;
  /** Contacto vinculado (opcional). */
  contact_id?: string | null;
  /** Lead de origen (opcional). */
  lead_id?: string | null;
  /** Cotización vinculada (opcional). */
  quote_id?: string | null;
  /** Pago vinculado (opcional). */
  payment_id?: string | null;
  /** Fecha esperada de cierre (ISO 8601 `YYYY-MM-DD`, opcional). */
  expected_close_at?: string | null;
  /** Metadatos libres (por defecto `{}`). */
  metadata?: Record<string, unknown>;
}

/** Payload parcial para actualizar una oportunidad (PATCH, incluye mover de etapa). */
export interface IDealUpdate {
  /** Título de la oportunidad (1-255 caracteres). */
  title?: string;
  /** Etapa actual de la oportunidad. */
  stage_id?: string;
  /** Importe en unidades menores (>= 0). */
  amount_minor?: number;
  /** Moneda (por defecto `USD`). */
  currency?: CrmCurrency;
  /** Probabilidad 0-100. */
  probability?: number;
  /** Vendedor responsable (opcional). */
  owner_id?: string | null;
  /** Contacto vinculado (opcional). */
  contact_id?: string | null;
  /** Lead de origen (opcional). */
  lead_id?: string | null;
  /** Cotización vinculada (opcional). */
  quote_id?: string | null;
  /** Pago vinculado (opcional). */
  payment_id?: string | null;
  /** Fecha esperada de cierre (ISO 8601 `YYYY-MM-DD`, opcional). */
  expected_close_at?: string | null;
  /** Metadatos libres (por defecto `{}`). */
  metadata?: Record<string, unknown>;
  /** Nota del movimiento (máx. 4000 caracteres, opcional). */
  note?: string;
  /** Razón de cierre perdido; obligatoria si el cierre es `lost`. */
  lost_reason?: string;
}

/** Oportunidad comercial tal como se expone a los clientes. */
export interface IDealRead {
  /** Identificador único de la oportunidad. */
  id: string;
  /** Identificador del tenant al que pertenece. */
  tenant_id: string;
  /** Título de la oportunidad (1-255 caracteres). */
  title: string;
  /** Etapa actual de la oportunidad. */
  stage_id: string;
  /** Importe en unidades menores (>= 0). */
  amount_minor: number;
  /** Moneda del importe (`USD` | `MXN`). */
  currency: string;
  /** Probabilidad 0-100. */
  probability: number;
  /** Estado del pipeline (`open` | `won` | `lost`). */
  status: CrmDealStatus;
  /** Vendedor responsable o `null`. */
  owner_id: string | null;
  /** Contacto vinculado o `null`. */
  contact_id: string | null;
  /** Lead de origen o `null`. */
  lead_id: string | null;
  /** Cotización vinculada o `null`. */
  quote_id: string | null;
  /** Pago vinculado o `null`. */
  payment_id: string | null;
  /** Fecha esperada de cierre (ISO 8601 `YYYY-MM-DD`) o `null`. */
  expected_close_at: string | null;
  /** Metadatos libres. */
  metadata: Record<string, unknown>;
  /** Fecha de cierre (ISO 8601) o `null`. */
  closed_at: string | null;
  /** Fecha de ganada (ISO 8601) o `null`. */
  won_at: string | null;
  /** Fecha de perdida (ISO 8601) o `null`. */
  lost_at: string | null;
  /** Razón de cierre perdido o `null`. */
  lost_reason: string | null;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Revisión optimista (concurrency control). */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

/** Consulta de oportunidades (filtros opcionales + paginado). */
export interface ICrmDealsQuery {
  /** Página solicitada (1-based). */
  page?: number;
  /** Tamaño de página (por defecto 20). */
  page_size?: number;
  /** Filtro por etapa. */
  stage_id?: string;
  /** Filtro por vendedor responsable. */
  owner_id?: string;
  /** Filtro por estado del pipeline. */
  status?: CrmDealStatus;
}

/** Registro inmutable de un movimiento de etapa (append-only). */
export interface IStageChangeRead {
  /** Identificador único del movimiento. */
  id: string;
  /** Identificador del tenant al que pertenece. */
  tenant_id: string;
  /** Oportunidad afectada (obligatoria). */
  deal_id: string;
  /** Etapa de origen o `null` (creación). */
  from_stage_id: string | null;
  /** Etapa de destino o `null`. */
  to_stage_id: string | null;
  /** Actor que registró el movimiento (`bot` | `vendedor` | `sistema`). */
  changed_by: CrmChangedBy;
  /** Nota del movimiento o `null`. */
  note: string | null;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Revisión optimista (concurrency control). */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

// ── Tareas de seguimiento (M2) ───────────────────────────────────────────────

/** Payload para crear una tarea de seguimiento del tenant activo. */
export interface ITaskCreate {
  /** Oportunidad vinculada (opcional; el endpoint `/deals/{id}/tasks` lo ancla). */
  deal_id?: string | null;
  /** Contacto vinculado (opcional). */
  contact_id?: string | null;
  /** Título de la tarea (1-255 caracteres, obligatorio). */
  title: string;
  /** Fecha límite (ISO 8601, opcional). */
  due_at?: string | null;
  /** Estado (por defecto `pending`). */
  status?: CrmTaskStatus;
  /** Prioridad (por defecto `medium`). */
  priority?: CrmTaskPriority;
  /** Responsable (opcional). */
  assignee_id?: string | null;
}

/** Payload parcial para actualizar una tarea (PATCH). */
export interface ITaskUpdate {
  /** Oportunidad vinculada (opcional). */
  deal_id?: string | null;
  /** Contacto vinculado (opcional). */
  contact_id?: string | null;
  /** Título de la tarea (1-255 caracteres). */
  title?: string;
  /** Fecha límite (ISO 8601, opcional). */
  due_at?: string | null;
  /** Estado (por defecto `pending`). */
  status?: CrmTaskStatus;
  /** Prioridad (por defecto `medium`). */
  priority?: CrmTaskPriority;
  /** Responsable (opcional). */
  assignee_id?: string | null;
}

/** Tarea de seguimiento tal como se expone a los clientes. */
export interface ITaskRead {
  /** Identificador único de la tarea. */
  id: string;
  /** Identificador del tenant al que pertenece. */
  tenant_id: string;
  /** Oportunidad vinculada o `null`. */
  deal_id: string | null;
  /** Contacto vinculado o `null`. */
  contact_id: string | null;
  /** Título de la tarea (1-255 caracteres). */
  title: string;
  /** Fecha límite (ISO 8601) o `null`. */
  due_at: string | null;
  /** Estado de la tarea. */
  status: CrmTaskStatus;
  /** Prioridad de la tarea. */
  priority: CrmTaskPriority;
  /** Responsable o `null`. */
  assignee_id: string | null;
  /** Fecha de completado (ISO 8601) o `null`. */
  completed_at: string | null;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Revisión optimista (concurrency control). */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

/** Consulta de tareas (filtro por deal opcional + paginado). */
export interface ICrmTasksQuery {
  /** Página solicitada (1-based). */
  page?: number;
  /** Tamaño de página (por defecto 20). */
  page_size?: number;
  /** Filtro por oportunidad vinculada. */
  deal_id?: string;
}

// ── Política SLA por etapa (M5) ──────────────────────────────────────────────

/** Payload para crear o actualizar la política SLA de una etapa. */
export interface ISlaUpsert {
  /** Etapa a la que aplica la política (obligatoria). */
  stage_id: string;
  /** Horas máximas para responder (>= 0). */
  max_response_hours: number;
  /** Días máximos de permanencia en la etapa (>= 0). */
  max_stay_days: number;
}

/** Política de SLA tal como se expone a los clientes. */
export interface ISlaRead {
  /** Identificador único de la política. */
  id: string;
  /** Identificador del tenant al que pertenece. */
  tenant_id: string;
  /** Etapa a la que aplica la política. */
  stage_id: string;
  /** Horas máximas para responder (>= 0). */
  max_response_hours: number;
  /** Días máximos de permanencia en la etapa (>= 0). */
  max_stay_days: number;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Revisión optimista (concurrency control). */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

// ── Embudo (reporte M4) ──────────────────────────────────────────────────────

/** Agregación por etapa del embudo comercial. */
export interface IFunnelStageRead {
  /** Etapa del embudo. */
  stage_id: string;
  /** Nombre de la etapa. */
  stage_name: string;
  /** Número de oportunidades en la etapa. */
  count: number;
  /** Importe total en unidades menores. */
  total_amount_minor: number;
  /** Valor ponderado por probabilidad (unidades menores). */
  weighted_value_minor: number;
  /** Tasa de conversión 0-1 o `null`. */
  conversion_rate: number | null;
  /** Días promedio de permanencia o `null`. */
  avg_cycle_days: number | null;
}

/** Reporte del embudo: conteo, montos, conversión y tasas de cierre. */
export interface IFunnelRead {
  /** Agregación por etapa del embudo. */
  stages: IFunnelStageRead[];
  /** Total de oportunidades. */
  total_deals: number;
  /** Oportunidades ganadas. */
  won_count: number;
  /** Oportunidades perdidas. */
  lost_count: number;
  /** Oportunidades abiertas. */
  open_count: number;
  /** Importe ganado en unidades menores. */
  won_amount_minor: number;
  /** Tasa de cierre 0-1. */
  close_rate: number;
  /** Días promedio del ciclo completo o `null`. */
  avg_cycle_days: number | null;
}

// ── Resumen del cliente (P4, portal) ────────────────────────────────────────

/** Resumen de oportunidades de un cliente (filtrado por email). */
export interface ICrmSummaryRead {
  /** Oportunidades del cliente (filtradas por email). */
  deals: IDealRead[];
  /** Tareas del cliente (filtradas por email). */
  tasks: ITaskRead[];
  /** Total de oportunidades del cliente. */
  total_deals: number;
  /** Oportunidades abiertas del cliente. */
  open_deals: number;
  /** Oportunidades ganadas del cliente. */
  won_deals: number;
}

// ── Autenticación de estudio y RBAC (usuarios, membresías) ──────────────────

/** Rol de un usuario dentro de un tenant (RBAC por tenant). */
export type IRole = 'admin' | 'configurador' | 'operador';

/** Usuario de la plataforma (estudio). */
export interface IUserRead {
  /** Identificador único del usuario (UUID). */
  id: string;
  /** Correo electrónico (identificador de acceso). */
  email: string;
  /** Nombre visible opcional. */
  display_name: string | null;
  /** Indica si es super-admin de la plataforma (control plane). */
  is_super_admin: boolean;
  /** Indica si la cuenta está activa. */
  is_active: boolean;
  /** Último acceso (o `null` si nunca inició sesión). */
  last_login_at: string | null;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Versión de concurrencia optimista. */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

/** Datos para crear un usuario de plataforma (super-admin). */
export interface IUserCreate {
  /** Correo electrónico del usuario. */
  email: string;
  /** Contraseña inicial. */
  password: string;
  /** Nombre visible opcional. */
  display_name?: string | null;
  /** Indica si es super-admin de la plataforma. */
  is_super_admin?: boolean;
}

/** Datos para actualizar un usuario de plataforma (super-admin). */
export interface IUserUpdate {
  /** Nombre visible opcional. */
  display_name?: string | null;
  /** Nueva contraseña opcional. */
  password?: string;
  /** Indica si es super-admin de la plataforma. */
  is_super_admin?: boolean;
  /** Indica si la cuenta está activa. */
  is_active?: boolean;
}

/** Membresía de un usuario en un tenant (RBAC). */
export interface IMembershipRead {
  /** Identificador único de la membresía (UUID). */
  id: string;
  /** Identificador del usuario (UUID). */
  user_id: string;
  /** Identificador del tenant (UUID). */
  tenant_id: string;
  /** Slug público estable del tenant (cuando el backend lo enriquece). */
  tenant_slug?: string;
  /** Rol del usuario dentro del tenant. */
  role: IRole;
  /** Fecha de creación (ISO 8601). */
  created_at: string;
  /** Versión de concurrencia optimista. */
  revision: number;
  /** Fecha de última actualización (ISO 8601). */
  updated_at: string;
}

/** Datos para crear una membresía usuario↔tenant (super-admin). */
export interface IMembershipCreate {
  /** Identificador del usuario (UUID). */
  user_id: string;
  /** Identificador del tenant (slug o UUID). */
  tenant_id: string;
  /** Rol del usuario dentro del tenant. */
  role: IRole;
}

/** Datos para actualizar el rol de una membresía. */
export interface IMembershipUpdate {
  /** Nuevo rol del usuario dentro del tenant. */
  role: IRole;
}

/** Datos para añadir un miembro a un tenant por email (admin). */
export interface IMemberAddRequest {
  /** Correo del usuario a añadir (se crea si no existe). */
  email: string;
  /** Rol del usuario dentro del tenant. */
  role: IRole;
  /** Nombre visible opcional (solo si se crea el usuario). */
  display_name?: string | null;
  /** Contraseña opcional (solo si se crea el usuario). */
  password?: string;
}

/** Credenciales de inicio de sesión del estudio. */
export interface ILoginRequest {
  /** Correo electrónico del usuario. */
  email: string;
  /** Contraseña. */
  password: string;
}

/** Respuesta de inicio de sesión del estudio. */
export interface ILoginResponse {
  /** Token JWT de acceso. */
  access_token: string;
  /** Tipo de token (siempre `bearer`). */
  token_type: string;
  /** Usuario autenticado. */
  user: IUserRead;
}

/** Petición de cambio de contraseña (sesión iniciada). */
export interface IChangePasswordRequest {
  /** Contraseña actual. */
  current_password: string;
  /** Nueva contraseña. */
  new_password: string;
}
