/**
 * Store de usuarios de plataforma (control plane, super-admin).
 *
 * Contrato:
 * - Registro de servicios por DI: `setUserService`/`getUserService` inyectan la
 *   implementación `IUserService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas). La gestión de
 *   usuarios es fail-closed: nunca bloquea el editor.
 * - `listUsers`/`createUser`/`updateUser`/`deleteUser` gestionan el CRUD de
 *   usuarios de plataforma; `listUserMemberships`/`addUserMembership` gestionan
 *   las membresías (tenant+rol) de un usuario concreto.
 */
import { create } from 'zustand';
import type { IMembershipCreate, IMembershipRead, IUserCreate, IUserRead, IUserUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IUserService } from '@/services/studioUserService';
import { getMembershipService } from '@/store/membershipStore';

/** Estado de un flujo de usuarios de plataforma. */
export type UserStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de usuarios de plataforma. */
export interface IUserState {
  /** Usuarios de plataforma cargados (control plane). */
  users: IUserRead[];
  /** Estado del flujo de usuarios. */
  status: UserStatus;
  /** Mensaje del último error del flujo de usuarios (o `null`). */
  error: string | null;

  /** Carga la lista de usuarios de plataforma. */
  listUsers(): Promise<void>;
  /** Crea un usuario de plataforma y lo agrega a la colección. */
  createUser(payload: IUserCreate): Promise<IUserRead | null>;
  /** Actualiza un usuario de plataforma y lo refleja en la colección. */
  updateUser(userId: string, payload: IUserUpdate): Promise<IUserRead | null>;
  /** Elimina un usuario de plataforma y lo quita de la colección. */
  deleteUser(userId: string): Promise<void>;
  /** Carga las membresías (tenant+rol) de un usuario. */
  listUserMemberships(userId: string): Promise<IMembershipRead[]>;
  /** Agrega una membresía (tenant+rol) a un usuario. */
  addUserMembership(payload: IMembershipCreate): Promise<IMembershipRead | null>;
  /**
   * Elimina una membresía (tenant+rol) de un usuario. El backend no expone un
   * `DELETE /users/{id}/memberships/{membership_id}`; la baja real se realiza a
   * través del servicio de membresías (`DELETE /members/{membership_id}`), que
   * es la ruta que ya usaba la UI. El `userId` se conserva en la firma para
   * mantener la semántica de la operación sobre el usuario.
   */
  removeUserMembership(userId: string, membershipId: string): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IUserService | null = null;

/**
 * Registra la implementación del servicio de usuarios de plataforma (composition root).
 * @param implementation - Implementación de `IUserService` (o `null` en pruebas).
 */
export function setUserService(implementation: IUserService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de usuarios (o `null`). */
export function getUserService(): IUserService | null {
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

/** Store global de usuarios de plataforma. */
export const useUserStore = create<IUserState>()((set, get) => ({
  users: [],
  status: 'idle',
  error: null,

  listUsers: async () => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de usuarios no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const users = await service.list();
      set({ users, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudieron cargar los usuarios.'),
      });
    }
  },

  createUser: async (payload: IUserCreate) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de usuarios no está disponible.' });
      return null;
    }
    set({ status: 'loading', error: null });
    try {
      const user = await service.create(payload);
      set({ users: [...get().users, user], status: 'success', error: null });
      return user;
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo crear el usuario.'),
      });
      return null;
    }
  },

  updateUser: async (userId: string, payload: IUserUpdate) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de usuarios no está disponible.' });
      return null;
    }
    set({ status: 'loading', error: null });
    try {
      const user = await service.update(userId, payload);
      set({
        users: get().users.map((current) => (current.id === userId ? user : current)),
        status: 'success',
        error: null,
      });
      return user;
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo actualizar el usuario.'),
      });
      return null;
    }
  },

  deleteUser: async (userId: string) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de usuarios no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      await service.delete(userId);
      set({
        users: get().users.filter((current) => current.id !== userId),
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo eliminar el usuario.'),
      });
    }
  },

  listUserMemberships: async (userId: string) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de usuarios no está disponible.' });
      return [];
    }
    set({ status: 'loading', error: null });
    try {
      const memberships = await service.listMemberships(userId);
      set({ status: 'success', error: null });
      return memberships;
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudieron cargar las membresías del usuario.'),
      });
      return [];
    }
  },

  addUserMembership: async (payload: IMembershipCreate) => {
    if (service === null) {
      set({ status: 'error', error: 'La gestión de usuarios no está disponible.' });
      return null;
    }
    set({ status: 'loading', error: null });
    try {
      const membership = await service.addMembership(payload);
      set({ status: 'success', error: null });
      return membership;
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo agregar la membresía al usuario.'),
      });
      return null;
    }
  },

  removeUserMembership: async (_userId: string, membershipId: string) => {
    const membershipService = getMembershipService();
    if (membershipService === null) {
      set({ status: 'error', error: 'La gestión de membresías no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      // La baja real se delega al servicio de membresías (ruta tenant-scoped
      // `DELETE /members/{membership_id}`), igual que hacía la UI previamente.
      await membershipService.remove(membershipId);
      set({ status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error: extractErrorMessage(error, 'No se pudo eliminar la membresía del usuario.'),
      });
    }
  },

  reset: () =>
    set({
      users: [],
      status: 'idle',
      error: null,
    }),
}));
