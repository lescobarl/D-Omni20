/**
 * Pruebas del store de autenticación y RBAC (`authStore`).
 *
 * Cubre `login`, `logout`, `loadMe`, `setActiveTenantRole`, `changePassword`,
 * `updateMe` y las transiciones de `isAuthenticated`/`isSuperAdmin`, así como
 * la degradación a error cuando no hay servicio registrado (DI).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserRead, IUserUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import { resetActiveTenant, setActiveTenant } from '@/lib/tenantContext';
import type { IAuthService } from '@/services/studioAuthService';
import { setAuthService, useAuthStore } from '@/store/authStore';
import {
  makeMembership,
  makeRegularUser,
  makeSuperAdminUser,
  resetAuthSession,
} from '@/test/authSession';

function makeAuthService(overrides: Partial<IAuthService> = {}): IAuthService {
  return {
    login: vi.fn(async () => ({
      access_token: 'token',
      token_type: 'bearer',
      user: makeSuperAdminUser(),
    })),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => makeSuperAdminUser()),
    myMemberships: vi.fn(async () => [makeMembership('test-tenant', 'admin')]),
    changePassword: vi.fn(async () => undefined),
    updateMe: vi.fn(async () => makeRegularUser()),
    ...overrides,
  };
}

describe('authStore', () => {
  beforeEach(() => {
    resetActiveTenant();
    resetAuthSession();
    setAuthService(null);
  });

  afterEach(() => {
    resetActiveTenant();
    resetAuthSession();
    setAuthService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.memberships).toEqual([]);
    expect(state.activeRole).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isSuperAdmin).toBe(false);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('login autentica y puebla perfil, membresías y rol activo', async () => {
    const authService = makeAuthService({
      me: vi.fn(async () => makeSuperAdminUser()),
      myMemberships: vi.fn(async () => [
        makeMembership('tenant-a', 'admin'),
        makeMembership('tenant-b', 'operador'),
      ]),
    });
    setAuthService(authService);
    setActiveTenant({ slug: 'tenant-b', id: 'tenant-b' });

    await useAuthStore.getState().login('admin@omni2.app', 'secret');

    const state = useAuthStore.getState();
    expect(authService.login).toHaveBeenCalledWith({
      email: 'admin@omni2.app',
      password: 'secret',
    });
    expect(state.user?.email).toBe('admin@omni2.app');
    expect(state.memberships).toHaveLength(2);
    expect(state.activeRole).toBe('operador');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isSuperAdmin).toBe(true);
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
  });

  it('login deriva el rol activo del tenant activo en runtime', async () => {
    const authService = makeAuthService({
      myMemberships: vi.fn(async () => [
        makeMembership('tenant-a', 'configurador'),
        makeMembership('tenant-b', 'operador'),
      ]),
    });
    setAuthService(authService);
    setActiveTenant({ slug: 'tenant-a', id: 'tenant-a' });

    await useAuthStore.getState().login('user@omni2.app', 'secret');

    expect(useAuthStore.getState().activeRole).toBe('configurador');
  });

  it('login marca error y lanza cuando el servicio falla', async () => {
    const authService = makeAuthService({
      login: vi.fn(async () => {
        throw new AppError('Credenciales inválidas.', 'auth.login');
      }),
    });
    setAuthService(authService);

    await expect(useAuthStore.getState().login('a@b.c', 'wrong')).rejects.toThrow(
      'Credenciales inválidas.',
    );

    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('Credenciales inválidas.');
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('login degrada a error y lanza sin servicio registrado', async () => {
    await expect(useAuthStore.getState().login('a@b.c', 'secret')).rejects.toThrow(
      'El servicio de autenticación no está disponible.',
    );
    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('El servicio de autenticación no está disponible.');
  });

  it('logout cierra sesión y reinicia el estado local', async () => {
    const authService = makeAuthService();
    setAuthService(authService);
    setActiveTenant({ slug: 'test-tenant', id: 'test-tenant' });
    useAuthStore.setState({
      user: makeSuperAdminUser(),
      memberships: [makeMembership('test-tenant', 'admin')],
      activeRole: 'admin',
      isAuthenticated: true,
      isSuperAdmin: true,
      status: 'success',
    });

    await useAuthStore.getState().logout();

    expect(authService.logout).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.memberships).toEqual([]);
    expect(state.activeRole).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isSuperAdmin).toBe(false);
    expect(state.status).toBe('idle');
  });

  it('logout reinicia el estado aunque el backend falle', async () => {
    const authService = makeAuthService({
      logout: vi.fn(async () => {
        throw new AppError('Error de red.', 'auth.logout');
      }),
    });
    setAuthService(authService);
    useAuthStore.setState({
      user: makeSuperAdminUser(),
      memberships: [makeMembership('test-tenant', 'admin')],
      activeRole: 'admin',
      isAuthenticated: true,
      isSuperAdmin: true,
      status: 'success',
    });

    await expect(useAuthStore.getState().logout()).rejects.toThrow('Error de red.');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.status).toBe('idle');
  });

  it('logout degrada a error y lanza sin servicio registrado', async () => {
    await expect(useAuthStore.getState().logout()).rejects.toThrow(
      'El servicio de autenticación no está disponible.',
    );
    expect(useAuthStore.getState().status).toBe('error');
  });

  it('loadMe restaura la sesión con perfil y membresías', async () => {
    const authService = makeAuthService({
      me: vi.fn(async () => makeRegularUser()),
      myMemberships: vi.fn(async () => [makeMembership('tenant-a', 'operador')]),
    });
    setAuthService(authService);
    setActiveTenant({ slug: 'tenant-a', id: 'tenant-a' });

    await useAuthStore.getState().loadMe();

    const state = useAuthStore.getState();
    expect(state.user?.email).toBe('user@omni2.app');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isSuperAdmin).toBe(false);
    expect(state.activeRole).toBe('operador');
    expect(state.status).toBe('success');
  });

  it('loadMe limpia la sesión cuando el token es inválido', async () => {
    const authService = makeAuthService({
      me: vi.fn(async () => {
        throw new AppError('Sesión expirada.', 'auth.me');
      }),
    });
    setAuthService(authService);
    setActiveTenant({ slug: 'test-tenant', id: 'test-tenant' });
    useAuthStore.setState({
      user: makeSuperAdminUser(),
      memberships: [makeMembership('test-tenant', 'admin')],
      activeRole: 'admin',
      isAuthenticated: true,
      isSuperAdmin: true,
      status: 'success',
    });

    await useAuthStore.getState().loadMe();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.memberships).toEqual([]);
    expect(state.status).toBe('error');
    expect(state.error).toBe('Sesión expirada.');
  });

  it('loadMe degrada a error sin servicio registrado (sin lanzar)', async () => {
    await useAuthStore.getState().loadMe();
    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('El servicio de autenticación no está disponible.');
  });

  it('setActiveTenantRole recalcula el rol activo desde las membresías', () => {
    useAuthStore.setState({
      memberships: [
        makeMembership('tenant-a', 'configurador'),
        makeMembership('tenant-b', 'operador'),
      ],
    });

    useAuthStore.getState().setActiveTenantRole('tenant-b');
    expect(useAuthStore.getState().activeRole).toBe('operador');

    useAuthStore.getState().setActiveTenantRole('tenant-a');
    expect(useAuthStore.getState().activeRole).toBe('configurador');
  });

  it('setActiveTenantRole deja el rol en null si el usuario no es miembro', () => {
    useAuthStore.setState({
      memberships: [makeMembership('tenant-a', 'admin')],
    });

    useAuthStore.getState().setActiveTenantRole('tenant-desconocido');
    expect(useAuthStore.getState().activeRole).toBeNull();
  });

  it('changePassword delega en el servicio y pasa a success', async () => {
    const authService = makeAuthService();
    setAuthService(authService);

    await useAuthStore.getState().changePassword('vieja', 'nueva1234');

    expect(authService.changePassword).toHaveBeenCalledWith({
      current_password: 'vieja',
      new_password: 'nueva1234',
    });
    const state = useAuthStore.getState();
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
  });

  it('changePassword marca error y lanza cuando el servicio falla', async () => {
    const authService = makeAuthService({
      changePassword: vi.fn(async () => {
        throw new AppError('La contraseña actual es incorrecta.', 'auth.changePassword');
      }),
    });
    setAuthService(authService);

    await expect(useAuthStore.getState().changePassword('incorrecta', 'nueva1234')).rejects.toThrow(
      'La contraseña actual es incorrecta.',
    );

    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('La contraseña actual es incorrecta.');
  });

  it('changePassword degrada a error y lanza sin servicio registrado', async () => {
    await expect(useAuthStore.getState().changePassword('vieja', 'nueva1234')).rejects.toThrow(
      'El servicio de autenticación no está disponible.',
    );
    expect(useAuthStore.getState().status).toBe('error');
  });

  it('updateMe actualiza el perfil del usuario autenticado vía el servicio de auth', async () => {
    const user = makeRegularUser();
    const updated: IUserRead = { ...user, display_name: 'Nuevo Nombre' };
    const authService = makeAuthService({
      updateMe: vi.fn(async () => updated),
    });
    setAuthService(authService);
    useAuthStore.setState({
      user,
      memberships: [],
      activeRole: null,
      isAuthenticated: true,
      isSuperAdmin: false,
      status: 'success',
    });

    const payload: IUserUpdate = { display_name: 'Nuevo Nombre' };
    const result = await useAuthStore.getState().updateMe(payload);

    expect(authService.updateMe).toHaveBeenCalledWith(payload);
    expect(result?.display_name).toBe('Nuevo Nombre');
    const state = useAuthStore.getState();
    expect(state.user?.display_name).toBe('Nuevo Nombre');
    expect(state.status).toBe('success');
  });

  it('updateMe refleja el cambio de is_super_admin en el estado', async () => {
    const user = makeRegularUser();
    const promoted: IUserRead = { ...user, is_super_admin: true };
    setAuthService(
      makeAuthService({
        updateMe: vi.fn(async () => promoted),
      }),
    );
    useAuthStore.setState({
      user,
      memberships: [],
      activeRole: null,
      isAuthenticated: true,
      isSuperAdmin: false,
      status: 'success',
    });

    await useAuthStore.getState().updateMe({ is_super_admin: true });

    const state = useAuthStore.getState();
    expect(state.user?.is_super_admin).toBe(true);
    expect(state.isSuperAdmin).toBe(true);
  });

  it('updateMe devuelve null y marca error sin sesión activa', async () => {
    const result = await useAuthStore.getState().updateMe({ display_name: 'X' });
    expect(result).toBeNull();
    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('No hay una sesión activa para actualizar el perfil.');
  });

  it('updateMe devuelve null y marca error sin servicio de autenticación', async () => {
    useAuthStore.setState({
      user: makeRegularUser(),
      memberships: [],
      activeRole: null,
      isAuthenticated: true,
      isSuperAdmin: false,
      status: 'success',
    });

    const result = await useAuthStore.getState().updateMe({ display_name: 'X' });
    expect(result).toBeNull();
    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('El servicio de autenticación no está disponible.');
  });

  it('updateMe devuelve null y marca error cuando el servicio falla', async () => {
    setAuthService(
      makeAuthService({
        updateMe: vi.fn(async () => {
          throw new AppError('No se pudo actualizar el perfil.', 'auth.updateMe');
        }),
      }),
    );
    useAuthStore.setState({
      user: makeRegularUser(),
      memberships: [],
      activeRole: null,
      isAuthenticated: true,
      isSuperAdmin: false,
      status: 'success',
    });

    const result = await useAuthStore.getState().updateMe({ display_name: 'X' });
    expect(result).toBeNull();
    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('No se pudo actualizar el perfil.');
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useAuthStore.setState({
      user: makeSuperAdminUser(),
      memberships: [makeMembership('test-tenant', 'admin')],
      activeRole: 'admin',
      isAuthenticated: true,
      isSuperAdmin: true,
      status: 'success',
    });
    setActiveTenant({ slug: 'test-tenant', id: 'test-tenant' });

    useAuthStore.getState().reset();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.memberships).toEqual([]);
    expect(state.activeRole).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isSuperAdmin).toBe(false);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });
});
