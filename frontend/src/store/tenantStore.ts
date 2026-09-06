/**
 * Store de Tenant activo en runtime (FASE D — GAP-5).
 *
 * Contrato:
 * - Registro de servicios por DI: `setTenantService`/`getTenantService` inyectan
 *   la implementación `ITenantService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `loadTenants` pasa a estado de error para que
 *   la UI conviva sin la dependencia (p. ej. en pruebas).
 * - `loadTenants()` consulta los tenants disponibles (control plane) y preselecciona
 *   el activo si aún no hay uno.
 * - `setActiveTenant(slug)` cambia el tenant activo en runtime: actualiza el
 *   contexto desacoplado (`lib/tenantContext`) que el cliente HTTP lee en cada
 *   petición, de modo que todas las llamadas posteriores usan el nuevo tenant.
 * - CRUD (control plane): `createTenant`/`updateTenant`/`deleteTenant` delegan en
 *   el servicio y recargan la lista para mantener el estado sincronizado. Si se
 *   elimina el tenant activo, se preselecciona el primero restante (o `null`).
 */
import { create } from 'zustand';
import type { ITenantCreate, ITenantRead, ITenantUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import {
  getActiveTenant,
  getActiveTenantId,
  getActiveTenantSlug,
  setActiveTenant,
} from '@/lib/tenantContext';
import type { ITenantService } from '@/services/tenantService';

/** Estado del flujo de carga de tenants. */
export type TenantStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de tenant activo. */
export interface ITenantState {
  /** Lista de tenants disponibles (control plane). */
  tenants: ITenantRead[];
  /** Slug del tenant activo en runtime (o `null` si no se ha fijado). */
  activeTenantId: string | null;
  /** Estado actual de la carga de tenants. */
  status: TenantStatus;
  /** Mensaje del último error (o `null`). */
  error: string | null;
  /** Carga la lista de tenants disponibles y preselecciona el activo. */
  loadTenants(): Promise<void>;
  /** Crea un tenant (control plane) y recarga la lista. */
  createTenant(payload: ITenantCreate): Promise<ITenantRead>;
  /** Actualiza el nombre de un tenant por su slug (control plane) y recarga la lista. */
  updateTenant(slug: string, payload: ITenantUpdate): Promise<ITenantRead>;
  /** Elimina (soft-delete) un tenant por su slug (control plane) y recarga la lista. */
  deleteTenant(slug: string): Promise<void>;
  /** Cambia el tenant activo en runtime para todas las llamadas posteriores. */
  setActiveTenant(slug: string): void;
  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: ITenantService | null = null;

/**
 * Registra la implementación del servicio de tenants (composition root).
 * @param implementation - Implementación de `ITenantService` (o `null` en pruebas).
 */
export function setTenantService(implementation: ITenantService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de tenants (o `null`). */
export function getTenantService(): ITenantService | null {
  return service;
}

/** Mensaje por defecto cuando el error no es una instancia de `Error`. */
const UNKNOWN_ERROR_MESSAGE = 'No se pudieron cargar los tenants. Inténtalo de nuevo.';

/** Mensaje cuando no hay servicio registrado para una operación de escritura. */
const SERVICE_UNAVAILABLE_MESSAGE = 'El selector de tenants no está disponible.';

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

/** Store global del tenant activo en runtime. */
export const useTenantStore = create<ITenantState>()((set, get) => ({
  tenants: [],
  activeTenantId: null,
  status: 'idle',
  error: null,

  loadTenants: async () => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const tenants = await service.list();
      // Preselecciona el tenant activo: prefiere el fijado en el contexto
      // desacoplado (sembrado desde la configuración en el composition root) y
      // degrada al del store; si no hay ninguno, usa el primero de la lista.
      // Si el tenant activo ya no existe en la lista (p. ej. se eliminó), se
      // degrada al primero restante (o `null` si no queda ninguno).
      // El contexto guarda el tenant canónico {slug, id}; se compara contra el
      // UUID (`tenant.id`) y el slug (`tenant.slug`) para tolerar ambos.
      const active = getActiveTenant();
      const currentSlug = active?.slug ?? getActiveTenantSlug() ?? get().activeTenantId;
      const currentId = active?.id ?? getActiveTenantId();
      const stillExists = tenants.some(
        (tenant) => tenant.id === currentId || tenant.slug === currentSlug,
      );
      const selected = stillExists
        ? (tenants.find((tenant) => tenant.id === currentId || tenant.slug === currentSlug) ??
          tenants[0])
        : tenants[0];
      const activeTenantId = selected?.slug ?? null;
      if (selected) {
        setActiveTenant({ slug: selected.slug, id: selected.id });
      }
      set({ tenants, activeTenantId, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error: toErrorMessage(error),
      });
    }
  },

  createTenant: async (payload: ITenantCreate) => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      throw new AppError(SERVICE_UNAVAILABLE_MESSAGE, 'tenant.create');
    }
    set({ status: 'loading', error: null });
    try {
      const created = await service.create(payload);
      // Recarga la lista para incluir el tenant recién creado y mantener el
      // estado sincronizado con el backend (control plane).
      await get().loadTenants();
      return created;
    } catch (error) {
      set({ status: 'error', error: toErrorMessage(error) });
      throw error;
    }
  },

  updateTenant: async (slug: string, payload: ITenantUpdate) => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      throw new AppError(SERVICE_UNAVAILABLE_MESSAGE, 'tenant.update');
    }
    set({ status: 'loading', error: null });
    try {
      const updated = await service.update(slug, payload);
      // Recarga la lista para reflejar el nuevo nombre. Si el tenant actualizado
      // era el activo, se conserva como activo (el slug es inmutable).
      await get().loadTenants();
      return updated;
    } catch (error) {
      set({ status: 'error', error: toErrorMessage(error) });
      throw error;
    }
  },

  deleteTenant: async (slug: string) => {
    if (service === null) {
      set({ status: 'error', error: SERVICE_UNAVAILABLE_MESSAGE });
      throw new AppError(SERVICE_UNAVAILABLE_MESSAGE, 'tenant.delete');
    }
    set({ status: 'loading', error: null });
    try {
      await service.delete(slug);
      // Recarga la lista tras el soft-delete. Si el tenant eliminado era el
      // activo, `loadTenants` preselecciona el primero restante (o `null`).
      await get().loadTenants();
    } catch (error) {
      set({ status: 'error', error: toErrorMessage(error) });
      throw error;
    }
  },

  setActiveTenant: (slug: string) => {
    // Resuelve el slug → UUID desde la lista de tenants (cuando está disponible)
    // y fija el tenant canónico {slug, id} en el contexto, de modo que el header
    // HTTP de tenant envíe el UUID real (clave canónica del backend). Si el slug
    // no está en la lista (p. ej. en pruebas), degrada a {slug, id: slug}.
    const tenant = get().tenants.find((item) => item.slug === slug);
    if (tenant) {
      setActiveTenant({ slug: tenant.slug, id: tenant.id });
    } else {
      setActiveTenant({ slug, id: slug });
    }
    set({ activeTenantId: slug, error: null });
  },

  reset: () => {
    setActiveTenant(null);
    set({
      tenants: [],
      activeTenantId: null,
      status: 'idle',
      error: null,
    });
  },
}));
