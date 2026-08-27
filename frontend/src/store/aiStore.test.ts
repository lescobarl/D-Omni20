/**
 * Pruebas del store del asistente IA (generación de landings).
 *
 * Contrato:
 * - El registro de servicios por DI (`setAiService`/`getAiService`) permite
 *   inyectar la implementación `IAiService` sin acoplar el store.
 * - `generate` valida el prompt y gestiona los estados
 *   `idle | loading | success | error`.
 * - Sin servicio registrado el store degrada a estado de error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiService, useAiStore } from '@/store/aiStore';
import { AppError } from '@/lib/errors';
import type { IAiGenerationResult, IAiService } from '@/services/aiService';
import type { ILandingConfig } from '@/types/editor';

const DEFAULT_LANDING: ILandingConfig = {
  campaignId: 'camp-ia',
  title: 'Landing generada por IA',
  workflowType: 'lead_capture',
  blocks: [],
};

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

describe('aiStore', () => {
  beforeEach(() => {
    useAiStore.getState().reset();
    useAiStore.getState().setWorkflowType('direct_checkout');
  });

  afterEach(() => {
    useAiStore.getState().reset();
    setAiService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useAiStore.getState();
    expect(state.status).toBe('idle');
    expect(state.prompt).toBe('');
    expect(state.workflowType).toBe('direct_checkout');
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
  });

  it('actualiza el prompt y el workflow sin disparar la generación', () => {
    useAiStore.getState().setPrompt('Landing para una clínica dental');
    useAiStore.getState().setWorkflowType('quote_generator');

    const state = useAiStore.getState();
    expect(state.prompt).toBe('Landing para una clínica dental');
    expect(state.workflowType).toBe('quote_generator');
    expect(state.status).toBe('idle');
  });

  it('limpia el error al escribir un nuevo prompt', () => {
    useAiStore.getState().setPrompt('   ');
    awaitGeneration(useAiStore.getState().generate);
    expect(useAiStore.getState().status).toBe('error');

    useAiStore.getState().setPrompt('Nuevo prompt');
    expect(useAiStore.getState().error).toBeNull();
  });

  it('genera una landing y almacena el resultado', async () => {
    const result = makeResult();
    const generate = vi.fn<IAiService['generate']>().mockResolvedValue(result);
    setAiService({ generate });

    useAiStore.getState().setPrompt('  Crea una landing de venta  ');
    await useAiStore.getState().generate();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('Crea una landing de venta', 'direct_checkout');

    const state = useAiStore.getState();
    expect(state.status).toBe('success');
    expect(state.result).toEqual(result);
    expect(state.error).toBeNull();
  });

  it('pasa a loading mientras la generación está pendiente', async () => {
    let resolve!: (value: IAiGenerationResult) => void;
    const generate = vi
      .fn<IAiService['generate']>()
      .mockImplementation(() => new Promise<IAiGenerationResult>((res) => (resolve = res)));
    setAiService({ generate });

    useAiStore.getState().setPrompt('Prompt pendiente');
    const pending = useAiStore.getState().generate();

    expect(useAiStore.getState().status).toBe('loading');
    expect(useAiStore.getState().result).toBeNull();

    resolve(makeResult({ cached: true }));
    await pending;

    expect(useAiStore.getState().status).toBe('success');
    expect(useAiStore.getState().result?.cached).toBe(true);
  });

  it('usa el workflow seleccionado en la generación', async () => {
    const generate = vi.fn<IAiService['generate']>().mockResolvedValue(makeResult());
    setAiService({ generate });

    useAiStore.getState().setWorkflowType('appointment_scheduler');
    useAiStore.getState().setPrompt('Agenda citas');
    await useAiStore.getState().generate();

    expect(generate).toHaveBeenCalledWith('Agenda citas', 'appointment_scheduler');
  });

  it('rechaza la generación con prompt vacío sin invocar el servicio', async () => {
    const generate = vi.fn<IAiService['generate']>();
    setAiService({ generate });

    useAiStore.getState().setPrompt('   ');
    await useAiStore.getState().generate();

    expect(generate).not.toHaveBeenCalled();
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error).toBe('Escribe un prompt antes de generar.');
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setAiService(null);

    useAiStore.getState().setPrompt('Sin servicio');
    await useAiStore.getState().generate();

    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error).toBe('El asistente IA no está disponible.');
  });

  it('propaga el mensaje de un AppError del servicio', async () => {
    const generate = vi
      .fn<IAiService['generate']>()
      .mockRejectedValue(
        new AppError('Fallo de generación', 'ai.generate', { reason: 'model_timeout' }),
      );
    setAiService({ generate });

    useAiStore.getState().setPrompt('Genera');
    await useAiStore.getState().generate();

    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error).toBe('Fallo de generación');
  });

  it('propaga el mensaje de un Error genérico del servicio', async () => {
    const generate = vi.fn<IAiService['generate']>().mockRejectedValue(new Error('Red caída'));
    setAiService({ generate });

    useAiStore.getState().setPrompt('Genera');
    await useAiStore.getState().generate();

    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error).toBe('Red caída');
  });

  it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
    const generate = vi.fn<IAiService['generate']>().mockRejectedValue('fallo desconocido');
    setAiService({ generate });

    useAiStore.getState().setPrompt('Genera');
    await useAiStore.getState().generate();

    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().error).toBe('No se pudo generar la landing.');
  });

  it('reset descarta el resultado y vuelve al estado inicial', async () => {
    setAiService({
      generate: vi.fn<IAiService['generate']>().mockResolvedValue(makeResult()),
    });

    useAiStore.getState().setPrompt('Genera');
    useAiStore.getState().setWorkflowType('lead_capture');
    await useAiStore.getState().generate();
    expect(useAiStore.getState().status).toBe('success');

    useAiStore.getState().reset();

    const state = useAiStore.getState();
    expect(state.status).toBe('idle');
    expect(state.prompt).toBe('');
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
    // reset conserva la preferencia de workflow del usuario.
    expect(state.workflowType).toBe('lead_capture');
  });
});

/** Ayuda para ejecutar `generate` sin esperar en flujos síncronos de error. */
function awaitGeneration(generate: () => Promise<void>): Promise<void> {
  return generate();
}
