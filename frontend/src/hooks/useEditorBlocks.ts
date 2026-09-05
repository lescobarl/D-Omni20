/**
 * Hook de acceso al estado de bloques del editor.
 *
 * Contrato:
 * - Expone bloques, selección y acciones del store con selectores memoizados
 *   (`useShallow`) para evitar re-renderizados innecesarios.
 */
import { useShallow } from 'zustand/react/shallow';
import { useEditorStoreContext } from '@/store/editorStoreContext';
import type { IBlockDefinition, IBlockInstance } from '@/types/editor';

/** Estado y acciones de bloques expuestas por el hook. */
export interface IUseEditorBlocks {
  /** Bloques ordenados de la landing en edición. */
  blocks: readonly IBlockInstance[];
  /** Identificador del bloque seleccionado (o `null`). */
  selectedBlockId: string | null;
  /** Agrega un bloque a la landing desde su definición. */
  addBlock: (definition: IBlockDefinition) => void;
  /** Agrega un bloque a la landing en una posición concreta (drag & drop). */
  addBlockAt: (definition: IBlockDefinition, index: number) => void;
  /** Elimina un bloque por su identificador de instancia. */
  removeBlock: (instanceId: string) => void;
  /** Mueve un bloque hacia arriba o abajo. */
  moveBlock: (instanceId: string, direction: 'up' | 'down') => void;
  /** Reordena un bloque a la posición de otro (drag & drop del canvas). */
  reorderBlock: (activeInstanceId: string, overInstanceId: string) => void;
  /** Selecciona un bloque (o deselecciona con `null`). */
  selectBlock: (instanceId: string | null) => void;
  /** Actualiza la configuración de un bloque de forma inmutable. */
  updateBlockConfig: (instanceId: string, patch: Record<string, unknown>) => void;
}

/**
 * Devuelve los bloques y acciones del editor con selectores memoizados.
 *
 * @example
 * ```tsx
 * const { blocks, selectedBlockId, selectBlock } = useEditorBlocks();
 * ```
 *
 * @returns Objeto con bloques, selección y acciones del store.
 */
export function useEditorBlocks(): IUseEditorBlocks {
  const store = useEditorStoreContext();
  return store(
    useShallow((state) => ({
      blocks: state.landing.blocks,
      selectedBlockId: state.selectedBlockId,
      addBlock: state.addBlock,
      addBlockAt: state.addBlockAt,
      removeBlock: state.removeBlock,
      moveBlock: state.moveBlock,
      reorderBlock: state.reorderBlock,
      selectBlock: state.selectBlock,
      updateBlockConfig: state.updateBlockConfig,
    })),
  );
}
