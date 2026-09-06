/**
 * Tests E2E del configurador del bot (Fase 2): CRUD real contra el backend.
 *
 * Contrato:
 * - Cabecera: el botón "Configuración" queda resaltado con `aria-pressed` cuando el
 *   configurador está activo, con subtítulo "Configuración del bot" y tablist accesible.
 * - Pestañas: Apariencia (por defecto), Contenido, Catálogo y Canales. Los paneles
 *   permanecen montados y se ocultan con `hidden` para preservar los borradores.
 * - Apariencia: cambiar la tipografía y guardar muestra "Apariencia guardada.".
 * - Contenido: crear un ítem FAQ y verlo en "Ítems de contenido".
 * - Catálogo: crear un ítem y ver el precio formateado "MXN 99.90" y "Disponible".
 * - Canales: conectar WhatsApp (secretos write-only) y ver "Conectado".
 *
 * Dependencias del entorno:
 * - Backend en `VITE_API_BASE_URL` (http://localhost:8000) con el tenant `dev-tenant`.
 * - Feature-gate `appearance` activado (`.env.development` con VITE_FEATURE_APPEARANCE=true).
 * - Identificadores únicos por ejecución (timestamp) porque el CRUD persiste en el backend.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers';

/** Constantes de contrato de la UI (nombres accesibles estables). */
const SETTINGS_TABLIST = 'Configuración del bot';

/** Nombres de las pestañas del configurador (definición TABS de TenantConfigSettings). */
const TABS = {
  appearance: 'Apariencia',
  content: 'Contenido',
  catalog: 'Catálogo',
  channels: 'Canales',
} as const;

/** Abre el configurador del bot desde la cabecera del editor. */
async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Configuración' }).click();
  await expect(page.getByText(SETTINGS_TABLIST, { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: SETTINGS_TABLIST })).toBeVisible();
}

/** Activa una pestaña del configurador y espera a que su tabpanel sea visible. */
async function openSettingsTab(page: Page, tabName: string): Promise<void> {
  await page
    .getByRole('tablist', { name: SETTINGS_TABLIST })
    .getByRole('tab', { name: tabName })
    .click();
  await expect(page.getByRole('tabpanel', { name: tabName })).toBeVisible();
}

test.describe('Configuración del tenant (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // Login real (RBAC): el flujo crea ítems de catálogo y conecta canales, lo
    // que requiere rol `admin` (la matriz asigna Catálogo/Canales/Bots al admin).
    await loginAs(page, 'admin');
    await openSettings(page);
  });

  test('cabecera del configurador: 4 pestañas y panel de apariencia por defecto', async ({
    page,
  }) => {
    // Cabecera en modo configuración: el botón "Configuración" queda resaltado (aria-pressed).
    await expect(page.getByRole('heading', { level: 1, name: 'OmniBotIA Studio' })).toBeVisible();
    // El selector de tenant está visible y preselecciona el tenant activo (dev-tenant).
    const tenantSelect = page.getByRole('combobox', { name: 'Tenant activo' });
    await expect(tenantSelect).toBeVisible();
    await expect(tenantSelect).toHaveValue('dev-tenant');
    const settingsButton = page.getByRole('button', { name: 'Configuración' });
    await expect(settingsButton).toBeVisible();
    await expect(settingsButton).toHaveAttribute('aria-pressed', 'true');

    // Tablist con las 4 pestañas y la apariencia activa por defecto.
    const tablist = page.getByRole('tablist', { name: SETTINGS_TABLIST });
    await expect(tablist.getByRole('tab', { name: TABS.appearance })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const tabName of [TABS.content, TABS.catalog, TABS.channels]) {
      await expect(tablist.getByRole('tab', { name: tabName })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    }
    await expect(page.getByRole('tabpanel', { name: TABS.appearance })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Apariencia / Branding' }),
    ).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/tenant-config-settings.png',
      fullPage: true,
    });
  });

  test('apariencia: cambia la tipografía y confirma el guardado', async ({ page }) => {
    const panel = page.getByRole('tabpanel', { name: TABS.appearance });
    const fontFamily = `Inter, system-ui, e2e-${Date.now()}`;

    await panel.getByLabel('Tipografía').fill(fontFamily);
    const save = panel.getByRole('button', { name: 'Guardar apariencia' });
    await expect(save).toBeEnabled();
    await save.click();

    await expect(panel.getByText('Apariencia guardada.')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/tenant-config-appearance.png',
      fullPage: true,
    });
  });

  test('contenido: crea un ítem FAQ y lo muestra en la base de conocimientos', async ({ page }) => {
    await openSettingsTab(page, TABS.content);
    const panel = page.getByRole('tabpanel', { name: TABS.content });
    const title = `FAQ E2E ${Date.now()}`;

    await panel.getByLabel('Tipo').selectOption('faq');
    await panel.getByLabel('Título').fill(title);
    await panel.getByLabel('Respuesta / cuerpo').fill('Respuesta generada por el test E2E.');
    await panel.getByLabel('Etiquetas (separadas por comas)').fill('e2e, faq');
    await panel.getByRole('button', { name: 'Crear ítem' }).click();

    const itemCard = page.locator('li').filter({ hasText: title });
    await expect(itemCard).toBeVisible();
    await expect(itemCard.getByText('Pregunta frecuente (FAQ)')).toBeVisible();
    await expect(itemCard.getByText(title)).toBeVisible();
    // `exact: true` evita el choque con el título ("FAQ E2E …" contiene "e2e").
    await expect(itemCard.getByText('e2e', { exact: true })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/tenant-config-content.png',
      fullPage: true,
    });
  });

  test('catálogo: crea un ítem con precio formateado y disponibilidad', async ({ page }) => {
    await openSettingsTab(page, TABS.catalog);
    const panel = page.getByRole('tabpanel', { name: TABS.catalog });
    const sku = `SKU-E2E-${Date.now()}`;
    const name = 'Producto E2E';

    await panel.getByLabel('SKU').fill(sku);
    await panel.getByLabel('Nombre').fill(name);
    await panel.getByLabel('Descripción').fill('Ítem creado por el test E2E del catálogo.');
    await panel.getByLabel('Precio').fill('99.90');
    await panel.getByLabel('Moneda').fill('MXN');
    await panel.getByRole('button', { name: 'Crear ítem' }).click();

    const itemCard = page.locator('li').filter({ hasText: sku });
    await expect(itemCard).toBeVisible();
    await expect(itemCard.getByText('Disponible')).toBeVisible();
    await expect(itemCard.getByText(name)).toBeVisible();
    await expect(itemCard.getByText('MXN 99.90')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/tenant-config-catalog.png',
      fullPage: true,
    });
  });

  test('canales: conecta WhatsApp y muestra el canal en la lista', async ({ page }) => {
    await openSettingsTab(page, TABS.channels);
    const panel = page.getByRole('tabpanel', { name: TABS.channels });
    const phone = `52155${String(Date.now()).slice(-8)}`;
    // external_id único por ejecución: el backend exige unicidad por tipo de canal,
    // por lo que un valor fijo chocaría con canales creados en ejecuciones previas.
    const externalId = `negocio-e2e-${Date.now()}`;

    await panel.getByLabel(/Número de teléfono/).fill(phone);
    await panel.getByLabel('Identificador externo').fill(externalId);
    await panel.getByLabel('ID del número de teléfono (Meta)').fill('10293847561234567');
    await panel.getByLabel('Token de acceso').fill('EAAG-e2e-token');
    await panel.getByLabel('Secreto del webhook').fill('e2e-secreto');
    await panel.getByRole('button', { name: 'Conectar canal' }).click();

    const channelCard = page.locator('li').filter({ hasText: phone });
    await expect(channelCard).toBeVisible();
    await expect(channelCard.getByText('Conectado')).toBeVisible();
    await expect(channelCard.getByText('WhatsApp')).toBeVisible();
    await expect(channelCard.getByText(phone)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/tenant-config-channels.png',
      fullPage: true,
    });
  });
});
