/**
 * Editor visual de JSON Schemas (Draft 2020-12).
 *
 * Contrato:
 * - Convierte el borrador del store (`draftSchema`) a un árbol visual inmutable
 *   (`SchemaNode`) mediante `schemaToNodes` y persiste cada mutación con
 *   `setDraftSchema(nodesToSchema(...))` (conversores puros e invertibles).
 * - El reordenamiento por arrastre solo actúa entre hermanos del mismo padre; el
 *   reordenamiento por botones ↑/↓ delega en `findSiblings` + `reorderSiblings`.
 * - La validación delega en `useSchemaStore.validate`, que invoca el servicio de
 *   validación (DI) y expone `validationStatus`/`validationResult`/`validationError`.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useSchemaStore } from '@/store/schemaStore';
import { PropertyPanel } from './PropertyPanel';
import { SchemaNode as SchemaNodeRow } from './SchemaNode';
import {
  addChild,
  createPropertyNode,
  findNode,
  findSiblings,
  nodesToSchema,
  removeChild,
  reorderSiblings,
  schemaToNodes,
  updateNode,
  type SchemaNode,
  type SchemaNodePatch,
} from './schemaTree';

/**
 * Editor visual de JSON Schemas.
 * @returns El árbol editable, el panel de propiedades y la vista JSON previa.
 */
export function VisualSchemaEditor(): ReactElement {
  const draftSchema = useSchemaStore((state) => state.draftSchema);
  const setDraftSchema = useSchemaStore((state) => state.setDraftSchema);
  const validationStatus = useSchemaStore((state) => state.validationStatus);
  const validationResult = useSchemaStore((state) => state.validationResult);
  const validationError = useSchemaStore((state) => state.validationError);
  const validate = useSchemaStore((state) => state.validate);
  const setVisualMode = useSchemaStore((state) => state.setVisualMode);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const root = useMemo(() => schemaToNodes(draftSchema), [draftSchema]);
  const selectedNode = selectedId !== null ? findNode(root, selectedId) : null;

  const commit = (next: SchemaNode): void => {
    setDraftSchema(nodesToSchema(next));
  };

  const handleUpdate = (id: string, patch: SchemaNodePatch): void => {
    commit(updateNode(root, id, patch));
  };

  const handleAddChild = (parentId: string): void => {
    commit(addChild(root, parentId, createPropertyNode()));
  };

  const handleRemove = (id: string): void => {
    commit(removeChild(root, id));
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const handleMove = (id: string, direction: 'up' | 'down'): void => {
    const siblings = findSiblings(root, id);
    if (siblings === null) {
      return;
    }
    const index = siblings.findIndex((node) => node.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) {
      return;
    }
    commit(reorderSiblings(root, id, siblings[target].id));
  };

  const handleDropOn = (targetId: string): void => {
    if (dragId === null || dragId === targetId) {
      setDragId(null);
      return;
    }
    const dragSiblings = findSiblings(root, dragId);
    const targetSiblings = findSiblings(root, targetId);
    if (dragSiblings === null || targetSiblings === null || dragSiblings !== targetSiblings) {
      setDragId(null);
      return;
    }
    commit(reorderSiblings(root, dragId, targetId));
    setDragId(null);
  };

  const handleClose = (): void => {
    setVisualMode(false);
  };

  const previewJson = JSON.stringify(nodesToSchema(root), null, 2);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Editor visual de Schema</h2>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
        >
          Volver al JSON
        </button>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-2">
        <SchemaNodeRow
          node={root}
          depth={0}
          selectedId={selectedId}
          dragId={dragId}
          onSelect={setSelectedId}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onMove={handleMove}
          onDragStart={setDragId}
          onDragEnd={() => setDragId(null)}
          onDropOn={handleDropOn}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleAddChild(root.id)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          + Añadir propiedad
        </button>
        <button
          type="button"
          onClick={() => void validate()}
          disabled={validationStatus === 'loading'}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          {validationStatus === 'loading' ? 'Validando…' : 'Validar schema'}
        </button>
      </div>

      <div role="status" aria-live="polite">
        {validationStatus === 'success' && validationResult !== null && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              validationResult.valid
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {validationResult.valid
              ? `El schema es válido (${validationResult.errors} incidencias).`
              : `El schema tiene ${validationResult.errors} incidencia(s).`}
            {validationResult.issues.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs">
                {validationResult.issues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <code className="font-mono">{issue.path}</code>: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {validationStatus === 'error' && validationError !== null && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
          >
            {validationError}
          </p>
        )}
      </div>

      {selectedNode !== null && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <PropertyPanel
            node={selectedNode}
            isRoot={selectedNode.id === root.id}
            onUpdate={handleUpdate}
            onAddChild={handleAddChild}
            onRemove={handleRemove}
          />
        </div>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Vista previa JSON
        </h3>
        <pre className="max-h-40 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-200">
          {previewJson}
        </pre>
      </div>
    </div>
  );
}
