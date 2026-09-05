/**
 * Tests E2E de la sección Bots/Conversaciones (Fase 7): CRUD real contra el backend.
 *
 * Contrato:
 * - Cabecera: el botón "Configuración" alterna al configurador con 5 pestañas,
 *   incluyendo "Bots" (definición TABS de TenantConfigSettings).
 * - Proveedores de IA por empresa: crear con tipo, orden, modelo, temperatura y
 *   prompt base; ver la tarjeta con la insignia "Habilitado"; deshabilitar y
 *   habilitar; eliminar y ver el estado vacío.
 *
 * Dependencias del entorno:
 * - Backend en `VITE_API_BASE_URL` (http://localhost:8000) con el tenant `dev-tenant`.
 * - Feature-gate `bots` activado (`.env.development` con VITE_FEATURE_BOTS=true)
 *   para inyectar el servicio real en el composition root (main.tsx).
 * - Identificadores únicos por ejecución (timestamp) porque el CRUD persiste en el backend.
 */
import { expect, test, type Page } from '@playwright/test';

/** Constantes de contrato de la UI (nombres accesibles estables). */
const SETTINGS_TABLIST = 'Configuración del bot';

/** Nombres de las pestañas del configurador (definición TABS de TenantConfigSettings). */
const TABS = {
  appearance: 'Apariencia',
  content: 'Contenido',
  catalog: 'Catálogo',
  channels: 'Canales',
  bots: 'Bots',
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

test.describe('Sección Bots/Conversaciones (E2E)', () => {
  test.beforeEach(async ({ context, page }) => {
    // Estado limpio: evita que la persistencia de Zustand contamine los tests.
    await context.addInitScript(() => localStorage.clear());
    // `domcontentloaded` evita flakes de `load` (recursos como Monaco/fuentes pueden
    // retrasar el evento `load`); las aserciones siguientes ya esperan elementos.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openSettings(page);
  });

  test('bots: cabecera con 5 pestañas y sección Bots accesible', async ({ page }) => {
    // Tablist con las 5 pestañas y la apariencia activa por defecto.
    const tablist = page.getByRole('tablist', { name: SETTINGS_TABLIST });
    await expect(tablist.getByRole('tab', { name: TABS.appearance })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const tabName of [TABS.content, TABS.catalog, TABS.channels, TABS.bots]) {
      await expect(tablist.getByRole('tab', { name: tabName })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    }

    await openSettingsTab(page, TABS.bots);
    const panel = page.getByRole('tabpanel', { name: TABS.bots });

    await expect(panel.getByRole('heading', { level: 2, name: TABS.bots })).toBeVisible();
    await expect(panel.getByText('Proveedores configurados', { exact: true })).toBeVisible();
    await expect(panel.getByText('Conversaciones', { exact: true })).toBeVisible();
    await expect(panel.getByText('Monitor de cola D3', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Guardar proveedor' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/bots-section.png',
      fullPage: true,
    });
  });

  test('bots: crea, deshabilita y elimina un proveedor de IA', async ({ page }) => {
    await openSettingsTab(page, TABS.bots);
    const panel = page.getByRole('tabpanel', { name: TABS.bots });

    // Tipo único por ejecución: el backend persiste los proveedores y no impone
    // unicidad por tipo, pero un valor fijo colisionaría visualmente en la lista.
    // Base36 para respetar el límite de 16 caracteres del tipo (input maxLength,
    // columna String(16) y schema backend con max_length=16).
    const providerKind = `e2e-${Date.now().toString(36)}`;
    const model = 'gpt-4o-mini';
    const promptBase = `Prompt base E2E ${Date.now()}`;

    await panel.getByLabel('Tipo de proveedor *').fill(providerKind);
    await panel.getByLabel('Orden *').fill('1');
    await panel.getByLabel('Modelo').fill(model);
    await panel.getByLabel('Temperatura').fill('0.7');
    await panel.getByLabel('Prompt base').fill(promptBase);
    await panel.getByRole('button', { name: 'Guardar proveedor' }).click();

    // La tarjeta del proveedor muestra la insignia "Habilitado" y sus datos.
    const providerCard = panel.locator('li').filter({ hasText: providerKind });
    await expect(providerCard).toBeVisible();
    await expect(providerCard.getByText('Habilitado', { exact: true })).toBeVisible();
    await expect(providerCard.getByText(providerKind)).toBeVisible();
    await expect(providerCard.getByText(`Orden: 1 · Modelo: ${model}`)).toBeVisible();
    await expect(providerCard.getByText('Temperatura: 0.7')).toBeVisible();
    await expect(providerCard.getByText(promptBase)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/bots-provider-created.png',
      fullPage: true,
    });

    // Deshabilitar: la insignia cambia y el botón pasa a "Habilitar".
    await providerCard.getByRole('button', { name: 'Deshabilitar' }).click();
    await expect(providerCard.getByText('Deshabilitado', { exact: true })).toBeVisible();
    await expect(providerCard.getByRole('button', { name: 'Habilitar' })).toBeVisible();

    // Habilitar de nuevo: vuelve al estado "Habilitado".
    await providerCard.getByRole('button', { name: 'Habilitar' }).click();
    await expect(providerCard.getByText('Habilitado', { exact: true })).toBeVisible();

    // Eliminar: la tarjeta desaparece y se muestra el estado vacío.
    await providerCard.getByRole('button', { name: 'Eliminar' }).click();
    await expect(providerCard).not.toBeVisible();
    await expect(panel.getByText('Aún no hay proveedores de IA configurados.')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/bots-provider-deleted.png',
      fullPage: true,
    });
  });
});
