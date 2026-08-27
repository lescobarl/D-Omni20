/**
 * Pruebas del panel de vista previa del HTML compilado.
 *
 * Contrato:
 * - Muestra un iframe aislado (`sandbox=""`) con el HTML compilado en estado success.
 * - Alterna la minificación (`minify`/`setMinify`) y descarga el HTML compilado solo
 *   cuando hay resultado (`status === 'success'`).
 * - Representa cada estado del flujo: placeholder (idle), compilación (compiling),
 *   error accesible (`role="alert"`) y duración final (success).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewPanel } from '@/components/Editor/Preview/PreviewPanel';
import { serializeLandingConfig } from '@/core/landingCode';
import { REALTIME_COMPILE_DEBOUNCE_MS } from '@/hooks/useCompiledLanding';
import { downloadHtml } from '@/lib/htmlDownload';
import type { ICompilationResult, ICompilerService } from '@/services/compilerService';
import { useCdnStore } from '@/store/cdnStore';
import { setCompilerService, useCompilerStore } from '@/store/compilerStore';
import { useEditorStore } from '@/store/editorStore';

/** El módulo de descarga se dobla para aislar el render (sin Blob ni anclas reales). */
vi.mock('@/lib/htmlDownload', () => ({
  buildDownloadFileName: (title: string) => `${title}.html`,
  downloadHtml: vi.fn(),
}));

const SAMPLE_HTML = '<section><h1>Hola</h1><p>Preview</p></section>';

/** Resultado de compilación por defecto para los dobles. */
function makeResult(overrides: Partial<ICompilationResult> = {}): ICompilationResult {
  return {
    html: '<section class="landing" data-title="Demo"></section>',
    durationMs: 12.5,
    compiledAt: '2026-08-18T15:00:00Z',
    ...overrides,
  };
}

/** Servicio de compilación doble con `compile` espía. */
function makeService(): ICompilerService {
  return { compile: vi.fn(async () => makeResult()) };
}

/**
 * Avanza el tiempo del debounce dentro de `act` para disparar la compilación
 * diferida y esperar la continuación async de `compile`.
 */
async function advanceDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REALTIME_COMPILE_DEBOUNCE_MS);
  });
}

describe('PreviewPanel', () => {
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
    vi.mocked(downloadHtml).mockClear();
  });

  it('renderiza la cabecera, el checkbox de minificar y el botón de descarga', () => {
    render(<PreviewPanel />);

    expect(screen.getByRole('heading', { name: 'Vista previa' })).toBeInTheDocument();
    expect(screen.getByLabelText('Minificar HTML')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Descargar HTML' })).toBeDisabled();
  });

  it('muestra el placeholder en estado idle sin iframe', () => {
    const { container } = render(<PreviewPanel />);

    expect(screen.getByText(/Compila la landing para ver la vista previa/)).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('alterna la opción de minificar el HTML', async () => {
    const user = userEvent.setup();
    render(<PreviewPanel />);

    await act(async () => {
      await user.click(screen.getByLabelText('Minificar HTML'));
    });

    expect(useCompilerStore.getState().minify).toBe(true);
    expect(screen.getByLabelText('Minificar HTML')).toBeChecked();
  });

  it('muestra el HTML compilado en un iframe aislado en estado success', () => {
    useCompilerStore.setState({
      status: 'success',
      html: SAMPLE_HTML,
      durationMs: 12,
      error: null,
    });
    const { container } = render(<PreviewPanel />);

    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('srcdoc')).toBe(SAMPLE_HTML);
    expect(frame?.getAttribute('title')).toBe('Vista previa de la landing');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(screen.getByRole('button', { name: 'Descargar HTML' })).toBeEnabled();
  });

  it('muestra la duración de la compilación al terminar', () => {
    useCompilerStore.setState({
      status: 'success',
      html: SAMPLE_HTML,
      durationMs: 1234,
      error: null,
    });
    render(<PreviewPanel />);

    expect(screen.getByText('Compilado en 1234 ms')).toBeInTheDocument();
  });

  it('descarga el HTML con el nombre derivado del título de la landing', async () => {
    useEditorStore.getState().setLandingTitle('Mi Landing');
    useCompilerStore.setState({
      status: 'success',
      html: SAMPLE_HTML,
      durationMs: 12,
      error: null,
    });
    const user = userEvent.setup();
    render(<PreviewPanel />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Descargar HTML' }));
    });

    expect(vi.mocked(downloadHtml)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadHtml)).toHaveBeenCalledWith(SAMPLE_HTML, 'Mi Landing.html');
  });

  it('no descarga cuando no hay un resultado compilado', async () => {
    const user = userEvent.setup();
    render(<PreviewPanel />);

    const button = screen.getByRole('button', { name: 'Descargar HTML' });
    expect(button).toBeDisabled();
    await act(async () => {
      await user.click(button);
    });

    expect(vi.mocked(downloadHtml)).not.toHaveBeenCalled();
  });

  it('muestra el estado de compilación con su mensaje y el iframe', () => {
    useCompilerStore.setState({ status: 'compiling', html: '', durationMs: null, error: null });
    const { container } = render(<PreviewPanel />);

    expect(screen.getByText('Compilando…')).toBeInTheDocument();
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('muestra el mensaje de error en un rol alert', () => {
    useCompilerStore.setState({
      status: 'error',
      html: '',
      durationMs: null,
      error: 'El compilador no está disponible.',
    });
    render(<PreviewPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent('El compilador no está disponible.');
    expect(screen.getByRole('button', { name: 'Descargar HTML' })).toBeDisabled();
  });

  it('usa un mensaje por defecto cuando el error no tiene detalle', () => {
    useCompilerStore.setState({ status: 'error', html: '', durationMs: null, error: null });
    render(<PreviewPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo compilar la landing.');
  });

  it('oculta el panel de despliegue al CDN cuando la bandera está desactivada', () => {
    render(<PreviewPanel />);

    expect(screen.queryByRole('heading', { name: 'Despliegue al CDN' })).not.toBeInTheDocument();
  });

  it('muestra el panel de despliegue al CDN cuando la bandera está activa', () => {
    render(<PreviewPanel cdnDeploy />);

    expect(screen.getByRole('heading', { name: 'Despliegue al CDN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desplegar al CDN' })).toBeInTheDocument();
  });
});

describe('PreviewPanel · integración de la compilación en tiempo real', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      setCompilerService(null);
      useCompilerStore.getState().reset();
    });
    vi.useRealTimers();
  });

  it('compila la landing tras el debounce y muestra el resultado cuando hay servicio', async () => {
    const service = makeService();
    setCompilerService(service);
    const landing = useEditorStore.getState().landing;

    const { container } = render(<PreviewPanel />);

    expect(service.compile).not.toHaveBeenCalled();
    await advanceDebounce();

    expect(service.compile).toHaveBeenCalledTimes(1);
    expect(service.compile).toHaveBeenCalledWith({
      config: serializeLandingConfig(landing),
      minify: false,
    });
    expect(screen.getByText(/Compilado en \d+ ms/)).toBeInTheDocument();
    expect(container.querySelector('iframe')).not.toBeNull();
  });
});
