/**
 * Almacén del token JWT de sesión del estudio (desacoplado).
 *
 * Contrato:
 * - Guarda el token de acceso en `localStorage` bajo una clave fija para que la
 *   sesión sobreviva a recargas de página (restauración de sesión vía `/me`).
 * - Es un módulo independiente (sin dependencias de store/servicio) para evitar
 *   ciclos de importación: `client.ts` (inyección de `Authorization`) y
 *   `authStore.ts` (login/logout) lo consumen por igual.
 * - En entornos sin `localStorage` (p. ej. SSR o pruebas con jsdom desactivado)
 *   degrada a un almacén en memoria para no romper el arranque.
 */

/** Clave bajo la que se persiste el token de acceso en `localStorage`. */
const TOKEN_STORAGE_KEY = 'omnibotia-studio.access-token';

/** Almacén en memoria de respaldo (cuando `localStorage` no está disponible). */
let memoryToken: string | null = null;

/** Indica si `localStorage` está disponible en el entorno actual. */
function hasLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Devuelve el token de acceso almacenado (o `null` si no hay sesión).
 * @returns Token JWT o `null`.
 */
export function getAccessToken(): string | null {
  if (hasLocalStorage()) {
    return globalThis.localStorage.getItem(TOKEN_STORAGE_KEY);
  }
  return memoryToken;
}

/**
 * Almacena el token de acceso de la sesión.
 * @param token - Token JWT (o `null` para limpiar la sesión).
 */
export function setAccessToken(token: string | null): void {
  if (hasLocalStorage()) {
    if (token === null) {
      globalThis.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  }
  memoryToken = token;
}

/** Limpia el token de acceso (cierre de sesión). */
export function clearAccessToken(): void {
  setAccessToken(null);
}
