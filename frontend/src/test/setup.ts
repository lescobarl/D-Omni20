/**
 * Configuración global de pruebas (Vitest).
 *
 * Contrato:
 * - Carga los matchers de `@testing-library/jest-dom`.
 * - Registra el matcher de accesibilidad `toHaveNoViolations` (axe-core).
 */
import '@testing-library/jest-dom/vitest';
import { expect, vi } from 'vitest';
import { formatViolations, runAxe, type IAxeRunOptions } from './a11y';

/**
 * Doble funcional de `@monaco-editor/react` para jsdom (Monaco no puede ejecutarse en los tests).
 *
 * Contrato:
 * - Renderiza el valor como `<pre><code>` para conservar el contrato `querySelector('code')`.
 * - Invoca `beforeMount` con un doble de Monaco para ejercitar el registro del lenguaje Jinja2.
 * - `loader` y `useMonaco` devuelven el mismo doble.
 */
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  const monacoDouble = {
    languages: {
      getLanguages: () => [{ id: 'html' }],
      register: () => undefined,
      setLanguageConfiguration: () => undefined,
      setMonarchTokensProvider: () => undefined,
    },
  };

  function MonacoFallback(props: {
    value?: string;
    beforeMount?: (monaco: unknown) => void;
  }): React.ReactElement {
    React.useEffect(() => {
      props.beforeMount?.(monacoDouble);
    }, [props.beforeMount]);
    return React.createElement('pre', null, React.createElement('code', null, props.value ?? ''));
  }

  return {
    default: MonacoFallback,
    Editor: MonacoFallback,
    DiffEditor: MonacoFallback,
    loader: { config: () => undefined, init: () => Promise.resolve(monacoDouble) },
    useMonaco: () => monacoDouble,
  };
});

/**
 * `setupMonaco` solo lo importa el editor diferido (carga perezosa de Monaco).
 * En jsdom Monaco no puede ejecutarse; este mock anula sus efectos secundarios
 * (configuración del worker y del loader) para que la importación diferida no
 * arrastre el módulo real de `monaco-editor`.
 */
vi.mock('../monaco/setupMonaco', () => ({}));

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
