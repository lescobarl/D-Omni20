/**
 * Servicio de JSON Schemas (generación IA y validación) — puerto + implementación.
 *
 * Contrato:
 * - `ISchemaService` es el puerto consumido por la UI y el store de schemas.
 * - `BackendSchemaService` implementa el puerto vía `IApiClient.generateSchema`,
 *   `IApiClient.listSchemas` y `IApiClient.validateSchema`, normalizando las
 *   respuestas al dominio.
 * - La fábrica `createSchemaService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IDeveloperSchemaRead,
  ISchemaVersionCreateRequest,
  ISchemaVersionRead,
} from '@/api/types';
import type { ISchemaValidationIssue as IApiValidationIssue } from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Resultado normalizado de una generación de JSON Schema. */
export interface ISchemaGenerationResult {
  /** JSON Schema (Draft 2020-12) generado. */
  schema: Record<string, unknown>;
  /** Modelo de IA que generó la respuesta. */
  model: string;
  /** Indica si la respuesta provino de la caché del backend. */
  cached: boolean;
  /** Tokens de entrada consumidos por la generación. */
  promptTokens: number;
  /** Tokens de salida producidos por la generación. */
  completionTokens: number;
  /** Marca de tiempo UTC de la generación. */
  generatedAt: string;
}

/** Incidencia de validación normalizada al dominio. */
export interface ISchemaValidationIssue {
  /** Ruta del error dentro del JSON (p. ej. `properties.email` o `$`). */
  path: string;
  /** Mensaje legible del error de validación. */
  message: string;
  /** Palabra clave JSON Schema que falló (o `null` para errores de esquema). */
  keyword: string | null;
}

/** Resultado de validación de JSON Schema normalizado al dominio. */
export interface ISchemaValidationResult {
  /** Indica si el esquema (y los datos, si se enviaron) son válidos. */
  valid: boolean;
  /** Número total de errores detectados. */
  errors: number;
  /** Incidencias de validación encontradas. */
  issues: ISchemaValidationIssue[];
}

/** Puerto del servicio de JSON Schemas (generación, validación y versionado). */
export interface ISchemaService {
  /** Genera un JSON Schema (Draft 2020-12) a partir de un prompt y un nombre opcional. */
  generate(prompt: string, name?: string): Promise<ISchemaGenerationResult>;
  /** Lista los JSON Schemas generados del tenant activo. */
  list(): Promise<IDeveloperSchemaRead[]>;
  /** Lista las versiones de un schema del tenant activo (descendente). */
  listVersions(schemaId: string): Promise<ISchemaVersionRead[]>;
  /** Crea una nueva versión de un schema del tenant activo. */
  createVersion(schemaId: string, input: ISchemaVersionCreateRequest): Promise<ISchemaVersionRead>;
  /** Valida un JSON Schema (Draft 2020-12) y, opcionalmente, datos contra él. */
  validate(
    schema: Record<string, unknown>,
    data?: Record<string, unknown>,
  ): Promise<ISchemaValidationResult>;
}

/** Implementación del puerto de schemas sobre el cliente HTTP del backend. */
export class BackendSchemaService implements ISchemaService {
  /** Operación de auditoría de la generación de schemas. */
  private static readonly OPERATION = 'schema.generate';
  /** Operación de auditoría de la validación de schemas. */
  private static readonly VALIDATE_OPERATION = 'schema.validate';
  /** Operación de auditoría del listado de versiones de schemas. */
  private static readonly LIST_VERSIONS_OPERATION = 'schema.version.list';
  /** Operación de auditoría de la creación de versiones de schemas. */
  private static readonly CREATE_VERSION_OPERATION = 'schema.version.create';
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Genera un JSON Schema vía el backend y normaliza la respuesta al dominio. */
  public async generate(prompt: string, name?: string): Promise<ISchemaGenerationResult> {
    const trimmedName = name !== undefined ? name.trim() : '';
    this.logger?.debug(BackendSchemaService.OPERATION, {
      promptLength: prompt.length,
      name: trimmedName === '' ? null : trimmedName,
    });
    const response = await this.apiClient.generateSchema({
      prompt,
      ...(trimmedName !== '' ? { name: trimmedName } : {}),
    });
    const title = response.schema['title'];
    this.logger?.info(BackendSchemaService.OPERATION, {
      model: response.model,
      cached: response.cached,
      title: typeof title === 'string' ? title : null,
    });
    return {
      schema: response.schema,
      model: response.model,
      cached: response.cached,
      promptTokens: response.prompt_tokens,
      completionTokens: response.completion_tokens,
      generatedAt: response.generated_at,
    };
  }

  /** Lista los JSON Schemas generados del tenant activo (primera página). */
  public async list(): Promise<IDeveloperSchemaRead[]> {
    const page = await this.apiClient.listSchemas();
    return page.items;
  }

  /** Lista las versiones de un schema del tenant activo (primera página). */
  public async listVersions(schemaId: string): Promise<ISchemaVersionRead[]> {
    this.logger?.debug(BackendSchemaService.LIST_VERSIONS_OPERATION, { schemaId });
    const page = await this.apiClient.listSchemaVersions(schemaId);
    return page.items;
  }

  /** Crea una nueva versión de un schema del tenant activo. */
  public async createVersion(
    schemaId: string,
    input: ISchemaVersionCreateRequest,
  ): Promise<ISchemaVersionRead> {
    this.logger?.debug(BackendSchemaService.CREATE_VERSION_OPERATION, {
      schemaId,
      version: input.version,
    });
    return this.apiClient.createSchemaVersion(schemaId, input);
  }

  /** Valida un JSON Schema y, opcionalmente, datos contra él vía el backend. */
  public async validate(
    schema: Record<string, unknown>,
    data?: Record<string, unknown>,
  ): Promise<ISchemaValidationResult> {
    this.logger?.debug(BackendSchemaService.VALIDATE_OPERATION, {
      hasData: data !== undefined,
    });
    const response = await this.apiClient.validateSchema({
      schema,
      ...(data !== undefined ? { data } : {}),
    });
    this.logger?.info(BackendSchemaService.VALIDATE_OPERATION, {
      valid: response.valid,
      errors: response.errors,
    });
    return {
      valid: response.valid,
      errors: response.errors,
      issues: response.issues.map((issue: IApiValidationIssue) => ({
        path: issue.path,
        message: issue.message,
        keyword: issue.keyword,
      })),
    };
  }
}

/**
 * Fábrica del servicio de generación IA de JSON Schemas.
 * @param apiClient Cliente HTTP de la API v1 (inyectado por DI).
 * @param logger Logger de auditoría opcional.
 * @returns Implementación lista para inyectar en el composition root.
 */
export function createSchemaService(apiClient: IApiClient, logger?: ILogger): ISchemaService {
  return new BackendSchemaService(apiClient, logger);
}
