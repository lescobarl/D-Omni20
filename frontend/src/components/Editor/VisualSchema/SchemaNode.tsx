/**
 * Fila recursiva del árbol visual de un JSON Schema.
 *
 * Contrato:
 * - Fila presentacional: permite seleccionar, editar la clave (o el título en la
 *   raíz), cambiar el tipo, marcar como obligatoria (no raíz), reordenar con los
 *   botones ↑/↓ o por arrastre y eliminar (no raíz).
 * - Los objetos renderizan sus propiedades de forma recursiva con sangría creciente.
 * - El reordenamiento se delega al editor mediante `onMove`, `onDragStart`,
 *   `onDragEnd` y `onDropOn` (la fila no muta el árbol por sí misma).
 */
import type { ChangeEvent, DragEvent, ReactElement } from 'react';
import type { SchemaNode, SchemaNodePatch, SchemaNodeType } from './schemaTree';
import { TypeSelector } from './TypeSelector';

/** Sangría en píxeles por nivel de profundidad. */
const INDENT_PER_DEPTH = 14;

interface ISchemaNodeProps {
  /** Nodo a renderizar. */
  node: SchemaNode;
  /** Profundidad del nodo dentro del árbol (la raíz es 0). */
  depth: number;
  /** Identificador del nodo seleccionado (o `null` si no hay selección). */
  selectedId: string | null;
  /** Identificador del nodo arrastrado (o `null`). */
  dragId: string | null;
  /** Selecciona un nodo por identificador. */
  onSelect(id: string): void;
  /** Actualiza un nodo con un parche inmutable. */
  onUpdate(id: string, patch: SchemaNodePatch): void;
  /** Elimina el nodo indicado. */
  onRemove(id: string): void;
  /** Mueve un nodo dentro de sus hermanos. */
  onMove(id: string, direction: 'up' | 'down'): void;
  /** Comienza un arrastre de reordenamiento. */
  onDragStart(id: string): void;
  /** Finaliza el arrastre. */
  onDragEnd(): void;
  /** Suelta el nodo arrastrado sobre otro hermano. */
  onDropOn(id: string): void;
}

/**
 * Fila recursiva del editor visual de JSON Schemas.
 * @param props - Propiedades de la fila.
 * @returns La fila del nodo y, si es objeto, sus propiedades recursivas.
 */
export function SchemaNode({
  node,
  depth,
  selectedId,
  dragId,
  onSelect,
  onUpdate,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDropOn,
}: ISchemaNodeProps): ReactElement {
  const isRoot = node.key === '';
  const isSelected = node.id === selectedId;
  const isDropTarget = dragId !== null && dragId !== node.id;

  const handleKeyChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onUpdate(node.id, { key: event.target.value });
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onUpdate(node.id, { title: event.target.value });
  };

  const handleTypeChange = (type: SchemaNodeType): void => {
    onUpdate(node.id, { type });
  };

  const handleDragStart = (event: DragEvent<HTMLSpanElement>): void => {
    event.stopPropagation();
    onDragStart(node.id);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    onDropOn(node.id);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={isRoot ? 'Raíz del schema' : `Propiedad ${node.key}`}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(node.id);
          }
        }}
        onDragOver={(event) => {
          if (isDropTarget) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={handleDrop}
        style={{ paddingLeft: depth * INDENT_PER_DEPTH }}
        className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-sm transition ${
          isSelected
            ? 'border-brand-300 bg-brand-50'
            : dragId === node.id
              ? 'border-brand-300 opacity-60'
              : 'border-transparent hover:border-slate-200'
        }`}
      >
        <span
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          title="Arrastrar para reordenar"
          className="cursor-grab select-none text-slate-400 hover:text-slate-600"
          aria-hidden="true"
        >
          ⋮⋮
        </span>

        {isRoot ? (
          <input
            type="text"
            value={node.title}
            onChange={handleTitleChange}
            placeholder="Título del schema"
            aria-label="Título del schema"
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-800 focus:border-brand-300 focus:bg-white focus:outline-none"
          />
        ) : (
          <input
            type="text"
            value={node.key}
            onChange={handleKeyChange}
            aria-label={`Clave de ${node.key === '' ? 'la propiedad' : node.key}`}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-800 focus:border-brand-300 focus:bg-white focus:outline-none"
          />
        )}

        <TypeSelector id={`type-${node.id}`} value={node.type} onChange={handleTypeChange} />

        {!isRoot && (
          <label
            className="flex items-center gap-1 text-xs text-slate-500"
            title="Propiedad obligatoria"
          >
            <input
              type="checkbox"
              checked={node.required}
              onChange={(event) => onUpdate(node.id, { required: event.target.checked })}
              aria-label={`Obligatoria: ${node.key}`}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-brand-600"
            />
            req
          </label>
        )}

        {!isRoot && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMove(node.id, 'up');
              }}
              aria-label={`Subir ${node.key}`}
              className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMove(node.id, 'down');
              }}
              aria-label={`Bajar ${node.key}`}
              className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(node.id);
              }}
              aria-label={`Eliminar ${node.key}`}
              className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {node.type === 'object' && node.properties.length > 0 && (
        <div>
          {node.properties.map((child) => (
            <SchemaNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              dragId={dragId}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOn={onDropOn}
            />
          ))}
        </div>
      )}
    </div>
  );
}
