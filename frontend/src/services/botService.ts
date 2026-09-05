/**
 * Servicio del bot (Fase 7) — puerto + implementación sobre la API runtime.
 *
 * Contrato:
 * - `IBotService` es el puerto consumido por la UI y el store de bots.
 * - `BackendBotService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case).
 * - Los proveedores de IA se configuran por empresa (orden + modelo + prompt);
 *   las conversaciones y mensajes se listan paginados; el envío manual encola en
 *   la cola D3 (202) y el monitor de cola expone las estadísticas del tenant.
 * - La fábrica `createBotService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IBotProviderConfigRead,
  IConversationRead,
  IKeywordRead,
  IMessageEnqueueResult,
  IMessageRead,
  IPage,
  IPageQuery,
  IQueueStatsRead,
  IQuotaUsageResponse,
  IRouterTraceRead,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Entrada de dominio para crear o actualizar un proveedor de IA del tenant. */
export interface IBotProviderInput {
  /** Tipo de proveedor (1-16 caracteres, p. ej. `openai`). */
  providerKind: string;
  /** Orden de resolución entre proveedores (>= 0). */
  order: number;
  /** Estado habilitado del proveedor por defecto (`true`). */
  enabled: boolean;
  /** Modelo opcional del proveedor (máx. 128 caracteres). */
  model?: string | null;
  /** Temperatura opcional legible como decimal (`''` → sin temperatura). */
  temperature?: string | null;
  /** Prompt base opcional usado por el proveedor. */
  promptBase?: string;
}

/** Entrada de dominio para crear o actualizar una keyword del bot del tenant. */
export interface IKeywordInput {
  /** Término clave que activa la respuesta (1-255 caracteres). */
  term: string;
  /** Respuesta inteligente asociada al término (1-2000 caracteres). */
  response: string;
  /** Prioridad de coincidencia (0-1000, menor = más prioritario). */
  priority: number;
  /** Estado habilitado de la keyword. */
  enabled: boolean;
}

/** Contrato del servicio del bot (Fase 7). */
export interface IBotService {
  /** Lista las conversaciones del bot del tenant (paginado). */
  listConversations(query?: IPageQuery): Promise<IPage<IConversationRead>>;
  /** Lista los mensajes de una conversación (paginado, ascendente). */
  listConversationMessages(
    conversationId: string,
    query?: IPageQuery,
  ): Promise<IPage<IMessageRead>>;
  /** Envía un mensaje de prueba a la cola D3 (202) para una conversación. */
  sendConversationMessage(conversationId: string, content: string): Promise<IMessageEnqueueResult>;
  /** Lista los proveedores de IA configurados por el tenant (sin secretos). */
  listProviders(): Promise<IBotProviderConfigRead[]>;
  /** Crea o actualiza un proveedor de IA del tenant (UPSERT por tipo + orden). */
  upsertProvider(input: IBotProviderInput): Promise<IBotProviderConfigRead>;
  /** Elimina lógicamente un proveedor de IA del tenant (por clave compuesta tipo/orden). */
  deleteProvider(providerKind: string, order: number): Promise<void>;
  /** Devuelve las estadísticas de la cola D3 del tenant (monitor de cola). */
  getQueueStats(): Promise<IQueueStatsRead>;
  /** Devuelve el uso de cuota L1 del tenant (proveedores + agregado). */
  getQuotaUsage(): Promise<IQuotaUsageResponse>;
  /** Prueba el router del bot con un mensaje crudo (sin persistir ni encolar). */
  testRouter(message: string): Promise<IRouterTraceRead>;
  /** Lista las keywords del bot del tenant (paginado). */
  listKeywords(query?: IPageQuery): Promise<IPage<IKeywordRead>>;
  /** Crea una keyword del bot en el tenant activo (término único). */
  createKeyword(input: IKeywordInput): Promise<IKeywordRead>;
  /** Actualiza una keyword del bot del tenant activo (PUT). */
  updateKeyword(keywordId: string, input: IKeywordInput): Promise<IKeywordRead>;
  /** Elimina lógicamente una keyword del bot del tenant activo. */
  deleteKeyword(keywordId: string): Promise<void>;
}

/** Implementación del puerto del bot sobre el cliente HTTP de la API v1. */
export class BackendBotService implements IBotService {
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Lista las conversaciones del bot del tenant (paginado). */
  public async listConversations(query?: IPageQuery): Promise<IPage<IConversationRead>> {
    this.logger?.debug('bot.conversations.list', {});
    return this.apiClient.listConversations(query);
  }

  /** Lista los mensajes de una conversación (paginado, ascendente). */
  public async listConversationMessages(
    conversationId: string,
    query?: IPageQuery,
  ): Promise<IPage<IMessageRead>> {
    this.logger?.debug('bot.messages.list', { conversationId });
    return this.apiClient.listConversationMessages(conversationId, query);
  }

  /** Envía un mensaje de prueba a la cola D3 (202) para una conversación. */
  public async sendConversationMessage(
    conversationId: string,
    content: string,
  ): Promise<IMessageEnqueueResult> {
    this.logger?.debug('bot.messages.send', { conversationId });
    return this.apiClient.sendConversationMessage(conversationId, { content });
  }

  /** Lista los proveedores de IA configurados por el tenant (sin secretos). */
  public async listProviders(): Promise<IBotProviderConfigRead[]> {
    this.logger?.debug('bot.providers.list', {});
    return this.apiClient.listBotProviders();
  }

  /** Crea o actualiza un proveedor traduciendo el input de dominio al DTO. */
  public async upsertProvider(input: IBotProviderInput): Promise<IBotProviderConfigRead> {
    this.logger?.debug('bot.providers.upsert', { providerKind: input.providerKind });
    const payload = {
      provider_kind: input.providerKind,
      order: input.order,
      enabled: input.enabled,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      prompt_base: input.promptBase ?? '',
    };
    return this.apiClient.upsertBotProvider(payload);
  }

  /** Elimina lógicamente un proveedor de IA del tenant por clave compuesta tipo/orden. */
  public async deleteProvider(providerKind: string, order: number): Promise<void> {
    this.logger?.debug('bot.providers.delete', { providerKind, order });
    await this.apiClient.deleteBotProvider(providerKind, order);
  }

  /** Devuelve las estadísticas de la cola D3 del tenant (monitor de cola). */
  public async getQueueStats(): Promise<IQueueStatsRead> {
    this.logger?.debug('bot.queue.stats', {});
    return this.apiClient.getBotQueueStats();
  }

  /** Devuelve el uso de cuota L1 del tenant (proveedores + agregado). */
  public async getQuotaUsage(): Promise<IQuotaUsageResponse> {
    this.logger?.debug('bot.quota.usage', {});
    return this.apiClient.getBotQuotaUsage();
  }

  /** Prueba el router del bot con un mensaje crudo (sin persistir ni encolar). */
  public async testRouter(message: string): Promise<IRouterTraceRead> {
    this.logger?.debug('bot.router.test', {});
    return this.apiClient.testRouter(message);
  }

  /** Lista las keywords del bot del tenant (paginado). */
  public async listKeywords(query?: IPageQuery): Promise<IPage<IKeywordRead>> {
    this.logger?.debug('keywords.list', {});
    return this.apiClient.listKeywords(query);
  }

  /** Crea una keyword del bot en el tenant activo (término único). */
  public async createKeyword(input: IKeywordInput): Promise<IKeywordRead> {
    this.logger?.debug('keywords.create', { term: input.term });
    return this.apiClient.createKeyword(input);
  }

  /** Actualiza una keyword del bot del tenant activo (PUT). */
  public async updateKeyword(keywordId: string, input: IKeywordInput): Promise<IKeywordRead> {
    this.logger?.debug('keywords.update', { keywordId });
    return this.apiClient.updateKeyword(keywordId, input);
  }

  /** Elimina lógicamente una keyword del bot del tenant activo. */
  public async deleteKeyword(keywordId: string): Promise<void> {
    this.logger?.debug('keywords.delete', { keywordId });
    await this.apiClient.deleteKeyword(keywordId);
  }
}

/**
 * Crea un servicio del bot listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IBotService`.
 */
export function createBotService(apiClient: IApiClient, logger?: ILogger): IBotService {
  return new BackendBotService(apiClient, logger);
}
