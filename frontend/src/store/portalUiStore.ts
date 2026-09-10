/**
 * Estado del look del portal de configuración (Studio).
 *
 * Contrato:
 * - La fuente de verdad es el BACKEND, por tenant (``tenant_appearance``):
 *   este store solo cachea el valor para aplicarlo en caliente a la cáscara y
 *   lo persiste a través de ``ITenantConfigService`` (inyectado por DI).
 * - Solo admin puede guardar (endpoint dedicado con RBAC); el store no decide
 *   permisos, la UI sí (no se muestra a roles sin privilegio).
 * - Sin persistencia local: al cambiar de tenant se re-hidrata desde el backend.
 */

import { create } from 'zustand';
import type { IPortalLook, PortalAccent, PortalSurface } from '@/api/types';
import type { ITenantConfigService } from '@/services/tenantConfigService';

/** Estado del ciclo de un guardado del look del portal. */
export type PortalLookStatus = 'idle' | 'loading' | 'success' | 'error';

let portalLookService: ITenantConfigService | null = null;

/**
 * Inyecta el servicio de configuración del tenant usado para leer/guardar el look.
 * @param implementation - Implementación del puerto (o `null` para deshabilitarlo).
 */
export function setPortalLookService(implementation: ITenantConfigService | null): void {
  portalLookService = implementation;
}

/** Contrato del store del look del portal de configuración. */
export interface IPortalUiState {
  /** Acento de marca aplicado a la navegación del portal. */
  accent: PortalAccent;
  /** Superficie de los módulos del portal. */
  surface: PortalSurface;
  /** Estado del último guardado/carga remota. */
  status: PortalLookStatus;
  /** Mensaje del último error remoto (o `null`). */
  error: string | null;
  /** Re-hidrata el look desde el backend del tenant activo. */
  hydrate(): Promise<void>;
  /** Persiste el look en el backend (solo admin) y actualiza el estado local. */
  save(look: IPortalLook): Promise<boolean>;
}

/** Store del look del portal de configuración (backend-backed por tenant). */
export const usePortalUiStore = create<IPortalUiState>()((set) => ({
  accent: 'brand',
  surface: 'light',
  status: 'idle',
  error: null,
  hydrate: async () => {
    if (portalLookService === null) {
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const look = await portalLookService.getPortalLook();
      set({
        accent: look.portal_accent,
        surface: look.portal_surface,
        status: 'success',
        error: null,
      });
    } catch {
      set({ status: 'error', error: 'No se pudo cargar el look del portal.' });
    }
  },
  save: async (look) => {
    if (portalLookService === null) {
      set({ status: 'error', error: 'El servicio del portal no está disponible.' });
      return false;
    }
    set({ status: 'loading', error: null });
    try {
      const saved = await portalLookService.savePortalLook(look);
      set({
        accent: saved.portal_accent,
        surface: saved.portal_surface,
        status: 'success',
        error: null,
      });
      return true;
    } catch {
      set({ status: 'error', error: 'No se pudo guardar el look del portal.' });
      return false;
    }
  },
}));
