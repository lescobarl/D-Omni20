/**
 * VALIDACIÓN E2E COMPLETA del flujo del tenant `escobar` en navegador real
 * (Playwright/Chromium). Recorre TODO el flujo de construcción comercial y de
 * publicación, tomando una captura de pantalla en cada paso:
 *
 *   1. El editor (SPA en Vite) carga y SE CONECTA al backend (sin el error
 *      "No se pudo conectar con el servidor") y el selector de tenant carga.
 *   2. Se selecciona el tenant `escobar`.
 *   3. Se remonta el editor (Captación -> Sitio) para cargar las landings de
 *      escobar y se CREA una landing nueva (Nueva -> nombre -> Guardar).
 *   4. Se PUBLICA la landing nueva.
 *   5. Se abre la landing publicada en el dominio real
 *      https://escobar.clientes.omni2.app:8000/l/<slug> y se verifica que
 *      renderiza (no solo HTTP 200).
 *   6. Se abre el Portal del Cliente https://escobar.clientes.omni2.app:8000/portal
 *      y se verifica que renderiza.
 *   7. En el editor se captura un LEAD (workflow "Captura de Leads") con la
 *      landing nueva cargada (contexto {landing_id, campaign_id}).
 *   8. Limpieza: se elimina la landing nueva creada por este run.
 *
 * Uso: node scripts/e2e-validate-escobar.mjs
 *
 * Dependencias del entorno:
 *   - Backend HTTPS en https://127.0.0.1:8000 (VITE_API_BASE_URL).
 *   - SPA del editor en http://127.0.0.1:5174.
 *   - Host `escobar.clientes.omni2.app` -> 127.0.0.1 en el archivo hosts.
 *   - Feature-gates `ads` y `operations` activados en `.env.development`.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const EDITOR_URL = 'http://127.0.0.1:5174';
const DOMAIN_BASE = 'https://escobar.clientes.omni2.app:8000';
const OUT_DIR = path.resolve('logs/visual-check/e2e-escobar');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Contrato de la UI (nombres accesibles estables, igual que faseG_chain.spec.ts).
const TENANT_SELECT = 'Tenant activo';
const ESCOBAR_SLUG = 'escobar';
const RIGHT_PANEL_TABLIST = 'Panel derecho del editor';
const WORKFLOW_TABLIST = 'Tipos de workflow';

/** Sufijo único por run para la landing creada (evita colisiones y permite limpiarla). */
const stamp = Date.now();
const landingName = `E2E Validación Escobar ${stamp}`;
const leadEmail = `e2e-escobar-${stamp}@example.com`;

/** Normaliza un nombre a slug URL amigable (mismo criterio que el backend). */
function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
const landingSlug = slugify(landingName);

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
page.on('response', (resp) => {
  const u = resp.url();
  if (u.includes('127.0.0.1:8000') || u.includes('localhost:8000')) {
    apiResponses.push(`${resp.status()} ${resp.request().method()} ${u}`);
  }
});

const steps = [];
function record(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  return p;
}

// Pequeño helper de espera con reintento para textos de estado (role="status").
async function waitForStatusText(substring, timeout = 15000) {
  const status = page.getByRole('status').filter({ hasText: 'Landing' });
  await status.waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    (sub) => {
      const els = Array.from(document.querySelectorAll('[role="status"]'));
      return els.some((el) => el.textContent && el.textContent.includes(sub));
    },
    substring,
    { timeout },
  );
}

try {
  // ---------------------------------------------------------------------------
  // PASO 1 - El editor carga y se conecta al backend.
  // ---------------------------------------------------------------------------
  let editorStatus = null;
  try {
    const resp = await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 40000 });
    editorStatus = resp ? resp.status() : null;
    await page.waitForTimeout(4000);
  } catch (e) {
    pageErrors.push(`goto editor: ${String(e)}`);
  }
  const bodyText1 = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).slice(0, 1200);
  const hasConnectError = /No se pudo conectar con el servidor/i.test(bodyText1);
  const tenantSelect = page.getByLabel(TENANT_SELECT);
  const tenantVisible = await tenantSelect.isVisible().catch(() => false);
  record('PASO 1: editor carga y se conecta al backend', !hasConnectError && tenantVisible);
  await shot('1-editor-conectado');

  // ---------------------------------------------------------------------------
  // PASO 2 - Seleccionar el tenant escobar.
  // ---------------------------------------------------------------------------
  await tenantSelect.selectOption(ESCOBAR_SLUG);
  const tenantValue = await tenantSelect.inputValue().catch(() => '');
  record(
    'PASO 2: seleccionar tenant escobar',
    tenantValue === ESCOBAR_SLUG,
    `value=${tenantValue}`,
  );
  await shot('2-tenant-escobar');

  // ---------------------------------------------------------------------------
  // PASO 3 - Remontar el editor y CREAR una landing nueva en escobar.
  // ---------------------------------------------------------------------------
  // El editor se montó con dev-tenant. Alternamos a "Captación" y volvemos para
  // forzar el remontaje con el tenant escobar (sin recargar la página).
  await page.getByRole('button', { name: 'Captación' }).click();
  await page
    .getByRole('heading', { level: 2, name: 'Captación publicitaria' })
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Sitio' }).click();

  const siteSelect = page.locator('#site-page-select');
  await siteSelect.waitFor({ state: 'visible', timeout: 15000 });

  // Crear una landing nueva. "Nueva" genera una landing en blanco (sin bloques);
  // añadimos un bloque "Hero con Video" desde la librería para que la landing
  // renderice contenido visible al publicarla en el dominio (una landing sin
  // bloques compila un <main> vacío y no muestra contenido).
  await page.getByRole('button', { name: 'Nueva' }).click();
  const titleInput = page.locator('#landing-title');
  await titleInput.waitFor({ state: 'visible', timeout: 10000 });
  await titleInput.fill(landingName);
  // Insertar un bloque hero con contenido por defecto (titular '¡Impulsa tu negocio!').
  const heroBlockButton = page.getByRole('button', { name: 'Hero con Video' });
  await heroBlockButton.waitFor({ state: 'visible', timeout: 10000 });
  await heroBlockButton.click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await waitForStatusText('Landing creada.');
  record('PASO 3: crear landing nueva (con bloque hero)', true, landingName);
  await shot('3-landing-creada');

  // ---------------------------------------------------------------------------
  // PASO 4 - Publicar la landing nueva.
  // ---------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Publicar' }).click();
  await waitForStatusText('Landing publicada.');
  record('PASO 4: publicar landing nueva', true);
  await shot('4-landing-publicada');

  // ---------------------------------------------------------------------------
  // PASO 5 - Abrir la landing publicada en el dominio real.
  // ---------------------------------------------------------------------------
  const landingUrl = `${DOMAIN_BASE}/l/${landingSlug}`;
  let landingStatus = null;
  let landingFinalUrl = null;
  let landingHasContent = false;
  try {
    const resp = await page.goto(landingUrl, { waitUntil: 'networkidle', timeout: 30000 });
    landingStatus = resp ? resp.status() : null;
    landingFinalUrl = page.url();
    await page.waitForTimeout(2500);
    const landingBody = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).slice(0, 600);
    // La landing compilada renderiza contenido real (no una página de error).
    landingHasContent = landingBody.trim().length > 20 && !/Not Found|404/i.test(landingBody);
  } catch (e) {
    pageErrors.push(`goto landing: ${String(e)}`);
  }
  record(
    'PASO 5: ver landing publicada en el dominio',
    landingStatus === 200 && landingHasContent,
    `status=${landingStatus} url=${landingFinalUrl}`,
  );
  await shot('5-landing-en-dominio');

  // ---------------------------------------------------------------------------
  // PASO 6 - Abrir el Portal del Cliente en el dominio real.
  // ---------------------------------------------------------------------------
  const portalUrl = `${DOMAIN_BASE}/portal`;
  let portalStatus = null;
  let portalHasContent = false;
  try {
    const resp = await page.goto(portalUrl, { waitUntil: 'networkidle', timeout: 30000 });
    portalStatus = resp ? resp.status() : null;
    await page.waitForTimeout(2500);
    const portalHtml = await page
      .locator('[data-omni-portal]')
      .innerHTML()
      .catch(() => '');
    const portalBody = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).slice(0, 600);
    portalHasContent = portalHtml.length > 0 || portalBody.trim().length > 20;
  } catch (e) {
    pageErrors.push(`goto portal: ${String(e)}`);
  }
  record(
    'PASO 6: ver Portal del Cliente en el dominio',
    portalStatus === 200 && portalHasContent,
    `status=${portalStatus}`,
  );
  await shot('6-portal-cliente');

  // ---------------------------------------------------------------------------
  // PASO 7 - Capturar un lead con la landing nueva cargada (contexto).
  // ---------------------------------------------------------------------------
  // Volvemos al editor. Al remontar, el editor se monta limpio (sin landing
  // seleccionada), así que hay que volver a cargar la landing nueva en el store
  // para que la captura de leads adjunte el contexto {landing_id, campaign_id}.
  await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(3000);
  await page.getByLabel(TENANT_SELECT).selectOption(ESCOBAR_SLUG);
  await page.getByRole('button', { name: 'Captación' }).click();
  await page
    .getByRole('heading', { level: 2, name: 'Captación publicitaria' })
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Sitio' }).click();
  const siteSelect2 = page.locator('#site-page-select');
  await siteSelect2.waitFor({ state: 'visible', timeout: 15000 });
  // La landing nueva debe estar en el selector del sitio. El listado de landings
  // se carga de forma asíncrona al montar el configurador (SiteEditor.loadLists):
  // el <select> arranca deshabilitado con opciones vacías y se habilita cuando la
  // lista llega. Esperamos (con reintento) a que el <select> esté habilitado y a
  // que la opción con el nombre de la landing aparezca, en lugar de contar de
  // inmediato (evita una condición de carrera).
  const newLandingOption = siteSelect2.locator('option', { hasText: landingName });
  let optionCount = 0;
  try {
    await page.waitForFunction(
      (name) => {
        const sel = document.querySelector('#site-page-select');
        if (!sel || sel.disabled) return false;
        return Array.from(sel.querySelectorAll('option')).some(
          (o) => o.textContent && o.textContent.includes(name),
        );
      },
      landingName,
      { timeout: 15000 },
    );
    optionCount = await newLandingOption.count().catch(() => 0);
  } catch {
    optionCount = await newLandingOption.count().catch(() => 0);
  }
  if (optionCount === 1) {
    await siteSelect2.selectOption({ label: landingName });
    await waitForStatusText('cargada');
  }
  record(
    'PASO 7a: recargar la landing nueva en el editor',
    optionCount === 1,
    `options=${optionCount}`,
  );

  // Abrir el panel de Workflows y el workflow "Captura de Leads".
  await page
    .getByRole('tablist', { name: RIGHT_PANEL_TABLIST })
    .getByRole('tab', { name: 'Workflows' })
    .click();
  await page
    .getByRole('heading', { level: 2, name: 'Workflows' })
    .waitFor({ state: 'visible', timeout: 10000 });
  await page
    .getByRole('tablist', { name: WORKFLOW_TABLIST })
    .getByRole('tab', { name: 'Captura de Leads' })
    .click();
  const leadPanel = page.getByRole('tabpanel', { name: 'Captura de Leads' });
  await leadPanel.waitFor({ state: 'visible', timeout: 10000 });

  await leadPanel.getByLabel('Nombre').fill('E2E Escobar Prospecto');
  await leadPanel.getByLabel('Correo').fill(leadEmail);
  await leadPanel.getByLabel('Teléfono (opcional)').fill('+52 55 1234 5678');
  await leadPanel.getByLabel('Origen').selectOption('facebook');
  await leadPanel.getByRole('button', { name: 'Capturar lead' }).click();

  const leadOk = await leadPanel
    .getByText(/Lead new · origen facebook/)
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  record('PASO 7: capturar lead con contexto', leadOk, leadEmail);
  await shot('7-lead-capturado');

  // ---------------------------------------------------------------------------
  // PASO 8 - Limpieza: eliminar la landing nueva creada por este run.
  // ---------------------------------------------------------------------------
  // La UI del configurador no expone un botón "Eliminar" para landings en todos
  // los modos; la eliminación se hace vía API con el id de la landing. Obtenemos
  // el id consultando la API (listado del tenant escobar) filtrando por el nombre
  // único de este run. La petición se ejecuta DENTRO del contexto del navegador
  // (page.evaluate) para que herede `ignoreHTTPSErrors` y pueda hablar HTTPS con
  // el backend (el fetch de Node rechazaría el certificado mkcert autofirmado).
  let cleanupOk = false;
  let cleanupDetail = 'no se encontró la landing para limpiar';
  try {
    const cleanup = await page.evaluate(
      async ({ apiBase, tenantSlug, name }) => {
        const listResp = await fetch(`${apiBase}/api/v1/designer?page=1&page_size=100`, {
          headers: { 'X-Tenant-Id': tenantSlug },
        });
        if (!listResp.ok) {
          return { ok: false, detail: `list status=${listResp.status}` };
        }
        const data = await listResp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const created = items.find((it) => it.name === name);
        if (!created || !created.id) {
          return { ok: false, detail: 'no se encontró la landing para limpiar' };
        }
        const delResp = await fetch(`${apiBase}/api/v1/designer/${created.id}`, {
          method: 'DELETE',
          headers: { 'X-Tenant-Id': tenantSlug },
        });
        return {
          ok: delResp.ok || delResp.status === 204,
          detail: `id=${created.id} status=${delResp.status}`,
        };
      },
      { apiBase: 'https://127.0.0.1:8000', tenantSlug: ESCOBAR_SLUG, name: landingName },
    );
    cleanupOk = cleanup.ok;
    cleanupDetail = cleanup.detail;
  } catch (e) {
    cleanupDetail = `error: ${String(e)}`;
  }
  record('PASO 8: limpiar landing creada', cleanupOk, cleanupDetail);
} catch (e) {
  pageErrors.push(`run: ${String(e)}`);
  record('EJECUCIÓN COMPLETA', false, String(e));
}

const report = {
  target: 'E2E completo flujo tenant escobar',
  editorUrl: EDITOR_URL,
  domainBase: DOMAIN_BASE,
  landingName,
  landingSlug,
  landingUrl: `${DOMAIN_BASE}/l/${landingSlug}`,
  portalUrl: `${DOMAIN_BASE}/portal`,
  steps,
  apiResponses: apiResponses.slice(0, 40),
  consoleErrors,
  pageErrors,
  failedRequests,
  consoleAll: consoleAll.slice(0, 20),
  outDir: OUT_DIR,
};

fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log('\n================ RESUMEN ================');
for (const s of steps) {
  console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`);
}
const allOk = steps.every((s) => s.ok);
console.log(`\nRESULTADO GLOBAL: ${allOk ? 'TODOS LOS PASOS OK' : 'HAY PASOS FALLIDOS'}`);
console.log(`Capturas y reporte en: ${OUT_DIR}`);

await browser.close();
process.exit(allOk ? 0 : 1);
