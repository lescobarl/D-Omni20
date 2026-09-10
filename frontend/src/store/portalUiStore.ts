/**
 * Preferencias de apariencia del portal de configuración (Studio).
 *
 * Contrato:
 * - Son preferencias de administración de ESTE navegador, independientes de la
 *   marca del tenant: controlan el look del portal de configuración, no el
 *   widget del cliente.
 * - Se persisten en `localStorage` (clave `omnibotia-studio-ui`) y se aplican en
 *   caliente a la cáscara del Studio (cabecera, navegación y lienzo de módulos).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Acento de marca usado en la navegación del portal. */
export type PortalAccent = 'brand' | 'neutral';

/** Superficie de fondo de los módulos del portal. */
export type PortalSurface = 'light' | 'tint';

/** Contrato del store de apariencia del portal de configuración. */
export interface IPortalUiState {
  /** Acento de marca: usa la marca del tenant o un gris neutro. */
  accent: PortalAccent;
  /** Superficie de los módulos: neutra o con un tinte de la marca. */
  surface: PortalSurface;
  /** Cambia el acento de marca del portal. */
  setAccent(accent: PortalAccent): void;
  /** Cambia la superficie de los módulos del portal. */
  setSurface(surface: PortalSurface): void;
}

/** Store persistente de la apariencia del portal (por navegador). */
export const usePortalUiStore = create<IPortalUiState>()(
  persist(
    (set) => ({
      accent: 'brand',
      surface: 'light',
      setAccent: (accent) => set({ accent }),
      setSurface: (surface) => set({ surface }),
    }),
    { name: 'omnibotia-studio-ui' },
  ),
);
