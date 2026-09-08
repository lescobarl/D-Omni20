/**
 * Tests E2E de persistencia del editor (Zustand `persist` en localStorage).
 *
 * Contrato:
 * - La landing en edición se persiste en `localStorage` bajo la clave `omnibotia-editor`.
 * - Tras recargar la página, el estado restaurado coincide con el guardado.
 */
import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

test.describe('Persistencia del editor (E2E)', () => {
  test('persiste la landing entre recargas de página', async ({ page }) => {
    // Login real (RBAC) para que el spec sea autocontenido en cualquier entorno.
    await loginAs(page, 'admin');
    // Estado limpio del editor antes de iniciar el flujo (no toca el token).
    await page.evaluate(() => localStorage.removeItem('omnibotia-editor'));
    await page.reload();

    // Agregar un bloque a la landing.
    const library = page.getByRole('complementary', { name: 'Librería de bloques' });
    await library.getByRole('button', { name: /Hero con Video/ }).click();
    const main = page.getByRole('main');
    await expect(main.getByText('¡Impulsa tu negocio!')).toBeVisible();

    // Recargar: el bloque debe restaurarse desde localStorage.
    await page.reload();
    await expect(main.getByText('¡Impulsa tu negocio!')).toBeVisible();
    await expect(main.getByText('Comprar ahora')).toBeVisible();

    // El código compilado también refleja el estado persistido (Monaco Editor).
    const code = page
      .getByRole('complementary', { name: 'Editor de código' })
      .locator('.monaco-editor');
    // Timeout ampliado: absorbe la carga asíncrona de Monaco y su worker.
    await expect(code).toContainText('block--hero', { timeout: 15000 });
  });
});
