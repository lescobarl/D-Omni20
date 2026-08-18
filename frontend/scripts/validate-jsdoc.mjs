#!/usr/bin/env node
/**
 * Validador de documentación JSDoc (obligación CLAUDE 2 — JSDoc en cada componente/método).
 *
 * Contrato:
 * - Exige JSDoc en declaraciones exportadas (function, class, interface,
 *   type alias, enum y const/let/var exportados) y en los miembros de clases
 *   (métodos, propiedades, accesores) e interfaces (métodos, propiedades,
 *   accesores).
 * - Los constructores se excluyen por convención del código base
 *   (véase `ConsoleLogger` en `src/lib/logger.ts`).
 * - Usa la API del compilador TypeScript: el JSDoc se asocia con el parser
 *   real (`ts.getJSDocCommentsAndTags`), evitando falsos positivos.
 * - Los archivos de prueba y fixtures se excluyen por diseño (igual que
 *   validate:hardcode y validate:trycatch).
 * - Con argumentos valida solo esos archivos (uso desde lint-staged);
 *   sin argumentos escanea `src/`.
 *
 * Uso:
 *   node scripts/validate-jsdoc.mjs [archivo...]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { collectSourceFiles, FRONTEND_ROOT } from './lib/scanner.mjs';

/**
 * ¿El archivo debe excluirse del análisis (tests/fixtures)?
 * @param {string} file - Ruta absoluta del archivo.
 * @returns {boolean} `true` si es un archivo de prueba o fixture.
 */
function isFixture(file) {
  const base = path.basename(file);
  return /\.(?:test|spec)\.(?:ts|tsx)$/.test(base) || file.includes(`${path.sep}test${path.sep}`);
}

/** Etiquetas legibles por tipo de nodo (para el reporte). */
const KIND_LABEL = {
  [ts.SyntaxKind.FunctionDeclaration]: 'función',
  [ts.SyntaxKind.ClassDeclaration]: 'clase',
  [ts.SyntaxKind.InterfaceDeclaration]: 'interfaz',
  [ts.SyntaxKind.TypeAliasDeclaration]: 'type alias',
  [ts.SyntaxKind.EnumDeclaration]: 'enum',
  [ts.SyntaxKind.VariableStatement]: 'const/let/var exportado',
  [ts.SyntaxKind.MethodDeclaration]: 'método',
  [ts.SyntaxKind.PropertyDeclaration]: 'propiedad',
  [ts.SyntaxKind.GetAccessor]: 'getter',
  [ts.SyntaxKind.SetAccessor]: 'setter',
  [ts.SyntaxKind.MethodSignature]: 'método (interfaz)',
  [ts.SyntaxKind.PropertySignature]: 'propiedad (interfaz)',
};

/**
 * ¿El nodo es una declaración de nivel superior que exige JSDoc?
 * @param {ts.Node} node - Nodo del AST.
 * @returns {boolean} `true` si requiere JSDoc.
 */
function requiresJsdoc(node) {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.VariableStatement:
      return true;
    default:
      return false;
  }
}

/**
 * ¿El nodo es un miembro de clase que exige JSDoc?
 * (Los constructores se excluyen por convención.)
 * @param {ts.Node} node - Nodo del AST.
 * @returns {boolean} `true` si es método/propiedad/accesor de clase.
 */
function isClassMember(node) {
  switch (node.kind) {
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return true;
    default:
      return false;
  }
}

/**
 * ¿El nodo es un miembro de interfaz que exige JSDoc?
 * @param {ts.Node} node - Nodo del AST.
 * @returns {boolean} `true` si es firma de método/propiedad/accesor.
 */
function isInterfaceMember(node) {
  switch (node.kind) {
    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.PropertySignature:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return true;
    default:
      return false;
  }
}

/**
 * ¿La declaración está exportada (`export` o `export default`)?
 * @param {ts.Node} node - Nodo del AST.
 * @returns {boolean} `true` si está exportada.
 */
function isExported(node) {
  const flags = ts.getCombinedModifierFlags(node);
  return (flags & ts.ModifierFlags.Export) !== 0 || (flags & ts.ModifierFlags.Default) !== 0;
}

/**
 * ¿El nodo tiene JSDoc asociado por el compilador?
 * @param {ts.Node} node - Nodo del AST.
 * @returns {boolean} `true` si tiene al menos un bloque JSDoc.
 */
function hasJsdoc(node) {
  return ts.getJSDocCommentsAndTags(node).length > 0;
}

/**
 * Nombre legible de un nodo para el reporte.
 * @param {ts.Node} node - Nodo del AST.
 * @returns {string} Nombre del nodo o `(anónimo)`.
 */
function nameOf(node) {
  const name = node.name;
  return name ? name.getText() : '(anónimo)';
}

/**
 * Recorre el AST y acumula declaraciones sin JSDoc.
 * @param {ts.Node} node - Nodo actual.
 * @param {ts.SourceFile} sourceFile - Archivo fuente.
 * @param {Array<{ line: number; column: number; kind: string; name: string }>} findings
 * @returns {void}
 */
function checkNode(node, sourceFile, findings) {
  const parentKind = node.parent ? node.parent.kind : undefined;
  const isInsideClass =
    parentKind === ts.SyntaxKind.ClassDeclaration || parentKind === ts.SyntaxKind.ClassExpression;
  const isInsideInterface = parentKind === ts.SyntaxKind.InterfaceDeclaration;

  let needsJsdoc = false;
  if (requiresJsdoc(node) && isExported(node)) {
    needsJsdoc = true;
  } else if (isInsideClass && isClassMember(node)) {
    needsJsdoc = true;
  } else if (isInsideInterface && isInterfaceMember(node)) {
    needsJsdoc = true;
  }

  if (needsJsdoc && !hasJsdoc(node)) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      line: pos.line + 1,
      column: pos.character + 1,
      kind: KIND_LABEL[node.kind] ?? ts.SyntaxKind[node.kind],
      name: nameOf(node),
    });
  }

  ts.forEachChild(node, (child) => checkNode(child, sourceFile, findings));
}

/**
 * Valida un archivo y reporta las declaraciones sin JSDoc.
 * @param {string} filePath - Ruta absoluta del archivo.
 * @param {string} code - Contenido del archivo.
 * @returns {ReadonlyArray<{ line: number; column: number; kind: string; name: string }>}
 */
export function validateFile(filePath, code) {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];
  checkNode(sourceFile, sourceFile, findings);
  return findings;
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
        `❌ ${rel}:${finding.line}:${finding.column} falta JSDoc en ${finding.kind} \`${finding.name}\``,
      );
    }
  }

  if (violations > 0) {
    console.error(
      `\n${violations} declaración(es) sin JSDoc. Obligación CLAUDE 2 (JSDoc en cada componente/método).`,
    );
    process.exit(1);
  }

  console.log(`✅ validate:jsdoc — ${files.length} archivo(s) de producto con JSDoc completo.`);
}

main();
