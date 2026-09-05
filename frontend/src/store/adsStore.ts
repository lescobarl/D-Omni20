/**
 * Store de captación publicitaria (C-1, eslabón ① de LAE Omni2.0) — campañas
 * publicitarias con atribución UTM que alimentan el ciclo comercial desde el
 * contacto inicial (ADS) hasta el Portal del Cliente (⑩).
 *
 * Contrato:
 * - Registro de servicios por DI: `setAdsService`/`getAdsService` inyectan la
 *   implementación `IAdsService` desde el composition root (`main.tsx`),
 *   activada por la feature flag `ads`.
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas). La captación
 *   publicitaria es opcional y fail-closed: nunca bloquea el editor.
 * - La colección `adCampaigns` mantiene su propio estado de carga para no
 *   bloquear las demás áreas del panel de operación.
 */
import { create } from 'zustand';
import type { IAdCampaignRead } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IAdCampaignInput, IAdsService } from '@/services/adsService';

/** Estado de un flujo de captación publicitaria. */
export type AdsStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de captación publicitaria. */
export interface IAdsState {
  /** Campañas publicitarias del tenant cargadas (C-1, eslabón ①). */
  adCampaigns: IAdCampaignRead[];
  /** Estado del flujo de campañas publicitarias. */
  adCampaignsStatus: AdsStatus;
  /** Mensaje del último error del flujo de campañas publicitarias (o `null`). */
  adCampaignsError: string | null;

  /** Carga las campañas publicitarias del tenant. */
  listAdCampaigns(): Promise<void>;
  /** Crea una campaña publicitaria y la agrega a la colección. */
  createAdCampaign(input: IAdCampaignInput): Promise<void>;
  /** Actualiza una campaña publicitaria y refresca la colección. */
  updateAdCampaign(adCampaignId: string, input: Partial<IAdCampaignInput>): Promise<void>;
  /** Elimina una campaña publicitaria y la quita de la colección. */
  deleteAdCampaign(adCampaignId: string): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IAdsService | null = null;

/**
 * Registra la implementación del servicio de captación publicitaria (composition root).
 * @param implementation - Implementación de `IAdsService` (o `null` en pruebas).
 */
export function setAdsService(implementation: IAdsService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de captación (o `null`). */
export function getAdsService(): IAdsService | null {
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

/** Store global de captación publicitaria. */
export const useAdsStore = create<IAdsState>()((set, get) => ({
  adCampaigns: [],
  adCampaignsStatus: 'idle',
  adCampaignsError: null,

  listAdCampaigns: async () => {
    if (service === null) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: 'La captación publicitaria no está disponible.',
      });
      return;
    }
    set({ adCampaignsStatus: 'loading', adCampaignsError: null });
    try {
      const page = await service.listAdCampaigns();
      set({ adCampaigns: page.items, adCampaignsStatus: 'success', adCampaignsError: null });
    } catch (error) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: extractErrorMessage(
          error,
          'No se pudieron cargar las campañas publicitarias.',
        ),
      });
    }
  },

  createAdCampaign: async (input: IAdCampaignInput) => {
    if (service === null) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: 'La captación publicitaria no está disponible.',
      });
      return;
    }
    set({ adCampaignsStatus: 'loading', adCampaignsError: null });
    try {
      const adCampaign = await service.createAdCampaign(input);
      set({
        adCampaigns: [...get().adCampaigns, adCampaign],
        adCampaignsStatus: 'success',
        adCampaignsError: null,
      });
    } catch (error) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: extractErrorMessage(error, 'No se pudo crear la campaña publicitaria.'),
      });
    }
  },

  updateAdCampaign: async (adCampaignId: string, input: Partial<IAdCampaignInput>) => {
    if (service === null) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: 'La captación publicitaria no está disponible.',
      });
      return;
    }
    set({ adCampaignsStatus: 'loading', adCampaignsError: null });
    try {
      const adCampaign = await service.updateAdCampaign(adCampaignId, input);
      set({
        adCampaigns: get().adCampaigns.map((current) =>
          current.id === adCampaignId ? adCampaign : current,
        ),
        adCampaignsStatus: 'success',
        adCampaignsError: null,
      });
    } catch (error) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: extractErrorMessage(
          error,
          'No se pudo actualizar la campaña publicitaria.',
        ),
      });
    }
  },

  deleteAdCampaign: async (adCampaignId: string) => {
    if (service === null) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: 'La captación publicitaria no está disponible.',
      });
      return;
    }
    set({ adCampaignsStatus: 'loading', adCampaignsError: null });
    try {
      await service.deleteAdCampaign(adCampaignId);
      set({
        adCampaigns: get().adCampaigns.filter((current) => current.id !== adCampaignId),
        adCampaignsStatus: 'success',
        adCampaignsError: null,
      });
    } catch (error) {
      set({
        adCampaignsStatus: 'error',
        adCampaignsError: extractErrorMessage(
          error,
          'No se pudo eliminar la campaña publicitaria.',
        ),
      });
    }
  },

  reset: () =>
    set({
      adCampaigns: [],
      adCampaignsStatus: 'idle',
      adCampaignsError: null,
    }),
}));
