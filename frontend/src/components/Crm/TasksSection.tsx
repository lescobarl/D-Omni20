import { useState, type FormEvent, type ReactElement } from 'react';
import type { ITaskRead } from '@/api/types';
import type { ITaskInput } from '@/services/crmService';
import { useCrmStore } from '@/store/crmStore';

type TaskFilter = 'todas' | 'pending' | 'done' | 'cancelled';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  done: 'Hecha',
  cancelled: 'Cancelada',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

const FILTERS: ReadonlyArray<{ id: TaskFilter; label: string }> = [
  { id: 'todas', label: 'Todas' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'done', label: 'Hechas' },
  { id: 'cancelled', label: 'Canceladas' },
];

interface ITaskFormState {
  /** Título de la tarea. */
  title: string;
  /** Fecha límite de la tarea. */
  dueAt: string;
  /** Prioridad de la tarea (`low` | `medium` | `high`). */
  priority: ITaskInput['priority'] | '';
  /** Responsable de la tarea. */
  assigneeId: string;
}

const EMPTY_TASK_FORM: ITaskFormState = { title: '', dueAt: '', priority: '', assigneeId: '' };

/**
 * Sección de tareas del pipeline: filtros por estado/propietario, creación,
 * completado y eliminación. Lee y escribe directamente en el store CRM.
 */
export function TasksSection(): ReactElement {
  const tasks = useCrmStore((state) => state.tasks);
  const createTask = useCrmStore((state) => state.createTask);
  const updateTask = useCrmStore((state) => state.updateTask);
  const deleteTask = useCrmStore((state) => state.deleteTask);

  const [filter, setFilter] = useState<TaskFilter>('todas');
  const [onlyMine, setOnlyMine] = useState(false);
  const [form, setForm] = useState<ITaskFormState>(EMPTY_TASK_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const setField = <K extends keyof ITaskFormState>(key: K, value: ITaskFormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const visibleTasks = tasks
    .filter((task) => (filter === 'todas' ? true : task.status === filter))
    .filter((task) => (onlyMine ? task.assignee_id !== null : true))
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const filterButtonClass = (selected: boolean): string =>
    selected
      ? 'rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900'
      : 'rounded border border-transparent px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100';

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const title = form.title.trim();
    if (title === '') {
      setFormError('El título de la tarea es obligatorio.');
      return;
    }
    setFormError(null);
    const input: ITaskInput = {
      title,
      dueAt: form.dueAt === '' ? null : form.dueAt,
      priority: form.priority === '' ? undefined : form.priority,
      assigneeId: form.assigneeId === '' ? null : form.assigneeId,
    };
    await createTask(input);
    if (useCrmStore.getState().tasksError !== null) {
      setFormError('No se pudo crear la tarea.');
      return;
    }
    setForm(EMPTY_TASK_FORM);
  };

  const toggleDone = async (task: ITaskRead): Promise<void> => {
    await updateTask(task.id, { status: task.status === 'done' ? 'pending' : 'done' });
  };

  const removeTask = async (taskId: string): Promise<void> => {
    await deleteTask(taskId);
  };

  return (
    <div className="space-y-6">
      <div
        role="group"
        aria-label="Filtros de tareas"
        className="flex flex-wrap items-center gap-2"
      >
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            className={filterButtonClass(filter === option.id)}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
            className="rounded border-slate-300"
          />
          Solo asignadas a mí
        </label>
      </div>

      <form
        aria-label="Crear tarea"
        onSubmit={(event) => void handleSubmit(event)}
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block text-sm text-slate-600">
            Título *
            <input
              type="text"
              value={form.title}
              onChange={(event) => setField('title', event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm text-slate-600">
            Vence
            <input
              type="date"
              value={form.dueAt}
              onChange={(event) => setField('dueAt', event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm text-slate-600">
            Prioridad
            <select
              value={form.priority}
              onChange={(event) =>
                setField('priority', event.target.value as ITaskInput['priority'] | '')
              }
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin prioridad</option>
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </label>
          <label className="block text-sm text-slate-600">
            Asignada a (id)
            <input
              type="text"
              value={form.assigneeId}
              onChange={(event) => setField('assigneeId', event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        {formError !== null && (
          <p className="mt-2 text-sm text-red-600" role="status">
            {formError}
          </p>
        )}
        <button
          type="submit"
          className="mt-3 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Crear tarea
        </button>
      </form>

      <ul aria-label="Lista de tareas" className="space-y-2">
        {visibleTasks.length === 0 ? (
          <p className="text-sm text-slate-500" role="status">
            Aún no hay tareas con estos filtros.
          </p>
        ) : (
          visibleTasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {STATUS_LABELS[task.status] ?? task.status}
                  </span>
                  {task.priority !== null && (
                    <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {PRIORITY_LABELS[task.priority] ?? task.priority}
                    </span>
                  )}
                  {task.assignee_id !== null && (
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                      {task.assignee_id.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleDone(task)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  {task.status === 'done' ? 'Reabrir' : 'Completar'}
                </button>
                <button
                  type="button"
                  onClick={() => void removeTask(task.id)}
                  className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
