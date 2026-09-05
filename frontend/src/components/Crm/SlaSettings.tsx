import { useState, type FormEvent, type ReactElement } from 'react';
import type { ISlaInput } from '@/services/crmService';
import { useCrmStore } from '@/store/crmStore';

interface ISlaDraft {
  /** Horas máximas para responder (borrador local). */
  maxResponseHours: string;
  /** Días máximos de permanencia en la etapa (borrador local). */
  maxStayDays: string;
}

/**
 * Configuración de políticas SLA por etapa del pipeline. Cada etapa tiene su
 * propio formulario y estado de borrador local (sin persistencia parcial).
 */
export function SlaSettings(): ReactElement {
  const stages = useCrmStore((state) => state.stages);
  const sla = useCrmStore((state) => state.sla);
  const upsertSla = useCrmStore((state) => state.upsertSla);

  const [drafts, setDrafts] = useState<Record<string, ISlaDraft>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const valueFor = (stageId: string, field: keyof ISlaDraft): string => {
    const draft = drafts[stageId];
    if (draft !== undefined) {
      return draft[field];
    }
    const policy = sla.find((item) => item.stage_id === stageId);
    if (policy === undefined) {
      return '';
    }
    return field === 'maxResponseHours'
      ? String(policy.max_response_hours)
      : String(policy.max_stay_days);
  };

  const setDraftField = (stageId: string, field: keyof ISlaDraft, value: string): void => {
    setDrafts((current) => ({
      ...current,
      [stageId]: {
        maxResponseHours: valueFor(stageId, 'maxResponseHours'),
        maxStayDays: valueFor(stageId, 'maxStayDays'),
        [field]: value,
      },
    }));
  };

  const handleSubmit = async (stageId: string, event: FormEvent): Promise<void> => {
    event.preventDefault();
    const maxResponseHours = Number(valueFor(stageId, 'maxResponseHours'));
    const maxStayDays = Number(valueFor(stageId, 'maxStayDays'));
    if (!Number.isFinite(maxResponseHours) || maxResponseHours < 0) {
      setSaveErrors((current) => ({
        ...current,
        [stageId]: 'Las horas de respuesta deben ser un número mayor o igual a 0.',
      }));
      return;
    }
    if (!Number.isFinite(maxStayDays) || maxStayDays < 0) {
      setSaveErrors((current) => ({
        ...current,
        [stageId]: 'Los días máximos deben ser un número mayor o igual a 0.',
      }));
      return;
    }
    setSaveErrors((current) => ({ ...current, [stageId]: '' }));
    const input: ISlaInput = { stageId, maxResponseHours, maxStayDays };
    await upsertSla(input);
    if (useCrmStore.getState().slaError !== null) {
      setSaveErrors((current) => ({
        ...current,
        [stageId]: 'No se pudo guardar la política SLA.',
      }));
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[stageId];
      return next;
    });
  };

  if (stages.length === 0) {
    return (
      <p className="text-sm text-slate-500" role="status">
        No hay etapas configuradas para definir políticas SLA.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {stages
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((stage) => {
          const policy = sla.find((item) => item.stage_id === stage.id);
          return (
            <form
              key={stage.id}
              aria-label={`Política SLA de ${stage.name}`}
              onSubmit={(event) => void handleSubmit(stage.id, event)}
              noValidate
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-slate-900">{stage.name}</h3>
                  {policy !== undefined ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Actual: {policy.max_response_hours} h · {policy.max_stay_days} días
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-500">Sin política configurada.</p>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-sm text-slate-600">
                    Horas de respuesta
                    <input
                      type="number"
                      min={0}
                      value={valueFor(stage.id, 'maxResponseHours')}
                      onChange={(event) =>
                        setDraftField(stage.id, 'maxResponseHours', event.target.value)
                      }
                      className="mt-1 w-28 rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm text-slate-600">
                    Días máximos
                    <input
                      type="number"
                      min={0}
                      value={valueFor(stage.id, 'maxStayDays')}
                      onChange={(event) =>
                        setDraftField(stage.id, 'maxStayDays', event.target.value)
                      }
                      className="mt-1 w-28 rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
                  >
                    Guardar
                  </button>
                </div>
              </div>
              {saveErrors[stage.id] !== undefined && saveErrors[stage.id] !== '' && (
                <p className="mt-2 text-sm text-red-600" role="status">
                  {saveErrors[stage.id]}
                </p>
              )}
            </form>
          );
        })}
    </div>
  );
}
