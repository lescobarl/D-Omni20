/**
 * Servicio de Landings del tenant — puerto + implementación.
 *
 * Contrato:
 * - `ILandingService` es el puerto consumido por la UI y el store del editor.
 * - `BackendLandingService` implementa el puerto vía `IApiClient` (métodos
 *   `listLandings`, `getLanding`, `createLanding`, `updateLanding`,
 *   `deleteLanding`, `publishLanding`, `compileLanding`, `generateLanding`),
 *   normalizando las respuestas del backend.
 * - La fábrica `createLandingService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IAiGenerationRequest,
  IAiGenerationResponse,
  ILandingCompileRequest,
  ILandingCompileResponse,
  ILandingCreate,
  ILandingPublishRequest,
  ILandingRead,
  ILandingUpdate,
  IPage,
  IPageQuery,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de landings del tenant. */
export interface ILandingService {
  /** Lista paginada de landings del tenant activo. */
  list(query?: IPageQuery): Promise<IPage<ILandingRead>>;
  /** Obtiene una landing por su identificador. */
  get(landingId: string): Promise<ILandingRead>;
  /** Crea una landing dentro del tenant activo. */
  create(payload: ILandingCreate): Promise<ILandingRead>;
  /** Actualiza parcialmente una landing (PATCH semantics). */
  update(landingId: string, payload: ILandingUpdate): Promise<ILandingRead>;
  /** Elimina una landing. */
  delete(landingId: string): Promise<void>;
  /** (Des)publica una landing. */
  publish(landingId: string, payload?: ILandingPublishRequest): Promise<ILandingRead>;
  /** Compila una configuración (config → HTML) sin persistirla. */
  compile(payload: ILandingCompileRequest): Promise<ILandingCompileResponse>;
  /** Genera una configuración de landing vía IA a partir de un prompt. */
  generate(payload: IAiGenerationRequest): Promise<IAiGenerationResponse>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendLandingService implements ILandingService {
  /** Nombre de la operación de listado para trazabilidad. */
  private static readonly OPERATION_LIST = 'landing.list';
  /** Nombre de la operación de lectura para trazabilidad. */
  private static readonly OPERATION_GET = 'landing.get';
  /** Nombre de la operación de creación para trazabilidad. */
  private static readonly OPERATION_CREATE = 'landing.create';
  /** Nombre de la operación de actualización para trazabilidad. */
  private static readonly OPERATION_UPDATE = 'landing.update';
  /** Nombre de la operación de eliminación para trazabilidad. */
  private static readonly OPERATION_DELETE = 'landing.delete';
  /** Nombre de la operación de (des)publicación para trazabilidad. */
  private static readonly OPERATION_PUBLISH = 'landing.publish';
  /** Nombre de la operación de compilación para trazabilidad. */
  private static readonly OPERATION_COMPILE = 'landing.compile';
  /** Nombre de la operación de generación IA para trazabilidad. */
  private static readonly OPERATION_GENERATE = 'landing.generate';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Lista paginada de landings del tenant activo.
   * @param query - Parámetros de paginación opcionales.
   * @returns Página de resultados con las landings del tenant.
   */
  public async list(query: IPageQuery = {}): Promise<IPage<ILandingRead>> {
    this.logger?.info(BackendLandingService.OPERATION_LIST, { query });
    return this.apiClient.listLandings(query);
  }

  /**
   * Obtiene una landing por su identificador.
   * @param landingId - Identificador de la landing.
   * @returns La landing solicitada.
   */
  public async get(landingId: string): Promise<ILandingRead> {
    this.logger?.info(BackendLandingService.OPERATION_GET, { landingId });
    return this.apiClient.getLanding(landingId);
  }

  /**
   * Crea una landing dentro del tenant activo.
   * @param payload - Datos de creación (campaña, nombre y configuración opcional).
   * @returns La landing creada.
   */
  public async create(payload: ILandingCreate): Promise<ILandingRead> {
    this.logger?.info(BackendLandingService.OPERATION_CREATE, { name: payload.name });
    return this.apiClient.createLanding(payload);
  }

  /**
   * Actualiza parcialmente una landing (PATCH semantics).
   * @param landingId - Identificador de la landing.
   * @param payload - Campos a actualizar.
   * @returns La landing actualizada.
   */
  public async update(landingId: string, payload: ILandingUpdate): Promise<ILandingRead> {
    this.logger?.info(BackendLandingService.OPERATION_UPDATE, { landingId });
    return this.apiClient.updateLanding(landingId, payload);
  }

  /**
   * Elimina una landing.
   * @param landingId - Identificador de la landing.
   */
  public async delete(landingId: string): Promise<void> {
    this.logger?.info(BackendLandingService.OPERATION_DELETE, { landingId });
    return this.apiClient.deleteLanding(landingId);
  }

  /**
   * (Des)publica una landing.
   * @param landingId - Identificador de la landing.
   * @param payload - Estado de publicación deseado (por defecto `true`).
   * @returns La landing con el estado de publicación actualizado.
   */
  public async publish(
    landingId: string,
    payload: ILandingPublishRequest = {},
  ): Promise<ILandingRead> {
    this.logger?.info(BackendLandingService.OPERATION_PUBLISH, {
      landingId,
      published: payload.published,
    });
    return this.apiClient.publishLanding(landingId, payload);
  }

  /**
   * Compila una configuración (config → HTML) sin persistirla.
   * @param payload - Configuración a compilar.
   * @returns HTML compilado y metadatos de la compilación.
   */
  public async compile(payload: ILandingCompileRequest): Promise<ILandingCompileResponse> {
    this.logger?.info(BackendLandingService.OPERATION_COMPILE, {
      templateName: payload.template_name,
    });
    return this.apiClient.compileLanding(payload);
  }

  /**
   * Genera una configuración de landing vía IA a partir de un prompt.
   * @param payload - Prompt descriptivo y tipo de workflow opcional.
   * @returns La configuración de landing generada por el motor IA.
   */
  public async generate(payload: IAiGenerationRequest): Promise<IAiGenerationResponse> {
    this.logger?.info(BackendLandingService.OPERATION_GENERATE, {
      promptLength: payload.prompt.length,
    });
    return this.apiClient.generateLanding(payload);
  }
}

/**
 * Crea un servicio de landings listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `ILandingService`.
 */
export function createLandingService(apiClient: IApiClient, logger?: ILogger): ILandingService {
  return new BackendLandingService(apiClient, logger);
}
