/**
 * Captura evidencia visual (Regla 0.1 del CLAUDE.md) de las Fases 5.1 y 5.2.
 *
 * Contrato:
 * - Abre la aplicación real contra el servidor de desarrollo de Vite (localhost:5173).
 * - Inserta bloques desde la librería (Fase 5.1: canvas dnd-kit) y espera a que Monaco
 *   (Fase 5.2) renderice el código compilado con resaltado de sintaxis Jinja2.
 * - Guarda las capturas en `docs/evidencia-fase-5-2/` para certificar la verificación.
 *
 * Uso:
 *   node scripts/capture-evidence.mjs            # usa localhost:5173
 *   EVIDENCE_BASE_URL=http://... node scripts/capture-evidence.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Directorio de salida de las capturas (evidencia versionable). */
const OUT_DIR = resolve(__dirname, '../../docs/evidencia-fase-5-2');
/** URL base: se reutiliza el servidor de desarrollo ya activo. */
const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:5173';
/** Dimensiones del viewport para una captura representativa del editor tri-panel. */
const VIEWPORT = { width: 1440, height: 900 };

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });

try {
  // Estado limpio: evita que la persistencia de Zustand contamine la captura.
  await page.addInitScript(() => localStorage.clear());
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Cabecera de la aplicación (contrato real del entorno).
  await page.waitForSelector('h1', { timeout: 10_000 });

  // Fase 5.1: insertar bloques desde la librería hacia el canvas.
  const library = page.getByRole('complementary', { name: 'Librería de bloques' });
  await library.getByRole('button', { name: /Hero con Video/ }).click();
  await library.getByRole('button', { name: /Calculadora JS/ }).click();
  await library.getByRole('button', { name: /Cuadrícula de Servicios/ }).click();
  await page.waitForSelector('main article', { timeout: 10_000 });

  // Fase 5.2: esperar la carga diferida de Monaco y el código compilado.
  const code = page
    .getByRole('complementary', { name: 'Editor de código' })
    .locator('.monaco-editor');
  await code.waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => document.body.innerText.includes('block--hero'), undefined, {
    timeout: 20_000,
  });

  // Evidencia: editor completo (canvas + librería + Monaco) y closeup del código.
  await page.screenshot({ path: `${OUT_DIR}/editor-completo.png`, fullPage: true });
  await code.screenshot({ path: `${OUT_DIR}/monaco-code-panel.png` });

  console.log(`Evidencia Regla 0.1 capturada en: ${OUT_DIR}`);
} finally {
  await browser.close();
}
