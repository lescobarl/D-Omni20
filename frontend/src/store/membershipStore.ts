/**
 * Store de miembros del tenant activo (RBAC por tenant, admin).
 *
 * Contrato:
 * - Registro de servicios por DI: `setMembershipService`/`getMembershipService`
 *   inyectan la implementación `IMembershipService` desde el composition root
 *   (`main.tsx`).
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas). La gestión de
 *   miembros es fail-closed: nunca bloquea el editor.
 * - `listMembers`/`addMember`/`updateMember`/`removeMember` gestionan los miembros
 *   (usuario+rol) del tenant activo. El rol se representa por tenant.
 */
import { create } from 'zustand';
import type { IMemberAddRequest, IMembershipRead, IMembershipUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IMembershipService } from '@/services/studioMembershipService';

/** Estado de un flujo de miembros del tenant. */
export type MembershipStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de miembros del tenant. */
export interface IMembershipState {
  /** Miembros (usuario+rol) del tenant activo. */
  members: IMembershipRead[];
  /** Estado del flujo de miembros. */
  status: MembershipStatus;
  /** Mensaje del último error del flujo de miembros (o `null`). */
  error: string | null;

  /** Carga los miembros del tenant activo. */
  listMembers(): Promise<void>;
  /** Agrega un miembro (por email) al tenant activo. */
  addMember(payload: IMemberAddRequest): Promise<IMembershipRead | null>;
  /** Actualiza el rol de un miembro del tenant activo. */
  updateMember(membershipId: string, payload: IMembershipUpdate): Promise<IMembershipRead | null>;
  /** Elimina un miembro del tenant activo. */
  removeMember(membershipId: string): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IMembershipService | null = null;

/**
 * Registra la implementación del servicio de miembros del tenant (composition root).
 * @param implementation - Implementación de `IMembershipService` (o `null` en pruebas).
 */
export function setMembershipService(implementation: IMembershipService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de miembros (o `null`). */
export function getMembershipService(): IMembershipService | null {
  return service;
}

/** Extrae el mensaje de un error siguiendo la cadena AppError → Error → por defecto. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Store global de miembros del tenant. */
export const useMembershipStore = create<IMembershipState>()((set, get) => ({
  members: [],
  status: 'idle',
  error: null,

  listMembers: async () => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de miembros no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const members = await service.list();
      set({ members, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudieron cargar los miembros del tenant.'),
      });
    }
  },

  addMember: async (payload: IMemberAddRequest) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de miembros no está disponible.' });
      return null;
    }
    set({ status: 'loading', error: null });
    try {
      const member = await service.add(payload);
      set({ members: [...get().members, member], status: 'success', error: null });
      return member;
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo agregar el miembro al tenant.'),
      });
      return null;
    }
  },

  updateMember: async (membershipId: string, payload: IMembershipUpdate) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de miembros no está disponible.' });
      return null;
    }
    set({ status: 'loading', error: null });
    try {
      const member = await service.update(membershipId, payload);
      set({
        members: get().members.map((current) => (current.id === membershipId ? member : current)),
        status: 'success',
        error: null,
      });
      return member;
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo actualizar el rol del miembro.'),
      });
      return null;
    }
  },

  removeMember: async (membershipId: string) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de miembros no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      await service.remove(membershipId);
      set({
        members: get().members.filter((current) => current.id !== membershipId),
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo eliminar el miembro del tenant.'),
      });
    }
  },

  reset: () =>
    set({
      members: [],
      status: 'idle',
      error: null,
    }),
}));
