/**
 * Pruebas del mapeo de configuraciones IA al dominio del editor.
 *
 * Contrato:
 * - `mapAiConfigToLanding` normaliza títulos, workflows y bloques con UUIDv4.
 * - Resuelve `block_id` desde el catálogo con fallback `dynamic_<type>`.
 * - Rechaza raíces no-objeto con `AppError` (respuesta inválida).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  DEFAULT_AI_TITLE,
  DEFAULT_WORKFLOW_TYPE,
  isWorkflowType,
  mapAiConfigToLanding,
} from '@/core/aiConfig';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('isWorkflowType', () => {
  it('reconoce los 4 workflows soportados', () => {
    expect(isWorkflowType('direct_checkout')).toBe(true);
    expect(isWorkflowType('lead_capture')).toBe(true);
    expect(isWorkflowType('quote_generator')).toBe(true);
    expect(isWorkflowType('appointment_scheduler')).toBe(true);
  });

  it('rechaza valores no soportados y no-cadena', () => {
    expect(isWorkflowType('checkout')).toBe(false);
    expect(isWorkflowType(undefined)).toBe(false);
    expect(isWorkflowType(null)).toBe(false);
    expect(isWorkflowType(42)).toBe(false);
  });
});

describe('mapAiConfigToLanding', () => {
  it('mapea una configuración completa con títulos, workflow y bloques con UUIDv4', () => {
    const landing = mapAiConfigToLanding({
      title: '  Landing IA  ',
      workflowType: 'lead_capture',
      blocks: [
        { type: 'hero', name: 'Hero IA', config: { title: 'Hola', cta_text: 'Comprar' } },
        { type: 'calculator', config: { currency: 'USD' } },
      ],
    });

    expect(landing.title).toBe('Landing IA');
    expect(landing.workflowType).toBe('lead_capture');
    expect(landing.campaignId).toBe('');
    expect(landing.blocks).toHaveLength(2);

    const [hero, calculator] = landing.blocks;
    expect(hero.instance_id).toMatch(UUID_V4_PATTERN);
    expect(hero.block_id).toBe('hero_video');
    expect(hero.type).toBe('hero');
    expect(hero.name).toBe('Hero IA');
    expect(hero.config).toEqual({ title: 'Hola', cta_text: 'Comprar' });

    expect(calculator.instance_id).toMatch(UUID_V4_PATTERN);
    expect(calculator.block_id).toBe('calculator_js');
    expect(calculator.type).toBe('calculator');
    expect(calculator.name).toBe('Calculadora JS');
    expect(calculator.config).toEqual({ currency: 'USD' });
  });

  it('aplica el título por defecto cuando falta o no es cadena', () => {
    expect(mapAiConfigToLanding({}).title).toBe(DEFAULT_AI_TITLE);
    expect(mapAiConfigToLanding({ title: '   ' }).title).toBe(DEFAULT_AI_TITLE);
    expect(mapAiConfigToLanding({ title: 123 }).title).toBe(DEFAULT_AI_TITLE);
  });

  it('aplica el workflow por defecto cuando no es soportado', () => {
    expect(mapAiConfigToLanding({ workflowType: 'unknown' }).workflowType).toBe(
      DEFAULT_WORKFLOW_TYPE,
    );
    expect(mapAiConfigToLanding({}).workflowType).toBe(DEFAULT_WORKFLOW_TYPE);
  });

  it('resuelve block_id con fallback dynamic_<type> para tipos fuera del catálogo', () => {
    const landing = mapAiConfigToLanding({
      blocks: [{ type: 'testimonials', name: 'Testimonios', config: {} }],
    });
    expect(landing.blocks[0].block_id).toBe('dynamic_testimonials');
    expect(landing.blocks[0].type).toBe('testimonials');
    expect(landing.blocks[0].name).toBe('Testimonios');
  });

  it('salta bloques que no son objetos y normaliza config no-objeto', () => {
    const landing = mapAiConfigToLanding({
      blocks: ['no-objeto', null, { type: 'hero', config: 'roto' }],
    });
    expect(landing.blocks).toHaveLength(1);
    expect(landing.blocks[0].config).toEqual({});
  });

  it('devuelve bloques vacíos cuando no hay lista de bloques', () => {
    const landing = mapAiConfigToLanding({ blocks: null });
    expect(landing.blocks).toEqual([]);
  });

  it('lanza AppError con operación ai.mapConfig para raíces no-objeto', () => {
    for (const invalid of [null, 'texto', 42, [1, 2]]) {
      expect(() => mapAiConfigToLanding(invalid)).toThrowError(AppError);
    }
    expect(() => mapAiConfigToLanding(null)).toThrowError(/no es un objeto/);
  });

  it('genera identificadores de instancia únicos entre bloques', () => {
    const landing = mapAiConfigToLanding({
      blocks: [
        { type: 'hero', config: {} },
        { type: 'hero', config: {} },
      ],
    });
    expect(landing.blocks[0].instance_id).not.toBe(landing.blocks[1].instance_id);
  });
});
