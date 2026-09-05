import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

/**
 * Botón compartido de la librería `ui/` (plan §4.2-F).
 *
 * Variantes:
 * - `primary`: CTA principal con los design tokens del tenant (`brand-*`).
 * - `secondary`: acción alternativa (neutra).
 * - `danger`: acción destructiva.
 * - `tab`: solo aporta el anillo de foco; el estilo visual se inyecta vía
 *   `className` (usado por las vistas del CRM para conservar sus clases).
 *
 * Con `loading` muestra «Cargando…» y deshabilita el control (plan §4.2-C).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'tab';

/** Tamaño del botón (plan §4.2-C): `md` por defecto, `sm` para acciones compactas. */
export type ButtonSize = 'md' | 'sm';

/** Propiedades del botón compartido `ui/` (plan §4.2-F). */
export interface IButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Variante visual (por defecto `primary`). */
  variant?: ButtonVariant;
  /** Tamaño (por defecto `md`). */
  size?: ButtonSize;
  /** Muestra «Cargando…» y deshabilita el control. */
  loading?: boolean;
  /** Contenido del botón. */
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'rounded bg-brand-600 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50',
  secondary:
    'rounded border border-slate-300 font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50',
  danger:
    'rounded border border-red-200 font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50',
  tab: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
};

/** Tamaños del botón: padding y tipografía (plan §4.2-C). */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1 text-xs',
};

/**
 * Renderiza un botón accesible con variante, tamaño y estado de carga.
 *
 * La variante `tab` solo aporta el anillo de foco; el estilo visual se
 * inyecta vía `className`.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  type = 'button',
  disabled,
  ...rest
}: IButtonProps): ReactElement {
  const isDisabled = disabled || loading;
  // La variante `tab` solo aporta el anillo de foco; el tamaño se inyecta vía
  // `className` para no competir con las clases del llamador (regla CLAUDE).
  const sizeClasses = variant === 'tab' ? '' : SIZE_CLASSES[size];
  return (
    <button
      type={type}
      className={`${VARIANT_CLASSES[variant]} ${sizeClasses} ${className}`.trim()}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? 'Cargando…' : children}
    </button>
  );
}
