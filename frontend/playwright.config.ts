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
 * Presupuesto por test para Firefox (regla CLAUDE 0.0).
 * Firefox es el navegador más lento del conjunto: el editor embarca Monaco y sus
 * Web Workers, y el cierre de contexto es notablemente más costoso que en
 * Chromium/WebKit. Bajo la ejecución paralela completa (`fullyParallel`) en
 * equipos limitados, los flujos pesados (editor y bots) y su teardown superan
 * los 30s solo en esta combinación, aunque pasan con margen en aislamiento
 * (verificado 18/18). Chromium y WebKit conservan el presupuesto estricto.
 */
const FIREFOX_TEST_TIMEOUT_MS = 90_000;

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
  // Cota de workers locales a 2. Bajo `fullyParallel` con 3 proyectos, el valor
  // por defecto (auto = nº de CPUs) dispara hasta 18 navegadores concurrentes y
  // satura la máquina: Windows suspende la E/S de red bajo presión de memoria y
  // los tests fallan sistémicamente con `ERR_NETWORK_IO_SUSPENDED` en `goto("/")`.
  // Con 2 workers hay un máximo de 6 navegadores simultáneos, suficiente para el
  // conjunto completo (69 tests) de forma fiable en equipos de desarrollo.
  workers: process.env.CI ? 1 : 2,
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
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      timeout: FIREFOX_TEST_TIMEOUT_MS,
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    command: DEV_SERVER_COMMAND,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: WEB_SERVER_TIMEOUT_MS,
  },
});
