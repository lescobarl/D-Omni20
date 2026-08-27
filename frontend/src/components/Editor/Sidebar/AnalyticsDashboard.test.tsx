/**
 * Pruebas del Dashboard de Analítica Avanzada.
 *
 * Contrato:
 * - Carga el resumen del tenant al montar (`fetchDashboard`).
 * - Muestra el total de eventos, la distribución por tipo de evento (gráfica de
 *   barras accesible vía `role="img"` + `aria-label`) y los eventos recientes.
 * - Sin eventos registrados muestra el estado vacío de forma accesible.
 * - Maneja el estado de carga y de error de forma accesible (`role="status"` / `role="alert"`).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsDashboard } from '@/components/Editor/Sidebar/AnalyticsDashboard';
import { setAnalyticsService, useAnalyticsStore } from '@/store/analyticsStore';
import type { IAnalyticsDashboardResponse, IAnalyticsEventRead } from '@/api/types';
import type { IAnalyticsService } from '@/services/analyticsService';

/** Construye un evento de analítica con valores por defecto. */
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

/** Construye un resumen del dashboard con valores por defecto. */
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

describe('AnalyticsDashboard', () => {
  beforeEach(() => {
    useAnalyticsStore.getState().reset();
    setAnalyticsService(makeService());
  });

  afterEach(() => {
    // El reset corre con el componente aún montado (el cleanup de RTL se ejecuta
    // después, en orden LIFO). Se envuelve en `act` para que las actualizaciones
    // del store (status/carga tras los tests) no se filtren fuera de su ámbito
    // y disparen warnings de act().
    act(() => {
      useAnalyticsStore.getState().reset();
    });
    setAnalyticsService(null);
  });

  it('carga el dashboard y muestra el total, la distribución y los eventos recientes', async () => {
    render(<AnalyticsDashboard />);
    // Drena la carga asíncrona del resumen (`fetchDashboard`) del mount.
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Analítica' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('eventos registrados')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Por tipo de evento' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'landing.view: 2 eventos' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'workflow.completed: 1 eventos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Eventos recientes' })).toBeInTheDocument();
    expect(
      screen.getByText('landing.view — landing: 11111111-1111-4111-8111-111111111111'),
    ).toBeInTheDocument();
  });

  it('muestra el estado vacío de forma accesible sin eventos registrados', async () => {
    setAnalyticsService(
      makeService({
        getDashboard: vi
          .fn<IAnalyticsService['getDashboard']>()
          .mockResolvedValue(makeDashboard({ total_events: 0, by_event_type: [], recent: [] })),
      }),
    );
    render(<AnalyticsDashboard />);
    await act(async () => {});

    expect(screen.getByRole('status')).toHaveTextContent(
      'Aún no hay eventos de analítica registrados.',
    );
    expect(screen.queryByRole('heading', { name: 'Por tipo de evento' })).not.toBeInTheDocument();
  });

  it('muestra el estado de carga mientras se carga el dashboard', async () => {
    let resolve!: (value: IAnalyticsDashboardResponse) => void;
    setAnalyticsService(
      makeService({
        getDashboard: vi
          .fn<IAnalyticsService['getDashboard']>()
          .mockImplementation(
            () => new Promise<IAnalyticsDashboardResponse>((res) => (resolve = res)),
          ),
      }),
    );
    render(<AnalyticsDashboard />);
    await act(async () => {});

    expect(screen.getByText('Cargando analítica…')).toBeInTheDocument();

    await act(async () => {
      resolve(makeDashboard());
    });
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Por tipo de evento' })).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    setAnalyticsService(
      makeService({
        getDashboard: vi
          .fn<IAnalyticsService['getDashboard']>()
          .mockRejectedValue(new Error('Servicio no disponible')),
      }),
    );
    render(<AnalyticsDashboard />);
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
  });
});
