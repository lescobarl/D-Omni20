/**
 * Guard del "Protocolo de Iteración Rápida" (regla CLAUDE — no ejecutar toda la suite).
 *
 * Contrato:
 * - Protege de forma estructural e inmutable el protocolo que evita correr la suite
 *   completa en cada iteración (era demasiado lenta y hacía perder tiempo).
 * - Lee `package.json` (JSON.parse) y el documento de reglas versionado en el repo
 *   (`omnibotia-studio/CLAUDE.md`) desde el cwd de Vitest (`frontend/`).
 * - FALLA la suite si se degrada el protocolo:
 *   (a) `npm test` deja de incluir `--changed` (iteración rápida = solo lo cambiado),
 *   (b) se elimina el script `test:full` (suite completa explícita),
 *   (c) el documento de reglas pierde menciones clave del protocolo
 *       (`--changed`, `test:full`, el nombre de este guard y el gate de entrega
 *       con `test:full`). El gate de entrega es el **pre-push** (suite completa
 *       una vez por push); el pre-commit es ligero (lint-staged + tipos).
 *
 * Nota: este guard corre en TODA ejecución de Vitest (incluida la iteración rápida),
 * por lo que debe ser instantáneo (solo lectura de 2 archivos, sin red ni DOM).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Raíz del frontend (cwd de Vitest). */
const FRONTEND_ROOT = resolve(__dirname, '..', '..');
/** `package.json` del frontend. */
const PACKAGE_JSON_PATH = resolve(FRONTEND_ROOT, 'package.json');
/** Documento de reglas versionado dentro del repo (raíz del repo = `omnibotia-studio/`). */
const RULES_DOC_PATH = resolve(FRONTEND_ROOT, '..', 'CLAUDE.md');

/** Carga y parsea `package.json`. */
function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as Record<string, unknown>;
}

/** Lee el documento de reglas como texto plano. */
function readRulesDoc(): string {
  return readFileSync(RULES_DOC_PATH, 'utf8');
}

/** Devuelve el mapa de scripts declarados en `package.json`. */
function getScripts(pkg: Record<string, unknown>): Record<string, string> {
  const scripts = pkg['scripts'];
  if (typeof scripts !== 'object' || scripts === null) {
    throw new Error('package.json no declara un objeto "scripts".');
  }
  return scripts as Record<string, string>;
}

describe('Protocolo de Iteración Rápida (guard estructural)', () => {
  it('`npm test` corre SOLO los tests de lo cambiado (incluye `--changed`)', () => {
    const scripts = getScripts(readPackageJson());
    const testCmd = scripts['test'];
    expect(testCmd, 'El script "test" debe existir en package.json').toBeDefined();
    expect(testCmd, '`npm test` debe incluir `--changed` para no correr toda la suite').toContain(
      '--changed',
    );
  });

  it('existe `test:full` para ejecutar la suite completa de forma explícita', () => {
    const scripts = getScripts(readPackageJson());
    expect(scripts['test:full'], 'El script "test:full" no debe eliminarse').toBeDefined();
    expect(scripts['test:full']).toContain('vitest run');
  });

  it('el documento de reglas del repo conserva las menciones clave del protocolo', () => {
    const doc = readRulesDoc();
    expect(doc, 'El doc de reglas debe mencionar `--changed`').toContain('--changed');
    expect(doc, 'El doc de reglas debe mencionar `test:full`').toContain('test:full');
    expect(doc, 'El doc de reglas debe mencionar el guard test').toContain('protocolGuard.test.ts');
    expect(
      doc,
      'El doc de reglas debe fijar el gate de entrega (pre-commit o pre-push) con `test:full`',
    ).toMatch(/(?:pre-commit|pre-push)[^\n]*test:full|test:full[^\n]*(?:pre-commit|pre-push)/i);
  });
});
