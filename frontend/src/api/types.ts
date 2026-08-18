/**
 * Tipos DTO de la capa de API — espejo de los esquemas pydantic del backend.
 *
 * Contrato:
 * - Cada interfaz refleja 1:1 la respuesta/payload del backend (`/api/v1`).
 * - Los UUID y fechas se modelan como `string` (serialización JSON estándar).
 * - `config` es un diccionario libre (`Record<string, unknown>`) igual que
 *   `dict[str, Any]` en pydantic.
 */

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
  /** Nombre de la plantilla de compilación. */
  template_name?: string;
}

/** Respuesta de compilación (`LandingCompileResponse`). */
export interface ILandingCompileResponse {
  /** HTML renderizado de la configuración. */
  html: string;
  /** Marca de tiempo UTC de la compilación. */
  compiled_at: string;
}

/** Solicitud de (des)publicación (`LandingPublishRequest`). */
export interface ILandingPublishRequest {
  /** Estado de publicación deseado (por defecto `true`). */
  published?: boolean;
}
