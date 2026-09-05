/**
 * Pruebas de la sección "Monitor" del área de operación del bot (B.8).
 *
 * Contrato:
 * - Carga las estadísticas de la cola D3 al montar (una sola llamada a
 *   `getQueueStats`) y las vuelve a recargar con el botón manual.
 * - Renderiza su eslabón del ciclo comercial (`Operación continua`) para
 *   respetar el contrato de `OperationsArea` (todas las pestañas muestran su
 *   eslabón).
 * - Muestra el stream y cada métrica de la cola como tarjeta; `consumer_lag`
 *   nulo se presenta como «No aplica».
 * - La subtab «Conversaciones Activas» carga las conversaciones del bot al
 *   montar, las muestra como filas expandibles y permite recargarlas.
 * - Sin servicio registrado o ante un error del store se muestra un estado
 *   vacío accesible con reintento y el mensaje en un `aria-live`.
 */
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MonitorSection } from '@/components/Operations/MonitorSection';
import { setBotService, useBotStore } from '@/store/botStore';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { makeQueueStats, makeService as makeBotService } from '@/test/botMocks';
import {
  makeActiveConversation,
  makePage,
  makeService as makeOperationsService,
} from '@/test/operationsMocks';
import type { IOperationsService } from '@/services/operationsService';
import { AppError } from '@/lib/errors';

describe('MonitorSection', () => {
  beforeEach(() => {
    useBotStore.getState().reset();
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useBotStore.getState().reset();
    useOperationsStore.getState().reset();
    setBotService(null);
    setOperationsService(null);
  });

  it('muestra la cabecera, su eslabón y el stream de la cola al cargar', async () => {
    const service = makeBotService();
    setBotService(service);

    render(<MonitorSection />);

    expect(screen.getByRole('heading', { name: 'Monitor' })).toBeInTheDocument();
    expect(screen.getByText('Operación continua')).toBeInTheDocument();
    expect(await screen.findByText('d3:dev-tenant')).toBeInTheDocument();
    expect(service.getQueueStats).toHaveBeenCalledTimes(1);
  });

  it('muestra las métricas de la cola D3 como tarjetas', async () => {
    const service = makeBotService({
      getQueueStats: async () =>
        makeQueueStats({
          length: 3,
          pending: 1,
          consumer_lag: 5,
          dlq_count: 2,
          enqueued: 12,
          processed: 9,
          failed: 1,
        }),
    });
    setBotService(service);

    render(<MonitorSection />);

    await screen.findByText('d3:dev-tenant');
    expect(within(screen.getByTestId('metric-length')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-pending')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-consumer_lag')).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-dlq_count')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-enqueued')).getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-processed')).getByText('9')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-failed')).getByText('1')).toBeInTheDocument();
  });

  it('muestra «No aplica» cuando el rezago del consumidor es null', async () => {
    const service = makeBotService();
    setBotService(service);

    render(<MonitorSection />);

    await screen.findByText('d3:dev-tenant');
    expect(
      within(screen.getByTestId('metric-consumer_lag')).getByText('No aplica'),
    ).toBeInTheDocument();
  });

  it('recarga las estadísticas al pulsar «Recargar estadísticas»', async () => {
    const service = makeBotService();
    setBotService(service);
    const user = userEvent.setup();

    render(<MonitorSection />);

    await screen.findByText('d3:dev-tenant');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Recargar estadísticas' }));
    });

    expect(service.getQueueStats).toHaveBeenCalledTimes(2);
  });

  it('muestra el error del store de forma accesible y permite reintentar', async () => {
    const service = makeBotService({
      getQueueStats: async () => {
        throw new AppError('Fallo de cola', 'bot.queue.stats', {});
      },
    });
    setBotService(service);

    render(<MonitorSection />);

    expect(
      await screen.findByText('No se pudieron cargar las estadísticas de la cola.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Fallo de cola')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setBotService(null);

    render(<MonitorSection />);

    expect(
      await screen.findByText('No se pudieron cargar las estadísticas de la cola.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('El servicio de bots no está disponible.')).toBeInTheDocument();
  });

  it('muestra las conversaciones activas como filas expandibles', async () => {
    const listActiveConversations = vi
      .fn<IOperationsService['listActiveConversations']>()
      .mockResolvedValue(
        makePage([
          makeActiveConversation({
            id: 'conv-1',
            external_contact_id: '+521234567890',
            channel_id: 'chan-1',
            state: 'open',
            is_active: true,
            unread_count: 2,
            message_count: 5,
            last_message_content: '¿Cuándo llega mi pedido?',
            last_message_direction: 'inbound',
          }),
          makeActiveConversation({
            id: 'conv-2',
            external_contact_id: '+521111222333',
            channel_id: 'chan-2',
            state: 'resolved',
            is_active: false,
            unread_count: 0,
            message_count: 1,
            last_message_content: null,
            last_message_direction: null,
          }),
        ]),
      );
    const service = makeOperationsService({ listActiveConversations });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MonitorSection />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Conversaciones Activas' }));
    });

    expect(await screen.findByText('+521234567890')).toBeInTheDocument();
    expect(screen.getByText('+521111222333')).toBeInTheDocument();
    expect(service.listActiveConversations).toHaveBeenCalledTimes(1);

    // Expande la primera conversación para ver el detalle.
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /\+521234567890/ }));
    });
    expect(screen.getByText('¿Cuándo llega mi pedido?')).toBeInTheDocument();
    expect(screen.getByText('Abierta')).toBeInTheDocument();
    expect(screen.getByText('Entrante')).toBeInTheDocument();
  });

  it('recarga las conversaciones activas al pulsar «Recargar conversaciones»', async () => {
    const service = makeOperationsService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MonitorSection />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Conversaciones Activas' }));
    });

    await screen.findByText('+521234567890');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Recargar conversaciones' }));
    });

    expect(service.listActiveConversations).toHaveBeenCalledTimes(2);
  });

  it('muestra el error de conversaciones de forma accesible y permite reintentar', async () => {
    const service = makeOperationsService({
      listActiveConversations: async () => {
        throw new AppError(
          'Fallo de conversaciones',
          'operations.monitor.active-conversations',
          {},
        );
      },
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MonitorSection />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Conversaciones Activas' }));
    });

    expect(
      await screen.findByText('No se pudieron cargar las conversaciones activas.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Fallo de conversaciones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('degrade a error en conversaciones cuando no hay servicio registrado', async () => {
    setOperationsService(null);
    const user = userEvent.setup();

    render(<MonitorSection />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Conversaciones Activas' }));
    });

    expect(
      await screen.findByText('No se pudieron cargar las conversaciones activas.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('La operación del bot no está disponible.')).toBeInTheDocument();
  });
});
