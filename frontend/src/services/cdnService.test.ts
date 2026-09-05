/**
 * Pruebas del servicio de Despliegue al CDN.
 *
 * Contrato:
 * - `BackendCdnService.deploy` delega en `IApiClient.deployToCdn` con el id de la landing.
 * - Propaga los errores de la API sin envolverlos.
 * - `createCdnService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ICdnDeployResponse } from '@/api/types';
import { BackendCdnService, createCdnService } from '@/services/cdnService';
import { makeApiClientMock } from '@/test/apiClientMocks';

/** Fábrica de `ICdnDeployResponse` (DTO exacto del backend). */
function makeDeployment(overrides: Partial<ICdnDeployResponse> = {}): ICdnDeployResponse {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    landing_id: '11111111-1111-4111-8111-111111111111',
    version: 1,
    url: 'https://cdn.omnibotia.example/landings/11111111-1111-4111-8111-111111111111/v1',
    status: 'deployed',
    deployed_at: '2026-08-19T00:00:00Z',
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

describe('BackendCdnService', () => {
  it('despliega la landing delegando en el cliente', async () => {
    const landingId = '11111111-1111-4111-8111-111111111111';
    const deployment = makeDeployment();
    const apiClient = makeApiClientMock();
    apiClient.deployToCdn = vi.fn().mockResolvedValue(deployment);
    const service = new BackendCdnService(apiClient);

    const result = await service.deploy(landingId);

    expect(apiClient.deployToCdn).toHaveBeenCalledWith(landingId);
    expect(result).toEqual(deployment);
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiError = new Error('Servicio no disponible');
    const apiClient = makeApiClientMock();
    apiClient.deployToCdn = vi.fn().mockRejectedValue(apiError);
    const service = new BackendCdnService(apiClient);

    await expect(service.deploy('11111111-1111-4111-8111-111111111111')).rejects.toBe(apiError);
  });
});

describe('createCdnService', () => {
  it('construye una implementación BackendCdnService desde el cliente', () => {
    const apiClient = makeApiClientMock();

    const service = createCdnService(apiClient);

    expect(service).toBeInstanceOf(BackendCdnService);
  });

  it('delega en el cliente inyectado durante el despliegue', async () => {
    const deployment = makeDeployment();
    const apiClient = makeApiClientMock();
    apiClient.deployToCdn = vi.fn().mockResolvedValue(deployment);

    const service = createCdnService(apiClient);
    const result = await service.deploy('11111111-1111-4111-8111-111111111111');

    expect(result).toEqual(deployment);
  });
});
