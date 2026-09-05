/**
 * Tests E2E del editor de landings: flujos completos de usuario.
 *
 * Contrato:
 * - "Crear landing": agregar bloques desde la librería y verificar canvas + panel de código.
 * - Selección accesible de bloques con `aria-pressed`.
 * - Eliminación de bloques y su impacto en canvas y código compilado.
 * - Compilación: estructura del HTML generado (workflow, título, bloques y configuración).
 *
 * Nota: el panel de código renderiza Monaco Editor (`.monaco-editor`); los flujos de arrastre
 * (dnd-kit) se cubren a nivel de store (`canvasStore`) y con los tests unitarios del editor.
 */
import { expect, test } from '@playwright/test';

/** Nombres accesibles estables de los landmarks (contratos de la UI). */
const LIBRARY_LABEL = 'Librería de bloques';
const CODE_PANEL_LABEL = 'Editor de código';

test.describe('Editor de landings (E2E)', () => {
  test.beforeEach(async ({ context, page }) => {
    // Estado limpio: evita que la persistencia de Zustand contamine los tests.
    await context.addInitScript(() => localStorage.clear());
    // `domcontentloaded` evita flakes de `load`: Monaco y las fuentes retrasan el
    // evento `load` (visible en Firefox); las aserciones posteriores ya esperan
    // elementos y absorben la carga asíncrona de Monaco (patrón de bots.spec).
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('flujo completo: crea una landing con bloques y la refleja en canvas y código', async ({
    page,
  }) => {
    // Cabecera con la configuración real del entorno de desarrollo.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('OmniBotIA Studio');
    // El selector de tenant está visible y preselecciona el tenant activo (dev-tenant).
    await expect(page.getByRole('combobox', { name: 'Tenant activo' })).toHaveValue('dev-tenant');

    // Estado vacío inicial del canvas.
    const main = page.getByRole('main');
    await expect(
      main.getByText('Selecciona un bloque de la librería para comenzar.'),
    ).toBeVisible();

    // Agregar bloques desde la librería (flujo "crear landing").
    const library = page.getByRole('complementary', { name: LIBRARY_LABEL });
    await library.getByRole('button', { name: /Hero con Video/ }).click();
    await library.getByRole('button', { name: /Calculadora JS/ }).click();

    // Canvas: los bloques se renderizan con su configuración por defecto.
    await expect(main.getByText('¡Impulsa tu negocio!')).toBeVisible();
    await expect(main.getByText('Comprar ahora')).toBeVisible();
    await expect(main.getByText('Impuesto: 0.16 · Moneda: MXN')).toBeVisible();

    // Panel de código: representación compilada de la landing (Monaco Editor).
    const code = page
      .getByRole('complementary', { name: CODE_PANEL_LABEL })
      .locator('.monaco-editor');
    // Timeout ampliado: absorbe la carga asíncrona de Monaco y su worker.
    await expect(code).toContainText('block--hero', { timeout: 15000 });
    await expect(code).toContainText('block--calculator');
    await expect(code).toContainText('data-title="Nueva Landing"');

    // Evidencia visual del editor integrado (regla 0.1 del CLAUDE.md).
    await page.screenshot({ path: 'test-results/screenshots/editor-monaco.png', fullPage: true });
  });

  test('selecciona bloques en el canvas con botones accesibles (aria-pressed)', async ({
    page,
  }) => {
    const library = page.getByRole('complementary', { name: LIBRARY_LABEL });
    const main = page.getByRole('main');

    await library.getByRole('button', { name: /Hero con Video/ }).click();
    await library.getByRole('button', { name: /Calculadora JS/ }).click();

    const heroButton = main.getByRole('button', { name: 'Hero con Video', exact: true });
    const calculatorButton = main.getByRole('button', { name: 'Calculadora JS', exact: true });

    // Ningún bloque seleccionado al inicio.
    await expect(heroButton).toHaveAttribute('aria-pressed', 'false');
    await expect(calculatorButton).toHaveAttribute('aria-pressed', 'false');

    // Seleccionar el Hero: solo él queda presionado.
    await heroButton.click();
    await expect(heroButton).toHaveAttribute('aria-pressed', 'true');
    await expect(calculatorButton).toHaveAttribute('aria-pressed', 'false');

    // Cambiar la selección a la Calculadora.
    await calculatorButton.click();
    await expect(heroButton).toHaveAttribute('aria-pressed', 'false');
    await expect(calculatorButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('elimina un bloque y lo quita del canvas y del código compilado', async ({ page }) => {
    const library = page.getByRole('complementary', { name: LIBRARY_LABEL });
    const main = page.getByRole('main');
    const code = page
      .getByRole('complementary', { name: CODE_PANEL_LABEL })
      .locator('.monaco-editor');

    await library.getByRole('button', { name: /Hero con Video/ }).click();
    await library.getByRole('button', { name: /Calculadora JS/ }).click();
    await expect(main.locator('article')).toHaveCount(2);

    // Eliminar el primer bloque (Hero con Video).
    await main.locator('article').first().getByRole('button', { name: 'Eliminar' }).click();

    await expect(main.locator('article')).toHaveCount(1);
    await expect(main.getByText('¡Impulsa tu negocio!')).toBeHidden();
    await expect(main.getByText('Impuesto: 0.16 · Moneda: MXN')).toBeVisible();

    // El código compilado se actualiza en consecuencia.
    await expect(code).not.toContainText('block--hero');
    await expect(code).toContainText('block--calculator');
  });

  test('compila una landing con workflow, título, bloques y configuración', async ({ page }) => {
    const library = page.getByRole('complementary', { name: LIBRARY_LABEL });
    const code = page
      .getByRole('complementary', { name: CODE_PANEL_LABEL })
      .locator('.monaco-editor');

    await library.getByRole('button', { name: /Hero con Video/ }).click();
    await library.getByRole('button', { name: /Cuadrícula de Servicios/ }).click();

    // Cabecera comentada con workflow y campaña.
    await expect(code).toContainText(
      '<!-- OmniBotIA Studio | Workflow: direct_checkout | Campaign:  -->',
    );
    // Sección raíz con el título de la landing.
    await expect(code).toContainText('<section class="landing" data-title="Nueva Landing">');
    // Bloques con su clase canónica.
    await expect(code).toContainText('block--hero');
    await expect(code).toContainText('block--services_grid');
    // Configuración por defecto serializada como atributos de datos.
    await expect(code).toContainText('data-cta_text="Comprar ahora"');
    await expect(code).toContainText('data-layout="grid_3col"');
    // Cada instancia expone un UUIDv4 válido.
    await expect(code).toContainText(
      /data-instance-id="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/,
    );
  });
});
