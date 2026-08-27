/**
 * Store de Despliegue al CDN (Fase 10).
 *
 * Contrato:
 * - Registro de servicios por DI: `setCdnService`/`getCdnService` inyectan la
 *   implementación `ICdnService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `deploy` pasa a estado de error para que la UI
 *   conviva sin la dependencia (p. ej. en pruebas).
 * - `deploy(landingId)` ejecuta el despliegue de la landing al CDN y guarda la
 *   respuesta con la URL pública; no muta otros estados.
 */
import { create } from 'zustand';
import type { ICdnDeployResponse } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { ICdnService } from '@/services/cdnService';

/** Estado del flujo de despliegue al CDN. */
export type CdnStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de despliegue al CDN. */
export interface ICdnState {
  /** Última respuesta de despliegue cargada (o `null`). */
  deployment: ICdnDeployResponse | null;
  /** Estado actual del despliegue. */
  status: CdnStatus;
  /** Mensaje del último error (o `null`). */
  error: string | null;
  /** Despliega la landing del tenant activo al CDN. */
  deploy(landingId: string): Promise<void>;
  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: ICdnService | null = null;

/**
 * Registra la implementación del servicio de despliegue (composition root).
 * @param implementation - Implementación de `ICdnService` (o `null` en pruebas).
 */
export function setCdnService(implementation: ICdnService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de despliegue (o `null`). */
export function getCdnService(): ICdnService | null {
  return service;
}

/** Mensaje por defecto cuando el error no es una instancia de `Error`. */
const UNKNOWN_ERROR_MESSAGE = 'No se pudo desplegar la landing. Inténtalo de nuevo.';

/** Store global de despliegue al CDN. */
export const useCdnStore = create<ICdnState>()((set) => ({
  deployment: null,
  status: 'idle',
  error: null,

  deploy: async (landingId: string) => {
    if (service === null) {
      set({ status: 'error', error: 'El despliegue al CDN no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const deployment = await service.deploy(landingId);
      set({ deployment, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error:
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : UNKNOWN_ERROR_MESSAGE,
      });
    }
  },

  reset: () =>
    set({
      deployment: null,
      status: 'idle',
      error: null,
    }),
}));
