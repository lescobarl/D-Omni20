/**
 * Sección "Plantillas" del área de operación del bot (B.5 — eslabones ③ Conversación
 * y ⑥ Cierre).
 *
 * Contrato:
 * - CRUD de `templates` del tenant (nombre, cuerpo con variables ``{{ }}``, tipo y
 *   variables declaradas) gestionado por el backend con RLS.
 * - Sección autocontenida: carga las plantillas al montar y reutiliza un único
 *   formulario para crear y editar plantillas (modo edición).
 * - El nombre se valida localmente (obligatorio) antes de enviar.
 * - Las variables se editan como texto separado por comas y se normalizan a
 *   `string[]`; los campos vacíos se envían como `undefined`.
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { ITemplateRead } from '@/api/types';
import type { ITemplateInput } from '@/services/operationsService';
import { useOperationsStore } from '@/store/operationsStore';

/** Estado del formulario de plantillas (las variables se editan como texto). */
interface ITemplateFormState {
  /** Nombre de la plantilla (obligatorio, único por tenant). */
  name: string;
  /** Cuerpo del mensaje con variables ``{{ }}``. */
  body: string;
  /** Tipo de plantilla por defecto (`text`). */
  templateType: string;
  /** Variables separadas por comas (se normalizan a `string[]` al guardar). */
  variables: string;
}

const EMPTY_FORM: ITemplateFormState = {
  name: '',
  body: '',
  templateType: 'text',
  variables: '',
};

/** Normaliza un texto de variables separadas por comas a un arreglo no vacío. */
function parseVariables(raw: string): string[] {
  return raw
    .split(',')
    .map((variable) => variable.trim())
    .filter((variable) => variable !== '');
}

/**
 * Sección de plantillas de mensaje del tenant con CRUD completo (B.5).
 *
 * @example
 * ```tsx
 * <TemplatesSection />
 * ```
 *
 * @returns El formulario de plantillas y la lista de mensajes reutilizables.
 */
export function TemplatesSection(): ReactElement {
  const templates = useOperationsStore((state) => state.templates);
  const templatesStatus = useOperationsStore((state) => state.templatesStatus);
  const templatesError = useOperationsStore((state) => state.templatesError);
  const listTemplates = useOperationsStore((state) => state.listTemplates);
  const createTemplate = useOperationsStore((state) => state.createTemplate);
  const updateTemplate = useOperationsStore((state) => state.updateTemplate);
  const deleteTemplate = useOperationsStore((state) => state.deleteTemplate);

  const [form, setForm] = useState<ITemplateFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Sección autocontenida: carga las plantillas al montar.
  useEffect(() => {
    void listTemplates();
  }, [listTemplates]);

  const setField = <K extends keyof ITemplateFormState>(
    key: K,
    value: ITemplateFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (template: ITemplateRead): void => {
    setForm({
      name: template.name,
      body: template.body,
      templateType: template.template_type,
      variables: (template.variables ?? []).join(', '),
    });
    setEditingId(template.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = form.name.trim();
    if (name === '') {
      setFormError('El nombre es obligatorio.');
      return;
    }
    const variables = parseVariables(form.variables);
    const input: ITemplateInput = {
      name,
      body: form.body.trim() === '' ? undefined : form.body,
      templateType: form.templateType.trim() === '' ? undefined : form.templateType,
      variables: variables.length === 0 ? undefined : variables,
    };
    if (editingId !== null) {
      await updateTemplate(editingId, input);
    } else {
      await createTemplate(input);
    }
    resetForm();
  };

  const handleDelete = async (template: ITemplateRead): Promise<void> => {
    await deleteTemplate(template.id);
  };

  const isLoading = templatesStatus === 'loading' && templates.length === 0;

  return (
    <section aria-labelledby="templates-heading">
      <h2 id="templates-heading" className="text-lg font-semibold text-slate-900">
        Plantillas
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Mensajes reutilizables con variables {'{{ }}'} para conversaciones y cierres. Las plantillas
        se aplican en flujos, campañas e intervención humana.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Conversación ③ · Cierre ⑥
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando plantillas…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar plantilla' : 'Crear plantilla'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar plantilla' : 'Nueva plantilla'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="template-name" className="block text-sm text-slate-600">
                    Nombre
                  </label>
                  <input
                    id="template-name"
                    type="text"
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Bienvenida"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="template-body" className="block text-sm text-slate-600">
                    Cuerpo
                  </label>
                  <textarea
                    id="template-body"
                    rows={4}
                    value={form.body}
                    onChange={(event) => setField('body', event.target.value)}
                    placeholder="Hola {{nombre}}, bienvenido a OmniBotIA."
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="template-type" className="block text-sm text-slate-600">
                      Tipo
                    </label>
                    <input
                      id="template-type"
                      type="text"
                      value={form.templateType}
                      onChange={(event) => setField('templateType', event.target.value)}
                      placeholder="text"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="template-variables" className="block text-sm text-slate-600">
                      Variables
                    </label>
                    <input
                      id="template-variables"
                      type="text"
                      value={form.variables}
                      onChange={(event) => setField('variables', event.target.value)}
                      placeholder="nombre, apellido"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={templatesStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId !== null ? 'Guardar cambios' : 'Crear plantilla'}
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
            <p className="text-sm font-medium text-slate-700">Plantillas de mensaje</p>
            {templates.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay plantillas de mensaje.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {templates.map((template) => (
                  <li key={template.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {template.template_type}
                          </span>
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {template.name}
                        </h3>
                        {template.body !== '' && (
                          <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                            {template.body}
                          </p>
                        )}
                        {template.variables.length > 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            Variables: {template.variables.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(template)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(template)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {templatesError !== null && <span className="text-red-600">{templatesError}</span>}
      </span>
    </section>
  );
}
