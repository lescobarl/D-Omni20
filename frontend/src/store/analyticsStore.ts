/**
 * Store de Analítica Avanzada.
 *
 * Contrato:
 * - Registro de servicios por DI: `setAnalyticsService`/`getAnalyticsService` inyectan la
 *   implementación `IAnalyticsService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `fetchDashboard` pasa a estado de error para que la UI
 *   conviva sin la dependencia (p. ej. en pruebas).
 * - `fetchDashboard` carga el resumen del dashboard del tenant y no muta otros estados.
 */
import { create } from 'zustand';
import type { IAnalyticsDashboardResponse } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IAnalyticsService } from '@/services/analyticsService';

/** Estado del flujo de carga del dashboard de analítica. */
export type AnalyticsStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de analítica. */
export interface IAnalyticsState {
  /** Resumen del dashboard cargado (o `null`). */
  dashboard: IAnalyticsDashboardResponse | null;
  /** Estado actual de la carga del dashboard. */
  status: AnalyticsStatus;
  /** Mensaje del último error (o `null`). */
  error: string | null;
  /** Carga el resumen del dashboard del tenant activo. */
  fetchDashboard(): Promise<void>;
  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IAnalyticsService | null = null;

/**
 * Registra la implementación del servicio de analítica (composition root).
 * @param implementation - Implementación de `IAnalyticsService` (o `null` en pruebas).
 */
export function setAnalyticsService(implementation: IAnalyticsService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de analítica (o `null`). */
export function getAnalyticsService(): IAnalyticsService | null {
  return service;
}

/** Mensaje por defecto cuando el error no es una instancia de `Error`. */
const UNKNOWN_ERROR_MESSAGE = 'No se pudo cargar la analítica. Inténtalo de nuevo.';

/** Store global de analítica avanzada. */
export const useAnalyticsStore = create<IAnalyticsState>()((set) => ({
  dashboard: null,
  status: 'idle',
  error: null,

  fetchDashboard: async () => {
    if (service === null) {
      set({ status: 'error', error: 'La analítica no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const dashboard = await service.getDashboard();
      set({ dashboard, status: 'success', error: null });
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
      dashboard: null,
      status: 'idle',
      error: null,
    }),
}));
