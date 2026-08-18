/**
 * Configuración de Playwright para los tests E2E de OmniBotIA Studio.
 *
 * Contrato:
 * - Apunta al servidor de desarrollo de Vite (puerto 5173) reutilizándolo si ya está activo.
 * - Ejecuta los tests sobre Chromium, Firefox y WebKit (cross-browser).
 * - Aplica presupuestos de tiempo (regla CLAUDE 0.0): 30s por test y 120s de arranque.
 */
import { defineConfig, devices } from '@playwright/test';

/** Puerto del servidor de desarrollo de Vite (alineado con `vite.config.ts`). */
const DEV_SERVER_PORT = 5173;
/** URL base contra la que se ejecutan los tests E2E. */
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
/** Comando para arrancar el servidor de desarrollo si no está activo. */
const DEV_SERVER_COMMAND = 'npm run dev';
/** Presupuesto de arranque del servidor (regla CLAUDE 0.0: máx. 120s). */
const WEB_SERVER_TIMEOUT_MS = 120_000;
/** Presupuesto por test (regla CLAUDE 0.0: máx. 30s). */
const TEST_TIMEOUT_MS = 30_000;

/**
 * Configuración raíz de Playwright.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    command: DEV_SERVER_COMMAND,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: WEB_SERVER_TIMEOUT_MS,
  },
});
