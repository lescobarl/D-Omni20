/**
 * Renderizador presentacional de respaldo para tipos sin renderizado dedicado.
 *
 * Contrato:
 * - Recibe una instancia de bloque y muestra un estado "pendiente de renderizado".
 * - Es presentacional puro: no accede al store global ni ejecuta efectos.
 */
import type { ReactElement } from 'react';
import type { IBlockInstance } from '@/types/editor';

interface IFallbackBlockProps {
  /** Instancia de bloque sin renderizador dedicado. */
  block: IBlockInstance;
}

/**
 * Renderiza el estado pendiente de un bloque no implementado.
 *
 * @example
 * ```tsx
 * <FallbackBlock block={pendingInstance} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns Un aviso de renderizado pendiente con el nombre del bloque.
 */
export function FallbackBlock({ block }: IFallbackBlockProps): ReactElement {
  return (
    <div className="rounded bg-white p-4 text-sm text-slate-500">
      Bloque "{block.name}" pendiente de renderizado.
    </div>
  );
}
