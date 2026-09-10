/**
 * Sección "Look & feel del portal de configuración" (Studio).
 *
 * Contrato:
 * - Configura la apariencia de la INTERFAZ de configuración (este navegador):
 *   acento de marca (marca del tenant o neutro) y superficie de los módulos
 *   (neutra o con tinte de marca).
 * - No afecta la apariencia del widget del cliente (eso vive en la pestaña
 *   Apariencia). Cambios en caliente sobre la cáscara del Studio.
 */

import type { ReactElement } from 'react';
import { usePortalUiStore } from '@/store/portalUiStore';
import type { PortalAccent, PortalSurface } from '@/store/portalUiStore';

/** Opciones de acento de marca disponibles. */
const ACCENT_OPTIONS: ReadonlyArray<{ id: PortalAccent; label: string }> = [
  { id: 'brand', label: 'Marca del tenant' },
  { id: 'neutral', label: 'Neutro' },
];

/** Opciones de superficie de los módulos disponibles. */
const SURFACE_OPTIONS: ReadonlyArray<{ id: PortalSurface; label: string }> = [
  { id: 'light', label: 'Claro neutro' },
  { id: 'tint', label: 'Tinte de marca' },
];

/**
 * Panel de selección del acento y la superficie del portal de configuración.
 * @returns La tarjeta de preferencias visuales del portal.
 */
export function PortalLookSection(): ReactElement {
  const accent = usePortalUiStore((state) => state.accent);
  const surface = usePortalUiStore((state) => state.surface);
  const setAccent = usePortalUiStore((state) => state.setAccent);
  const setSurface = usePortalUiStore((state) => state.setSurface);

  return (
    <section
      aria-labelledby="portal-look-heading"
      className="mx-auto mb-6 w-full max-w-6xl rounded-2xl border border-edge/70 bg-surface p-6 shadow-panel"
    >
      <h2 id="portal-look-heading" className="text-base font-semibold text-slate-900">
        Look &amp; feel del portal de configuración
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Aplica a toda la interfaz del Studio en este navegador. La marca del widget del cliente se
        configura en la pestaña Apariencia.
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-slate-700">Acento de marca</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ACCENT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={accent === option.id}
                onClick={() => setAccent(option.id)}
                className={
                  accent === option.id
                    ? 'rounded border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Superficie de módulos</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SURFACE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={surface === option.id}
                onClick={() => setSurface(option.id)}
                className={
                  surface === option.id
                    ? 'rounded border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
