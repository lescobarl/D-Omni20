/**
 * Configuración temporal de Playwright para validar E2E contra el servidor de
 * desarrollo de OmniBotIA Studio que YA está corriendo en el puerto 5174
 * (Terminal 1: `npm run dev -- --port 5174 --strictPort`).
 *
 * El puerto 5173 está ocupado por otra aplicación no relacionada ("FLU OS4"),
 * por lo que la config por defecto (5173) no puede validar OmniBotIA.
 * Esta config NO arranca ningún servidor: reutiliza el 5174 activo.
 */
import { defineConfig, devices } from '@playwright/test';

const DEV_SERVER_PORT = 5174;
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
const TEST_TIMEOUT_MS = 30_000;
const FIREFOX_TEST_TIMEOUT_MS = 90_000;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
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

  // Sin webServer: el servidor OmniBotIA ya corre en 5174.
});
