/**
 * Dashboard de Analítica Avanzada.
 *
 * Contrato:
 * - Al montarse carga el resumen del tenant (`useAnalyticsStore.fetchDashboard`).
 * - Muestra el total de eventos y una gráfica de barras accesible (CSS sin dependencias
 *   externas de charting) con la distribución por tipo de evento.
 * - Lista los eventos recientes con su tipo, entidad y marca de tiempo localizada.
 * - Expone el estado del flujo (`idle | loading | success | error`) de forma
 *   accesible (`role="status"` / `role="alert"`).
 */
import { useEffect, type ReactElement } from 'react';
import { useAnalyticsStore } from '@/store/analyticsStore';

/** Formatea un número de forma localizada. */
function formatCount(count: number): string {
  return new Intl.NumberFormat('es-MX').format(count);
}

/** Formatea una marca de tiempo ISO a fecha/hora localizada. */
function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Descripción accesible del contexto de un evento reciente. */
function describeEvent(event: {
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
}): string {
  if (event.entity_type !== null && event.entity_id !== null) {
    return `${event.event_type} — ${event.entity_type}: ${event.entity_id}`;
  }
  if (event.entity_type !== null) {
    return `${event.event_type} — ${event.entity_type}`;
  }
  return event.event_type;
}

/**
 * Dashboard de Analítica Avanzada.
 * @returns El panel con el total, la gráfica por tipo de evento y los eventos recientes.
 */
export function AnalyticsDashboard(): ReactElement {
  const dashboard = useAnalyticsStore((state) => state.dashboard);
  const status = useAnalyticsStore((state) => state.status);
  const error = useAnalyticsStore((state) => state.error);
  const fetchDashboard = useAnalyticsStore((state) => state.fetchDashboard);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const isLoading = status === 'loading';
  const hasData = dashboard !== null && dashboard.total_events > 0;
  const isEmpty = dashboard !== null && dashboard.total_events === 0;
  const maxCount = Math.max(1, ...(dashboard?.by_event_type.map((item) => item.count) ?? []));

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Analítica</h2>

      {isLoading && (
        <p role="status" className="text-xs text-slate-500">
          Cargando analítica…
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {hasData && dashboard !== null && (
        <>
          <section aria-labelledby="analytics-total-heading">
            <h3 id="analytics-total-heading" className="sr-only">
              Total de eventos
            </h3>
            <p className="text-3xl font-bold text-brand-700">
              {formatCount(dashboard.total_events)}
            </p>
            <p className="text-xs text-slate-500">eventos registrados</p>
          </section>

          <section aria-labelledby="analytics-breakdown-heading">
            <h3 id="analytics-breakdown-heading" className="text-xs font-medium text-slate-600">
              Por tipo de evento
            </h3>
            <ul className="mt-2 space-y-2">
              {dashboard.by_event_type.map((item) => {
                const width = Math.round((item.count / maxCount) * 100);
                return (
                  <li key={item.event_type}>
                    <div className="flex items-center justify-between text-xs text-slate-700">
                      <span>{item.event_type}</span>
                      <span>{formatCount(item.count)}</span>
                    </div>
                    <div
                      role="img"
                      aria-label={`${item.event_type}: ${formatCount(item.count)} eventos`}
                      className="mt-1 h-2 rounded-full bg-slate-100"
                    >
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="analytics-recent-heading">
            <h3 id="analytics-recent-heading" className="text-xs font-medium text-slate-600">
              Eventos recientes
            </h3>
            {dashboard.recent.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">Sin eventos recientes.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {dashboard.recent.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-md border border-slate-100 bg-white p-2 text-xs"
                  >
                    <span className="font-medium text-slate-800">{event.event_type}</span>
                    <span className="text-slate-500"> · {formatDateTime(event.occurred_at)}</span>
                    <p className="mt-0.5 text-slate-500">{describeEvent(event)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {isEmpty && (
        <p role="status" className="text-xs text-slate-500">
          Aún no hay eventos de analítica registrados.
        </p>
      )}
    </div>
  );
}
