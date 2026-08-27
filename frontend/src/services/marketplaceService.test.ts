/**
 * Pruebas del servicio del Marketplace de Templates.
 *
 * Contrato:
 * - `BackendMarketplaceService.list` delega en `IApiClient.listMarketplaceTemplates` y
 *   devuelve los items de la primera página (normalizando la respuesta paginada).
 * - `list` propaga la categoría activa del filtro al backend (filtro server-side).
 * - `create` delega en `IApiClient.createMarketplaceTemplate`.
 * - `importTemplate` envía `campaign_id` y recorta el nombre opcional (omitiéndolo si queda vacío).
 * - `createMarketplaceService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IApiClient } from '@/api/client';
import type {
  IMarketplaceImportResponse,
  IMarketplaceTemplateCreateRequest,
  IMarketplaceTemplateRead,
} from '@/api/types';
import { BackendMarketplaceService, createMarketplaceService } from '@/services/marketplaceService';

/** Construye un doble de `IApiClient` con todos los métodos del contrato. */
function makeApiClientMock(): IApiClient {
  return {
    health: vi.fn(),
    listLandings: vi.fn(),
    getLanding: vi.fn(),
    createLanding: vi.fn(),
    updateLanding: vi.fn(),
    deleteLanding: vi.fn(),
    publishLanding: vi.fn(),
    compileLanding: vi.fn(),
    generateLanding: vi.fn(),
    generateSchema: vi.fn(),
    listSchemas: vi.fn(),
    validateSchema: vi.fn(),
    listSchemaVersions: vi.fn(),
    createSchemaVersion: vi.fn(),
    createCheckout: vi.fn(),
    confirmCheckout: vi.fn(),
    captureLead: vi.fn(),
    generateQuote: vi.fn(),
    scheduleAppointment: vi.fn(),
    listMarketplaceTemplates: vi.fn(),
    createMarketplaceTemplate: vi.fn(),
    importMarketplaceTemplate: vi.fn(),
    recordAnalyticsEvent: vi.fn(),
    getAnalyticsDashboard: vi.fn(),
    deployToCdn: vi.fn(),
  };
}

/** Fábrica de `IMarketplaceTemplateRead` (DTO exacto del backend). */
function makeTemplate(overrides: Partial<IMarketplaceTemplateRead> = {}): IMarketplaceTemplateRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'tenant-1',
    name: 'Landing de Ventas',
    description: 'Landing de conversión para ventas.',
    category: 'ventas',
    config: { title: 'Nueva Landing', workflowType: 'direct_checkout', blocks: [] },
    thumbnail_url: null,
    is_public: true,
    downloads: 12,
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IMarketplaceImportResponse` (DTO exacto del backend). */
function makeImportResponse(
  overrides: Partial<IMarketplaceImportResponse> = {},
): IMarketplaceImportResponse {
  return {
    template: makeTemplate(),
    landing_id: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  };
}

describe('BackendMarketplaceService', () => {
  it('lista los templates de la primera página del catálogo', async () => {
    const template = makeTemplate();
    const apiClient = makeApiClientMock();
    apiClient.listMarketplaceTemplates = vi.fn().mockResolvedValue({
      items: [template],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const service = new BackendMarketplaceService(apiClient);

    const result = await service.list();

    expect(apiClient.listMarketplaceTemplates).toHaveBeenCalledTimes(1);
    expect(apiClient.listMarketplaceTemplates).toHaveBeenCalledWith({}, undefined);
    expect(result).toEqual([template]);
  });

  it('propaga la categoría activa del filtro al backend', async () => {
    const apiClient = makeApiClientMock();
    apiClient.listMarketplaceTemplates = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    });
    const service = new BackendMarketplaceService(apiClient);

    await service.list('ventas');

    expect(apiClient.listMarketplaceTemplates).toHaveBeenCalledWith({}, 'ventas');
  });

  it('publica un template delegando en el cliente', async () => {
    const input: IMarketplaceTemplateCreateRequest = {
      name: 'Landing de Ventas',
      category: 'ventas',
      config: { title: 'Nueva Landing' },
      is_public: true,
    };
    const created = makeTemplate();
    const apiClient = makeApiClientMock();
    apiClient.createMarketplaceTemplate = vi.fn().mockResolvedValue(created);
    const service = new BackendMarketplaceService(apiClient);

    const result = await service.create(input);

    expect(apiClient.createMarketplaceTemplate).toHaveBeenCalledWith(input);
    expect(result).toEqual(created);
  });

  it('importa un template enviando la campaña y el nombre recortado', async () => {
    const response = makeImportResponse();
    const apiClient = makeApiClientMock();
    apiClient.importMarketplaceTemplate = vi.fn().mockResolvedValue(response);
    const service = new BackendMarketplaceService(apiClient);

    const result = await service.importTemplate('template-1', 'campaign-1', '  Mi landing  ');

    expect(apiClient.importMarketplaceTemplate).toHaveBeenCalledTimes(1);
    expect(apiClient.importMarketplaceTemplate).toHaveBeenCalledWith('template-1', {
      campaign_id: 'campaign-1',
      name: 'Mi landing',
    });
    expect(result).toEqual(response);
  });

  it('omite el nombre de la importación cuando es solo espacios', async () => {
    const apiClient = makeApiClientMock();
    apiClient.importMarketplaceTemplate = vi.fn().mockResolvedValue(makeImportResponse());
    const service = new BackendMarketplaceService(apiClient);

    await service.importTemplate('template-1', 'campaign-1', '   ');

    expect(apiClient.importMarketplaceTemplate).toHaveBeenCalledWith('template-1', {
      campaign_id: 'campaign-1',
    });
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiError = new Error('Servicio no disponible');
    const apiClient = makeApiClientMock();
    apiClient.listMarketplaceTemplates = vi.fn().mockRejectedValue(apiError);
    const service = new BackendMarketplaceService(apiClient);

    await expect(service.list()).rejects.toBe(apiError);
  });
});

describe('createMarketplaceService', () => {
  it('construye una implementación BackendMarketplaceService desde el cliente', () => {
    const apiClient = makeApiClientMock();

    const service = createMarketplaceService(apiClient);

    expect(service).toBeInstanceOf(BackendMarketplaceService);
  });

  it('delega en el cliente inyectado durante la importación', async () => {
    const response = makeImportResponse();
    const apiClient = makeApiClientMock();
    apiClient.importMarketplaceTemplate = vi.fn().mockResolvedValue(response);

    const service = createMarketplaceService(apiClient);
    const result = await service.importTemplate('template-1', 'campaign-1');

    expect(result).toEqual(response);
  });
});
