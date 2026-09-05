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
 */
import { expect, type Page } from '@playwright/test';

/** Credenciales de los usuarios de referencia del seed de desarrollo. */
export const USERS = {
  admin: { email: 'tenantadmin@test.local', password: 'Password123!' },
  configurador: { email: 'configurador@test.local', password: 'Password123!' },
  operador: { email: 'operador@test.local', password: 'Password123!' },
} as const;

export type UserKey = keyof typeof USERS;

/**
 * Inicia sesión en la UI con un usuario de referencia.
 *
 * Flujo:
 * 1. Limpia `localStorage` (estado limpio, sin sesión previa).
 * 2. Navega a `/` y espera la pantalla de login.
 * 3. Rellena email+contraseña y pulsa "Iniciar sesión".
 * 4. Espera a que el shell de la app quede visible (cabecera con el nav de áreas).
 *
 * @param page   Página de Playwright.
 * @param user   Clave del usuario de referencia (admin | configurador | operador).
 */
export async function loginAs(page: Page, user: UserKey): Promise<void> {
  const credentials = USERS[user];

  // Estado limpio: sin token ni sesión previa.
  await page.context().addInitScript(() => localStorage.clear());

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // La app sin sesión muestra la pantalla de login.
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();

  await page.getByLabel('Correo electrónico').fill(credentials.email);
  await page.getByLabel('Contraseña').fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Tras autenticar, `loadMe` restaura el perfil y las membresías; la cabecera
  // con la navegación por áreas ("Áreas de la aplicación") queda visible.
  await expect(page.getByRole('navigation', { name: 'Áreas de la aplicación' })).toBeVisible();
}
