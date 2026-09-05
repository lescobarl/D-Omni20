/**
 * Pruebas del panel del asistente IA (generación de landings).
 *
 * Contrato:
 * - Renderiza el formulario con prompt, workflow (4 opciones) y botón de generación.
 * - Ejecuta la generación vía `useAiStore.generate` con el servicio inyectado por DI.
 * - Muestra el resumen del resultado y permite aplicarlo al editor (`setLanding`).
 * - Maneja el estado de carga y de error de forma accesible.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIPanel } from '@/components/Editor/Sidebar/AIPanel';
import { WORKFLOW_DEFINITIONS } from '@/core/workflows';
import { setAiService, useAiStore } from '@/store/aiStore';
import { useEditorStore } from '@/store/editorStore';
import type { IAiGenerationResult, IAiService, IPortalGenerationResult } from '@/services/aiService';
import type { ILandingConfig } from '@/types/editor';

const DEFAULT_LANDING: ILandingConfig = {
  campaignId: 'camp-ia',
  title: 'Landing dental generada por IA',
  workflowType: 'lead_capture',
  blocks: [
    {
      instance_id: 'blk-hero',
      block_id: 'hero',
      type: 'hero',
      name: 'Hero',
      config: { title: 'Hero dental' },
    },
  ],
};

/** Construye un resultado de generación válido con valores por defecto. */
function makeResult(overrides: Partial<IAiGenerationResult> = {}): IAiGenerationResult {
  return {
    config: DEFAULT_LANDING,
    model: 'deepseek-chat',
    cached: false,
    promptTokens: 10,
    completionTokens: 120,
    generatedAt: '2026-08-18T15:00:00Z',
    ...overrides,
  };
}

/** Construye un resultado de generación de portal válido con valores por defecto. */
function makePortalResult(
  overrides: Partial<IPortalGenerationResult> = {},
): IPortalGenerationResult {
  return {
    config: DEFAULT_LANDING,
    slug: 'mi-portal',
    model: 'deepseek-chat',
    cached: false,
    promptTokens: 10,
    completionTokens: 120,
    generatedAt: '2026-08-18T15:00:00Z',
    ...overrides,
  };
}

describe('AIPanel', () => {
  beforeEach(() => {
    useAiStore.getState().reset();
    useAiStore.getState().setWorkflowType('direct_checkout');
    useEditorStore.getState().reset();
  });

  afterEach(() => {
    // El reset corre con el componente aún montado (el cleanup de RTL se ejecuta
    // después, en orden LIFO). Se envuelve en `act` para que las actualizaciones
    // del store (status/result no-idle tras los tests de generación) no se
    // filtren fuera de su ámbito y disparen warnings de act().
    act(() => {
      useAiStore.getState().reset();
      useEditorStore.getState().reset();
    });
    setAiService(null);
  });

  it('renderiza el formulario con prompt, workflow y botón de generación', () => {
    render(<AIPanel />);

    expect(screen.getByRole('heading', { name: 'Asistente IA' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Describe la landing/)).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow de conversión')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(WORKFLOW_DEFINITIONS.length);
    expect(screen.getByRole('button', { name: 'Generar landing' })).toBeInTheDocument();
  });

  it('deshabilita el botón cuando el prompt está vacío', () => {
    render(<AIPanel />);

    expect(screen.getByRole('button', { name: 'Generar landing' })).toBeDisabled();
  });

  it('actualiza el workflow seleccionado en el store', async () => {
    const user = userEvent.setup();
    render(<AIPanel />);

    await act(async () => {
      await user.selectOptions(screen.getByLabelText('Workflow de conversión'), 'quote_generator');
    });

    expect(useAiStore.getState().workflowType).toBe('quote_generator');
  });

  it('genera una landing y muestra el resumen del resultado', async () => {
    const result = makeResult();
    setAiService({
      generate: vi.fn<IAiService['generate']>().mockResolvedValue(result),
      generatePortal: vi.fn(),
    });
    const user = userEvent.setup();

    render(<AIPanel />);
    await act(async () => {
      await user.type(
        screen.getByLabelText(/Describe la landing/),
        'Landing para una clínica dental',
      );
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar landing' }));
    });
    // Drena la resolución asíncrona de `generate` (fire-and-forget) dentro de act;
    // sin esto el update de estado del store dispararía un warning de act().
    await act(async () => {});

    expect(await screen.findByText('Landing dental generada por IA')).toBeInTheDocument();
    expect(screen.getByText(/1 bloques/)).toBeInTheDocument();
    expect(screen.getByText(/modelo deepseek-chat/)).toBeInTheDocument();
    expect(screen.getByText(/generado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar al editor' })).toBeInTheDocument();
  });

  it('muestra el estado de carga mientras se genera', async () => {
    let resolve!: (value: IAiGenerationResult) => void;
    setAiService({
      generate: vi
        .fn<IAiService['generate']>()
        .mockImplementation(() => new Promise<IAiGenerationResult>((res) => (resolve = res))),
      generatePortal: vi.fn(),
    });
    const user = userEvent.setup();

    render(<AIPanel />);
    await act(async () => {
      await user.type(screen.getByLabelText(/Describe la landing/), 'Genera una landing');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar landing' }));
    });
    await act(async () => {});

    expect(await screen.findByRole('button', { name: 'Generando…' })).toBeDisabled();
    expect(screen.getByText(/esto puede tardar unos segundos/)).toBeInTheDocument();

    await act(async () => {
      resolve(makeResult());
    });
    // La continuación de `generate` (success) se resuelve en microtasks posteriores.
    await act(async () => {});

    expect(await screen.findByRole('button', { name: 'Aplicar al editor' })).toBeInTheDocument();
  });

  it('aplica el resultado generado a la landing del editor', async () => {
    const result = makeResult();
    setAiService({
      generate: vi.fn<IAiService['generate']>().mockResolvedValue(result),
      generatePortal: vi.fn(),
    });
    const user = userEvent.setup();

    render(<AIPanel />);
    await act(async () => {
      await user.type(screen.getByLabelText(/Describe la landing/), 'Genera una landing');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar landing' }));
    });
    await act(async () => {});

    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Aplicar al editor' }));
    });

    expect(useEditorStore.getState().landing).toEqual(result.config);
    expect(screen.getByRole('button', { name: 'Aplicada al editor' })).toBeDisabled();
  });

  it('muestra el mensaje de error de forma accesible', async () => {
    setAiService({
      generate: vi
        .fn<IAiService['generate']>()
        .mockRejectedValue(new Error('Servicio no disponible')),
      generatePortal: vi.fn(),
    });
    const user = userEvent.setup();

    render(<AIPanel />);
    await act(async () => {
      await user.type(screen.getByLabelText(/Describe la landing/), 'Genera algo');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar landing' }));
    });
    // Drena la resolución asíncrona del rechazo dentro de act.
    await act(async () => {});

    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio no disponible');
  });

  it('cambia a modo portal ocultando el workflow y ajustando los textos', async () => {
    const user = userEvent.setup();
    render(<AIPanel />);

    expect(screen.getByLabelText('Workflow de conversión')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar landing' })).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Portal' }));
    });

    expect(useAiStore.getState().mode).toBe('portal');
    expect(screen.queryByLabelText('Workflow de conversión')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Describe la página del portal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar página del portal' })).toBeInTheDocument();
  });

  it('genera una página del portal en modo portal y permite aplicarla', async () => {
    const portalResult = makePortalResult();
    const generatePortal = vi
      .fn<IAiService['generatePortal']>()
      .mockResolvedValue(portalResult);
    setAiService({ generate: vi.fn(), generatePortal });
    const user = userEvent.setup();

    render(<AIPanel />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Portal' }));
    });
    await act(async () => {
      await user.type(
        screen.getByLabelText(/Describe la página del portal/),
        'Portal de servicios para una clínica',
      );
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar página del portal' }));
    });
    await act(async () => {});

    expect(generatePortal).toHaveBeenCalledWith('Portal de servicios para una clínica');
    expect(await screen.findByText('Landing dental generada por IA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar al portal' })).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Aplicar al portal' }));
    });

    expect(useEditorStore.getState().landing).toEqual(portalResult.config);
    expect(screen.getByRole('button', { name: 'Aplicada al portal' })).toBeDisabled();
  });

  it('muestra el mensaje de error en modo portal de forma accesible', async () => {
    setAiService({
      generate: vi.fn(),
      generatePortal: vi
        .fn<IAiService['generatePortal']>()
        .mockRejectedValue(new Error('Portal no disponible')),
    });
    const user = userEvent.setup();

    render(<AIPanel />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Portal' }));
    });
    await act(async () => {
      await user.type(screen.getByLabelText(/Describe la página del portal/), 'Genera un portal');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar página del portal' }));
    });
    await act(async () => {});

    expect(await screen.findByRole('alert')).toHaveTextContent('Portal no disponible');
  });
});
