/**
 * Utilidades de testing de accesibilidad (a11y) basadas en axe-core.
 *
 * Contrato:
 * - `runAxe` ejecuta axe-core sobre un contenedor renderizado.
 * - `toHaveNoViolations` extiende los matchers de Vitest y falla ante violaciones.
 * - `color-contrast` se desactiva por defecto: jsdom no implementa el cálculo
 *   de estilos derivados que la regla requiere para ser fiable.
 */
import type { AxeResults } from 'axe-core';

/** Opciones para ejecutar el análisis de accesibilidad. */
export interface IAxeRunOptions {
  /** Reglas adicionales a desactivar (además de `color-contrast`). */
  disabledRules?: readonly string[];
}

/** Reglas que no pueden ejecutarse correctamente en jsdom. */
const DEFAULT_DISABLED_RULES: readonly string[] = ['color-contrast'];

/**
 * Ejecuta axe-core sobre un contenedor renderizado.
 * @param container Elemento raíz a auditar.
 * @param options Opciones de ejecución (reglas a desactivar).
 * @returns Resultado del análisis de accesibilidad.
 */
export async function runAxe(
  container: HTMLElement,
  options: IAxeRunOptions = {},
): Promise<AxeResults> {
  const disabled = [...DEFAULT_DISABLED_RULES, ...(options.disabledRules ?? [])];
  // axe-core espera un RuleObject (Record clave→regla), no un arreglo.
  const rules = disabled.reduce<Record<string, { enabled: boolean }>>((acc, ruleId) => {
    acc[ruleId] = { enabled: false };
    return acc;
  }, {});
  // axe-core se importa solo al auditar (matcher de a11y): evitarlo en todos los
  // demás tests jsdom reduce el setup de cada worker (carga perezosa).
  const axe = await import('axe-core');
  return axe.default.run(container, { rules });
}

/**
 * Formatea las violaciones detectadas para mensajes de error legibles.
 * @param results Resultado del análisis de axe-core.
 * @returns Representación textual de las violaciones encontradas.
 */
export function formatViolations(results: AxeResults): string {
  if (results.violations.length === 0) {
    return 'Sin violaciones de accesibilidad.';
  }
  return results.violations
    .map(
      (violation) => `- ${violation.id} (${violation.impact ?? 'desconocido'}): ${violation.help}`,
    )
    .join('\n');
}

declare module 'vitest' {
  interface Assertion<T = any> {
    toHaveNoViolations(options?: IAxeRunOptions): Promise<void>;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(options?: IAxeRunOptions): Promise<void>;
  }
}
