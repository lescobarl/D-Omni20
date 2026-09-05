/**
 * Store de dominios personalizados (PSEO hosts) — registro, verificación DNS y
 * activación de los dominios propios del tenant para el serving público.
 *
 * Contrato:
 * - Registro de servicios por DI: `setPseoHostService`/`getPseoHostService`
 *   inyectan la implementación `IPseoHostService` desde el composition root
 *   (`main.tsx`), activada por la feature flag `hosts`.
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas). Los dominios
 *   personalizados son opcionales y fail-closed: nunca bloquean el editor.
 * - La colección `hosts` mantiene su propio estado de carga para no bloquear las
 *   demás áreas del panel de operación.
 * - El backend devuelve `GET /pseo/hosts` como un **arreglo plano**, por lo que
 *   `listPseoHosts` asigna `hosts: hosts` directamente (sin `.items` de página).
 */
import { create } from 'zustand';
import type { IPseoHostRead } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IPseoHostInput, IPseoHostService } from '@/services/hostsService';

/** Estado de un flujo de dominios personalizados. */
export type HostsStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de dominios personalizados. */
export interface IHostsState {
  /** Dominios personalizados del tenant cargados (PSEO hosts). */
  hosts: IPseoHostRead[];
  /** Estado del flujo de dominios personalizados. */
  hostsStatus: HostsStatus;
  /** Mensaje del último error del flujo de dominios personalizados (o `null`). */
  hostsError: string | null;

  /** Carga los dominios personalizados del tenant. */
  listPseoHosts(): Promise<void>;
  /** Registra un dominio personalizado y lo agrega a la colección. */
  requestPseoHost(input: IPseoHostInput): Promise<void>;
  /** Verifica un dominio y actualiza su estado en la colección. */
  verifyPseoHost(hostId: string): Promise<void>;
  /** Elimina un dominio personalizado y lo quita de la colección. */
  deletePseoHost(hostId: string): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IPseoHostService | null = null;

/**
 * Registra la implementación del servicio de dominios personalizados (composition root).
 * @param implementation - Implementación de `IPseoHostService` (o `null` en pruebas).
 */
export function setPseoHostService(implementation: IPseoHostService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de dominios (o `null`). */
export function getPseoHostService(): IPseoHostService | null {
  return service;
}

/** Extrae el mensaje de un error siguiendo la cadena AppError → Error → por defecto. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Store global de dominios personalizados. */
export const useHostsStore = create<IHostsState>()((set, get) => ({
  hosts: [],
  hostsStatus: 'idle',
  hostsError: null,

  listPseoHosts: async () => {
    if (service === null) {
      set({
        hostsStatus: 'error',
        hostsError: 'La sección de dominios personalizados no está disponible.',
      });
      return;
    }
    set({ hostsStatus: 'loading', hostsError: null });
    try {
      const hosts = await service.listPseoHosts();
      set({ hosts, hostsStatus: 'success', hostsError: null });
    } catch (error) {
      set({
        hostsStatus: 'error',
        hostsError: extractErrorMessage(
          error,
          'No se pudieron cargar los dominios personalizados.',
        ),
      });
    }
  },

  requestPseoHost: async (input: IPseoHostInput) => {
    if (service === null) {
      set({
        hostsStatus: 'error',
        hostsError: 'La sección de dominios personalizados no está disponible.',
      });
      return;
    }
    set({ hostsStatus: 'loading', hostsError: null });
    try {
      const host = await service.requestPseoHost(input);
      set({ hosts: [...get().hosts, host], hostsStatus: 'success', hostsError: null });
    } catch (error) {
      set({
        hostsStatus: 'error',
        hostsError: extractErrorMessage(error, 'No se pudo registrar el dominio personalizado.'),
      });
    }
  },

  verifyPseoHost: async (hostId: string) => {
    if (service === null) {
      set({
        hostsStatus: 'error',
        hostsError: 'La sección de dominios personalizados no está disponible.',
      });
      return;
    }
    set({ hostsStatus: 'loading', hostsError: null });
    try {
      const host = await service.verifyPseoHost(hostId);
      set({
        hosts: get().hosts.map((current) => (current.id === hostId ? host : current)),
        hostsStatus: 'success',
        hostsError: null,
      });
    } catch (error) {
      set({
        hostsStatus: 'error',
        hostsError: extractErrorMessage(error, 'No se pudo verificar el dominio personalizado.'),
      });
    }
  },

  deletePseoHost: async (hostId: string) => {
    if (service === null) {
      set({
        hostsStatus: 'error',
        hostsError: 'La sección de dominios personalizados no está disponible.',
      });
      return;
    }
    set({ hostsStatus: 'loading', hostsError: null });
    try {
      await service.deletePseoHost(hostId);
      set({
        hosts: get().hosts.filter((current) => current.id !== hostId),
        hostsStatus: 'success',
        hostsError: null,
      });
    } catch (error) {
      set({
        hostsStatus: 'error',
        hostsError: extractErrorMessage(error, 'No se pudo eliminar el dominio personalizado.'),
      });
    }
  },

  reset: () =>
    set({
      hosts: [],
      hostsStatus: 'idle',
      hostsError: null,
    }),
}));
