/**
 * Tests funcionales del registro del lenguaje Jinja2 (src/monaco/jinja2.ts).
 */
import { describe, expect, it } from 'vitest';
import { JINJA2_LANGUAGE_ID, registerJinja2Language, type IJinja2Monaco } from './jinja2';

interface IFakeMonaco {
  monaco: IJinja2Monaco;
  getIds(): string[];
  getConfigs(): string[];
  getTokenizers(): string[];
}

/** Doble de prueba con estado real: registra lenguajes, configuraciones y tokenizadores. */
function createFakeMonaco(initialIds: string[] = []): IFakeMonaco {
  const ids = [...initialIds];
  const configs: string[] = [];
  const tokenizers: string[] = [];

  const monaco: IJinja2Monaco = {
    languages: {
      getLanguages: () => ids.map((id) => ({ id })),
      register: (language) => {
        ids.push(language.id);
      },
      setLanguageConfiguration: (languageId) => {
        configs.push(languageId);
      },
      setMonarchTokensProvider: (languageId) => {
        tokenizers.push(languageId);
      },
    },
  };

  return {
    monaco,
    getIds: () => [...ids],
    getConfigs: () => [...configs],
    getTokenizers: () => [...tokenizers],
  };
}

describe('jinja2 (registro del lenguaje Monaco)', () => {
  it('expone el identificador canónico del lenguaje', () => {
    expect(JINJA2_LANGUAGE_ID).toBe('jinja2');
  });

  it('registra lenguaje, configuración y tokenizador en una instancia nueva', () => {
    const { monaco, getIds, getConfigs, getTokenizers } = createFakeMonaco();

    const result = registerJinja2Language(monaco);

    expect(result).toBe(true);
    expect(getIds()).toContain(JINJA2_LANGUAGE_ID);
    expect(getConfigs()).toEqual([JINJA2_LANGUAGE_ID]);
    expect(getTokenizers()).toEqual([JINJA2_LANGUAGE_ID]);
  });

  it('es idempotente: no vuelve a registrar un lenguaje ya existente', () => {
    const { monaco, getIds, getConfigs, getTokenizers } = createFakeMonaco([JINJA2_LANGUAGE_ID]);

    const result = registerJinja2Language(monaco);

    expect(result).toBe(false);
    expect(getIds()).toEqual([JINJA2_LANGUAGE_ID]);
    expect(getConfigs()).toEqual([]);
    expect(getTokenizers()).toEqual([]);
  });
});
