/**
 * Pruebas del store de tenant activo en runtime (FASE D — GAP-5).
 *
 * Contrato:
 * - `setTenantService`/`getTenantService` inyectan la implementación `ITenantService`
 *   desde el composition root; sin servicio registrado las operaciones degradan a error.
 * - `loadTenants` consulta los tenants (control plane) y preselecciona el activo.
 * - `createTenant`/`updateTenant`/`deleteTenant` delegan en el servicio y recargan la
 *   lista para mantener el estado sincronizado. Si se elimina el tenant activo, se
 *   preselecciona el primero restante (o `null`).
 * - El contexto de tenant (`lib/tenantContext`) es un singleton de módulo: se limpia
 *   entre pruebas para no filtrar estado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { resetActiveTenant } from '@/lib/tenantContext';
import { setTenantService, useTenantStore } from '@/store/tenantStore';
import type { ITenantService } from '@/services/tenantService';
import type { ITenantRead } from '@/api/types';

/** Fábrica de `ITenantRead` (DTO exacto del backend). */
function makeTenant(overrides: Partial<ITenantRead> = {}): ITenantRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'acme',
    name: 'Acme Corp',
    created_at: '2026-08-18T00:00:00Z',
    revision: 0,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio de tenants con las dependencias mockeadas. */
function makeTenantService(overrides: Partial<ITenantService> = {}): ITenantService {
  return {
    list: vi.fn<ITenantService['list']>().mockResolvedValue([makeTenant()]),
    create: vi.fn<ITenantService['create']>().mockResolvedValue(makeTenant()),
    update: vi.fn<ITenantService['update']>().mockResolvedValue(makeTenant()),
    delete: vi.fn<ITenantService['delete']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('tenantStore', () => {
  beforeEach(() => {
    resetActiveTenant();
    useTenantStore.getState().reset();
  });

  afterEach(() => {
    resetActiveTenant();
    useTenantStore.getState().reset();
    setTenantService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useTenantStore.getState();
    expect(state.tenants).toEqual([]);
    expect(state.activeTenantId).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('carga los tenants y preselecciona el primero como activo', async () => {
    const tenants = [makeTenant(), makeTenant({ slug: 'escobar', name: 'Escobar' })];
    const list = vi.fn<ITenantService['list']>().mockResolvedValue(tenants);
    setTenantService(makeTenantService({ list }));

    await useTenantStore.getState().loadTenants();

    expect(list).toHaveBeenCalledTimes(1);
    expect(useTenantStore.getState().tenants).toEqual(tenants);
    expect(useTenantStore.getState().activeTenantId).toBe('acme');
    expect(useTenantStore.getState().status).toBe('success');
    expect(useTenantStore.getState().error).toBeNull();
  });

  it('crea un tenant y recarga la lista para incluirlo', async () => {
    const created = makeTenant({ slug: 'nuevo', name: 'Nueva Empresa' });
    const create = vi.fn<ITenantService['create']>().mockResolvedValue(created);
    const list = vi
      .fn<ITenantService['list']>()
      .mockResolvedValue([makeTenant(), created]);
    setTenantService(makeTenantService({ create, list }));

    const result = await useTenantStore.getState().createTenant({
      slug: 'nuevo',
      name: 'Nueva Empresa',
    });

    expect(create).toHaveBeenCalledWith({ slug: 'nuevo', name: 'Nueva Empresa' });
    expect(result.slug).toBe('nuevo');
    // Tras la escritura se recarga la lista para mantener el estado sincronizado.
    expect(list).toHaveBeenCalled();
    expect(useTenantStore.getState().tenants).toHaveLength(2);
    expect(useTenantStore.getState().status).toBe('success');
  });

  it('actualiza el nombre de un tenant y recarga la lista', async () => {
    const updated = makeTenant({ name: 'Acme Renamed', revision: 1 });
    const update = vi.fn<ITenantService['update']>().mockResolvedValue(updated);
    const list = vi.fn<ITenantService['list']>().mockResolvedValue([updated]);
    setTenantService(makeTenantService({ update, list }));

    const result = await useTenantStore.getState().updateTenant('acme', {
      name: 'Acme Renamed',
    });

    expect(update).toHaveBeenCalledWith('acme', { name: 'Acme Renamed' });
    expect(result.name).toBe('Acme Renamed');
    expect(list).toHaveBeenCalled();
    expect(useTenantStore.getState().tenants[0].name).toBe('Acme Renamed');
  });

  it('elimina un tenant y recarga la lista', async () => {
    const deleteFn = vi.fn<ITenantService['delete']>().mockResolvedValue(undefined);
    const list = vi.fn<ITenantService['list']>().mockResolvedValue([makeTenant()]);
    setTenantService(makeTenantService({ delete: deleteFn, list }));

    await useTenantStore.getState().deleteTenant('escobar');

    expect(deleteFn).toHaveBeenCalledWith('escobar');
    expect(list).toHaveBeenCalled();
    expect(useTenantStore.getState().status).toBe('success');
  });

  it('preselecciona el primer tenant restante cuando se elimina el activo', async () => {
    const deleteFn = vi.fn<ITenantService['delete']>().mockResolvedValue(undefined);
    // Tras eliminar "acme" (activo), la recarga devuelve solo "escobar".
    const list = vi
      .fn<ITenantService['list']>()
      .mockResolvedValue([makeTenant({ slug: 'escobar', name: 'Escobar' })]);
    setTenantService(makeTenantService({ delete: deleteFn, list }));

    // Fija "acme" como activo en el contexto desacoplado.
    useTenantStore.getState().setActiveTenant('acme');
    await useTenantStore.getState().deleteTenant('acme');

    expect(useTenantStore.getState().tenants).toHaveLength(1);
    expect(useTenantStore.getState().activeTenantId).toBe('escobar');
  });

  it('deja el tenant activo en null cuando se elimina el último tenant', async () => {
    const deleteFn = vi.fn<ITenantService['delete']>().mockResolvedValue(undefined);
    const list = vi.fn<ITenantService['list']>().mockResolvedValue([]);
    setTenantService(makeTenantService({ delete: deleteFn, list }));

    useTenantStore.getState().setActiveTenant('acme');
    await useTenantStore.getState().deleteTenant('acme');

    expect(useTenantStore.getState().tenants).toEqual([]);
    expect(useTenantStore.getState().activeTenantId).toBeNull();
  });

  it('degrade a error cuando falla la carga de tenants', async () => {
    const list = vi
      .fn<ITenantService['list']>()
      .mockRejectedValue(new Error('red caída'));
    setTenantService(makeTenantService({ list }));

    await useTenantStore.getState().loadTenants();

    expect(useTenantStore.getState().status).toBe('error');
    expect(useTenantStore.getState().error).toBe('red caída');
  });

  it('propaga el mensaje de un AppError del servicio al crear', async () => {
    const create = vi
      .fn<ITenantService['create']>()
      .mockRejectedValue(new AppError('slug ocupado', 'tenant.create'));
    setTenantService(makeTenantService({ create }));

    await expect(
      useTenantStore.getState().createTenant({ slug: 'acme', name: 'Acme' }),
    ).rejects.toThrow('slug ocupado');
    expect(useTenantStore.getState().status).toBe('error');
    expect(useTenantStore.getState().error).toBe('slug ocupado');
  });

  it('degrade a error sin servicio registrado al crear', async () => {
    // No se registra servicio: el store debe degradar a error.
    await expect(
      useTenantStore.getState().createTenant({ slug: 'acme', name: 'Acme' }),
    ).rejects.toThrow('El selector de tenants no está disponible.');
    expect(useTenantStore.getState().status).toBe('error');
    expect(useTenantStore.getState().error).toBe('El selector de tenants no está disponible.');
  });

  it('degrade a error sin servicio registrado al eliminar', async () => {
    await expect(useTenantStore.getState().deleteTenant('acme')).rejects.toThrow(
      'El selector de tenants no está disponible.',
    );
    expect(useTenantStore.getState().status).toBe('error');
  });

  it('setActiveTenant fija el slug activo en el store y en el contexto', async () => {
    useTenantStore.getState().setActiveTenant('escobar');
    expect(useTenantStore.getState().activeTenantId).toBe('escobar');
    expect(useTenantStore.getState().error).toBeNull();
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useTenantStore.setState({
      tenants: [makeTenant()],
      activeTenantId: 'acme',
      status: 'success',
      error: null,
    });

    useTenantStore.getState().reset();

    const state = useTenantStore.getState();
    expect(state.tenants).toEqual([]);
    expect(state.activeTenantId).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });
});
