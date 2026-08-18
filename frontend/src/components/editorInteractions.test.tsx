/**
 * Pruebas de interacción compleja del editor de landings.
 *
 * Contrato:
 * - Flujo completo librería → canvas → código compilado.
 * - Selección de bloques con `aria-pressed` (accesible).
 * - Eliminación de bloques y su impacto en canvas y código.
 * - Reordenamiento de bloques (movimiento arriba/abajo).
 * - Actualización de configuración reflejada en el código compilado.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/App';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import { useEditorStore } from '@/store/editorStore';
import { createTestConfig } from '@/test/config';

/**
 * Renderiza la aplicación y expone los tres paneles del editor.
 *
 * @returns Utilidad de eventos de usuario, librería, canvas y panel de código.
 */
function renderApp(): {
  user: ReturnType<typeof userEvent.setup>;
  library: HTMLElement;
  canvas: HTMLElement;
  codePanel: HTMLElement;
} {
  const user = userEvent.setup();
  render(<App config={createTestConfig()} />);
  const library = screen.getByRole('complementary', { name: 'Librería de bloques' });
  const canvas = screen.getByRole('main');
  const codePanel = screen.getByRole('complementary', { name: 'Editor de código' });
  return { user, library, canvas, codePanel };
}

/**
 * Devuelve el texto del código compilado visible en el panel de código.
 * @param codePanel - Panel de código del editor.
 * @returns Contenido textual del elemento `<code>` (o cadena vacía).
 */
function getCodeText(codePanel: HTMLElement): string {
  return codePanel.querySelector('code')?.textContent ?? '';
}

describe('Editor (interacciones complejas)', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
  });

  it('flujo completo: agrega bloques de la librería y los refleja en canvas y código', async () => {
    const { user, library, canvas, codePanel } = renderApp();

    // `act` explícito: los clics actualizan el store de Zustand y los suscriptores
    // (Canvas/CodeEditor) re-renderizan en un microtask posterior al act de user-event.
    await act(async () => {
      await user.click(within(library).getByRole('button', { name: /Hero con Video/ }));
    });
    await act(async () => {
      await user.click(within(library).getByRole('button', { name: /Calculadora JS/ }));
    });

    expect(within(canvas).getByText('¡Impulsa tu negocio!')).toBeInTheDocument();
    expect(within(canvas).getByText('Comprar ahora')).toBeInTheDocument();
    expect(within(canvas).getByText('Impuesto: 0.16 · Moneda: MXN')).toBeInTheDocument();

    const code = getCodeText(codePanel);
    expect(code).toContain('block--hero');
    expect(code).toContain('block--calculator');
    expect(code).toContain('data-title="Nueva Landing"');
  });

  it('selecciona bloques en el canvas mediante botones con aria-pressed', async () => {
    const { user, library, canvas } = renderApp();

    await act(async () => {
      await user.click(within(library).getByRole('button', { name: /Hero con Video/ }));
      await user.click(within(library).getByRole('button', { name: /Calculadora JS/ }));
    });

    expect(within(canvas).getByRole('button', { name: 'Hero con Video' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(canvas).getByRole('button', { name: 'Calculadora JS' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await act(async () => {
      await user.click(within(canvas).getByRole('button', { name: 'Hero con Video' }));
    });
    expect(within(canvas).getByRole('button', { name: 'Hero con Video' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(canvas).getByRole('button', { name: 'Calculadora JS' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(useEditorStore.getState().selectedBlockId).toBe(
      useEditorStore.getState().landing.blocks[0].instance_id,
    );

    await act(async () => {
      await user.click(within(canvas).getByRole('button', { name: 'Calculadora JS' }));
    });
    expect(within(canvas).getByRole('button', { name: 'Hero con Video' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(canvas).getByRole('button', { name: 'Calculadora JS' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('elimina un bloque del canvas y lo quita del código compilado', async () => {
    const { user, library, canvas, codePanel } = renderApp();

    await act(async () => {
      await user.click(within(library).getByRole('button', { name: /Hero con Video/ }));
      await user.click(within(library).getByRole('button', { name: /Calculadora JS/ }));
    });

    expect(within(canvas).getAllByRole('article')).toHaveLength(2);

    const heroArticle = within(canvas).getAllByRole('article')[0];
    await act(async () => {
      await user.click(within(heroArticle).getByRole('button', { name: 'Eliminar' }));
    });

    expect(within(canvas).getAllByRole('article')).toHaveLength(1);
    expect(within(canvas).queryByText('¡Impulsa tu negocio!')).not.toBeInTheDocument();
    expect(within(canvas).getByText('Impuesto: 0.16 · Moneda: MXN')).toBeInTheDocument();

    const code = getCodeText(codePanel);
    expect(code).not.toContain('block--hero');
    expect(code).toContain('block--calculator');
  });

  it('mueve un bloque hacia arriba y reordena canvas y código', async () => {
    const { canvas, codePanel } = renderApp();

    act(() => {
      useEditorStore.getState().addBlock(BLOCK_CATALOG[0]); // Hero con Video
      useEditorStore.getState().addBlock(BLOCK_CATALOG[2]); // Calculadora JS
    });

    const before = useEditorStore.getState().landing.blocks;
    expect(before.map((block) => block.name)).toEqual(['Hero con Video', 'Calculadora JS']);

    act(() => {
      useEditorStore.getState().moveBlock(before[1].instance_id, 'up');
    });

    expect(useEditorStore.getState().landing.blocks.map((block) => block.name)).toEqual([
      'Calculadora JS',
      'Hero con Video',
    ]);

    const articles = within(canvas).getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(articles[0].textContent).toContain('Calculadora JS');
    expect(articles[1].textContent).toContain('Hero con Video');

    const code = getCodeText(codePanel);
    expect(code.indexOf('block--calculator')).toBeLessThan(code.indexOf('block--hero'));
  });

  it('compila una landing completa con workflow, título y bloques', async () => {
    const { codePanel } = renderApp();

    act(() => {
      useEditorStore.getState().setLandingTitle('Landing de Prueba');
      useEditorStore.getState().addBlock(BLOCK_CATALOG[0]); // Hero con Video
      useEditorStore.getState().addBlock(BLOCK_CATALOG[1]); // Cuadrícula de Servicios
    });

    const code = getCodeText(codePanel);
    expect(code).toContain('<!-- OmniBotIA Studio | Workflow: direct_checkout | Campaign:  -->');
    expect(code).toContain('<section class="landing" data-title="Landing de Prueba">');
    expect(code).toContain('block--hero');
    expect(code).toContain('block--services_grid');
    expect(code).toMatch(
      /data-instance-id="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/i,
    );
  });

  it('actualiza la configuración de un bloque y se refleja en el código compilado', async () => {
    const { codePanel } = renderApp();

    act(() => {
      useEditorStore.getState().addBlock(BLOCK_CATALOG[2]); // Calculadora JS
    });

    expect(getCodeText(codePanel)).toContain('data-currency="MXN"');

    const calculator = useEditorStore.getState().landing.blocks[0];
    act(() => {
      useEditorStore.getState().updateBlockConfig(calculator.instance_id, { currency: 'USD' });
    });

    const code = getCodeText(codePanel);
    expect(code).toContain('data-currency="USD"');
    expect(code).not.toContain('data-currency="MXN"');
  });
});
