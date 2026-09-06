/**
 * Utilidades de prueba para la sesión de autenticación y RBAC (FASE RBAC).
 *
 * Contrato:
 * - `App` tiene una puerta de autenticación: sin sesión muestra `LoginScreen`.
 *   Los tests que ejercitan el shell normal de la aplicación deben sembrar una
 *   sesión autenticada en `useAuthStore` antes de renderizar.
 * - `seedAuthenticatedSession` fija un usuario + membresías + rol activo en el
 *   store. Como `loadMe` sin servicio solo fija `status: 'error'` (no limpia
 *   `isAuthenticated`), la sesión sembrada sobrevive al efecto de restauración
 *   que `App` ejecuta al montar.
 * - `resetAuthSession` reinicia el store y el servicio registrado (DI) para
 *   aislar cada prueba.
 */
import { useAuthStore } from '@/store/authStore';
import { setAuthService } from '@/store/authStore';
import type { IUserRead, IMembershipRead, IRole } from '@/api/types';

/** Usuario super-admin de plataforma de prueba. */
export function makeSuperAdminUser(): IUserRead {
  return {
    id: 'user-superadmin',
    email: 'admin@omni2.app',
    display_name: 'Admin',
    is_super_admin: true,
    is_active: true,
    last_login_at: null,
    created_at: '',
    revision: 0,
    updated_at: '',
  };
}

/** Usuario de plataforma no super-admin de prueba. */
export function makeRegularUser(): IUserRead {
  return {
    id: 'user-regular',
    email: 'user@omni2.app',
    display_name: 'Usuario',
    is_super_admin: false,
    is_active: true,
    last_login_at: null,
    created_at: '',
    revision: 0,
    updated_at: '',
  };
}

/**
 * Construye una membresía de prueba usuario↔tenant.
 *
 * `tenantId` se usa tanto como `tenant_id` como `tenant_slug` para reflejar la
 * identidad canónica de la membresía (el backend enriquece cada membresía con su
 * `tenant_slug`). Así el emparejamiento por slug en `authStore` es inequívoco y
 * no hace falta degradar a un segundo emparejamiento por `tenant_id`.
 */
export function makeMembership(
  tenantId: string,
  role: IRole,
  userId = 'user-superadmin',
): IMembershipRead {
  return {
    id: `membership-${tenantId}`,
    user_id: userId,
    tenant_id: tenantId,
    tenant_slug: tenantId,
    role,
    created_at: '',
    revision: 0,
    updated_at: '',
  };
}

/**
 * Siembra una sesión autenticada en el store de autenticación.
 *
 * @param options - Configuración de la sesión a sembrar.
 * @param options.user - Perfil del usuario (por defecto super-admin).
 * @param options.memberships - Membresías del usuario (por defecto `admin` en `test-tenant`).
 * @param options.activeRole - Rol activo (por defecto el rol de la primera membresía).
 * @param options.isSuperAdmin - Indica si es super-admin (derivado de `user`).
 */
export function seedAuthenticatedSession(
  options: {
    user?: IUserRead;
    memberships?: IMembershipRead[];
    activeRole?: IRole | null;
    isSuperAdmin?: boolean;
  } = {},
): void {
  const user = options.user ?? makeSuperAdminUser();
  const memberships = options.memberships ?? [makeMembership('test-tenant', 'admin', user.id)];
  const activeRole =
    options.activeRole !== undefined ? options.activeRole : (memberships[0]?.role ?? null);
  const isSuperAdmin =
    options.isSuperAdmin !== undefined ? options.isSuperAdmin : user.is_super_admin;

  useAuthStore.setState({
    user,
    memberships,
    activeRole,
    isAuthenticated: true,
    isSuperAdmin,
    status: 'success',
    error: null,
  });
}

/** Reinicia el store de autenticación y el servicio registrado (aislamiento). */
export function resetAuthSession(): void {
  useAuthStore.getState().reset();
  setAuthService(null);
}
