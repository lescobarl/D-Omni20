/**
 * Renderizador presentacional del bloque `services_grid`.
 *
 * Contrato:
 * - Recibe una instancia de bloque y muestra el layout configurado.
 * - Es presentacional puro: no accede al store global ni ejecuta efectos.
 */
import type { ReactElement } from 'react';
import type { IBlockInstance } from '@/types/editor';

interface IServicesGridBlockProps {
  /** Instancia de bloque de tipo `services_grid` a renderizar. */
  block: IBlockInstance;
}

/**
 * Renderiza la cuadrícula de servicios o productos de una landing.
 *
 * @example
 * ```tsx
 * <ServicesGridBlock block={servicesInstance} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La cuadrícula con el layout configurado por la instancia.
 */
export function ServicesGridBlock({ block }: IServicesGridBlockProps): ReactElement {
  return (
    <div className="rounded bg-white p-4">
      <h3 className="text-sm font-medium text-slate-700">{block.name}</h3>
      <p className="mt-1 text-xs text-slate-400">Layout: {String(block.config.layout ?? '')}</p>
    </div>
  );
}
