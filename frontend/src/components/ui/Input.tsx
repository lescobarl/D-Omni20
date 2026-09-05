import { useId, type InputHTMLAttributes, type ReactElement } from 'react';

/**
 * Campo de texto compartido de la librería `ui/` (plan §4.2-C).
 *
 * - Etiqueta asociada vía `htmlFor`/`id` (accessible name exacto).
 * - Los campos obligatorios (`required`) muestran `*` como span hermano
 *   FUERA del `<label>` para no alterar el accessible name, además de
 *   `aria-required="true"`.
 * - `error` añade `aria-invalid`, `aria-describedby` y un mensaje con
 *   `role="status"`.
 * - `hint` añade ayuda accesible vía `aria-describedby`.
 */
export interface IInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Etiqueta accesible del campo (`htmlFor`/`id`). */
  label: string;
  /** Ayuda accesible vía `aria-describedby` (opcional). */
  hint?: string;
  /** Mensaje de error: añade `aria-invalid` y `aria-describedby`. */
  error?: string | null;
}

/**
 * Renderiza un campo de texto con etiqueta accesible, ayuda y error (plan §4.2-C).
 */
export function Input({
  label,
  hint,
  error,
  id,
  required,
  className = '',
  ...rest
}: IInputProps): ReactElement {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div>
      <span className="block">
        <label htmlFor={inputId} className="text-sm text-slate-600">
          {label}
        </label>
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-red-600">
            *
          </span>
        ) : null}
      </span>
      <input
        id={inputId}
        required={required}
        aria-required={required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy !== '' ? describedBy : undefined}
        className={`mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
          error ? 'border-red-400' : ''
        } ${className}`.trim()}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="mt-1 block text-xs text-slate-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <span id={errorId} role="status" className="mt-1 block text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}
