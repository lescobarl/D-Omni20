/**
 * Panel de configuración y ejecución de workflows de conversión.
 *
 * Contrato:
 * - Lee el tipo de workflow seleccionado (`workflowType`) y su selector
 *   (`setWorkflowType`) desde `useWorkflowStore` (delegación de estado al store,
 *   según `src/components/Workflows/README.md`).
 * - Expone una lista de pestañas accesible ("Tipos de workflow") con los 4
 *   workflows de `WORKFLOW_DEFINITIONS`.
 * - Renderiza el componente del workflow activo dentro de un `role="tabpanel"`.
 */
import type { ReactElement } from 'react';
import { WORKFLOW_DEFINITIONS } from '@/core/workflows';
import { useWorkflowStore } from '@/store/workflowStore';
import { AppointmentSchedulerWorkflow } from './AppointmentSchedulerWorkflow';
import { CheckoutWorkflow } from './CheckoutWorkflow';
import { LeadCaptureWorkflow } from './LeadCaptureWorkflow';
import { QuoteGeneratorWorkflow } from './QuoteGeneratorWorkflow';

/** Devuelve las clases del botón de pestaña según su selección. */
function workflowTabButtonClass(selected: boolean): string {
  return `flex-1 border-b-2 px-3 py-2 text-sm font-medium transition ${
    selected
      ? 'border-brand-600 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;
}

/**
 * Panel de workflows del editor.
 *
 * @example
 * ```tsx
 * <WorkflowPanel />
 * ```
 *
 * @returns El selector de tipo de workflow y el formulario del workflow activo.
 */
export function WorkflowPanel(): ReactElement {
  const workflowType = useWorkflowStore((state) => state.workflowType);
  const setWorkflowType = useWorkflowStore((state) => state.setWorkflowType);

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Workflows</h2>

      <div role="tablist" aria-label="Tipos de workflow" className="mb-4 flex">
        {WORKFLOW_DEFINITIONS.map((workflow) => (
          <button
            key={workflow.type}
            id={`workflow-tab-${workflow.type}`}
            type="button"
            role="tab"
            aria-selected={workflowType === workflow.type}
            aria-controls="workflow-panel-active"
            onClick={() => setWorkflowType(workflow.type)}
            className={workflowTabButtonClass(workflowType === workflow.type)}
          >
            {workflow.name}
          </button>
        ))}
      </div>

      <div
        id="workflow-panel-active"
        role="tabpanel"
        aria-labelledby={`workflow-tab-${workflowType}`}
      >
        {workflowType === 'direct_checkout' && <CheckoutWorkflow />}
        {workflowType === 'lead_capture' && <LeadCaptureWorkflow />}
        {workflowType === 'quote_generator' && <QuoteGeneratorWorkflow />}
        {workflowType === 'appointment_scheduler' && <AppointmentSchedulerWorkflow />}
      </div>
    </div>
  );
}
