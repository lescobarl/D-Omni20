import type { ReactElement, ReactNode } from 'react';

/**
 * Insignia compartida de la librería `ui/` (plan §4.2-D).
 *
 * Tonos basados en design tokens/neutros. Cuando `tone` no está definido NO
 * se aplican clases de color, permitiendo inyectar clases externas vía
 * `className` (usado por la insignia SLA que proviene de `getSlaBadge`).
 */
export type BadgeTone = 'neutral' | 'muted' | 'sky' | 'brand' | 'success' | 'warning' | 'danger';

/** Propiedades de la insignia compartida `ui/` (plan §4.2-D). */
export interface IBadgeProps {
  /** Tono de la insignia; si no se define NO se aplican clases de color. */
  tone?: BadgeTone;
  /** Tipografía monoespaciada (por defecto `false`). */
  mono?: boolean;
  /** Clases adicionales para el contenedor. */
  className?: string;
  /** Contenido de la insignia. */
  children: ReactNode;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  muted: 'bg-slate-100 text-slate-500',
  sky: 'bg-sky-100 text-sky-700',
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
};

/**
 * Renderiza una insignia con el tono y estilo indicados.
 *
 * Cuando `tone` no está definido NO se aplican clases de color, permitiendo
 * inyectar estilos externos vía `className`.
 */
export function Badge({ tone, mono = false, className = '', children }: IBadgeProps): ReactElement {
  const fontClass = mono ? 'font-mono' : 'font-medium';
  const toneClass = tone ? TONE_CLASSES[tone] : '';
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs ${fontClass} ${toneClass} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
