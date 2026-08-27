/**
 * Hook de compilación en tiempo real con debounce.
 *
 * Contrato:
 * - Reacciona a cambios en `landing` y en la opción `minify` del store.
 * - Debounce de `REALTIME_COMPILE_DEBOUNCE_MS` para no saturar el backend
 *   durante la edición continua (cada edición reinicia el temporizador).
 * - Si no hay servicio de compilación registrado (DI), no dispara peticiones
 *   y el preview convive en estado `idle`.
 * - Expone el estado reactivo del compilador para que la UI lo consuma.
 */
import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { getCompilerService, useCompilerStore } from '@/store/compilerStore';
import { serializeLandingConfig } from '@/core/landingCode';
import type { CompilerStatus } from '@/store/compilerStore';

/** Milisegundos de espera antes de compilar tras la última edición (debounce). */
export const REALTIME_COMPILE_DEBOUNCE_MS = 400;

/** Estado reactivo del flujo de compilación expuesto al consumidor. */
export interface IUseCompiledLanding {
  /** Estado actual del flujo de compilación. */
  status: CompilerStatus;
  /** HTML compilado de la última compilación exitosa. */
  html: string;
  /** Duración de la última compilación en milisegundos (o `null`). */
  durationMs: number | null;
  /** Marca de tiempo UTC de la última compilación (o `null`). */
  compiledAt: string | null;
  /** Mensaje del último error de compilación (o `null`). */
  error: string | null;
}

/**
 * Compila la landing en edición a HTML de forma reactiva y con debounce.
 *
 * @example
 * ```tsx
 * const { status, html, durationMs, error } = useCompiledLanding();
 * ```
 *
 * @returns Estado reactivo del flujo de compilación.
 */
export function useCompiledLanding(): IUseCompiledLanding {
  const landing = useEditorStore((state) => state.landing);
  const status = useCompilerStore((state) => state.status);
  const html = useCompilerStore((state) => state.html);
  const durationMs = useCompilerStore((state) => state.durationMs);
  const compiledAt = useCompilerStore((state) => state.compiledAt);
  const error = useCompilerStore((state) => state.error);
  const minify = useCompilerStore((state) => state.minify);
  const compile = useCompilerStore((state) => state.compile);

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (getCompilerService() === null) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void compile(serializeLandingConfig(landing));
    }, REALTIME_COMPILE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [landing, compile, minify]);

  return { status, html, durationMs, compiledAt, error };
}
