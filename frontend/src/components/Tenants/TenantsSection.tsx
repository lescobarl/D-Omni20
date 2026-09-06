/**
 * Sección «Tenants» (control plane, super-admin).
 *
 * Contrato:
 * - Muestra todos los tenants de la plataforma como fichas seleccionables; la
 *   ficha activa coincide con el selector superior (comparten `tenantStore`).
 * - Delega las acciones de mantenimiento (crear/renombrar/eliminar) en
 *   `TenantManager`, que ya consumía `useTenantStore` sin reimplementar datos.
 * - Solo es accesible para super-admin (área RBAC `platformUsers`), igual que
 *   la gestión de usuarios; la navegación filtra la entrada de forma fail-closed.
 */
import type { ReactElement } from 'react';
import { TenantManager } from '@/components/TenantManager';
import { useAuthStore } from '@/store/authStore';
import { useTenantStore } from '@/store/tenantStore';

/**
 * Renderiza la pestaña de gestión de tenants de la plataforma.
 *
 * @returns Lista de tenants y controles de mantenimiento (control plane).
 */
export function TenantsSection(): ReactElement {
  const tenants = useTenantStore((state) => state.tenants);
  const activeTenantId = useTenantStore((state) => state.activeTenantId);
  const setActiveTenant = useTenantStore((state) => state.setActiveTenant);
  const setActiveTenantRole = useAuthStore((state) => state.setActiveTenantRole);

  const selectTenant = (slug: string): void => {
    // Mismo contrato que el selector de la cabecera: fija el tenant activo (para
    // las llamadas posteriores) y recalcula el rol activo por membresías.
    setActiveTenant(slug);
    setActiveTenantRole(slug);
  };

  return (
    <section
      aria-labelledby="tenants-heading"
      className="flex flex-1 flex-col gap-4 overflow-auto p-6"
    >
      <h2 id="tenants-heading" className="text-xl font-semibold text-slate-800">
        Gestión de tenants
      </h2>
      <p className="text-sm text-slate-500">
        Crea, renombra y elimina tenants de la plataforma (control plane). El tenant activo también
        se puede elegir desde el selector de la parte superior derecha.
      </p>
      <ul aria-label="Lista de tenants" className="flex flex-wrap gap-2">
        {tenants.map((tenant) => {
          const isActive = tenant.slug === activeTenantId;
          return (
            <li key={tenant.slug}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  selectTenant(tenant.slug);
                }}
                className={
                  isActive
                    ? 'rounded border border-brand-400 bg-brand-600 px-3 py-1 font-medium text-white transition hover:bg-brand-700'
                    : 'rounded border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 transition hover:bg-slate-50'
                }
              >
                {tenant.name || tenant.slug}
                <span className="ml-2 text-xs opacity-70">{tenant.slug}</span>
              </button>
            </li>
          );
        })}
        {tenants.length === 0 ? (
          <li className="text-sm text-slate-400">Aún no hay tenants disponibles.</li>
        ) : null}
      </ul>
      <TenantManager />
    </section>
  );
}
