/**
 * Pruebas del servicio de tenants (control plane).
 *
 * Contrato:
 * - `BackendTenantService` delega en `IApiClient` los endpoints control plane
 *   `/api/v1/tenants` (sin cabecera de tenant) para listar, crear, actualizar y
 *   eliminar tenants.
 * - `createTenantService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ITenantRead } from '@/api/types';
import {
  BackendTenantService,
  createTenantService,
  type ITenantService,
} from '@/services/tenantService';
import { makeApiClientMock } from '@/test/apiClientMocks';

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

describe('BackendTenantService', () => {
  it('lista los tenants delegando en el cliente (control plane)', async () => {
    const apiClient = makeApiClientMock();
    const listTenants = vi
      .fn<typeof apiClient.listTenants>()
      .mockResolvedValue([makeTenant(), makeTenant({ slug: 'escobar', name: 'Escobar' })]);
    apiClient.listTenants = listTenants;
    const service = new BackendTenantService(apiClient);

    const result = await service.list();

    expect(listTenants).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[1].slug).toBe('escobar');
  });

  it('crea un tenant delegando el payload en el cliente', async () => {
    const apiClient = makeApiClientMock();
    const created = makeTenant({ slug: 'nuevo', name: 'Nueva Empresa' });
    const createTenant = vi
      .fn<typeof apiClient.createTenant>()
      .mockResolvedValue(created);
    apiClient.createTenant = createTenant;
    const service = new BackendTenantService(apiClient);

    const result = await service.create({ slug: 'nuevo', name: 'Nueva Empresa' });

    expect(createTenant).toHaveBeenCalledWith({ slug: 'nuevo', name: 'Nueva Empresa' });
    expect(result.slug).toBe('nuevo');
  });

  it('actualiza el nombre de un tenant por su slug delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    const updated = makeTenant({ name: 'Acme Renamed', revision: 1 });
    const updateTenant = vi
      .fn<typeof apiClient.updateTenant>()
      .mockResolvedValue(updated);
    apiClient.updateTenant = updateTenant;
    const service = new BackendTenantService(apiClient);

    const result = await service.update('acme', { name: 'Acme Renamed' });

    expect(updateTenant).toHaveBeenCalledWith('acme', { name: 'Acme Renamed' });
    expect(result.name).toBe('Acme Renamed');
  });

  it('elimina un tenant por su slug delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    const deleteTenant = vi.fn<typeof apiClient.deleteTenant>().mockResolvedValue(undefined);
    apiClient.deleteTenant = deleteTenant;
    const service = new BackendTenantService(apiClient);

    await service.delete('acme');

    expect(deleteTenant).toHaveBeenCalledWith('acme');
  });

  it('propaga los errores de la API sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const error = new Error('boom');
    apiClient.listTenants = vi.fn<typeof apiClient.listTenants>().mockRejectedValue(error);
    const service = new BackendTenantService(apiClient);

    await expect(service.list()).rejects.toBe(error);
  });
});

describe('createTenantService', () => {
  it('construye una implementación BackendTenantService desde el cliente', () => {
    const service = createTenantService(makeApiClientMock());
    expect(service).toBeInstanceOf(BackendTenantService);
  });

  it('delega en el cliente inyectado durante la creación de un tenant', async () => {
    const apiClient = makeApiClientMock();
    const created = makeTenant();
    apiClient.createTenant = vi.fn<typeof apiClient.createTenant>().mockResolvedValue(created);
    const service: ITenantService = createTenantService(apiClient);

    const result = await service.create({ slug: 'acme', name: 'Acme Corp' });

    expect(apiClient.createTenant).toHaveBeenCalledWith({ slug: 'acme', name: 'Acme Corp' });
    expect(result.slug).toBe('acme');
  });
});
