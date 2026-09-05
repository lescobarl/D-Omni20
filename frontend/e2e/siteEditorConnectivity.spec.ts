/**
 * Verificación visual de conectividad del Editor del sitio (SiteEditor) contra el
 * backend real en desarrollo.
 *
 * Contexto del bug (FASE D — GAP-5 / colgado del backend):
 * Cuando el backend estaba "vivo pero inaccesible" (event-loop de Windows roto por
 * el bug de IocpProactor + Redis caído), el SiteEditor mostraba el error
 * "No se pudo conectar con el servidor" porque `loadLists()` (SiteEditor.tsx)
 * fallaba al llamar a `/api/v1/designer` y `/api/v1/portal-pages`.
 *
 * Este test reproduce EXACTAMENTE el escenario del usuario:
 *   1. Carga la app con el tenant `dev-tenant` (vista por defecto = SiteEditor).
 *   2. Verifica que el selector de tenant esté visible y preseleccione `dev-tenant`.
 *   3. Verifica que el selector unificado del sitio (`#site-page-select`) se habilite
 *      (status != 'error'), es decir que las landings/páginas del portal se cargaron.
 *   4. Verifica que NO aparezca el alerta de error "No se pudo conectar con el servidor".
 *   5. Captura evidencia visual (screenshot) del editor del sitio cargado.
 *
 * Es NO destructivo: solo lee listas y toma capturas; no crea ni modifica entidades.
 *
 * Dependencias del entorno:
 *   - Backend en `VITE_API_BASE_URL` (http://127.0.0.1:8000) con el tenant `dev-tenant`.
 *   - Frontend dev server en el puerto 5174 (config e2e-local).
 */
import { expect, test } from '@playwright/test';

/** Nombres accesibles estables de la UI (contratos). */
const TENANT_SELECT = 'Tenant activo';
const DEV_TENANT = 'dev-tenant';
const SITE_PAGE_SELECT = 'site-page-select';
const CONNECT_ERROR = 'No se pudo conectar con el servidor';

test.describe('Conectividad del Editor del sitio (SiteEditor)', () => {
  test('al cambiar al tenant escobar el editor recarga sus landings sin navegar (regresión remontaje)', async ({
    page,
  }) => {
    // Estado limpio: evita que la persistencia de Zustand contamine el test.
    await page.addInitScript(() => localStorage.clear());

    // Navegamos por `127.0.0.1` (origen real del usuario) para reproducir el escenario.
    await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });

    // Cabecera con la configuración real del entorno de desarrollo.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('OmniBotIA Studio');

    // PASO 1 - El selector de tenant está visible y preselecciona dev-tenant.
    const tenantSelect = page.getByRole('combobox', { name: TENANT_SELECT });
    await expect(tenantSelect).toBeVisible({ timeout: 15000 });
    await expect(tenantSelect).toHaveValue(DEV_TENANT);

    // PASO 2 - Cambiar al tenant `escobar` (Inmobiliaria Escobar).
    await tenantSelect.selectOption('escobar');
    await expect(tenantSelect).toHaveValue('escobar');

    // PASO 3 - El selector unificado del sitio se habilita y recarga las landings de
    // escobar SIN navegar a otra vista (regresión del bug: antes había que ir a
    // "Captación" y volver para forzar el remontaje). La landing real de escobar
    // "Casa vista al lago Tequesquitengo" debe aparecer de inmediato.
    const siteSelect = page.locator(`#${SITE_PAGE_SELECT}`);
    await expect(siteSelect).toBeVisible();
    await expect(siteSelect).toBeEnabled({ timeout: 15000 });
    await expect(
      siteSelect.locator('option', { hasText: 'Casa vista al lago Tequesquitengo' }),
    ).toHaveCount(1);

    // PASO 4 - NO debe aparecer el alerta de error de conexión.
    const connectAlert = page.getByRole('alert').filter({ hasText: CONNECT_ERROR });
    await expect(connectAlert).toHaveCount(0);

    // Evidencia visual: el editor del sitio cargó las landings de escobar al cambiar
    // de tenant, sin necesidad de navegar a "Captación" y volver.
    await page.screenshot({
      path: 'test-results/screenshots/site-editor-escobar-remount.png',
      fullPage: true,
    });
  });
  test('el editor del sitio carga landings sin error de conexión (dev-tenant)', async ({
    page,
  }) => {
    // Estado limpio: evita que la persistencia de Zustand contamine el test.
    await page.addInitScript(() => localStorage.clear());

    // Registro de respuestas de red para diagnóstico (qué devuelve el backend).
    const apiResponses: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/')) {
        apiResponses.push(`${response.status()} ${response.request().method()} ${url}`);
      }
    });

    // Registro de errores de consola del navegador (p. ej. CORS, red).
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Registro de peticiones fallidas a nivel de red.
    const requestFailures: string[] = [];
    page.on('requestfailed', (request) => {
      requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`);
    });

    try {
      // Navegamos por `127.0.0.1` (NO `localhost`) para reproducir EXACTAMENTE el
      // origen que usa el navegador real del usuario. El backend debe permitir ese
      // origen en CORS; si no, el navegador bloquea las respuestas de la API con
      // error CORS y la UI muestra "No se pudo conectar con el servidor".
      // `domcontentloaded` evita flakes de `load` (Monaco y fuentes retrasan `load`).
      await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });

      // Cabecera con la configuración real del entorno de desarrollo.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('OmniBotIA Studio');

      // PASO 1 - El selector de tenant está visible y preselecciona dev-tenant.
      const tenantSelect = page.getByRole('combobox', { name: TENANT_SELECT });
      await expect(tenantSelect).toBeVisible({ timeout: 15000 });
      await expect(tenantSelect).toHaveValue(DEV_TENANT);

      // PASO 2 - El selector unificado del sitio está presente.
      const siteSelect = page.locator(`#${SITE_PAGE_SELECT}`);
      await expect(siteSelect).toBeVisible();

      // PASO 3 - El selector se habilita: significa que `loadLists()` terminó sin
      // error (status != 'error'). Si el backend estuviera caído, quedaría disabled
      // y se mostraría el alerta de error.
      await expect(siteSelect).toBeEnabled({ timeout: 15000 });

      // PASO 4 - NO debe aparecer el alerta de error de conexión.
      const connectAlert = page.getByRole('alert').filter({ hasText: CONNECT_ERROR });
      await expect(connectAlert).toHaveCount(0);

      // PASO 5 - La landing «Inicio (Landing)» está disponible en el selector.
      await expect(
        siteSelect.locator('option', { hasText: 'Inicio (Landing)' }),
      ).toHaveCount(1);

      // Evidencia visual del editor del sitio cargado correctamente.
      await page.screenshot({
        path: 'test-results/screenshots/site-editor-connected.png',
        fullPage: true,
      });
    } finally {
      // Diagnóstico: imprimir las respuestas API, errores de consola y fallos de red.
      // eslint-disable-next-line no-console
      console.log('API responses:\n' + (apiResponses.join('\n') || '(ninguna)'));
      // eslint-disable-next-line no-console
      console.log('Console errors:\n' + (consoleErrors.join('\n') || '(ninguno)'));
      // eslint-disable-next-line no-console
      console.log('Request failures:\n' + (requestFailures.join('\n') || '(ninguno)'));
    }
  });
});
