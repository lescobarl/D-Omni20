/**
 * FASE G - Item 15 - Cadena de construcción comercial (E2E UI sobre el tenant `escobar`).
 *
 * Complementa el script API determinista `backend/scripts/faseg_e2e_chain.py` validando
 * la MISMA cadena a través de la UI real (Playwright) sobre el tenant `escobar`, que
 * contiene datos reales de la Inmobiliaria Escobar:
 *
 *   - Landing real: "Casa vista al lago Tequesquitengo"
 *     (id 2dd39716-8fc3-4e85-869e-0b644b0e1938, campaign_id 65233ed5-...).
 *
 * Cadena validada (pasos):
 *   1. Seleccionar el tenant `escobar` en el selector de tenant.
 *   2. En el editor, abrir la landing real, editarla (cambio benigno) y publicarla.
 *   3. En "Captación" (ads), crear una campaña publicitaria apuntando a la landing real.
 *   4. En el panel derecho del editor, abrir el workflow "Captura de Leads".
 *   5. Capturar un lead con contexto (la landing real tiene campaign_id -> se adjunta
 *      {landing_id, campaign_id}) y verificar el resumen con origen.
 *   6. En "Operación del bot" -> "Campañas", crear una campaña de recompra vinculada a
 *      la landing real (GAP-12) y verificar la insignia "Origen: ...".
 *   7. Limpieza: eliminar SOLO las entidades creadas por este run (ads y campaña).
 *
 * Restricciones de arquitectura tenidas en cuenta:
 *   - El tenant activo se guarda SOLO en memoria (tenantContext), NO en localStorage.
 *     Un recargo de página lo reinicia a `dev-tenant`. Por eso NO se recarga la página
 *     tras seleccionar `escobar`; en su lugar se alterna entre vistas para forzar el
 *     remontaje de los componentes (cada vista carga sus datos en useEffect con []).
 *   - El editor (LandingEditor) es la vista por defecto y se monta al cargar con
 *     `dev-tenant`. Para cargar las landings de `escobar` hay que remontarlo: se navega
 *     a "Captación" y se vuelve al editor.
 *   - La captura de leads lee `useCurrentLanding()` del store del editor, por lo que la
 *     landing real debe estar cargada en el editor para que se adjunte el contexto.
 *
 * Dependencias del entorno:
 *   - Backend en `VITE_API_BASE_URL` (http://localhost:8000) con el tenant `escobar`.
 *   - Feature-gates `ads` y `operations` activados en `.env.development`.
 *   - La landing real NO se borra ni se renombra de forma destructiva: solo se edita su
 *     título de forma benigna y se vuelve a publicar (round-trip real).
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers';

/** Constantes de contrato de la UI (nombres accesibles estables). */
const TENANT_SELECT = 'Tenant activo';
const ESCOBAR_SLUG = 'escobar';
const LANDING_NAME = 'Casa vista al lago Tequesquitengo';
const LANDING_ID = '2dd39716-8fc3-4e85-869e-0b644b0e1938';

const RIGHT_PANEL_TABLIST = 'Panel derecho del editor';
const WORKFLOW_TABLIST = 'Tipos de workflow';
const OPERATIONS_TABLIST = 'Operación del bot';

/** Directorio de evidencias (relativo al cwd del runner = frontend). */
const EVIDENCE_DIR = '../docs/evidencia-faseG';

/** Sufijo único por run para las entidades creadas (evita colisiones). */
const stamp = Date.now();
const adName = `FaseG UI Ad ${stamp}`;
const campaignName = `FaseG UI Recompra ${stamp}`;
const leadEmail = `faseg-ui-${stamp}@example.com`;

/** Abre el panel de Workflows en el panel derecho del editor. */
async function openWorkflowsPanel(page: Page): Promise<void> {
  await page
    .getByRole('tablist', { name: RIGHT_PANEL_TABLIST })
    .getByRole('tab', { name: 'Workflows' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Workflows' })).toBeVisible();
}

/** Activa un workflow en el tablist interno y devuelve su tabpanel activo. */
async function openWorkflow(page: Page, tabName: string): Promise<void> {
  await page
    .getByRole('tablist', { name: WORKFLOW_TABLIST })
    .getByRole('tab', { name: tabName })
    .click();
  await expect(page.getByRole('tabpanel', { name: tabName })).toBeVisible();
}

/** Abre el área de operación desde la cabecera del editor. */
async function openOperationsArea(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Operación del bot' }).click();
  await expect(page.getByRole('tablist', { name: OPERATIONS_TABLIST })).toBeVisible();
}

/** Activa una pestaña del área de operación y espera a que su tabpanel sea visible. */
async function openOperationsTab(page: Page, tabName: string): Promise<void> {
  await page
    .getByRole('tablist', { name: OPERATIONS_TABLIST })
    .getByRole('tab', { name: tabName })
    .click();
  await expect(page.getByRole('tabpanel', { name: tabName })).toBeVisible();
}

test.describe('FASE G - Cadena de construcción comercial (tenant escobar)', () => {
  test.beforeEach(async ({ page }) => {
    // Login real (RBAC): la cadena opera el tenant `escobar`, visible para el
    // super-admin (el admin de referencia solo tiene membresía en dev-tenant).
    // Autocontenido sin `storageState` (funciona en local y en CI).
    await loginAs(page, 'superadmin');
  });

  test('cadena completa: landing -> ads -> lead con contexto -> recompra (escobar)', async ({
    page,
  }) => {
    // ---------------------------------------------------------------------
    // PASO 1 - Seleccionar el tenant `escobar`.
    // ---------------------------------------------------------------------
    await test.step('PASO 1: seleccionar el tenant escobar', async () => {
      const tenantSelect = page.getByLabel(TENANT_SELECT);
      await expect(tenantSelect).toBeVisible();
      await tenantSelect.selectOption(ESCOBAR_SLUG);
      await expect(tenantSelect).toHaveValue(ESCOBAR_SLUG);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/faseg-1-tenant-escobar.png`,
        fullPage: true,
      });
    });

    // ---------------------------------------------------------------------
    // PASO 2 - Remontar el editor para cargar las landings de escobar y
    //          editar + publicar la landing real.
    // ---------------------------------------------------------------------
    await test.step('PASO 2: editar y publicar la landing real en escobar', async () => {
      // El editor se montó al cargar con dev-tenant. Alternamos a "Captación" y
      // volvemos para forzar el remontaje con el tenant escobar (sin recargar).
      await page.getByRole('button', { name: 'Captación' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Captación publicitaria' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Sitio' }).click();

      // La landing real debe estar disponible en el selector unificado del sitio
      // (SiteEditor). El selector agrupa landing + páginas del portal; las landings
      // usan valores con prefijo `landing:`.
      const siteSelect = page.locator('#site-page-select');
      await expect(siteSelect).toBeVisible();
      // Nota: las <option> de un <select> cerrado se consideran "hidden" por
      // Playwright (solo son visibles con el desplegable abierto). Validamos que
      // la opción exista (count) y que al seleccionarla el <select> tome su valor.
      await expect(siteSelect.locator('option', { hasText: LANDING_NAME })).toHaveCount(1);
      await siteSelect.selectOption(`landing:${LANDING_ID}`);
      await expect(siteSelect).toHaveValue(`landing:${LANDING_ID}`);

      // La landing se carga en el store del editor (con campaign_id).
      // Nota: hay varios role="status" en la página (el sr-only de la cabecera y el
      // del editor); filtramos por el texto del editor para evitar violación de strict mode.
      const editorStatus = page.getByRole('status').filter({ hasText: 'Landing' });
      // El mensaje de carga incluye el nombre real: "Landing «Casa vista al lago
      // Tequesquitengo» cargada." — validamos solo el sufijo "cargada".
      await expect(editorStatus).toContainText('cargada');

      // Edición benigna del título (round-trip real de guardado).
      // Nota: el input muestra `config.title` de la landing, que en los datos reales
      // de escobar difiere del `name` de la fila ("Casa con vista al lago ..." vs
      // "Casa vista al lago ..."). No asumimos el valor inicial: solo comprobamos que
      // el input esté habilitado (la landing ya se cargó, verificado por el status).
      const titleInput = page.locator('#landing-title');
      await expect(titleInput).toBeEnabled();
      await titleInput.fill(`${LANDING_NAME} (FaseG UI ${stamp})`);
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(editorStatus).toContainText('Landing guardada.');

      // Publicar la landing real.
      await page.getByRole('button', { name: 'Publicar' }).click();
      await expect(editorStatus).toContainText('Landing publicada.');

      // Restaurar el título original para no dejar la landing real renombrada y para
      // que los pasos siguientes (ads/operaciones) sigan seleccionándola por LANDING_NAME.
      await titleInput.fill(LANDING_NAME);
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(editorStatus).toContainText('Landing guardada.');

      await page.screenshot({
        path: `${EVIDENCE_DIR}/faseg-2-landing-publicada.png`,
        fullPage: true,
      });
    });

    // ---------------------------------------------------------------------
    // PASO 3 - Crear una campaña publicitaria (ads) apuntando a la landing real.
    // ---------------------------------------------------------------------
    await test.step('PASO 3: crear campaña publicitaria (ads) hacia la landing real', async () => {
      await page.getByRole('button', { name: 'Captación' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Captación publicitaria' }),
      ).toBeVisible();

      const form = page.getByRole('form', { name: 'Crear campaña' });
      await expect(form).toBeVisible();

      // El selector de landing de destino debe ofrecer la landing real.
      const landingDest = form.getByLabel('Landing de destino');
      // Nota: las <option> de un <select> cerrado se consideran "hidden" por
      // Playwright (solo son visibles con el desplegable abierto). Validamos que
      // la opción exista (count) y que al seleccionarla el <select> tome su valor.
      await expect(landingDest.locator('option', { hasText: LANDING_NAME })).toHaveCount(1);
      await landingDest.selectOption({ label: LANDING_NAME });
      await expect(landingDest).toHaveValue(LANDING_ID);

      await form.getByLabel('Nombre').fill(adName);
      await form.getByLabel('UTM Fuente').fill('meta');
      await form.getByLabel('UTM Medio').fill('cpc');
      await form.getByLabel('UTM Campaña').fill(`faseg-ui-${stamp}`);
      await form.getByLabel('UTM Contenido').fill('banner');
      await form.getByLabel('UTM Término').fill('lago');
      await form.getByLabel('Presupuesto (centavos)').fill('150000');
      await form.getByRole('button', { name: 'Crear campaña' }).click();

      // La campaña aparece en la lista con su UTM.
      const adItem = page.locator('li', { hasText: adName });
      await expect(adItem).toBeVisible();
      await expect(adItem.getByText(`faseg-ui-${stamp}`)).toBeVisible();

      await page.screenshot({
        path: `${EVIDENCE_DIR}/faseg-3-ads-creada.png`,
        fullPage: true,
      });
    });

    // ---------------------------------------------------------------------
    // PASO 4 + 5 - Abrir el workflow "Captura de Leads" y capturar un lead
    //              con contexto (la landing real tiene campaign_id).
    // ---------------------------------------------------------------------
    await test.step('PASO 4+5: capturar un lead con contexto (landing/campaign)', async () => {
      // Volver al editor. Al remontar, el editor se monta limpio (sin landing
      // seleccionada), así que hay que volver a cargar la landing real en el store
      // para que la captura de leads adjunte el contexto {landing_id, campaign_id}.
      await page.getByRole('button', { name: 'Sitio' }).click();
      const siteSelect = page.locator('#site-page-select');
      await expect(siteSelect).toBeVisible();
      // Nota: las <option> de un <select> cerrado se consideran "hidden" por
      // Playwright (solo son visibles con el desplegable abierto). Validamos que
      // la opción exista (count) y que al seleccionarla el <select> tome su valor.
      await expect(siteSelect.locator('option', { hasText: LANDING_NAME })).toHaveCount(1);
      await siteSelect.selectOption(`landing:${LANDING_ID}`);
      await expect(siteSelect).toHaveValue(`landing:${LANDING_ID}`);
      const editorStatus = page.getByRole('status').filter({ hasText: 'Landing' });
      await expect(editorStatus).toContainText('cargada');

      await openWorkflowsPanel(page);
      await openWorkflow(page, 'Captura de Leads');

      // El contenedor del workflow es su tabpanel (mismo patrón que workflows.spec.ts).
      const leadPanel = page.getByRole('tabpanel', { name: 'Captura de Leads' });
      await leadPanel.getByLabel('Nombre').fill('FaseG UI Prospecto');
      await leadPanel.getByLabel('Correo').fill(leadEmail);
      await leadPanel.getByLabel('Teléfono (opcional)').fill('+52 55 1234 5678');
      await leadPanel.getByLabel('Origen').selectOption('facebook');
      await leadPanel.getByRole('button', { name: 'Capturar lead' }).click();

      // Resumen del lead con origen.
      await expect(leadPanel.getByText(/Lead new · origen facebook/)).toBeVisible();
      await expect(leadPanel.getByText(/FaseG UI Prospecto · faseg-ui-/)).toBeVisible();
      await expect(leadPanel.getByText(/^ID: /)).toBeVisible();

      // La landing real tiene campaign_id -> el lead queda atribuido por campaña.
      // La vista de atribución (LeadAttributionView) debe mostrar la fila de la campaña.
      await expect(leadPanel.getByText('Atribución por campaña (UTM)')).toBeVisible();

      await page.screenshot({
        path: `${EVIDENCE_DIR}/faseg-4-lead-contexto.png`,
        fullPage: true,
      });

      // Cierre del eslabón ② por UTM (navegación real de anuncio): se captura un
      // lead por HTTP con la firma UTM de la campaña recién creada (como haría la
      // landing publicada con `?utm_campaign=...`) y la vista de atribución debe
      // mostrar la fila de esa campaña tras recargar la vista.
      const token = await page.evaluate(
        () => localStorage.getItem('omnibotia-studio.access-token') ?? '',
      );
      const utmResponse = await page.request.post('http://127.0.0.1:8000/api/v1/workflows/lead', {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': 'escobar',
          'Content-Type': 'application/json',
        },
        data: {
          name: 'FaseG UTM Lead',
          email: `faseg-utm-${stamp}@example.com`,
          phone: '+52 55 0000 0001',
          source: 'landing',
          metadata: {
            utm_source: 'meta',
            utm_medium: 'cpc',
            utm_campaign: `faseg-ui-${stamp}`,
            utm_content: 'banner',
            utm_term: 'lago',
          },
        },
      });
      expect(utmResponse.ok()).toBeTruthy();
      const utmLead = await utmResponse.json();
      expect(utmLead.ad_campaign_id).toBeTruthy();

      // Reabre el workflow para remontar la vista de atribución (recarga el GET).
      await openWorkflow(page, 'Checkout Directo');
      await openWorkflow(page, 'Captura de Leads');
      const utmPanel = page.getByRole('tabpanel', { name: 'Captura de Leads' });
      await expect(utmPanel.getByText('Atribución por campaña (UTM)')).toBeVisible();
      const campaignRow = utmPanel.locator('tbody tr', { hasText: `faseg-ui-${stamp}` });
      await expect(campaignRow).toBeVisible();
    });

    // ---------------------------------------------------------------------
    // PASO 6 - Crear una campaña de recompra vinculada a la landing real (GAP-12).
    // ---------------------------------------------------------------------
    await test.step('PASO 6: crear campaña de recompra vinculada a la landing real', async () => {
      await openOperationsArea(page);
      await openOperationsTab(page, 'Campañas');

      const panel = page.getByRole('tabpanel', { name: 'Campañas' });
      const form = panel.getByRole('form', { name: 'Crear campaña' });
      await expect(form).toBeVisible();

      const landingOrigen = form.getByLabel('Landing / pasarela de origen');
      // Nota: las <option> de un <select> cerrado se consideran "hidden" por
      // Playwright (solo son visibles con el desplegable abierto). Validamos que
      // la opción exista (count) y que al seleccionarla el <select> tome su valor.
      await expect(landingOrigen.locator('option', { hasText: LANDING_NAME })).toHaveCount(1);
      await landingOrigen.selectOption({ label: LANDING_NAME });
      await expect(landingOrigen).toHaveValue(LANDING_ID);

      await form.getByLabel('Nombre').fill(campaignName);
      await form.getByRole('button', { name: 'Crear campaña' }).click();

      // La campaña aparece con la insignia "Origen: <landing real>".
      const campaignItem = panel.locator('li', { hasText: campaignName });
      await expect(
        campaignItem.getByRole('heading', { level: 3, name: campaignName }),
      ).toBeVisible();
      await expect(campaignItem.getByText(`Origen: ${LANDING_NAME}`)).toBeVisible();

      await page.screenshot({
        path: `${EVIDENCE_DIR}/faseg-5-recompra-creada.png`,
        fullPage: true,
      });
    });

    // ---------------------------------------------------------------------
    // PASO 7 - Limpieza: eliminar SOLO las entidades creadas por este run.
    // ---------------------------------------------------------------------
    await test.step('PASO 7: limpiar las entidades creadas (ads y campaña)', async () => {
      // Eliminar la campaña de recompra (Operación del bot -> Campañas).
      const panel = page.getByRole('tabpanel', { name: 'Campañas' });
      const campaignItem = panel.locator('li', { hasText: campaignName });
      page.once('dialog', (dialog) => void dialog.accept());
      await campaignItem.getByRole('button', { name: 'Eliminar' }).click();
      await expect(panel.locator('li', { hasText: campaignName })).toHaveCount(0);

      // Eliminar la campaña publicitaria (Captación).
      await page.getByRole('button', { name: 'Sitio' }).click();
      await page.getByRole('button', { name: 'Captación' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Captación publicitaria' }),
      ).toBeVisible();
      const adItem = page.locator('li', { hasText: adName });
      page.once('dialog', (dialog) => void dialog.accept());
      await adItem.getByRole('button', { name: 'Eliminar' }).click();
      await expect(page.locator('li', { hasText: adName })).toHaveCount(0);

      await page.screenshot({
        path: `${EVIDENCE_DIR}/faseg-6-limpieza.png`,
        fullPage: true,
      });
    });
  });
});
