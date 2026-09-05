/**
 * Pruebas del store del bot (Fase 7) — proveedores de IA, conversaciones,
 * mensajes, envío manual, keywords con prioridad y monitor de cola D3.
 *
 * Contrato:
 * - El registro de servicios por DI (`setBotService`/`getBotService`) permite
 *   inyectar la implementación `IBotService` sin acoplar el store.
 * - Cada colección mantiene su propio estado `idle | loading | success | error`.
 * - Sin servicio registrado el store degrada a estado de error.
 * - `upsertProvider` reemplaza por identificador (dedup) y `sendMessage`
 *   refresca mensajes y conversaciones tras encolar el envío manual.
 * - Las keywords se mantienen ordenadas por prioridad ascendente y se
 *   reemplazan/filtran por identificador en cada operación de escritura.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBotService, useBotStore } from '@/store/botStore';
import { AppError } from '@/lib/errors';
import type {
  IBotProviderConfigRead,
  IConversationRead,
  IKeywordRead,
  IMessageEnqueueResult,
  IMessageRead,
  IPage,
  IQueueStatsRead,
  IQuotaUsageResponse,
  IRouterStepRead,
  IRouterTraceRead,
} from '@/api/types';
import type { IBotProviderInput, IBotService, IKeywordInput } from '@/services/botService';

/** Identificador de conversación usado en las pruebas. */
const CONVERSATION_ID = '66666666-6666-4666-8666-666666666666';

/** Construye un proveedor de IA leído del backend (sin secretos). */
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

/** Construye una keyword del bot con prioridad leída del backend (Fase 3). */
function makeKeyword(overrides: Partial<IKeywordRead> = {}): IKeywordRead {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    tenant_id: 'tenant-1',
    term: 'servicio',
    response: 'Ofrecemos servicios de consultoría.',
    priority: 100,
    enabled: true,
    version: 1,
    created_at: '2026-08-19T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

/** Construye una conversación leída del backend. */
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

/** Construye un mensaje leído del backend. */
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

/** Construye las estadísticas de cola D3 leídas del backend. */
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

/** Construye el uso de cuota L1 agregado del tenant. */
function makeQuotaUsage(overrides: Partial<IQuotaUsageResponse> = {}): IQuotaUsageResponse {
  return {
    tenant_id: 'tenant-1',
    period_start: '2026-08-01T00:00:00Z',
    period_end: '2026-08-31T23:59:59Z',
    quota_limit: 100000,
    total_tokens_used: 25000,
    total_percent: 25,
    status: 'ok',
    items: [],
    ...overrides,
  };
}

/** Construye el resultado de un envío manual (202). */
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

/** Construye una página del backend con los ítems dados. */
function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye un paso de la traza del router (Fase 4, motor de prueba). */
function makeRouterStep(overrides: Partial<IRouterStepRead> = {}): IRouterStepRead {
  return {
    order: 0,
    branch: 'keyword',
    outcome: 'matched',
    detail: 'Keyword "servicio" con prioridad 100',
    ...overrides,
  };
}

/** Construye una traza de prueba del router del bot (Fase 4). */
function makeRouterTrace(overrides: Partial<IRouterTraceRead> = {}): IRouterTraceRead {
  return {
    matched_route: 'keyword',
    branch: 'keyword',
    keyword: 'servicio',
    keyword_priority: 100,
    intent: null,
    response: 'Ofrecemos servicios de consultoría.',
    confidence: 1,
    steps: [makeRouterStep()],
    ...overrides,
  };
}

/** Construye un servicio con todas las dependencias mockeadas por defecto. */
function makeService(overrides: Partial<IBotService> = {}): IBotService {
  return {
    listProviders: vi.fn<IBotService['listProviders']>().mockResolvedValue([]),
    upsertProvider: vi.fn<IBotService['upsertProvider']>().mockResolvedValue(makeProvider()),
    deleteProvider: vi.fn<IBotService['deleteProvider']>().mockResolvedValue(undefined),
    listConversations: vi.fn<IBotService['listConversations']>().mockResolvedValue(makePage([])),
    listConversationMessages: vi
      .fn<IBotService['listConversationMessages']>()
      .mockResolvedValue(makePage([])),
    sendConversationMessage: vi
      .fn<IBotService['sendConversationMessage']>()
      .mockResolvedValue(makeMessageEnqueueResult()),
    getQueueStats: vi.fn<IBotService['getQueueStats']>().mockResolvedValue(makeQueueStats()),
    getQuotaUsage: vi.fn<IBotService['getQuotaUsage']>().mockResolvedValue(makeQuotaUsage()),
    listKeywords: vi.fn<IBotService['listKeywords']>().mockResolvedValue(makePage([])),
    createKeyword: vi.fn<IBotService['createKeyword']>().mockResolvedValue(makeKeyword()),
    updateKeyword: vi.fn<IBotService['updateKeyword']>().mockResolvedValue(makeKeyword()),
    deleteKeyword: vi.fn<IBotService['deleteKeyword']>().mockResolvedValue(undefined),
    testRouter: vi.fn<IBotService['testRouter']>().mockResolvedValue(makeRouterTrace()),
    ...overrides,
  };
}

describe('botStore', () => {
  beforeEach(() => {
    useBotStore.getState().reset();
  });

  afterEach(() => {
    useBotStore.getState().reset();
    setBotService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useBotStore.getState();
    expect(state.providers).toEqual([]);
    expect(state.providersStatus).toBe('idle');
    expect(state.providersError).toBeNull();
    expect(state.conversations).toEqual([]);
    expect(state.conversationsStatus).toBe('idle');
    expect(state.conversationsError).toBeNull();
    expect(state.activeConversationId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.messagesStatus).toBe('idle');
    expect(state.messagesError).toBeNull();
    expect(state.sendResult).toBeNull();
    expect(state.sendStatus).toBe('idle');
    expect(state.sendError).toBeNull();
    expect(state.queueStats).toBeNull();
    expect(state.queueStatsStatus).toBe('idle');
    expect(state.queueStatsError).toBeNull();
    expect(state.quotaUsage).toBeNull();
    expect(state.quotaUsageStatus).toBe('idle');
    expect(state.quotaUsageError).toBeNull();
    expect(state.keywords).toEqual([]);
    expect(state.keywordsStatus).toBe('idle');
    expect(state.keywordsError).toBeNull();
    expect(state.routerTrace).toBeNull();
    expect(state.routerStatus).toBe('idle');
    expect(state.routerError).toBeNull();
  });

  describe('proveedores', () => {
    it('carga los proveedores de IA configurados por el tenant', async () => {
      const providers = [makeProvider({ provider_kind: 'deepseek' })];
      setBotService(
        makeService({
          listProviders: vi.fn<IBotService['listProviders']>().mockResolvedValue(providers),
        }),
      );
      await useBotStore.getState().listProviders();
      const state = useBotStore.getState();
      expect(state.providers).toEqual(providers);
      expect(state.providersStatus).toBe('success');
      expect(state.providersError).toBeNull();
    });

    it('pasa a loading mientras la carga de proveedores está pendiente', async () => {
      let resolve!: (value: IBotProviderConfigRead[]) => void;
      const listProviders = vi
        .fn<IBotService['listProviders']>()
        .mockImplementation(() => new Promise<IBotProviderConfigRead[]>((res) => (resolve = res)));
      setBotService(makeService({ listProviders }));
      const pending = useBotStore.getState().listProviders();
      expect(useBotStore.getState().providersStatus).toBe('loading');
      resolve([makeProvider()]);
      await pending;
      expect(useBotStore.getState().providersStatus).toBe('success');
      expect(useBotStore.getState().providers).toEqual([makeProvider()]);
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().listProviders();
      const state = useBotStore.getState();
      expect(state.providersStatus).toBe('error');
      expect(state.providersError).toBe('El servicio de bots no está disponible.');
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      setBotService(
        makeService({
          listProviders: vi
            .fn<IBotService['listProviders']>()
            .mockRejectedValue(
              new AppError('Fallo de proveedores', 'bot.providers.list', { status: 500 }),
            ),
        }),
      );
      await useBotStore.getState().listProviders();
      const state = useBotStore.getState();
      expect(state.providersStatus).toBe('error');
      expect(state.providersError).toBe('Fallo de proveedores');
    });

    it('propaga el mensaje de un Error genérico del servicio', async () => {
      setBotService(
        makeService({
          listProviders: vi
            .fn<IBotService['listProviders']>()
            .mockRejectedValue(new Error('Red caída')),
        }),
      );
      await useBotStore.getState().listProviders();
      expect(useBotStore.getState().providersError).toBe('Red caída');
    });

    it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
      setBotService(
        makeService({
          listProviders: vi
            .fn<IBotService['listProviders']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useBotStore.getState().listProviders();
      const state = useBotStore.getState();
      expect(state.providersStatus).toBe('error');
      expect(state.providersError).toBe('No se pudieron cargar los proveedores.');
    });

    it('guarda un proveedor nuevo y lo agrega a la colección', async () => {
      const input: IBotProviderInput = {
        providerKind: 'deepseek',
        order: 1,
        enabled: true,
        model: 'deepseek-chat',
      };
      const saved = makeProvider({ provider_kind: 'deepseek', order: 1, model: 'deepseek-chat' });
      const upsertProvider = vi.fn<IBotService['upsertProvider']>().mockResolvedValue(saved);
      setBotService(makeService({ upsertProvider }));
      await useBotStore.getState().upsertProvider(input);
      expect(upsertProvider).toHaveBeenCalledWith(input);
      const state = useBotStore.getState();
      expect(state.providers).toEqual([saved]);
      expect(state.providersStatus).toBe('success');
      expect(state.providersError).toBeNull();
    });

    it('reemplaza un proveedor existente por su identificador (dedup)', async () => {
      const existing = makeProvider({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        provider_kind: 'openai',
        order: 0,
      });
      setBotService(
        makeService({
          listProviders: vi.fn<IBotService['listProviders']>().mockResolvedValue([existing]),
        }),
      );
      await useBotStore.getState().listProviders();
      expect(useBotStore.getState().providers).toEqual([existing]);

      const updated = makeProvider({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        provider_kind: 'openai',
        order: 0,
        model: 'gpt-4o',
      });
      setBotService(
        makeService({
          upsertProvider: vi.fn<IBotService['upsertProvider']>().mockResolvedValue(updated),
        }),
      );
      await useBotStore.getState().upsertProvider({
        providerKind: 'openai',
        order: 0,
        enabled: true,
        model: 'gpt-4o',
      });
      const state = useBotStore.getState();
      expect(state.providers).toEqual([updated]);
      expect(state.providers).toHaveLength(1);
    });

    it('degrade a error cuando falla el guardado de un proveedor', async () => {
      setBotService(
        makeService({
          upsertProvider: vi
            .fn<IBotService['upsertProvider']>()
            .mockRejectedValue(new AppError('Fallo al guardar', 'bot.providers.upsert', {})),
        }),
      );
      await useBotStore.getState().upsertProvider({
        providerKind: 'openai',
        order: 0,
        enabled: true,
      });
      const state = useBotStore.getState();
      expect(state.providersStatus).toBe('error');
      expect(state.providersError).toBe('Fallo al guardar');
    });

    it('elimina un proveedor y lo quita de la colección', async () => {
      const provider = makeProvider();
      setBotService(
        makeService({
          listProviders: vi.fn<IBotService['listProviders']>().mockResolvedValue([provider]),
        }),
      );
      await useBotStore.getState().listProviders();
      await useBotStore.getState().deleteProvider(provider.provider_kind, provider.order);
      const state = useBotStore.getState();
      expect(state.providers).toEqual([]);
      expect(state.providersStatus).toBe('success');
      expect(state.providersError).toBeNull();
    });

    it('degrade a error cuando falla la eliminación de un proveedor', async () => {
      setBotService(
        makeService({
          deleteProvider: vi
            .fn<IBotService['deleteProvider']>()
            .mockRejectedValue(new Error('No se pudo borrar')),
        }),
      );
      await useBotStore.getState().deleteProvider('openai', 0);
      const state = useBotStore.getState();
      expect(state.providersStatus).toBe('error');
      expect(state.providersError).toBe('No se pudo borrar');
    });
  });

  describe('conversaciones', () => {
    it('carga las conversaciones del bot del tenant', async () => {
      const conversations = [makeConversation()];
      setBotService(
        makeService({
          listConversations: vi
            .fn<IBotService['listConversations']>()
            .mockResolvedValue(makePage(conversations)),
        }),
      );
      await useBotStore.getState().listConversations();
      const state = useBotStore.getState();
      expect(state.conversations).toEqual(conversations);
      expect(state.conversationsStatus).toBe('success');
      expect(state.conversationsError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().listConversations();
      const state = useBotStore.getState();
      expect(state.conversationsStatus).toBe('error');
      expect(state.conversationsError).toBe('El servicio de bots no está disponible.');
    });

    it('usa un mensaje por defecto cuando falla la carga de conversaciones', async () => {
      setBotService(
        makeService({
          listConversations: vi
            .fn<IBotService['listConversations']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useBotStore.getState().listConversations();
      const state = useBotStore.getState();
      expect(state.conversationsStatus).toBe('error');
      expect(state.conversationsError).toBe('No se pudieron cargar las conversaciones.');
    });
  });

  describe('mensajes', () => {
    it('carga los mensajes de una conversación y la marca como activa', async () => {
      const messages = [makeMessage()];
      const listConversationMessages = vi
        .fn<IBotService['listConversationMessages']>()
        .mockResolvedValue(makePage(messages));
      setBotService(makeService({ listConversationMessages }));
      await useBotStore.getState().loadMessages(CONVERSATION_ID);
      expect(listConversationMessages).toHaveBeenCalledWith(CONVERSATION_ID);
      const state = useBotStore.getState();
      expect(state.activeConversationId).toBe(CONVERSATION_ID);
      expect(state.messages).toEqual(messages);
      expect(state.messagesStatus).toBe('success');
      expect(state.messagesError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().loadMessages(CONVERSATION_ID);
      const state = useBotStore.getState();
      expect(state.messagesStatus).toBe('error');
      expect(state.messagesError).toBe('El servicio de bots no está disponible.');
    });

    it('usa un mensaje por defecto cuando falla la carga de mensajes', async () => {
      setBotService(
        makeService({
          listConversationMessages: vi
            .fn<IBotService['listConversationMessages']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useBotStore.getState().loadMessages(CONVERSATION_ID);
      const state = useBotStore.getState();
      expect(state.messagesStatus).toBe('error');
      expect(state.messagesError).toBe('No se pudieron cargar los mensajes.');
    });
  });

  describe('envío manual', () => {
    it('encola un mensaje y refresca mensajes y conversaciones', async () => {
      const result = makeMessageEnqueueResult();
      const sendConversationMessage = vi
        .fn<IBotService['sendConversationMessage']>()
        .mockResolvedValue(result);
      const listConversationMessages = vi
        .fn<IBotService['listConversationMessages']>()
        .mockResolvedValue(makePage([makeMessage({ content: 'Hola mundo' })]));
      const listConversations = vi
        .fn<IBotService['listConversations']>()
        .mockResolvedValue(makePage([makeConversation()]));
      setBotService(
        makeService({ sendConversationMessage, listConversationMessages, listConversations }),
      );
      await useBotStore.getState().sendMessage(CONVERSATION_ID, 'Hola mundo');
      expect(sendConversationMessage).toHaveBeenCalledWith(CONVERSATION_ID, 'Hola mundo');
      expect(listConversationMessages).toHaveBeenCalledWith(CONVERSATION_ID);
      expect(listConversations).toHaveBeenCalledTimes(1);
      const state = useBotStore.getState();
      expect(state.sendResult).toEqual(result);
      expect(state.sendStatus).toBe('success');
      expect(state.sendError).toBeNull();
      expect(state.messagesStatus).toBe('success');
      expect(state.messages[0]?.content).toBe('Hola mundo');
      expect(state.conversationsStatus).toBe('success');
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().sendMessage(CONVERSATION_ID, 'Hola');
      const state = useBotStore.getState();
      expect(state.sendStatus).toBe('error');
      expect(state.sendError).toBe('El servicio de bots no está disponible.');
    });

    it('usa un mensaje por defecto cuando falla el envío', async () => {
      setBotService(
        makeService({
          sendConversationMessage: vi
            .fn<IBotService['sendConversationMessage']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useBotStore.getState().sendMessage(CONVERSATION_ID, 'Hola');
      const state = useBotStore.getState();
      expect(state.sendStatus).toBe('error');
      expect(state.sendError).toBe('No se pudo enviar el mensaje.');
    });
  });

  describe('monitor de cola', () => {
    it('carga las estadísticas de la cola D3 del tenant', async () => {
      const stats = makeQueueStats({ length: 3, pending: 1, enqueued: 12, processed: 9 });
      setBotService(
        makeService({
          getQueueStats: vi.fn<IBotService['getQueueStats']>().mockResolvedValue(stats),
        }),
      );
      await useBotStore.getState().loadQueueStats();
      const state = useBotStore.getState();
      expect(state.queueStats).toEqual(stats);
      expect(state.queueStatsStatus).toBe('success');
      expect(state.queueStatsError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().loadQueueStats();
      const state = useBotStore.getState();
      expect(state.queueStatsStatus).toBe('error');
      expect(state.queueStatsError).toBe('El servicio de bots no está disponible.');
    });

    it('usa un mensaje por defecto cuando falla la carga de estadísticas', async () => {
      setBotService(
        makeService({
          getQueueStats: vi
            .fn<IBotService['getQueueStats']>()
            .mockRejectedValue(new AppError('Fallo de cola', 'bot.queue.stats', {})),
        }),
      );
      await useBotStore.getState().loadQueueStats();
      const state = useBotStore.getState();
      expect(state.queueStatsStatus).toBe('error');
      expect(state.queueStatsError).toBe('Fallo de cola');
    });
  });

  describe('cuota L1', () => {
    it('carga el uso de cuota L1 del tenant', async () => {
      const usage = makeQuotaUsage({ status: 'warning', total_percent: 60 });
      const getQuotaUsage = vi.fn<IBotService['getQuotaUsage']>().mockResolvedValue(usage);
      setBotService(makeService({ getQuotaUsage }));

      await useBotStore.getState().loadQuotaUsage();

      expect(getQuotaUsage).toHaveBeenCalledTimes(1);
      const state = useBotStore.getState();
      expect(state.quotaUsage).toEqual(usage);
      expect(state.quotaUsageStatus).toBe('success');
      expect(state.quotaUsageError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().loadQuotaUsage();
      const state = useBotStore.getState();
      expect(state.quotaUsageStatus).toBe('error');
      expect(state.quotaUsageError).toBe('El servicio de bots no está disponible.');
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const getQuotaUsage = vi
        .fn<IBotService['getQuotaUsage']>()
        .mockRejectedValue(new AppError('Fallo de cuota', 'bot.quota.usage', {}));
      setBotService(makeService({ getQuotaUsage }));

      await useBotStore.getState().loadQuotaUsage();
      const state = useBotStore.getState();
      expect(state.quotaUsageStatus).toBe('error');
      expect(state.quotaUsageError).toBe('Fallo de cuota');
    });

    it('usa un mensaje por defecto cuando falla la carga de cuota', async () => {
      const getQuotaUsage = vi
        .fn<IBotService['getQuotaUsage']>()
        .mockRejectedValue('respuesta no estructurada');
      setBotService(makeService({ getQuotaUsage }));

      await useBotStore.getState().loadQuotaUsage();
      const state = useBotStore.getState();
      expect(state.quotaUsageStatus).toBe('error');
      expect(state.quotaUsageError).toBe('No se pudo cargar el uso de cuota L1.');
    });
  });

  describe('router (Fase 4)', () => {
    it('prueba el router con un mensaje y guarda la traza', async () => {
      const trace = makeRouterTrace();
      const testRouter = vi.fn<IBotService['testRouter']>().mockResolvedValue(trace);
      setBotService(makeService({ testRouter }));

      await useBotStore.getState().testRouter('Necesito servicio');

      expect(testRouter).toHaveBeenCalledWith('Necesito servicio');
      const state = useBotStore.getState();
      expect(state.routerTrace).toEqual(trace);
      expect(state.routerStatus).toBe('success');
      expect(state.routerError).toBeNull();
    });

    it('pasa a loading mientras el test del router está pendiente', async () => {
      let resolve!: (value: IRouterTraceRead) => void;
      const testRouter = vi
        .fn<IBotService['testRouter']>()
        .mockImplementation(() => new Promise<IRouterTraceRead>((res) => (resolve = res)));
      setBotService(makeService({ testRouter }));
      const pending = useBotStore.getState().testRouter('Hola');
      expect(useBotStore.getState().routerStatus).toBe('loading');
      resolve(makeRouterTrace());
      await pending;
      expect(useBotStore.getState().routerStatus).toBe('success');
      expect(useBotStore.getState().routerTrace).toEqual(makeRouterTrace());
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().testRouter('Hola');
      const state = useBotStore.getState();
      expect(state.routerStatus).toBe('error');
      expect(state.routerError).toBe('El servicio de bots no está disponible.');
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const testRouter = vi
        .fn<IBotService['testRouter']>()
        .mockRejectedValue(new AppError('Fallo de router', 'bot.router.test', {}));
      setBotService(makeService({ testRouter }));

      await useBotStore.getState().testRouter('Hola');
      const state = useBotStore.getState();
      expect(state.routerStatus).toBe('error');
      expect(state.routerError).toBe('Fallo de router');
    });

    it('usa un mensaje por defecto cuando falla el test del router', async () => {
      const testRouter = vi
        .fn<IBotService['testRouter']>()
        .mockRejectedValue('respuesta no estructurada');
      setBotService(makeService({ testRouter }));

      await useBotStore.getState().testRouter('Hola');
      const state = useBotStore.getState();
      expect(state.routerStatus).toBe('error');
      expect(state.routerError).toBe('No se pudo probar el router del bot.');
    });
  });

  describe('keywords', () => {
    it('carga las keywords del bot del tenant ordenadas por prioridad', async () => {
      const keywords = [
        makeKeyword({ term: 'precio', priority: 80 }),
        makeKeyword({ term: 'servicio', priority: 20 }),
      ];
      setBotService(
        makeService({
          listKeywords: vi.fn<IBotService['listKeywords']>().mockResolvedValue(makePage(keywords)),
        }),
      );
      await useBotStore.getState().listKeywords();
      const state = useBotStore.getState();
      expect(state.keywords).toEqual([
        makeKeyword({ term: 'servicio', priority: 20 }),
        makeKeyword({ term: 'precio', priority: 80 }),
      ]);
      expect(state.keywords[0]?.priority).toBe(20);
      expect(state.keywords[1]?.priority).toBe(80);
      expect(state.keywordsStatus).toBe('success');
      expect(state.keywordsError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useBotStore.getState().listKeywords();
      const state = useBotStore.getState();
      expect(state.keywordsStatus).toBe('error');
      expect(state.keywordsError).toBe('El servicio de bots no está disponible.');
    });

    it('usa un mensaje por defecto cuando falla la carga de keywords', async () => {
      setBotService(
        makeService({
          listKeywords: vi
            .fn<IBotService['listKeywords']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useBotStore.getState().listKeywords();
      const state = useBotStore.getState();
      expect(state.keywordsStatus).toBe('error');
      expect(state.keywordsError).toBe('No se pudieron cargar las keywords.');
    });

    it('guarda una keyword nueva y la agrega a la colección', async () => {
      const input: IKeywordInput = {
        term: 'precio',
        response: 'Ver tarifas.',
        priority: 10,
        enabled: true,
      };
      const saved = makeKeyword({ term: 'precio', response: 'Ver tarifas.', priority: 10 });
      const createKeyword = vi.fn<IBotService['createKeyword']>().mockResolvedValue(saved);
      setBotService(makeService({ createKeyword }));
      await useBotStore.getState().createKeyword(input);
      expect(createKeyword).toHaveBeenCalledWith(input);
      const state = useBotStore.getState();
      expect(state.keywords).toEqual([saved]);
      expect(state.keywordsStatus).toBe('success');
      expect(state.keywordsError).toBeNull();
    });

    it('reemplaza una keyword existente por su identificador (dedup)', async () => {
      const existing = makeKeyword({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        term: 'servicio',
        priority: 100,
      });
      setBotService(
        makeService({
          listKeywords: vi
            .fn<IBotService['listKeywords']>()
            .mockResolvedValue(makePage([existing])),
        }),
      );
      await useBotStore.getState().listKeywords();
      expect(useBotStore.getState().keywords).toEqual([existing]);

      const updated = makeKeyword({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        term: 'servicio',
        priority: 30,
      });
      setBotService(
        makeService({
          updateKeyword: vi.fn<IBotService['updateKeyword']>().mockResolvedValue(updated),
        }),
      );
      await useBotStore.getState().updateKeyword(updated.id, {
        term: 'servicio',
        response: updated.response,
        priority: 30,
        enabled: true,
      });
      const state = useBotStore.getState();
      expect(state.keywords).toEqual([updated]);
      expect(state.keywords).toHaveLength(1);
    });

    it('degrade a error cuando falla el guardado de una keyword', async () => {
      setBotService(
        makeService({
          createKeyword: vi
            .fn<IBotService['createKeyword']>()
            .mockRejectedValue(new AppError('Fallo al guardar', 'bot.keywords.create', {})),
        }),
      );
      await useBotStore.getState().createKeyword({
        term: 'precio',
        response: 'Ver tarifas.',
        priority: 10,
        enabled: true,
      });
      const state = useBotStore.getState();
      expect(state.keywordsStatus).toBe('error');
      expect(state.keywordsError).toBe('Fallo al guardar');
    });

    it('elimina una keyword y la quita de la colección', async () => {
      const keyword = makeKeyword();
      setBotService(
        makeService({
          listKeywords: vi.fn<IBotService['listKeywords']>().mockResolvedValue(makePage([keyword])),
        }),
      );
      await useBotStore.getState().listKeywords();
      await useBotStore.getState().deleteKeyword(keyword.id);
      const state = useBotStore.getState();
      expect(state.keywords).toEqual([]);
      expect(state.keywordsStatus).toBe('success');
      expect(state.keywordsError).toBeNull();
    });

    it('degrade a error cuando falla la eliminación de una keyword', async () => {
      setBotService(
        makeService({
          deleteKeyword: vi
            .fn<IBotService['deleteKeyword']>()
            .mockRejectedValue(new Error('No se pudo borrar')),
        }),
      );
      await useBotStore.getState().deleteKeyword('88888888-8888-4888-8888-888888888888');
      const state = useBotStore.getState();
      expect(state.keywordsStatus).toBe('error');
      expect(state.keywordsError).toBe('No se pudo borrar');
    });
  });

  it('reset descarta el estado y vuelve al inicial por defecto', async () => {
    setBotService(makeService());
    await useBotStore.getState().listProviders();
    await useBotStore.getState().listConversations();
    await useBotStore.getState().loadMessages(CONVERSATION_ID);
    await useBotStore.getState().sendMessage(CONVERSATION_ID, 'Hola');
    await useBotStore.getState().listKeywords();
    await useBotStore.getState().loadQueueStats();
    await useBotStore.getState().loadQuotaUsage();
    await useBotStore.getState().testRouter('Hola');
    expect(useBotStore.getState().providersStatus).toBe('success');

    useBotStore.getState().reset();
    const state = useBotStore.getState();
    expect(state.providers).toEqual([]);
    expect(state.providersStatus).toBe('idle');
    expect(state.providersError).toBeNull();
    expect(state.conversations).toEqual([]);
    expect(state.conversationsStatus).toBe('idle');
    expect(state.activeConversationId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.messagesStatus).toBe('idle');
    expect(state.sendResult).toBeNull();
    expect(state.sendStatus).toBe('idle');
    expect(state.keywords).toEqual([]);
    expect(state.keywordsStatus).toBe('idle');
    expect(state.keywordsError).toBeNull();
    expect(state.queueStats).toBeNull();
    expect(state.queueStatsStatus).toBe('idle');
    expect(state.quotaUsage).toBeNull();
    expect(state.quotaUsageStatus).toBe('idle');
    expect(state.routerTrace).toBeNull();
    expect(state.routerStatus).toBe('idle');
    expect(state.routerError).toBeNull();
  });
});
