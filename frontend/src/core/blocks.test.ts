/**
 * Pruebas de fábricas y consultas de bloques del dominio.
 *
 * Contrato:
 * - `createBlockInstance` genera UUIDv4 y copia la configuración por defecto.
 * - `getBlockDefinition` resuelve definiciones del catálogo por tipo.
 */
import { describe, expect, it } from 'vitest';
import { createBlockInstance, getBlockDefinition } from '@/core/blocks';
import { BLOCK_CATALOG } from '@/core/blockCatalog';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createBlockInstance', () => {
  it('genera una instancia con UUIDv4 e identificadores únicos', () => {
    const definition = BLOCK_CATALOG[0];
    const first = createBlockInstance(definition);
    const second = createBlockInstance(definition);

    expect(first.instance_id).toMatch(UUID_V4_PATTERN);
    expect(second.instance_id).toMatch(UUID_V4_PATTERN);
    expect(first.instance_id).not.toBe(second.instance_id);
    expect(first.block_id).toBe(definition.block_id);
    expect(first.type).toBe(definition.type);
  });

  it('copia la configuración por defecto sin compartir referencia (inmutabilidad)', () => {
    const definition = BLOCK_CATALOG[0];
    const instance = createBlockInstance(definition);

    expect(instance.config).toEqual(definition.default_config);
    expect(instance.config).not.toBe(definition.default_config);

    instance.config = { ...instance.config, title: 'Modificado' };
    expect(definition.default_config.title).toBe('¡Impulsa tu negocio!');
  });
});

describe('getBlockDefinition', () => {
  it('resuelve una definición existente por tipo', () => {
    expect(getBlockDefinition('hero')?.block_id).toBe('hero_video');
    expect(getBlockDefinition('services_grid')?.block_id).toBe('services_grid');
    expect(getBlockDefinition('calculator')?.block_id).toBe('calculator_js');
  });

  it('devuelve undefined para un tipo no presente en el catálogo', () => {
    expect(getBlockDefinition('faq')).toBeUndefined();
  });
});
