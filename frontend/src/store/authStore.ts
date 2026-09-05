/**
 * Store de autenticación y RBAC del estudio (FASE RBAC).
 *
 * Contrato:
 * - Registro de servicios por DI: `setAuthService`/`getAuthService` inyectan la
 *   implementación `IAuthService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, las acciones pasan a estado de error para que
 *   la UI conviva sin la dependencia (p. ej. en pruebas).
 * - `login(email, password)` autentica contra el backend (el cliente guarda el
 *   JWT) y a continuación carga el perfil (`me`) y las membresías para poblar el
 *   estado de sesión.
 * - `loadMe()` restaura la sesión al arrancar la aplicación: si hay un token
 *   persistido, consulta `me` + membresías; si el token es inválido/expirado,
 *   limpia la sesión.
 * - `setActiveTenantRole(tenantId)` recalcula el rol activo desde las membresías
 *   al cambiar de tenant en runtime (el rol es por tenant).
 * - `logout()` cierra la sesión en el backend y reinicia el estado local.
 */
import { create } from 'zustand';
import type { IMembershipRead, IRole, IUserRead, IUserUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import {
  getActiveTenantId,
  getActiveTenantSlug,
  setActiveTenant,
  type IActiveTenant,
} from '@/lib/tenantContext';
import type { IAuthService } from '@/services/studioAuthService';
import { getUserService } from '@/store/userStore';

/** Estado del flujo de autenticación. */
export type AuthStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de autenticación y RBAC. */
export interface IAuthState {
  /** Perfil del usuario autenticado (o `null` si no hay sesión). */
  user: IUserRead | null;
  /** Membresías (tenant+rol) del usuario autenticado. */
  memberships: IMembershipRead[];
  /** Rol activo derivado de la membresía del tenant activo (o `null`). */
  activeRole: IRole | null;
  /** Indica si hay una sesión válida (usuario cargado). */
  isAuthenticated: boolean;
  /** Indica si el usuario es super-admin de plataforma (control plane). */
  isSuperAdmin: boolean;
  /** Estado actual del flujo de autenticación. */
  status: AuthStatus;
  /** Mensaje del último error (o `null`). */
  error: string | null;
  /** Inicia sesión con email+password y carga el perfil + membresías. */
  login(email: string, password: string): Promise<void>;
  /** Cierra la sesión actual en el backend y reinicia el estado local. */
  logout(): Promise<void>;
  /** Restaura la sesión al arrancar consultando `me` + membresías. */
  loadMe(): Promise<void>;
  /** Recalcula el rol activo desde las membresías para el tenant indicado. */
  setActiveTenantRole(tenantId: string): void;
  /** Cambia la contraseña del usuario autenticado (verifica la actual). */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /**
   * Actualiza el perfil del usuario autenticado (auto-edición sobre su propio id).
   * El backend no expone un `PATCH /auth/me`; se reutiliza `updateUser` del
   * servicio de usuarios sobre el id de la sesión actual y se refleja en `user`.
   */
  updateMe(payload: IUserUpdate): Promise<IUserRead | null>;
  /** Reinicia el estado al inicial por defecto (sin cerrar sesión en backend). */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IAuthService | null = null;

/**
 * Registra la implementación del servicio de autenticación (composition root).
 * @param implementation - Implementación de `IAuthService` (o `null` en pruebas).
 */
export function setAuthService(implementation: IAuthService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de autenticación (o `null`). */
export function getAuthService(): IAuthService | null {
  return service;
}

/** Mensaje por defecto cuando el error no es una instancia de `Error`. */
const UNKNOWN_ERROR_MESSAGE = 'No se pudo completar la operación. Inténtalo de nuevo.';

/** Mensaje cuando no hay servicio registrado para una operación. */
const SERVICE_UNAVAILABLE_MESSAGE = 'El servicio de autenticación no está disponible.';

/** Normaliza un error desconocido a un mensaje legible. */
function toErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return UNKNOWN_ERROR_MESSAGE;
}

/**
 * Resultado de resolver el tenant activo de forma canónica.
 *
 * `tenant` transporta AMBOS identificadores (`slug` y `id`/UUID) derivados de la
 * membresía del propio usuario, eliminando la clase de reconciliación slug↔UUID
 * que causaba fallos de RBAC. `role` es el rol del usuario en ese tenant.
 */
interface IResolvedTenant {
  tenant: IActiveTenant | null;
  role: IRole | null;
}

/**
 * Resuelve el tenant activo de forma canónica a partir de las membresías.
 *
 * El tenant activo se identifica por su slug (p. ej. `dev-tenant`), pero el
 * backend expone las membresías con `tenant_id` como UUID y `tenant_slug` como
 * slug legible. Esta función localiza la membresía que corresponde al slug
 * activo y devuelve el par canónico `{slug, id}` (con el UUID real) junto con el
 * rol. Así el header HTTP de tenant envía el UUID (clave canónica del backend) y
 * la resolución de rol es inequívoca.
 *
 * El emparejamiento se hace exclusivamente por `tenant_slug` (identidad canónica
 * de la membresía). En las pruebas, `makeMembership` fija `tenant_slug` igual al
 * `tenant_id`, por lo que no hace falta degradar a un segundo emparejamiento por
 * `tenant_id`.
 *
 * @param memberships - Membresías del usuario autenticado.
 * @param activeSlug - Slug del tenant activo (o `null` si no hay tenant).
 * @returns El tenant canónico y el rol (o `null` si el usuario no es miembro).
 */
function resolveActiveTenant(
  memberships: IMembershipRead[],
  activeSlug: string | null,
): IResolvedTenant {
  if (activeSlug === null) {
    return { tenant: null, role: null };
  }
  const membership = memberships.find((item) => item.tenant_slug === activeSlug);
  if (!membership) {
    return { tenant: null, role: null };
  }
  const tenant: IActiveTenant = {
    slug: membership.tenant_slug ?? membership.tenant_id,
    id: membership.tenant_id,
  };
  return { tenant, role: membership.role };
}

/** Store global de autenticación y RBAC del estudio. */
export const useAuthStore = create<IAuthState>()((set, get) => ({
  user: null,
  memberships: [],
  activeRole: null,
  isAuthenticated: false,
  isSuperAdmin: false,
  status: 'idle',
  error: null,

  login: async (email: string, password: string) => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      throw new AppError(SERVICE_UNAVAILABLE_MESSAGE, 'auth.login');
    }
    set({ status: 'loading', error: null });
    try {
      // El cliente HTTP guarda el JWT internamente al autenticar.
      const result = await service.login({ email, password });
      // Carga el perfil y las membresías para poblar el estado de sesión.
      const [user, memberships] = await Promise.all([service.me(), service.myMemberships()]);
      // Resuelve el tenant activo de forma canónica (slug + UUID) desde la
      // membresía del propio usuario y lo fija en el contexto para que el header
      // HTTP de tenant envíe el UUID real (clave canónica del backend).
      const activeSlug = getActiveTenantSlug() ?? getActiveTenantId();
      const { tenant, role: activeRole } = resolveActiveTenant(memberships, activeSlug);
      if (tenant) {
        setActiveTenant(tenant);
      }
      set({
        user,
        memberships,
        activeRole,
        isAuthenticated: true,
        isSuperAdmin: user.is_super_admin,
        status: 'success',
        error: null,
      });
      void result;
    } catch (error) {
      set({
        status: 'error',
        error: toErrorMessage(error),
        isAuthenticated: false,
        user: null,
      });
      throw error;
    }
  },

  logout: async () => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      throw new AppError(SERVICE_UNAVAILABLE_MESSAGE, 'auth.logout');
    }
    set({ status: 'loading', error: null });
    try {
      await service.logout();
    } finally {
      // Reinicia el estado local y el contexto de tenant aunque el backend falle.
      setActiveTenant(null);
      set({
        user: null,
        memberships: [],
        activeRole: null,
        isAuthenticated: false,
        isSuperAdmin: false,
        status: 'idle',
        error: null,
      });
    }
  },

  loadMe: async () => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const [user, memberships] = await Promise.all([service.me(), service.myMemberships()]);
      // Resuelve el tenant activo de forma canónica (slug + UUID) desde la
      // membresía del propio usuario y lo fija en el contexto para que el header
      // HTTP de tenant envíe el UUID real (clave canónica del backend).
      const activeSlug = getActiveTenantSlug() ?? getActiveTenantId();
      const { tenant, role: activeRole } = resolveActiveTenant(memberships, activeSlug);
      if (tenant) {
        setActiveTenant(tenant);
      }
      set({
        user,
        memberships,
        activeRole,
        isAuthenticated: true,
        isSuperAdmin: user.is_super_admin,
        status: 'success',
        error: null,
      });
    } catch (error) {
      // Token inválido/expirado o sin sesión: se limpia el estado local.
      setActiveTenant(null);
      set({
        user: null,
        memberships: [],
        activeRole: null,
        isAuthenticated: false,
        isSuperAdmin: false,
        status: 'error',
        error: toErrorMessage(error),
      });
    }
  },

  setActiveTenantRole: (tenantId: string) => {
    // `tenantId` es el slug del tenant (selector de UI). Se resuelve la membresía
    // correspondiente por `tenant_slug` (identidad canónica) y se fija el tenant
    // canónico (slug + UUID) en el contexto para que el header HTTP de tenant
    // envíe el UUID real.
    const membership = get().memberships.find((item) => item.tenant_slug === tenantId);
    if (membership) {
      setActiveTenant({ slug: membership.tenant_slug ?? membership.tenant_id, id: membership.tenant_id });
      set({ activeRole: membership.role, error: null });
      return;
    }
    // Sin membresía para el tenant indicado: el rol activo queda sin cambios y no
    // se altera el tenant del contexto (el tenant ya lo fijó el tenantStore).
    set({ error: null });
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      throw new AppError(SERVICE_UNAVAILABLE_MESSAGE, 'auth.changePassword');
    }
    set({ status: 'loading', error: null });
    try {
      await service.changePassword({ current_password: currentPassword, new_password: newPassword });
      set({ status: 'success', error: null });
    } catch (error) {
      set({ status: 'error', error: toErrorMessage(error) });
      throw error;
    }
  },

  updateMe: async (payload: IUserUpdate) => {
    const currentUser = get().user;
    const userService = getUserService();
    if (currentUser === null) {
      set({ status: 'error', error: 'No hay una sesión activa para actualizar el perfil.' });
      return null;
    }
    if (userService === null) {
      set({ status: 'error', error: 'El servicio de usuarios no está disponible.' });
      return null;
    }
    set({ status: 'loading', error: null });
    try {
      // Auto-edición: el backend no expone `PATCH /auth/me`, así que se actualiza
      // el propio usuario por su id (control plane) y se refleja en el estado.
      const updated = await userService.update(currentUser.id, payload);
      set({
        user: updated,
        isSuperAdmin: updated.is_super_admin,
        status: 'success',
        error: null,
      });
      return updated;
    } catch (error) {
      set({ status: 'error', error: toErrorMessage(error) });
      return null;
    }
  },

  reset: () => {
    setActiveTenant(null);
    set({
      user: null,
      memberships: [],
      activeRole: null,
      isAuthenticated: false,
      isSuperAdmin: false,
      status: 'idle',
      error: null,
    });
  },
}));
