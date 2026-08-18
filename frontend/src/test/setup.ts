/**
 * Configuración global de pruebas (Vitest).
 *
 * Contrato:
 * - Carga los matchers de `@testing-library/jest-dom`.
 * - Registra el matcher de accesibilidad `toHaveNoViolations` (axe-core).
 */
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { formatViolations, runAxe, type IAxeRunOptions } from './a11y';

expect.extend({
  async toHaveNoViolations(received: HTMLElement, options?: IAxeRunOptions) {
    const results = await runAxe(received, options);
    const pass = results.violations.length === 0;
    return {
      pass,
      message: () =>
        pass
          ? 'Expected the element to present accessibility violations, but none were found.'
          : `Se detectaron ${results.violations.length} violación(es) de accesibilidad:\n${formatViolations(results)}`,
    };
  },
});
