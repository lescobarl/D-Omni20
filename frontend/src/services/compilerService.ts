/**
 * Servicio de compilación de landings (puerto + implementación).
 *
 * Contrato:
 * - `ICompilerService` es el puerto consumido por la UI y el store de compilación.
 * - `BackendCompilerService` implementa el puerto vía `IApiClient.compileLanding`
 *   (POST `/designer/compile`) y normaliza la respuesta snake_case a camelCase.
 * - La fábrica `createCompilerService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type { ILogger } from '@/lib/logger';

/** Nombre de la plantilla de compilación por defecto. */
export const DEFAULT_TEMPLATE_NAME = 'default';

/** Valor por defecto de minificación del HTML resultante. */
export const DEFAULT_MINIFY = false;

/** Solicitud de compilación normalizada (dominio → puerto). */
export interface ICompileRequest {
  /** Configuración del editor a compilar (contrato JSON del backend). */
  config: Record<string, unknown>;
  /** Indica si se debe minimizar el HTML resultante (por defecto `false`). */
  minify?: boolean;
}

/** Resultado normalizado de una compilación. */
export interface ICompilationResult {
  /** HTML renderizado de la configuración. */
  html: string;
  /** Duración de la compilación en milisegundos. */
  durationMs: number;
  /** Marca de tiempo UTC de la compilación. */
  compiledAt: string;
}

/** Puerto del servicio de compilación de landings. */
export interface ICompilerService {
  /** Compila una configuración de landing a HTML. */
  compile(request: ICompileRequest): Promise<ICompilationResult>;
}

/** Implementación del puerto de compilación sobre el cliente HTTP del backend. */
export class BackendCompilerService implements ICompilerService {
  /** Operación de auditoría de la compilación. */
  private static readonly OPERATION = 'landing.compile';
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Compila una configuración vía el backend y normaliza la respuesta al dominio. */
  public async compile(request: ICompileRequest): Promise<ICompilationResult> {
    const minify = request.minify ?? DEFAULT_MINIFY;
    this.logger?.debug(BackendCompilerService.OPERATION, {
      templateName: DEFAULT_TEMPLATE_NAME,
      minify,
      configBlocks: Array.isArray(request.config.blocks) ? request.config.blocks.length : 0,
    });
    const response = await this.apiClient.compileLanding({
      config: request.config,
      template_name: DEFAULT_TEMPLATE_NAME,
      minify,
    });
    this.logger?.info(BackendCompilerService.OPERATION, {
      durationMs: response.duration_ms,
      htmlBytes: response.html.length,
      minify,
    });
    return {
      html: response.html,
      durationMs: response.duration_ms,
      compiledAt: response.compiled_at,
    };
  }
}

/**
 * Fábrica del servicio de compilación de landings.
 * @param apiClient Cliente HTTP de la API v1 (inyectado por DI).
 * @param logger Logger de auditoría opcional.
 * @returns Implementación lista para inyectar en el composition root.
 */
export function createCompilerService(apiClient: IApiClient, logger?: ILogger): ICompilerService {
  return new BackendCompilerService(apiClient, logger);
}
