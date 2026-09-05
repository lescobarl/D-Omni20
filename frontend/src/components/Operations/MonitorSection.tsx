/**
 * Sección "Monitor" del área de operación del bot (B.8 — operación continua).
 *
 * Contrato:
 * - Dos subtabs autocontenidas:
 *   1. «Cola D3»: supervisión en vivo de la cola D3 del tenant (longitud,
 *      pendientes, rezago del consumidor, DLQ y acumulados de
 *      encolados/procesados/fallidos), expuesta por el backend con RLS vía
 *      `GET /bot/queue/tenant-stats`. El dato `consumer_lag` es opcional;
 *      cuando es `null` se muestra «No aplica».
 *   2. «Conversaciones Activas»: vista de negocio de las conversaciones del bot
 *      en curso (cliente, canal, últimos mensajes y estado), expuesta por el
 *      backend con RLS vía `GET /operations/monitor/active-conversations`.
 *      Cada fila es expandible para ver el detalle de la conversación.
 * - Cada subtab carga sus datos al montar y permite recargarlos de forma manual
 *   sin perder la vista actual.
 * - Los errores del store se reflejan en un `aria-live` accesible y, si aún no
 *   hay datos, se ofrece un reintento explícito.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useBotStore } from '@/store/botStore';
import { useOperationsStore } from '@/store/operationsStore';
import type { IActiveConversationRead } from '@/api/types';

/** Métricas de la cola D3 que se muestran como tarjetas en el monitor. */
interface IQueueMetric {
  /** Clave del dato en `IQueueStatsRead`. */
  key: 'length' | 'pending' | 'consumer_lag' | 'dlq_count' | 'enqueued' | 'processed' | 'failed';
  /** Etiqueta legible en español. */
  label: string;
}

/** Métricas del monitor en orden de presentación (B.8). */
const QUEUE_METRICS: ReadonlyArray<IQueueMetric> = [
  { key: 'length', label: 'Mensajes en cola' },
  { key: 'pending', label: 'Pendientes de confirmar' },
  { key: 'consumer_lag', label: 'Rezago del consumidor' },
  { key: 'dlq_count', label: 'Cola de fallidos (DLQ)' },
  { key: 'enqueued', label: 'Encolados (total)' },
  { key: 'processed', label: 'Procesados (total)' },
  { key: 'failed', label: 'Fallidos (total)' },
];

/** Subtabs disponibles en el monitor. */
type MonitorTab = 'queue' | 'conversations';

/** Formatea un valor numérico opcional; `null` se muestra como «No aplica». */
function formatMetric(value: number | null): string {
  return value === null ? 'No aplica' : String(value);
}

/** Traduce el estado de una conversación activa a una etiqueta legible. */
function formatState(state: string): string {
  const labels: Record<string, string> = {
    new: 'Nueva',
    open: 'Abierta',
    pending: 'Pendiente',
    resolved: 'Resuelta',
    closed: 'Cerrada',
  };
  return labels[state] ?? state;
}

/** Traduce la dirección del último mensaje a una etiqueta legible. */
function formatDirection(direction: string | null): string {
  if (direction === null) return '—';
  return direction === 'inbound' ? 'Entrante' : 'Saliente';
}

/** Formatea una fecha ISO a una representación local legible. */
function formatDate(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/** Renderiza la subtab «Cola D3» con las métricas de la cola. */
function QueueTab(): ReactElement {
  const queueStats = useBotStore((state) => state.queueStats);
  const queueStatsStatus = useBotStore((state) => state.queueStatsStatus);
  const queueStatsError = useBotStore((state) => state.queueStatsError);
  const loadQueueStats = useBotStore((state) => state.loadQueueStats);

  // Subtab autocontenida: carga las estadísticas de la cola al montar.
  useEffect(() => {
    void loadQueueStats();
  }, [loadQueueStats]);

  const isLoading = queueStatsStatus === 'loading' && queueStats === null;
  const hasData = queueStats !== null;

  return (
    <>
      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando estadísticas de la cola…
        </p>
      ) : hasData ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Stream: <span className="font-medium text-slate-700">{queueStats.stream}</span>
            </p>
            <button
              type="button"
              onClick={() => void loadQueueStats()}
              disabled={queueStatsStatus === 'loading'}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recargar estadísticas
            </button>
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {QUEUE_METRICS.map((metric) => (
              <div
                key={metric.key}
                data-testid={`metric-${metric.key}`}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {metric.label}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">
                  {formatMetric(queueStats[metric.key])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-500" role="status">
            No se pudieron cargar las estadísticas de la cola.
          </p>
          <button
            type="button"
            onClick={() => void loadQueueStats()}
            className="mt-3 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Reintentar
          </button>
        </div>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {queueStatsError !== null && <span className="text-red-600">{queueStatsError}</span>}
      </span>
    </>
  );
}

/** Renderiza una fila expandible de una conversación activa. */
function ConversationRow({
  conversation,
  expanded,
  onToggle,
}: {
  conversation: IActiveConversationRead;
  expanded: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">
            {conversation.external_contact_id}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            Canal: <span className="font-medium text-slate-700">{conversation.channel_id}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {conversation.unread_count > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
              {conversation.unread_count} no leído{conversation.unread_count > 1 ? 's' : ''}
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              conversation.is_active
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {conversation.is_active ? 'Activa' : 'Inactiva'}
          </span>
          <span className="text-slate-400" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {expanded && (
        <dl className="border-t border-slate-200 px-4 py-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado</dt>
              <dd className="mt-0.5 text-slate-900">{formatState(conversation.state)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Mensajes
              </dt>
              <dd className="mt-0.5 text-slate-900">{conversation.message_count}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Último mensaje
              </dt>
              <dd className="mt-0.5 text-slate-700">{conversation.last_message_content ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Dirección
              </dt>
              <dd className="mt-0.5 text-slate-900">
                {formatDirection(conversation.last_message_direction)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Última actividad
              </dt>
              <dd className="mt-0.5 text-slate-900">{formatDate(conversation.last_message_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Actualizado
              </dt>
              <dd className="mt-0.5 text-slate-900">{formatDate(conversation.updated_at)}</dd>
            </div>
          </div>
        </dl>
      )}
    </li>
  );
}

/** Renderiza la subtab «Conversaciones Activas» con la lista expandible. */
function ConversationsTab(): ReactElement {
  const activeConversations = useOperationsStore((state) => state.activeConversations);
  const activeConversationsStatus = useOperationsStore((state) => state.activeConversationsStatus);
  const activeConversationsError = useOperationsStore((state) => state.activeConversationsError);
  const loadActiveConversations = useOperationsStore((state) => state.loadActiveConversations);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  // Subtab autocontenida: carga las conversaciones activas al montar.
  useEffect(() => {
    void loadActiveConversations();
  }, [loadActiveConversations]);

  const isLoading = activeConversationsStatus === 'loading' && activeConversations.length === 0;
  const hasData = activeConversations.length > 0;

  const toggle = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando conversaciones activas…
        </p>
      ) : hasData ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {activeConversations.length} conversación
              {activeConversations.length > 1 ? 'es' : ''} activa
              {activeConversations.length > 1 ? 's' : ''}
            </p>
            <button
              type="button"
              onClick={() => void loadActiveConversations()}
              disabled={activeConversationsStatus === 'loading'}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recargar conversaciones
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {activeConversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                expanded={expandedIds.has(conversation.id)}
                onToggle={() => toggle(conversation.id)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-500" role="status">
            No se pudieron cargar las conversaciones activas.
          </p>
          <button
            type="button"
            onClick={() => void loadActiveConversations()}
            className="mt-3 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Reintentar
          </button>
        </div>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {activeConversationsError !== null && (
          <span className="text-red-600">{activeConversationsError}</span>
        )}
      </span>
    </>
  );
}

/**
 * Sección de supervisión del bot (B.8): salud de la cola D3 y vista de negocio
 * de las conversaciones activas.
 *
 * @example
 * ```tsx
 * <MonitorSection />
 * ```
 *
 * @returns Las dos subtabs del monitor y su cabecera.
 */
export function MonitorSection(): ReactElement {
  const [tab, setTab] = useState<MonitorTab>('queue');

  const tabs: ReadonlyArray<{ id: MonitorTab; label: string }> = [
    { id: 'queue', label: 'Cola D3' },
    { id: 'conversations', label: 'Conversaciones Activas' },
  ];

  return (
    <section aria-labelledby="monitor-heading">
      <h2 id="monitor-heading" className="text-lg font-semibold text-slate-900">
        Monitor
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Supervisión de la cola D3 y de las conversaciones activas del bot en vivo. Muestra la carga
        actual, el rezago del consumidor y la vista de negocio de las conversaciones en curso.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Operación continua
      </span>

      <div
        role="tablist"
        aria-label="Vistas del monitor"
        className="mt-4 flex gap-1 border-b border-slate-200"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`monitor-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`monitor-panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`-mb-px rounded-t border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === item.id
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="monitor-panel-queue"
        aria-labelledby="monitor-tab-queue"
        hidden={tab !== 'queue'}
      >
        {tab === 'queue' && <QueueTab />}
      </div>
      <div
        role="tabpanel"
        id="monitor-panel-conversations"
        aria-labelledby="monitor-tab-conversations"
        hidden={tab !== 'conversations'}
      >
        {tab === 'conversations' && <ConversationsTab />}
      </div>
    </section>
  );
}
