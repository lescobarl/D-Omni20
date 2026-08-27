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
