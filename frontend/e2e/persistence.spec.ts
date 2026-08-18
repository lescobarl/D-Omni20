/**
 * Tests E2E de persistencia del editor (Zustand `persist` en localStorage).
 *
 * Contrato:
 * - La landing en edición se persiste en `localStorage` bajo la clave `omnibotia-editor`.
 * - Tras recargar la página, el estado restaurado coincide con el guardado.
 */
import { expect, test } from '@playwright/test';

test.describe('Persistencia del editor (E2E)', () => {
  test('persiste la landing entre recargas de página', async ({ page }) => {
    // Estado limpio antes de iniciar el flujo.
    await page.goto('/');
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

    // El código compilado también refleja el estado persistido.
    const code = page.getByRole('complementary', { name: 'Editor de código' }).locator('code');
    await expect(code).toContainText('block--hero');
  });
});
