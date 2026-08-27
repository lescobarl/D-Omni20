/**
 * Selector de tipo de dato JSON Schema (Draft 2020-12).
 *
 * Contrato:
 * - Selector reutilizable que lista los tipos del modelo visual
 *   (`SCHEMA_NODE_TYPES`) con etiquetas en español.
 * - Es un componente presentacional controlado: notifica el cambio vía `onChange`
 *   y no mantiene estado propio.
 */
import type { ReactElement } from 'react';
import { SCHEMA_NODE_TYPES, type SchemaNodeType } from './schemaTree';

/** Etiquetas en español de cada tipo de dato JSON Schema. */
const TYPE_LABELS: Record<SchemaNodeType, string> = {
  string: 'Texto',
  number: 'Número',
  integer: 'Entero',
  boolean: 'Booleano',
  array: 'Lista',
  object: 'Objeto',
  null: 'Nulo',
};

interface ITypeSelectorProps {
  /** Identificador accesible del selector. */
  id: string;
  /** Tipo de dato seleccionado. */
  value: SchemaNodeType;
  /** Notifica el cambio de tipo. */
  onChange(value: SchemaNodeType): void;
  /** Deshabilita el selector. */
  disabled?: boolean;
}

/**
 * Selector de tipo de dato JSON Schema.
 * @param props - Propiedades del selector.
 * @returns Un `<select>` con los tipos del modelo visual.
 */
export function TypeSelector({
  id,
  value,
  onChange,
  disabled = false,
}: ITypeSelectorProps): ReactElement {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as SchemaNodeType)}
      disabled={disabled}
      className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
    >
      {SCHEMA_NODE_TYPES.map((type) => (
        <option key={type} value={type}>
          {TYPE_LABELS[type]}
        </option>
      ))}
    </select>
  );
}
