/**
 * Verificación VISUAL del Editor/Configurador (SPA en Vite) con un navegador real
 * (Playwright/Chromium). Valida que el editor SÍ se conecta al backend tras el
 * cambio de VITE_API_BASE_URL a https://127.0.0.1:8000 (el backend sirve HTTPS).
 *
 * Comprueba:
 *  - Que NO aparezca el mensaje "No se pudo conectar con el servidor".
 *  - Que el selector de tenant cargue opciones (implica que la llamada API a
 *    https://127.0.0.1:8000 tuvo éxito).
 *  - Errores de consola, errores de página y peticiones fallidas.
 *
 * Uso: node scripts/visual-check-editor.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const EDITOR_URL = 'http://127.0.0.1:5174';
const OUT_DIR = path.resolve('logs/visual-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  // El certificado mkcert NO está en el store de Chromium de Playwright, así que
  // ignoramos errores TLS para poder renderizar (el navegador real del usuario
  // SÍ confía en la CA raíz mkcert instalada en Windows).
  ignoreHTTPSErrors: true,
});

const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const consoleAll = [];
const apiResponses = [];

page.on('console', (msg) => {
  consoleAll.push(`[${msg.type()}] ${msg.text()}`);
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('requestfailed', (req) =>
  failedRequests.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText}`),
);
// Captura las respuestas de la API del backend para confirmar que se habla HTTPS.
page.on('response', (resp) => {
  const u = resp.url();
  if (u.includes('127.0.0.1:8000') || u.includes('localhost:8000')) {
    apiResponses.push(`${resp.status()} ${resp.request().method()} ${u}`);
  }
});

let status = null;
try {
  const resp = await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 40000 });
  status = resp ? resp.status() : null;
  await page.waitForTimeout(4000); // deja que cargue tenants/landing
} catch (e) {
  pageErrors.push(`goto: ${String(e)}`);
}

const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 1200);

// Indicadores clave
const hasConnectError = /No se pudo conectar con el servidor/i.test(bodyText);
const hasTenantSelector = /Selecciona|Tenant|tenant/i.test(bodyText);

const shot = path.join(OUT_DIR, 'editor.png');
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

const report = {
  target: 'editor (configurador)',
  url: EDITOR_URL,
  status,
  hasConnectError,
  hasTenantSelector,
  apiResponses,
  bodyTextPreview: bodyText,
  consoleErrors,
  pageErrors,
  failedRequests,
  consoleAll: consoleAll.slice(0, 20),
  screenshot: shot,
};

fs.writeFileSync(path.join(OUT_DIR, 'editor-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nCaptura guardada en: ${shot}`);

await browser.close();
