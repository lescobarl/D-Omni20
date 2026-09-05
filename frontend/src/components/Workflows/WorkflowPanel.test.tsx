/**
 * Pruebas del panel de workflows del editor.
 *
 * Contrato:
 * - Renderiza el encabezado `<h2>Workflows</h2>` y la lista de pestañas accesible
 *   ("Tipos de workflow") con los 4 workflows de `WORKFLOW_DEFINITIONS`.
 * - Por defecto muestra el workflow activo `direct_checkout` (formulario de
 *   "Checkout Directo").
 * - Cambiar de pestaña actualiza tanto el store del editor (`landing.workflowType`,
 *   fuente única de verdad) como `useWorkflowStore` (`setWorkflowType`), y muestra
 *   el formulario del workflow seleccionado (FASE E: sin deriva entre stores).
 * - Un cambio externo del `workflowType` de la landing (p. ej. al cargar una landing)
 *   se refleja automáticamente en el panel y se propaga a `useWorkflowStore`.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowPanel } from '@/components/Workflows/WorkflowPanel';
import { useWorkflowStore } from '@/store/workflowStore';
import { useEditorStore } from '@/store/editorStore';
import type { ILandingConfig } from '@/types/editor';

/** Construye una landing de prueba con el workflow indicado. */
function makeLanding(workflowType: ILandingConfig['workflowType']): ILandingConfig {
  return {
    id: 'landing-test',
    campaignId: 'campaign-test',
    title: 'Landing de prueba',
    workflowType,
    blocks: [],
  };
}

describe('WorkflowPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkflowStore.getState().reset();
    useEditorStore.getState().reset();
  });

  it('renderiza el encabezado y las 4 pestañas de workflow', () => {
    render(<WorkflowPanel />);

    expect(screen.getByRole('heading', { level: 2, name: 'Workflows' })).toBeInTheDocument();

    const tablist = screen.getByRole('tablist', { name: 'Tipos de workflow' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tablist).toContainElement(tabs[0]);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Checkout Directo',
      'Captura de Leads',
      'Generador de Cotizaciones',
      'Agendador de Citas',
    ]);
  });

  it('muestra el formulario del workflow por defecto (Checkout Directo)', () => {
    render(<WorkflowPanel />);

    expect(screen.getByRole('heading', { level: 3, name: 'Checkout Directo' })).toBeInTheDocument();
    const activeTab = screen.getByRole('tab', { name: 'Checkout Directo' });
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  it('cambia al generador de cotizaciones al seleccionar su pestaña', async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel />);

    // `act` explícito: el clic actualiza los stores de Zustand y los suscriptores
    // re-renderizan en un microtask posterior al act de user-event.
    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Generador de Cotizaciones' }));
    });

    expect(
      screen.getByRole('heading', { level: 3, name: 'Generador de Cotizaciones' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Generador de Cotizaciones' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(useWorkflowStore.getState().workflowType).toBe('quote_generator');
  });

  it('vincula la pestaña activa con el panel activo mediante aria-controls', async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Agendador de Citas' }));
    });

    const activeTab = screen.getByRole('tab', { name: 'Agendador de Citas' });
    const panel = screen.getByRole('tabpanel');
    expect(activeTab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', activeTab.id);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Agendador de Citas' }),
    ).toBeInTheDocument();
  });

  it('al cambiar de pestaña actualiza la landing del editor (fuente única de verdad)', async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Captura de Leads' }));
    });

    // E.1.2: el panel y la landing del editor quedan sincronizados.
    expect(useEditorStore.getState().landing.workflowType).toBe('lead_capture');
    expect(useWorkflowStore.getState().workflowType).toBe('lead_capture');
    expect(screen.getByRole('tab', { name: 'Captura de Leads' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('refleja automáticamente un cambio externo del workflowType de la landing (E.2.1)', async () => {
    // Simula la carga de una landing cuyo workflow es appointment_scheduler.
    act(() => {
      useEditorStore.getState().setLanding(makeLanding('appointment_scheduler'));
    });

    render(<WorkflowPanel />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Agendador de Citas' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agendador de Citas' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // El cambio externo se propaga a useWorkflowStore para evitar deriva.
    expect(useWorkflowStore.getState().workflowType).toBe('appointment_scheduler');
  });
});
