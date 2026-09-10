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

/** Desglose de SLA de una oportunidad abierta (estado, insignia y detalle temporal). */
interface ISlaBreakdown extends ISlaBadge {
  /** Detalle temporal legible para el tooltip de la insignia (null si está al día). */
  tooltip: string | null;
}

/** Convierte un exceso en horas a texto legible (horas o días, lo más natural). */
function formatOverdue(hours: number): string {
  const roundedHours = Math.max(1, Math.round(hours));
  if (roundedHours < 24) {
    return `${roundedHours} h`;
  }
  const days = Math.max(1, Math.round(roundedHours / 24));
  return `${days} d`;
}

/**
 * Calcula el desglose SLA de una oportunidad abierta (estado, insignia y detalle
 * temporal). Devuelve `null` para oportunidades cerradas o sin política.
 */
function breakdownSla(deal: IDealRead, sla: ISlaRead | undefined): ISlaBreakdown | null {
  if (deal.status !== 'open' || sla === undefined) {
    return null;
  }
  const ageMs = Date.now() - Date.parse(deal.created_at);
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;
  if (ageDays > sla.max_stay_days) {
    return {
      label: 'SLA vencido',
      className: 'bg-red-100 text-red-700',
      tooltip: `Vencido hace ${formatOverdue(ageHours - sla.max_stay_days * 24)}`,
    };
  }
  if (ageHours > sla.max_response_hours) {
    return {
      label: 'SLA por vencer',
      className: 'bg-amber-100 text-amber-700',
      tooltip: `Tiempo de respuesta excedido hace ${formatOverdue(
        ageHours - sla.max_response_hours,
      )}`,
    };
  }
  return { label: 'SLA al día', className: 'bg-green-100 text-green-700', tooltip: null };
}

/**
 * Calcula la insignia SLA de una oportunidad abierta según su antigüedad frente
 * a la política de su etapa. Devuelve `null` para oportunidades cerradas o sin
 * política configurada (sin badge).
 */
export function getSlaBadge(deal: IDealRead, sla: ISlaRead | undefined): ISlaBadge | null {
  const breakdown = breakdownSla(deal, sla);
  if (breakdown === null) {
    return null;
  }
  return { label: breakdown.label, className: breakdown.className };
}

/**
 * Devuelve el detalle temporal legible de una insignia SLA para usar como
 * tooltip (p. ej. «Vencido hace 3 h»). Devuelve `null` cuando no hay desglose
 * o la oportunidad está al día.
 */
export function getSlaTooltip(deal: IDealRead, sla: ISlaRead | undefined): string | null {
  const breakdown = breakdownSla(deal, sla);
  return breakdown?.tooltip ?? null;
}
