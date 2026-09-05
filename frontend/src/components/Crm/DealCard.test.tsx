import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealCard } from '@/components/Crm/DealCard';
import { useCrmStore } from '@/store/crmStore';
import { makeDeal, makeSla } from '@/test/crmMocks';

const HOUR_MS = 60 * 60 * 1000;

describe('DealCard', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
  });

  it('muestra el título y el monto formateado en MXN', () => {
    useCrmStore.setState({ sla: [makeSla()] });
    render(<DealCard deal={makeDeal()} onOpen={() => undefined} />);
    expect(screen.getByText('Casa Vista al Lago')).toBeInTheDocument();
    expect(screen.getByText('$35,000.00')).toBeInTheDocument();
  });

  it('muestra "Sin propietario" y el porcentaje de probabilidad cuando no hay owner', () => {
    useCrmStore.setState({ sla: [makeSla()] });
    render(<DealCard deal={makeDeal({ probability: 25 })} onOpen={() => undefined} />);
    expect(screen.getByText('Sin propietario')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('muestra el prefijo corto del propietario y oculta la probabilidad cuando no está definida', () => {
    useCrmStore.setState({ sla: [makeSla()] });
    render(
      <DealCard
        deal={makeDeal({
          owner_id: 'aabbccdd-0000-4000-8000-000000000000',
          probability: undefined,
        })}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('aabbccdd')).toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('muestra la insignia SLA al día cuando la política del store lo permite', () => {
    useCrmStore.setState({ sla: [makeSla({ max_response_hours: 4, max_stay_days: 15 })] });
    const deal = makeDeal({ created_at: new Date(Date.now() - 2 * HOUR_MS).toISOString() });
    render(<DealCard deal={deal} onOpen={() => undefined} />);
    expect(screen.getByText('SLA al día')).toBeInTheDocument();
  });

  it('abre la oportunidad al hacer clic', async () => {
    const user = userEvent.setup();
    useCrmStore.setState({ sla: [makeSla()] });
    const onOpen = vi.fn();
    render(<DealCard deal={makeDeal()} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Abrir oportunidad Casa Vista al Lago' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('no presenta violaciones de accesibilidad', async () => {
    useCrmStore.setState({ sla: [makeSla({ max_response_hours: 4, max_stay_days: 15 })] });
    const { container } = render(
      <DealCard
        deal={makeDeal({ created_at: new Date(Date.now() - 2 * HOUR_MS).toISOString() })}
        onOpen={() => undefined}
      />,
    );
    await expect(container).toHaveNoViolations();
  });
});
