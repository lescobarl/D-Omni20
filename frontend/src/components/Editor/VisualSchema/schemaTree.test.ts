/**
 * Pruebas del modelo de datos y conversores del editor visual de JSON Schemas.
 *
 * Contrato:
 * - `schemaToNodes` / `nodesToSchema` son invertibles (round-trip) para schemas de
 *   objetos con propiedades, arrays y formatos.
 * - Las mutaciones (`updateNode`, `addChild`, `removeChild`, `reorderSiblings`) son
 *   inmutables y localizadas por identificador.
 * - `findNode` / `findSiblings` localizan nodos y hermanos en el árbol.
 */
import { describe, expect, it } from 'vitest';
import {
  addChild,
  createPropertyNode,
  createRootNode,
  findNode,
  findSiblings,
  nodesToSchema,
  removeChild,
  reorderSiblings,
  schemaToNodes,
  updateNode,
} from './schemaTree';

describe('schemaToNodes', () => {
  it('convierte la raíz vacía en un objeto por defecto', () => {
    const root = schemaToNodes(null);
    expect(root.type).toBe('object');
    expect(root.title).toBe('Nuevo schema');
    expect(root.properties.length).toBeGreaterThan(0);
  });

  it('convierte propiedades, tipos, formatos y required de un schema', () => {
    const root = schemaToNodes({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre completo' },
        email: { type: 'string', format: 'email' },
        edad: { type: 'integer' },
        etiquetas: { type: 'array', items: { type: 'string' } },
        direccion: {
          type: 'object',
          properties: { calle: { type: 'string' } },
          required: ['calle'],
        },
      },
      required: ['nombre', 'email'],
    });

    expect(root.title).toBe('Cliente');
    expect(root.properties).toHaveLength(5);

    const nombre = root.properties[0];
    expect(nombre.key).toBe('nombre');
    expect(nombre.type).toBe('string');
    expect(nombre.required).toBe(true);
    expect(nombre.description).toBe('Nombre completo');

    const email = root.properties[1];
    expect(email.format).toBe('email');
    expect(email.required).toBe(true);

    const etiquetas = root.properties[3];
    expect(etiquetas.type).toBe('array');
    expect(etiquetas.itemsType).toBe('string');

    const direccion = root.properties[4];
    expect(direccion.type).toBe('object');
    expect(direccion.properties[0].key).toBe('calle');
    expect(direccion.properties[0].required).toBe(true);
  });
});

describe('nodesToSchema', () => {
  it('serializa un árbol a JSON Schema Draft 2020-12', () => {
    const root = createRootNode('Cliente');
    const email = createPropertyNode('email');
    email.type = 'string';
    email.format = 'email';
    email.required = true;
    const tags = createPropertyNode('tags');
    tags.type = 'array';
    tags.itemsType = 'string';

    const withChildren = addChild(root, root.id, email);
    const final = addChild(withChildren, root.id, tags);

    const schema = nodesToSchema(final);
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['type']).toBe('object');
    expect(schema['title']).toBe('Cliente');
    expect(schema['additionalProperties']).toBe(false);
    expect((schema['properties'] as Record<string, unknown>)['email']).toMatchObject({
      type: 'string',
      format: 'email',
    });
    expect((schema['properties'] as Record<string, unknown>)['tags']).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(schema['required']).toEqual(['email']);
    // La propiedad por defecto 'nombre' no es obligatoria.
    expect(schema['required']).not.toContain('nombre');
  });

  it('round-trip: schemaToNodes(nodesToSchema(node)) conserva la estructura', () => {
    const root = createRootNode('Usuario');
    const perfil = createPropertyNode('perfil');
    perfil.type = 'object';
    perfil.required = true;
    const avatar = createPropertyNode('avatar');
    avatar.type = 'string';
    avatar.format = 'uri';
    const conPerfil = addChild(root, root.id, perfil);
    const conAvatar = addChild(conPerfil, perfil.id, avatar);

    const schema = nodesToSchema(conAvatar);
    const reparsed = schemaToNodes(schema);

    expect(reparsed.title).toBe('Usuario');
    const perfilNode = reparsed.properties.find((p) => p.key === 'perfil');
    expect(perfilNode?.required).toBe(true);
    expect(perfilNode?.properties[0].key).toBe('avatar');
    expect(perfilNode?.properties[0].format).toBe('uri');
  });
});

describe('mutaciones inmutables del árbol', () => {
  it('updateNode aplica el parche solo al nodo indicado', () => {
    const root = createRootNode();
    const targetId = root.properties[0].id;
    const next = updateNode(root, targetId, { type: 'integer', description: 'Número' });

    expect(next.properties[0].type).toBe('integer');
    expect(next.properties[0].description).toBe('Número');
    // La raíz original no muta (inmutabilidad).
    expect(root.properties[0].type).toBe('string');
    expect(next.id).toBe(root.id);
  });

  it('addChild agrega una propiedad al objeto indicado', () => {
    const root = createRootNode();
    const child = createPropertyNode('apellido');
    const next = addChild(root, root.id, child);

    expect(next.properties.map((p) => p.key)).toContain('apellido');
    expect(root.properties.map((p) => p.key)).not.toContain('apellido');
  });

  it('removeChild elimina solo el nodo indicado', () => {
    const root = createRootNode();
    const targetId = root.properties[0].id;
    const next = removeChild(root, targetId);

    expect(next.properties.some((p) => p.id === targetId)).toBe(false);
    expect(root.properties.some((p) => p.id === targetId)).toBe(true);
  });

  it('reorderSiblings intercambia la posición de dos hermanos', () => {
    const root = createRootNode();
    const second = createPropertyNode('segundo');
    const withSecond = addChild(root, root.id, second);
    const [primero, segundo] = withSecond.properties;

    const next = reorderSiblings(withSecond, primero.id, segundo.id);
    expect(next.properties[0].key).toBe('segundo');
    expect(next.properties[1].key).toBe('nombre');
  });

  it('findNode localiza nodos anidados y findSiblings su lista de hermanos', () => {
    const root = createRootNode();
    const perfil = createPropertyNode('perfil');
    perfil.type = 'object';
    const avatar = createPropertyNode('avatar');
    const withPerfil = addChild(root, root.id, perfil);
    const withAvatar = addChild(withPerfil, perfil.id, avatar);

    const found = findNode(withAvatar, avatar.id);
    expect(found?.key).toBe('avatar');
    expect(found?.type).toBe('string');

    const siblings = findSiblings(withAvatar, avatar.id);
    expect(siblings?.map((s) => s.key)).toEqual(['avatar']);
    expect(findSiblings(withAvatar, withAvatar.id)).toBeNull();
  });
});
