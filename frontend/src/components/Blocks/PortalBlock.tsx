/**
 * Renderizador presentacional del bloque `portal` (C-3 — Portal del Cliente).
 *
 * Contrato:
 * - Recibe una instancia de bloque y muestra el llamado a acción del portal.
 * - Es presentacional puro: no accede al store global ni ejecuta efectos.
 * - El comportamiento interactivo (login, resumen, ARCO) lo aporta el widget
 *   `portal.js` servido por el backend, que el compilador inyecta en el HTML.
 */
import type { ReactElement } from 'react';
import type { IBlockInstance } from '@/types/editor';

interface IPortalBlockProps {
  /** Instancia de bloque de tipo `portal` a renderizar. */
  block: IBlockInstance;
}

/**
 * Renderiza la sección de acceso al Portal del Cliente de una landing.
 *
 * @example
 * ```tsx
 * <PortalBlock block={portalInstance} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El panel de acceso al portal con el título configurado.
 */
export function PortalBlock({ block }: IPortalBlockProps): ReactElement {
  return (
    <div className="rounded bg-white p-4">
      <h3 className="text-sm font-medium text-slate-700">
        {String(block.config.title ?? block.name)}
      </h3>
      <p className="mt-1 text-xs text-slate-400">{String(block.config.subtitle ?? '')}</p>
      <p className="mt-2 text-xs font-medium text-brand-600">
        {String(block.config.button_text ?? '')}
      </p>
    </div>
  );
}
