import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';

/**
 * Estado vacío compartido (plan §4.2-B): icono opcional + texto principal
 * (`role="status"`) + CTA opcional.
 */
export interface IEmptyStateProps {
  /** Icono decorativo opcional (`aria-hidden`). */
  icon?: ReactNode;
  /** Texto principal (leído por `role="status"`). */
  title: string;
  /** Descripción secundaria (opcional). */
  description?: string;
  /** Texto del CTA (opcional; requiere `onAction`). */
  actionLabel?: string;
  /** Callback del CTA (opcional). */
  onAction?: () => void;
}

/**
 * Renderiza el estado vacío con icono decorativo, texto `role="status"` y CTA opcional.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: IEmptyStateProps): ReactElement {
  return (
    <div className="py-6 text-center">
      {icon ? (
        <div className="mx-auto mb-2 text-slate-300" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p role="status" className="text-sm text-slate-500">
        {title}
      </p>
      {description ? <p className="mt-1 text-xs text-slate-400">{description}</p> : null}
      {actionLabel && onAction ? (
        <div className="mt-3">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
