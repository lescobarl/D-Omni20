/**
 * Store de configuración del workflow de la landing.
 *
 * Contrato:
 * - Estado actualizado de forma inmutable (sin mutación de referencias previas).
 * - `DEFAULT_WORKFLOW_TYPE` es la fábrica del valor inicial por defecto.
 * - Gestiona los 4 tipos de workflows definidos en la especificación.
 */
import { create } from 'zustand';
import type { WorkflowType } from '@/types/editor';

/** Tipo de workflow por defecto al iniciar el editor. */
export const DEFAULT_WORKFLOW_TYPE: WorkflowType = 'direct_checkout';

/** Contrato del store de configuración de workflow. */
export interface IWorkflowState {
  /** Tipo de workflow seleccionado para la landing en edición. */
  workflowType: WorkflowType;
  /** Selecciona el tipo de workflow de la landing. */
  setWorkflowType(workflowType: WorkflowType): void;
  /** Reinicia el workflow al valor por defecto. */
  reset(): void;
}

/** Store de configuración del workflow de conversión. */
export const useWorkflowStore = create<IWorkflowState>()((set) => ({
  workflowType: DEFAULT_WORKFLOW_TYPE,
  setWorkflowType: (workflowType) => set({ workflowType }),
  reset: () => set({ workflowType: DEFAULT_WORKFLOW_TYPE }),
}));
