/**
 * Tests E2E de rendimiento (smoke) para OmniBotIA Studio.
 *
 * Contrato:
 * - La aplicación carga y responde dentro de un presupuesto de tiempo acotado.
 * - Las interacciones del editor (agregar bloque → actualizar canvas) son fluidas.
 *
 * Los umbrales son generosos para evitar falsos positivos en entornos CI; su propósito
 * es detectar regresiones graves de rendimiento, no micro-optimizaciones.
 */
import { expect, test } from '@playwright/test';

/** Presupuesto de carga inicial de la aplicación (ms). */
const LOAD_BUDGET_MS = 5_000;
/** Presupuesto para una interacción del editor (ms). */
const INTERACTION_BUDGET_MS = 3_000;

test.describe('Rendimiento (E2E smoke)', () => {
  test('la aplicación carga y responde dentro de un presupuesto de tiempo', async ({ page }) => {
    // Arranque en frío (no presupuestado): en Vite la primera navegación dispara la
    // compilación on-demand del bundle y, en el run completo, compite con el resto de
    // workers paralelos. Medir ese coste de arranque daría falsos positivos en CI, así
    // que se usa como warm-up y el presupuesto se aplica a la carga en estado estable.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Medición en estado estable: recarga con la app ya compilada y caché activa.
    const loadStartedAt = Date.now();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const loadMs = Date.now() - loadStartedAt;
    expect(loadMs).toBeLessThan(LOAD_BUDGET_MS);

    // Interacción: agregar un bloque y esperar su renderizado en el canvas.
    const interactionStartedAt = Date.now();
    const library = page.getByRole('complementary', { name: 'Librería de bloques' });
    await library.getByRole('button', { name: /Hero con Video/ }).click();
    await expect(page.getByRole('main').getByText('¡Impulsa tu negocio!')).toBeVisible();
    const interactionMs = Date.now() - interactionStartedAt;
    expect(interactionMs).toBeLessThan(INTERACTION_BUDGET_MS);

    // El panel de código se actualiza de forma reactiva (Monaco Editor).
    const code = page
      .getByRole('complementary', { name: 'Editor de código' })
      .locator('.monaco-editor');
    // Timeout ampliado: absorbe la carga asíncrona de Monaco y su worker.
    await expect(code).toContainText('block--hero', { timeout: 15000 });
  });
});
