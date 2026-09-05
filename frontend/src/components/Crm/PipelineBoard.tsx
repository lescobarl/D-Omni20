import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { IDealRead, IStageRead } from '@/api/types';
import { DealCard } from './DealCard';

interface IPipelineBoardProps {
  /** Etapas del pipeline (ordenadas). */
  stages: IStageRead[];
  /** Oportunidades a agrupar por etapa. */
  deals: IDealRead[];
  /** Callback al abrir una oportunidad (recibe su id). */
  onOpenDeal: (dealId: string) => void;
}

interface IStageColumn {
  /** Etapa de la columna. */
  stage: IStageRead;
  /** Oportunidades de la columna (ordenadas por creación). */
  stageDeals: IDealRead[];
}

function groupDealsByStage(stages: IStageRead[], deals: IDealRead[]): IStageColumn[] {
  return stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      stage,
      stageDeals: deals
        .filter((deal) => deal.stage_id === stage.id)
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    }));
}

/**
 * Tablero Kanban del pipeline. Las columnas son focos navegables con las
 * flechas izquierda/derecha (alternativa accesible sin arrastrar).
 */
export function PipelineBoard({ stages, deals, onOpenDeal }: IPipelineBoardProps): ReactElement {
  const columns = groupDealsByStage(stages, deals);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);

  const handleColumnKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + step + columns.length) % columns.length;
    columnRefs.current[nextIndex]?.focus();
  };

  if (columns.length === 0) {
    return (
      <div
        role="region"
        aria-label="Tablero Kanban del pipeline"
        className="rounded-lg border border-slate-200 bg-white p-6"
      >
        <p className="text-sm text-slate-500" role="status">
          Aún no hay etapas configuradas en el pipeline.
        </p>
      </div>
    );
  }

  return (
    <div role="region" aria-label="Tablero Kanban del pipeline" className="overflow-x-auto">
      <div className="flex min-w-max gap-4">
        {columns.map(({ stage, stageDeals }, index) => (
          <div
            key={stage.id}
            ref={(node) => {
              columnRefs.current[index] = node;
            }}
            role="group"
            tabIndex={0}
            aria-label={`Etapa ${stage.name}, ${stageDeals.length} oportunidades`}
            className="w-72 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            onKeyDown={(event) => handleColumnKeyDown(event, index)}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">{stage.name}</h3>
              <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                {stageDeals.length}
              </span>
            </div>
            <div className="space-y-2">
              {stageDeals.length === 0 ? (
                <p className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
                  Sin oportunidades
                </p>
              ) : (
                stageDeals.map((deal) => (
                  <DealCard key={deal.id} deal={deal} onOpen={() => onOpenDeal(deal.id)} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
