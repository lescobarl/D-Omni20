/**
 * Pruebas de las definiciones de workflows de conversión.
 *
 * Contrato:
 * - `WORKFLOW_DEFINITIONS` expone los 4 workflows de la especificación.
 * - `getWorkflowDefinition` resuelve la metadata por tipo.
 */
import { describe, expect, it } from 'vitest';
import { getWorkflowDefinition, WORKFLOW_DEFINITIONS } from '@/core/workflows';
import type { WorkflowType } from '@/types/editor';

describe('WORKFLOW_DEFINITIONS', () => {
  it('expone los 4 workflows definidos en la especificación', () => {
    expect(WORKFLOW_DEFINITIONS).toHaveLength(4);
  });

  it('cubre de forma exhaustiva todos los WorkflowType soportados', () => {
    const types: WorkflowType[] = WORKFLOW_DEFINITIONS.map((definition) => definition.type);
    const expected: WorkflowType[] = [
      'direct_checkout',
      'lead_capture',
      'quote_generator',
      'appointment_scheduler',
    ];

    expect(types.sort()).toEqual(expected.sort());
  });

  it('expone metadata completa para cada definición', () => {
    for (const definition of WORKFLOW_DEFINITIONS) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});

describe('getWorkflowDefinition', () => {
  it('resuelve una definición existente por tipo', () => {
    const definition = getWorkflowDefinition('quote_generator');
    expect(definition?.name).toBe('Generador de Cotizaciones');
  });

  it('devuelve undefined para un tipo inexistente', () => {
    expect(getWorkflowDefinition('inexistente' as WorkflowType)).toBeUndefined();
  });
});
