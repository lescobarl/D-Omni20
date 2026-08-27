/**
 * Servicio de generación IA de landings (puerto + implementación).
 *
 * Contrato:
 * - `IAiService` es el puerto consumido por la UI y el store de IA.
 * - `BackendAiService` implementa el puerto vía `IApiClient.generateLanding`
 *   y normaliza la respuesta con `mapAiConfigToLanding`.
 * - La fábrica `createAiService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import { mapAiConfigToLanding } from '@/core/aiConfig';
import type { ILogger } from '@/lib/logger';
import type { ILandingConfig, WorkflowType } from '@/types/editor';

/** Resultado normalizado de una generación IA. */
export interface IAiGenerationResult {
  /** Configuración de la landing mapeada al dominio del editor. */
  config: ILandingConfig;
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

/** Puerto del servicio de generación IA de landings. */
export interface IAiService {
  /** Genera una configuración de landing a partir de un prompt y un workflow. */
  generate(prompt: string, workflowType: WorkflowType): Promise<IAiGenerationResult>;
}

/** Implementación del puerto IA sobre el cliente HTTP del backend. */
export class BackendAiService implements IAiService {
  /** Operación de auditoría de la generación IA. */
  private static readonly OPERATION = 'ai.generate';
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Genera una configuración de landing vía el backend y la normaliza al dominio. */
  public async generate(prompt: string, workflowType: WorkflowType): Promise<IAiGenerationResult> {
    this.logger?.debug(BackendAiService.OPERATION, {
      workflowType,
      promptLength: prompt.length,
    });
    const response = await this.apiClient.generateLanding({ prompt, workflow_type: workflowType });
    const config = mapAiConfigToLanding(response.config);
    this.logger?.info(BackendAiService.OPERATION, {
      model: response.model,
      cached: response.cached,
      blocks: config.blocks.length,
    });
    return {
      config,
      model: response.model,
      cached: response.cached,
      promptTokens: response.prompt_tokens,
      completionTokens: response.completion_tokens,
      generatedAt: response.generated_at,
    };
  }
}

/**
 * Fábrica del servicio de generación IA.
 * @param apiClient Cliente HTTP de la API v1 (inyectado por DI).
 * @param logger Logger de auditoría opcional.
 * @returns Implementación lista para inyectar en el composition root.
 */
export function createAiService(apiClient: IApiClient, logger?: ILogger): IAiService {
  return new BackendAiService(apiClient, logger);
}
