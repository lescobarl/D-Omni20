/**
 * Sección "Intervención Humana" del área de operación del bot (B.7 — eslabón
 * ⑤ Vendedor).
 *
 * Contrato:
 * - Cola de intervenciones humanas sobre conversaciones del tenant (identificador
 *   de conversación, estado, operador asignado, notas y marcas de tiempo de
 *   asignación/resolución), gestionada por el backend con RLS.
 * - Sección autocontenida: carga la cola y el contador de pendientes al montar y
 *   reutiliza un único formulario para crear y editar intervenciones (modo edición).
 * - Badge 🆕 en el encabezado con el número de intervenciones pendientes del tenant
 *   y badge 🆕 sobre cada ítem pendiente de la cola (refleja la asignación pendiente).
 * - Workspace "Atendiendo": al pulsar "Atender" sobre una intervención no resuelta
 *   se abre un espacio de dos columnas con el historial de mensajes de la
 *   conversación y las acciones del operador (asignar operador, responder y cerrar
 *   la intervención).
 * - El identificador de la conversación se valida localmente (obligatorio) antes
 *   de enviar.
 * - El estado se elige en un `select` con los estados estándar de la cola
 *   (pending, assigned, resolved) y se muestra como etiqueta.
 * - Operador, notas y marcas de tiempo son campos opcionales del formulario.
 * - Los errores del store se reflejan en `aria-live` accesibles.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IInterventionRead } from '@/api/types';
import type { IInterventionInput } from '@/services/operationsService';
import { useOperationsStore } from '@/store/operationsStore';

/** Estado del formulario de intervenciones (fechas como texto ISO 8601 opcional). */
interface IInterventionFormState {
  /** ID de la conversación que requiere intervención (obligatorio). */
  conversationId: string;
  /** Estado de la cola de la intervención. */
  state: string;
  /** Operador humano asignado (opcional). */
  operator: string;
  /** Notas del operador (opcional). */
  notes: string;
  /** Momento de asignación en ISO 8601 (opcional). */
  assignedAt: string;
  /** Momento de resolución en ISO 8601 (opcional). */
  resolvedAt: string;
}

const EMPTY_FORM: IInterventionFormState = {
  conversationId: '',
  state: 'pending',
  operator: '',
  notes: '',
  assignedAt: '',
  resolvedAt: '',
};

/** Estados estándar de la cola de intervención humana con su etiqueta en español. */
const INTERVENTION_STATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'assigned', label: 'Asignada' },
  { value: 'resolved', label: 'Resuelta' },
];

/** Devuelve la etiqueta en español de un estado de intervención (cae al valor crudo). */
function formatState(state: string): string {
  const match = INTERVENTION_STATES.find((option) => option.value === state);
  return match !== undefined ? match.label : state;
}

/**
 * Sección de la cola de intervención humana del bot (B.7).
 *
 * @example
 * ```tsx
 * <InterventionsSection />
 * ```
 *
 * @returns El formulario, la cola y el workspace "Atendiendo" de intervenciones.
 */
export function InterventionsSection(): ReactElement {
  const interventions = useOperationsStore((state) => state.interventions);
  const interventionsStatus = useOperationsStore((state) => state.interventionsStatus);
  const interventionsError = useOperationsStore((state) => state.interventionsError);
  const listInterventions = useOperationsStore((state) => state.listInterventions);
  const createIntervention = useOperationsStore((state) => state.createIntervention);
  const updateIntervention = useOperationsStore((state) => state.updateIntervention);

  const pendingCount = useOperationsStore((state) => state.pendingCount);
  const loadPendingCount = useOperationsStore((state) => state.loadPendingCount);
  const activeInterventionId = useOperationsStore((state) => state.activeInterventionId);
  const setActiveIntervention = useOperationsStore((state) => state.setActiveIntervention);
  const interventionMessages = useOperationsStore((state) => state.interventionMessages);
  const interventionMessagesStatus = useOperationsStore(
    (state) => state.interventionMessagesStatus,
  );
  const interventionMessagesError = useOperationsStore((state) => state.interventionMessagesError);
  const listInterventionMessages = useOperationsStore((state) => state.listInterventionMessages);
  const assignIntervention = useOperationsStore((state) => state.assignIntervention);
  const replyIntervention = useOperationsStore((state) => state.replyIntervention);
  const closeIntervention = useOperationsStore((state) => state.closeIntervention);

  const [form, setForm] = useState<IInterventionFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [assignOperator, setAssignOperator] = useState('');

  // Sección autocontenida: carga la cola y el contador de pendientes al montar.
  useEffect(() => {
    void listInterventions();
    void loadPendingCount();
  }, [listInterventions, loadPendingCount]);

  const activeIntervention =
    interventions.find((intervention) => intervention.id === activeInterventionId) ?? null;

  const setField = <K extends keyof IInterventionFormState>(
    key: K,
    value: IInterventionFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (intervention: IInterventionRead): void => {
    setForm({
      conversationId: intervention.conversation_id,
      state: intervention.state,
      operator: intervention.operator ?? '',
      notes: intervention.notes ?? '',
      assignedAt: intervention.assigned_at ?? '',
      resolvedAt: intervention.resolved_at ?? '',
    });
    setEditingId(intervention.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const conversationId = form.conversationId.trim();
    if (conversationId === '') {
      setFormError('El identificador de la conversación es obligatorio.');
      return;
    }
    const input: IInterventionInput = {
      conversationId,
      state: form.state,
      operator: form.operator.trim() === '' ? undefined : form.operator.trim(),
      notes: form.notes.trim() === '' ? undefined : form.notes.trim(),
      assignedAt: form.assignedAt.trim() === '' ? undefined : form.assignedAt.trim(),
      resolvedAt: form.resolvedAt.trim() === '' ? undefined : form.resolvedAt.trim(),
    };
    if (editingId !== null) {
      await updateIntervention(editingId, input);
    } else {
      await createIntervention(input);
    }
    resetForm();
  };

  const openWorkspace = (intervention: IInterventionRead): void => {
    setActiveIntervention(intervention.id);
    void listInterventionMessages(intervention.id);
  };

  const handleAssign = (): void => {
    const operator = assignOperator.trim();
    if (activeInterventionId === null || operator === '') {
      return;
    }
    void assignIntervention(activeInterventionId, operator);
    setAssignOperator('');
  };

  const handleReply = (): void => {
    const content = replyContent.trim();
    if (activeInterventionId === null || content === '') {
      return;
    }
    void replyIntervention(activeInterventionId, content);
    setReplyContent('');
  };

  const handleClose = (): void => {
    if (activeInterventionId !== null) {
      void closeIntervention(activeInterventionId);
    }
  };

  const isLoading = interventionsStatus === 'loading' && interventions.length === 0;
  const messagesLoading =
    interventionMessagesStatus === 'loading' && interventionMessages.length === 0;

  return (
    <section aria-labelledby="interventions-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="interventions-heading" className="text-lg font-semibold text-slate-900">
            Intervención Humana
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Cola de conversaciones que requieren un operador humano. Cada intervención registra su
            estado, operador asignado y marcas de asignación y resolución.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
            Vendedor ⑤
          </span>
          <span
            role="status"
            className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"
          >
            {`🆕 ${pendingCount} ${pendingCount === 1 ? 'pendiente' : 'pendientes'}`}
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando intervenciones…
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-4"
              aria-label={editingId !== null ? 'Editar intervención' : 'Crear intervención'}
            >
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">
                  {editingId !== null ? 'Editar intervención' : 'Nueva intervención'}
                </legend>
                <div className="mt-2 space-y-3">
                  <div>
                    <label
                      htmlFor="intervention-conversation"
                      className="block text-sm text-slate-600"
                    >
                      Conversación
                    </label>
                    <input
                      id="intervention-conversation"
                      type="text"
                      value={form.conversationId}
                      onChange={(event) => setField('conversationId', event.target.value)}
                      placeholder="88888888-8888-4888-8888-888888888888"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="intervention-state" className="block text-sm text-slate-600">
                      Estado
                    </label>
                    <select
                      id="intervention-state"
                      value={form.state}
                      onChange={(event) => setField('state', event.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      {INTERVENTION_STATES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="intervention-operator" className="block text-sm text-slate-600">
                      Operador
                    </label>
                    <input
                      id="intervention-operator"
                      type="text"
                      value={form.operator}
                      onChange={(event) => setField('operator', event.target.value)}
                      placeholder="Ana Operadora"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="intervention-notes" className="block text-sm text-slate-600">
                      Notas
                    </label>
                    <textarea
                      id="intervention-notes"
                      value={form.notes}
                      onChange={(event) => setField('notes', event.target.value)}
                      placeholder="Contexto y pasos seguidos con el cliente."
                      rows={3}
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="intervention-assigned" className="block text-sm text-slate-600">
                      Asignación
                    </label>
                    <input
                      id="intervention-assigned"
                      type="text"
                      value={form.assignedAt}
                      onChange={(event) => setField('assignedAt', event.target.value)}
                      placeholder="2026-08-19T10:00:00Z"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="intervention-resolved" className="block text-sm text-slate-600">
                      Resolución
                    </label>
                    <input
                      id="intervention-resolved"
                      type="text"
                      value={form.resolvedAt}
                      onChange={(event) => setField('resolvedAt', event.target.value)}
                      placeholder="2026-08-19T12:00:00Z"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </fieldset>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={interventionsStatus === 'loading'}
                  className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editingId !== null ? 'Guardar cambios' : 'Crear intervención'}
                </button>
                {editingId !== null && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Cancelar edición
                  </button>
                )}
                <span role="status" aria-live="polite" className="text-sm">
                  {formError !== null && <span className="text-red-600">{formError}</span>}
                </span>
              </div>
            </form>

            <div>
              <p className="text-sm font-medium text-slate-700">Cola de intervenciones</p>
              {interventions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500" role="status">
                  Aún no hay intervenciones en la cola.
                </p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {interventions.map((intervention) => (
                    <li key={intervention.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {formatState(intervention.state)}
                            </span>
                            {intervention.state === 'pending' && (
                              <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                🆕 Nuevo
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                            {intervention.conversation_id}
                          </h3>
                          {intervention.operator !== null && (
                            <span className="mt-2 inline-block rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                              Operador: {intervention.operator}
                            </span>
                          )}
                          {intervention.notes !== null && (
                            <p className="mt-2 text-xs text-slate-500">{intervention.notes}</p>
                          )}
                          {intervention.assigned_at !== null && (
                            <p className="mt-2 text-xs text-slate-500">
                              Asignación: {intervention.assigned_at}
                            </p>
                          )}
                          {intervention.resolved_at !== null && (
                            <p className="mt-2 text-xs text-slate-500">
                              Resolución: {intervention.resolved_at}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {intervention.state !== 'resolved' && (
                            <button
                              type="button"
                              onClick={() => openWorkspace(intervention)}
                              className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-700"
                            >
                              Atender
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(intervention)}
                            className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                          >
                            Editar
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {activeIntervention !== null && (
            <div
              className="mt-6 rounded-lg border border-slate-200 p-4"
              aria-labelledby="atendiendo-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="atendiendo-heading" className="text-base font-semibold text-slate-900">
                    Atendiendo
                  </h3>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {activeIntervention.conversation_id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveIntervention(null)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cerrar vista
                </button>
              </div>

              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">Historial de la conversación</p>
                  {messagesLoading ? (
                    <p className="mt-2 text-sm text-slate-500" role="status">
                      Cargando mensajes…
                    </p>
                  ) : interventionMessages.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500" role="status">
                      Aún no hay mensajes en la conversación.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {interventionMessages.map((message) => (
                        <li
                          key={message.id}
                          className={`rounded-lg border p-3 ${
                            message.direction === 'inbound'
                              ? 'border-slate-200 bg-slate-50'
                              : 'border-sky-200 bg-sky-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-600">
                              {message.direction === 'inbound' ? 'Cliente' : 'Operador'}
                            </span>
                            <span className="text-xs text-slate-400">{message.created_at}</span>
                          </div>
                          <p className="mt-1 text-sm text-slate-700">{message.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <span role="status" aria-live="polite" className="text-sm">
                    {interventionMessagesError !== null && (
                      <span className="text-red-600">{interventionMessagesError}</span>
                    )}
                  </span>
                </div>

                <div className="space-y-5">
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">Asignar operador</legend>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id="workspace-operator"
                        type="text"
                        aria-label="Asignar operador"
                        value={assignOperator}
                        onChange={(event) => setAssignOperator(event.target.value)}
                        placeholder="Ana Operadora"
                        className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleAssign}
                        disabled={assignOperator.trim() === '' || interventionsStatus === 'loading'}
                        className="rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Asignar
                      </button>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">
                      Responder al cliente
                    </legend>
                    <textarea
                      id="workspace-reply"
                      aria-label="Responder al cliente"
                      value={replyContent}
                      onChange={(event) => setReplyContent(event.target.value)}
                      placeholder="Redacta la respuesta que enviará el operador."
                      rows={4}
                      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleReply}
                      disabled={
                        replyContent.trim() === '' || interventionMessagesStatus === 'loading'
                      }
                      className="mt-2 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Enviar respuesta
                    </button>
                  </fieldset>

                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={interventionsStatus === 'loading'}
                    className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cerrar intervención
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {interventionsError !== null && <span className="text-red-600">{interventionsError}</span>}
      </span>
    </section>
  );
}
