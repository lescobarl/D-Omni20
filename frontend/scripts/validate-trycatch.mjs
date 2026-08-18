#!/usr/bin/env node
/**
 * Validador de try-catch vacíos o silenciosos (regla CLAUDE 5 — NO empty/silent try-catch).
 *
 * Contrato:
 * - Detecta bloques `catch` cuyo cuerpo está vacío o contiene únicamente
 *   comentarios: no registran el error (logging) ni lo propagan (throw),
 *   por lo que el fallo queda silenciado.
 * - El análisis es sintáctico ligero sobre tokens del `scanner`: strings y
 *   comentarios son unidades indivisibles, así que la palabra `catch` dentro
 *   de un string o comentario nunca genera falsos positivos.
 * - Los archivos de prueba y fixtures se excluyen por diseño (igual que
 *   validate:hardcode).
 * - Con argumentos valida solo esos archivos (uso desde lint-staged);
 *   sin argumentos escanea `src/`.
 *
 * Uso:
 *   node scripts/validate-trycatch.mjs [archivo...]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { collectSourceFiles, tokenize, toLineAndColumn, FRONTEND_ROOT } from './lib/scanner.mjs';

/**
 * ¿El archivo debe excluirse del análisis (tests/fixtures)?
 * @param {string} file - Ruta absoluta del archivo.
 * @returns {boolean} `true` si es un archivo de prueba o fixture.
 */
function isFixture(file) {
  const base = path.basename(file);
  return /\.(?:test|spec)\.(?:ts|tsx)$/.test(base) || file.includes(`${path.sep}test${path.sep}`);
}

/**
 * Encuentra bloques `catch` vacíos o con solo comentarios.
 * @param {ReadonlyArray<{ type: string; value: string; start: number; end: number }>} tokens
 * @returns {ReadonlyArray<{ brace: { start: number; line: number; column: number } }>}
 */
export function findEmptyCatches(tokens) {
  const findings = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'keyword' || token.value !== 'catch') continue;

    // Opcional: binding de parámetros `(e)`.
    let j = i + 1;
    if (j < tokens.length && tokens[j].type === 'punct' && tokens[j].value === '(') {
      let depth = 0;
      while (j < tokens.length) {
        const t = tokens[j];
        if (t.type === 'punct' && t.value === '(') depth += 1;
        else if (t.type === 'punct' && t.value === ')') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
        j += 1;
      }
    }

    // El cuerpo debe ser un bloque `{ ... }`.
    if (j >= tokens.length || tokens[j].type !== 'punct' || tokens[j].value !== '{') continue;
    const openBrace = tokens[j];

    // Escaneo balanceado de llaves; strings y comentarios son atómicos.
    let bodyHasContent = false;
    let depth = 1;
    let k = j + 1;
    while (k < tokens.length && depth > 0) {
      const t = tokens[k];
      if (t.type === 'punct' && t.value === '{') {
        depth += 1;
      } else if (t.type === 'punct' && t.value === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (t.type !== 'comment') {
        bodyHasContent = true;
      }
      k += 1;
    }

    if (!bodyHasContent) {
      findings.push({ brace: openBrace });
    }
  }

  return findings;
}

/**
 * Valida un archivo y reporta las posiciones de los catch infractores.
 * @param {string} _filePath - Ruta absoluta del archivo (solo contexto).
 * @param {string} code - Contenido del archivo.
 * @returns {ReadonlyArray<{ line: number; column: number }>} Posiciones 1-based.
 */
export function validateFile(_filePath, code) {
  return findEmptyCatches(tokenize(code)).map(({ brace }) => {
    const { line, column } = toLineAndColumn(code, brace.start);
    return { line, column };
  });
}

/** Punto de entrada de la CLI. */
function main() {
  const args = process.argv.slice(2);
  const files = collectSourceFiles(args).filter((file) => !isFixture(file));
  let violations = 0;

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (const finding of validateFile(file, code)) {
      violations += 1;
      const rel = path.relative(FRONTEND_ROOT, file);
      console.error(
        `❌ ${rel}:${finding.line}:${finding.column} catch vacío/silencioso (no registra ni propaga el error)`,
      );
    }
  }

  if (violations > 0) {
    console.error(
      `\n${violations} catch vacío(s)/silencioso(s) detectado(s). Regla CLAUDE 5 (NO empty/silent try-catch).`,
    );
    process.exit(1);
  }

  console.log(
    `✅ validate:trycatch — ${files.length} archivo(s) de producto sin catch vacío ni silencioso.`,
  );
}

main();
