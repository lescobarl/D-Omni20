import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_HELP } from './fieldHelp';

/**
 * Guard del catálogo de ayuda de campos (regla CLAUDE: sin texto muerto).
 *
 * Contrato:
 * - Toda clave del catálogo debe estar en uso por al menos un componente de
 *   `src/components` (cero entradas huérfanas). Un texto de ayuda que nadie
 *   muestra se considera código muerto y hace fallar el guard.
 * - Las entradas no pueden estar vacías.
 */

/** Raíz de componentes de producto (sin tests/fixtures). */
const COMPONENTS_ROOT = join(process.cwd(), 'src', 'components');

/**
 * Recorre un directorio y devuelve las rutas de archivos fuente `.ts`/`.tsx`
 * excluyendo tests, specs y helpers de fixtures.
 * @param dir - Directorio a recorrer.
 * @param acc - Acumulador de rutas (uso recursivo).
 * @returns Rutas absolutas de archivos de producto.
 */
function collectComponentFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      collectComponentFiles(absolute, acc);
    } else if (/\.(?:ts|tsx)$/.test(entry) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry)) {
      acc.push(absolute);
    }
  }
  return acc;
}

describe('fieldHelp catalog', () => {
  it('no contiene textos de ayuda vacíos', () => {
    const empty = Object.entries(FIELD_HELP).filter(([, entry]) => entry.text.trim() === '');
    expect(empty).toEqual([]);
  });

  it('toda clave del catálogo está en uso por al menos un componente', () => {
    const sources = collectComponentFiles(COMPONENTS_ROOT)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const unused = Object.keys(FIELD_HELP).filter(
      (key) => !sources.includes(`'${key}'`) && !sources.includes(`"${key}"`),
    );

    expect(unused).toEqual([]);
  });
});
