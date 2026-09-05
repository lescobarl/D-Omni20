/**
 * Pruebas de la sección "Intervención Humana" del área de operación del bot (B.7).
 *
 * Contrato:
 * - Carga la cola de intervenciones al montar (una sola llamada a `listInterventions`).
 * - Renderiza su eslabón del ciclo comercial (`Vendedor ⑤`) para respetar el
 *   contrato de `OperationsArea` (todas las pestañas muestran su eslabón).
 * - Creación y edición desde un único formulario (la cola no admite borrado).
 * - La validación local exige el identificador de la conversación antes de enviar.
 * - El estado se elige en un `select` y operador/notas/fechas son opcionales.
 * - El encabezado muestra el contador de intervenciones pendientes (🆕).
 * - La cola marca como "🆕 Nuevo" las pendientes y ofrece "Atender" (no en resueltas).
 * - El espacio de atención carga el historial y permite asignar operador,
 *   responder al cliente y cerrar la intervención.
 */
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InterventionsSection } from '@/components/Operations/InterventionsSection';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { makeIntervention, makeMessage, makePage, makeService } from '@/test/operationsMocks';

describe('InterventionsSection', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    // El reset del store se envuelve en act: si el componente sigue montado
    // (RTL desmonta en su propio afterEach, que corre DESPUÉS de este), el
    // cambio de estado dispara un re-render fuera de act y genera el warning
    // "not wrapped in act(...)". Envolverlo en act lo elimina.
    act(() => {
      useOperationsStore.getState().reset();
    });
    setOperationsService(null);
  });

  it('muestra el estado vacío y su eslabón del ciclo comercial', async () => {
    const service = makeService();
    setOperationsService(service);

    render(<InterventionsSection />);

    expect(await screen.findByText('Aún no hay intervenciones en la cola.')).toBeInTheDocument();
    expect(screen.getByText('Vendedor ⑤')).toBeInTheDocument();
    expect(service.listInterventions).toHaveBeenCalledTimes(1);
    expect(service.getInterventionsPendingCount).toHaveBeenCalledTimes(1);
  });

  it('valida el identificador de la conversación obligatorio antes de crear', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('Aún no hay intervenciones en la cola.');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear intervención' }));
    });
    expect(
      screen.getByText('El identificador de la conversación es obligatorio.'),
    ).toBeInTheDocument();
    expect(service.createIntervention).not.toHaveBeenCalled();
  });

  it('crea una intervención desde el formulario y la agrega a la cola', async () => {
    const service = makeService({
      createIntervention: vi.fn(async () =>
        makeIntervention({
          conversation_id: '88888888-8888-4888-8888-888888888888',
          state: 'assigned',
          operator: 'Ana Operadora',
          notes: 'Cliente requiere seguimiento.',
          assigned_at: '2026-08-19T10:00:00Z',
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('Aún no hay intervenciones en la cola.');
    // Todas las interacciones de usuario (typing + click) van DENTRO de un único
    // act scope: cada tecla en un input controlado dispara setField -> re-render,
    // y si ocurre fuera de act genera el warning "not wrapped in act(...)".
    await act(async () => {
      await user.type(
        screen.getByLabelText('Conversación'),
        '88888888-8888-4888-8888-888888888888',
      );
      await user.selectOptions(screen.getByLabelText('Estado'), 'assigned');
      await user.type(screen.getByLabelText('Operador'), 'Ana Operadora');
      await user.type(screen.getByLabelText('Notas'), 'Cliente requiere seguimiento.');
      await user.type(screen.getByLabelText('Asignación'), '2026-08-19T10:00:00Z');
      await user.click(screen.getByRole('button', { name: 'Crear intervención' }));
      // Drena la cola de microtareas dentro del act scope para que la resolución
      // async del store (set post-await) y el resetForm() ocurran dentro de act.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(service.createIntervention).toHaveBeenCalledWith({
      conversationId: '88888888-8888-4888-8888-888888888888',
      state: 'assigned',
      operator: 'Ana Operadora',
      notes: 'Cliente requiere seguimiento.',
      assignedAt: '2026-08-19T10:00:00Z',
      resolvedAt: undefined,
    });
    expect(await screen.findByText('88888888-8888-4888-8888-888888888888')).toBeInTheDocument();
  });

  it('lista la cola de intervenciones con sus datos', async () => {
    const service = makeService({
      listInterventions: async () => makePage([makeIntervention()]),
    });
    setOperationsService(service);

    render(<InterventionsSection />);

    expect(await screen.findByText('88888888-8888-4888-8888-888888888888')).toBeInTheDocument();
    const listItem = screen.getByText('88888888-8888-4888-8888-888888888888').closest('li');
    expect(within(listItem as HTMLElement).getByText('Pendiente')).toBeInTheDocument();
  });

  it('edita una intervención existente precargando el formulario', async () => {
    const service = makeService({
      listInterventions: async () => makePage([makeIntervention()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('88888888-8888-4888-8888-888888888888');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar intervención' })).toBeInTheDocument();
    expect(screen.getByLabelText('Conversación')).toHaveValue(
      '88888888-8888-4888-8888-888888888888',
    );
    expect(screen.getByLabelText('Estado')).toHaveValue('pending');
    expect(screen.getByLabelText('Operador')).toHaveValue('');
    expect(screen.getByLabelText('Notas')).toHaveValue('');
    expect(screen.getByLabelText('Asignación')).toHaveValue('');
    expect(screen.getByLabelText('Resolución')).toHaveValue('');

    // Todas las interacciones (clear + typing + select + click) dentro de un único
    // act scope para evitar warnings "not wrapped in act(...)".
    await act(async () => {
      await user.clear(screen.getByLabelText('Conversación'));
      await user.type(
        screen.getByLabelText('Conversación'),
        '99999999-9999-4999-8999-999999999999',
      );
      await user.selectOptions(screen.getByLabelText('Estado'), 'resolved');
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateIntervention).toHaveBeenCalledWith(
      '56666666-6666-4666-8666-666666666666',
      {
        conversationId: '99999999-9999-4999-8999-999999999999',
        state: 'resolved',
        operator: undefined,
        notes: undefined,
        assignedAt: undefined,
        resolvedAt: undefined,
      },
    );
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listInterventions: async () => {
        throw 'x';
      },
    });
    setOperationsService(service);

    render(<InterventionsSection />);

    expect(
      await screen.findByText('No se pudieron cargar las intervenciones.'),
    ).toBeInTheDocument();
  });

  it('muestra el contador de intervenciones pendientes en la cabecera', async () => {
    const service = makeService({
      getInterventionsPendingCount: vi.fn(async () => ({ state: 'pending', count: 2 })),
    });
    setOperationsService(service);

    render(<InterventionsSection />);

    expect(await screen.findByText('🆕 2 pendientes')).toBeInTheDocument();
    expect(service.getInterventionsPendingCount).toHaveBeenCalledTimes(1);
  });

  it('marca como "🆕 Nuevo" solo las intervenciones pendientes y no ofrece atender las resueltas', async () => {
    const service = makeService({
      listInterventions: async () =>
        makePage([
          makeIntervention(),
          makeIntervention({
            id: '59999999-9999-4999-8999-999999999999',
            conversation_id: '89999999-9999-4999-8999-999999999999',
            state: 'resolved',
            resolved_at: '2026-08-19T12:00:00Z',
          }),
        ]),
    });
    setOperationsService(service);

    render(<InterventionsSection />);

    expect(await screen.findByText('89999999-9999-4999-8999-999999999999')).toBeInTheDocument();

    const pendingItem = screen.getByText('88888888-8888-4888-8888-888888888888').closest('li');
    expect(within(pendingItem as HTMLElement).getByText('🆕 Nuevo')).toBeInTheDocument();
    expect(
      within(pendingItem as HTMLElement).getByRole('button', { name: 'Atender' }),
    ).toBeInTheDocument();

    const resolvedItem = screen.getByText('89999999-9999-4999-8999-999999999999').closest('li');
    expect(within(resolvedItem as HTMLElement).queryByText('🆕 Nuevo')).not.toBeInTheDocument();
    expect(
      within(resolvedItem as HTMLElement).queryByRole('button', { name: 'Atender' }),
    ).not.toBeInTheDocument();
  });

  it('abre el espacio de atención y carga los mensajes de la conversación', async () => {
    const service = makeService({
      listInterventions: async () => makePage([makeIntervention()]),
      listInterventionMessages: vi.fn(async () => [
        makeMessage(),
        makeMessage({
          id: '59999999-9999-4999-8999-999999999999',
          direction: 'outbound',
          content: 'Voy a revisar tu pedido.',
        }),
      ]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('88888888-8888-4888-8888-888888888888');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Atender' }));
    });

    expect(screen.getByRole('heading', { name: 'Atendiendo' })).toBeInTheDocument();
    expect(service.listInterventionMessages).toHaveBeenCalledWith(
      '56666666-6666-4666-8666-666666666666',
    );
    expect(await screen.findByText('Hola, necesito ayuda con mi pedido.')).toBeInTheDocument();
    expect(screen.getByText('Voy a revisar tu pedido.')).toBeInTheDocument();
    const conversationHistory = within(
      screen.getByText('Historial de la conversación').closest('div') as HTMLElement,
    );
    expect(conversationHistory.getAllByText('Cliente')).toHaveLength(1);
    expect(conversationHistory.getAllByText('Operador')).toHaveLength(1);
  });

  it('asigna un operador desde el espacio de atención', async () => {
    const service = makeService({
      listInterventions: async () => makePage([makeIntervention()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('88888888-8888-4888-8888-888888888888');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Atender' }));
    });

    await act(async () => {
      await user.type(screen.getByLabelText('Asignar operador'), 'María González');
      await user.click(screen.getByRole('button', { name: 'Asignar' }));
    });

    expect(service.assignIntervention).toHaveBeenCalledWith(
      '56666666-6666-4666-8666-666666666666',
      'María González',
    );
  });

  it('envía una respuesta del operador desde el espacio de atención', async () => {
    const service = makeService({
      listInterventions: async () => makePage([makeIntervention()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('88888888-8888-4888-8888-888888888888');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Atender' }));
    });

    await act(async () => {
      await user.type(screen.getByLabelText('Responder al cliente'), 'Estoy revisando tu caso');
      await user.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
    });

    expect(service.replyIntervention).toHaveBeenCalledWith(
      '56666666-6666-4666-8666-666666666666',
      'Estoy revisando tu caso',
    );
    expect(await screen.findByText('Respondido por el operador')).toBeInTheDocument();
  });

  it('cierra la intervención desde el espacio de atención', async () => {
    const service = makeService({
      listInterventions: async () => makePage([makeIntervention()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<InterventionsSection />);

    await screen.findByText('88888888-8888-4888-8888-888888888888');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Atender' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Cerrar intervención' }));
    });

    expect(service.closeIntervention).toHaveBeenCalledWith('56666666-6666-4666-8666-666666666666');
    expect(screen.queryByRole('heading', { name: 'Atendiendo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atender' })).not.toBeInTheDocument();
  });
});
