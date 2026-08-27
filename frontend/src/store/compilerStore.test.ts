/**
 * Pruebas del store del compilador de landings.
 *
 * Contrato:
 * - El registro de servicios por DI (`setCompilerService`/`getCompilerService`)
 *   permite inyectar la implementación `ICompilerService` sin acoplar el store.
 * - `compile` gestiona los estados `idle | compiling | success | error`.
 * - Sin servicio registrado el store degrada a estado de error.
 * - `reset` conserva la opción `minify` del usuario.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { DEFAULT_MINIFY } from '@/services/compilerService';
import type { ICompilationResult, ICompilerService } from '@/services/compilerService';
import { setCompilerService, useCompilerStore } from '@/store/compilerStore';

function makeResult(overrides: Partial<ICompilationResult> = {}): ICompilationResult {
  return {
    html: '<section class="landing" data-title="Demo"></section>',
    durationMs: 12.5,
    compiledAt: '2026-08-18T15:00:00Z',
    ...overrides,
  };
}

function makeConfig(): Record<string, unknown> {
  return {
    title: 'Demo',
    workflowType: 'direct_checkout',
    blocks: [],
  };
}

describe('compilerStore', () => {
  beforeEach(() => {
    useCompilerStore.getState().reset();
    // `reset` conserva `minify` por contrato; se restaura explícitamente
    // para aislar cada prueba del estado dejado por la anterior.
    useCompilerStore.getState().setMinify(DEFAULT_MINIFY);
  });

  afterEach(() => {
    useCompilerStore.getState().reset();
    setCompilerService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useCompilerStore.getState();
    expect(state.status).toBe('idle');
    expect(state.html).toBe('');
    expect(state.durationMs).toBeNull();
    expect(state.compiledAt).toBeNull();
    expect(state.minify).toBe(false);
    expect(state.error).toBeNull();
  });

  it('actualiza la opción minify sin disparar la compilación', () => {
    useCompilerStore.getState().setMinify(true);

    const state = useCompilerStore.getState();
    expect(state.minify).toBe(true);
    expect(state.status).toBe('idle');
  });

  it('compila una configuración y almacena el resultado', async () => {
    const result = makeResult();
    const compile = vi.fn<ICompilerService['compile']>().mockResolvedValue(result);
    setCompilerService({ compile });

    await useCompilerStore.getState().compile(makeConfig());

    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith({ config: makeConfig(), minify: false });

    const state = useCompilerStore.getState();
    expect(state.status).toBe('success');
    expect(state.html).toBe(result.html);
    expect(state.durationMs).toBe(12.5);
    expect(state.compiledAt).toBe('2026-08-18T15:00:00Z');
    expect(state.error).toBeNull();
  });

  it('pasa a compiling mientras la compilación está pendiente', async () => {
    let resolve!: (value: ICompilationResult) => void;
    const compile = vi
      .fn<ICompilerService['compile']>()
      .mockImplementation(() => new Promise<ICompilationResult>((res) => (resolve = res)));
    setCompilerService({ compile });

    const pending = useCompilerStore.getState().compile(makeConfig());

    expect(useCompilerStore.getState().status).toBe('compiling');
    expect(useCompilerStore.getState().html).toBe('');

    resolve(makeResult());
    await pending;

    expect(useCompilerStore.getState().status).toBe('success');
  });

  it('usa la opción minify seleccionada en la compilación', async () => {
    const compile = vi.fn<ICompilerService['compile']>().mockResolvedValue(makeResult());
    setCompilerService({ compile });

    useCompilerStore.getState().setMinify(true);
    await useCompilerStore.getState().compile(makeConfig());

    expect(compile).toHaveBeenCalledWith({ config: makeConfig(), minify: true });
  });

  it('degrada a error cuando no hay servicio registrado', async () => {
    setCompilerService(null);

    await useCompilerStore.getState().compile(makeConfig());

    expect(useCompilerStore.getState().status).toBe('error');
    expect(useCompilerStore.getState().error).toBe('El compilador no está disponible.');
  });

  it('propaga el mensaje de un AppError del servicio', async () => {
    const compile = vi
      .fn<ICompilerService['compile']>()
      .mockRejectedValue(
        new AppError('Plantilla inválida', 'landing.compile', { reason: 'bad_template' }),
      );
    setCompilerService({ compile });

    await useCompilerStore.getState().compile(makeConfig());

    expect(useCompilerStore.getState().status).toBe('error');
    expect(useCompilerStore.getState().error).toBe('Plantilla inválida');
  });

  it('propaga el mensaje de un Error genérico del servicio', async () => {
    const compile = vi.fn<ICompilerService['compile']>().mockRejectedValue(new Error('Red caída'));
    setCompilerService({ compile });

    await useCompilerStore.getState().compile(makeConfig());

    expect(useCompilerStore.getState().status).toBe('error');
    expect(useCompilerStore.getState().error).toBe('Red caída');
  });

  it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
    const compile = vi.fn<ICompilerService['compile']>().mockRejectedValue('fallo desconocido');
    setCompilerService({ compile });

    await useCompilerStore.getState().compile(makeConfig());

    expect(useCompilerStore.getState().status).toBe('error');
    expect(useCompilerStore.getState().error).toBe('No se pudo compilar la landing.');
  });

  it('reset descarta el resultado y vuelve al estado inicial conservando minify', async () => {
    setCompilerService({
      compile: vi.fn<ICompilerService['compile']>().mockResolvedValue(makeResult()),
    });

    useCompilerStore.getState().setMinify(true);
    await useCompilerStore.getState().compile(makeConfig());
    expect(useCompilerStore.getState().status).toBe('success');

    useCompilerStore.getState().reset();

    const state = useCompilerStore.getState();
    expect(state.status).toBe('idle');
    expect(state.html).toBe('');
    expect(state.durationMs).toBeNull();
    expect(state.compiledAt).toBeNull();
    expect(state.error).toBeNull();
    // reset conserva la preferencia de minificación del usuario.
    expect(state.minify).toBe(true);
  });
});
