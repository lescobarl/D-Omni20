/**
 * Servicio de documentos ingeridos (Fase 1 — RAG) — puerto + implementación.
 *
 * Contrato:
 * - `IDocumentService` es el puerto consumido por la UI y el store de configuración.
 * - `BackendDocumentService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case).
 * - La ingesta acepta archivos (PDF/TXT/CSV, multipart) y URLs; la búsqueda devuelve
 *   fragmentos con puntuación; el contenido completo se recupera por documento.
 * - La fábrica `createDocumentService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IDocumentContentRead,
  IDocumentRead,
  IDocumentSearchRequest,
  IDocumentSearchResult,
  IIngestResultRead,
  IIngestUrlRequest,
  IPage,
  IPageQuery,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Entrada de dominio para ingerir un documento desde una URL. */
export interface IDocumentUrlInput {
  /** URL pública del documento a ingerir (1-2048 caracteres). */
  url: string;
  /** Título opcional mostrado al usuario (1-255 caracteres). */
  title?: string;
}

/** Contrato del servicio de documentos ingeridos (Fase 1 — RAG). */
export interface IDocumentService {
  /** Lista los documentos ingeridos del tenant (paginado). */
  listDocuments(query?: IPageQuery): Promise<IPage<IDocumentRead>>;
  /** Ingiere un archivo local (PDF/TXT/CSV) mediante multipart. */
  ingestDocumentFile(file: File): Promise<IIngestResultRead>;
  /** Ingiere un documento remoto desde una URL pública. */
  ingestDocumentUrl(input: IDocumentUrlInput): Promise<IIngestResultRead>;
  /** Busca documentos por texto libre en la base de conocimiento del tenant. */
  searchDocuments(query: string): Promise<IDocumentSearchResult[]>;
  /** Recupera el contenido completo de un documento ingerido. */
  getDocument(documentId: string): Promise<IDocumentContentRead>;
  /** Elimina lógicamente un documento ingerido del tenant. */
  deleteDocument(documentId: string): Promise<void>;
}

/** Implementación del puerto de documentos sobre el cliente HTTP de la API v1. */
export class BackendDocumentService implements IDocumentService {
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Lista los documentos ingeridos del tenant (paginado). */
  public async listDocuments(query?: IPageQuery): Promise<IPage<IDocumentRead>> {
    this.logger?.debug('documents.list', {});
    return this.apiClient.listDocuments(query);
  }

  /** Ingiere un archivo local (PDF/TXT/CSV) mediante multipart. */
  public async ingestDocumentFile(file: File): Promise<IIngestResultRead> {
    this.logger?.debug('documents.ingestFile', { name: file.name, size: file.size });
    return this.apiClient.ingestDocumentFile(file);
  }

  /** Ingiere un documento remoto traduciendo el input de dominio al DTO. */
  public async ingestDocumentUrl(input: IDocumentUrlInput): Promise<IIngestResultRead> {
    this.logger?.debug('documents.ingestUrl', { url: input.url });
    const payload: IIngestUrlRequest = { url: input.url, title: input.title };
    return this.apiClient.ingestDocumentUrl(payload);
  }

  /** Busca documentos por texto libre traduciendo la consulta al DTO de búsqueda. */
  public async searchDocuments(query: string): Promise<IDocumentSearchResult[]> {
    this.logger?.debug('documents.search', { query });
    const payload: IDocumentSearchRequest = { query };
    return this.apiClient.searchDocuments(payload);
  }

  /** Recupera el contenido completo de un documento ingerido. */
  public async getDocument(documentId: string): Promise<IDocumentContentRead> {
    this.logger?.debug('documents.get', { documentId });
    return this.apiClient.getDocument(documentId);
  }

  /** Elimina lógicamente un documento ingerido del tenant. */
  public async deleteDocument(documentId: string): Promise<void> {
    this.logger?.debug('documents.delete', { documentId });
    await this.apiClient.deleteDocument(documentId);
  }
}

/**
 * Crea un servicio de documentos listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IDocumentService`.
 */
export function createDocumentService(apiClient: IApiClient, logger?: ILogger): IDocumentService {
  return new BackendDocumentService(apiClient, logger);
}
