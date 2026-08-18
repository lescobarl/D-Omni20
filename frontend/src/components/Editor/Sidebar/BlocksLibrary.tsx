/**
 * Librería de bloques del editor.
 *
 * Contrato:
 * - Lista el catálogo de bloques disponibles.
 * - Cada elemento es arrastrable (`useDraggable`) hacia el canvas del editor.
 * - El clic sin arrastre conserva la interacción previa: inserta el bloque al
 *   final de la landing.
 */
import type { ReactElement } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import { useEditorStore } from '@/store/editorStore';
import type { IBlockDefinition } from '@/types/editor';

interface ILibraryBlockItemProps {
  /** Definición del bloque del catálogo. */
  definition: IBlockDefinition;
  /** Callback que inserta el bloque en la landing. */
  onAdd: (definition: IBlockDefinition) => void;
}

/** Elemento arrastrable de la librería que inserta un bloque al hacer clic. */
function LibraryBlockItem({ definition, onAdd }: ILibraryBlockItemProps): ReactElement {
  const { setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id: `library-${definition.block_id}`,
    data: { fromLibrary: true, definition },
  });

  return (
    <li>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...listeners}
        onClick={() => onAdd(definition)}
        className={`w-full rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:bg-brand-50 ${
          isDragging ? 'opacity-40' : ''
        }`}
      >
        <span className="block text-sm font-medium text-slate-800">{definition.name}</span>
        <span className="mt-1 block text-xs text-slate-500">{definition.description}</span>
      </button>
    </li>
  );
}

/**
 * Panel lateral que expone los bloques arrastrables del catálogo.
 *
 * @example
 * ```tsx
 * <BlocksLibrary />
 * ```
 *
 * @returns La lista de bloques arrastrables que inserta en la landing.
 */
export function BlocksLibrary(): ReactElement {
  const addBlock = useEditorStore((state) => state.addBlock);

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Bloques</h2>
      <ul className="space-y-2">
        {BLOCK_CATALOG.map((definition) => (
          <LibraryBlockItem key={definition.block_id} definition={definition} onAdd={addBlock} />
        ))}
      </ul>
    </div>
  );
}
