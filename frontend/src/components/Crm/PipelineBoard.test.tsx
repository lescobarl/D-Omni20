import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PipelineBoard } from '@/components/Crm/PipelineBoard';
import { makeDeal, makeStage } from '@/test/crmMocks';

describe('PipelineBoard', () => {
  it('muestra el estado vacío cuando no hay etapas', () => {
    render(<PipelineBoard stages={[]} deals={[]} onOpenDeal={() => undefined} />);
    expect(screen.getByRole('region', { name: 'Tablero Kanban del pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Aún no hay etapas configuradas en el pipeline.',
    );
  });

  it('agrupa las oportunidades por etapa y ordena las columnas por order', () => {
    const prospeccion = makeStage({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'Prospección',
      order: 0,
    });
    const cierre = makeStage({
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      name: 'Cierre',
      order: 1,
    });
    const dealProsp = makeDeal({
      id: 'cccccccc-0000-4000-8000-000000000003',
      title: 'Casa del Sol',
      stage_id: prospeccion.id,
    });
    const dealCierre = makeDeal({
      id: 'dddddddd-0000-4000-8000-000000000004',
      title: 'Departamento Centro',
      stage_id: cierre.id,
    });
    render(
      <PipelineBoard
        stages={[cierre, prospeccion]}
        deals={[dealCierre, dealProsp]}
        onOpenDeal={() => undefined}
      />,
    );
    expect(
      screen.getByRole('group', { name: 'Etapa Prospección, 1 oportunidades' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Etapa Cierre, 1 oportunidades' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Casa del Sol')).toBeInTheDocument();
    expect(screen.getByText('Departamento Centro')).toBeInTheDocument();
  });

  it('ordena las oportunidades dentro de la etapa por fecha de creación', () => {
    const stage = makeStage();
    const older = makeDeal({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      title: 'Más antigua',
      stage_id: stage.id,
      created_at: '2026-08-01T12:00:00.000Z',
    });
    const newer = makeDeal({
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      title: 'Más reciente',
      stage_id: stage.id,
      created_at: '2026-08-10T12:00:00.000Z',
    });
    const { container } = render(
      <PipelineBoard stages={[stage]} deals={[newer, older]} onOpenDeal={() => undefined} />,
    );
    const cards = container.querySelectorAll('button[aria-label^="Abrir oportunidad"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Más antigua');
    expect(cards[1]).toHaveTextContent('Más reciente');
  });

  it('muestra "Sin oportunidades" en columnas vacías', () => {
    const stage = makeStage();
    render(<PipelineBoard stages={[stage]} deals={[]} onOpenDeal={() => undefined} />);
    expect(screen.getByText('Sin oportunidades')).toBeInTheDocument();
  });

  it('abre la oportunidad al hacer clic en la tarjeta', async () => {
    const user = userEvent.setup();
    const stage = makeStage();
    const deal = makeDeal({ stage_id: stage.id });
    const onOpenDeal = vi.fn();
    render(<PipelineBoard stages={[stage]} deals={[deal]} onOpenDeal={onOpenDeal} />);
    await user.click(screen.getByRole('button', { name: 'Abrir oportunidad Casa Vista al Lago' }));
    expect(onOpenDeal).toHaveBeenCalledWith(deal.id);
  });

  it('mueve el foco entre columnas con las flechas del teclado', () => {
    const a = makeStage({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'Prospección',
      order: 0,
    });
    const b = makeStage({ id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Cierre', order: 1 });
    render(<PipelineBoard stages={[a, b]} deals={[]} onOpenDeal={() => undefined} />);
    const first = screen.getByRole('group', { name: 'Etapa Prospección, 0 oportunidades' });
    const second = screen.getByRole('group', { name: 'Etapa Cierre, 0 oportunidades' });
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);
  });

  it('no presenta violaciones de accesibilidad', async () => {
    const stage = makeStage();
    const deal = makeDeal({ stage_id: stage.id });
    const { container } = render(
      <PipelineBoard stages={[stage]} deals={[deal]} onOpenDeal={() => undefined} />,
    );
    await expect(container).toHaveNoViolations();
  });
});
