/**
 * Servicio de sinónimos del bot (Fase 2 — normalización de vocabulario) — puerto + implementación.
 *
 * Contrato:
 * - `ISynonymService` es el puerto consumido por la UI y el store de configuración.
 * - `BackendSynonymService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case).
 * - El listado devuelve un página de sinónimos; la exportación devuelve el texto crudo
 *   (CSV o JSON) tal como lo sirve el backend para descargarlo como archivo.
 * - La fábrica `createSynonymService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IPage,
  IPageQuery,
  ISynonymCreate,
  ISynonymImportRequest,
  ISynonymImportResultRead,
  ISynonymRead,
  ISynonymUpdate,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de sinónimos del bot (Fase 2 — normalización). */
export interface ISynonymService {
  /** Lista los sinónimos del bot del tenant (paginado). */
  listSynonyms(query?: IPageQuery): Promise<IPage<ISynonymRead>>;
  /** Crea un sinónimo (término único por tenant + lista de equivalencias). */
  createSynonym(input: ISynonymCreate): Promise<ISynonymRead>;
  /** Actualiza un sinónimo existente. */
  updateSynonym(synonymId: string, input: ISynonymUpdate): Promise<ISynonymRead>;
  /** Elimina lógicamente un sinónimo del tenant. */
  deleteSynonym(synonymId: string): Promise<void>;
  /** Importa sinónimos en lote (CSV/JSON) y devuelve el resumen del proceso. */
  importSynonyms(input: ISynonymImportRequest): Promise<ISynonymImportResultRead>;
  /** Exporta los sinónimos como texto CSV o JSON (respuesta cruda del backend). */
  exportSynonyms(format: 'csv' | 'json'): Promise<string>;
}

/** Implementación del puerto de sinónimos sobre el cliente HTTP de la API v1. */
export class BackendSynonymService implements ISynonymService {
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Lista los sinónimos del bot del tenant (paginado). */
  public async listSynonyms(query?: IPageQuery): Promise<IPage<ISynonymRead>> {
    this.logger?.debug('synonyms.list', {});
    return this.apiClient.listSynonyms(query);
  }

  /** Crea un sinónimo (término único por tenant + lista de equivalencias). */
  public async createSynonym(input: ISynonymCreate): Promise<ISynonymRead> {
    this.logger?.debug('synonyms.create', { term: input.term, synonyms: input.synonyms.length });
    return this.apiClient.createSynonym(input);
  }

  /** Actualiza un sinónimo existente. */
  public async updateSynonym(synonymId: string, input: ISynonymUpdate): Promise<ISynonymRead> {
    this.logger?.debug('synonyms.update', { synonymId, term: input.term });
    return this.apiClient.updateSynonym(synonymId, input);
  }

  /** Elimina lógicamente un sinónimo del tenant. */
  public async deleteSynonym(synonymId: string): Promise<void> {
    this.logger?.debug('synonyms.delete', { synonymId });
    await this.apiClient.deleteSynonym(synonymId);
  }

  /** Importa sinónimos en lote (CSV/JSON) y devuelve el resumen del proceso. */
  public async importSynonyms(input: ISynonymImportRequest): Promise<ISynonymImportResultRead> {
    this.logger?.debug('synonyms.import', { format: input.format });
    return this.apiClient.importSynonyms(input);
  }

  /** Exporta los sinónimos como texto CSV o JSON (respuesta cruda del backend). */
  public async exportSynonyms(format: 'csv' | 'json'): Promise<string> {
    this.logger?.debug('synonyms.export', { format });
    return this.apiClient.exportSynonyms(format);
  }
}

/**
 * Crea un servicio de sinónimos listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `ISynonymService`.
 */
export function createSynonymService(apiClient: IApiClient, logger?: ILogger): ISynonymService {
  return new BackendSynonymService(apiClient, logger);
}
