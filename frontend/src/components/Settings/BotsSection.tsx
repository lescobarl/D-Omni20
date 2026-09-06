/**
 * Sección "Bots" del configurador del tenant (Fase 7).
 *
 * Contrato:
 * - Configuración de proveedores de IA por empresa (orden + modelo + prompt).
 * - Visor de conversaciones con mensajes expandibles y envío manual de prueba a
 *   la cola D3 (202 Accepted).
 * - Test del router (Fase 4): enruta un mensaje sin encolar ni persistir.
 * - Monitor de cola D3 del tenant (estadísticas combinadas BD + Redis).
 * - Sección autocontenida: carga proveedores, conversaciones y cola al montar.
 * - Los errores del store se reflejan en `aria-live` accesibles por subsección.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type {
  IAdCampaignRead,
  IBotProviderConfigRead,
  IConversationRead,
  IKeywordRead,
} from '@/api/types';
import type { IBotProviderInput, IKeywordInput } from '@/services/botService';
import { useAdsStore } from '@/store/adsStore';
import { useBotStore } from '@/store/botStore';

/** Estado del formulario de un proveedor de IA. */
interface IProviderFormState {
  /** Tipo de proveedor (máx. 16 caracteres). */
  providerKind: string;
  /** Orden de resolución entre proveedores (>= 0). */
  order: string;
  /** Indica si el proveedor está habilitado. */
  enabled: boolean;
  /** Modelo opcional del proveedor. */
  model: string;
  /** Temperatura opcional legible como decimal. */
  temperature: string;
  /** Prompt base opcional del proveedor. */
  promptBase: string;
}

const EMPTY_PROVIDER_FORM: IProviderFormState = {
  providerKind: '',
  order: '0',
  enabled: true,
  model: '',
  temperature: '',
  promptBase: '',
};

/** Estado del formulario de una keyword con prioridad. */
interface IKeywordFormState {
  /** Término clave que activa la respuesta (máx. 255 caracteres). */
  term: string;
  /** Respuesta inteligente asociada al término (máx. 2000 caracteres). */
  response: string;
  /** Prioridad de coincidencia (0-1000, menor = más prioritario). */
  priority: string;
  /** Indica si la keyword está habilitada. */
  enabled: boolean;
}

const EMPTY_KEYWORD_FORM: IKeywordFormState = {
  term: '',
  response: '',
  priority: '100',
  enabled: true,
};

/** Valor visible de un campo opcional (null/undefined/vacío → "—"). */
function formatNullable(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') {
    return '—';
  }
  return value;
}

/** Traduce un proveedor leído (snake_case) a la entrada de dominio (camelCase). */
function providerToInput(provider: IBotProviderConfigRead): IBotProviderInput {
  return {
    providerKind: provider.provider_kind,
    order: provider.order,
    enabled: provider.enabled,
    model: provider.model,
    temperature: provider.temperature,
    promptBase: provider.prompt_base,
  };
}

/** Traduce una keyword leída a la entrada de dominio (mismos nombres de campo). */
function keywordToInput(keyword: IKeywordRead): IKeywordInput {
  return {
    term: keyword.term,
    response: keyword.response,
    priority: keyword.priority,
    enabled: keyword.enabled,
  };
}

/**
 * Resuelve el nombre de la campaña publicitaria que originó una conversación.
 * @param adCampaignId - Identificador de la campaña (procedencia del lead).
 * @param adCampaigns - Campañas publicitarias cargadas del tenant.
 * @returns El nombre de la campaña o `null` si no se pudo resolver.
 */
function campaignNameFor(
  adCampaignId: string | null | undefined,
  adCampaigns: IAdCampaignRead[],
): string | null {
  if (adCampaignId === null || adCampaignId === undefined) {
    return null;
  }
  const campaign = adCampaigns.find((item) => item.id === adCampaignId);
  return campaign !== undefined ? campaign.name : null;
}

/**
 * Sección de bots con proveedores, conversaciones y monitor de cola.
 *
 * @example
 * ```tsx
 * <BotsSection />
 * ```
 *
 * @returns Los sub-paneles de proveedores, conversaciones y cola D3.
 */
export function BotsSection(): ReactElement {
  const providers = useBotStore((state) => state.providers);
  const providersStatus = useBotStore((state) => state.providersStatus);
  const providersError = useBotStore((state) => state.providersError);
  const listProviders = useBotStore((state) => state.listProviders);
  const upsertProvider = useBotStore((state) => state.upsertProvider);
  const deleteProvider = useBotStore((state) => state.deleteProvider);

  const conversations = useBotStore((state) => state.conversations);
  const conversationsStatus = useBotStore((state) => state.conversationsStatus);
  const conversationsError = useBotStore((state) => state.conversationsError);
  const listConversations = useBotStore((state) => state.listConversations);
  const activeConversationId = useBotStore((state) => state.activeConversationId);
  const messages = useBotStore((state) => state.messages);
  const messagesStatus = useBotStore((state) => state.messagesStatus);
  const messagesError = useBotStore((state) => state.messagesError);
  const loadMessages = useBotStore((state) => state.loadMessages);
  const sendResult = useBotStore((state) => state.sendResult);
  const sendStatus = useBotStore((state) => state.sendStatus);
  const sendError = useBotStore((state) => state.sendError);
  const sendMessage = useBotStore((state) => state.sendMessage);

  const queueStats = useBotStore((state) => state.queueStats);
  const queueStatsStatus = useBotStore((state) => state.queueStatsStatus);
  const queueStatsError = useBotStore((state) => state.queueStatsError);
  const loadQueueStats = useBotStore((state) => state.loadQueueStats);

  // Procedencia del lead (eslabón ① → ③): campañas publicitarias del tenant para
  // resolver el nombre de la campaña que originó cada conversación. Best-effort:
  // si el subsistema de captación no está disponible, la UI degrada sin romperse.
  const adCampaigns = useAdsStore((state) => state.adCampaigns);
  const listAdCampaigns = useAdsStore((state) => state.listAdCampaigns);

  const keywords = useBotStore((state) => state.keywords);
  const keywordsStatus = useBotStore((state) => state.keywordsStatus);
  const keywordsError = useBotStore((state) => state.keywordsError);
  const listKeywords = useBotStore((state) => state.listKeywords);
  const createKeyword = useBotStore((state) => state.createKeyword);
  const updateKeyword = useBotStore((state) => state.updateKeyword);
  const deleteKeyword = useBotStore((state) => state.deleteKeyword);

  const routerTrace = useBotStore((state) => state.routerTrace);
  const routerStatus = useBotStore((state) => state.routerStatus);
  const routerError = useBotStore((state) => state.routerError);
  const testRouter = useBotStore((state) => state.testRouter);

  const [providerForm, setProviderForm] = useState<IProviderFormState>(EMPTY_PROVIDER_FORM);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [sendContent, setSendContent] = useState('');
  const [sendFormError, setSendFormError] = useState<string | null>(null);
  const [keywordForm, setKeywordForm] = useState<IKeywordFormState>(EMPTY_KEYWORD_FORM);
  const [keywordFormError, setKeywordFormError] = useState<string | null>(null);
  const [editingKeywordId, setEditingKeywordId] = useState<string | null>(null);
  const [routerMessage, setRouterMessage] = useState('');
  const [routerFormError, setRouterFormError] = useState<string | null>(null);

  // Sección autocontenida: carga proveedores, conversaciones, keywords y cola al montar.
  useEffect(() => {
    void listProviders();
    void listConversations();
    void listKeywords();
    void loadQueueStats();
  }, [listProviders, listConversations, listKeywords, loadQueueStats]);

  // Carga las campañas publicitarias del tenant (best-effort) para resolver la
  // procedencia de cada conversación. No bloquea el resto de la sección.
  useEffect(() => {
    void listAdCampaigns();
  }, [listAdCampaigns]);

  const setProviderField = <K extends keyof IProviderFormState>(
    key: K,
    value: IProviderFormState[K],
  ): void => {
    setProviderForm((current) => ({ ...current, [key]: value }));
    setProviderFormError(null);
  };

  const resetProviderForm = (): void => {
    setProviderForm(EMPTY_PROVIDER_FORM);
    setProviderFormError(null);
  };

  const handleProviderSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const providerKind = providerForm.providerKind.trim();
    if (providerKind === '') {
      setProviderFormError('El tipo de proveedor es obligatorio.');
      return;
    }
    if (providerKind.length > 16) {
      setProviderFormError('El tipo de proveedor debe tener como máximo 16 caracteres.');
      return;
    }
    const order = Number(providerForm.order);
    if (!Number.isInteger(order) || order < 0) {
      setProviderFormError('El orden debe ser un entero mayor o igual a 0.');
      return;
    }
    const input: IBotProviderInput = {
      providerKind,
      order,
      enabled: providerForm.enabled,
      model: providerForm.model.trim() === '' ? null : providerForm.model,
      temperature: providerForm.temperature.trim() === '' ? null : providerForm.temperature,
      promptBase: providerForm.promptBase,
    };
    await upsertProvider(input);
    resetProviderForm();
  };

  const handleToggleProvider = async (provider: IBotProviderConfigRead): Promise<void> => {
    await upsertProvider({ ...providerToInput(provider), enabled: !provider.enabled });
  };

  const handleDeleteProvider = async (provider: IBotProviderConfigRead): Promise<void> => {
    await deleteProvider(provider.provider_kind, provider.order);
  };

  const handleSelectConversation = async (conversation: IConversationRead): Promise<void> => {
    if (activeConversationId === conversation.id) {
      return;
    }
    setSendContent('');
    setSendFormError(null);
    await loadMessages(conversation.id);
  };

  const handleSendSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (activeConversationId === null) {
      setSendFormError('Selecciona una conversación antes de enviar.');
      return;
    }
    const content = sendContent.trim();
    if (content === '') {
      setSendFormError('El mensaje no puede estar vacío.');
      return;
    }
    await sendMessage(activeConversationId, content);
    setSendContent('');
    setSendFormError(null);
  };

  const setKeywordField = <K extends keyof IKeywordFormState>(
    key: K,
    value: IKeywordFormState[K],
  ): void => {
    setKeywordForm((current) => ({ ...current, [key]: value }));
    setKeywordFormError(null);
  };

  const resetKeywordForm = (): void => {
    setKeywordForm(EMPTY_KEYWORD_FORM);
    setKeywordFormError(null);
    setEditingKeywordId(null);
  };

  const handleKeywordSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const term = keywordForm.term.trim();
    if (term === '') {
      setKeywordFormError('El término es obligatorio.');
      return;
    }
    if (term.length > 255) {
      setKeywordFormError('El término debe tener como máximo 255 caracteres.');
      return;
    }
    const response = keywordForm.response.trim();
    if (response === '') {
      setKeywordFormError('La respuesta es obligatoria.');
      return;
    }
    if (response.length > 2000) {
      setKeywordFormError('La respuesta debe tener como máximo 2000 caracteres.');
      return;
    }
    const priority = Number(keywordForm.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      setKeywordFormError('La prioridad debe ser un entero entre 0 y 1000.');
      return;
    }
    const input: IKeywordInput = {
      term,
      response,
      priority,
      enabled: keywordForm.enabled,
    };
    if (editingKeywordId === null) {
      await createKeyword(input);
    } else {
      await updateKeyword(editingKeywordId, input);
    }
    resetKeywordForm();
  };

  const handleEditKeyword = (keyword: IKeywordRead): void => {
    setKeywordForm({
      term: keyword.term,
      response: keyword.response,
      priority: String(keyword.priority),
      enabled: keyword.enabled,
    });
    setKeywordFormError(null);
    setEditingKeywordId(keyword.id);
  };

  const handleToggleKeyword = async (keyword: IKeywordRead): Promise<void> => {
    await updateKeyword(keyword.id, { ...keywordToInput(keyword), enabled: !keyword.enabled });
  };

  const handleDeleteKeyword = async (keyword: IKeywordRead): Promise<void> => {
    await deleteKeyword(keyword.id);
  };

  const handleRouterSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const message = routerMessage.trim();
    if (message === '') {
      setRouterFormError('Escribe un mensaje para probar el router.');
      return;
    }
    if (message.length > 4000) {
      setRouterFormError('El mensaje no puede superar los 4000 caracteres.');
      return;
    }
    setRouterFormError(null);
    await testRouter(message);
  };

  const isProvidersLoading = providersStatus === 'loading' && providers.length === 0;
  const isConversationsLoading = conversationsStatus === 'loading' && conversations.length === 0;
  const isQueueStatsLoading = queueStatsStatus === 'loading' && queueStats === null;
  const isKeywordsLoading = keywordsStatus === 'loading' && keywords.length === 0;

  return (
    <section aria-labelledby="bots-heading">
      <h2 id="bots-heading" className="text-lg font-semibold text-slate-900">
        Bots
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Configura los proveedores de IA por empresa, las keywords con prioridad, revisa las
        conversaciones del bot, prueba el router del motor y monitorea la cola de mensajes D3.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <form
            onSubmit={(event) => void handleProviderSubmit(event)}
            className="space-y-4"
            aria-label="Configurar proveedor de IA"
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                Configurar proveedor de IA
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="provider-kind" className="block text-sm text-slate-600">
                    Tipo de proveedor *
                  </label>
                  <input
                    id="provider-kind"
                    type="text"
                    maxLength={16}
                    value={providerForm.providerKind}
                    onChange={(event) => setProviderField('providerKind', event.target.value)}
                    placeholder="openai"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="provider-order" className="block text-sm text-slate-600">
                    Orden *
                  </label>
                  <input
                    id="provider-order"
                    type="number"
                    min={0}
                    step={1}
                    value={providerForm.order}
                    onChange={(event) => setProviderField('order', event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="provider-model" className="block text-sm text-slate-600">
                    Modelo
                  </label>
                  <input
                    id="provider-model"
                    type="text"
                    maxLength={128}
                    value={providerForm.model}
                    onChange={(event) => setProviderField('model', event.target.value)}
                    placeholder="gpt-4o-mini"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="provider-temperature" className="block text-sm text-slate-600">
                    Temperatura
                  </label>
                  <input
                    id="provider-temperature"
                    type="text"
                    value={providerForm.temperature}
                    onChange={(event) => setProviderField('temperature', event.target.value)}
                    placeholder="0.7"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="provider-prompt-base" className="block text-sm text-slate-600">
                    Prompt base
                  </label>
                  <textarea
                    id="provider-prompt-base"
                    rows={3}
                    value={providerForm.promptBase}
                    onChange={(event) => setProviderField('promptBase', event.target.value)}
                    placeholder="Eres el asistente virtual de esta empresa…"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="provider-enabled"
                    type="checkbox"
                    checked={providerForm.enabled}
                    onChange={(event) => setProviderField('enabled', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <label htmlFor="provider-enabled" className="text-sm text-slate-600">
                    Proveedor habilitado
                  </label>
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={providersStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Guardar proveedor
              </button>
              <span role="status" aria-live="polite" className="text-sm">
                {providerFormError !== null && (
                  <span className="text-red-600">{providerFormError}</span>
                )}
              </span>
            </div>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Proveedores configurados</p>
            {isProvidersLoading ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Cargando proveedores…
              </p>
            ) : providers.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay proveedores de IA configurados.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {providers.map((provider) => (
                  <li key={provider.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              provider.enabled
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {provider.enabled ? 'Habilitado' : 'Deshabilitado'}
                          </span>
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                            {provider.provider_kind}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          Orden: {provider.order} · Modelo: {formatNullable(provider.model)}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          Temperatura: {formatNullable(provider.temperature)}
                        </p>
                        {provider.prompt_base !== '' && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                            {provider.prompt_base}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggleProvider(provider)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          {provider.enabled ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteProvider(provider)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <span role="status" aria-live="polite" className="mt-2 block text-sm">
              {providersError !== null && <span className="text-red-600">{providersError}</span>}
            </span>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-slate-700">Conversaciones</p>
            {isConversationsLoading ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Cargando conversaciones…
              </p>
            ) : conversations.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay conversaciones del bot.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {conversations.map((conversation) => (
                  <li
                    key={conversation.id}
                    className={`rounded-lg border p-4 transition ${
                      activeConversationId === conversation.id
                        ? 'border-brand-600 bg-brand-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleSelectConversation(conversation)}
                      className="block w-full text-left"
                      aria-expanded={activeConversationId === conversation.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                          {conversation.state}
                        </span>
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                          {formatNullable(conversation.external_contact_id)}
                        </span>
                        {campaignNameFor(conversation.ad_campaign_id, adCampaigns) !== null && (
                          <span
                            className="inline-block rounded bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700"
                            title={`Procedencia: campaña ${campaignNameFor(
                              conversation.ad_campaign_id,
                              adCampaigns,
                            )}`}
                          >
                            🎯 {campaignNameFor(conversation.ad_campaign_id, adCampaigns)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        Última actividad:{' '}
                        {conversation.last_message_at !== null
                          ? new Date(conversation.last_message_at).toLocaleString()
                          : '—'}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span role="status" aria-live="polite" className="mt-2 block text-sm">
              {conversationsError !== null && (
                <span className="text-red-600">{conversationsError}</span>
              )}
            </span>
          </div>

          {activeConversationId !== null && (
            <div>
              <p className="text-sm font-medium text-slate-700">Mensajes</p>
              {messagesStatus === 'loading' && messages.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500" role="status">
                  Cargando mensajes…
                </p>
              ) : messages.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500" role="status">
                  Esta conversación aún no tiene mensajes.
                </p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className={`rounded-lg border p-3 ${
                        message.direction === 'outbound'
                          ? 'border-brand-200 bg-brand-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-500">
                          {message.direction === 'outbound' ? 'Saliente' : 'Entrante'}
                        </span>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            message.queue_status === 'processed' || message.queue_status === 'sent'
                              ? 'bg-emerald-100 text-emerald-700'
                              : message.queue_status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {message.queue_status}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                        {message.content}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {new Date(message.created_at).toLocaleString()}
                        {message.provider_used !== null && <> · {message.provider_used}</>}
                        {message.tokens_used > 0 && <> · {message.tokens_used} tokens</>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <span role="status" aria-live="polite" className="mt-2 block text-sm">
                {messagesError !== null && <span className="text-red-600">{messagesError}</span>}
              </span>

              <form
                onSubmit={(event) => void handleSendSubmit(event)}
                className="mt-4 space-y-3"
                aria-label="Enviar mensaje de prueba"
              >
                <label htmlFor="send-content" className="block text-sm text-slate-600">
                  Enviar mensaje de prueba a la cola D3
                </label>
                <textarea
                  id="send-content"
                  rows={2}
                  value={sendContent}
                  onChange={(event) => setSendContent(event.target.value)}
                  placeholder="Escribe el mensaje a encolar…"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={sendStatus === 'loading'}
                    className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Encolar mensaje
                  </button>
                  <span role="status" aria-live="polite" className="text-sm">
                    {sendFormError !== null && (
                      <span className="text-red-600">{sendFormError}</span>
                    )}
                  </span>
                </div>
                {sendResult !== null && sendStatus === 'success' && (
                  <p className="text-sm text-emerald-700" role="status">
                    Mensaje encolado (202) · estado: {sendResult.queue_status}
                  </p>
                )}
                <span role="status" aria-live="polite" className="block text-sm">
                  {sendError !== null && <span className="text-red-600">{sendError}</span>}
                </span>
              </form>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-slate-700">Probar router</p>
            <p className="mt-1 text-sm text-slate-500">
              Escribe un mensaje y el motor decidirá la rama (keyword → intent → general_chat) sin
              encolar ni persistir nada.
            </p>
            <form
              onSubmit={(event) => void handleRouterSubmit(event)}
              className="mt-2 space-y-3"
              aria-label="Probar router del bot"
            >
              <label htmlFor="router-message" className="block text-sm text-slate-600">
                Mensaje de prueba
              </label>
              <textarea
                id="router-message"
                rows={2}
                maxLength={4000}
                value={routerMessage}
                onChange={(event) => {
                  setRouterMessage(event.target.value);
                  setRouterFormError(null);
                }}
                placeholder="Escribe el mensaje que quieres enrutar…"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={routerStatus === 'loading'}
                  className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Probar router
                </button>
                <span role="status" aria-live="polite" className="text-sm">
                  {routerFormError !== null && (
                    <span className="text-red-600">{routerFormError}</span>
                  )}
                </span>
              </div>
              <span role="status" aria-live="polite" className="block text-sm">
                {routerError !== null && <span className="text-red-600">{routerError}</span>}
              </span>
              {routerStatus === 'loading' && (
                <p className="text-sm text-slate-500" role="status">
                  Probando router…
                </p>
              )}
              {routerTrace !== null && routerStatus === 'success' && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-700">
                    Ruta: <span className="text-brand-700">{routerTrace.matched_route}</span>
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-slate-500">Rama</dt>
                    <dd className="text-slate-800">{routerTrace.branch}</dd>
                    <dt className="text-slate-500">Confianza</dt>
                    <dd className="text-slate-800">{Math.round(routerTrace.confidence * 100)}%</dd>
                    <dt className="text-slate-500">Keyword</dt>
                    <dd className="text-slate-800">{formatNullable(routerTrace.keyword)}</dd>
                    <dt className="text-slate-500">Prioridad</dt>
                    <dd className="text-slate-800">
                      {routerTrace.keyword_priority !== null
                        ? String(routerTrace.keyword_priority)
                        : '—'}
                    </dd>
                    <dt className="text-slate-500">Intención</dt>
                    <dd className="text-slate-800">{formatNullable(routerTrace.intent)}</dd>
                  </dl>
                  {routerTrace.response !== null && (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="text-slate-500">Respuesta:</span> {routerTrace.response}
                    </p>
                  )}
                  {routerTrace.steps.length > 0 && (
                    <ol className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                      {routerTrace.steps.map((step) => (
                        <li key={step.order} className="text-sm text-slate-600">
                          <span className="font-medium text-slate-700">{step.order + 1}.</span>{' '}
                          {step.branch} · {step.outcome} — {step.detail}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-slate-700">Keywords con prioridad</p>
        <p className="mt-1 text-sm text-slate-500">
          Configura términos que activan respuestas inteligentes; la búsqueda los usa en orden de
          prioridad (menor = más prioritario).
        </p>

        <form
          onSubmit={(event) => void handleKeywordSubmit(event)}
          className="mt-3 space-y-4 rounded-lg border border-slate-200 p-4"
          aria-label="Configurar keyword con prioridad"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="keyword-term" className="block text-sm text-slate-600">
                Término *
              </label>
              <input
                id="keyword-term"
                type="text"
                maxLength={255}
                value={keywordForm.term}
                onChange={(event) => setKeywordField('term', event.target.value)}
                placeholder="servicio"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="keyword-priority" className="block text-sm text-slate-600">
                Prioridad * (0-1000, menor = más prioritario)
              </label>
              <input
                id="keyword-priority"
                type="number"
                min={0}
                max={1000}
                step={1}
                value={keywordForm.priority}
                onChange={(event) => setKeywordField('priority', event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="keyword-response" className="block text-sm text-slate-600">
              Respuesta *
            </label>
            <textarea
              id="keyword-response"
              rows={3}
              maxLength={2000}
              value={keywordForm.response}
              onChange={(event) => setKeywordField('response', event.target.value)}
              placeholder="Ofrecemos servicios de consultoría…"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="keyword-enabled"
              type="checkbox"
              checked={keywordForm.enabled}
              onChange={(event) => setKeywordField('enabled', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <label htmlFor="keyword-enabled" className="text-sm text-slate-600">
              Keyword habilitada
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={keywordsStatus === 'loading'}
              className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editingKeywordId === null ? 'Guardar keyword' : 'Actualizar keyword'}
            </button>
            {editingKeywordId !== null && (
              <button
                type="button"
                onClick={resetKeywordForm}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Cancelar edición
              </button>
            )}
            <span role="status" aria-live="polite" className="text-sm">
              {keywordFormError !== null && (
                <span className="text-red-600">{keywordFormError}</span>
              )}
            </span>
          </div>
        </form>

        <div className="mt-4">
          <p className="text-sm font-medium text-slate-700">Keywords configuradas</p>
          {isKeywordsLoading ? (
            <p className="mt-2 text-sm text-slate-500" role="status">
              Cargando keywords…
            </p>
          ) : keywords.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500" role="status">
              Aún no hay keywords configuradas.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {keywords.map((keyword) => (
                <li key={keyword.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-block rounded bg-brand-100 px-2 py-0.5 text-xs font-mono font-medium text-brand-700">
                          P{keyword.priority}
                        </span>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            keyword.enabled
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {keyword.enabled ? 'Habilitada' : 'Deshabilitada'}
                        </span>
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                          {keyword.term}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-700">{keyword.response}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditKeyword(keyword)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleKeyword(keyword)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          {keyword.enabled ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteKeyword(keyword)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <span role="status" aria-live="polite" className="mt-2 block text-sm">
            {keywordsError !== null && <span className="text-red-600">{keywordsError}</span>}
          </span>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-slate-700">Monitor de cola D3</p>
        {isQueueStatsLoading ? (
          <p className="mt-2 text-sm text-slate-500" role="status">
            Cargando estadísticas de cola…
          </p>
        ) : queueStats === null ? (
          <p className="mt-2 text-sm text-slate-500" role="status">
            No hay estadísticas de cola disponibles.
          </p>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Longitud de cola</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{queueStats.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Pendientes</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{queueStats.pending}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Consumer lag</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {queueStats.consumer_lag ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">DLQ</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{queueStats.dlq_count}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Encolados</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{queueStats.enqueued}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Procesados</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{queueStats.processed}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Fallidos</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{queueStats.failed}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Stream</p>
              <p className="mt-1 truncate font-mono text-sm text-slate-900">{queueStats.stream}</p>
            </div>
          </div>
        )}
        <span role="status" aria-live="polite" className="mt-2 block text-sm">
          {queueStatsError !== null && <span className="text-red-600">{queueStatsError}</span>}
        </span>
      </div>
    </section>
  );
}
