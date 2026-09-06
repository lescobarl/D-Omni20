/**
 * Verificación VISUAL del Portal y la Landing de Escobar con un navegador real
 * (Playwright/Chromium). Captura errores de consola, errores de página, fallos
 * de red y toma capturas de pantalla para validar que el widget portal.js
 * realmente renderiza contenido (no solo HTTP 200).
 *
 * Uso: node scripts/visual-check-portal.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://escobar.clientes.omni2.app:8000';
const OUT_DIR = path.resolve('logs/visual-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: 'portal', url: `${BASE}/portal` },
  { name: 'landing', url: `${BASE}/l/casa-vista-al-lago-tequesquitengo` },
];

const browser = await chromium.launch({
  // El certificado mkcert NO está en el store de Chromium de Playwright, así que
  // ignoramos errores TLS para poder renderizar (el navegador real del usuario
  // SÍ confía en la CA raíz mkcert instalada en Windows).
  ignoreHTTPSErrors: true,
});

const report = [];
for (const t of targets) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const consoleAll = [];

  page.on('console', (msg) => {
    consoleAll.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) =>
    failedRequests.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText}`),
  );

  let status = null;
  let finalUrl = null;
  try {
    const resp = await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 });
    status = resp ? resp.status() : null;
    finalUrl = page.url();
    await page.waitForTimeout(2500); // deja que portal.js renderice
  } catch (e) {
    pageErrors.push(`goto: ${String(e)}`);
  }

  // Contenido del contenedor del portal (si existe)
  const portalHtml = await page
    .locator('[data-omni-portal]')
    .innerHTML()
    .catch(() => '(no [data-omni-portal] en la página)');
  const bodyText = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).slice(0, 600);

  const shot = path.join(OUT_DIR, `${t.name}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

  report.push({
    target: t.name,
    url: t.url,
    status,
    finalUrl,
    portalHtmlPreview: portalHtml.slice(0, 300),
    bodyTextPreview: bodyText,
    consoleErrors,
    pageErrors,
    failedRequests,
    consoleAll: consoleAll.slice(0, 15),
    screenshot: shot,
  });

  await page.close();
}

await browser.close();

fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nCapturas guardadas en: ${OUT_DIR}`);
