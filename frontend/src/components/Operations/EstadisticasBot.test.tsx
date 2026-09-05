/**
 * Pruebas de la sección "Estadísticas" del área de operación del bot (B.2).
 *
 * Contrato:
 * - Carga el resumen operativo al montar (una única llamada a
 *   `getStatsOverview`) y lo vuelve a recargar con el botón manual.
 * - Renderiza su eslabón del ciclo comercial (`Ciclo completo ①-⑨`).
 * - Muestra las métricas resumen como tarjetas (incluido el ratio resuelto en
 *   porcentaje), la serie de mensajes por día y el desglose por canal.
 * - Las series vacías se presentan con un estado vacío accesible.
 * - Sin servicio registrado o ante un error del store se muestra un estado
 *   vacío accesible con reintento y el mensaje en un `aria-live`.
 */
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EstadisticasBot } from '@/components/Operations/EstadisticasBot';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { makeService as makeOperationsService, makeStatsOverview } from '@/test/operationsMocks';
import { AppError } from '@/lib/errors';

describe('EstadisticasBot', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useOperationsStore.getState().reset();
    setOperationsService(null);
  });

  it('muestra la cabecera, su eslabón y carga el resumen al montar', async () => {
    const service = makeOperationsService();
    setOperationsService(service);

    render(<EstadisticasBot />);

    expect(screen.getByRole('heading', { name: 'Estadísticas' })).toBeInTheDocument();
    expect(screen.getByText('Ciclo completo ①-⑨')).toBeInTheDocument();

    await screen.findByTestId('stat-total_messages');
    expect(service.getStatsOverview).toHaveBeenCalledTimes(1);
  });

  it('muestra las métricas resumen y el ratio resuelto como tarjetas', async () => {
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () =>
          makeStatsOverview({
            total_messages: 8,
            escalated: 2,
            resolved: 1,
            unique_contacts: 9,
            resolved_ratio: 0.5,
          }),
      }),
    );

    render(<EstadisticasBot />);

    await screen.findByTestId('stat-total_messages');
    expect(within(screen.getByTestId('stat-total_messages')).getByText('8')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-escalated')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-resolved')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-unique_contacts')).getByText('9')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-resolved_ratio')).getByText('50%')).toBeInTheDocument();
  });

  it('muestra la serie de mensajes por día', async () => {
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () =>
          makeStatsOverview({
            daily: [
              { date: '2026-08-18', inbound: 4, outbound: 2, total: 6 },
              { date: '2026-08-19', inbound: 2, outbound: 1, total: 3 },
            ],
          }),
      }),
    );

    render(<EstadisticasBot />);

    await screen.findByTestId('stat-total_messages');
    const dailyTable = screen.getByTestId('daily-table');
    expect(within(dailyTable).getByText('2026-08-18')).toBeInTheDocument();
    expect(within(dailyTable).getByText('4')).toBeInTheDocument();
    expect(within(dailyTable).getByText('6')).toBeInTheDocument();
    expect(within(dailyTable).getByText('2026-08-19')).toBeInTheDocument();
    expect(within(dailyTable).getByText('3')).toBeInTheDocument();
  });

  it('muestra el desglose de mensajes por canal', async () => {
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () =>
          makeStatsOverview({
            by_channel: [
              {
                channel_id: '44444444-4444-4444-8444-444444444444',
                conversation_count: 4,
                message_count: 7,
              },
            ],
          }),
      }),
    );

    render(<EstadisticasBot />);

    await screen.findByTestId('stat-total_messages');
    const channelTable = screen.getByTestId('channel-table');
    expect(
      within(channelTable).getByText('44444444-4444-4444-8444-444444444444'),
    ).toBeInTheDocument();
    expect(within(channelTable).getByText('4')).toBeInTheDocument();
    expect(within(channelTable).getByText('7')).toBeInTheDocument();
  });

  it('muestra estados vacíos cuando no hay series por día ni por canal', async () => {
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () => makeStatsOverview({ daily: [], by_channel: [] }),
      }),
    );

    render(<EstadisticasBot />);

    await screen.findByTestId('stat-total_messages');
    expect(screen.getByText('Sin mensajes registrados en el periodo.')).toBeInTheDocument();
    expect(screen.getByText('Sin actividad por canal en el periodo.')).toBeInTheDocument();
  });

  it('recarga las estadísticas al pulsar «Recargar estadísticas»', async () => {
    const service = makeOperationsService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<EstadisticasBot />);

    await screen.findByTestId('stat-total_messages');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Recargar estadísticas' }));
    });

    expect(service.getStatsOverview).toHaveBeenCalledTimes(2);
  });

  it('muestra el error del store de forma accesible y permite reintentar', async () => {
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () => {
          throw new AppError('Fallo estadísticas', 'operations.stats.overview', {});
        },
      }),
    );

    render(<EstadisticasBot />);

    expect(await screen.findByText('No se pudieron cargar las estadísticas.')).toBeInTheDocument();
    expect(await screen.findByText('Fallo estadísticas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setOperationsService(null);

    render(<EstadisticasBot />);

    expect(await screen.findByText('No se pudieron cargar las estadísticas.')).toBeInTheDocument();
    expect(await screen.findByText('La operación del bot no está disponible.')).toBeInTheDocument();
  });
});
