/**
 * Pruebas del generador de representación compilada y del serializador de configuración.
 *
 * Contrato verificado:
 * - `serializeLandingConfig` traduce la `ILandingConfig` al contrato JSON del backend
 *   (`title`, `workflowType`, `blocks[{type, name, config}]`) sin compartir referencias.
 * - `generateLandingCode` produce el HTML funcional con workflow, título y bloques.
 */
import { describe, expect, it } from 'vitest';
import { generateLandingCode, serializeLandingConfig } from '@/core/landingCode';
import type { IBlockInstance, ILandingConfig } from '@/types/editor';

/** Construye una instancia de bloque de prueba con configuración controlada. */
function makeBlock(overrides: Partial<IBlockInstance> = {}): IBlockInstance {
  return {
    instance_id: '11111111-1111-4111-8111-111111111111',
    block_id: 'block--hero',
    type: 'hero',
    name: 'Hero',
    config: { title: 'Título', subtitle: 'Subtítulo', cta_text: 'Comprar', cta_url: '#comprar' },
    ...overrides,
  };
}

/** Configuración de landing de referencia para las pruebas. */
function makeLanding(): ILandingConfig {
  return {
    campaignId: 'campana_demo',
    title: 'Nueva Landing',
    workflowType: 'direct_checkout',
    blocks: [
      makeBlock(),
      makeBlock({
        instance_id: '22222222-2222-4222-8222-222222222222',
        block_id: 'block--calculator',
        type: 'calculator',
        name: 'Calculadora',
        config: { title: 'Calculadora', currency: 'USD' },
      }),
    ],
  };
}

describe('serializeLandingConfig', () => {
  it('serializa título, workflow y bloques en el contrato del backend', () => {
    const serialized = serializeLandingConfig(makeLanding());
    expect(serialized.title).toBe('Nueva Landing');
    expect(serialized.workflowType).toBe('direct_checkout');
    expect(serialized.blocks).toEqual([
      { type: 'hero', name: 'Hero', config: makeBlock().config },
      {
        type: 'calculator',
        name: 'Calculadora',
        config: { title: 'Calculadora', currency: 'USD' },
      },
    ]);
  });

  it('preserva el orden de los bloques de la landing', () => {
    const serialized = serializeLandingConfig(makeLanding());
    const types = (serialized.blocks as Array<{ type: string }>).map((block) => block.type);
    expect(types).toEqual(['hero', 'calculator']);
  });

  it('copia la configuración de cada bloque sin compartir referencias mutables', () => {
    const landing = makeLanding();
    const serialized = serializeLandingConfig(landing);
    const serializedBlock = (serialized.blocks as Array<{ config: Record<string, unknown> }>)[0];
    expect(serializedBlock.config).not.toBe(landing.blocks[0].config);
    // Mutar la copia no altera el origen.
    serializedBlock.config.title = 'Mutado';
    expect(landing.blocks[0].config.title).toBe('Título');
  });

  it('maneja una landing sin bloques devolviendo una lista vacía', () => {
    const landing = { ...makeLanding(), blocks: [] };
    const serialized = serializeLandingConfig(landing);
    expect(serialized.title).toBe('Nueva Landing');
    expect(serialized.blocks).toEqual([]);
  });
});

describe('generateLandingCode', () => {
  it('genera HTML con workflow, título y bloques identificados por instance_id', () => {
    const html = generateLandingCode(makeLanding());
    expect(html).toContain('Workflow: direct_checkout');
    expect(html).toContain('data-title="Nueva Landing"');
    expect(html).toContain('block--hero');
    expect(html).toContain('data-instance-id="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('data-instance-id="22222222-2222-4222-8222-222222222222"');
  });

  it('incluye la configuración de cada bloque como atributos de datos', () => {
    const html = generateLandingCode(makeLanding());
    expect(html).toContain('data-cta_text="Comprar"');
    expect(html).toContain('data-currency="USD"');
  });
});
