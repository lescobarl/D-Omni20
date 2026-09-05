/**
 * Pruebas del store de usuarios de plataforma (`userStore`).
 *
 * Cubre el CRUD de usuarios (`listUsers`/`createUser`/`updateUser`/`deleteUser`)
 * y la gestión de membresías (`listUserMemberships`/`addUserMembership`/
 * `removeUserMembership`), así como la degradación a error sin servicio (DI).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IMembershipRead, IUserCreate, IUserRead, IUserUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IMembershipService } from '@/services/studioMembershipService';
import type { IUserService } from '@/services/studioUserService';
import { setMembershipService } from '@/store/membershipStore';
import { setUserService, useUserStore } from '@/store/userStore';
import { makeMembership, makeSuperAdminUser } from '@/test/authSession';

function makeUser(overrides: Partial<IUserRead> = {}): IUserRead {
  return {
    id: 'user-1',
    email: 'user1@omni2.app',
    display_name: 'Usuario Uno',
    is_super_admin: false,
    is_active: true,
    last_login_at: null,
    created_at: '',
    revision: 0,
    updated_at: '',
    ...overrides,
  };
}

function makeUserService(overrides: Partial<IUserService> = {}): IUserService {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => makeUser()),
    update: vi.fn(async () => makeUser()),
    delete: vi.fn(async () => undefined),
    listMemberships: vi.fn(async () => []),
    addMembership: vi.fn(async () => makeMembership('test-tenant', 'operador')),
    ...overrides,
  };
}

function makeMembershipService(overrides: Partial<IMembershipService> = {}): IMembershipService {
  return {
    list: vi.fn(async () => []),
    add: vi.fn(async () => makeMembership('test-tenant', 'operador')),
    update: vi.fn(async () => makeMembership('test-tenant', 'admin')),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('userStore', () => {
  beforeEach(() => {
    useUserStore.getState().reset();
    setUserService(null);
    setMembershipService(null);
  });

  afterEach(() => {
    useUserStore.getState().reset();
    setUserService(null);
    setMembershipService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useUserStore.getState();
    expect(state.users).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('listUsers carga la lista de usuarios', async () => {
    const users = [makeUser(), makeSuperAdminUser()];
    const userService = makeUserService({ list: vi.fn(async () => users) });
    setUserService(userService);

    await useUserStore.getState().listUsers();

    const state = useUserStore.getState();
    expect(state.users).toHaveLength(2);
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
  });

  it('listUsers degrada a error cuando falla la carga', async () => {
    setUserService(
      makeUserService({
        list: vi.fn(async () => {
          throw new AppError('Error de red.', 'users.list');
        }),
      }),
    );

    await useUserStore.getState().listUsers();

    const state = useUserStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('Error de red.');
  });

  it('listUsers degrada a error sin servicio registrado', async () => {
    await useUserStore.getState().listUsers();
    const state = useUserStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('La gestión de usuarios no está disponible.');
  });

  it('createUser agrega el usuario a la colección', async () => {
    const created = makeUser({ id: 'user-nuevo', email: 'nuevo@omni2.app' });
    const userService = makeUserService({ create: vi.fn(async () => created) });
    setUserService(userService);

    const payload: IUserCreate = { email: 'nuevo@omni2.app', password: 'secret123' };
    const result = await useUserStore.getState().createUser(payload);

    expect(userService.create).toHaveBeenCalledWith(payload);
    expect(result?.id).toBe('user-nuevo');
    const state = useUserStore.getState();
    expect(state.users).toContainEqual(created);
    expect(state.status).toBe('success');
  });

  it('createUser devuelve null y marca error cuando falla', async () => {
    setUserService(
      makeUserService({
        create: vi.fn(async () => {
          throw new AppError('El correo ya está registrado.', 'users.create');
        }),
      }),
    );

    const result = await useUserStore
      .getState()
      .createUser({ email: 'dup@omni2.app', password: 'secret123' });

    expect(result).toBeNull();
    const state = useUserStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('El correo ya está registrado.');
  });

  it('createUser devuelve null y marca error sin servicio registrado', async () => {
    const result = await useUserStore
      .getState()
      .createUser({ email: 'a@omni2.app', password: 'secret123' });
    expect(result).toBeNull();
    expect(useUserStore.getState().status).toBe('error');
  });

  it('updateUser actualiza el usuario en la colección', async () => {
    const original = makeUser({ id: 'user-1', display_name: 'Antes' });
    const updated = makeUser({ id: 'user-1', display_name: 'Después' });
    useUserStore.setState({ users: [original] });
    const userService = makeUserService({ update: vi.fn(async () => updated) });
    setUserService(userService);

    const payload: IUserUpdate = { display_name: 'Después' };
    const result = await useUserStore.getState().updateUser('user-1', payload);

    expect(userService.update).toHaveBeenCalledWith('user-1', payload);
    expect(result?.display_name).toBe('Después');
    const state = useUserStore.getState();
    expect(state.users[0]?.display_name).toBe('Después');
    expect(state.status).toBe('success');
  });

  it('updateUser devuelve null y marca error cuando falla', async () => {
    setUserService(
      makeUserService({
        update: vi.fn(async () => {
          throw new AppError('No se pudo actualizar el usuario.', 'users.update');
        }),
      }),
    );

    const result = await useUserStore.getState().updateUser('user-1', { display_name: 'X' });
    expect(result).toBeNull();
    expect(useUserStore.getState().status).toBe('error');
  });

  it('deleteUser elimina el usuario de la colección', async () => {
    useUserStore.setState({
      users: [makeUser({ id: 'user-1' }), makeUser({ id: 'user-2' })],
    });
    const userService = makeUserService();
    setUserService(userService);

    await useUserStore.getState().deleteUser('user-1');

    expect(userService.delete).toHaveBeenCalledWith('user-1');
    const state = useUserStore.getState();
    expect(state.users.map((u) => u.id)).toEqual(['user-2']);
    expect(state.status).toBe('success');
  });

  it('deleteUser marca error cuando falla', async () => {
    setUserService(
      makeUserService({
        delete: vi.fn(async () => {
          throw new AppError('No se pudo eliminar el usuario.', 'users.delete');
        }),
      }),
    );

    await useUserStore.getState().deleteUser('user-1');
    expect(useUserStore.getState().status).toBe('error');
    expect(useUserStore.getState().error).toBe('No se pudo eliminar el usuario.');
  });

  it('listUserMemberships devuelve las membresías del usuario', async () => {
    const memberships: IMembershipRead[] = [
      makeMembership('tenant-a', 'admin'),
      makeMembership('tenant-b', 'operador'),
    ];
    const userService = makeUserService({
      listMemberships: vi.fn(async () => memberships),
    });
    setUserService(userService);

    const result = await useUserStore.getState().listUserMemberships('user-1');

    expect(userService.listMemberships).toHaveBeenCalledWith('user-1');
    expect(result).toHaveLength(2);
    expect(useUserStore.getState().status).toBe('success');
  });

  it('listUserMemberships devuelve [] cuando falla', async () => {
    setUserService(
      makeUserService({
        listMemberships: vi.fn(async () => {
          throw new AppError('No se pudieron cargar las membresías.', 'users.listMemberships');
        }),
      }),
    );

    const result = await useUserStore.getState().listUserMemberships('user-1');
    expect(result).toEqual([]);
    expect(useUserStore.getState().status).toBe('error');
  });

  it('addUserMembership delega y devuelve la membresía creada', async () => {
    const membership = makeMembership('tenant-a', 'configurador');
    const userService = makeUserService({
      addMembership: vi.fn(async () => membership),
    });
    setUserService(userService);

    const result = await useUserStore
      .getState()
      .addUserMembership({ user_id: 'user-1', tenant_id: 'tenant-a', role: 'configurador' });

    expect(userService.addMembership).toHaveBeenCalledWith({
      user_id: 'user-1',
      tenant_id: 'tenant-a',
      role: 'configurador',
    });
    expect(result?.id).toBe(membership.id);
    expect(useUserStore.getState().status).toBe('success');
  });

  it('addUserMembership devuelve null cuando falla', async () => {
    setUserService(
      makeUserService({
        addMembership: vi.fn(async () => {
          throw new AppError('No se pudo agregar la membresía.', 'users.addMembership');
        }),
      }),
    );

    const result = await useUserStore
      .getState()
      .addUserMembership({ user_id: 'user-1', tenant_id: 'tenant-a', role: 'admin' });
    expect(result).toBeNull();
    expect(useUserStore.getState().status).toBe('error');
  });

  it('removeUserMembership delega la baja al servicio de membresías', async () => {
    const membershipService = makeMembershipService();
    setMembershipService(membershipService);

    await useUserStore.getState().removeUserMembership('user-1', 'membership-tenant-a');

    expect(membershipService.remove).toHaveBeenCalledWith('membership-tenant-a');
    expect(useUserStore.getState().status).toBe('success');
  });

  it('removeUserMembership marca error sin servicio de membresías', async () => {
    await useUserStore.getState().removeUserMembership('user-1', 'membership-tenant-a');
    const state = useUserStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('La gestión de membresías no está disponible.');
  });

  it('removeUserMembership marca error cuando falla la baja', async () => {
    setMembershipService(
      makeMembershipService({
        remove: vi.fn(async () => {
          throw new AppError('No se pudo eliminar la membresía.', 'members.remove');
        }),
      }),
    );

    await useUserStore.getState().removeUserMembership('user-1', 'membership-tenant-a');
    const state = useUserStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('No se pudo eliminar la membresía.');
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useUserStore.setState({
      users: [makeUser()],
      status: 'success',
      error: null,
    });

    useUserStore.getState().reset();

    const state = useUserStore.getState();
    expect(state.users).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });
});
