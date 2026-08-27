/**
 * Pruebas del store de Analítica Avanzada.
 *
 * Contrato:
 * - `fetchDashboard` carga el resumen del dashboard del tenant vía el servicio registrado.
 * - Sin servicio registrado, `fetchDashboard` degrada a error explicado de forma accesible.
 * - Propaga los mensajes de `AppError`, de `Error` genéricos y usa un mensaje por defecto
 *   cuando el error no es una instancia de `Error`.
 * - `reset` descarta el dashboard y vuelve al estado inicial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAnalyticsDashboardResponse, IAnalyticsEventRead } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IAnalyticsService } from '@/services/analyticsService';
import { setAnalyticsService, useAnalyticsStore } from '@/store/analyticsStore';

/** Fábrica de `IAnalyticsEventRead` con valores por defecto. */
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

/** Fábrica de `IAnalyticsDashboardResponse` con valores por defecto. */
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

/** Construye un servicio falso que registra llamadas y devuelve valores dados. */
function makeService(overrides: Partial<IAnalyticsService> = {}): IAnalyticsService {
  return {
    recordEvent: vi.fn<IAnalyticsService['recordEvent']>().mockResolvedValue(makeEvent()),
    getDashboard: vi.fn<IAnalyticsService['getDashboard']>().mockResolvedValue(makeDashboard()),
    ...overrides,
  };
}

describe('analyticsStore', () => {
  beforeEach(() => {
    useAnalyticsStore.getState().reset();
    setAnalyticsService(null);
  });

  afterEach(() => {
    useAnalyticsStore.getState().reset();
    setAnalyticsService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useAnalyticsStore.getState();
    expect(state.dashboard).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('carga el dashboard y guarda el resumen', async () => {
    const dashboard = makeDashboard();
    setAnalyticsService(
      makeService({
        getDashboard: vi.fn<IAnalyticsService['getDashboard']>().mockResolvedValue(dashboard),
      }),
    );

    await useAnalyticsStore.getState().fetchDashboard();

    const state = useAnalyticsStore.getState();
    expect(state.dashboard).toEqual(dashboard);
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
  });

  it('pasa a loading mientras la carga del dashboard está pendiente', async () => {
    let resolve!: (value: IAnalyticsDashboardResponse) => void;
    const getDashboard = vi
      .fn<IAnalyticsService['getDashboard']>()
      .mockImplementation(() => new Promise<IAnalyticsDashboardResponse>((res) => (resolve = res)));
    setAnalyticsService(makeService({ getDashboard }));

    const pending = useAnalyticsStore.getState().fetchDashboard();

    expect(useAnalyticsStore.getState().status).toBe('loading');

    resolve(makeDashboard());
    await pending;

    expect(useAnalyticsStore.getState().status).toBe('success');
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setAnalyticsService(null);

    await useAnalyticsStore.getState().fetchDashboard();

    expect(useAnalyticsStore.getState().status).toBe('error');
    expect(useAnalyticsStore.getState().error).toBe('La analítica no está disponible.');
  });

  it('propaga el mensaje de un AppError del servicio', async () => {
    const getDashboard = vi
      .fn<IAnalyticsService['getDashboard']>()
      .mockRejectedValue(
        new AppError('Analítica no disponible', 'analytics.dashboard.get', { reason: 'timeout' }),
      );
    setAnalyticsService(makeService({ getDashboard }));

    await useAnalyticsStore.getState().fetchDashboard();

    expect(useAnalyticsStore.getState().status).toBe('error');
    expect(useAnalyticsStore.getState().error).toBe('Analítica no disponible');
  });

  it('propaga el mensaje de un Error genérico del servicio', async () => {
    const getDashboard = vi
      .fn<IAnalyticsService['getDashboard']>()
      .mockRejectedValue(new Error('Servicio no disponible'));
    setAnalyticsService(makeService({ getDashboard }));

    await useAnalyticsStore.getState().fetchDashboard();

    expect(useAnalyticsStore.getState().status).toBe('error');
    expect(useAnalyticsStore.getState().error).toBe('Servicio no disponible');
  });

  it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
    const getDashboard = vi
      .fn<IAnalyticsService['getDashboard']>()
      .mockRejectedValue('fallo desconocido');
    setAnalyticsService(makeService({ getDashboard }));

    await useAnalyticsStore.getState().fetchDashboard();

    expect(useAnalyticsStore.getState().status).toBe('error');
    expect(useAnalyticsStore.getState().error).toBe(
      'No se pudo cargar la analítica. Inténtalo de nuevo.',
    );
  });

  it('reset descarta el dashboard y vuelve al estado inicial', async () => {
    const dashboard = makeDashboard();
    setAnalyticsService(
      makeService({
        getDashboard: vi.fn<IAnalyticsService['getDashboard']>().mockResolvedValue(dashboard),
      }),
    );
    await useAnalyticsStore.getState().fetchDashboard();
    useAnalyticsStore.getState().reset();

    const state = useAnalyticsStore.getState();
    expect(state.dashboard).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });
});
