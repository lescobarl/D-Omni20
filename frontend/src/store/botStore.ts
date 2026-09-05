/**
 * Store del bot (Fase 7) — proveedores de IA, conversaciones, mensajes,
 * envío manual y monitor de cola D3.
 *
 * Contrato:
 * - Registro de servicios por DI: `setBotService`/`getBotService` inyectan la
 *   implementación `IBotService` desde el composition root (`main.tsx`),
 *   activada por la feature flag `bots`.
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error
 *   para que la UI conviva sin la dependencia (p. ej. en pruebas).
 * - Cada colección (proveedores, conversaciones, mensajes, cola) mantiene su
 *   propio estado de carga para no bloquear subsecciones independientes.
 */
import { create } from 'zustand';
import type {
  IBotProviderConfigRead,
  IConversationRead,
  IKeywordRead,
  IMessageEnqueueResult,
  IMessageRead,
  IQueueStatsRead,
  IQuotaUsageResponse,
  IRouterTraceRead,
} from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IBotProviderInput, IBotService, IKeywordInput } from '@/services/botService';

/** Estado de un flujo del bot. */
export type BotStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store del bot (Fase 7). */
export interface IBotState {
  /** Proveedores de IA configurados por el tenant. */
  providers: IBotProviderConfigRead[];
  /** Estado del flujo de proveedores. */
  providersStatus: BotStatus;
  /** Mensaje del último error del flujo de proveedores (o `null`). */
  providersError: string | null;

  /** Conversaciones del bot del tenant. */
  conversations: IConversationRead[];
  /** Estado del flujo de conversaciones. */
  conversationsStatus: BotStatus;
  /** Mensaje del último error del flujo de conversaciones (o `null`). */
  conversationsError: string | null;

  /** Identificador de la conversación con mensajes cargados (o `null`). */
  activeConversationId: string | null;
  /** Mensajes de la conversación activa. */
  messages: IMessageRead[];
  /** Estado del flujo de mensajes. */
  messagesStatus: BotStatus;
  /** Mensaje del último error del flujo de mensajes (o `null`). */
  messagesError: string | null;

  /** Resultado del último envío manual (o `null`). */
  sendResult: IMessageEnqueueResult | null;
  /** Estado del flujo de envío manual. */
  sendStatus: BotStatus;
  /** Mensaje del último error del flujo de envío manual (o `null`). */
  sendError: string | null;

  /** Estadísticas de la cola D3 del tenant (monitor de cola). */
  queueStats: IQueueStatsRead | null;
  /** Estado del flujo del monitor de cola. */
  queueStatsStatus: BotStatus;
  /** Mensaje del último error del flujo del monitor de cola (o `null`). */
  queueStatsError: string | null;

  /** Uso de cuota L1 del tenant (proveedores + agregado). */
  quotaUsage: IQuotaUsageResponse | null;
  /** Estado del flujo de cuota L1. */
  quotaUsageStatus: BotStatus;
  /** Mensaje del último error del flujo de cuota L1 (o `null`). */
  quotaUsageError: string | null;

  /** Keywords con prioridad del bot (Fase 3), ordenadas por prioridad. */
  keywords: IKeywordRead[];
  /** Estado del flujo de keywords. */
  keywordsStatus: BotStatus;
  /** Mensaje del último error del flujo de keywords (o `null`). */
  keywordsError: string | null;

  /** Traza del último test del router del bot (Fase 4) (o `null`). */
  routerTrace: IRouterTraceRead | null;
  /** Estado del flujo de prueba del router. */
  routerStatus: BotStatus;
  /** Mensaje del último error del flujo de prueba del router (o `null`). */
  routerError: string | null;

  /** Carga los proveedores de IA configurados por el tenant. */
  listProviders(): Promise<void>;
  /** Crea o actualiza un proveedor de IA y refresca la colección. */
  upsertProvider(input: IBotProviderInput): Promise<void>;
  /** Elimina un proveedor de IA (por clave compuesta tipo/orden) y lo quita de la colección. */
  deleteProvider(providerKind: string, order: number): Promise<void>;

  /** Carga las conversaciones del bot del tenant. */
  listConversations(): Promise<void>;
  /** Carga los mensajes de una conversación y la marca como activa. */
  loadMessages(conversationId: string): Promise<void>;
  /** Envía un mensaje de prueba a la cola D3 (202) y refresca los mensajes. */
  sendMessage(conversationId: string, content: string): Promise<void>;

  /** Carga las keywords del bot ordenadas por prioridad (menor = más prioritario). */
  listKeywords(): Promise<void>;
  /** Crea una keyword y refresca la colección ordenada por prioridad. */
  createKeyword(input: IKeywordInput): Promise<void>;
  /** Actualiza una keyword y refresca la colección ordenada por prioridad. */
  updateKeyword(keywordId: string, input: IKeywordInput): Promise<void>;
  /** Elimina una keyword y la quita de la colección. */
  deleteKeyword(keywordId: string): Promise<void>;
  /** Ejecuta el test del router con un mensaje (Fase 4) sin encolar ni persistir. */
  testRouter(message: string): Promise<void>;

  /** Carga las estadísticas de la cola D3 del tenant (monitor de cola). */
  loadQueueStats(): Promise<void>;
  /** Carga el uso de cuota L1 del tenant (proveedores + agregado). */
  loadQuotaUsage(): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IBotService | null = null;

/**
 * Registra la implementación del servicio del bot (composition root).
 * @param implementation - Implementación de `IBotService` (o `null` en pruebas).
 */
export function setBotService(implementation: IBotService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio del bot (o `null`). */
export function getBotService(): IBotService | null {
  return service;
}

/** Extrae el mensaje de un error siguiendo la cadena AppError → Error → por defecto. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Store global del bot (Fase 7). */
export const useBotStore = create<IBotState>()((set, get) => ({
  providers: [],
  providersStatus: 'idle',
  providersError: null,

  conversations: [],
  conversationsStatus: 'idle',
  conversationsError: null,

  activeConversationId: null,
  messages: [],
  messagesStatus: 'idle',
  messagesError: null,

  sendResult: null,
  sendStatus: 'idle',
  sendError: null,

  queueStats: null,
  queueStatsStatus: 'idle',
  queueStatsError: null,

  quotaUsage: null,
  quotaUsageStatus: 'idle',
  quotaUsageError: null,

  keywords: [],
  keywordsStatus: 'idle',
  keywordsError: null,

  routerTrace: null,
  routerStatus: 'idle',
  routerError: null,

  listProviders: async () => {
    if (service === null) {
      set({
        providersStatus: 'error',
        providersError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ providersStatus: 'loading', providersError: null });
    try {
      const providers = await service.listProviders();
      set({ providers, providersStatus: 'success', providersError: null });
    } catch (error) {
      set({
        providersStatus: 'error',
        providersError: extractErrorMessage(error, 'No se pudieron cargar los proveedores.'),
      });
    }
  },

  upsertProvider: async (input: IBotProviderInput) => {
    if (service === null) {
      set({
        providersStatus: 'error',
        providersError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ providersStatus: 'loading', providersError: null });
    try {
      const provider = await service.upsertProvider(input);
      set({
        providers: [...get().providers.filter((current) => current.id !== provider.id), provider],
        providersStatus: 'success',
        providersError: null,
      });
    } catch (error) {
      set({
        providersStatus: 'error',
        providersError: extractErrorMessage(error, 'No se pudo guardar el proveedor.'),
      });
    }
  },

  deleteProvider: async (providerKind: string, order: number) => {
    if (service === null) {
      set({
        providersStatus: 'error',
        providersError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ providersStatus: 'loading', providersError: null });
    try {
      await service.deleteProvider(providerKind, order);
      set({
        providers: get().providers.filter(
          (current) => current.provider_kind !== providerKind || current.order !== order,
        ),
        providersStatus: 'success',
        providersError: null,
      });
    } catch (error) {
      set({
        providersStatus: 'error',
        providersError: extractErrorMessage(error, 'No se pudo eliminar el proveedor.'),
      });
    }
  },

  listConversations: async () => {
    if (service === null) {
      set({
        conversationsStatus: 'error',
        conversationsError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ conversationsStatus: 'loading', conversationsError: null });
    try {
      const page = await service.listConversations();
      set({ conversations: page.items, conversationsStatus: 'success', conversationsError: null });
    } catch (error) {
      set({
        conversationsStatus: 'error',
        conversationsError: extractErrorMessage(error, 'No se pudieron cargar las conversaciones.'),
      });
    }
  },

  loadMessages: async (conversationId: string) => {
    if (service === null) {
      set({
        messagesStatus: 'error',
        messagesError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ messagesStatus: 'loading', messagesError: null, activeConversationId: conversationId });
    try {
      const page = await service.listConversationMessages(conversationId);
      set({
        messages: page.items,
        messagesStatus: 'success',
        messagesError: null,
        activeConversationId: conversationId,
      });
    } catch (error) {
      set({
        messagesStatus: 'error',
        messagesError: extractErrorMessage(error, 'No se pudieron cargar los mensajes.'),
      });
    }
  },

  sendMessage: async (conversationId: string, content: string) => {
    if (service === null) {
      set({
        sendStatus: 'error',
        sendError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ sendStatus: 'loading', sendError: null });
    try {
      const result = await service.sendConversationMessage(conversationId, content);
      set({ sendResult: result, sendStatus: 'success', sendError: null });
      // Refresca la conversación y sus mensajes tras encolar el envío manual.
      await get().loadMessages(conversationId);
      await get().listConversations();
    } catch (error) {
      set({
        sendStatus: 'error',
        sendError: extractErrorMessage(error, 'No se pudo enviar el mensaje.'),
      });
    }
  },

  listKeywords: async () => {
    if (service === null) {
      set({
        keywordsStatus: 'error',
        keywordsError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ keywordsStatus: 'loading', keywordsError: null });
    try {
      const page = await service.listKeywords();
      set({
        keywords: page.items.sort((a, b) => a.priority - b.priority),
        keywordsStatus: 'success',
        keywordsError: null,
      });
    } catch (error) {
      set({
        keywordsStatus: 'error',
        keywordsError: extractErrorMessage(error, 'No se pudieron cargar las keywords.'),
      });
    }
  },

  createKeyword: async (input: IKeywordInput) => {
    if (service === null) {
      set({
        keywordsStatus: 'error',
        keywordsError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ keywordsStatus: 'loading', keywordsError: null });
    try {
      const keyword = await service.createKeyword(input);
      set({
        keywords: [...get().keywords.filter((current) => current.id !== keyword.id), keyword].sort(
          (a, b) => a.priority - b.priority,
        ),
        keywordsStatus: 'success',
        keywordsError: null,
      });
    } catch (error) {
      set({
        keywordsStatus: 'error',
        keywordsError: extractErrorMessage(error, 'No se pudo guardar la keyword.'),
      });
    }
  },

  updateKeyword: async (keywordId: string, input: IKeywordInput) => {
    if (service === null) {
      set({
        keywordsStatus: 'error',
        keywordsError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ keywordsStatus: 'loading', keywordsError: null });
    try {
      const keyword = await service.updateKeyword(keywordId, input);
      set({
        keywords: [...get().keywords.filter((current) => current.id !== keyword.id), keyword].sort(
          (a, b) => a.priority - b.priority,
        ),
        keywordsStatus: 'success',
        keywordsError: null,
      });
    } catch (error) {
      set({
        keywordsStatus: 'error',
        keywordsError: extractErrorMessage(error, 'No se pudo actualizar la keyword.'),
      });
    }
  },

  deleteKeyword: async (keywordId: string) => {
    if (service === null) {
      set({
        keywordsStatus: 'error',
        keywordsError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ keywordsStatus: 'loading', keywordsError: null });
    try {
      await service.deleteKeyword(keywordId);
      set({
        keywords: get().keywords.filter((current) => current.id !== keywordId),
        keywordsStatus: 'success',
        keywordsError: null,
      });
    } catch (error) {
      set({
        keywordsStatus: 'error',
        keywordsError: extractErrorMessage(error, 'No se pudo eliminar la keyword.'),
      });
    }
  },

  testRouter: async (message: string) => {
    if (service === null) {
      set({
        routerStatus: 'error',
        routerError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ routerStatus: 'loading', routerError: null });
    try {
      const routerTrace = await service.testRouter(message);
      set({ routerTrace, routerStatus: 'success', routerError: null });
    } catch (error) {
      set({
        routerStatus: 'error',
        routerError: extractErrorMessage(error, 'No se pudo probar el router del bot.'),
      });
    }
  },

  loadQueueStats: async () => {
    if (service === null) {
      set({
        queueStatsStatus: 'error',
        queueStatsError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ queueStatsStatus: 'loading', queueStatsError: null });
    try {
      const queueStats = await service.getQueueStats();
      set({ queueStats, queueStatsStatus: 'success', queueStatsError: null });
    } catch (error) {
      set({
        queueStatsStatus: 'error',
        queueStatsError: extractErrorMessage(
          error,
          'No se pudieron cargar las estadísticas de cola.',
        ),
      });
    }
  },

  loadQuotaUsage: async () => {
    if (service === null) {
      set({
        quotaUsageStatus: 'error',
        quotaUsageError: 'El servicio de bots no está disponible.',
      });
      return;
    }
    set({ quotaUsageStatus: 'loading', quotaUsageError: null });
    try {
      const quotaUsage = await service.getQuotaUsage();
      set({ quotaUsage, quotaUsageStatus: 'success', quotaUsageError: null });
    } catch (error) {
      set({
        quotaUsageStatus: 'error',
        quotaUsageError: extractErrorMessage(error, 'No se pudo cargar el uso de cuota L1.'),
      });
    }
  },

  reset: () =>
    set({
      providers: [],
      providersStatus: 'idle',
      providersError: null,
      conversations: [],
      conversationsStatus: 'idle',
      conversationsError: null,
      activeConversationId: null,
      messages: [],
      messagesStatus: 'idle',
      messagesError: null,
      sendResult: null,
      sendStatus: 'idle',
      sendError: null,
      queueStats: null,
      queueStatsStatus: 'idle',
      queueStatsError: null,
      quotaUsage: null,
      quotaUsageStatus: 'idle',
      quotaUsageError: null,
      keywords: [],
      keywordsStatus: 'idle',
      keywordsError: null,
      routerTrace: null,
      routerStatus: 'idle',
      routerError: null,
    }),
}));
