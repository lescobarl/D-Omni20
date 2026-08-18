/**
 * Pruebas del store de configuración de workflow con tests de inmutabilidad.
 *
 * Contrato:
 * - `setWorkflowType` actualiza el valor sin mutar el estado previo.
 * - `reset` restaura el workflow por defecto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from '@/store/workflowStore';

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  it('inicia con el workflow por defecto direct_checkout', () => {
    expect(useWorkflowStore.getState().workflowType).toBe('direct_checkout');
  });

  it('actualiza el workflow sin mutar el estado previo (inmutabilidad)', () => {
    const previous = useWorkflowStore.getState();
    useWorkflowStore.getState().setWorkflowType('quote_generator');

    const current = useWorkflowStore.getState();
    expect(current.workflowType).toBe('quote_generator');
    expect(previous.workflowType).toBe('direct_checkout');
    expect(previous).not.toBe(current);
  });

  it('reinicia al workflow por defecto', () => {
    useWorkflowStore.getState().setWorkflowType('appointment_scheduler');
    useWorkflowStore.getState().reset();

    expect(useWorkflowStore.getState().workflowType).toBe('direct_checkout');
  });
});
