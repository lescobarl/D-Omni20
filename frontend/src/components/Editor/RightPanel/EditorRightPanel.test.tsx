/**
 * Pruebas del panel derecho del editor con pestañas Código | Vista previa.
 *
 * Contrato:
 * - Implementa semántica de pestañas accesible (`tablist`/`tab`/`tabpanel`).
 * - Por defecto arranca en la pestaña de código.
 * - Ambos paneles permanecen montados (se ocultan con `hidden`): preserva el
 *   contrato `querySelector('code')` del editor de código al alternar.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorRightPanel } from '@/components/Editor/RightPanel/EditorRightPanel';
import { useCdnStore } from '@/store/cdnStore';
import { useCompilerStore } from '@/store/compilerStore';
import { useEditorStore } from '@/store/editorStore';
import { createTestConfig } from '@/test/config';

describe('EditorRightPanel', () => {
  beforeEach(() => {
    useCompilerStore.getState().reset();
    useCompilerStore.getState().setMinify(false);
    useEditorStore.getState().reset();
    useCdnStore.getState().reset();
  });

  afterEach(() => {
    act(() => {
      useCompilerStore.getState().reset();
      useCompilerStore.getState().setMinify(false);
      useEditorStore.getState().reset();
      useCdnStore.getState().reset();
    });
  });

  it('arranca en la pestaña de código por defecto', () => {
    render(<EditorRightPanel config={createTestConfig()} />);

    expect(screen.getByRole('tablist', { name: 'Panel derecho del editor' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Código' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Vista previa' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tabpanel', { name: 'Código' })).not.toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Código' })).toBeInTheDocument();
  });

  it('cambia a la pestaña de vista previa y muestra el panel', async () => {
    const user = userEvent.setup();
    render(<EditorRightPanel config={createTestConfig()} />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Vista previa' }));
    });

    expect(screen.getByRole('tab', { name: 'Vista previa' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Vista previa' })).not.toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Vista previa' })).toBeInTheDocument();
    // `hidden` saca el panel inactivo del árbol de accesibilidad: se consulta por id.
    expect(document.getElementById('right-panel-code')).toHaveAttribute('hidden');
  });

  it('mantiene ambos paneles montados al alternar (no desmonta el código)', async () => {
    const user = userEvent.setup();
    render(<EditorRightPanel config={createTestConfig()} />);

    expect(document.getElementById('right-panel-code')?.querySelector('code')).not.toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Vista previa' }));
    });

    const codePanel = document.getElementById('right-panel-code');
    expect(codePanel).not.toBeNull();
    expect(codePanel).toHaveAttribute('hidden');
    // El <code> del editor sigue presente aunque el panel esté oculto.
    expect(codePanel?.querySelector('code')).not.toBeNull();
    expect(document.getElementById('right-panel-preview')).not.toBeNull();
  });

  it('muestra el panel de despliegue al CDN en la vista previa cuando la bandera está activa', async () => {
    const user = userEvent.setup();
    const config = createTestConfig({
      features: {
        ...createTestConfig().features,
        cdnDeploy: true,
      },
    });
    render(<EditorRightPanel config={config} />);

    // Por defecto la bandera está desactivada: el panel de CDN no aparece.
    expect(screen.queryByRole('heading', { name: 'Despliegue al CDN' })).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Vista previa' }));
    });

    expect(screen.getByRole('heading', { name: 'Despliegue al CDN' })).toBeInTheDocument();
  });
});
