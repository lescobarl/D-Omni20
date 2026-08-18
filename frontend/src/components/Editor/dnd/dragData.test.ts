/**
 * Pruebas de la lógica pura del drag & drop del editor.
 *
 * Contrato:
 * - Los type guards distinguen correctamente el origen (librería vs canvas).
 * - `resolveDropAction` traduce cada combinación de origen/destino a la acción
 *   de negocio correcta (o a `noop` cuando no corresponde).
 * - No depende de DOM ni de dnd-kit: cobertura unitaria total.
 */
import { describe, expect, it } from 'vitest';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import {
  CANVAS_EMPTY_DROPPABLE_ID,
  isCanvasData,
  isLibraryData,
  resolveDropAction,
  type IDraggableCanvasData,
  type IDraggableLibraryData,
} from '@/components/Editor/dnd/dragData';

const libraryData: IDraggableLibraryData = {
  fromLibrary: true,
  definition: BLOCK_CATALOG[0],
};

const canvasData: IDraggableCanvasData = {
  fromLibrary: false,
  instanceId: 'block-a',
};

describe('dragData (type guards)', () => {
  it('reconoce los datos de la librería y descarta los demás', () => {
    expect(isLibraryData(libraryData)).toBe(true);
    expect(isLibraryData(canvasData)).toBe(false);
    expect(isLibraryData(null)).toBe(false);
    expect(isLibraryData(undefined)).toBe(false);
    expect(isLibraryData('texto')).toBe(false);
    expect(isLibraryData({ fromLibrary: 'no-booleano' })).toBe(false);
  });

  it('reconoce los datos del canvas y descarta los demás', () => {
    expect(isCanvasData(canvasData)).toBe(true);
    expect(isCanvasData(libraryData)).toBe(false);
    expect(isCanvasData(null)).toBe(false);
    expect(isCanvasData(undefined)).toBe(false);
    expect(isCanvasData(42)).toBe(false);
    expect(isCanvasData({ fromLibrary: false, sinInstancia: true })).toBe(true);
  });
});

describe('dragData (resolveDropAction)', () => {
  it('inserta al final cuando una librería suelta sobre el canvas vacío', () => {
    const action = resolveDropAction(libraryData, CANVAS_EMPTY_DROPPABLE_ID, null, ['a', 'b']);

    expect(action).toEqual({ kind: 'add-block', definition: BLOCK_CATALOG[0], index: 2 });
  });

  it('inserta en la posición del bloque destino cuando una librería suelta sobre el canvas', () => {
    const action = resolveDropAction(
      libraryData,
      'block-b',
      { fromLibrary: false, instanceId: 'block-b' },
      ['a', 'block-b', 'c'],
    );

    expect(action).toEqual({ kind: 'add-block', definition: BLOCK_CATALOG[0], index: 1 });
  });

  it('ignora una librería que suelta fuera del canvas (sin bloque destino)', () => {
    const action = resolveDropAction(libraryData, 'library-hero_video', null, ['a', 'b']);

    expect(action).toEqual({ kind: 'noop' });
  });

  it('reordena un bloque del canvas sobre otro bloque distinto', () => {
    const action = resolveDropAction(
      canvasData,
      'block-b',
      { fromLibrary: false, instanceId: 'block-b' },
      ['a', 'b'],
    );

    expect(action).toEqual({
      kind: 'reorder-block',
      activeInstanceId: 'block-a',
      overInstanceId: 'block-b',
    });
  });

  it('ignora un bloque del canvas soltado sobre sí mismo', () => {
    const action = resolveDropAction(
      canvasData,
      'block-a',
      { fromLibrary: false, instanceId: 'block-a' },
      ['a', 'b'],
    );

    expect(action).toEqual({ kind: 'noop' });
  });

  it('ignora un bloque del canvas soltado sobre la librería o el canvas vacío', () => {
    const overLibrary = resolveDropAction(canvasData, 'library-hero_video', libraryData, [
      'a',
      'b',
    ]);
    const overEmpty = resolveDropAction(canvasData, CANVAS_EMPTY_DROPPABLE_ID, null, ['a', 'b']);

    expect(overLibrary).toEqual({ kind: 'noop' });
    expect(overEmpty).toEqual({ kind: 'noop' });
  });

  it('ignora datos de origen desconocidos o ausentes', () => {
    expect(resolveDropAction(null, CANVAS_EMPTY_DROPPABLE_ID, null, ['a'])).toEqual({
      kind: 'noop',
    });
    expect(resolveDropAction({ origen: 'desconocido' }, 'block-a', null, ['a'])).toEqual({
      kind: 'noop',
    });
  });
});
