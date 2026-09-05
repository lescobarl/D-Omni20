/**
 * Contexto de tenant activo en runtime (desacoplado).
 *
 * Contrato:
 * - Permite cambiar el tenant activo en tiempo de ejecución sin reconstruir el
 *   cliente HTTP (FASE D — GAP-5: selector de tenant en runtime).
 * - Es un módulo independiente (sin dependencias de store/servicio) para evitar
 *   ciclos de importación: `client.ts` y `tenantStore.ts` lo consumen por igual.
 * - El tenant activo es un objeto canónico con AMBOS identificadores (`slug` y
 *   `id`/UUID). El backend acota el RBAC y los datos por UUID, mientras que el
 *   slug es la identidad pública/estable. Mantener ambos en un único objeto
 *   elimina la clase de bugs de reconciliación slug↔UUID que aparecía cuando el
 *   tenant activo era una cadena ambigua.
 * - `HttpApiClient.request()` lee `getActiveTenantId()` en cada petición y envía
 *   el UUID (clave canónica del backend). Si no hay tenant activo en runtime,
 *   degrada al tenant de construcción (config), preservando el comportamiento
 *   previo en pruebas.
 * - Todos los consumidores usan el API canónico `setActiveTenant({ slug, id })`.
 *   El flujo autenticado conoce el UUID real desde las membresías; el arranque
 *   desde config y las pruebas fijan `id === slug` cuando solo se conoce el slug.
 */

/** Tenant activo canónico: identidad pública (slug) + clave canónica (UUID). */
export interface IActiveTenant {
  /** Slug público y estable del tenant (p. ej. `dev-tenant`). */
  slug: string;
  /** Identificador canónico del tenant en el backend (UUID). */
  id: string;
}

let activeTenant: IActiveTenant | null = null;

/**
 * Fija el tenant activo en runtime con ambos identificadores.
 * @param tenant - Tenant activo canónico (o `null` para degradar al de config).
 */
export function setActiveTenant(tenant: IActiveTenant | null): void {
  activeTenant = tenant;
}

/**
 * Devuelve el tenant activo en runtime (o `null` si no se ha fijado).
 * @returns Tenant activo canónico o `null`.
 */
export function getActiveTenant(): IActiveTenant | null {
  return activeTenant;
}

/**
 * Devuelve el identificador canónico (UUID) del tenant activo en runtime.
 * @returns UUID del tenant activo o `null`.
 */
export function getActiveTenantId(): string | null {
  return activeTenant?.id ?? null;
}

/**
 * Devuelve el slug del tenant activo en runtime.
 * @returns Slug del tenant activo o `null`.
 */
export function getActiveTenantSlug(): string | null {
  return activeTenant?.slug ?? null;
}

/** Reinicia el contexto al estado inicial (útil en pruebas). */
export function resetActiveTenant(): void {
  activeTenant = null;
}
