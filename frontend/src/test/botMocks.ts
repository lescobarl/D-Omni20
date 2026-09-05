/**
 * Helpers de prueba compartidos para la sección Bots/Conversaciones (Fase 7):
 * proveedores de IA, conversaciones, mensajes, cola D3 y envío manual.
 *
 * Contrato:
 * - Centraliza las factorías de DTOs y el servicio mock (`IBotService`)
 *   para reutilizarlos en las pruebas del store y de los componentes de Settings.
 * - Cada factoría acepta overrides parciales para construir casos específicos.
 */
import { vi } from 'vitest';
import type {
  IBotProviderConfigRead,
  IConversationRead,
  IKeywordRead,
  IMessageEnqueueResult,
  IMessageRead,
  IPage,
  IQuotaUsageResponse,
  IQueueStatsRead,
  IRouterStepRead,
  IRouterTraceRead,
} from '@/api/types';
import type { IBotService } from '@/services/botService';

/** Construye un proveedor de IA configurado leído del backend (sin secretos). */
export function makeProvider(
  overrides: Partial<IBotProviderConfigRead> = {},
): IBotProviderConfigRead {
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

/** Construye una conversación leída del backend. */
export function makeConversation(overrides: Partial<IConversationRead> = {}): IConversationRead {
  return {
    id: '66666666-6666-4666-8666-666666666666',
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

/** Construye un mensaje de una conversación leído del backend. */
export function makeMessage(overrides: Partial<IMessageRead> = {}): IMessageRead {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    tenant_id: 'tenant-1',
    conversation_id: '66666666-6666-4666-8666-666666666666',
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

/** Construye una keyword del bot con prioridad leída del backend (Fase 3). */
export function makeKeyword(overrides: Partial<IKeywordRead> = {}): IKeywordRead {
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

/** Construye las estadísticas de la cola D3 del tenant leídas del backend. */
export function makeQueueStats(overrides: Partial<IQueueStatsRead> = {}): IQueueStatsRead {
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

/** Construye el uso de cuota L1 del tenant (proveedores + agregado, B.1). */
export function makeQuotaUsage(overrides: Partial<IQuotaUsageResponse> = {}): IQuotaUsageResponse {
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

/** Construye el resultado de encolar un mensaje (envío manual). */
export function makeMessageEnqueueResult(
  overrides: Partial<IMessageEnqueueResult> = {},
): IMessageEnqueueResult {
  return {
    message_id: 'm-1',
    conversation_id: '66666666-6666-4666-8666-666666666666',
    direction: 'outbound',
    queue_status: 'pending',
    accepted: true,
    ...overrides,
  };
}

/** Construye un paso de la traza del router (Fase 4, motor de prueba). */
export function makeRouterStep(overrides: Partial<IRouterStepRead> = {}): IRouterStepRead {
  return {
    order: 0,
    branch: 'keyword',
    outcome: 'matched',
    detail: 'Keyword "servicio" con prioridad 100',
    ...overrides,
  };
}

/** Construye una traza de prueba del router del bot (Fase 4). */
export function makeRouterTrace(overrides: Partial<IRouterTraceRead> = {}): IRouterTraceRead {
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

/** Construye una página del backend con los ítems dados. */
export function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye un servicio de bots con todas las dependencias mockeadas por defecto. */
export function makeService(overrides: Partial<IBotService> = {}): IBotService {
  const base: IBotService = {
    listConversations: vi.fn<IBotService['listConversations']>().mockResolvedValue(makePage([])),
    listConversationMessages: vi
      .fn<IBotService['listConversationMessages']>()
      .mockResolvedValue(makePage([])),
    sendConversationMessage: vi
      .fn<IBotService['sendConversationMessage']>()
      .mockResolvedValue(makeMessageEnqueueResult()),
    listProviders: vi.fn<IBotService['listProviders']>().mockResolvedValue([]),
    upsertProvider: vi.fn<IBotService['upsertProvider']>().mockResolvedValue(makeProvider()),
    deleteProvider: vi.fn<IBotService['deleteProvider']>().mockResolvedValue(undefined),
    getQueueStats: vi.fn<IBotService['getQueueStats']>().mockResolvedValue(makeQueueStats()),
    getQuotaUsage: vi.fn<IBotService['getQuotaUsage']>().mockResolvedValue(makeQuotaUsage()),
    testRouter: vi.fn<IBotService['testRouter']>().mockResolvedValue(makeRouterTrace()),
    listKeywords: vi.fn<IBotService['listKeywords']>().mockResolvedValue(makePage([])),
    createKeyword: vi.fn<IBotService['createKeyword']>().mockResolvedValue(makeKeyword()),
    updateKeyword: vi.fn<IBotService['updateKeyword']>().mockResolvedValue(makeKeyword()),
    deleteKeyword: vi.fn<IBotService['deleteKeyword']>().mockResolvedValue(undefined),
  };
  // Los overrides se envuelven en espías para poder afirmar llamadas sobre
  // cualquier método, no solo sobre los que no se sobrescriben.
  for (const [method, implementation] of Object.entries(overrides) as Array<
    [keyof IBotService, unknown]
  >) {
    if (implementation !== undefined) {
      (base as Record<keyof IBotService, unknown>)[method] = vi.fn(implementation as never);
    }
  }
  return base;
}
