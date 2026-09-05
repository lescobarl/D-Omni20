import type { IDealRead, ISlaRead } from '@/api/types';

/**
 * Formatea un monto en unidades menores (céntimos) a moneda legible en es-MX.
 * El backend expone los montos como enteros en unidades menores (p. ej. MXN).
 */
export function formatCurrency(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(amountMinor / 100);
}

/** Insignia de SLA de una oportunidad (etiqueta + clases de color para `Badge`). */
export interface ISlaBadge {
  /** Etiqueta legible de la insignia. */
  label: string;
  /** Clases de color aplicadas a la insignia. */
  className: string;
}

/**
 * Calcula la insignia SLA de una oportunidad abierta según su antigüedad frente
 * a la política de su etapa. Devuelve `null` para oportunidades cerradas o sin
 * política configurada (sin badge).
 */
export function getSlaBadge(deal: IDealRead, sla: ISlaRead | undefined): ISlaBadge | null {
  if (deal.status !== 'open' || sla === undefined) {
    return null;
  }
  const ageMs = Date.now() - Date.parse(deal.created_at);
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;
  if (ageDays > sla.max_stay_days) {
    return { label: 'SLA vencido', className: 'bg-red-100 text-red-700' };
  }
  if (ageHours > sla.max_response_hours) {
    return { label: 'SLA por vencer', className: 'bg-amber-100 text-amber-700' };
  }
  return { label: 'SLA al día', className: 'bg-green-100 text-green-700' };
}
