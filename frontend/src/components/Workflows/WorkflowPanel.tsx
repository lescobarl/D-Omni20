/**
 * Panel de configuración y ejecución de workflows de conversión.
 *
 * Contrato (FASE E - unificación de `workflowType`):
 * - La fuente única de verdad del tipo de workflow es `landing.workflowType`
 *   del store del editor (persistido), accedido vía `useEditorStoreContext`.
 * - Al seleccionar una pestaña se actualiza tanto el store del editor
 *   (`setWorkflowType` sobre `landing.workflowType`) como `useWorkflowStore`
 *   (`setWorkflowType`), manteniendo ambos sincronizados sin deriva.
 * - Un `useEffect` propaga cualquier cambio externo del `workflowType` del
 *   editor (p. ej. al cargar una landing con otro workflow) hacia
 *   `useWorkflowStore`, garantizando que el panel y el store de ejecución
 *   nunca discrepen.
 * - Expone una lista de pestañas accesible ("Tipos de workflow") con los 4
 *   workflows de `WORKFLOW_DEFINITIONS`.
 * - Renderiza el componente del workflow activo dentro de un `role="tabpanel"`.
 */
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { WORKFLOW_DEFINITIONS } from '@/core/workflows';
import { useWorkflowStore } from '@/store/workflowStore';
import { useEditorStoreContext } from '@/store/editorStoreContext';
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
  const editorStore = useEditorStoreContext();
  const workflowType = editorStore((state) => state.landing.workflowType);
  const setWorkflowType = editorStore((state) => state.setWorkflowType);

  // Mantiene `useWorkflowStore.workflowType` sincronizado con la fuente única de
  // verdad (`landing.workflowType`) ante cambios externos (p. ej. cargar una
  // landing con otro workflow o aplicar una generación IA).
  useEffect(() => {
    useWorkflowStore.getState().setWorkflowType(workflowType);
  }, [workflowType]);

  const handleSelect = (next: (typeof WORKFLOW_DEFINITIONS)[number]['type']): void => {
    setWorkflowType(next);
    useWorkflowStore.getState().setWorkflowType(next);
  };

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
            onClick={() => handleSelect(workflow.type)}
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
