import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Diálogo modal compartido (plan §4.2-F).
 *
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (título).
 * - Cierra con `Escape` y atrapa el foco con `Tab` (primer/último elemento).
 * - Restaura el foco al elemento previo al cerrarse.
 * - Devuelve `null` cuando `open` es falso.
 */
export interface IModalProps {
  /** Controla la visibilidad; `false` devuelve `null`. */
  open: boolean;
  /** Callback al cerrar (Escape o botón de cierre). */
  onClose: () => void;
  /** Título del diálogo (`aria-labelledby`). */
  title: string;
  /** Contenido del diálogo. */
  children: ReactNode;
  /** Texto del botón de cierre (por defecto «Cerrar»). */
  closeLabel?: string;
}

/**
 * Renderiza un diálogo modal accesible: foco atrapado, cierre por `Escape` y
 * restauración del foco previo.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  closeLabel = 'Cerrar',
}: IModalProps): ReactElement | null {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Se mantiene `onClose` en una ref para que el efecto de foco solo se ejecute
  // cuando `open` cambia de estado y no en cada render (los callbacks inline
  // crearían una referencia nueva por render y robarían el foco del contenido).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleTab = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleTab}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
        <div className="mt-4 flex justify-end">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
