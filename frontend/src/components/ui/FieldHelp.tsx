import type { ReactElement } from 'react';
import { Tooltip } from './Tooltip';

/**
 * Icono de ayuda accesible de la librería `ui/`.
 *
 * Renderiza un botón con el icono ⓘ (información) junto a la etiqueta de un
 * campo. El texto de ayuda viaja por `content` y se presenta en un globo
 * (`role="tooltip"`) vinculado con `aria-describedby`: visible en hover y al
 * enfocar por teclado, y anunciado por lectores de pantalla al tabular al icono.
 *
 * El nombre accesible del botón es GENÉRICO («Ayuda contextual») a propósito:
 * incluir el nombre del campo colisiona con los localizadores
 * `getByLabel(<campo>)` (el botón quedaría como segundo match). El nombre del
 * campo se conserva en `data-help-for` para depuración, no para accesibilidad.
 *
 * El contenido NO se escribe en el componente: el llamador lo obtiene del
 * catálogo central de ayuda de campos (única fuente de verdad mantenible).
 */
export interface IFieldHelpProps {
  /** Texto de ayuda que se mostrará en el globo y se anunciará al lector. */
  content: string;
  /** Nombre del campo al que da soporte (solo `data-help-for`, no accesible). */
  label?: string;
  /** Clases adicionales para el contenedor relativo del tooltip. */
  className?: string;
}

/**
 * Icono de ayuda con globo accesible para acompañar la etiqueta de un campo.
 *
 * @param props - Propiedades del componente (ver {@link IFieldHelpProps}).
 * @returns Un botón de información con su globo de ayuda.
 */
export function FieldHelp({ content, label, className = '' }: IFieldHelpProps): ReactElement {
  return (
    <Tooltip content={content} className={className}>
      <button
        type="button"
        aria-label="Ayuda contextual"
        data-help-for={label ?? ''}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 7.2v3.1M8 5.5h.01"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </Tooltip>
  );
}
