/**
 * Servicio del Marketplace de Templates — puerto + implementación.
 *
 * Contrato:
 * - `IMarketplaceService` es el puerto consumido por la UI y el store del marketplace.
 * - `BackendMarketplaceService` implementa el puerto vía `IApiClient.listMarketplaceTemplates`,
 *   `IApiClient.createMarketplaceTemplate` y `IApiClient.importMarketplaceTemplate`,
 *   normalizando la respuesta paginada al catálogo del dominio (Fase 8).
 * - La fábrica `createMarketplaceService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IMarketplaceImportResponse,
  IMarketplaceTemplateCreateRequest,
  IMarketplaceTemplateRead,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio del marketplace de templates. */
export interface IMarketplaceService {
  /** Lista los templates del catálogo del tenant (opcional por categoría). */
  list(category?: string): Promise<IMarketplaceTemplateRead[]>;
  /** Publica un template en el marketplace del tenant activo. */
  create(input: IMarketplaceTemplateCreateRequest): Promise<IMarketplaceTemplateRead>;
  /** Importa un template a una campaña (genera una landing) y devuelve la respuesta. */
  importTemplate(
    templateId: string,
    campaignId: string,
    name?: string,
  ): Promise<IMarketplaceImportResponse>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendMarketplaceService implements IMarketplaceService {
  /** Nombre de la operación de listado de templates para trazabilidad. */
  private static readonly OPERATION_LIST = 'marketplace.template.list';
  /** Nombre de la operación de publicación de templates para trazabilidad. */
  private static readonly OPERATION_CREATE = 'marketplace.template.create';
  /** Nombre de la operación de importación de templates para trazabilidad. */
  private static readonly OPERATION_IMPORT = 'marketplace.template.import';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Lista los templates del catálogo del tenant activo.
   * @param category - Categoría opcional para filtrar el catálogo.
   * @returns Lista plana de templates disponibles.
   */
  public async list(category?: string): Promise<IMarketplaceTemplateRead[]> {
    this.logger?.debug(BackendMarketplaceService.OPERATION_LIST, { category: category ?? null });
    const page = await this.apiClient.listMarketplaceTemplates({}, category);
    return page.items;
  }

  /**
   * Publica un template en el marketplace del tenant activo.
   * @param input - Datos del template a publicar (config + metadatos).
   * @returns El template persistido con su identificador.
   */
  public async create(input: IMarketplaceTemplateCreateRequest): Promise<IMarketplaceTemplateRead> {
    this.logger?.info(BackendMarketplaceService.OPERATION_CREATE, { category: input.category });
    return this.apiClient.createMarketplaceTemplate(input);
  }

  /**
   * Importa un template del marketplace a una campaña (genera una landing).
   * @param templateId - Identificador del template a importar.
   * @param campaignId - Campaña destino de la importación.
   * @param name - Nombre opcional de la landing generada.
   * @returns Respuesta con la landing creada y su origen.
   */
  public async importTemplate(
    templateId: string,
    campaignId: string,
    name?: string,
  ): Promise<IMarketplaceImportResponse> {
    this.logger?.info(BackendMarketplaceService.OPERATION_IMPORT, { templateId, campaignId });
    const cleanName = name?.trim();
    return this.apiClient.importMarketplaceTemplate(templateId, {
      campaign_id: campaignId,
      ...(cleanName ? { name: cleanName } : {}),
    });
  }
}

/**
 * Crea un servicio del marketplace listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IMarketplaceService`.
 */
export function createMarketplaceService(
  apiClient: IApiClient,
  logger?: ILogger,
): IMarketplaceService {
  return new BackendMarketplaceService(apiClient, logger);
}
