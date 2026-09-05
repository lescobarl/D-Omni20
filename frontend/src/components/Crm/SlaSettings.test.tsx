import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlaSettings } from '@/components/Crm/SlaSettings';
import type { ISlaInput } from '@/services/crmService';
import { setCrmService, useCrmStore } from '@/store/crmStore';
import { makeService, makeSla, makeStage } from '@/test/crmMocks';

const STAGE_ID = '11111111-1111-4111-8111-111111111111';

describe('SlaSettings', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
    setCrmService(null);
  });

  it('muestra el estado vacío cuando no hay etapas', () => {
    render(<SlaSettings />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'No hay etapas configuradas para definir políticas SLA.',
    );
  });

  it('precarga la política existente de cada etapa', () => {
    useCrmStore.setState({ stages: [makeStage()], sla: [makeSla()] });
    render(<SlaSettings />);
    expect(screen.getByRole('form', { name: 'Política SLA de Prospección' })).toBeInTheDocument();
    expect(screen.getByText('Actual: 4 h · 15 días')).toBeInTheDocument();
    expect(screen.getByLabelText('Horas de respuesta')).toHaveValue(4);
    expect(screen.getByLabelText('Días máximos')).toHaveValue(15);
  });

  it('muestra "Sin política configurada" para etapas sin SLA', () => {
    useCrmStore.setState({ stages: [makeStage()], sla: [] });
    render(<SlaSettings />);
    expect(screen.getByText('Sin política configurada.')).toBeInTheDocument();
  });

  it('valida las horas de respuesta no negativas', async () => {
    const user = userEvent.setup();
    useCrmStore.setState({ stages: [makeStage()] });
    render(<SlaSettings />);
    const hours = screen.getByLabelText('Horas de respuesta');
    await act(async () => {
      fireEvent.change(hours, { target: { value: '-1' } });
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    expect(
      screen.getByText('Las horas de respuesta deben ser un número mayor o igual a 0.'),
    ).toBeInTheDocument();
  });

  it('valida los días máximos no negativos', async () => {
    const user = userEvent.setup();
    useCrmStore.setState({ stages: [makeStage()] });
    render(<SlaSettings />);
    const days = screen.getByLabelText('Días máximos');
    await act(async () => {
      fireEvent.change(days, { target: { value: '-1' } });
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    expect(
      screen.getByText('Los días máximos deben ser un número mayor o igual a 0.'),
    ).toBeInTheDocument();
  });

  it('guarda la política SLA con valores numéricos', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    useCrmStore.setState({ stages: [makeStage()] });
    render(<SlaSettings />);
    const hours = screen.getByLabelText('Horas de respuesta');
    const days = screen.getByLabelText('Días máximos');
    await act(async () => {
      fireEvent.change(hours, { target: { value: '8' } });
      fireEvent.change(days, { target: { value: '30' } });
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    const input: ISlaInput = { stageId: STAGE_ID, maxResponseHours: 8, maxStayDays: 30 };
    expect(service.upsertSla).toHaveBeenCalledWith(input);
  });

  it('muestra el error al guardar la política SLA', async () => {
    const user = userEvent.setup();
    const service = makeService({
      upsertSla: vi.fn(async () => {
        throw 'sla-failed';
      }),
    });
    setCrmService(service);
    useCrmStore.setState({ stages: [makeStage()] });
    render(<SlaSettings />);
    const hours = screen.getByLabelText('Horas de respuesta');
    const days = screen.getByLabelText('Días máximos');
    await act(async () => {
      fireEvent.change(hours, { target: { value: '8' } });
      fireEvent.change(days, { target: { value: '30' } });
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    expect(await screen.findByText('No se pudo guardar la política SLA.')).toBeInTheDocument();
  });

  it('no presenta violaciones de accesibilidad', async () => {
    useCrmStore.setState({ stages: [makeStage()], sla: [makeSla()] });
    const { container } = render(<SlaSettings />);
    await expect(container).toHaveNoViolations();
  });
});
