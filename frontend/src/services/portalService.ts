/**
 * Servicio de Páginas del Portal del Cliente — puerto + implementación.
 *
 * Contrato:
 * - `IPortalService` es el puerto consumido por la UI y el store del portal.
 * - `BackendPortalService` implementa el puerto vía `IApiClient` (métodos
 *   `listPortalPages`, `getPortalPage`, `createPortalPage`, `updatePortalPage`,
 *   `deletePortalPage`, `publishPortalPage`, `generatePortalPage`), normalizando
 *   las respuestas del backend.
 * - La fábrica `createPortalService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IPage,
  IPageQuery,
  IPortalPageAiGenerationRequest,
  IPortalPageAiGenerationResponse,
  IPortalPageCreate,
  IPortalPagePublishRequest,
  IPortalPageRead,
  IPortalPageUpdate,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de páginas del Portal del Cliente. */
export interface IPortalService {
  /** Lista paginada de páginas del portal del tenant activo. */
  list(query?: IPageQuery): Promise<IPage<IPortalPageRead>>;
  /** Obtiene una página del portal por su identificador. */
  get(pageId: string): Promise<IPortalPageRead>;
  /** Crea una página del portal dentro del tenant activo. */
  create(payload: IPortalPageCreate): Promise<IPortalPageRead>;
  /** Actualiza parcialmente una página del portal (PATCH semantics). */
  update(pageId: string, payload: IPortalPageUpdate): Promise<IPortalPageRead>;
  /** Elimina una página del portal. */
  delete(pageId: string): Promise<void>;
  /** (Des)publica una página del portal. */
  publish(pageId: string, payload: IPortalPagePublishRequest): Promise<IPortalPageRead>;
  /** Genera una página del portal vía IA a partir de un prompt. */
  generate(payload: IPortalPageAiGenerationRequest): Promise<IPortalPageAiGenerationResponse>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendPortalService implements IPortalService {
  /** Nombre de la operación de listado para trazabilidad. */
  private static readonly OPERATION_LIST = 'portal.list';
  /** Nombre de la operación de lectura para trazabilidad. */
  private static readonly OPERATION_GET = 'portal.get';
  /** Nombre de la operación de creación para trazabilidad. */
  private static readonly OPERATION_CREATE = 'portal.create';
  /** Nombre de la operación de actualización para trazabilidad. */
  private static readonly OPERATION_UPDATE = 'portal.update';
  /** Nombre de la operación de eliminación para trazabilidad. */
  private static readonly OPERATION_DELETE = 'portal.delete';
  /** Nombre de la operación de (des)publicación para trazabilidad. */
  private static readonly OPERATION_PUBLISH = 'portal.publish';
  /** Nombre de la operación de generación IA para trazabilidad. */
  private static readonly OPERATION_GENERATE = 'portal.generate';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Lista paginada de páginas del portal del tenant activo.
   * @param query - Parámetros de paginación opcionales.
   * @returns Página de resultados con las páginas del portal.
   */
  public async list(query: IPageQuery = {}): Promise<IPage<IPortalPageRead>> {
    this.logger?.info(BackendPortalService.OPERATION_LIST, { query });
    return this.apiClient.listPortalPages(query);
  }

  /**
   * Obtiene una página del portal por su identificador.
   * @param pageId - Identificador de la página.
   * @returns La página del portal solicitada.
   */
  public async get(pageId: string): Promise<IPortalPageRead> {
    this.logger?.info(BackendPortalService.OPERATION_GET, { pageId });
    return this.apiClient.getPortalPage(pageId);
  }

  /**
   * Crea una página del portal dentro del tenant activo.
   * @param payload - Datos de creación (slug, título y bloques opcionales).
   * @returns La página del portal creada.
   */
  public async create(payload: IPortalPageCreate): Promise<IPortalPageRead> {
    this.logger?.info(BackendPortalService.OPERATION_CREATE, { slug: payload.slug });
    return this.apiClient.createPortalPage(payload);
  }

  /**
   * Actualiza parcialmente una página del portal (PATCH semantics).
   * @param pageId - Identificador de la página.
   * @param payload - Campos a actualizar.
   * @returns La página del portal actualizada.
   */
  public async update(pageId: string, payload: IPortalPageUpdate): Promise<IPortalPageRead> {
    this.logger?.info(BackendPortalService.OPERATION_UPDATE, { pageId });
    return this.apiClient.updatePortalPage(pageId, payload);
  }

  /**
   * Elimina una página del portal.
   * @param pageId - Identificador de la página.
   */
  public async delete(pageId: string): Promise<void> {
    this.logger?.info(BackendPortalService.OPERATION_DELETE, { pageId });
    return this.apiClient.deletePortalPage(pageId);
  }

  /**
   * (Des)publica una página del portal.
   * @param pageId - Identificador de la página.
   * @param payload - Estado de publicación deseado.
   * @returns La página del portal con el estado de publicación actualizado.
   */
  public async publish(pageId: string, payload: IPortalPagePublishRequest): Promise<IPortalPageRead> {
    this.logger?.info(BackendPortalService.OPERATION_PUBLISH, { pageId, published: payload.published });
    return this.apiClient.publishPortalPage(pageId, payload);
  }

  /**
   * Genera una página del portal vía IA a partir de un prompt.
   * @param payload - Prompt descriptivo y voz de marca opcional.
   * @returns La página del portal generada por el motor IA.
   */
  public async generate(payload: IPortalPageAiGenerationRequest): Promise<IPortalPageAiGenerationResponse> {
    this.logger?.info(BackendPortalService.OPERATION_GENERATE, { promptLength: payload.prompt.length });
    return this.apiClient.generatePortalPage(payload);
  }
}

/**
 * Crea un servicio de páginas del portal listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IPortalService`.
 */
export function createPortalService(apiClient: IApiClient, logger?: ILogger): IPortalService {
  return new BackendPortalService(apiClient, logger);
}
