/**
 * Sección "Estadísticas" del área de operación del bot (B.2 — métricas por periodo).
 *
 * Contrato:
 * - Métricas históricas del bot del tenant: mensajes totales, ratio resuelto/escalado,
 *   escalados a humano y contactos únicos, más las series de mensajes por día y por
 *   canal.
 * - Fuente única con RLS: `GET /operations/stats/overview` (agregados SQL del
 *   tenant activo), reutilizada también por el Dashboard B.1.
 * - Sección autocontenida: carga los datos al montar y permite recargarlos.
 * - El ratio resuelto se muestra en porcentaje; las series vacías se presentan
 *   con un estado vacío accesible.
 */
import { useEffect, type ReactElement } from 'react';
import { useOperationsStore } from '@/store/operationsStore';

/** Métricas resumen de estadísticas que se muestran como tarjetas (B.2). */
interface IStatsMetric {
  /** Clave del dato en `IStatsOverviewRead`. */
  key: 'total_messages' | 'escalated' | 'resolved' | 'unique_contacts';
  /** Etiqueta legible en español. */
  label: string;
}

/** Métricas resumen de estadísticas en orden de presentación (B.2). */
const STATS_METRICS: ReadonlyArray<IStatsMetric> = [
  { key: 'total_messages', label: 'Mensajes totales' },
  { key: 'escalated', label: 'Escalados a humano' },
  { key: 'resolved', label: 'Resueltos por el bot' },
  { key: 'unique_contacts', label: 'Contactos únicos' },
];

/** Formatea un número con separador de miles en español (México). */
function formatNumber(value: number): string {
  return value.toLocaleString('es-MX');
}

/** Formatea el ratio resuelto (0..1) como porcentaje redondeado. */
function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Estadísticas del bot por periodo (B.2).
 *
 * @example
 * ```tsx
 * <EstadisticasBot />
 * ```
 *
 * @returns Las métricas resumen, la serie por día y el desglose por canal.
 */
export function EstadisticasBot(): ReactElement {
  const statsOverview = useOperationsStore((state) => state.statsOverview);
  const statsOverviewStatus = useOperationsStore((state) => state.statsOverviewStatus);
  const statsOverviewError = useOperationsStore((state) => state.statsOverviewError);
  const loadStatsOverview = useOperationsStore((state) => state.loadStatsOverview);

  // Sección autocontenida: carga las estadísticas al montar.
  useEffect(() => {
    void loadStatsOverview();
  }, [loadStatsOverview]);

  const isLoading = statsOverviewStatus === 'loading' && statsOverview === null;
  const hasData = statsOverview !== null;

  return (
    <section aria-labelledby="stats-heading">
      <h2 id="stats-heading" className="text-lg font-semibold text-slate-900">
        Estadísticas
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Métricas históricas de conversaciones, captación y conversión del bot por periodo: mensajes
        por día, ratio resuelto/escalado, por canal y contactos únicos.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Ciclo completo ①-⑨
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando estadísticas…
        </p>
      ) : hasData ? (
        <div className="mt-4 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">Resumen del periodo actual</p>
            <button
              type="button"
              onClick={() => void loadStatsOverview()}
              disabled={statsOverviewStatus === 'loading'}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recargar estadísticas
            </button>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATS_METRICS.map((metric) => (
              <div
                key={metric.key}
                data-testid={`stat-${metric.key}`}
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
            <div
              data-testid="stat-resolved_ratio"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Ratio resuelto
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">
                {formatRatio(statsOverview.resolved_ratio)}
              </dd>
            </div>
          </dl>

          <div
            data-testid="daily-table"
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Mensajes por día</h3>
            {statsOverview.daily.length > 0 ? (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Fecha
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Entrantes
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Salientes
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statsOverview.daily.map((day) => (
                    <tr key={day.date}>
                      <td className="py-2 pr-4 text-slate-700">{day.date}</td>
                      <td className="py-2 pr-4 text-slate-700">{formatNumber(day.inbound)}</td>
                      <td className="py-2 pr-4 text-slate-700">{formatNumber(day.outbound)}</td>
                      <td className="py-2 font-medium text-slate-900">{formatNumber(day.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Sin mensajes registrados en el periodo.
              </p>
            )}
          </div>

          <div
            data-testid="channel-table"
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Mensajes por canal</h3>
            {statsOverview.by_channel.length > 0 ? (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Canal
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Conversaciones
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Mensajes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statsOverview.by_channel.map((channel) => (
                    <tr key={channel.channel_id}>
                      <td className="py-2 pr-4 font-medium text-slate-700">{channel.channel_id}</td>
                      <td className="py-2 pr-4 text-slate-700">
                        {formatNumber(channel.conversation_count)}
                      </td>
                      <td className="py-2 text-slate-700">{formatNumber(channel.message_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Sin actividad por canal en el periodo.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-500" role="status">
            No se pudieron cargar las estadísticas.
          </p>
          <button
            type="button"
            onClick={() => void loadStatsOverview()}
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
