/**
 * Tarjeta presentacional de un bloque dentro del canvas.
 *
 * Contrato:
 * - Muestra la cabecera del bloque (seleccionar + eliminar) y su renderizado.
 * - Es presentacional puro: recibe callbacks y estado de selección por props.
 * - Accesible: la selección se expone como botón con `aria-pressed` para
 *   permitir su uso exclusivo con teclado (sin anidar elementos interactivos).
 */
import type { ReactElement } from 'react';
import type { IBlockInstance } from '@/types/editor';
import { BlockRenderer } from '@/components/Blocks/BlockRenderer';

interface IBlockCardProps {
  /** Instancia de bloque a mostrar. */
  block: IBlockInstance;
  /** Indica si el bloque está seleccionado en el canvas. */
  selected: boolean;
  /** Callback al seleccionar el bloque (recibe el `instance_id`). */
  onSelect: (instanceId: string) => void;
  /** Callback al eliminar el bloque (recibe el `instance_id`). */
  onRemove: (instanceId: string) => void;
}

/**
 * Renderiza la tarjeta de un bloque con selección y eliminación accesibles.
 *
 * @example
 * ```tsx
 * <BlockCard block={block} selected={isSelected} onSelect={selectBlock} onRemove={removeBlock} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La tarjeta del bloque con su contenido renderizado.
 */
export function BlockCard({ block, selected, onSelect, onRemove }: IBlockCardProps): ReactElement {
  return (
    <article
      className={`rounded-lg border bg-white p-4 shadow-panel transition ${
        selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(block.instance_id)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-500 hover:text-brand-700"
        >
          {block.name}
        </button>
        <button
          type="button"
          onClick={() => onRemove(block.instance_id)}
          className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          Eliminar
        </button>
      </div>
      <BlockRenderer block={block} />
    </article>
  );
}
