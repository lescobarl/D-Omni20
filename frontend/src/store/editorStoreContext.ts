/**
 * Contexto React que provee el store del editor a los componentes compartidos.
 *
 * Contrato:
 * - Permite que el configurador único (landing y portal) reutilice los mismos
 *   componentes de tri-panel sin acoplarlos a un store concreto.
 * - Por defecto provee `useEditorStore` (landing), manteniendo compatibilidad
 *   con todos los consumidores y tests existentes.
 * - `PortalEditor` puede proveer un store de portal (superset de `IEditorState`)
 *   mediante el mismo contexto, cumpliendo el requisito de "un solo configurador".
 */
import { createContext, useContext } from 'react';
import type { IEditorState } from '@/types/editor';
import { useEditorStore } from '@/store/editorStore';

/**
 * Superficie del hook de store (zustand) que consumen los componentes compartidos.
 * Estructuralmente compatible con `useEditorStore` y con un store de portal.
 */
export interface EditorStoreApi {
  /** Selector con estado derivado. */
  <T>(selector: (state: IEditorState) => T): T;
  /** Acceso directo al estado completo. */
  (): IEditorState;
  /** Estado actual sin suscripción. */
  getState(): IEditorState;
  /** Actualiza el estado de forma parcial o total. */
  setState(
    partial:
      | IEditorState
      | Partial<IEditorState>
      | ((state: IEditorState) => IEditorState | Partial<IEditorState>),
    replace?: boolean,
  ): void;
  /** Suscripción a cambios de estado. */
  subscribe(listener: (state: IEditorState, prevState: IEditorState) => void): () => void;
  /** Estado inicial del store. */
  getInitialState(): IEditorState;
}

/** Valor por defecto: el store global del editor (landing). */
const defaultValue: EditorStoreApi = useEditorStore;

/** Contexto del store del editor. */
export const EditorStoreContext = createContext<EditorStoreApi>(defaultValue);

/**
 * Hook de acceso al store del editor desde el contexto.
 * @returns El store del editor activo (landing por defecto o portal si fue proveído).
 */
export function useEditorStoreContext(): EditorStoreApi {
  return useContext(EditorStoreContext);
}
