/**
 * Store del compilador de landings (config → HTML).
 *
 * Contrato:
 * - Registro de servicios por DI: `setCompilerService`/`getCompilerService` inyectan
 *   la implementación `ICompilerService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `compile` pasa a estado de error para que la UI
 *   conviva sin la dependencia (p. ej. en pruebas de layout).
 * - `reset` descarta el resultado pero conserva la opción `minify` del usuario.
 */
import { create } from 'zustand';
import { AppError } from '@/lib/errors';
import { DEFAULT_MINIFY, type ICompilerService } from '@/services/compilerService';

/** Estado del flujo de compilación. */
export type CompilerStatus = 'idle' | 'compiling' | 'success' | 'error';

/** Contrato del store del compilador. */
export interface ICompilerState {
  /** Estado actual del flujo de compilación. */
  status: CompilerStatus;
  /** HTML compilado de la última compilación exitosa. */
  html: string;
  /** Duración de la última compilación en milisegundos (o `null`). */
  durationMs: number | null;
  /** Marca de tiempo UTC de la última compilación (o `null`). */
  compiledAt: string | null;
  /** Indica si el HTML resultante debe minificarse. */
  minify: boolean;
  /** Mensaje del último error de compilación (o `null`). */
  error: string | null;
  /** Compila una configuración de landing a HTML con la opción `minify` actual. */
  compile(config: Record<string, unknown>): Promise<void>;
  /** Cambia la opción de minificación del HTML. */
  setMinify(minify: boolean): void;
  /** Descarta el resultado y vuelve al estado inicial (conserva `minify`). */
  reset(): void;
}

/** Servicio de compilación registrado por el composition root (DI). */
let compilerService: ICompilerService | null = null;

/**
 * Registra la implementación del servicio de compilación.
 * @param service Implementación a inyectar (o `null` para desregistrar).
 */
export function setCompilerService(service: ICompilerService | null): void {
  compilerService = service;
}

/**
 * Devuelve el servicio de compilación registrado.
 * @returns La implementación inyectada o `null` si no se ha registrado.
 */
export function getCompilerService(): ICompilerService | null {
  return compilerService;
}

/** Store del compilador de landings. */
export const useCompilerStore = create<ICompilerState>()((set, get) => ({
  status: 'idle',
  html: '',
  durationMs: null,
  compiledAt: null,
  minify: DEFAULT_MINIFY,
  error: null,

  compile: async (config: Record<string, unknown>) => {
    const service = getCompilerService();
    if (service === null) {
      set({ status: 'error', error: 'El compilador no está disponible.' });
      return;
    }
    set({ status: 'compiling', error: null });
    try {
      const result = await service.compile({ config, minify: get().minify });
      set({
        status: 'success',
        html: result.html,
        durationMs: result.durationMs,
        compiledAt: result.compiledAt,
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudo compilar la landing.';
      set({ status: 'error', error: message });
    }
  },

  setMinify: (minify: boolean) => set({ minify }),

  reset: () =>
    set((state) => ({
      status: 'idle',
      html: '',
      durationMs: null,
      compiledAt: null,
      error: null,
      minify: state.minify,
    })),
}));
