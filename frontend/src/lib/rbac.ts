/**
 * Utilidades de RBAC (Role-Based Access Control) del estudio.
 *
 * Contrato:
 * - Codifica la matriz de permisos por área funcional (diseño §3.2) en términos
 *   de roles por tenant (`admin` | `configurador` | `operador`) y del flag de
 *   plataforma `is_super_admin`.
 * - `canAccessArea` es el predicado central que la UI usa para filtrar la
 *   navegación y ocultar botones/áreas (fail-closed: sin rol → sin acceso).
 * - `canManageTenantMembers`/`canManagePlatformUsers` son atajos semánticos
 *   para los casos especiales de la matriz.
 */
import type { IRole } from '@/api/types';

/** Áreas funcionales de la aplicación (matriz de permisos §3.2). */
export type RbacArea =
  | 'tenants' // CRUD de tenants (control plane)
  | 'platformUsers' // gestión de usuarios de plataforma
  | 'tenantMembers' // miembros del tenant
  | 'tenantConfig' // configuración del tenant (apariencia, canales, bot…)
  | 'content' // contenido (landings, portal, catálogo, documentos…)
  | 'operations' // CRM / campañas / intervenciones / operaciones
  | 'analytics' // estadísticas / analítica / auditoría
  | 'profile'; // mi perfil / contraseña

/** Contexto de RBAC evaluado por la UI. */
export interface IRbacContext {
  /** Rol del usuario en el tenant activo (o `null` si no es miembro). */
  role: IRole | null;
  /** Flag de plataforma: super-admin gestiona tenants y usuarios globales. */
  isSuperAdmin: boolean;
}

/** Roles por tenant que pueden gestionar miembros del tenant. */
const MEMBER_MANAGER_ROLES: readonly IRole[] = ['admin'];

/** Roles por tenant que pueden operar CRM/campañas/intervenciones. */
const OPERATIONS_ROLES: readonly IRole[] = ['admin', 'operador'];

/** Roles por tenant que pueden configurar contenido y configuración del tenant. */
const CONFIG_ROLES: readonly IRole[] = ['admin', 'configurador'];

/**
 * Devuelve si un rol por tenant puede acceder a un área de configuración
 * (configuración del tenant o contenido), considerando el flag de super-admin.
 */
function canAccessConfigArea(role: IRole | null, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  return role !== null && CONFIG_ROLES.includes(role);
}

/**
 * Devuelve si el contexto puede acceder a un área funcional (matriz §3.2).
 * @param area - Área funcional a evaluar.
 * @param context - Rol por tenant + flag de super-admin.
 * @returns `true` si el contexto tiene permiso (fail-closed).
 */
export function canAccessArea(area: RbacArea, context: IRbacContext): boolean {
  const { role, isSuperAdmin } = context;
  switch (area) {
    case 'tenants':
    case 'platformUsers':
      // Control plane: solo super-admin (no depende de membresía).
      return isSuperAdmin;
    case 'tenantMembers':
      // Miembros del tenant: super-admin o admin del tenant.
      return isSuperAdmin || (role !== null && MEMBER_MANAGER_ROLES.includes(role));
    case 'tenantConfig':
    case 'content':
      return canAccessConfigArea(role, isSuperAdmin);
    case 'operations':
      // CRM/campañas/intervenciones: super-admin o admin/operador.
      return isSuperAdmin || (role !== null && OPERATIONS_ROLES.includes(role));
    case 'analytics':
    case 'profile':
      // Estadísticas y mi perfil: cualquier miembro autenticado (o super-admin).
      return isSuperAdmin || role !== null;
    default:
      return false;
  }
}

/**
 * Atajo semántico: ¿puede gestionar los miembros del tenant activo?
 * @param context - Contexto de RBAC.
 * @returns `true` si puede gestionar miembros.
 */
export function canManageTenantMembers(context: IRbacContext): boolean {
  return canAccessArea('tenantMembers', context);
}

/**
 * Atajo semántico: ¿puede gestionar los usuarios de plataforma (control plane)?
 * @param context - Contexto de RBAC.
 * @returns `true` si puede gestionar usuarios de plataforma.
 */
export function canManagePlatformUsers(context: IRbacContext): boolean {
  return canAccessArea('platformUsers', context);
}
