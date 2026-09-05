/**
 * Pruebas del servicio del bot (Fase 7).
 *
 * Contrato:
 * - `BackendBotService` traduce inputs de dominio (camelCase) a los DTO del
 *   backend (snake_case) y delega la lectura de conversaciones/mensajes,
 *   proveedores de IA y estadísticas de cola en `IApiClient`.
 * - `upsertProvider` normaliza los opcionales (`undefined` → `null`/`''`).
 * - `createBotService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiHttpError, ApiNetworkError } from '@/api/errors';
import type {
  IBotProviderConfigRead,
  IConversationRead,
  IMessageEnqueueResult,
  IMessageRead,
  IPage,
  IQueueStatsRead,
  IRouterTraceRead,
} from '@/api/types';
import { BackendBotService, createBotService, type IBotProviderInput } from '@/services/botService';
import { makeApiClientMock } from '@/test/apiClientMocks';

/** Identificador de conversación usado en las pruebas. */
const CONVERSATION_ID = '66666666-6666-4666-8666-666666666666';

/** Fábrica de `IBotProviderConfigRead` (DTO exacto del backend, sin secretos). */
function makeProvider(overrides: Partial<IBotProviderConfigRead> = {}): IBotProviderConfigRead {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenant_id: 'tenant-1',
    provider_kind: 'openai',
    order: 0,
    enabled: true,
    model: null,
    temperature: null,
    prompt_base: '',
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

/** Fábrica de `IConversationRead` (DTO exacto del backend). */
function makeConversation(overrides: Partial<IConversationRead> = {}): IConversationRead {
  return {
    id: CONVERSATION_ID,
    tenant_id: 'tenant-1',
    channel_id: '44444444-4444-4444-8444-444444444444',
    external_contact_id: '5215512345678',
    state: 'new',
    ad_campaign_id: null,
    last_message_at: '2026-08-19T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IMessageRead` (DTO exacto del backend). */
function makeMessage(overrides: Partial<IMessageRead> = {}): IMessageRead {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    tenant_id: 'tenant-1',
    conversation_id: CONVERSATION_ID,
    direction: 'inbound',
    content: 'Hola',
    provider_used: null,
    tokens_used: 0,
    message_id: null,
    queue_status: 'processed',
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IQueueStatsRead` (DTO exacto del backend, monitor de cola). */
function makeQueueStats(overrides: Partial<IQueueStatsRead> = {}): IQueueStatsRead {
  return {
    tenant_id: 'tenant-1',
    stream: 'd3:dev-tenant',
    length: 0,
    pending: 0,
    consumer_lag: null,
    dlq_count: 0,
    enqueued: 1,
    processed: 1,
    failed: 0,
    ...overrides,
  };
}

/** Fábrica de `IMessageEnqueueResult` (DTO exacto del backend, 202). */
function makeMessageEnqueueResult(
  overrides: Partial<IMessageEnqueueResult> = {},
): IMessageEnqueueResult {
  return {
    message_id: 'm-1',
    conversation_id: CONVERSATION_ID,
    direction: 'outbound',
    queue_status: 'pending',
    accepted: true,
    ...overrides,
  };
}

/** Fábrica de una página paginada con un solo elemento por defecto. */
function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

describe('BackendBotService', () => {
  describe('listConversations', () => {
    it('delega en el cliente con la query de paginación', async () => {
      const page = makePage([makeConversation()]);
      const apiClient = makeApiClientMock();
      apiClient.listConversations = vi.fn().mockResolvedValue(page);
      const service = new BackendBotService(apiClient);

      const result = await service.listConversations({ page: 1 });

      expect(result).toEqual(page);
      expect(apiClient.listConversations).toHaveBeenCalledWith({ page: 1 });
    });

    it('omite la query cuando no se provee paginación', async () => {
      const page = makePage([]);
      const apiClient = makeApiClientMock();
      apiClient.listConversations = vi.fn().mockResolvedValue(page);
      const service = new BackendBotService(apiClient);

      const result = await service.listConversations();

      expect(result).toEqual(page);
      expect(apiClient.listConversations).toHaveBeenCalledWith(undefined);
    });
  });

  describe('listConversationMessages', () => {
    it('delega en el cliente con el identificador y la query', async () => {
      const page = makePage([makeMessage()]);
      const apiClient = makeApiClientMock();
      apiClient.listConversationMessages = vi.fn().mockResolvedValue(page);
      const service = new BackendBotService(apiClient);

      const result = await service.listConversationMessages(CONVERSATION_ID, { page: 1 });

      expect(result).toEqual(page);
      expect(apiClient.listConversationMessages).toHaveBeenCalledWith(CONVERSATION_ID, {
        page: 1,
      });
    });
  });

  describe('sendConversationMessage', () => {
    it('delega en el cliente traduciendo el contenido al DTO', async () => {
      const result = makeMessageEnqueueResult();
      const apiClient = makeApiClientMock();
      apiClient.sendConversationMessage = vi.fn().mockResolvedValue(result);
      const service = new BackendBotService(apiClient);

      const returned = await service.sendConversationMessage(CONVERSATION_ID, 'Hola');

      expect(returned).toEqual(result);
      expect(apiClient.sendConversationMessage).toHaveBeenCalledWith(CONVERSATION_ID, {
        content: 'Hola',
      });
    });
  });

  describe('listProviders', () => {
    it('delega en el cliente y devuelve los proveedores sin secretos', async () => {
      const providers = [makeProvider()];
      const apiClient = makeApiClientMock();
      apiClient.listBotProviders = vi.fn().mockResolvedValue(providers);
      const service = new BackendBotService(apiClient);

      const result = await service.listProviders();

      expect(result).toEqual(providers);
      expect(apiClient.listBotProviders).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertProvider', () => {
    it('traduce un input mínimo al payload snake_case con opcionales nulos', async () => {
      const saved = makeProvider();
      const apiClient = makeApiClientMock();
      apiClient.upsertBotProvider = vi.fn().mockResolvedValue(saved);
      const service = new BackendBotService(apiClient);

      const result = await service.upsertProvider({
        providerKind: 'openai',
        order: 0,
        enabled: true,
      });

      expect(result).toEqual(saved);
      expect(apiClient.upsertBotProvider).toHaveBeenCalledWith({
        provider_kind: 'openai',
        order: 0,
        enabled: true,
        model: null,
        temperature: null,
        prompt_base: '',
      });
    });

    it('traduce un input con todos los valores explícitos', async () => {
      const saved = makeProvider({
        provider_kind: 'deepseek',
        model: 'deepseek-chat',
        temperature: '0.3',
        prompt_base: 'Eres el asistente de la empresa.',
      });
      const apiClient = makeApiClientMock();
      apiClient.upsertBotProvider = vi.fn().mockResolvedValue(saved);
      const service = new BackendBotService(apiClient);

      await service.upsertProvider({
        providerKind: 'deepseek',
        order: 1,
        enabled: true,
        model: 'deepseek-chat',
        temperature: '0.3',
        promptBase: 'Eres el asistente de la empresa.',
      });

      expect(apiClient.upsertBotProvider).toHaveBeenCalledWith({
        provider_kind: 'deepseek',
        order: 1,
        enabled: true,
        model: 'deepseek-chat',
        temperature: '0.3',
        prompt_base: 'Eres el asistente de la empresa.',
      });
    });

    it('normaliza los opcionales explícitamente nulos a null', async () => {
      const apiClient = makeApiClientMock();
      apiClient.upsertBotProvider = vi.fn().mockResolvedValue(makeProvider());
      const service = new BackendBotService(apiClient);

      await service.upsertProvider({
        providerKind: 'openai',
        order: 0,
        enabled: true,
        model: null,
        temperature: null,
      });

      expect(apiClient.upsertBotProvider).toHaveBeenCalledWith({
        provider_kind: 'openai',
        order: 0,
        enabled: true,
        model: null,
        temperature: null,
        prompt_base: '',
      });
    });

    it('preserva un prompt base en blanco como cadena vacía', async () => {
      const apiClient = makeApiClientMock();
      apiClient.upsertBotProvider = vi.fn().mockResolvedValue(makeProvider());
      const service = new BackendBotService(apiClient);

      await service.upsertProvider({
        providerKind: 'openai',
        order: 0,
        enabled: true,
        promptBase: '',
      });

      expect(apiClient.upsertBotProvider).toHaveBeenCalledWith({
        provider_kind: 'openai',
        order: 0,
        enabled: true,
        model: null,
        temperature: null,
        prompt_base: '',
      });
    });

    it('tipa correctamente la entrada de dominio para el contrato', () => {
      const input: IBotProviderInput = {
        providerKind: 'openai',
        order: 0,
        enabled: true,
      };
      expect(input.providerKind).toBe('openai');
    });
  });

  describe('deleteProvider', () => {
    it('delega en el cliente la eliminación lógica por clave tipo/orden', async () => {
      const apiClient = makeApiClientMock();
      apiClient.deleteBotProvider = vi.fn().mockResolvedValue(undefined);
      const service = new BackendBotService(apiClient);

      await service.deleteProvider('openai', 0);

      expect(apiClient.deleteBotProvider).toHaveBeenCalledWith('openai', 0);
    });
  });

  describe('getQueueStats', () => {
    it('delega en el cliente y devuelve las estadísticas de la cola D3', async () => {
      const stats = makeQueueStats({ length: 3, pending: 1, enqueued: 12, processed: 9 });
      const apiClient = makeApiClientMock();
      apiClient.getBotQueueStats = vi.fn().mockResolvedValue(stats);
      const service = new BackendBotService(apiClient);

      const result = await service.getQueueStats();

      expect(result).toEqual(stats);
      expect(apiClient.getBotQueueStats).toHaveBeenCalledTimes(1);
    });
  });

  describe('testRouter', () => {
    it('delega en el cliente y devuelve la traza del test del router', async () => {
      const trace: IRouterTraceRead = {
        matched_route: 'keyword',
        branch: 'keyword',
        keyword: 'servicio',
        keyword_priority: 100,
        intent: null,
        response: 'Ofrecemos servicios de consultoría.',
        confidence: 1,
        steps: [
          {
            order: 0,
            branch: 'keyword',
            outcome: 'matched',
            detail: 'Keyword "servicio" coincide.',
          },
        ],
      };
      const apiClient = makeApiClientMock();
      apiClient.testRouter = vi.fn().mockResolvedValue(trace);
      const service = new BackendBotService(apiClient);

      const result = await service.testRouter('Necesito servicio');

      expect(result).toEqual(trace);
      expect(apiClient.testRouter).toHaveBeenCalledWith('Necesito servicio');
    });
  });

  it('propaga errores HTTP sin transformarlos', async () => {
    const apiError = new ApiHttpError(
      'No se pudieron cargar las conversaciones.',
      'bot.conversations.list',
      500,
      { detail: 'boom' },
    );
    const apiClient = makeApiClientMock();
    apiClient.listConversations = vi.fn().mockRejectedValue(apiError);
    const service = new BackendBotService(apiClient);

    await expect(service.listConversations()).rejects.toBe(apiError);
  });

  it('propaga errores de red sin envolverlos', async () => {
    const networkError = new ApiNetworkError('bot.queue.stats');
    const apiClient = makeApiClientMock();
    apiClient.getBotQueueStats = vi.fn().mockRejectedValue(networkError);
    const service = new BackendBotService(apiClient);

    await expect(service.getQueueStats()).rejects.toBe(networkError);
  });
});

describe('createBotService', () => {
  it('construye una implementación BackendBotService desde el cliente', () => {
    const apiClient = makeApiClientMock();

    const service = createBotService(apiClient);

    expect(service).toBeInstanceOf(BackendBotService);
  });

  it('delega en el cliente inyectado durante la carga de proveedores', async () => {
    const providers = [makeProvider()];
    const apiClient = makeApiClientMock();
    apiClient.listBotProviders = vi.fn().mockResolvedValue(providers);

    const service = createBotService(apiClient);
    const result = await service.listProviders();

    expect(result).toEqual(providers);
  });
});
