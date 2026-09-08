/**
 * Captura de screenshots de los endpoints públicos de serving (portal y landing)
 * servidos por el backend con TLS local (mkcert).
 *
 * Uso:
 *   node scripts/capture-serving-screenshots.mjs
 *
 * Salida: omnibotia-studio/docs/evidencia-serving/*.png
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'docs', 'evidencia-serving');

// Configuración por variables de entorno (sin valores quemados, regla CLAUDE 1).
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'dev-tenant';
const CLIENT_SUBDOMAIN_BASE = process.env.E2E_CLIENT_SUBDOMAIN_BASE ?? 'clientes.omni2.app';
const SERVING_PORT = process.env.E2E_SERVING_PORT ?? '8000';
const LANDING_ID = process.env.E2E_LANDING_ID ?? '';
const LANDING_SLUG = process.env.E2E_LANDING_SLUG ?? '';

const DOMAIN = `https://${TENANT_SLUG}.${CLIENT_SUBDOMAIN_BASE}:${SERVING_PORT}`;

const TARGETS = [
  { name: 'portal', url: `${DOMAIN}/portal` },
  { name: 'raiz-redirect', url: `${DOMAIN}/` },
];
// Los targets de landing requieren el id/slug de una landing publicada del
// tenant; se incluyen solo cuando se aportan (evita URLs inválidas).
if (LANDING_ID) {
  TARGETS.push({ name: 'landing', url: `${DOMAIN}/cdn/${LANDING_ID}/v3` });
}
if (LANDING_SLUG) {
  TARGETS.push({ name: 'landing-slug', url: `${DOMAIN}/l/${LANDING_SLUG}` });
}

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();

for (const target of TARGETS) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: false, // NO ignorar errores SSL: queremos validar el certificado real
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    const f = req.failure();
    if (f) errors.push(`requestfailed ${req.url()}: ${f.errorText}`);
  });

  try {
    const response = await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 });
    const status = response ? response.status() : 'NO_RESPONSE';
    const title = await page.title().catch(() => '(sin titulo)');
    const outFile = join(OUT_DIR, `${target.name}.png`);
    await page.screenshot({ path: outFile, fullPage: true });

    console.log(`[OK] ${target.name}`);
    console.log(`  url:     ${target.url}`);
    console.log(`  status:  ${status}`);
    console.log(`  title:   ${title}`);
    console.log(`  capture: ${outFile}`);
    if (errors.length) {
      console.log(`  ERRORS:  ${errors.join(' | ')}`);
    } else {
      console.log(`  ssl:     certificado valido (sin errores de conexion)`);
    }
  } catch (err) {
    console.log(`[FAIL] ${target.name}`);
    console.log(`  url:     ${target.url}`);
    console.log(`  error:   ${err.message}`);
    if (errors.length) console.log(`  ERRORS:  ${errors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

await browser.close();
