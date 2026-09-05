/**
 * Captura de parámetros UTM de campañas (eslabón ① Captación → ② Atribución).
 *
 * Contrato:
 * - `extractUtmParams` lee `utm_source`, `utm_medium`, `utm_campaign`,
 *   `utm_term` y `utm_content` de un querystring y devuelve únicamente los
 *   presentes y no vacíos (fail-safe: no fabrica valores).
 * - `deriveSourceFromUtm` mapea `utm_source` a un origen de captura conocido
 *   del formulario de leads (allowlist) o `undefined` si no coincide.
 * - Es lógica pura: sin estado ni dependencias del DOM.
 */

/** Claves UTM estándar que alimentan la atribución por campaña. */
export const UTM_KEYS: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

/** Mapeo allowlist de `utm_source` a orígenes de captura soportados. */
const SOURCE_BY_UTM_SOURCE: Readonly<Record<string, string>> = {
  facebook: 'facebook',
  google: 'google',
  referral: 'referral',
};

/**
 * Extrae los parámetros UTM presentes en un querystring.
 *
 * @param search - Query string (con o sin el `?` inicial).
 * @returns Objeto con las claves UTM presentes y no vacías.
 */
export function extractUtmParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value !== null && value.trim() !== '') {
      utm[key] = value.trim();
    }
  }
  return utm;
}

/**
 * Deriva un origen de captura conocido a partir de `utm_source`.
 *
 * @param utmSource - Valor del parámetro `utm_source` (o `undefined`).
 * @returns Origen de captura soportado o `undefined` si no hay coincidencia.
 */
export function deriveSourceFromUtm(utmSource: string | undefined): string | undefined {
  if (utmSource === undefined) return undefined;
  return SOURCE_BY_UTM_SOURCE[utmSource.toLowerCase()];
}
