/**
 * Pruebas de accesibilidad (a11y) mediante axe-core.
 *
 * Contrato:
 * - Audita la aplicación completa y cada componente clave del editor.
 * - Verifica que no existan violaciones WCAG detectables por axe-core.
 * - `color-contrast` se desactiva por defecto: jsdom no implementa el cálculo
 *   de estilos derivados que la regla requiere para ser fiable.
 * - Los componentes aislados se envuelven en `<main>` para satisfacer la regla
 *   `region` (todo el contenido debe estar contenido por landmarks).
 */
import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import App from '@/App';
import { EditorLayout } from '@/components/Editor/EditorLayout';
import { Canvas } from '@/components/Editor/Canvas/Canvas';
import { BlocksLibrary } from '@/components/Editor/Sidebar/BlocksLibrary';
import { CodeEditor } from '@/components/Editor/CodeEditor/CodeEditor';
import { BlockRenderer } from '@/components/Blocks/BlockRenderer';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import { createBlockInstance } from '@/core/blocks';
import { createTestConfig } from '@/test/config';
import { useEditorStore } from '@/store/editorStore';

describe('Accesibilidad (a11y)', () => {
  beforeAll(() => {
    // `index.html` declara `lang="es"`; lo replicamos en jsdom para la regla
    // `html-has-lang` (el documento de prueba no la trae por defecto).
    document.documentElement.setAttribute('lang', 'es');
  });

  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
  });

  it('audita la aplicación completa sin violaciones', async () => {
    const { container } = render(<App config={createTestConfig()} />);

    await expect(container).toHaveNoViolations();
  });

  it('audita el layout tri-panel del editor sin violaciones', async () => {
    const { container } = render(<EditorLayout />);

    await expect(container).toHaveNoViolations();
  });

  it('audita el canvas en estado vacío sin violaciones', async () => {
    const { container } = render(
      <main>
        <Canvas />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('audita la librería de bloques sin violaciones', async () => {
    const { container } = render(
      <main>
        <BlocksLibrary />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('audita el editor de código sin violaciones', async () => {
    const { container } = render(
      <main>
        <CodeEditor />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it.each(BLOCK_CATALOG)('audita el renderizador $name sin violaciones', async (definition) => {
    const instance = createBlockInstance(definition);
    const { container } = render(
      <main>
        <BlockRenderer block={instance} />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('audita el canvas con bloques insertados sin violaciones', async () => {
    // `act` explícito: las mutaciones al store notifican a los suscriptores
    // (Canvas) en un microtask posterior al act de RTL.
    await act(async () => {
      useEditorStore.getState().addBlock(BLOCK_CATALOG[0]);
      useEditorStore.getState().addBlock(BLOCK_CATALOG[1]);
    });

    const { container } = render(
      <main>
        <Canvas />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });
});
