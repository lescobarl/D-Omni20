import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealDrawer } from '@/components/Crm/DealDrawer';
import type { ITaskInput } from '@/services/crmService';
import { setCrmService, useCrmStore } from '@/store/crmStore';
import { makeDeal, makeService, makeSla, makeStage, makeTask } from '@/test/crmMocks';

const DEAL_ID = '22222222-2222-4222-8222-222222222222';
const STAGE_ID = '11111111-1111-4111-8111-111111111111';
const LOST_ID = '66666666-6666-4666-8666-666666666666';
const WON_ID = '77777777-7777-4777-8777-777777777777';

function seedDealState(): void {
  useCrmStore.setState({
    deals: [
      makeDeal({
        id: DEAL_ID,
        stage_id: STAGE_ID,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
    ],
    stages: [
      makeStage({ id: STAGE_ID }),
      makeStage({ id: LOST_ID, name: 'Perdida', order: 1, is_terminal: true, outcome: 'lost' }),
      makeStage({ id: WON_ID, name: 'Ganada', order: 2, is_terminal: true, outcome: 'won' }),
    ],
    sla: [makeSla()],
    tasks: [makeTask({ deal_id: DEAL_ID, title: 'Seguimiento de visita' })],
  });
}

describe('DealDrawer', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
    setCrmService(null);
  });

  it('muestra el estado de oportunidad no encontrada', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    const onClose = vi.fn();
    render(<DealDrawer dealId="missing-deal" onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Oportunidad no encontrada')).toBeInTheDocument();
    expect(screen.getByText('La oportunidad ya no está disponible.')).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('muestra los datos de la oportunidad y su historial', async () => {
    const service = makeService();
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Casa Vista al Lago')).toBeInTheDocument();
    expect(screen.getByText(/Prospección · \$35,000\.00 · 25%/)).toBeInTheDocument();
    expect(screen.getByText('SLA al día')).toBeInTheDocument();
    expect(await screen.findByText('— → Prospección')).toBeInTheDocument();
    expect(screen.getByText('Seguimiento de visita')).toBeInTheDocument();
    expect(service.listDealHistory).toHaveBeenCalledWith(DEAL_ID);
  });

  it('valida la selección de la etapa de destino', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    });
    expect(screen.getByText('Selecciona una etapa de destino.')).toBeInTheDocument();
    expect(service.updateDeal).not.toHaveBeenCalled();
  });

  it('valida el motivo de la pérdida antes de mover a una etapa terminal perdida', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await user.selectOptions(screen.getByLabelText('Etapa destino *'), LOST_ID);
    expect(screen.getByText('Motivo de la pérdida *')).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    });
    expect(
      screen.getByText(
        'Indica el motivo de la pérdida antes de mover a una etapa terminal perdida.',
      ),
    ).toBeInTheDocument();
    expect(service.updateDeal).not.toHaveBeenCalled();
  });

  it('mueve la oportunidad de etapa con motivo de pérdida', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await user.selectOptions(screen.getByLabelText('Etapa destino *'), LOST_ID);
    await user.type(
      screen.getByLabelText('Motivo de la pérdida *'),
      'Cliente se fue con la competencia',
    );
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    });
    expect(service.updateDeal).toHaveBeenCalledWith(DEAL_ID, {
      stageId: LOST_ID,
      lostReason: 'Cliente se fue con la competencia',
      note: undefined,
    });
  });

  it('marca como ganada con la acción rápida', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Marcar como ganada' }));
    });
    expect(service.updateDeal).toHaveBeenCalledWith(DEAL_ID, {
      stageId: WON_ID,
      lostReason: undefined,
      note: undefined,
    });
  });

  it('valida el motivo antes de marcar como perdida', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Marcar como perdida' }));
    });
    expect(
      screen.getByText('Indica el motivo de la pérdida antes de marcar como perdida.'),
    ).toBeInTheDocument();
    expect(service.updateDeal).not.toHaveBeenCalled();
  });

  it('crea una tarea asociada a la oportunidad', async () => {
    const user = userEvent.setup();
    const service = makeService({
      createDealTask: vi.fn(async (dealId: string, input: ITaskInput) =>
        makeTask({ title: input.title, deal_id: dealId }),
      ),
    });
    setCrmService(service);
    seedDealState();
    render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await user.type(screen.getByLabelText('Título *'), 'Solicitar documentación');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    });
    expect(service.createDealTask).toHaveBeenCalledWith(DEAL_ID, {
      title: 'Solicitar documentación',
      dueAt: null,
      priority: undefined,
    });
    expect(await screen.findByText('Solicitar documentación')).toBeInTheDocument();
  });

  it('no presenta violaciones de accesibilidad', async () => {
    const service = makeService();
    setCrmService(service);
    seedDealState();
    const { container } = render(<DealDrawer dealId={DEAL_ID} onClose={() => undefined} />);
    await expect(container).toHaveNoViolations();
  });
});
