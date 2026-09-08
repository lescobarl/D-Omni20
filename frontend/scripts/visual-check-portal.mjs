/**
 * Verificación VISUAL del Portal y la Landing del tenant configurado con un
 * navegador real (Playwright/Chromium). Captura errores de consola, errores de
 * página, fallos de red y toma capturas de pantalla para validar que el widget
 * portal.js realmente renderiza contenido (no solo HTTP 200).
 *
 * Uso: node scripts/visual-check-portal.mjs
 *
 * Variables de entorno (opcionales): E2E_TENANT_SLUG, E2E_CLIENT_SUBDOMAIN_BASE,
 * E2E_SERVING_PORT y E2E_LANDING_SLUG.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// Configuración por variables de entorno (sin valores quemados, regla CLAUDE 1).
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'dev-tenant';
const CLIENT_SUBDOMAIN_BASE = process.env.E2E_CLIENT_SUBDOMAIN_BASE ?? 'clientes.omni2.app';
const SERVING_PORT = process.env.E2E_SERVING_PORT ?? '8000';
const LANDING_SLUG = process.env.E2E_LANDING_SLUG ?? '';

const BASE = `https://${TENANT_SLUG}.${CLIENT_SUBDOMAIN_BASE}:${SERVING_PORT}`;
const OUT_DIR = path.resolve('logs/visual-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [{ name: 'portal', url: `${BASE}/portal` }];
if (LANDING_SLUG) {
  targets.push({ name: 'landing', url: `${BASE}/l/${LANDING_SLUG}` });
}

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
