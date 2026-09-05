/**
 * Pruebas de la sección "Dashboard" del área de operación del bot (B.1).
 *
 * Contrato:
 * - Carga sus cuatro fuentes al montar (resumen operativo, cuota L1, cola D3 y
 *   últimas conversaciones), cada una con una única llamada a su acción.
 * - Renderiza su eslabón del ciclo comercial (`Ciclo completo ①-⑨`).
 * - Muestra los KPIs, la cuota L1 (ok/warning/exceeded), el estado de la cola
 *   y las últimas conversaciones como tarjetas.
 * - «Recargar dashboard» vuelve a invocar las cuatro acciones.
 * - Sin servicio registrado o ante un error del store se muestra un estado
 *   vacío accesible con reintento y el mensaje en un `aria-live`.
 */
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DashboardOperativo } from '@/components/Operations/DashboardOperativo';
import { setBotService, useBotStore } from '@/store/botStore';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import {
  makeConversation,
  makePage,
  makeQueueStats,
  makeQuotaUsage,
  makeService as makeBotService,
} from '@/test/botMocks';
import { makeService as makeOperationsService, makeStatsOverview } from '@/test/operationsMocks';
import { AppError } from '@/lib/errors';

describe('DashboardOperativo', () => {
  beforeEach(() => {
    useBotStore.getState().reset();
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useBotStore.getState().reset();
    setBotService(null);
    useOperationsStore.getState().reset();
    setOperationsService(null);
  });

  it('muestra la cabecera, su eslabón y carga sus cuatro fuentes al montar', async () => {
    const botService = makeBotService({
      listConversations: async () => makePage([makeConversation()]),
    });
    setBotService(botService);
    const operationsService = makeOperationsService();
    setOperationsService(operationsService);

    render(<DashboardOperativo />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Ciclo completo ①-⑨')).toBeInTheDocument();

    await screen.findByTestId('kpi-active_conversations');
    expect(operationsService.getStatsOverview).toHaveBeenCalledTimes(1);
    expect(botService.getQuotaUsage).toHaveBeenCalledTimes(1);
    expect(botService.getQueueStats).toHaveBeenCalledTimes(1);
    expect(botService.listConversations).toHaveBeenCalledTimes(1);
  });

  it('muestra los KPIs del resumen operativo como tarjetas', async () => {
    setBotService(makeBotService());
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () =>
          makeStatsOverview({
            active_conversations: 5,
            inbound_messages: 4,
            outbound_messages: 3,
            escalated: 2,
            resolved: 1,
            unique_contacts: 9,
          }),
      }),
    );

    render(<DashboardOperativo />);

    await screen.findByTestId('kpi-active_conversations');
    expect(
      within(screen.getByTestId('kpi-active_conversations')).getByText('5'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-inbound_messages')).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-outbound_messages')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-escalated')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-resolved')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-unique_contacts')).getByText('9')).toBeInTheDocument();
  });

  it('muestra la cuota L1 con su estado, tokens usados, límite y porcentaje', async () => {
    setBotService(
      makeBotService({
        getQuotaUsage: async () => makeQuotaUsage({ status: 'warning' }),
      }),
    );
    setOperationsService(makeOperationsService());

    render(<DashboardOperativo />);

    await screen.findByTestId('kpi-active_conversations');
    const quotaCard = screen.getByTestId('quota-card');
    expect(within(quotaCard).getByText('Cuota en nivel warning')).toBeInTheDocument();
    expect(within(quotaCard).getByText('25,000')).toBeInTheDocument();
    expect(within(quotaCard).getByText('100,000')).toBeInTheDocument();
    expect(within(quotaCard).getByText('25%')).toBeInTheDocument();
  });

  it('muestra el estado de la cola D3 como tarjetas', async () => {
    setBotService(
      makeBotService({
        getQueueStats: async () => makeQueueStats({ length: 3, pending: 1, dlq_count: 2 }),
      }),
    );
    setOperationsService(makeOperationsService());

    render(<DashboardOperativo />);

    await screen.findByTestId('kpi-active_conversations');
    const queueCard = screen.getByTestId('queue-card');
    expect(within(queueCard).getByText('3')).toBeInTheDocument();
    expect(within(queueCard).getByText('1')).toBeInTheDocument();
    expect(within(queueCard).getByText('2')).toBeInTheDocument();
  });

  it('muestra las últimas conversaciones con su contacto externo y estado', async () => {
    setBotService(
      makeBotService({
        listConversations: async () =>
          makePage([
            makeConversation({ external_contact_id: '5215511111111', state: 'in_progress' }),
          ]),
      }),
    );
    setOperationsService(makeOperationsService());

    render(<DashboardOperativo />);

    await screen.findByTestId('kpi-active_conversations');
    const conversationsCard = screen.getByTestId('conversations-card');
    expect(within(conversationsCard).getByText('5215511111111')).toBeInTheDocument();
    expect(within(conversationsCard).getByText('in_progress')).toBeInTheDocument();
  });

  it('recarga las cuatro fuentes al pulsar «Recargar dashboard»', async () => {
    const botService = makeBotService();
    setBotService(botService);
    const operationsService = makeOperationsService();
    setOperationsService(operationsService);
    const user = userEvent.setup();

    render(<DashboardOperativo />);

    await screen.findByTestId('kpi-active_conversations');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Recargar dashboard' }));
    });

    expect(operationsService.getStatsOverview).toHaveBeenCalledTimes(2);
    expect(botService.getQuotaUsage).toHaveBeenCalledTimes(2);
    expect(botService.getQueueStats).toHaveBeenCalledTimes(2);
    expect(botService.listConversations).toHaveBeenCalledTimes(2);
  });

  it('muestra el error del store de forma accesible y permite reintentar', async () => {
    setBotService(makeBotService());
    setOperationsService(
      makeOperationsService({
        getStatsOverview: async () => {
          throw new AppError('Fallo resumen', 'operations.stats.overview', {});
        },
      }),
    );

    render(<DashboardOperativo />);

    expect(
      await screen.findByText('No se pudieron cargar los datos del dashboard.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Fallo resumen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('degrade a error cuando no hay servicios registrados', async () => {
    setBotService(null);
    setOperationsService(null);

    render(<DashboardOperativo />);

    expect(
      await screen.findByText('No se pudieron cargar los datos del dashboard.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('La operación del bot no está disponible.')).toBeInTheDocument();
  });
});
