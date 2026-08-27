/**
 * Pruebas del hook de compilación en tiempo real con debounce.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_COMPILE_DEBOUNCE_MS, useCompiledLanding } from '@/hooks/useCompiledLanding';
import { setCompilerService, useCompilerStore } from '@/store/compilerStore';
import { createDefaultLanding, useEditorStore } from '@/store/editorStore';
import { serializeLandingConfig } from '@/core/landingCode';
import type { ICompilerService, ICompilationResult } from '@/services/compilerService';
import type { ILandingConfig } from '@/types/editor';

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

/** Landing por defecto del editor con overrides opcionales. */
function makeLanding(overrides: Partial<ILandingConfig> = {}): ILandingConfig {
  return { ...createDefaultLanding(), ...overrides };
}

/**
 * Avanza el tiempo del debounce dentro de `act`.
 *
 * `advanceTimersByTimeAsync` dispara el temporizador y espera la continuación
 * async de `compile`, por lo que las actualizaciones del store quedan dentro
 * del ámbito de `act`.
 */
async function advanceDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REALTIME_COMPILE_DEBOUNCE_MS);
  });
}

describe('useCompiledLanding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setCompilerService(null);
    useCompilerStore.getState().reset();
    useEditorStore.setState({ landing: makeLanding() });
  });

  afterEach(() => {
    // El reset corre con el hook aún montado (el cleanup de RTL se ejecuta
    // después, en orden LIFO). Se envuelve en `act` para que las
    // actualizaciones del store no se filtren fuera de su ámbito.
    act(() => {
      setCompilerService(null);
      useCompilerStore.getState().reset();
    });
    vi.useRealTimers();
  });

  it('no compila cuando no hay servicio registrado (convierte en estado idle)', async () => {
    const { result } = renderHook(() => useCompiledLanding());

    await advanceDebounce();

    expect(result.current.status).toBe('idle');
    expect(result.current.html).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('compila la landing tras el debounce con la configuración serializada', async () => {
    const service = makeService();
    setCompilerService(service);
    const landing = makeLanding({ title: 'Demo', blocks: [] });
    useEditorStore.setState({ landing });

    renderHook(() => useCompiledLanding());

    expect(service.compile).not.toHaveBeenCalled();
    await advanceDebounce();

    expect(service.compile).toHaveBeenCalledTimes(1);
    expect(service.compile).toHaveBeenCalledWith({
      config: serializeLandingConfig(landing),
      minify: false,
    });
  });

  it('reinicia el temporizador en ediciones consecutivas (una sola compilación)', async () => {
    const service = makeService();
    setCompilerService(service);
    renderHook(() => useCompiledLanding());

    act(() => {
      vi.advanceTimersByTime(REALTIME_COMPILE_DEBOUNCE_MS - 100);
    });
    act(() => {
      useEditorStore.getState().setLandingTitle('Primer título');
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      useEditorStore.getState().setLandingTitle('Segundo título');
    });
    await advanceDebounce();

    expect(service.compile).toHaveBeenCalledTimes(1);
  });

  it('recompila cuando cambia la opción de minify', async () => {
    const service = makeService();
    setCompilerService(service);
    renderHook(() => useCompiledLanding());

    await advanceDebounce();
    expect(service.compile).toHaveBeenCalledTimes(1);

    act(() => {
      useCompilerStore.getState().setMinify(true);
    });
    await advanceDebounce();

    expect(service.compile).toHaveBeenCalledTimes(2);
    expect(service.compile).toHaveBeenLastCalledWith(expect.objectContaining({ minify: true }));
  });

  it('expone el estado reactivo de la compilación exitosa', async () => {
    const service = makeService();
    const compileMock = service.compile as ReturnType<typeof vi.fn>;
    compileMock.mockResolvedValueOnce(
      makeResult({ html: '<p>ok</p>', durationMs: 3, compiledAt: '2026-08-18T16:00:00Z' }),
    );
    setCompilerService(service);

    const { result } = renderHook(() => useCompiledLanding());
    expect(result.current.status).toBe('idle');

    await advanceDebounce();

    expect(result.current.status).toBe('success');
    expect(result.current.html).toBe('<p>ok</p>');
    expect(result.current.durationMs).toBe(3);
    expect(result.current.compiledAt).toBe('2026-08-18T16:00:00Z');
  });
});
