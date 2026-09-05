/**
 * Sección "Dashboard" del área de operación del bot (B.1 — visión operativa).
 *
 * Contrato:
 * - Visión general en tiempo real del bot del tenant: KPIs de conversación
 *   (activas, entrantes/salientes, escalados, resueltos y contactos únicos),
 *   cuota L1 (ok/warning/exceeded), estado de la cola D3 y últimas
 *   conversaciones.
 * - Combina tres fuentes del backend con RLS (`GET /operations/stats/overview`,
 *   `GET /bot/quota/usage` y `GET /bot/queue/tenant-stats`) y reutiliza la lista
 *   de conversaciones de la pantalla B.6.
 * - Sección autocontenida: carga los datos al montar y permite recargarlos
 *   sin perder la vista actual.
 * - Los errores de cada flujo del store se reflejan en un `aria-live`
 *   accesible y, si aún no hay KPIs, se ofrece un reintento explícito.
 */
import { useEffect, type ReactElement } from 'react';
import type { IQuotaUsageResponse } from '@/api/types';
import { useBotStore } from '@/store/botStore';
import { useOperationsStore } from '@/store/operationsStore';

/** Métricas del dashboard que se muestran como tarjetas (KPIs de B.1). */
interface IDashboardMetric {
  /** Clave del dato en `IStatsOverviewRead`. */
  key:
    | 'active_conversations'
    | 'inbound_messages'
    | 'outbound_messages'
    | 'escalated'
    | 'resolved'
    | 'unique_contacts';
  /** Etiqueta legible en español. */
  label: string;
}

/** KPIs del dashboard en orden de presentación (B.1). */
const DASHBOARD_METRICS: ReadonlyArray<IDashboardMetric> = [
  { key: 'active_conversations', label: 'Conversaciones activas' },
  { key: 'inbound_messages', label: 'Mensajes entrantes' },
  { key: 'outbound_messages', label: 'Mensajes salientes' },
  { key: 'escalated', label: 'Escalados a humano' },
  { key: 'resolved', label: 'Resueltos por el bot' },
  { key: 'unique_contacts', label: 'Contactos únicos' },
];

/** Presentación de cada estado de la cuota L1 (ok/warning/exceeded). */
interface IQuotaStatusConfig {
  /** Etiqueta legible en español. */
  label: string;
  /** Clases del badge de estado. */
  badgeClass: string;
}

/** Configuración de presentación de la cuota L1 (B.1). */
const QUOTA_STATUS: Record<IQuotaUsageResponse['status'], IQuotaStatusConfig> = {
  ok: { label: 'Cuota en nivel ok', badgeClass: 'bg-emerald-100 text-emerald-700' },
  warning: { label: 'Cuota en nivel warning', badgeClass: 'bg-amber-100 text-amber-700' },
  exceeded: { label: 'Cuota excedida', badgeClass: 'bg-red-100 text-red-700' },
};

/** Formatea un número con separador de miles en español (México). */
function formatNumber(value: number): string {
  return value.toLocaleString('es-MX');
}

/**
 * Dashboard operativo del bot (B.1).
 *
 * @example
 * ```tsx
 * <DashboardOperativo />
 * ```
 *
 * @returns Los KPIs, cuota L1, estado de cola y últimas conversaciones.
 */
export function DashboardOperativo(): ReactElement {
  const statsOverview = useOperationsStore((state) => state.statsOverview);
  const statsOverviewStatus = useOperationsStore((state) => state.statsOverviewStatus);
  const statsOverviewError = useOperationsStore((state) => state.statsOverviewError);
  const loadStatsOverview = useOperationsStore((state) => state.loadStatsOverview);

  const quotaUsage = useBotStore((state) => state.quotaUsage);
  const quotaUsageStatus = useBotStore((state) => state.quotaUsageStatus);
  const quotaUsageError = useBotStore((state) => state.quotaUsageError);
  const loadQuotaUsage = useBotStore((state) => state.loadQuotaUsage);

  const queueStats = useBotStore((state) => state.queueStats);
  const queueStatsStatus = useBotStore((state) => state.queueStatsStatus);
  const queueStatsError = useBotStore((state) => state.queueStatsError);
  const loadQueueStats = useBotStore((state) => state.loadQueueStats);

  const conversations = useBotStore((state) => state.conversations);
  const conversationsStatus = useBotStore((state) => state.conversationsStatus);
  const conversationsError = useBotStore((state) => state.conversationsError);
  const listConversations = useBotStore((state) => state.listConversations);

  // Sección autocontenida: carga todas las fuentes del dashboard al montar.
  useEffect(() => {
    void loadStatsOverview();
    void loadQuotaUsage();
    void loadQueueStats();
    void listConversations();
  }, [loadStatsOverview, loadQuotaUsage, loadQueueStats, listConversations]);

  const reloadAll = (): void => {
    void loadStatsOverview();
    void loadQuotaUsage();
    void loadQueueStats();
    void listConversations();
  };

  const isLoading = statsOverviewStatus === 'loading' && statsOverview === null;
  const hasData = statsOverview !== null;
  const quotaConfig = quotaUsage !== null ? QUOTA_STATUS[quotaUsage.status] : null;

  return (
    <section aria-labelledby="dashboard-heading">
      <h2 id="dashboard-heading" className="text-lg font-semibold text-slate-900">
        Dashboard
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Visión general del bot en tiempo real: KPIs de conversación, cuota L1, estado de la cola D3
        y últimas conversaciones del tenant.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Ciclo completo ①-⑨
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando dashboard operativo…
        </p>
      ) : hasData ? (
        <div className="mt-4 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">Resumen del periodo actual</p>
            <button
              type="button"
              onClick={reloadAll}
              disabled={statsOverviewStatus === 'loading'}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recargar dashboard
            </button>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DASHBOARD_METRICS.map((metric) => (
              <div
                key={metric.key}
                data-testid={`kpi-${metric.key}`}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {metric.label}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">
                  {formatNumber(statsOverview[metric.key])}
                </dd>
              </div>
            ))}
          </dl>

          <div data-testid="quota-card" className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Cuota L1</h3>
              {quotaConfig !== null && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${quotaConfig.badgeClass}`}
                >
                  {quotaConfig.label}
                </span>
              )}
            </div>
            {quotaUsage !== null ? (
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Tokens usados
                  </dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(quotaUsage.total_tokens_used)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Límite del periodo
                  </dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(quotaUsage.quota_limit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Porcentaje
                  </dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {quotaUsage.total_percent}%
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500" role="status">
                {quotaUsageStatus === 'loading' ? 'Cargando cuota L1…' : 'Sin datos de cuota L1.'}
              </p>
            )}
            {quotaUsageError !== null && (
              <span className="mt-2 block text-sm text-red-600">{quotaUsageError}</span>
            )}
          </div>

          <div data-testid="queue-card" className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Estado de cola D3</h3>
            {queueStats !== null ? (
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    En cola
                  </dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(queueStats.length)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Pendientes
                  </dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(queueStats.pending)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Fallidos (DLQ)
                  </dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {formatNumber(queueStats.dlq_count)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500" role="status">
                {queueStatsStatus === 'loading' ? 'Cargando estado de cola…' : 'Sin datos de cola.'}
              </p>
            )}
            {queueStatsError !== null && (
              <span className="mt-2 block text-sm text-red-600">{queueStatsError}</span>
            )}
          </div>

          <div
            data-testid="conversations-card"
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Últimas conversaciones</h3>
            {conversations.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {conversations.slice(0, 5).map((conversation) => (
                  <li
                    key={conversation.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className="text-sm text-slate-700">
                      {conversation.external_contact_id}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {conversation.state}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500" role="status">
                {conversationsStatus === 'loading'
                  ? 'Cargando conversaciones…'
                  : 'Sin conversaciones recientes.'}
              </p>
            )}
            {conversationsError !== null && (
              <span className="mt-2 block text-sm text-red-600">{conversationsError}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-500" role="status">
            No se pudieron cargar los datos del dashboard.
          </p>
          <button
            type="button"
            onClick={reloadAll}
            className="mt-3 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Reintentar
          </button>
        </div>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {statsOverviewError !== null && <span className="text-red-600">{statsOverviewError}</span>}
      </span>
    </section>
  );
}
