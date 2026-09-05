/**
 * Pruebas de la captura de parámetros UTM (eslabón ① Captación → ② Atribución).
 *
 * Contrato:
 * - `extractUtmParams` devuelve solo los UTM presentes y no vacíos.
 * - `deriveSourceFromUtm` mapea solo orígenes conocidos (allowlist).
 */
import { describe, expect, it } from 'vitest';
import { deriveSourceFromUtm, extractUtmParams, UTM_KEYS } from '@/core/utm';

describe('extractUtmParams', () => {
  it('extrae los 5 parámetros UTM de un querystring', () => {
    const utm = extractUtmParams(
      '?utm_source=facebook&utm_medium=cpc&utm_campaign=verano&utm_term=lago&utm_content=hero',
    );
    expect(utm).toEqual({
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'verano',
      utm_term: 'lago',
      utm_content: 'hero',
    });
  });

  it('omite UTM ausentes, vacíos o con solo espacios', () => {
    const utm = extractUtmParams('?utm_source=google&utm_medium=&utm_campaign=%20%20');
    expect(utm).toEqual({ utm_source: 'google' });
  });

  it('ignora parámetros ajenos a UTM', () => {
    const utm = extractUtmParams('?foo=bar&utm_source=referral&id=42');
    expect(utm).toEqual({ utm_source: 'referral' });
  });

  it('devuelve un objeto vacío cuando no hay UTM', () => {
    expect(extractUtmParams('')).toEqual({});
    expect(extractUtmParams('?foo=bar')).toEqual({});
  });

  it('decodifica valores codificados en URL', () => {
    const utm = extractUtmParams('?utm_campaign=Casa%20Vista%20al%20Lago');
    expect(utm).toEqual({ utm_campaign: 'Casa Vista al Lago' });
  });

  it('expone las 5 claves UTM estándar', () => {
    expect(UTM_KEYS).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
    ]);
  });
});

describe('deriveSourceFromUtm', () => {
  it('mapea orígenes conocidos sin importar mayúsculas', () => {
    expect(deriveSourceFromUtm('facebook')).toBe('facebook');
    expect(deriveSourceFromUtm('Google')).toBe('google');
    expect(deriveSourceFromUtm('REFERRAL')).toBe('referral');
  });

  it('devuelve undefined para orígenes desconocidos o ausentes', () => {
    expect(deriveSourceFromUtm('instagram')).toBeUndefined();
    expect(deriveSourceFromUtm(undefined)).toBeUndefined();
  });
});
