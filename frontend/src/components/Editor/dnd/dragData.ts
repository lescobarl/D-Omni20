/**
 * Datos y resolución de acciones del drag & drop del editor.
 *
 * Contrato:
 * - Define la estructura de datos que dnd-kit transporta entre la librería de
 *   bloques (origen) y el canvas (destino).
 * - `resolveDropAction` es una función pura y testeable: convierte el resultado
 *   de un drag finalizado en la acción de negocio correspondiente.
 * - No depende de DOM ni de dnd-kit, lo que permite cobertura unitaria total.
 */
import type { IBlockDefinition } from '@/types/editor';

/** Identificador del droppable que representa el canvas vacío. */
export const CANVAS_EMPTY_DROPPABLE_ID = 'canvas-empty';

/** Datos de un elemento arrastrado desde la librería de bloques. */
export interface IDraggableLibraryData {
  /** Distingue el origen de la librería (insertar). */
  fromLibrary: true;
  /** Definición del bloque que se arrastra. */
  definition: IBlockDefinition;
}

/** Datos de un bloque arrastrado desde el canvas (reordenación). */
export interface IDraggableCanvasData {
  /** Distingue el origen del canvas (reordenar). */
  fromLibrary: false;
  /** Identificador de la instancia arrastrada. */
  instanceId: string;
}

/** Unión de los datos posibles transportados durante el arrastre. */
export type IDragData = IDraggableLibraryData | IDraggableCanvasData;

/** Acción de negocio resultante de un drag & drop finalizado. */
export type IDropAction =
  | { kind: 'add-block'; definition: IBlockDefinition; index: number }
  | { kind: 'reorder-block'; activeInstanceId: string; overInstanceId: string }
  | { kind: 'noop' };

/**
 * Comprueba si los datos transportados provienen de la librería.
 * @param data Datos del elemento activo del arrastre.
 * @returns `true` si el elemento proviene de la librería de bloques.
 */
export function isLibraryData(data: unknown): data is IDraggableLibraryData {
  return Boolean(
    data &&
    typeof data === 'object' &&
    'fromLibrary' in data &&
    (data as IDraggableLibraryData).fromLibrary === true,
  );
}

/**
 * Comprueba si los datos transportados provienen del canvas.
 * @param data Datos del elemento activo del arrastre.
 * @returns `true` si el elemento proviene del canvas.
 */
export function isCanvasData(data: unknown): data is IDraggableCanvasData {
  return Boolean(
    data &&
    typeof data === 'object' &&
    'fromLibrary' in data &&
    (data as IDraggableCanvasData).fromLibrary === false,
  );
}

/**
 * Resuelve la acción de negocio de un drag & drop finalizado.
 *
 * Reglas:
 * - Librería → canvas vacío: inserta el bloque al final.
 * - Librería → bloque del canvas: inserta el bloque en la posición de destino.
 * - Canvas → librería: sin efecto (no se elimina el bloque).
 * - Canvas → canvas (distinto): reordena la instancia activa a la posición de destino.
 * - Cualquier otro caso (mismo bloque, datos ausentes): sin efecto.
 *
 * @param activeData Datos del elemento arrastrado.
 * @param overId Identificador del destino sobrevolado.
 * @param overData Datos del destino sobrevolado (o `null`).
 * @param blockIds Identificadores ordenados de los bloques del canvas.
 * @returns La acción de negocio a ejecutar (o `noop`).
 */
export function resolveDropAction(
  activeData: unknown,
  overId: string,
  overData: unknown,
  blockIds: readonly string[],
): IDropAction {
  if (isLibraryData(activeData)) {
    if (overId === CANVAS_EMPTY_DROPPABLE_ID) {
      return { kind: 'add-block', definition: activeData.definition, index: blockIds.length };
    }
    const index = blockIds.indexOf(overId);
    if (index === -1) {
      return { kind: 'noop' };
    }
    return { kind: 'add-block', definition: activeData.definition, index };
  }

  if (isCanvasData(activeData)) {
    if (isCanvasData(overData) && overData.instanceId !== activeData.instanceId) {
      return {
        kind: 'reorder-block',
        activeInstanceId: activeData.instanceId,
        overInstanceId: overData.instanceId,
      };
    }
  }

  return { kind: 'noop' };
}
