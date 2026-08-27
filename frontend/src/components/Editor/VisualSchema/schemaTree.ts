/**
 * Modelo de datos y conversores del editor visual de JSON Schemas (Draft 2020-12).
 *
 * Contrato:
 * - `SchemaNode` es la representación visual (árbol) de un JSON Schema orientado a
 *   objetos con propiedades.
 * - `schemaToNodes` / `nodesToSchema` son conversores puros e invertibles que
 *   permiten editar visualmente cualquier schema generado por IA.
 * - Las mutaciones del árbol son inmutables (retornan un nuevo nodo raíz), lo que
 *   facilita el seguimiento de cambios en el store (Zustand) sin efectos laterales.
 */
import { uuidv4 } from '@/utils/uuid';

/** URI del meta-schema Draft 2020-12 (constante de contrato). */
export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/** Tipos de dato JSON Schema (Draft 2020-12) editables visualmente. */
export const SCHEMA_NODE_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
] as const;

/** Tipo de dato JSON Schema (Draft 2020-12). */
export type SchemaNodeType = (typeof SCHEMA_NODE_TYPES)[number];

/** Formatos opcionales para cadenas (Draft 2020-12). */
export const STRING_FORMATS = [
  '',
  'email',
  'uri',
  'date-time',
  'uuid',
  'hostname',
  'ipv4',
  'ipv6',
] as const;

/** Formato opcional de una cadena (`''` = sin formato). */
export type StringFormat = (typeof STRING_FORMATS)[number];

/** Nodo del árbol visual de un JSON Schema. */
export interface SchemaNode {
  /** Identificador estable del nodo dentro del editor. */
  id: string;
  /** Nombre de la propiedad (vacío para la raíz). */
  key: string;
  /** Tipo de dato JSON Schema. */
  type: SchemaNodeType;
  /** Indica si la propiedad es obligatoria (solo relevante dentro de objetos). */
  required: boolean;
  /** Descripción opcional de la propiedad. */
  description: string;
  /** Formato opcional para cadenas. */
  format: StringFormat;
  /** Tipo de los elementos para arrays. */
  itemsType: SchemaNodeType;
  /** Título raíz del schema (solo aplica al nodo raíz). */
  title: string;
  /** Hijos para objetos (recursivo). */
  properties: SchemaNode[];
}

/** Parche de edición permitido sobre un nodo (inmutable, sin estructura). */
export type SchemaNodePatch = Partial<Omit<SchemaNode, 'id' | 'properties'>>;

/** Crea un nodo de propiedad con valores por defecto. */
export function createPropertyNode(key = 'propiedad'): SchemaNode {
  return {
    id: uuidv4(),
    key,
    type: 'string',
    required: false,
    description: '',
    format: '',
    itemsType: 'string',
    title: '',
    properties: [],
  };
}

/** Crea el nodo raíz de un schema nuevo (objeto con una propiedad de ejemplo). */
export function createRootNode(title = 'Nuevo schema'): SchemaNode {
  return {
    id: uuidv4(),
    key: '',
    type: 'object',
    required: false,
    description: '',
    format: '',
    itemsType: 'string',
    title,
    properties: [createPropertyNode('nombre')],
  };
}

/** Convierte el JSON Schema de una propiedad a un nodo visual (recursivo). */
function propertyToNode(key: string, raw: unknown): SchemaNode {
  const schema = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const type = (SCHEMA_NODE_TYPES as readonly string[]).includes(String(schema.type))
    ? (schema.type as SchemaNodeType)
    : 'string';

  const node: SchemaNode = {
    id: uuidv4(),
    key,
    type,
    required: false,
    description: typeof schema.description === 'string' ? schema.description : '',
    format: (STRING_FORMATS as readonly string[]).includes(String(schema.format))
      ? (schema.format as StringFormat)
      : '',
    itemsType: 'string',
    title: '',
    properties: [],
  };

  if (type === 'array' && typeof schema.items === 'object' && schema.items !== null) {
    const items = schema.items as Record<string, unknown>;
    if ((SCHEMA_NODE_TYPES as readonly string[]).includes(String(items.type))) {
      node.itemsType = items.type as SchemaNodeType;
    }
  }

  if (type === 'object' && typeof schema.properties === 'object' && schema.properties !== null) {
    const requiredSet = new Set<string>();
    if (Array.isArray(schema.required)) {
      for (const item of schema.required) {
        if (typeof item === 'string') {
          requiredSet.add(item);
        }
      }
    }
    node.properties = Object.entries(schema.properties as Record<string, unknown>).map(
      ([propKey, propRaw]) => propertyToNode(propKey, propRaw),
    );
    for (const child of node.properties) {
      child.required = requiredSet.has(child.key);
    }
  }

  return node;
}

/** Convierte un JSON Schema (o `null`) a un nodo visual raíz. */
export function schemaToNodes(schema: Record<string, unknown> | null | undefined): SchemaNode {
  if (schema === null || schema === undefined) {
    return createRootNode();
  }
  const root = propertyToNode('', schema);
  root.type = 'object';
  root.title = typeof schema['title'] === 'string' ? schema['title'] : '';
  return root;
}

/** Serializa un nodo de propiedad (no raíz) a un fragmento de JSON Schema. */
function nodeToPropertySchema(node: SchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: node.type };
  if (node.description !== '') {
    out['description'] = node.description;
  }
  switch (node.type) {
    case 'string':
      if (node.format !== '') {
        out['format'] = node.format;
      }
      break;
    case 'array':
      out['items'] = { type: node.itemsType };
      break;
    case 'object': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const child of node.properties) {
        properties[child.key] = nodeToPropertySchema(child);
        if (child.required) {
          required.push(child.key);
        }
      }
      if (Object.keys(properties).length > 0) {
        out['properties'] = properties;
      }
      if (required.length > 0) {
        out['required'] = required;
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Convierte un nodo visual raíz a un JSON Schema (Draft 2020-12). */
export function nodesToSchema(node: SchemaNode): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    $schema: DRAFT_2020_12,
    type: 'object',
    additionalProperties: false,
  };
  if (node.title !== '') {
    schema['title'] = node.title;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const child of node.properties) {
    properties[child.key] = nodeToPropertySchema(child);
    if (child.required) {
      required.push(child.key);
    }
  }
  schema['properties'] = properties;
  if (required.length > 0) {
    schema['required'] = required;
  }
  return schema;
}

/** Recorre el árbol aplicando una transformación inmutable a cada nodo. */
function mapTree(node: SchemaNode, fn: (n: SchemaNode) => SchemaNode): SchemaNode {
  const next = fn(node);
  return { ...next, properties: next.properties.map((child) => mapTree(child, fn)) };
}

/** Devuelve el nodo con el identificador dado (o `null` si no existe). */
export function findNode(root: SchemaNode, id: string): SchemaNode | null {
  if (root.id === id) {
    return root;
  }
  for (const child of root.properties) {
    const found = findNode(child, id);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Devuelve la lista de hermanos que contiene al nodo `id` (o `null` si es la raíz). */
export function findSiblings(root: SchemaNode, id: string): SchemaNode[] | null {
  if (root.id === id) {
    return null;
  }
  if (root.properties.some((child) => child.id === id)) {
    return root.properties;
  }
  for (const child of root.properties) {
    const siblings = findSiblings(child, id);
    if (siblings !== null) {
      return siblings;
    }
  }
  return null;
}

/** Actualiza de forma inmutable un nodo por identificador. */
export function updateNode(root: SchemaNode, id: string, patch: SchemaNodePatch): SchemaNode {
  return mapTree(root, (node) => (node.id === id ? { ...node, ...patch } : node));
}

/** Añade un hijo (inmutable) al nodo padre con el identificador dado. */
export function addChild(root: SchemaNode, parentId: string, child: SchemaNode): SchemaNode {
  return mapTree(root, (node) =>
    node.id === parentId ? { ...node, properties: [...node.properties, child] } : node,
  );
}

/** Elimina (inmutable) el nodo hijo con el identificador dado. */
export function removeChild(root: SchemaNode, id: string): SchemaNode {
  return mapTree(root, (node) => ({
    ...node,
    properties: node.properties.filter((child) => child.id !== id),
  }));
}

/** Reordena (inmutable) un nodo dentro de sus hermanos, de `fromId` a `toId`. */
export function reorderSiblings(root: SchemaNode, fromId: string, toId: string): SchemaNode {
  return mapTree(root, (node) => {
    const fromIndex = node.properties.findIndex((child) => child.id === fromId);
    const toIndex = node.properties.findIndex((child) => child.id === toId);
    if (fromIndex === -1 || toIndex === -1) {
      return node;
    }
    const next = [...node.properties];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return { ...node, properties: next };
  });
}
