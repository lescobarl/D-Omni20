/**
 * Captura evidencia visual (Regla 0.1 del CLAUDE.md) de las Fases 5.1 a 5.4.
 *
 * Contrato:
 * - Abre la aplicación real contra el servidor de desarrollo de Vite (localhost:5173)
 *   y requiere el backend activo en localhost:8000 para la compilación real (Fase 5.4).
 * - Inserta bloques desde la librería (Fase 5.1: canvas dnd-kit) y espera a que Monaco
 *   (Fase 5.2) renderice el código compilado con resaltado de sintaxis Jinja2.
 * - Captura el panel del asistente IA con un prompt cargado (Fase 5.3).
 * - Captura la vista previa compilada esperando el texto `Compilado en N ms`, lo que
 *   certifica que la compilación pasa por el backend real (Fase 5.4).
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

  // Fase 5.3: panel del asistente IA con el prompt cargado en el formulario.
  await page.getByRole('tab', { name: 'IA', exact: true }).click();
  await page
    .getByLabel('Describe la landing que quieres generar')
    .fill('Landing de venta para una clínica dental con testimonios y formulario de cotización.');
  await page.waitForTimeout(200);
  await page.locator('#sidebar-panel-ai').screenshot({ path: `${OUT_DIR}/ai-panel.png` });

  // Fase 5.4: vista previa compilada contra el backend real (espera la duración).
  await page.getByRole('tab', { name: 'Vista previa' }).click();
  await page.getByText(/Compilado en \d+ ms/).waitFor({ timeout: 15_000 });
  await page.locator('#right-panel-preview').screenshot({ path: `${OUT_DIR}/preview-panel.png` });

  console.log(`Evidencia Regla 0.1 (Fases 5.1-5.4) capturada en: ${OUT_DIR}`);
} finally {
  await browser.close();
}
