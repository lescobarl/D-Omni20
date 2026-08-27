/**
 * Pruebas del panel de workflows del editor.
 *
 * Contrato:
 * - Renderiza el encabezado `<h2>Workflows</h2>` y la lista de pestañas accesible
 *   ("Tipos de workflow") con los 4 workflows de `WORKFLOW_DEFINITIONS`.
 * - Por defecto muestra el workflow activo `direct_checkout` (formulario de
 *   "Checkout Directo").
 * - Cambiar de pestaña actualiza el store (`setWorkflowType`) y muestra el
 *   formulario del workflow seleccionado.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowPanel } from '@/components/Workflows/WorkflowPanel';
import { useWorkflowStore } from '@/store/workflowStore';

describe('WorkflowPanel', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
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

    // `act` explícito: el clic actualiza el store de Zustand y los suscriptores
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
});
