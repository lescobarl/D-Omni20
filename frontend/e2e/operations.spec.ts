/**
 * Tests E2E de la sección "Operación del bot" — KPIs (B.1 Dashboard + B.2 Estadísticas),
 * campañas (B.4/C-2) y mantenimiento (B.9).
 *
 * Contrato:
 * - Cabecera: el botón "Operación del bot" alterna a la 3ª área con 9 pestañas,
 *   siendo "Dashboard" la activa por defecto (definición TABS de OperationsArea).
 * - Dashboard B.1: 6 KPIs de conversación, cuota L1, estado de la cola D3 y
 *   últimas conversaciones, cargados contra el backend real con RLS.
 * - Estadísticas B.2: 4 métricas resumen + ratio resuelto, serie por día y
 *   desglose por canal (misma fuente `GET /operations/stats/overview`).
 * - Campañas B.4/C-2: formulario con segmentación por etiquetas de contacto y
 *   disparo por evento (`checkout.created` — carrito abandonado). El E2E crea una
 *   campaña de recuperación con segmentación y disparo, verifica sus insignias en
 *   la lista, comprueba la persistencia por GET tras recargar, precarga la edición
 *   y la elimina al final (round-trip completo sobre la BD de desarrollo). La parte
 *   de envío del mensaje (disparo → envío → recuperación) queda cubierta por pytest
 *   (`test_campaign_dispatcher.py`) porque requiere el dispatcher + proveedor real.
 * - Mantenimiento B.9: cabecera con eslabón "Operación continua", 4 sub-pestañas
 *   internas (Estado/Limpieza/Optimización/Configuración), KPIs del estado y
 *   round-trip de configuración por PUT/GET. NO se ejecutan aquí la purga ni la
 *   optimización (operaciones pesadas sobre la BD de desarrollo compartida); su
 *   corrección queda cubierta por pytest (`test_maintenance_purge_returns_result` y
 *   `test_maintenance_optimize_returns_result` con BD temporal).
 *
 * Dependencias del entorno:
 * - Backend en `VITE_API_BASE_URL` (http://localhost:8000) con el tenant `dev-tenant`.
 * - Feature-gate `operations` activado (`.env.development` con VITE_FEATURE_OPERATIONS=true)
 *   para inyectar el servicio real en el composition root (main.tsx).
 * - Datos sembrados por `backend/scripts/seed_dev_ops.py` (idempotente): dos canales,
 *   dos conversaciones, tres mensajes y dos intervenciones con el marcador `e2e-kpi-`.
 *   Los valores numéricos exactos NO se asertan aquí (no son deterministas en la BD de
 *   desarrollo compartida); su corrección está cubierta por pytest `test_stats_overview_returns_aggregates`.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers';

/** Constantes de contrato de la UI (nombres accesibles estables). */
const OPERATIONS_TABLIST = 'Operación del bot';

/** Nombres de las pestañas del área de operación (definición TABS de OperationsArea). */
const TABS = {
  dashboard: 'Dashboard',
  stats: 'Estadísticas',
  trees: 'Árboles',
  campaigns: 'Campañas',
  templates: 'Plantillas',
  contacts: 'Contactos',
  intervention: 'Intervención Humana',
  monitor: 'Monitor',
  maintenance: 'Mantenimiento',
} as const;

/** KPIs del dashboard B.1 (definición DASHBOARD_METRICS de DashboardOperativo). */
const DASHBOARD_KPIS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'active_conversations', label: 'Conversaciones activas' },
  { key: 'inbound_messages', label: 'Mensajes entrantes' },
  { key: 'outbound_messages', label: 'Mensajes salientes' },
  { key: 'escalated', label: 'Escalados a humano' },
  { key: 'resolved', label: 'Resueltos por el bot' },
  { key: 'unique_contacts', label: 'Contactos únicos' },
];

/** Métricas resumen de estadísticas B.2 (definición STATS_METRICS de EstadisticasBot). */
const STATS_METRICS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'total_messages', label: 'Mensajes totales' },
  { key: 'escalated', label: 'Escalados a humano' },
  { key: 'resolved', label: 'Resueltos por el bot' },
  { key: 'unique_contacts', label: 'Contactos únicos' },
];

/** KPIs del estado del bot en Mantenimiento (definición ESTADO_METRICS de MantenimientoBot). */
const ESTADO_METRICS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'active_conversations', label: 'Conversaciones activas' },
  { key: 'inbound_messages', label: 'Mensajes entrantes' },
  { key: 'outbound_messages', label: 'Mensajes salientes' },
  { key: 'total_messages', label: 'Mensajes totales' },
  { key: 'escalated', label: 'Escalados a humano' },
  { key: 'resolved', label: 'Resueltos por el bot' },
  { key: 'unique_contacts', label: 'Contactos únicos' },
];

/** Etiquetas accesibles del formulario de campañas (B.4/C-2, definición CampaignsSection). */
const CAMPAIGN_FORM = {
  name: 'Nombre',
  segmentType: 'Segmentación',
  segmentTags: 'Etiquetas de contacto (separadas por coma)',
  segmentMatch: 'Coincidencia',
  triggerType: 'Disparo',
  triggerEvent: 'Evento de disparo',
} as const;

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

test.describe('Sección Operación del bot — KPIs (B.1 Dashboard + B.2 Estadísticas)', () => {
  test.beforeEach(async ({ page }) => {
    // Estado limpio UNA vez (no en cada recarga: `addInitScript` limpiaría el
    // token en los `page.reload()` de persistencia y devolvería a la pantalla
    // de login cuando la sesión solo vive en localStorage).
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Login real (RBAC) para que el spec sea autocontenido en cualquier entorno
    // (la config local no inyecta `storageState` como sí hace la config de CI).
    await loginAs(page, 'admin');
    await openOperationsArea(page);
  });

  test('operación: tablist con las 9 pantallas y Dashboard activo por defecto', async ({
    page,
  }) => {
    const tablist = page.getByRole('tablist', { name: OPERATIONS_TABLIST });
    await expect(tablist.getByRole('tab', { name: TABS.dashboard })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const tabName of [
      TABS.stats,
      TABS.trees,
      TABS.campaigns,
      TABS.templates,
      TABS.contacts,
      TABS.intervention,
      TABS.monitor,
      TABS.maintenance,
    ]) {
      await expect(tablist.getByRole('tab', { name: tabName })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    }

    const panel = page.getByRole('tabpanel', { name: TABS.dashboard });
    await expect(panel.getByRole('heading', { level: 2, name: TABS.dashboard })).toBeVisible();
    await expect(panel.getByText('Ciclo completo ①-⑨')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/operations-tabs.png',
      fullPage: true,
    });
  });

  test('operación: Dashboard B.1 con KPIs, cuota L1, cola D3 y últimas conversaciones', async ({
    page,
  }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.dashboard });

    await expect(panel.getByText('Resumen del periodo actual', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Recargar dashboard' })).toBeVisible();

    // 6 KPIs con su etiqueta y un valor numérico cargado desde el backend.
    for (const kpi of DASHBOARD_KPIS) {
      const card = panel.getByTestId(`kpi-${kpi.key}`);
      await expect(card).toBeVisible();
      await expect(card.getByText(kpi.label, { exact: true })).toBeVisible();
      await expect(card.locator('dd')).toHaveText(/\d/);
    }

    // Tarjetas de cuota L1, cola D3 y últimas conversaciones.
    const quotaCard = panel.getByTestId('quota-card');
    await expect(quotaCard).toBeVisible();
    await expect(quotaCard.getByRole('heading', { level: 3, name: 'Cuota L1' })).toBeVisible();

    const queueCard = panel.getByTestId('queue-card');
    await expect(queueCard).toBeVisible();
    await expect(
      queueCard.getByRole('heading', { level: 3, name: 'Estado de cola D3' }),
    ).toBeVisible();

    const conversationsCard = panel.getByTestId('conversations-card');
    await expect(conversationsCard).toBeVisible();
    await expect(
      conversationsCard.getByRole('heading', { level: 3, name: 'Últimas conversaciones' }),
    ).toBeVisible();
    // El seed garantiza conversaciones del tenant: al menos una fila listada.
    await expect(conversationsCard.locator('li').first()).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/operations-dashboard.png',
      fullPage: true,
    });
  });

  test('operación: Estadísticas B.2 con métricas, serie por día y desglose por canal', async ({
    page,
  }) => {
    await openOperationsTab(page, TABS.stats);
    const panel = page.getByRole('tabpanel', { name: TABS.stats });

    await expect(panel.getByRole('heading', { level: 2, name: TABS.stats })).toBeVisible();
    await expect(panel.getByText('Ciclo completo ①-⑨')).toBeVisible();
    await expect(panel.getByText('Resumen del periodo actual', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Recargar estadísticas' })).toBeVisible();

    // 4 métricas resumen con valor numérico cargado desde el backend.
    for (const metric of STATS_METRICS) {
      const card = panel.getByTestId(`stat-${metric.key}`);
      await expect(card).toBeVisible();
      await expect(card.getByText(metric.label, { exact: true })).toBeVisible();
      await expect(card.locator('dd')).toHaveText(/\d/);
    }

    // Ratio resuelto presentado como porcentaje.
    const ratioCard = panel.getByTestId('stat-resolved_ratio');
    await expect(ratioCard).toBeVisible();
    await expect(ratioCard.getByText('Ratio resuelto', { exact: true })).toBeVisible();
    await expect(ratioCard.locator('dd')).toHaveText(/%$/);

    // Serie por día: al menos una fila con fecha ISO válida. Los mensajes del seed
    // quedan fechados el día en que se sembraron; en DBs de desarrollo longevas el
    // «hoy» puede no tener mensajes, así que se valida la serie, no una fecha fija.
    const dailyTable = panel.getByTestId('daily-table');
    await expect(dailyTable).toBeVisible();
    await expect(
      dailyTable.getByRole('heading', { level: 3, name: 'Mensajes por día' }),
    ).toBeVisible();
    const dailyRows = dailyTable.locator('tbody tr');
    await expect(dailyRows).not.toHaveCount(0);
    const firstRowText = (await dailyRows.first().textContent()) ?? '';
    expect(firstRowText).toMatch(/\d{4}-\d{2}-\d{2}/);

    // Desglose por canal: al menos 2 filas (seed con whatsapp + instagram).
    const channelTable = panel.getByTestId('channel-table');
    await expect(channelTable).toBeVisible();
    await expect(
      channelTable.getByRole('heading', { level: 3, name: 'Mensajes por canal' }),
    ).toBeVisible();
    const channelRows = channelTable.locator('tbody tr');
    await expect(channelRows).not.toHaveCount(0);
    expect(await channelRows.count()).toBeGreaterThanOrEqual(2);

    await page.screenshot({
      path: 'test-results/screenshots/operations-stats.png',
      fullPage: true,
    });
  });
});

test.describe('Sección Operación del bot — Mantenimiento (B.9)', () => {
  test.beforeEach(async ({ page }) => {
    // Estado limpio UNA vez (no en cada recarga: `addInitScript` limpiaría el
    // token en los `page.reload()` de persistencia y devolvería a la pantalla
    // de login cuando la sesión solo vive en localStorage).
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Login real (RBAC) para que el spec sea autocontenido en cualquier entorno
    // (la config local no inyecta `storageState` como sí hace la config de CI).
    await loginAs(page, 'admin');
    await openOperationsArea(page);
    await openOperationsTab(page, TABS.maintenance);
  });

  test('operación: Mantenimiento B.9 con cabecera, eslabón y 4 sub-pestañas internas', async ({
    page,
  }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.maintenance });

    await expect(panel.getByRole('heading', { level: 2, name: TABS.maintenance })).toBeVisible();
    await expect(panel.getByText('Operación continua')).toBeVisible();

    const subtablist = panel.getByRole('tablist', { name: 'Mantenimiento' });
    await expect(subtablist.getByRole('tab', { name: 'Estado' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const tabName of ['Limpieza', 'Optimización', 'Configuración']) {
      await expect(subtablist.getByRole('tab', { name: tabName })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    }
    await expect(panel.getByRole('tabpanel', { name: 'Estado' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/operations-maintenance.png',
      fullPage: true,
    });
  });

  test('operación: Mantenimiento B.9 muestra los KPIs del estado del bot', async ({ page }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.maintenance });
    const estadoPanel = panel.getByRole('tabpanel', { name: 'Estado' });

    await expect(estadoPanel.getByRole('button', { name: 'Recargar estado' })).toBeVisible();

    for (const metric of ESTADO_METRICS) {
      const card = estadoPanel.getByTestId(`metric-${metric.key}`);
      await expect(card).toBeVisible();
      await expect(card.getByText(metric.label, { exact: true })).toBeVisible();
      await expect(card.locator('dd')).toHaveText(/\d/);
    }

    await page.screenshot({
      path: 'test-results/screenshots/operations-maintenance-estado.png',
      fullPage: true,
    });
  });

  test('operación: Mantenimiento B.9 persiste la configuración por PUT y la recarga por GET', async ({
    page,
  }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.maintenance });
    const subtablist = panel.getByRole('tablist', { name: 'Mantenimiento' });
    await subtablist.getByRole('tab', { name: 'Configuración' }).click();

    const form = panel.getByTestId('maintenance-form');
    await expect(form).toBeVisible();

    const retentionInput = form.getByTestId('retention-days');
    const scheduleInput = form.getByTestId('maintenance-schedule');
    await retentionInput.fill('60');
    await scheduleInput.fill('0 4 * * *');
    await form.getByRole('button', { name: 'Guardar configuración' }).click();

    // Tras el PUT, el formulario refleja los valores devueltos por el backend.
    await expect(retentionInput).toHaveValue('60');
    await expect(scheduleInput).toHaveValue('0 4 * * *');

    // Round-trip completo: una recarga debe devolver la configuración vía GET.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openOperationsArea(page);
    await openOperationsTab(page, TABS.maintenance);
    const reloadedPanel = page.getByRole('tabpanel', { name: TABS.maintenance });
    await reloadedPanel
      .getByRole('tablist', { name: 'Mantenimiento' })
      .getByRole('tab', { name: 'Configuración' })
      .click();
    const reloadedForm = reloadedPanel.getByTestId('maintenance-form');
    await expect(reloadedForm).toBeVisible();
    await expect(reloadedForm.getByTestId('retention-days')).toHaveValue('60');
    await expect(reloadedForm.getByTestId('maintenance-schedule')).toHaveValue('0 4 * * *');

    await page.screenshot({
      path: 'test-results/screenshots/operations-maintenance-config.png',
      fullPage: true,
    });
  });
});

test.describe('Sección Operación del bot — Campañas (B.4/C-2)', () => {
  test.beforeEach(async ({ page }) => {
    // Estado limpio UNA vez (no en cada recarga: `addInitScript` limpiaría el
    // token en los `page.reload()` de persistencia y devolvería a la pantalla
    // de login cuando la sesión solo vive en localStorage).
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Login real (RBAC) para que el spec sea autocontenido en cualquier entorno
    // (la config local no inyecta `storageState` como sí hace la config de CI).
    await loginAs(page, 'admin');
    await openOperationsArea(page);
    await openOperationsTab(page, TABS.campaigns);
  });

  test('operación: Campañas C-2 — cabecera, eslabones y campos de segmentación y disparo', async ({
    page,
  }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.campaigns });
    const form = panel.getByRole('form', { name: 'Crear campaña' });

    await expect(panel.getByRole('heading', { level: 2, name: TABS.campaigns })).toBeVisible();
    await expect(panel.getByText('Captación ① · Recuperación ⑦ · Recompra ⑨')).toBeVisible();

    // Formulario con los campos C-2 de segmentación y disparo presentes.
    await expect(form.getByLabel(CAMPAIGN_FORM.name)).toBeVisible();
    await expect(form.getByLabel(CAMPAIGN_FORM.segmentType)).toBeVisible();
    await expect(form.getByLabel(CAMPAIGN_FORM.triggerType, { exact: true })).toBeVisible();

    // Segmentación por etiquetas revela etiquetas y modo de coincidencia.
    await form.getByLabel(CAMPAIGN_FORM.segmentType).selectOption('tags');
    await expect(form.getByLabel(CAMPAIGN_FORM.segmentTags)).toBeVisible();
    await expect(form.getByLabel(CAMPAIGN_FORM.segmentMatch)).toBeVisible();

    // Disparo por evento revela el selector con los eventos de workflow (C-2).
    await form.getByLabel(CAMPAIGN_FORM.triggerType, { exact: true }).selectOption('event');
    const triggerEvent = form.getByLabel(CAMPAIGN_FORM.triggerEvent);
    await expect(triggerEvent).toBeVisible();
    await expect(triggerEvent).toContainText('checkout.created');
    await expect(triggerEvent).toContainText('payment.completed');

    await page.screenshot({
      path: 'test-results/screenshots/operations-campaigns-c2-form.png',
      fullPage: true,
    });
  });

  test('operación: Campañas C-2 — carrito abandonado → campaña → recuperación (crear, persistir y eliminar)', async ({
    page,
  }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.campaigns });
    const form = panel.getByRole('form', { name: 'Crear campaña' });
    const campaignName = `e2e-c2-carrito-abandonado-${Date.now()}`;

    // Crea la campaña de recuperación: segmentación por etiquetas + disparo por
    // evento `checkout.created` (carrito abandonado → recuperación ⑦).
    await form.getByLabel(CAMPAIGN_FORM.name).fill(campaignName);
    await form.getByLabel(CAMPAIGN_FORM.segmentType).selectOption('tags');
    await form.getByLabel(CAMPAIGN_FORM.segmentTags).fill('cliente, vip');
    await form.getByLabel(CAMPAIGN_FORM.segmentMatch).selectOption('any');
    await form.getByLabel(CAMPAIGN_FORM.triggerType, { exact: true }).selectOption('event');
    await form.getByLabel(CAMPAIGN_FORM.triggerEvent).selectOption('checkout.created');
    await form.getByRole('button', { name: 'Crear campaña' }).click();

    // La campaña aparece en la lista con estado, segmentación y disparo.
    const item = panel.locator('li', { hasText: campaignName });
    await expect(item.getByRole('heading', { level: 3, name: campaignName })).toBeVisible();
    await expect(item.getByText('Borrador', { exact: true })).toBeVisible();
    await expect(item.getByText('Etiquetas (cualquiera): cliente, vip')).toBeVisible();
    await expect(item.getByText('Disparo por evento: checkout.created')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/operations-campaigns-c2-list.png',
      fullPage: true,
    });

    // Persistencia: al recargar, la campaña se vuelve a obtener por GET.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openOperationsArea(page);
    await openOperationsTab(page, TABS.campaigns);
    const reloadedPanel = page.getByRole('tabpanel', { name: TABS.campaigns });
    const reloadedItem = reloadedPanel.locator('li', { hasText: campaignName });
    await expect(reloadedItem.getByRole('heading', { level: 3, name: campaignName })).toBeVisible();
    await expect(reloadedItem.getByText('Etiquetas (cualquiera): cliente, vip')).toBeVisible();
    await expect(reloadedItem.getByText('Disparo por evento: checkout.created')).toBeVisible();

    // Edición: precarga segmentación y disparo desde el backend.
    await reloadedItem.getByRole('button', { name: 'Editar' }).click();
    const editForm = reloadedPanel.getByRole('form', { name: 'Editar campaña' });
    await expect(editForm.getByLabel(CAMPAIGN_FORM.name)).toHaveValue(campaignName);
    await expect(editForm.getByLabel(CAMPAIGN_FORM.segmentType)).toHaveValue('tags');
    await expect(editForm.getByLabel(CAMPAIGN_FORM.segmentTags)).toHaveValue('cliente, vip');
    await expect(editForm.getByLabel(CAMPAIGN_FORM.segmentMatch)).toHaveValue('any');
    await expect(editForm.getByLabel(CAMPAIGN_FORM.triggerType, { exact: true })).toHaveValue(
      'event',
    );
    await expect(editForm.getByLabel(CAMPAIGN_FORM.triggerEvent)).toHaveValue('checkout.created');
    await editForm.getByRole('button', { name: 'Cancelar edición' }).click();

    // Limpieza: elimina la campaña y verifica que desaparece de la lista.
    await reloadedItem.getByRole('button', { name: 'Eliminar' }).click();
    await expect(reloadedPanel.locator('li', { hasText: campaignName })).toHaveCount(0);

    await page.screenshot({
      path: 'test-results/screenshots/operations-campaigns-c2-deleted.png',
      fullPage: true,
    });
  });
});
