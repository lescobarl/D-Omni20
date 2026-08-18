/**
 * Definición del lenguaje Jinja2 para Monaco Editor.
 *
 * Contrato:
 * - Exporta el identificador canónico del lenguaje (`jinja2`).
 * - Define la configuración de lenguaje (comentarios, brackets y pares de autoclausura).
 * - Define el tokenizador Monarch con estados (root, comment, htmlComment, expression,
 *   statement, tagAttrs, stringDouble y stringSingle).
 * - `registerJinja2Language` registra el lenguaje de forma idempotente mediante inyección de
 *   dependencias (DI): no importa Monaco directamente, lo que permite probarlo con un doble.
 */
export const JINJA2_LANGUAGE_ID = 'jinja2';

/** API mínima de Monaco requerida para registrar el lenguaje Jinja2. */
export interface IJinja2Monaco {
  /** Namespace `languages` de Monaco (subconjunto del real, suficiente para el registro). */
  languages: {
    /** Devuelve los lenguajes registrados actualmente. */
    getLanguages(): ReadonlyArray<{ readonly id: string }>;
    /** Registra un nuevo lenguaje. */
    register(language: { id: string; extensions?: string[]; aliases?: string[] }): void;
    /** Configura reglas de edición (comentarios, brackets y autoclausura). */
    setLanguageConfiguration(languageId: string, configuration: unknown): void;
    /** Establece el proveedor de tokens Monarch. */
    setMonarchTokensProvider(languageId: string, tokens: unknown): void;
  };
}

/** Configuración de lenguaje: comentarios, brackets y pares de autoclausura de Jinja2. */
const LANGUAGE_CONFIGURATION = {
  comments: {
    blockComment: ['{#', '#}'],
  },
  brackets: [
    ['{{', '}}'],
    ['{%', '%}'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{{', close: '}}' },
    { open: '{%', close: '%}' },
    { open: '{#', close: '#}' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

/**
 * Tokenizador Monarch de Jinja2: reconoce comentarios, expresiones, sentencias y atributos HTML.
 *
 * Estados:
 * - root: texto HTML con delimitadores `{{`, `{%`, `{#` y etiquetas `<tag>`.
 * - comment / htmlComment: comentarios Jinja (`{# ... #}`) y HTML (`<!-- ... -->`).
 * - expression / statement: contenido dentro de `{{ }}` y `{% %}`.
 * - tagAttrs: atributos dentro de una etiqueta HTML de apertura.
 * - stringDouble / stringSingle: cadenas con interpolación Jinja embebida.
 */
const MONARCH_TOKENS = {
  defaultToken: 'text',
  tokenizer: {
    root: [
      [/[ \t\r\n]+/, 'white'],
      [/{{/, 'delimiter.expression', '@expression'],
      [/{%/, 'delimiter.statement', '@statement'],
      [/{#/, 'comment', '@comment'],
      [/<!--/, 'comment', '@htmlComment'],
      [/<\/\w+>/, 'tag.html'],
      [/<\w+/, { token: 'tag.html', next: '@tagAttrs' }],
      [/[^<{]+/, 'text'],
      [/</, 'text'],
    ],
    comment: [
      [/#}/, 'comment', '@pop'],
      [/./, 'comment'],
    ],
    htmlComment: [
      [/-->/, 'comment', '@pop'],
      [/./, 'comment'],
    ],
    expression: [
      [/}}/, 'delimiter.expression', '@pop'],
      [/[^{}]+/, 'string.expression'],
      [/[{}]/, 'delimiter.expression'],
    ],
    statement: [
      [/%}/, 'delimiter.statement', '@pop'],
      [/[ \t\r\n]+/, 'white'],
      [/\b(true|false|none|null)\b/, 'constant.language'],
      [/-?\d+(\.\d+)?/, 'number'],
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],
      [/[a-zA-Z_][\w.-]*/, 'keyword'],
      [/[%{}-]/, 'operator'],
    ],
    tagAttrs: [
      [/[ \t\r\n]+/, 'white'],
      [/"([^"]*)"/, 'attribute.value'],
      [/'([^']*)'/, 'attribute.value'],
      [/[\w-]+(?=\s*=)/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/{{/, 'delimiter.expression', '@expression'],
      [/{%/, 'delimiter.statement', '@statement'],
      [/>/, 'tag.html', '@pop'],
    ],
  },
} as const;

/**
 * Registra el lenguaje Jinja2 en Monaco de forma idempotente.
 *
 * @param monaco - Instancia de Monaco inyectada (facilita las pruebas con un doble).
 * @returns `true` si el lenguaje se registró; `false` si ya existía.
 */
export function registerJinja2Language(monaco: IJinja2Monaco): boolean {
  const alreadyRegistered = monaco.languages
    .getLanguages()
    .some((language) => language.id === JINJA2_LANGUAGE_ID);

  if (alreadyRegistered) {
    return false;
  }

  monaco.languages.register({
    id: JINJA2_LANGUAGE_ID,
    extensions: [],
    aliases: ['Jinja2', 'jinja2'],
  });
  monaco.languages.setLanguageConfiguration(JINJA2_LANGUAGE_ID, LANGUAGE_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(JINJA2_LANGUAGE_ID, MONARCH_TOKENS);

  return true;
}
