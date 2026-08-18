/**
 * Canvas de edición de la landing.
 *
 * Contrato:
 * - Renderiza los bloques de la landing desde el hook `useEditorBlocks`.
 * - Delega la tarjeta individual en `BlockCard` (componente presentacional).
 */
import type { ReactElement } from 'react';
import { BlockCard } from '@/components/Editor/Canvas/BlockCard';
import { useEditorBlocks } from '@/hooks/useEditorBlocks';

/** Canvas central donde se renderizan los bloques de la landing. */
export function Canvas(): ReactElement {
  const { blocks, selectedBlockId, selectBlock, removeBlock } = useEditorBlocks();

  if (blocks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-slate-400">
        Selecciona un bloque de la librería para comenzar.
      </div>
    );
  }

  return (
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
  );
}
