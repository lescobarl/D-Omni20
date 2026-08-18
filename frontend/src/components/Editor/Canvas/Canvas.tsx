/**
 * Canvas de edición de la landing.
 *
 * Contrato:
 * - Renderiza los bloques de la landing desde el hook `useEditorBlocks`.
 * - Envuelve la lista en `SortableContext` para permitir el reordenado con dnd-kit.
 * - En estado vacío muestra un droppable para recibir bloques desde la librería.
 */
import type { ReactElement } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { BlockCard } from '@/components/Editor/Canvas/BlockCard';
import { useEditorBlocks } from '@/hooks/useEditorBlocks';
import { CANVAS_EMPTY_DROPPABLE_ID } from '@/components/Editor/dnd/dragData';

/**
 * Área de destino cuando el canvas está vacío (recibe bloques de la librería).
 *
 * @returns Un contenedor droppable con el mensaje de estado vacío.
 */
function EmptyCanvas(): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_EMPTY_DROPPABLE_ID });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full items-center justify-center p-6 text-sm transition ${
        isOver ? 'bg-brand-50 text-brand-600' : 'text-slate-400'
      }`}
    >
      Selecciona un bloque de la librería para comenzar.
    </div>
  );
}

/** Canvas central donde se renderizan los bloques de la landing. */
export function Canvas(): ReactElement {
  const { blocks, selectedBlockId, selectBlock, removeBlock } = useEditorBlocks();
  const blockIds = blocks.map((block) => block.instance_id);

  if (blocks.length === 0) {
    return <EmptyCanvas />;
  }

  return (
    <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
      <div className="space-y-4 p-6">
        {blocks.map((block) => (
          <BlockCard
            key={block.instance_id}
            block={block}
            selected={selectedBlockId === block.instance_id}
            onSelect={selectBlock}
            onRemove={removeBlock}
          />
        ))}
      </div>
    </SortableContext>
  );
}
