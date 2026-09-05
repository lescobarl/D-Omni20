/**
 * Pruebas del store de miembros del tenant (`membershipStore`).
 *
 * Cubre `listMembers`/`addMember`/`updateMember`/`removeMember` y la degradación
 * a error sin servicio registrado (DI).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IMemberAddRequest, IMembershipRead, IMembershipUpdate } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IMembershipService } from '@/services/studioMembershipService';
import { setMembershipService, useMembershipStore } from '@/store/membershipStore';

function makeMember(overrides: Partial<IMembershipRead> = {}): IMembershipRead {
  return {
    id: 'membership-1',
    user_id: 'user-1',
    tenant_id: 'test-tenant',
    role: 'admin',
    created_at: '',
    revision: 0,
    updated_at: '',
    ...overrides,
  };
}

function makeMembershipService(overrides: Partial<IMembershipService> = {}): IMembershipService {
  return {
    list: vi.fn(async () => []),
    add: vi.fn(async () => makeMember()),
    update: vi.fn(async () => makeMember()),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('membershipStore', () => {
  beforeEach(() => {
    useMembershipStore.getState().reset();
    setMembershipService(null);
  });

  afterEach(() => {
    useMembershipStore.getState().reset();
    setMembershipService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useMembershipStore.getState();
    expect(state.members).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('listMembers carga los miembros del tenant', async () => {
    const members = [makeMember(), makeMember({ id: 'membership-2', role: 'operador' })];
    const membershipService = makeMembershipService({ list: vi.fn(async () => members) });
    setMembershipService(membershipService);

    await useMembershipStore.getState().listMembers();

    const state = useMembershipStore.getState();
    expect(state.members).toHaveLength(2);
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
  });

  it('listMembers degrada a error cuando falla la carga', async () => {
    setMembershipService(
      makeMembershipService({
        list: vi.fn(async () => {
          throw new AppError('Error de red.', 'members.list');
        }),
      }),
    );

    await useMembershipStore.getState().listMembers();

    const state = useMembershipStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('Error de red.');
  });

  it('listMembers degrada a error sin servicio registrado', async () => {
    await useMembershipStore.getState().listMembers();
    const state = useMembershipStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('La gestión de miembros no está disponible.');
  });

  it('addMember agrega el miembro a la colección', async () => {
    const added = makeMember({ id: 'membership-nuevo', role: 'configurador' });
    const membershipService = makeMembershipService({ add: vi.fn(async () => added) });
    setMembershipService(membershipService);

    const payload: IMemberAddRequest = { email: 'nuevo@omni2.app', role: 'configurador' };
    const result = await useMembershipStore.getState().addMember(payload);

    expect(membershipService.add).toHaveBeenCalledWith(payload);
    expect(result?.id).toBe('membership-nuevo');
    const state = useMembershipStore.getState();
    expect(state.members).toContainEqual(added);
    expect(state.status).toBe('success');
  });

  it('addMember devuelve null y marca error cuando falla', async () => {
    setMembershipService(
      makeMembershipService({
        add: vi.fn(async () => {
          throw new AppError('No se pudo agregar el miembro.', 'members.add');
        }),
      }),
    );

    const result = await useMembershipStore
      .getState()
      .addMember({ email: 'a@omni2.app', role: 'admin' });

    expect(result).toBeNull();
    const state = useMembershipStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('No se pudo agregar el miembro.');
  });

  it('addMember devuelve null y marca error sin servicio registrado', async () => {
    const result = await useMembershipStore
      .getState()
      .addMember({ email: 'a@omni2.app', role: 'admin' });
    expect(result).toBeNull();
    expect(useMembershipStore.getState().status).toBe('error');
  });

  it('updateMember actualiza el rol del miembro en la colección', async () => {
    const original = makeMember({ id: 'membership-1', role: 'admin' });
    const updated = makeMember({ id: 'membership-1', role: 'operador' });
    useMembershipStore.setState({ members: [original] });
    const membershipService = makeMembershipService({ update: vi.fn(async () => updated) });
    setMembershipService(membershipService);

    const payload: IMembershipUpdate = { role: 'operador' };
    const result = await useMembershipStore.getState().updateMember('membership-1', payload);

    expect(membershipService.update).toHaveBeenCalledWith('membership-1', payload);
    expect(result?.role).toBe('operador');
    const state = useMembershipStore.getState();
    expect(state.members[0]?.role).toBe('operador');
    expect(state.status).toBe('success');
  });

  it('updateMember devuelve null y marca error cuando falla', async () => {
    setMembershipService(
      makeMembershipService({
        update: vi.fn(async () => {
          throw new AppError('No se pudo actualizar el rol.', 'members.update');
        }),
      }),
    );

    const result = await useMembershipStore.getState().updateMember('membership-1', {
      role: 'operador',
    });
    expect(result).toBeNull();
    expect(useMembershipStore.getState().status).toBe('error');
  });

  it('removeMember elimina el miembro de la colección', async () => {
    useMembershipStore.setState({
      members: [makeMember({ id: 'membership-1' }), makeMember({ id: 'membership-2' })],
    });
    const membershipService = makeMembershipService();
    setMembershipService(membershipService);

    await useMembershipStore.getState().removeMember('membership-1');

    expect(membershipService.remove).toHaveBeenCalledWith('membership-1');
    const state = useMembershipStore.getState();
    expect(state.members.map((m) => m.id)).toEqual(['membership-2']);
    expect(state.status).toBe('success');
  });

  it('removeMember marca error cuando falla', async () => {
    setMembershipService(
      makeMembershipService({
        remove: vi.fn(async () => {
          throw new AppError('No se pudo eliminar el miembro.', 'members.remove');
        }),
      }),
    );

    await useMembershipStore.getState().removeMember('membership-1');
    const state = useMembershipStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('No se pudo eliminar el miembro.');
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useMembershipStore.setState({
      members: [makeMember()],
      status: 'success',
      error: null,
    });

    useMembershipStore.getState().reset();

    const state = useMembershipStore.getState();
    expect(state.members).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });
});
