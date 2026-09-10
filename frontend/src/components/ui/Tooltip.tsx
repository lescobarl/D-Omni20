import {
  cloneElement,
  useId,
  useState,
  type KeyboardEvent,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Globos de ayuda accesibles de la librería `ui/`.
 *
 * Contrato de accesibilidad (patrón tooltip de WAI-ARIA):
 * - El elemento disparador recibe `aria-describedby` apuntando al globo, cuyo
 *   contenido se asocia siempre al árbol de accesibilidad del documento.
 * - El globo se muestra al posar el cursor sobre el disparador y al enfocarlo
 *   por teclado; `Escape` lo oculta sin perder el foco.
 * - No contiene elementos interactivos: es información suplementaria.
 * - El contenedor es `position: relative` y el globo se posiciona debajo del
 *   disparador centrado (clases de Tailwind).
 *
 * @example
 * ```tsx
 * <Tooltip content="Horas máximas para responder.">
 *   <button type="button" aria-label="Ayuda">ⓘ</button>
 * </Tooltip>
 * ```
 */
export interface ITooltipProps {
  /** Contenido del globo (información suplementaria no interactiva). */
  content: ReactNode;
  /** Elemento disparador (botón, insignia, icono). Recibe los manejadores y `aria-describedby`. */
  children: ReactElement;
  /** Clases adicionales para el contenedor relativo. */
  className?: string;
}

/**
 * Combina un manejador propio con uno ya existente en el disparador.
 * @param own - Manejador interno del tooltip.
 * @param existing - Manejador previo del disparador (puede no existir).
 * @returns Función que invoca ambos en orden.
 */
function mergeHandlers<T>(
  own: (event: T) => void,
  existing?: (event: T) => void,
): (event: T) => void {
  return (event) => {
    if (typeof existing === 'function') {
      existing(event);
    }
    own(event);
  };
}

/**
 * Renderiza un globo de ayuda accesible vinculado a su elemento disparador.
 *
 * El disparador se clona y recibe:
 * - `aria-describedby` con el id del globo (relación estable);
 * - manejadores de hover/foco para alternar la visibilidad;
 * - cierre con `Escape`.
 *
 * @param props - Propiedades del componente (ver {@link ITooltipProps}).
 * @returns El disparador y su globo de ayuda.
 */
export function Tooltip({ content, children, className = '' }: ITooltipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const openTooltip = (): void => setOpen(true);
  const closeTooltip = (): void => setOpen(false);

  const trigger = cloneElement(children, {
    'aria-describedby': tooltipId,
    onMouseEnter: mergeHandlers<MouseEvent<HTMLElement>>(openTooltip, children.props.onMouseEnter),
    onMouseLeave: mergeHandlers<MouseEvent<HTMLElement>>(closeTooltip, children.props.onMouseLeave),
    onFocus: mergeHandlers<FocusEvent<HTMLElement>>(openTooltip, children.props.onFocus),
    onBlur: mergeHandlers<FocusEvent<HTMLElement>>(closeTooltip, children.props.onBlur),
    onKeyDown: mergeHandlers<KeyboardEvent<HTMLElement>>((event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }, children.props.onKeyDown),
  });

  return (
    <span className={`relative inline-flex ${className}`.trim()}>
      {trigger}
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max max-w-xs -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-xs leading-snug text-white shadow-lg ${
          open ? 'visible' : 'invisible'
        }`.trim()}
      >
        {content}
      </span>
    </span>
  );
}
