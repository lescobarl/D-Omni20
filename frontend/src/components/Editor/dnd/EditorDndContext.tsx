/**
 * Contexto de arrastre (DndContext) del editor de landings.
 *
 * Contrato:
 * - Envuelve los tres paneles para compartir un único contexto entre la
 *   librería de bloques (origen) y el canvas (destino).
 * - `PointerSensor` usa `distance: 4` para no interferir con los clics de los
 *   botones de la librería y del canvas.
 * - La lógica de soltado se delega en `resolveDropAction` (función pura y
 *   testeable); el componente solo la despacha al store.
 * - El `DragOverlay` muestra una miniatura según el origen del arrastre.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { BlockRenderer } from '@/components/Blocks/BlockRenderer';
import { useEditorBlocks } from '@/hooks/useEditorBlocks';
import { useCanvasStore } from '@/store/canvasStore';
import type { IBlockDefinition, IBlockInstance } from '@/types/editor';
import { isCanvasData, isLibraryData, resolveDropAction } from '@/components/Editor/dnd/dragData';

/** Elemento activo del arrastre mostrado en el DragOverlay. */
type IActiveDrag =
  { type: 'library'; definition: IBlockDefinition } | { type: 'canvas'; block: IBlockInstance };

/** Contenido del DragOverlay según el origen del arrastre. */
function OverlayContent({ drag }: { drag: IActiveDrag }): ReactElement {
  if (drag.type === 'canvas') {
    return (
      <div className="w-72 rounded-lg border border-brand-300 bg-white p-3 shadow-lg">
        <BlockRenderer block={drag.block} />
      </div>
    );
  }
  return (
    <div className="w-72 rounded-md border border-brand-300 bg-white p-3 shadow-lg">
      <span className="block text-sm font-medium text-slate-800">{drag.definition.name}</span>
      <span className="mt-1 block text-xs text-slate-500">{drag.definition.description}</span>
    </div>
  );
}

interface IEditorDndContextProps {
  /** Contenido envuelto por el contexto de arrastre. */
  children: ReactNode;
}

/**
 * Provee el contexto de drag & drop a los paneles del editor.
 *
 * @example
 * ```tsx
 * <EditorDndContext>
 *   <div className="flex flex-1 overflow-hidden">{/* paneles *\/}</div>
 * </EditorDndContext>
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El contexto de arrastre con sus paneles y el DragOverlay.
 */
export function EditorDndContext({ children }: IEditorDndContextProps): ReactElement {
  const { blocks, addBlockAt, reorderBlock } = useEditorBlocks();
  const setDraggingBlockId = useCanvasStore((state) => state.setDraggingBlockId);
  const setDragOverBlockId = useCanvasStore((state) => state.setDragOverBlockId);
  const clearDragState = useCanvasStore((state) => state.clearDragState);
  const [activeDrag, setActiveDrag] = useState<IActiveDrag | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const blockIds = blocks.map((block) => block.instance_id);

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current;
    setDraggingBlockId(event.active.id as string);
    if (isLibraryData(data)) {
      setActiveDrag({ type: 'library', definition: data.definition });
    } else if (isCanvasData(data)) {
      const block = blocks.find((candidate) => candidate.instance_id === data.instanceId);
      if (block) {
        setActiveDrag({ type: 'canvas', block });
      }
    }
  };

  const handleDragOver = (event: DragOverEvent): void => {
    setDragOverBlockId(event.over ? (event.over.id as string) : null);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over) {
      const action = resolveDropAction(
        active.data.current,
        over.id as string,
        over.data.current,
        blockIds,
      );
      if (action.kind === 'add-block') {
        addBlockAt(action.definition, action.index);
      } else if (action.kind === 'reorder-block') {
        reorderBlock(action.activeInstanceId, action.overInstanceId);
      }
    }
    setActiveDrag(null);
    clearDragState();
  };

  const handleDragCancel = (): void => {
    setActiveDrag(null);
    clearDragState();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay>{activeDrag ? <OverlayContent drag={activeDrag} /> : null}</DragOverlay>
    </DndContext>
  );
}
