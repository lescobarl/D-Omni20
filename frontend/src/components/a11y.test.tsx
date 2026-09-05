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
import { EditorRightPanel } from '@/components/Editor/RightPanel/EditorRightPanel';
import { PreviewPanel } from '@/components/Editor/Preview/PreviewPanel';
import { Canvas } from '@/components/Editor/Canvas/Canvas';
import { BlocksLibrary } from '@/components/Editor/Sidebar/BlocksLibrary';
import { EditorSidebar } from '@/components/Editor/Sidebar/EditorSidebar';
import { AIPanel } from '@/components/Editor/Sidebar/AIPanel';
import { CodeEditor } from '@/components/Editor/CodeEditor/CodeEditor';
import { BlockRenderer } from '@/components/Blocks/BlockRenderer';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import { createBlockInstance } from '@/core/blocks';
import { createTestConfig } from '@/test/config';
import { useCompilerStore } from '@/store/compilerStore';
import { useEditorStore } from '@/store/editorStore';
import { resetAuthSession, seedAuthenticatedSession } from '@/test/authSession';
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Toast } from '@/components/ui';

describe('Accesibilidad (a11y)', () => {
  beforeAll(() => {
    // `index.html` declara `lang="es"`; lo replicamos en jsdom para la regla
    // `html-has-lang` (el documento de prueba no la trae por defecto).
    document.documentElement.setAttribute('lang', 'es');
  });

  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
    useCompilerStore.getState().reset();
    resetAuthSession();
    seedAuthenticatedSession();
  });

  it('audita la aplicación completa sin violaciones', async () => {
    // `act` asíncrono: el editor diferido de Monaco (React.lazy) resuelve como
    // recurso suspendido; esperarlo dentro de act evita warnings de React.
    let container!: HTMLElement;
    await act(async () => {
      container = render(<App config={createTestConfig()} />).container;
    });
    // Drena los microtasks pendientes (importación diferida de Monaco) dentro de
    // act; sin esto el warning de recurso suspendido se emitiría en el test.
    await act(async () => {});

    await expect(container).toHaveNoViolations();
  });

  it('audita el layout tri-panel del editor sin violaciones', async () => {
    let container!: HTMLElement;
    await act(async () => {
      container = render(<EditorLayout config={createTestConfig()} />).container;
    });
    await act(async () => {});

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
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <main>
          <CodeEditor />
        </main>,
      ).container;
    });
    await act(async () => {});

    await expect(container).toHaveNoViolations();
  });

  it('audita el panel derecho con pestañas Código | Vista previa sin violaciones', async () => {
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <main>
          <EditorRightPanel config={createTestConfig()} />
        </main>,
      ).container;
    });
    await act(async () => {});

    await expect(container).toHaveNoViolations();
  });

  it('audita el panel de vista previa en estado vacío sin violaciones', async () => {
    const { container } = render(
      <main>
        <PreviewPanel />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('audita el panel de vista previa en estado de error sin violaciones', async () => {
    useCompilerStore.setState({ status: 'error', error: 'Error de compilación' });

    const { container } = render(
      <main>
        <PreviewPanel />
      </main>,
    );

    // El estado de error no renderiza el iframe, por lo que axe puede auditar el
    // contenedor sin el fallo "Respondable target must be a frame" (jsdom no
    // soporta la inyección de axe en iframes). Los atributos a11y del iframe
    // (title, sandbox) se verifican de forma estática en PreviewPanel.test.tsx.
    await expect(container).toHaveNoViolations();
  });

  it('audita la barra lateral del editor con pestañas sin violaciones', async () => {
    const config = createTestConfig({
      features: { ...createTestConfig().features, aiAssistant: true },
    });
    const { container } = render(
      <main>
        <EditorSidebar config={config} />
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('audita el panel del asistente IA sin violaciones', async () => {
    const { container } = render(
      <main>
        <AIPanel />
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

  it('audita los componentes compartidos de la librería ui sin violaciones', async () => {
    const { container } = render(
      <main>
        <div className="space-y-3">
          <Button>Crear contacto</Button>
          <Button variant="secondary" size="sm">
            Editar
          </Button>
          <Input label="Teléfono" required />
          <Input label="Correo" error="Correo inválido" />
          <Badge tone="sky">25%</Badge>
          <EmptyState title="Aún no hay contactos en el directorio." />
          <ErrorState
            message="No se pudieron cargar los contactos."
            detail="Detalle técnico"
            onRetry={() => undefined}
          />
          <Toast items={[{ id: '1', tone: 'success', message: 'Contacto creado' }]} />
        </div>
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });

  it('audita el diálogo modal compartido sin violaciones', async () => {
    const { container } = render(
      <main>
        <Modal open onClose={() => undefined} title="Detalle de la oportunidad">
          Contenido del detalle
        </Modal>
      </main>,
    );

    await expect(container).toHaveNoViolations();
  });
});
