import type { ReactElement } from 'react';

/**
 * Región de notificaciones toast (plan §4.2-B: éxito vía toast).
 *
 * Región con `role="status"` + `aria-live="polite"`; cada item muestra un
 * indicador de color según su tono. Devuelve `null` cuando no hay items.
 */
export type ToastTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Item individual de la región de notificaciones toast. */
export interface IToastItem {
  /** Identificador único del item (key de React). */
  id: string;
  /** Tono del indicador de color. */
  tone: ToastTone;
  /** Mensaje de la notificación. */
  message: string;
}

/** Propiedades de la región de notificaciones toast. */
export interface IToastProps {
  /** Items a mostrar; con lista vacía se devuelve `null`. */
  items: IToastItem[];
}

const TONE_DOT: Record<ToastTone, string> = {
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  neutral: 'bg-slate-400',
};

/**
 * Renderiza la región de notificaciones toast (`role="status"` + `aria-live="polite"`).
 */
export function Toast({ items }: IToastProps): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 shadow"
        >
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[item.tone]}`} />
          <span className="text-sm text-slate-700">{item.message}</span>
        </div>
      ))}
    </div>
  );
}
