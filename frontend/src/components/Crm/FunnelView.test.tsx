import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FunnelView } from '@/components/Crm/FunnelView';
import { useCrmStore } from '@/store/crmStore';
import { makeFunnel } from '@/test/crmMocks';

describe('FunnelView', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
  });

  it('muestra el estado de carga cuando no hay datos y el estado es loading', () => {
    useCrmStore.setState({ funnel: null, funnelStatus: 'loading' });
    render(<FunnelView />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando embudo…');
  });

  it('muestra el error de carga de forma accesible', () => {
    useCrmStore.setState({
      funnel: null,
      funnelStatus: 'error',
      funnelError: 'No se pudo cargar el embudo comercial.',
    });
    render(<FunnelView />);
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo cargar el embudo comercial.');
  });

  it('muestra el estado vacío cuando no hay embudo', () => {
    useCrmStore.setState({ funnel: null, funnelStatus: 'success' });
    render(<FunnelView />);
    expect(screen.getByRole('status')).toHaveTextContent('Aún no hay datos del embudo.');
  });

  it('muestra los KPIs y el embudo por etapa', () => {
    useCrmStore.setState({ funnel: makeFunnel(), funnelStatus: 'success' });
    render(<FunnelView />);
    expect(screen.getByText('Oportunidades')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    const wonKpi = screen.getByText('Ganadas').closest('div') as HTMLElement;
    expect(within(wonKpi).getByText('1')).toBeInTheDocument();
    const lostKpi = screen.getByText('Perdidas').closest('div') as HTMLElement;
    expect(within(lostKpi).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Abiertas')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Monto ganado')).toBeInTheDocument();
    expect(screen.getByText('$35,000.00')).toBeInTheDocument();
    expect(screen.getByText('Tasa de cierre')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('Ciclo promedio')).toBeInTheDocument();
    expect(screen.getByText('21 días')).toBeInTheDocument();
    expect(screen.getByText('Prospección')).toBeInTheDocument();
    expect(screen.getByText('5 · 40%')).toBeInTheDocument();
    expect(screen.getByText('$175,000.00 · ponderado $43,750.00 · 7 días')).toBeInTheDocument();
  });

  it('muestra el estado vacío del embudo por etapa', () => {
    useCrmStore.setState({ funnel: makeFunnel({ stages: [] }), funnelStatus: 'success' });
    render(<FunnelView />);
    expect(screen.getByRole('status')).toHaveTextContent('Sin etapas en el embudo.');
  });

  it('no presenta violaciones de accesibilidad', async () => {
    useCrmStore.setState({ funnel: makeFunnel(), funnelStatus: 'success' });
    const { container } = render(<FunnelView />);
    await expect(container).toHaveNoViolations();
  });
});
