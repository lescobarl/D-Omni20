import type { ReactElement } from 'react';
import { useCrmStore } from '@/store/crmStore';
import { formatCurrency } from './crmFormat';

/**
 * Vista del embudo comercial (KPIs y barras por etapa). El DTO del embudo no
 * expone moneda, por lo que los montos se muestran en MXN por convención.
 */
export function FunnelView(): ReactElement {
  const funnel = useCrmStore((state) => state.funnel);
  const funnelStatus = useCrmStore((state) => state.funnelStatus);
  const funnelError = useCrmStore((state) => state.funnelError);

  if (funnelStatus === 'loading' && funnel === null) {
    return (
      <p className="text-sm text-slate-500" role="status">
        Cargando embudo…
      </p>
    );
  }
  if (funnelError !== null && funnel === null) {
    return (
      <p className="text-sm text-red-600" role="status">
        {funnelError}
      </p>
    );
  }
  if (funnel === null) {
    return (
      <p className="text-sm text-slate-500" role="status">
        Aún no hay datos del embudo.
      </p>
    );
  }

  const maxCount = Math.max(1, ...funnel.stages.map((stage) => stage.count));
  const kpis: Array<{ label: string; value: string }> = [
    { label: 'Oportunidades', value: String(funnel.total_deals) },
    { label: 'Ganadas', value: String(funnel.won_count) },
    { label: 'Perdidas', value: String(funnel.lost_count) },
    { label: 'Abiertas', value: String(funnel.open_count) },
    { label: 'Monto ganado', value: formatCurrency(funnel.won_amount_minor, 'MXN') },
    { label: 'Tasa de cierre', value: `${funnel.close_rate}%` },
    {
      label: 'Ciclo promedio',
      value: funnel.avg_cycle_days !== null ? `${funnel.avg_cycle_days} días` : '—',
    },
  ];

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {kpi.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{kpi.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Embudo por etapa</h3>
        <div className="mt-3 space-y-4">
          {funnel.stages.length === 0 ? (
            <p className="text-sm text-slate-500" role="status">
              Sin etapas en el embudo.
            </p>
          ) : (
            funnel.stages.map((stage) => (
              <div key={stage.stage_id}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <p className="truncate font-medium text-slate-900">{stage.stage_name}</p>
                  <p className="shrink-0 text-slate-500">
                    {stage.count}
                    {stage.conversion_rate !== null ? ` · ${stage.conversion_rate}%` : ''}
                  </p>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${(stage.count / maxCount) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatCurrency(stage.total_amount_minor, 'MXN')} · ponderado{' '}
                  {formatCurrency(stage.weighted_value_minor, 'MXN')}
                  {stage.avg_cycle_days !== null ? ` · ${stage.avg_cycle_days} días` : ''}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
