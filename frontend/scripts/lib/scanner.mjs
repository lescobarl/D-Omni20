/**
 * Utilidades compartidas para los scripts de validación pre-commit.
 *
 * Contrato:
 * - `collectSourceFiles(targets, extensions)` resuelve los archivos a validar:
 *   si se pasan rutas explícitas (uso desde lint-staged) se validan solo esas;
 *   si no, escanea `src/` de forma recursiva.
 * - `stripComments(code)` elimina comentarios preservando posiciones de línea
 *   y el contenido de los strings (evita falsos positivos en JSDoc/URLs).
 * - `tokenize(code)` produce un stream de tokens donde strings y comentarios
 *   son unidades indivisibles (análisis sintáctico ligero sin compilador).
 * - `toLineAndColumn(code, index)` convierte un índice a posición 1-based.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del frontend (dos niveles arriba de `scripts/lib/`). */
export const FRONTEND_ROOT = path.resolve(HERE, '..', '..');

/** Directorio de código fuente por defecto. */
export const SRC_DIR = path.join(FRONTEND_ROOT, 'src');

const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx']);

/** Directorios que nunca se escanean (build, dependencias, reportes). */
const IGNORED_DIRS = new Set([
  'node_modules',
  'coverage',
  'dist',
  '.git',
  'playwright-report',
  'test-results',
]);

/**
 * Recolecta los archivos a validar.
 * @param {readonly string[]} targets - Rutas explícitas o vacío para escanear `src/`.
 * @param {ReadonlySet<string>} extensions - Extensiones permitidas.
 * @returns {string[]} Rutas absolutas de los archivos a validar.
 */
export function collectSourceFiles(targets = [], extensions = DEFAULT_EXTENSIONS) {
  if (targets.length > 0) {
    return targets
      .map((target) => path.resolve(FRONTEND_ROOT, target))
      .filter((file) => extensions.has(path.extname(file)) && fs.existsSync(file));
  }
  return walkDir(SRC_DIR, extensions);
}

/**
 * Recorre un directorio de forma recursiva recolectando archivos válidos.
 * @param {string} dir - Directorio a recorrer.
 * @param {ReadonlySet<string>} extensions - Extensiones permitidas.
 * @returns {string[]} Rutas absolutas de los archivos encontrados.
 */
function walkDir(dir, extensions) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, extensions));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Convierte un índice de carácter a posición 1-based de línea y columna.
 * @param {string} code - Contenido del archivo.
 * @param {number} index - Índice de carácter (0-based).
 * @returns {{ line: number, column: number }} Posición 1-based.
 */
export function toLineAndColumn(code, index) {
  const before = code.slice(0, Math.max(0, index));
  const line = before.split('\n').length;
  const lastNl = before.lastIndexOf('\n');
  const column = lastNl === -1 ? index + 1 : index - lastNl;
  return { line, column };
}

/**
 * Elimina comentarios preservando posiciones de línea y contenido de strings.
 * @param {string} code - Código fuente.
 * @returns {string} Código sin comentarios (reemplazados por espacios).
 */
export function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && code[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < n) {
        const c = code[i];
        if (c === '\\') {
          out += c;
          i += 1;
          if (i < n) {
            out += code[i];
            i += 1;
          }
          continue;
        }
        out += c;
        i += 1;
        if (c === quote) break;
        if (quote === '`' && c === '$' && code[i] === '{') {
          out += code[i];
          i += 1;
          let depth = 1;
          while (i < n && depth > 0) {
            const cc = code[i];
            out += cc;
            i += 1;
            if (cc === '{') depth += 1;
            else if (cc === '}') depth -= 1;
          }
        }
      }
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

const KEYWORDS = new Set([
  'catch',
  'try',
  'finally',
  'if',
  'else',
  'for',
  'while',
  'return',
  'function',
  'const',
  'let',
  'var',
  'class',
  'interface',
  'type',
  'export',
  'import',
  'new',
]);

/**
 * Tokeniza código fuente preservando strings y comentarios como tokens.
 * @param {string} code - Código fuente.
 * @returns {ReadonlyArray<{ type: string; value: string; start: number; end: number }>} Tokens.
 */
export function tokenize(code) {
  const tokens = [];
  let i = 0;
  const n = code.length;
  const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);

  while (i < n) {
    const ch = code[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '/' && code[i + 1] === '/') {
      const start = i;
      i += 2;
      while (i < n && code[i] !== '\n') i += 1;
      tokens.push({ type: 'comment', value: code.slice(start, i), start, end: i });
      continue;
    }

    if (ch === '/' && code[i + 1] === '*') {
      const start = i;
      const close = code.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      tokens.push({ type: 'comment', value: code.slice(start, i), start, end: i });
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i;
      const quote = ch;
      i += 1;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i += 1;
          break;
        }
        if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (code[i] === '{') depth += 1;
            else if (code[i] === '}') depth -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      tokens.push({ type: 'string', value: code.slice(start, i), start, end: i });
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && isWord(code[i])) i += 1;
      const value = code.slice(start, i);
      tokens.push({
        type: KEYWORDS.has(value) ? 'keyword' : 'ident',
        value,
        start,
        end: i,
      });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < n && /[0-9a-fA-F.xXoObBeE+-]/.test(code[i])) i += 1;
      tokens.push({ type: 'number', value: code.slice(start, i), start, end: i });
      continue;
    }

    const start = i;
    i += 1;
    tokens.push({ type: 'punct', value: ch, start, end: i });
  }

  return tokens;
}
