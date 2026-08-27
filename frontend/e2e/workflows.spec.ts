/**
 * Tests E2E del subsistema de workflows: flujos completos contra el backend real.
 *
 * Contrato:
 * - "Checkout Directo": crear un checkout sandbox (estado `requires_confirmation`)
 *   con su URL de pago y confirmar el pago (estado `succeeded`).
 * - "Captura de Leads": registrar un prospecto y ver el resumen con origen.
 * - "Generador de Cotizaciones": calcular totales con líneas dinámicas + enlace PDF.
 * - "Agendador de Citas": agendar una cita con zona horaria + invitación ICS.
 *
 * Dependencias del entorno:
 * - Backend en `VITE_API_BASE_URL` (http://localhost:8000) con el tenant `dev-tenant`.
 * - Los estados provienen del dominio del backend (sandbox determinista):
 *   checkout `requires_confirmation`/`succeeded`, lead `new`, quote `draft`,
 *   cita `scheduled`.
 */
import { expect, test, type Page } from '@playwright/test';

/** Constantes de contrato de la UI (nombres accesibles estables). */
const RIGHT_PANEL_TABLIST = 'Panel derecho del editor';
const WORKFLOW_TABLIST = 'Tipos de workflow';

/** Nombres de los workflows (definiciones de WORKFLOW_DEFINITIONS). */
const WORKFLOWS = {
  checkout: 'Checkout Directo',
  lead: 'Captura de Leads',
  quote: 'Generador de Cotizaciones',
  appointment: 'Agendador de Citas',
} as const;

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

test.describe('Workflows (E2E)', () => {
  test.beforeEach(async ({ context, page }) => {
    // Estado limpio: evita que la persistencia de Zustand contamine los tests.
    await context.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await openWorkflowsPanel(page);
  });

  test('flujo completo de checkout directo: crear y confirmar pago sandbox', async ({ page }) => {
    // El tablist de workflows arranca en "Checkout Directo".
    const form = page.getByRole('tabpanel', { name: WORKFLOWS.checkout });

    await form.getByLabel('Monto').fill('99.50');
    await form.getByLabel('Moneda').selectOption('mxn');
    await form.getByLabel('Correo del cliente (opcional)').fill('cliente@ejemplo.com');
    await form.getByLabel('Nombre del cliente (opcional)').fill('Cliente Demo');

    // Crear el checkout: la pasarela sandbox devuelve requires_confirmation.
    await form.getByRole('button', { name: 'Crear checkout' }).click();
    await expect(form.getByText('Checkout requires_confirmation · sandbox')).toBeVisible();
    await expect(form.getByText(/^ID: /)).toBeVisible();

    const payLink = form.getByRole('link', { name: 'Abrir página de pago' });
    await expect(payLink).toBeVisible();
    await expect(payLink).toHaveAttribute('href', /http:\/\/localhost:8000\/workflows\/sandbox\//);

    // Confirmar el pago sandbox (idempotente): pasa a succeeded.
    await form.getByRole('button', { name: 'Confirmar pago (sandbox)' }).click();
    await expect(form.getByText('Pago confirmado: succeeded')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/workflows-checkout.png',
      fullPage: true,
    });
  });

  test('captura un lead y muestra el resumen con origen', async ({ page }) => {
    await openWorkflow(page, WORKFLOWS.lead);
    const form = page.getByRole('tabpanel', { name: WORKFLOWS.lead });

    await form.getByLabel('Nombre').fill('Ana Pérez');
    await form.getByLabel('Correo').fill('ana@example.com');
    await form.getByLabel('Teléfono (opcional)').fill('+52 55 1234 5678');
    await form.getByLabel('Origen').selectOption('facebook');

    await form.getByRole('button', { name: 'Capturar lead' }).click();
    await expect(form.getByText('Lead new · origen facebook')).toBeVisible();
    await expect(form.getByText(/Ana Pérez · ana@example\.com/)).toBeVisible();
    await expect(form.getByText(/^ID: /)).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/workflows-lead.png', fullPage: true });
  });

  test('genera una cotización con líneas dinámicas y enlace al PDF', async ({ page }) => {
    await openWorkflow(page, WORKFLOWS.quote);
    const form = page.getByRole('tabpanel', { name: WORKFLOWS.quote });

    await form.getByLabel('Nombre del cliente').fill('Cliente Demo');
    await form.getByLabel('Correo del cliente (opcional)').fill('cliente@example.com');
    await form.getByLabel('Moneda').selectOption('mxn');

    // Primera línea.
    await form.getByLabel('Nombre de la línea 1').fill('Consultoría');
    await form.getByLabel('Cantidad de la línea 1').fill('1');
    await form.getByLabel('Precio unitario de la línea 1').fill('100');

    // Segunda línea (flujo dinámico "Agregar línea").
    await form.getByRole('button', { name: 'Agregar línea' }).click();
    await form.getByLabel('Nombre de la línea 2').fill('Soporte');
    await form.getByLabel('Cantidad de la línea 2').fill('2');
    await form.getByLabel('Precio unitario de la línea 2').fill('25.50');

    // Tasa de impuesto por defecto (1600 bps = 16 %).
    await form.getByLabel(/Tasa de impuesto/).fill('1600');

    await form.getByRole('button', { name: 'Generar cotización' }).click();
    await expect(form.getByText('Cotización draft · MXN')).toBeVisible();
    await expect(form.getByText(/Subtotal /)).toBeVisible();
    await expect(form.getByText(/^ID: /)).toBeVisible();
    await expect(form.getByRole('link', { name: 'Abrir PDF de la cotización' })).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/workflows-quote.png', fullPage: true });
  });

  test('agenda una cita y muestra el enlace de invitación ICS', async ({ page }) => {
    await openWorkflow(page, WORKFLOWS.appointment);
    const form = page.getByRole('tabpanel', { name: WORKFLOWS.appointment });

    await form.getByLabel('Servicio').fill('Consulta inicial');
    await form.getByLabel('Fecha y hora').fill('2030-01-15T10:00');
    await form.getByLabel('Duración').selectOption('60');
    await form.getByLabel('Zona horaria').selectOption('America/Mexico_City');
    await form.getByLabel('Nombre del cliente').fill('Ana Torres');
    await form.getByLabel('Correo del cliente (opcional)').fill('ana@example.com');
    await form.getByLabel('Teléfono (opcional)').fill('+52 55 9876 5432');

    await form.getByRole('button', { name: 'Agendar cita' }).click();
    await expect(form.getByText('Cita scheduled · America/Mexico_City')).toBeVisible();
    await expect(form.getByText(/^ID: /)).toBeVisible();
    await expect(form.getByRole('link', { name: 'Descargar invitación (.ics)' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/workflows-appointment.png',
      fullPage: true,
    });
  });
});
