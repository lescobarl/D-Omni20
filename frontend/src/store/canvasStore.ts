/**
 * Store del estado del canvas (arrastre de bloques).
 *
 * Contrato:
 * - Estado actualizado de forma inmutable (sin mutación de referencias previas).
 * - Gestiona el identificador del bloque arrastrado y el sobrevolado durante
 *   el drag & drop (preparación para la integración con dnd-kit en Fase 5).
 */
import { create } from 'zustand';

/** Contrato del store del estado del canvas. */
export interface ICanvasState {
  /** Identificador del bloque en arrastre (o `null` si no hay arrastre). */
  draggingBlockId: string | null;
  /** Identificador del bloque sobrevolado durante el arrastre (o `null`). */
  dragOverBlockId: string | null;
  /** Registra el bloque que inicia el arrastre (o `null` al soltar). */
  setDraggingBlockId(blockId: string | null): void;
  /** Registra el bloque sobrevolado durante el arrastre. */
  setDragOverBlockId(blockId: string | null): void;
  /** Limpia el estado de arrastre completo. */
  clearDragState(): void;
}

/** Store del estado del canvas del editor. */
export const useCanvasStore = create<ICanvasState>()((set) => ({
  draggingBlockId: null,
  dragOverBlockId: null,
  setDraggingBlockId: (blockId) => set({ draggingBlockId: blockId }),
  setDragOverBlockId: (blockId) => set({ dragOverBlockId: blockId }),
  clearDragState: () => set({ draggingBlockId: null, dragOverBlockId: null }),
}));
