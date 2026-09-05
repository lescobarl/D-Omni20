import type { ReactElement } from 'react';
import { Button } from './Button';

/**
 * Estado de error compartido (plan §4.2-B): mensaje + botón «Reintentar» +
 * «ver detalle técnico» colapsable (nativo `<details>`/`<summary>`).
 *
 * NOTA: este componente NO declara su propia región live; el llamador lo
 * envuelve en el `role="status"`/`aria-live="polite"` correspondiente.
 */
export interface IErrorStateProps {
  /** Mensaje principal del error. */
  message: string;
  /** Detalle técnico colapsable (opcional). */
  detail?: string;
  /** Callback del botón de reintento (opcional). */
  onRetry?: () => void;
  /** Texto del botón de reintento (por defecto «Reintentar»). */
  retryLabel?: string;
}

/**
 * Renderiza el estado de error con botón «Reintentar» y detalle técnico colapsable.
 */
export function ErrorState({
  message,
  detail,
  onRetry,
  retryLabel = 'Reintentar',
}: IErrorStateProps): ReactElement {
  return (
    <div className="rounded border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-600">{message}</p>
      {detail ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-red-500">
            Ver detalle técnico
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-red-100 p-2 font-mono text-xs text-red-700">
            {detail}
          </pre>
        </details>
      ) : null}
      {onRetry ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
