import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IStageChangeRead } from '@/api/types';
import type { ITaskInput } from '@/services/crmService';
import { useCrmStore } from '@/store/crmStore';
import { formatCurrency, getSlaBadge } from './crmFormat';

interface IDealDrawerProps {
  /** Identificador de la oportunidad a mostrar. */
  dealId: string;
  /** Callback al cerrar el panel. */
  onClose: () => void;
}

const PRIORITY_LABELS: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta' };
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  done: 'Hecha',
  cancelled: 'Cancelada',
};

interface ITaskFormState {
  /** Título de la tarea. */
  title: string;
  /** Fecha límite de la tarea. */
  dueAt: string;
  /** Prioridad de la tarea (`low` | `medium` | `high`). */
  priority: ITaskInput['priority'] | '';
}

const EMPTY_TASK_FORM: ITaskFormState = { title: '', dueAt: '', priority: '' };

/**
 * Panel de detalle de una oportunidad (overlay modal accesible): datos,
 * cambio de etapa (con validación de pérdida), acciones rápidas ganar/perder,
 * historial de movimientos y alta de tareas vinculadas a la oportunidad.
 */
export function DealDrawer({ dealId, onClose }: IDealDrawerProps): ReactElement {
  const deal = useCrmStore((state) => state.deals.find((candidate) => candidate.id === dealId));
  const stages = useCrmStore((state) => state.stages);
  const dealTasks = useCrmStore((state) => state.tasks.filter((task) => task.deal_id === dealId));
  const sla = useCrmStore((state) =>
    state.sla.find((policy) => policy.stage_id === deal?.stage_id),
  );
  const listDealHistory = useCrmStore((state) => state.listDealHistory);
  const updateDeal = useCrmStore((state) => state.updateDeal);
  const createDealTask = useCrmStore((state) => state.createDealTask);

  const [history, setHistory] = useState<IStageChangeRead[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [moveStageId, setMoveStageId] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<ITaskFormState>(EMPTY_TASK_FORM);
  const [taskError, setTaskError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const rows = await listDealHistory(dealId);
      if (!cancelled) {
        setHistory(rows);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [dealId, listDealHistory, refreshKey]);

  const stageName = (stageId: string | null | undefined): string =>
    stages.find((stage) => stage.id === stageId)?.name ?? '—';

  if (deal === undefined) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-drawer-title"
          className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        >
          <h2 id="deal-drawer-title" className="text-lg font-semibold text-slate-900">
            Oportunidad no encontrada
          </h2>
          <p className="mt-2 text-sm text-slate-500">La oportunidad ya no está disponible.</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  const slaBadge = getSlaBadge(deal, sla);
  const currentStage = stages.find((stage) => stage.id === deal.stage_id);
  const otherStages = stages.filter((stage) => stage.id !== deal.stage_id);
  const moveTarget = stages.find((stage) => stage.id === moveStageId);
  const lostTarget =
    moveTarget !== undefined && moveTarget.is_terminal && moveTarget.outcome === 'lost';
  const wonStage = stages.find((stage) => stage.is_terminal && stage.outcome === 'won');
  const lostStage = stages.find((stage) => stage.is_terminal && stage.outcome === 'lost');
  const hasProbability = deal.probability !== null && deal.probability !== undefined;

  const clearMoveFeedback = (): void => {
    setMoveStageId('');
    setLostReason('');
    setNote('');
    setRefreshKey((key) => key + 1);
  };

  const handleMove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (moveStageId === '') {
      setMoveError('Selecciona una etapa de destino.');
      return;
    }
    if (moveStageId === deal.stage_id) {
      setMoveError('La oportunidad ya está en esa etapa.');
      return;
    }
    if (lostTarget && lostReason.trim() === '') {
      setMoveError('Indica el motivo de la pérdida antes de mover a una etapa terminal perdida.');
      return;
    }
    setMoveError(null);
    await updateDeal(dealId, {
      stageId: moveStageId,
      lostReason: lostTarget ? lostReason.trim() : undefined,
      note: note.trim() === '' ? undefined : note.trim(),
    });
    if (useCrmStore.getState().dealsError !== null) {
      setMoveError('No se pudo actualizar la oportunidad.');
      return;
    }
    clearMoveFeedback();
  };

  const quickMove = async (stageId: string, isLost: boolean): Promise<void> => {
    if (isLost && lostReason.trim() === '') {
      setMoveError('Indica el motivo de la pérdida antes de marcar como perdida.');
      return;
    }
    setMoveError(null);
    await updateDeal(dealId, {
      stageId,
      lostReason: isLost ? lostReason.trim() : undefined,
      note: note.trim() === '' ? undefined : note.trim(),
    });
    if (useCrmStore.getState().dealsError !== null) {
      setMoveError('No se pudo actualizar la oportunidad.');
      return;
    }
    clearMoveFeedback();
  };

  const setTaskField = <K extends keyof ITaskFormState>(key: K, value: ITaskFormState[K]): void => {
    setTaskForm((current) => ({ ...current, [key]: value }));
  };

  const handleCreateTask = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const title = taskForm.title.trim();
    if (title === '') {
      setTaskError('El título de la tarea es obligatorio.');
      return;
    }
    setTaskError(null);
    await createDealTask(dealId, {
      title,
      dueAt: taskForm.dueAt === '' ? null : taskForm.dueAt,
      priority: taskForm.priority === '' ? undefined : taskForm.priority,
    });
    if (useCrmStore.getState().tasksError !== null) {
      setTaskError('No se pudo crear la tarea.');
      return;
    }
    setTaskForm(EMPTY_TASK_FORM);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deal-drawer-title"
        className="relative w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="deal-drawer-title" className="truncate text-lg font-semibold text-slate-900">
              {deal.title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {currentStage?.name ?? '—'} · {formatCurrency(deal.amount_minor, deal.currency)}
              {hasProbability ? ` · ${deal.probability}%` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Cerrar
          </button>
        </div>

        {slaBadge !== null && (
          <span
            className={`mt-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${slaBadge.className}`}
          >
            {slaBadge.label}
          </span>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <dl className="rounded-lg border border-slate-200 p-4 text-sm">
            <dt className="font-medium text-slate-500">Propietario</dt>
            <dd className="mt-1 font-mono text-slate-900">
              {deal.owner_id !== null ? deal.owner_id.slice(0, 8) : 'Sin propietario'}
            </dd>
            <dt className="mt-3 font-medium text-slate-500">Contacto</dt>
            <dd className="mt-1 font-mono text-slate-900">
              {deal.contact_id !== null ? deal.contact_id.slice(0, 8) : '—'}
            </dd>
            <dt className="mt-3 font-medium text-slate-500">Cierre esperado</dt>
            <dd className="mt-1 text-slate-900">
              {deal.expected_close_at !== null
                ? new Date(deal.expected_close_at).toLocaleDateString('es-MX')
                : '—'}
            </dd>
          </dl>
          <dl className="rounded-lg border border-slate-200 p-4 text-sm">
            <dt className="font-medium text-slate-500">Estado</dt>
            <dd className="mt-1 text-slate-900">{deal.status}</dd>
            <dt className="mt-3 font-medium text-slate-500">Creada</dt>
            <dd className="mt-1 text-slate-900">
              {new Date(deal.created_at).toLocaleDateString('es-MX')}
            </dd>
            <dt className="mt-3 font-medium text-slate-500">Moneda</dt>
            <dd className="mt-1 text-slate-900">{deal.currency}</dd>
          </dl>
        </div>

        <form
          aria-label="Mover oportunidad de etapa"
          onSubmit={(event) => void handleMove(event)}
          className="mt-4 rounded-lg border border-slate-200 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">Cambiar de etapa</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-600">
              Etapa destino *
              <select
                value={moveStageId}
                onChange={(event) => setMoveStageId(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Selecciona…</option>
                {otherStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-600">
              Nota (opcional)
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          {lostTarget && (
            <label className="mt-3 block text-sm text-slate-600">
              Motivo de la pérdida *
              <textarea
                value={lostReason}
                onChange={(event) => setLostReason(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          )}
          {moveError !== null && (
            <p className="mt-2 text-sm text-red-600" role="status">
              {moveError}
            </p>
          )}
          <button
            type="submit"
            className="mt-3 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            Guardar movimiento
          </button>
        </form>

        {deal.status === 'open' && (wonStage !== undefined || lostStage !== undefined) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">Acciones rápidas:</span>
            {wonStage !== undefined && (
              <button
                type="button"
                onClick={() => void quickMove(wonStage.id, false)}
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-700"
              >
                Marcar como ganada
              </button>
            )}
            {lostStage !== undefined && (
              <button
                type="button"
                onClick={() => void quickMove(lostStage.id, true)}
                className="rounded border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                Marcar como perdida
              </button>
            )}
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">Historial</h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500" role="status">
              Sin movimientos registrados.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="truncate text-slate-700">
                    {stageName(row.from_stage_id)} → {stageName(row.to_stage_id)}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString('es-MX')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          aria-label="Crear tarea de la oportunidad"
          onSubmit={(event) => void handleCreateTask(event)}
          className="mt-6 rounded-lg border border-slate-200 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">Nueva tarea</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-slate-600">
              Título *
              <input
                type="text"
                value={taskForm.title}
                onChange={(event) => setTaskField('title', event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-600">
              Vence
              <input
                type="date"
                value={taskForm.dueAt}
                onChange={(event) => setTaskField('dueAt', event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-600">
              Prioridad
              <select
                value={taskForm.priority}
                onChange={(event) =>
                  setTaskField('priority', event.target.value as ITaskInput['priority'] | '')
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Sin prioridad</option>
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </label>
          </div>
          {taskError !== null && (
            <p className="mt-2 text-sm text-red-600" role="status">
              {taskError}
            </p>
          )}
          <button
            type="submit"
            className="mt-3 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            Crear tarea
          </button>
        </form>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">Tareas de la oportunidad</h3>
          {dealTasks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500" role="status">
              Sin tareas asociadas.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {dealTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="truncate text-slate-900">{task.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {STATUS_LABELS[task.status] ?? task.status}
                    {task.priority !== null
                      ? ` · ${PRIORITY_LABELS[task.priority] ?? task.priority}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
