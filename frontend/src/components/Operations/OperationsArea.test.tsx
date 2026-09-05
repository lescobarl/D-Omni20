/**
 * Pruebas del contenedor de pestañas de «Operación del Bot» (Bloque B de LAE Omni2.0).
 *
 * Contrato:
 * - Expone un `tablist` accesible con las 9 pantallas B.1-B.9 en orden de presentación.
 * - «Dashboard» es la pestaña activa inicial y su panel está visible.
 * - Cambiar de pestaña actualiza `aria-selected` y la visibilidad de los paneles.
 * - Cada panel muestra su alcance y su eslabón del ciclo comercial.
 * - Fail-closed: no renderiza nada si el tenant no habilita `features.operations`.
 */
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperationsArea } from '@/components/Operations/OperationsArea';
import { createTestConfig } from '@/test/config';

/**
 * Nombres de las 9 pestañas en orden de presentación siguiendo el flujo orgánico:
 * Configuración (Plantillas, Árboles, Contactos, Campañas) → Operación en vivo
 * (Monitor, Intervención Humana, Mantenimiento) → Resultados (Dashboard, Estadísticas).
 */
const TAB_NAMES = [
  'Plantillas',
  'Árboles',
  'Contactos',
  'Campañas',
  'Monitor',
  'Intervención Humana',
  'Mantenimiento',
  'Dashboard',
  'Estadísticas',
] as const;

/**
 * Localiza el panel controlado por una pestaña navegando desde su `aria-controls`.
 *
 * `getByRole` no resuelve el nombre accesible de los paneles ocultos (calculado
 * vía `aria-labelledby`) ni siquiera con `hidden: true`, así que la ruta robusta
 * es seguir el cableado ARIA de la pestaña hasta el `id` real del panel. Esto
 * además fija como contrato que cada pestaña apunta a su panel correcto.
 */
function getPanelForTab(tabName: string): HTMLElement {
  const tab = screen.getByRole('tab', { name: tabName });
  const panelId = tab.getAttribute('aria-controls');
  const panel = panelId ? document.getElementById(panelId) : null;
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

/**
 * Config de prueba con la 3ª área «Operación del bot» habilitada, ya que el
 * componente es fail-closed: sin `features.operations` no renderiza nada.
 */
function createOperationsConfig() {
  return createTestConfig({
    features: { ...createTestConfig().features, operations: true },
  });
}

describe('OperationsArea', () => {
  it('expone un tablist accesible con las 9 pantallas B.1-B.9 en orden', () => {
    render(<OperationsArea config={createOperationsConfig()} />);

    expect(screen.getByRole('tablist', { name: 'Operación del bot' })).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(9);
    expect(tabs.map((tab) => tab.textContent)).toEqual([...TAB_NAMES]);
  });

  it('parte con «Dashboard» como pestaña activa y su panel visible', () => {
    render(<OperationsArea config={createOperationsConfig()} />);

    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');

    const dashboardPanel = screen.getByRole('tabpanel', { name: 'Dashboard' });
    expect(dashboardPanel).not.toHaveAttribute('hidden');
    expect(dashboardPanel).toBeVisible();
    // El panel muestra el alcance real del Dashboard (B.1), no el placeholder.
    expect(
      within(dashboardPanel).getByText(
        'Visión general del bot en tiempo real: KPIs de conversación, cuota L1, estado de la cola D3 y últimas conversaciones del tenant.',
      ),
    ).toBeInTheDocument();

    // El resto de paneles permanecen montados pero ocultos (`hidden`). Se localizan
    // desde su pestaña (`aria-controls`) porque `getByRole` no resuelve el nombre
    // accesible de los paneles ocultos en el árbol de accesibilidad. Se excluye
    // «Dashboard» explícitamente (no por posición) porque es la pestaña activa y
    // en el flujo orgánico ya no ocupa la primera posición.
    for (const name of TAB_NAMES.filter((tabName) => tabName !== 'Dashboard')) {
      expect(getPanelForTab(name)).toHaveAttribute('hidden');
    }
  });

  it('cambia de pestaña al pulsar y muestra el panel correspondiente', async () => {
    const user = userEvent.setup();
    render(<OperationsArea config={createOperationsConfig()} />);

    // `act` explícito: el clic actualiza el estado local de la pestaña y la
    // re-renderización ocurre en un microtask posterior al act de user-event.
    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Árboles' }));
    });

    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: 'Árboles' })).toHaveAttribute('aria-selected', 'true');

    const treesPanel = screen.getByRole('tabpanel', { name: 'Árboles' });
    expect(treesPanel).not.toHaveAttribute('hidden');
    expect(treesPanel).toBeVisible();

    // Contenido del panel: sección de árboles (B.3) con su eslabón del ciclo comercial.
    expect(within(treesPanel).getByRole('heading', { name: 'Árboles' })).toBeInTheDocument();
    expect(within(treesPanel).getByText('Conversación ③')).toBeInTheDocument();

    // El panel anterior queda oculto (localizado desde su pestaña).
    expect(getPanelForTab('Dashboard')).toHaveAttribute('hidden');
  });

  it('recorre todas las pestañas y respeta sus eslabones del ciclo comercial', async () => {
    const user = userEvent.setup();
    render(<OperationsArea config={createOperationsConfig()} />);

    const cases: ReadonlyArray<{ name: string; eslabon: string }> = [
      { name: 'Dashboard', eslabon: 'Ciclo completo ①-⑨' },
      { name: 'Estadísticas', eslabon: 'Ciclo completo ①-⑨' },
      { name: 'Árboles', eslabon: 'Conversación ③' },
      { name: 'Campañas', eslabon: 'Captación ① · Recuperación ⑦ · Recompra ⑨' },
      { name: 'Plantillas', eslabon: 'Conversación ③ · Cierre ⑥' },
      { name: 'Contactos', eslabon: 'Captación ①' },
      { name: 'Intervención Humana', eslabon: 'Vendedor ⑤' },
      { name: 'Monitor', eslabon: 'Operación continua' },
      { name: 'Mantenimiento', eslabon: 'Operación continua' },
    ];

    for (const testCase of cases) {
      await act(async () => {
        await user.click(screen.getByRole('tab', { name: testCase.name }));
      });

      const panel = screen.getByRole('tabpanel', { name: testCase.name });
      expect(panel).toBeVisible();
      expect(within(panel).getByText(testCase.eslabon)).toBeInTheDocument();
    }
  });

  it('no renderiza nada cuando la feature está deshabilitada (fail-closed)', () => {
    render(<OperationsArea config={createTestConfig()} />);

    expect(screen.queryByRole('tablist', { name: 'Operación del bot' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Dashboard' })).toBeNull();
  });
});
