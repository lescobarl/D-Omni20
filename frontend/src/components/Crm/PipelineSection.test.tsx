import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmSection } from '@/components/Crm/PipelineSection';
import { setCrmService, useCrmStore } from '@/store/crmStore';
import { makeDeal, makePage, makeService, makeStage } from '@/test/crmMocks';

const DEAL_ID = '22222222-2222-4222-8222-222222222222';

describe('CrmSection', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
    setCrmService(null);
  });

  it('muestra el encabezado de Ventas y carga los datos del pipeline', async () => {
    const service = makeService();
    setCrmService(service);
    render(<CrmSection />);
    expect(screen.getByRole('heading', { name: 'Ventas' })).toBeInTheDocument();
    expect(
      screen.getByText('Pipeline comercial con Kanban, tareas, SLA y embudo (CRM P3).'),
    ).toBeInTheDocument();
    expect(service.listStages).toHaveBeenCalledTimes(1);
    expect(service.listDeals).toHaveBeenCalledTimes(1);
    expect(service.listTasks).toHaveBeenCalledTimes(1);
    expect(service.listSla).toHaveBeenCalledTimes(1);
    expect(service.getFunnel).toHaveBeenCalledTimes(1);
  });

  it('muestra el estado de carga del pipeline', () => {
    useCrmStore.setState({
      stages: [],
      stagesStatus: 'loading',
      deals: [],
      dealsStatus: 'loading',
    });
    const never = (): Promise<never> => new Promise(() => undefined);
    const service = makeService({
      listStages: vi.fn(never),
      listDeals: vi.fn(never),
      listTasks: vi.fn(never),
      listSla: vi.fn(never),
      getFunnel: vi.fn(never),
    });
    setCrmService(service);
    render(<CrmSection />);
    expect(screen.getByText('Cargando pipeline…')).toBeInTheDocument();
  });

  it('muestra el tablero Kanban con las oportunidades cargadas', async () => {
    const service = makeService({
      listStages: vi.fn(async () => [makeStage()]),
      listDeals: vi.fn(async () => makePage([makeDeal()])),
    });
    setCrmService(service);
    render(<CrmSection />);
    expect(await screen.findByText('Casa Vista al Lago')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Etapa Prospección, 1 oportunidades' }),
    ).toBeInTheDocument();
  });

  it('cambia entre las vistas del CRM', async () => {
    const user = userEvent.setup();
    const service = makeService({
      listStages: vi.fn(async () => [makeStage()]),
      listDeals: vi.fn(async () => makePage([makeDeal()])),
    });
    setCrmService(service);
    render(<CrmSection />);
    await screen.findByText('Casa Vista al Lago');
    await user.click(screen.getByRole('button', { name: 'Tareas' }));
    expect(screen.getByRole('button', { name: 'Tareas' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('form', { name: 'Crear tarea' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'SLA' }));
    expect(screen.getByRole('form', { name: 'Política SLA de Prospección' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Embudo' }));
    expect(screen.getByText('Oportunidades')).toBeInTheDocument();
  });

  it('abre el detalle de la oportunidad desde el tablero', async () => {
    const user = userEvent.setup();
    const service = makeService({
      listStages: vi.fn(async () => [makeStage()]),
      listDeals: vi.fn(async () => makePage([makeDeal()])),
    });
    setCrmService(service);
    render(<CrmSection />);
    const openButton = await screen.findByRole('button', {
      name: 'Abrir oportunidad Casa Vista al Lago',
    });
    await act(async () => {
      await user.click(openButton);
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(service.listDealHistory).toHaveBeenCalledWith(DEAL_ID);
  });

  it('muestra los errores de carga de forma accesible', async () => {
    const service = makeService({
      listStages: vi.fn(async () => {
        throw 'stages-failed';
      }),
    });
    setCrmService(service);
    render(<CrmSection />);
    expect(
      await screen.findByText('No se pudieron cargar las etapas del pipeline.'),
    ).toBeInTheDocument();
  });

  it('no presenta violaciones de accesibilidad', async () => {
    const service = makeService({
      listStages: vi.fn(async () => [makeStage()]),
      listDeals: vi.fn(async () => makePage([makeDeal()])),
    });
    setCrmService(service);
    const { container } = render(<CrmSection />);
    await expect(container).toHaveNoViolations();
  });
});
