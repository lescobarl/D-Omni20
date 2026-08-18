/**
 * Definiciones de workflows de conversión de la landing.
 *
 * Contrato:
 * - `WORKFLOW_DEFINITIONS` expone los 4 workflows soportados (alineados con
 *   `plans/omnibotia_studio_spec.md`).
 * - `getWorkflowDefinition` resuelve la metadata de un workflow por tipo.
 * - Es lógica pura: sin estado ni dependencias del DOM.
 */
import type { WorkflowType } from '@/types/editor';

/** Metadata funcional de un workflow de conversión. */
export interface IWorkflowDefinition {
  /** Tipo canónico del workflow. */
  type: WorkflowType;
  /** Nombre visible del workflow. */
  name: string;
  /** Descripción funcional del workflow. */
  description: string;
}

/** Lista inmutable de los 4 workflows de conversión soportados. */
export const WORKFLOW_DEFINITIONS: readonly IWorkflowDefinition[] = [
  {
    type: 'direct_checkout',
    name: 'Checkout Directo',
    description: 'Venta directa con integración de pasarela de pago (Stripe).',
  },
  {
    type: 'lead_capture',
    name: 'Captura de Leads',
    description: 'Captura de prospectos con formulario y validación de datos.',
  },
  {
    type: 'quote_generator',
    name: 'Generador de Cotizaciones',
    description: 'Cotización automática de servicios o productos seleccionados.',
  },
  {
    type: 'appointment_scheduler',
    name: 'Agendador de Citas',
    description: 'Reserva y gestión de citas mediante calendario integrado.',
  },
];

/**
 * Resuelve la definición de un workflow por su tipo.
 *
 * @example
 * ```ts
 * const definition = getWorkflowDefinition('quote_generator');
 * // { type: 'quote_generator', name: 'Generador de Cotizaciones', ... }
 * ```
 *
 * @param type - Tipo de workflow a resolver.
 * @returns La definición del workflow o `undefined` si no existe.
 */
export function getWorkflowDefinition(type: WorkflowType): IWorkflowDefinition | undefined {
  return WORKFLOW_DEFINITIONS.find((definition) => definition.type === type);
}
