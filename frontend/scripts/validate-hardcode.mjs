#!/usr/bin/env node
/**
 * Validador de valores quemados (regla CLAUDE 1 — NO HARDCODE).
 *
 * Contrato:
 * - Detecta URLs literales, credenciales, cadenas de conexión (DSN) y
 *   direcciones de servidor (IP:puerto) embebidas en código de producto.
 * - El análisis corre sobre código sin comentarios (evita falsos positivos
 *   en JSDoc) y omite coincidencias con interpolación de template literals
 *   (`${...}`), que son dinámicas y no valores quemados.
 * - Los archivos de prueba y fixtures (`*.test.*`, `*.spec.*`, `src/test/**`)
 *   se excluyen por diseño: contienen datos de prueba, no configuración.
 * - Con argumentos valida solo esos archivos (uso desde lint-staged);
 *   sin argumentos escanea `src/`.
 *
 * Uso:
 *   node scripts/validate-hardcode.mjs [archivo...]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  collectSourceFiles,
  stripComments,
  toLineAndColumn,
  FRONTEND_ROOT,
} from './lib/scanner.mjs';

/** Patrones de valores quemados prohibidos en código de producto. */
const HARDCODE_PATTERNS = [
  {
    id: 'url',
    label: 'URL literal',
    regex: /https?:\/\/[^\s"'`)]+/g,
  },
  {
    id: 'credential',
    label: 'Credencial/secreto quemado',
    regex:
      /\b(?:password|passwd|secret|api[_-]?key|apikey|client[_-]?secret|access[_-]?token|auth[_-]?token|bearer[_-]?token|private[_-]?key)\b\s*[:=]\s*['"][^'"]{3,}['"]/gi,
  },
  {
    id: 'auth-header',
    label: 'Cabecera de autorización inline',
    regex: /['"]Bearer\s+[A-Za-z0-9._~+/-]{10,}['"]/g,
  },
  {
    id: 'dsn',
    label: 'Cadena de conexión embebida',
    regex: /(?:postgres(?:ql)?|mysql|mariadb|mongodb|redis):\/\/[^\s"'`)]+/gi,
  },
  {
    id: 'host-port',
    label: 'Dirección de servidor (IP:puerto)',
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}\b/g,
  },
];

/**
 * ¿El archivo debe excluirse del análisis de hardcode (tests/fixtures)?
 * @param {string} file - Ruta absoluta del archivo.
 * @returns {boolean} `true` si es un archivo de prueba o fixture.
 */
function isFixture(file) {
  const base = path.basename(file);
  return /\.(?:test|spec)\.(?:ts|tsx)$/.test(base) || file.includes(`${path.sep}test${path.sep}`);
}

/**
 * Busca valores quemados en un archivo (fuera de comentarios).
 * @param {string} filePath - Ruta absoluta del archivo.
 * @param {string} code - Contenido del archivo.
 * @returns {ReadonlyArray<{ line: number; column: number; label: string; value: string }>}
 */
export function findHardcoded(filePath, code) {
  const clean = stripComments(code);
  const findings = [];

  for (const pattern of HARDCODE_PATTERNS) {
    let match;
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(clean)) !== null) {
      // Las URL/DSN con interpolación son dinámicas, no valores quemados.
      if (match[0].includes('${')) {
        if (pattern.regex.lastIndex === match.index) pattern.regex.lastIndex += 1;
        continue;
      }
      const { line, column } = toLineAndColumn(clean, match.index);
      findings.push({
        line,
        column,
        label: pattern.label,
        value: match[0].slice(0, 60),
      });
      if (pattern.regex.lastIndex === match.index) pattern.regex.lastIndex += 1;
    }
  }

  return findings;
}

/** Punto de entrada de la CLI. */
function main() {
  const args = process.argv.slice(2);
  const files = collectSourceFiles(args).filter((file) => !isFixture(file));
  let violations = 0;

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (const finding of findHardcoded(file, code)) {
      violations += 1;
      const rel = path.relative(FRONTEND_ROOT, file);
      console.error(
        `❌ ${rel}:${finding.line}:${finding.column} ${finding.label} → "${finding.value}"`,
      );
    }
  }

  if (violations > 0) {
    console.error(
      `\n${violations} valor(es) quemado(s) detectado(s). Regla CLAUDE 1 (NO HARDCODE).`,
    );
    process.exit(1);
  }

  console.log(
    `✅ validate:hardcode — ${files.length} archivo(s) de producto sin valores quemados.`,
  );
}

main();
