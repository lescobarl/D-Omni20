/**
 * Panel de propiedades del nodo seleccionado en el editor visual de schemas.
 *
 * Contrato:
 * - Muestra las propiedades editables del nodo seleccionado (clave, título raíz,
 *   tipo, obligatoria, descripción, formato y tipo de ítems).
 * - Los controles son contextuales al tipo: `format` solo para cadenas, `itemsType`
 *   solo para listas y `Añadir propiedad hija` solo para objetos.
 * - Es un componente presentacional: delega todas las mutaciones al editor vía
 *   `onUpdate`, `onAddChild` y `onRemove`.
 */
import type { ChangeEvent, ReactElement } from 'react';
import {
  STRING_FORMATS,
  type SchemaNode,
  type SchemaNodePatch,
  type SchemaNodeType,
  type StringFormat,
} from './schemaTree';
import { TypeSelector } from './TypeSelector';

interface IPropertyPanelProps {
  /** Nodo seleccionado a editar. */
  node: SchemaNode;
  /** Indica si el nodo es la raíz. */
  isRoot: boolean;
  /** Actualiza el nodo con un parche inmutable. */
  onUpdate(id: string, patch: SchemaNodePatch): void;
  /** Añade una propiedad hija al nodo. */
  onAddChild(id: string): void;
  /** Elimina el nodo. */
  onRemove(id: string): void;
}

/**
 * Panel de propiedades del nodo seleccionado.
 * @param props - Propiedades del panel.
 * @returns Los controles de edición del nodo seleccionado.
 */
export function PropertyPanel({
  node,
  isRoot,
  onUpdate,
  onAddChild,
  onRemove,
}: IPropertyPanelProps): ReactElement {
  const handleKeyChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onUpdate(node.id, { key: event.target.value });
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onUpdate(node.id, { title: event.target.value });
  };

  const handleTypeChange = (type: SchemaNodeType): void => {
    onUpdate(node.id, { type });
  };

  const handleFormatChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    onUpdate(node.id, { format: event.target.value as StringFormat });
  };

  const handleDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onUpdate(node.id, { description: event.target.value });
  };

  const labelClass = 'block text-xs font-medium text-slate-600';
  const fieldClass =
    'mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Propiedades</h3>

      {isRoot ? (
        <div>
          <label htmlFor="prop-title" className={labelClass}>
            Título del schema
          </label>
          <input
            id="prop-title"
            type="text"
            value={node.title}
            onChange={handleTitleChange}
            className={fieldClass}
          />
        </div>
      ) : (
        <div>
          <label htmlFor="prop-key" className={labelClass}>
            Clave de la propiedad
          </label>
          <input
            id="prop-key"
            type="text"
            value={node.key}
            onChange={handleKeyChange}
            className={fieldClass}
          />
        </div>
      )}

      <div>
        <label htmlFor="prop-type" className={labelClass}>
          Tipo de dato
        </label>
        <div className="mt-1">
          <TypeSelector id="prop-type" value={node.type} onChange={handleTypeChange} />
        </div>
      </div>

      {!isRoot && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={node.required}
            onChange={(event) => onUpdate(node.id, { required: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-brand-600"
          />
          Propiedad obligatoria
        </label>
      )}

      <div>
        <label htmlFor="prop-description" className={labelClass}>
          Descripción
        </label>
        <textarea
          id="prop-description"
          value={node.description}
          onChange={handleDescriptionChange}
          rows={3}
          className={fieldClass}
        />
      </div>

      {node.type === 'string' && (
        <div>
          <label htmlFor="prop-format" className={labelClass}>
            Formato
          </label>
          <select
            id="prop-format"
            value={node.format}
            onChange={handleFormatChange}
            className={fieldClass}
          >
            {STRING_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format === '' ? 'Sin formato' : format}
              </option>
            ))}
          </select>
        </div>
      )}

      {node.type === 'array' && (
        <div>
          <label htmlFor="prop-items" className={labelClass}>
            Tipo de los elementos
          </label>
          <div className="mt-1">
            <TypeSelector
              id="prop-items"
              value={node.itemsType}
              onChange={(itemsType) => onUpdate(node.id, { itemsType })}
            />
          </div>
        </div>
      )}

      {node.type === 'object' && (
        <button
          type="button"
          onClick={() => onAddChild(node.id)}
          className="w-full rounded-md border border-dashed border-brand-300 px-2 py-1.5 text-sm text-brand-700 transition hover:bg-brand-50"
        >
          + Añadir propiedad hija
        </button>
      )}

      {!isRoot && (
        <button
          type="button"
          onClick={() => onRemove(node.id)}
          className="w-full rounded-md border border-red-200 px-2 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
        >
          Eliminar propiedad
        </button>
      )}
    </div>
  );
}
