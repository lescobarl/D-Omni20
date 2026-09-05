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

const TARGETS = [
  {
    name: 'portal-escobar',
    url: 'https://escobar.clientes.omni2.app:8000/portal',
  },
  {
    name: 'landing-escobar',
    url: 'https://escobar.clientes.omni2.app:8000/cdn/2dd39716-8fc3-4e85-869e-0b644b0e1938/v3',
  },
  {
    name: 'landing-escobar-slug',
    url: 'https://escobar.clientes.omni2.app:8000/l/casa-vista-al-lago-tequesquitengo',
  },
  {
    name: 'raiz-escobar-redirect',
    url: 'https://escobar.clientes.omni2.app:8000/',
  },
];

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
