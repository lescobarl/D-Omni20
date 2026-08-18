/**
 * Librería de bloques del editor.
 *
 * Contrato:
 * - Lista el catálogo de bloques disponibles.
 * - Inserta bloques en la landing mediante el store.
 */
import type { ReactElement } from 'react';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import { useEditorStore } from '@/store/editorStore';

/**
 * Panel lateral que expone los bloques disponibles del catálogo.
 *
 * @example
 * ```tsx
 * <BlocksLibrary />
 * ```
 *
 * @returns La lista de bloques del catálogo que inserta en la landing.
 */
export function BlocksLibrary(): ReactElement {
  const addBlock = useEditorStore((state) => state.addBlock);

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Bloques</h2>
      <ul className="space-y-2">
        {BLOCK_CATALOG.map((definition) => (
          <li key={definition.block_id}>
            <button
              type="button"
              onClick={() => addBlock(definition)}
              className="w-full rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="block text-sm font-medium text-slate-800">{definition.name}</span>
              <span className="mt-1 block text-xs text-slate-500">{definition.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
