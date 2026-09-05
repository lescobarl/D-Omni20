import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksSection } from '@/components/Crm/TasksSection';
import type { ITaskInput } from '@/services/crmService';
import { setCrmService, useCrmStore } from '@/store/crmStore';
import { makeService, makeTask } from '@/test/crmMocks';

describe('TasksSection', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
    setCrmService(null);
  });

  it('muestra el estado vacío cuando no hay tareas', () => {
    render(<TasksSection />);
    expect(screen.getByRole('status')).toHaveTextContent('Aún no hay tareas con estos filtros.');
  });

  it('lista las tareas con su estado, prioridad y responsable', () => {
    useCrmStore.setState({
      tasks: [
        makeTask({
          title: 'Llamar al cliente',
          status: 'pending',
          priority: 'high',
          assignee_id: 'aabbccdd-0000-4000-8000-000000000000',
        }),
        makeTask({
          id: '99999999-9999-4999-8999-999999999999',
          title: 'Enviar propuesta',
          status: 'done',
        }),
      ],
    });
    render(<TasksSection />);
    expect(screen.getByText('Llamar al cliente')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Lista de tareas' })).getByText('Alta'),
    ).toBeInTheDocument();
    expect(screen.getByText('aabbccdd')).toBeInTheDocument();
    expect(screen.getByText('Enviar propuesta')).toBeInTheDocument();
    expect(screen.getByText('Hecha')).toBeInTheDocument();
  });

  it('filtra las tareas por estado con los botones', async () => {
    const user = userEvent.setup();
    useCrmStore.setState({
      tasks: [
        makeTask({ title: 'Pendiente A' }),
        makeTask({ id: '99999999-9999-4999-8999-999999999999', title: 'Hecha B', status: 'done' }),
      ],
    });
    render(<TasksSection />);
    expect(screen.getByText('Pendiente A')).toBeInTheDocument();
    expect(screen.getByText('Hecha B')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pendientes' }));
    expect(screen.getByText('Pendiente A')).toBeInTheDocument();
    expect(screen.queryByText('Hecha B')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hechas' }));
    expect(screen.getByText('Hecha B')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente A')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByText('Pendiente A')).toBeInTheDocument();
    expect(screen.getByText('Hecha B')).toBeInTheDocument();
  });

  it('filtra las tareas solo asignadas a mí', async () => {
    const user = userEvent.setup();
    useCrmStore.setState({
      tasks: [
        makeTask({ title: 'Mía', assignee_id: 'aabbccdd-0000-4000-8000-000000000000' }),
        makeTask({ id: '99999999-9999-4999-8999-999999999999', title: 'De otro' }),
      ],
    });
    render(<TasksSection />);
    expect(screen.getByText('Mía')).toBeInTheDocument();
    expect(screen.getByText('De otro')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Solo asignadas a mí/ }));
    expect(screen.getByText('Mía')).toBeInTheDocument();
    expect(screen.queryByText('De otro')).not.toBeInTheDocument();
  });

  it('valida el título obligatorio antes de crear', async () => {
    const user = userEvent.setup();
    setCrmService(makeService());
    render(<TasksSection />);
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(screen.getByText('El título de la tarea es obligatorio.')).toBeInTheDocument();
  });

  it('crea una tarea desde el formulario y la agrega a la lista', async () => {
    const user = userEvent.setup();
    const service = makeService({
      createTask: vi.fn(async (input: ITaskInput) =>
        makeTask({
          title: input.title,
          priority: input.priority,
          due_at: input.dueAt ?? null,
          assignee_id: input.assigneeId ?? null,
        }),
      ),
    });
    setCrmService(service);
    render(<TasksSection />);
    await user.type(screen.getByLabelText('Título *'), 'Llamar al cliente');
    await user.selectOptions(screen.getByLabelText('Prioridad'), 'high');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    });
    expect(service.createTask).toHaveBeenCalledWith({
      title: 'Llamar al cliente',
      dueAt: null,
      priority: 'high',
      assigneeId: null,
    });
    expect(await screen.findByText('Llamar al cliente')).toBeInTheDocument();
    expect(screen.getByLabelText('Título *')).toHaveValue('');
  });

  it('completa y reabre una tarea', async () => {
    const user = userEvent.setup();
    const service = makeService({
      updateTask: vi.fn(async (_id: string, input: Partial<ITaskInput>) =>
        makeTask({ status: input.status ?? 'pending' }),
      ),
    });
    setCrmService(service);
    useCrmStore.setState({ tasks: [makeTask({ title: 'Llamar al cliente' })] });
    render(<TasksSection />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Completar' }));
    });
    expect(service.updateTask).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {
      status: 'done',
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Reabrir' }));
    });
    expect(service.updateTask).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {
      status: 'pending',
    });
  });

  it('elimina una tarea', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setCrmService(service);
    useCrmStore.setState({ tasks: [makeTask({ title: 'Llamar al cliente' })] });
    render(<TasksSection />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });
    expect(service.deleteTask).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
  });

  it('muestra el error al crear una tarea', async () => {
    const user = userEvent.setup();
    const service = makeService({
      createTask: vi.fn(async () => {
        throw 'create-failed';
      }),
    });
    setCrmService(service);
    render(<TasksSection />);
    await user.type(screen.getByLabelText('Título *'), 'Llamar al cliente');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    });
    expect(await screen.findByText('No se pudo crear la tarea.')).toBeInTheDocument();
  });

  it('no presenta violaciones de accesibilidad', async () => {
    useCrmStore.setState({ tasks: [makeTask({ title: 'Llamar al cliente' })] });
    const { container } = render(<TasksSection />);
    await expect(container).toHaveNoViolations();
  });
});
