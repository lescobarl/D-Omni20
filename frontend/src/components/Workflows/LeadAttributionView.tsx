/**
 * Vista del reporte de atribución por campaña (C-1).
 *
 * Contrato:
 * - Carga el reporte `GET /api/v1/workflows/leads/attribution` al montarse
 *   vía `useWorkflowStore.loadAttribution` (el servicio se inyecta por DI).
 * - La atribución es un REPORTE del tenant activo, no una cola de envío: usa
 *   un estado de carga propio (`attributionStatus` + `attributionError`).
 * - Renderiza una tabla agrupada por campaña y fuente con el conteo de leads
 *   por estado (nuevos, contactados, convertidos, perdidos) y un resumen.
 * - El feedback se expone de forma accesible (`role="status"` / `role="alert"`).
 */
import { useEffect, type ReactElement } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';

/**
 * Tabla de atribución de leads del tenant activo por campaña y fuente (UTM).
 *
 * @example
 * ```tsx
 * <LeadAttributionView />
 * ```
 *
 * @returns El reporte de atribución o sus estados de carga/error/vacío.
 */
export function LeadAttributionView(): ReactElement {
  const attribution = useWorkflowStore((state) => state.attribution);
  const attributionStatus = useWorkflowStore((state) => state.attributionStatus);
  const attributionError = useWorkflowStore((state) => state.attributionError);
  const loadAttribution = useWorkflowStore((state) => state.loadAttribution);

  useEffect(() => {
    void loadAttribution();
  }, [loadAttribution]);

  if (attributionStatus === 'loading' || (attributionStatus === 'idle' && attribution === null)) {
    return (
      <div role="status" aria-live="polite" className="mt-3 rounded-md border border-slate-200 p-3">
        <p className="text-sm text-slate-500">Cargando atribución por campaña…</p>
      </div>
    );
  }

  if (attributionStatus === 'error') {
    return (
      <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
        <p role="alert" className="text-sm font-medium text-red-600">
          {attributionError ?? 'No se pudo cargar la atribución.'}
        </p>
      </div>
    );
  }

  if (!attribution || attribution.rows.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-slate-200 p-3">
        <p className="text-sm text-slate-500">
          Aún no hay leads con atribución por campaña para este tenant.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-700">Atribución por campaña (UTM)</p>
      <table className="mt-2 w-full border-collapse text-xs text-slate-700">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-1 pr-2 font-medium">Campaña</th>
            <th className="py-1 pr-2 font-medium">Fuente</th>
            <th className="py-1 pr-2 text-right font-medium">Total</th>
            <th className="py-1 pr-2 text-right font-medium">Nuevos</th>
            <th className="py-1 pr-2 text-right font-medium">Contactados</th>
            <th className="py-1 pr-2 text-right font-medium">Convertidos</th>
            <th className="py-1 text-right font-medium">Perdidos</th>
          </tr>
        </thead>
        <tbody>
          {attribution.rows.map((row) => (
            <tr key={`${row.campaign}:${row.source}`} className="border-b border-slate-100">
              <td className="py-1 pr-2">{row.campaign}</td>
              <td className="py-1 pr-2">{row.source}</td>
              <td className="py-1 pr-2 text-right">{row.total}</td>
              <td className="py-1 pr-2 text-right">{row.new}</td>
              <td className="py-1 pr-2 text-right">{row.contacted}</td>
              <td className="py-1 pr-2 text-right">{row.converted}</td>
              <td className="py-1 text-right">{row.lost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        {attribution.total_leads} leads en total · generado {attribution.generated_at}
      </p>
    </div>
  );
}
