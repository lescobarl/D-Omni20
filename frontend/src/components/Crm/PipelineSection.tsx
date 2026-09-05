import { useEffect, useState, type ReactElement } from 'react';
import { useCrmStore } from '@/store/crmStore';
import { Button, ErrorState } from '@/components/ui';
import { DealDrawer } from './DealDrawer';
import { FunnelView } from './FunnelView';
import { PipelineBoard } from './PipelineBoard';
import { SlaSettings } from './SlaSettings';
import { TasksSection } from './TasksSection';

type CrmView = 'pipeline' | 'tareas' | 'sla' | 'embudo';

const CRM_VIEWS: ReadonlyArray<{ id: CrmView; label: string; description: string }> = [
  { id: 'pipeline', label: 'Pipeline', description: 'Tablero Kanban de oportunidades por etapa.' },
  { id: 'tareas', label: 'Tareas', description: 'Seguimiento de tareas del pipeline.' },
  { id: 'sla', label: 'SLA', description: 'Políticas de respuesta y permanencia por etapa.' },
  { id: 'embudo', label: 'Embudo', description: 'Resumen comercial con tasas de conversión.' },
];

/**
 * Sección "Ventas" del área de Operaciones (CRM P3). Punto de entrada del tab
 * "Ventas": carga los datos del pipeline y orquesta las subvistas.
 */
export function CrmSection(): ReactElement {
  const listStages = useCrmStore((state) => state.listStages);
  const listDeals = useCrmStore((state) => state.listDeals);
  const listTasks = useCrmStore((state) => state.listTasks);
  const listSla = useCrmStore((state) => state.listSla);
  const getFunnel = useCrmStore((state) => state.getFunnel);
  const stages = useCrmStore((state) => state.stages);
  const deals = useCrmStore((state) => state.deals);
  const stagesStatus = useCrmStore((state) => state.stagesStatus);
  const dealsStatus = useCrmStore((state) => state.dealsStatus);
  const stagesError = useCrmStore((state) => state.stagesError);
  const dealsError = useCrmStore((state) => state.dealsError);
  const tasksError = useCrmStore((state) => state.tasksError);
  const slaError = useCrmStore((state) => state.slaError);
  const funnelError = useCrmStore((state) => state.funnelError);

  const [activeView, setActiveView] = useState<CrmView>('pipeline');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  useEffect(() => {
    void listStages();
    void listDeals();
    void listTasks();
    void listSla();
    void getFunnel();
  }, [listStages, listDeals, listTasks, listSla, getFunnel]);

  const isLoading =
    (stagesStatus === 'loading' && stages.length === 0) ||
    (dealsStatus === 'loading' && deals.length === 0);

  const viewButtonClass = (selected: boolean): string =>
    selected
      ? 'rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900'
      : 'rounded border border-transparent px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100';

  const renderView = (): ReactElement => {
    switch (activeView) {
      case 'pipeline':
        return <PipelineBoard stages={stages} deals={deals} onOpenDeal={setSelectedDealId} />;
      case 'tareas':
        return <TasksSection />;
      case 'sla':
        return <SlaSettings />;
      case 'embudo':
        return <FunnelView />;
    }
  };

  return (
    <section aria-labelledby="crm-heading">
      <h2 id="crm-heading" className="text-lg font-semibold text-slate-900">
        Ventas
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Pipeline comercial con Kanban, tareas, SLA y embudo (CRM P3).
      </p>
      <div role="group" aria-label="Vistas del CRM" className="mt-4 flex flex-wrap gap-2">
        {CRM_VIEWS.map((view) => (
          <Button
            key={view.id}
            variant="tab"
            type="button"
            aria-pressed={activeView === view.id}
            title={view.description}
            className={viewButtonClass(activeView === view.id)}
            onClick={() => setActiveView(view.id)}
          >
            {view.label}
          </Button>
        ))}
      </div>
      <div role="status" aria-live="polite" className="mt-2 space-y-1">
        {stagesError !== null && (
          <ErrorState message={stagesError} onRetry={() => void listStages()} />
        )}
        {dealsError !== null && (
          <ErrorState message={dealsError} onRetry={() => void listDeals()} />
        )}
        {tasksError !== null && (
          <ErrorState message={tasksError} onRetry={() => void listTasks()} />
        )}
        {slaError !== null && <ErrorState message={slaError} onRetry={() => void listSla()} />}
        {funnelError !== null && (
          <ErrorState message={funnelError} onRetry={() => void getFunnel()} />
        )}
      </div>
      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando pipeline…
        </p>
      ) : (
        <div className="mt-4">{renderView()}</div>
      )}
      {selectedDealId !== null && (
        <DealDrawer dealId={selectedDealId} onClose={() => setSelectedDealId(null)} />
      )}
    </section>
  );
}
