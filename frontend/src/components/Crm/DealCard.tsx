import type { ReactElement } from 'react';
import type { IDealRead } from '@/api/types';
import { useCrmStore } from '@/store/crmStore';
import { Badge } from '@/components/ui';
import { formatCurrency, getSlaBadge } from './crmFormat';

interface IDealCardProps {
  /** Oportunidad a mostrar. */
  deal: IDealRead;
  /** Callback al abrir el detalle de la oportunidad. */
  onOpen: () => void;
}

/**
 * Tarjeta de una oportunidad en el tablero Kanban. Lee la política SLA de su
 * etapa directamente del store y es accesible como botón (abre el detalle).
 */
export function DealCard({ deal, onOpen }: IDealCardProps): ReactElement {
  const sla = useCrmStore((state) => state.sla.find((policy) => policy.stage_id === deal.stage_id));
  const badge = getSlaBadge(deal, sla);
  const hasProbability = deal.probability !== null && deal.probability !== undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Abrir oportunidad ${deal.title}`}
      className="w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <p className="truncate text-sm font-semibold text-slate-900">{deal.title}</p>
      <p className="mt-1 text-sm text-slate-600">
        {formatCurrency(deal.amount_minor, deal.currency)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {deal.owner_id !== null ? (
          <Badge tone="neutral" mono>
            {deal.owner_id.slice(0, 8)}
          </Badge>
        ) : (
          <Badge tone="muted">Sin propietario</Badge>
        )}
        {hasProbability && <Badge tone="sky">{deal.probability}%</Badge>}
        {badge !== null && <Badge className={badge.className}>{badge.label}</Badge>}
      </div>
    </button>
  );
}
