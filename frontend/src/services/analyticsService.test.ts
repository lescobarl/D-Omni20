/**
 * Pruebas del servicio de Analítica Avanzada.
 *
 * Contrato:
 * - `BackendAnalyticsService.recordEvent` delega en `IApiClient.recordAnalyticsEvent`.
 * - `BackendAnalyticsService.getDashboard` delega en `IApiClient.getAnalyticsDashboard`.
 * - Propaga los errores de la API sin envolverlos.
 * - `createAnalyticsService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  IAnalyticsDashboardResponse,
  IAnalyticsEventCreateRequest,
  IAnalyticsEventRead,
} from '@/api/types';
import { BackendAnalyticsService, createAnalyticsService } from '@/services/analyticsService';
import { makeApiClientMock } from '@/test/apiClientMocks';

/** Fábrica de `IAnalyticsEventRead` (DTO exacto del backend). */
function makeEvent(overrides: Partial<IAnalyticsEventRead> = {}): IAnalyticsEventRead {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    tenant_id: 'tenant-1',
    event_type: 'landing.view',
    entity_type: 'landing',
    entity_id: '11111111-1111-4111-8111-111111111111',
    properties: {},
    occurred_at: '2026-08-19T00:00:00Z',
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IAnalyticsDashboardResponse` (DTO exacto del backend). */
function makeDashboard(
  overrides: Partial<IAnalyticsDashboardResponse> = {},
): IAnalyticsDashboardResponse {
  return {
    total_events: 3,
    by_event_type: [
      { event_type: 'landing.view', count: 2 },
      { event_type: 'workflow.completed', count: 1 },
    ],
    recent: [makeEvent()],
    ...overrides,
  };
}

describe('BackendAnalyticsService', () => {
  it('registra un evento delegando en el cliente', async () => {
    const payload: IAnalyticsEventCreateRequest = {
      event_type: 'landing.view',
      entity_type: 'landing',
      entity_id: '11111111-1111-4111-8111-111111111111',
      properties: { source: 'sidebar' },
    };
    const event = makeEvent();
    const apiClient = makeApiClientMock();
    apiClient.recordAnalyticsEvent = vi.fn().mockResolvedValue(event);
    const service = new BackendAnalyticsService(apiClient);

    const result = await service.recordEvent(payload);

    expect(apiClient.recordAnalyticsEvent).toHaveBeenCalledWith(payload);
    expect(result).toEqual(event);
  });

  it('obtiene el dashboard delegando en el cliente', async () => {
    const dashboard = makeDashboard();
    const apiClient = makeApiClientMock();
    apiClient.getAnalyticsDashboard = vi.fn().mockResolvedValue(dashboard);
    const service = new BackendAnalyticsService(apiClient);

    const result = await service.getDashboard();

    expect(apiClient.getAnalyticsDashboard).toHaveBeenCalledTimes(1);
    expect(result).toEqual(dashboard);
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiError = new Error('Servicio no disponible');
    const apiClient = makeApiClientMock();
    apiClient.getAnalyticsDashboard = vi.fn().mockRejectedValue(apiError);
    const service = new BackendAnalyticsService(apiClient);

    await expect(service.getDashboard()).rejects.toBe(apiError);
  });
});

describe('createAnalyticsService', () => {
  it('construye una implementación BackendAnalyticsService desde el cliente', () => {
    const apiClient = makeApiClientMock();

    const service = createAnalyticsService(apiClient);

    expect(service).toBeInstanceOf(BackendAnalyticsService);
  });

  it('delega en el cliente inyectado durante la obtención del dashboard', async () => {
    const dashboard = makeDashboard();
    const apiClient = makeApiClientMock();
    apiClient.getAnalyticsDashboard = vi.fn().mockResolvedValue(dashboard);

    const service = createAnalyticsService(apiClient);
    const result = await service.getDashboard();

    expect(result).toEqual(dashboard);
  });
});
