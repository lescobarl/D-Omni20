/**
 * Tarjeta presentacional de un bloque dentro del canvas.
 *
 * Contrato:
 * - Muestra la cabecera del bloque (manija de arrastre + seleccionar + eliminar)
 *   y su renderizado.
 * - Usa `useSortable` para soportar el reordenado dentro del canvas con dnd-kit.
 * - Accesible: la selección se expone como botón con `aria-pressed` y el
 *   arrastre tiene una manija dedicada con `aria-label` para uso con teclado.
 */
import type { CSSProperties, ReactElement } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
 * Renderiza la tarjeta de un bloque con arrastre, selección y eliminación.
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
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging, isOver } =
    useSortable({
      id: block.instance_id,
      data: { fromLibrary: false, instanceId: block.instance_id },
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-white p-4 shadow-panel transition ${
        isDragging ? 'opacity-40' : ''
      } ${selected ? 'border-brand-500 ring-2 ring-brand-200' : ''} ${
        isOver ? 'border-brand-400 ring-2 ring-brand-200' : ''
      } ${!selected && !isOver ? 'border-slate-200' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={`Mover ${block.name}`}
          title="Arrastrar para reordenar"
          ref={setActivatorNodeRef}
          {...listeners}
          className="shrink-0 cursor-grab rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700 active:cursor-grabbing"
        >
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm8-16a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
          </svg>
        </button>
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
