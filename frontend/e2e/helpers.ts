/**
 * Helpers E2E compartidos para OmniBotIA Studio.
 *
 * La aplicación exige autenticación (RBAC): al arrancar sin token muestra la
 * pantalla de login (`LoginScreen`). Estos helpers realizan un login REAL contra
 * el backend (email+password) a través de la UI y esperan a que el shell de la
 * app (cabecera con navegación por áreas) quede visible.
 *
 * Usuarios de referencia (dev seed):
 * - admin:       tenantadmin@test.local / Password123!  (rol admin en dev-tenant)
 * - configurador: configurador@test.local / Password123! (rol configurador)
 * - operador:    operador@test.local / Password123!     (rol operador)
 * - superadmin:  superadmin@test.local / Password123!   (control plane: ve/opera cualquier tenant)
 */
import { expect, type Page } from '@playwright/test';

/** Credenciales de los usuarios de referencia del seed de desarrollo. */
export const USERS = {
  admin: { email: 'tenantadmin@test.local', password: 'Password123!' },
  configurador: { email: 'configurador@test.local', password: 'Password123!' },
  operador: { email: 'operador@test.local', password: 'Password123!' },
  superadmin: { email: 'superadmin@test.local', password: 'Password123!' },
} as const;

export type UserKey = keyof typeof USERS;

/**
 * Inicia sesión en la UI con un usuario de referencia.
 *
 * Flujo:
 * 1. Navega a `/` (cada test usa un contexto nuevo, ya sin `localStorage`).
 * 2. Espera la pantalla de login, rellena email+contraseña y pulsa "Iniciar sesión".
 * 3. Espera a que el shell de la app quede visible (cabecera con el nav de áreas).
 *
 * NOTA: no se usa `addInitScript(localStorage.clear)` aquí: limpiaría el token en
 * CADA navegación/reload y rompería los tests que recargan para verificar
 * persistencia (la sesión vive en `localStorage` en entornos sin `storageState`).
 *
 * @param page   Página de Playwright.
 * @param user   Clave del usuario de referencia (admin | configurador | operador).
 * @param baseUrl Origen donde se carga la app (por defecto `/`, resuelto contra
 *               el `baseURL` de la config de Playwright). Permite loguear contra
 *               un origen explícito (p. ej. `http://127.0.0.1:5174/`).
 */
export async function loginAs(page: Page, user: UserKey, baseUrl = '/'): Promise<void> {
  const credentials = USERS[user];

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // La app sin sesión muestra la pantalla de login.
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();

  await page.getByLabel('Correo electrónico').fill(credentials.email);
  await page.getByLabel('Contraseña').fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Tras autenticar, `loadMe` restaura el perfil y las membresías; la cabecera
  // con la navegación por áreas ("Áreas de la aplicación") queda visible.
  await expect(page.getByRole('navigation', { name: 'Áreas de la aplicación' })).toBeVisible();
}
