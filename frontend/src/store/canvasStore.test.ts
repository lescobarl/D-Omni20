/**
 * Pruebas del store del estado del canvas con tests de inmutabilidad.
 *
 * Contrato:
 * - `setDraggingBlockId` / `setDragOverBlockId` actualizan sin mutar el estado previo.
 * - `clearDragState` limpia el estado de arrastre completo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/store/canvasStore';

describe('canvasStore', () => {
  beforeEach(() => {
    useCanvasStore.getState().clearDragState();
  });

  it('inicia sin bloque en arrastre ni sobrevolado', () => {
    const state = useCanvasStore.getState();
    expect(state.draggingBlockId).toBeNull();
    expect(state.dragOverBlockId).toBeNull();
  });

  it('registra el bloque arrastrado sin mutar el estado previo (inmutabilidad)', () => {
    const previous = useCanvasStore.getState();
    useCanvasStore.getState().setDraggingBlockId('block-1');

    const current = useCanvasStore.getState();
    expect(current.draggingBlockId).toBe('block-1');
    expect(previous.draggingBlockId).toBeNull();
    expect(previous).not.toBe(current);
  });

  it('registra el bloque sobrevolado durante el drag & drop', () => {
    useCanvasStore.getState().setDragOverBlockId('block-2');
    expect(useCanvasStore.getState().dragOverBlockId).toBe('block-2');
  });

  it('limpia ambos estados de arrastre', () => {
    const store = useCanvasStore.getState();
    store.setDraggingBlockId('block-1');
    store.setDragOverBlockId('block-2');

    useCanvasStore.getState().clearDragState();
    const state = useCanvasStore.getState();
    expect(state.draggingBlockId).toBeNull();
    expect(state.dragOverBlockId).toBeNull();
  });
});
