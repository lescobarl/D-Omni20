/**
 * Sección "Árboles" del área de operación del bot (B.3 — eslabón ③ Conversación).
 *
 * Contrato:
 * - CRUD de `navigationTrees` del tenant (nombre y opciones/menús de navegación del
 *   bot) gestionado por el backend con RLS.
 * - Sección autocontenida: carga los árboles al montar y reutiliza un único
 *   formulario para crear y editar árboles (modo edición).
 * - El nombre se valida localmente (obligatorio) antes de enviar.
 * - Las opciones se editan como texto con una `clave: etiqueta` por línea y se
 *   normalizan a `Array<Record<string, unknown>>` al guardar.
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { INavigationTreeRead } from '@/api/types';
import type { INavigationTreeInput } from '@/services/operationsService';
import { useOperationsStore } from '@/store/operationsStore';

/** Estado del formulario de árboles (las opciones se editan como texto). */
interface INavigationTreeFormState {
  /** Nombre del árbol (obligatorio, único por tenant). */
  name: string;
  /** Opciones del árbol, una `clave: etiqueta` por línea. */
  options: string;
}

const EMPTY_FORM: INavigationTreeFormState = {
  name: '',
  options: '',
};

/** Lee la clave de una opción tipada por el backend (si está presente). */
function optionKey(option: Record<string, unknown>): string {
  return typeof option.key === 'string' ? option.key : '';
}

/** Lee la etiqueta de una opción tipada por el backend (cae a la clave). */
function optionLabel(option: Record<string, unknown>): string {
  return typeof option.label === 'string' ? option.label : optionKey(option);
}

/** Formatea una opción como `clave: etiqueta` para mostrarla en la lista. */
function formatOption(option: Record<string, unknown>): string {
  const key = optionKey(option);
  const label = optionLabel(option);
  return key === '' ? label : `${key}: ${label}`;
}

/** Normaliza un texto con una `clave: etiqueta` por línea a opciones del árbol. */
function parseOptions(raw: string): Array<Record<string, unknown>> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const separator = line.indexOf(':');
      const key = (separator === -1 ? line : line.slice(0, separator)).trim();
      const label = (separator === -1 ? line : line.slice(separator + 1)).trim();
      return { key, label: label === '' ? key : label };
    })
    .filter((option) => option.key !== '');
}

/**
 * Sección de árboles de navegación del bot con CRUD completo (B.3).
 *
 * @example
 * ```tsx
 * <TreesSection />
 * ```
 *
 * @returns El formulario de árboles y la lista de flujos de navegación del bot.
 */
export function TreesSection(): ReactElement {
  const navigationTrees = useOperationsStore((state) => state.navigationTrees);
  const navigationTreesStatus = useOperationsStore((state) => state.navigationTreesStatus);
  const navigationTreesError = useOperationsStore((state) => state.navigationTreesError);
  const listNavigationTrees = useOperationsStore((state) => state.listNavigationTrees);
  const createNavigationTree = useOperationsStore((state) => state.createNavigationTree);
  const updateNavigationTree = useOperationsStore((state) => state.updateNavigationTree);
  const deleteNavigationTree = useOperationsStore((state) => state.deleteNavigationTree);

  const [form, setForm] = useState<INavigationTreeFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Sección autocontenida: carga los árboles al montar.
  useEffect(() => {
    void listNavigationTrees();
  }, [listNavigationTrees]);

  const setField = <K extends keyof INavigationTreeFormState>(
    key: K,
    value: INavigationTreeFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (tree: INavigationTreeRead): void => {
    setForm({
      name: tree.name,
      options: tree.options.map((option) => formatOption(option)).join('\n'),
    });
    setEditingId(tree.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = form.name.trim();
    if (name === '') {
      setFormError('El nombre es obligatorio.');
      return;
    }
    const options = parseOptions(form.options);
    const input: INavigationTreeInput = {
      name,
      numOptions: options.length,
      options: options.length === 0 ? undefined : options,
    };
    if (editingId !== null) {
      await updateNavigationTree(editingId, input);
    } else {
      await createNavigationTree(input);
    }
    resetForm();
  };

  const handleDelete = async (tree: INavigationTreeRead): Promise<void> => {
    await deleteNavigationTree(tree.id);
  };

  const isLoading = navigationTreesStatus === 'loading' && navigationTrees.length === 0;

  return (
    <section aria-labelledby="trees-heading">
      <h2 id="trees-heading" className="text-lg font-semibold text-slate-900">
        Árboles
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Flujos de navegación del bot con sus opciones y menús. Los árboles definen los menús que el
        bot presenta al cliente durante la conversación.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Conversación ③
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando árboles…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar árbol' : 'Crear árbol'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar árbol' : 'Nuevo árbol'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="tree-name" className="block text-sm text-slate-600">
                    Nombre
                  </label>
                  <input
                    id="tree-name"
                    type="text"
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Menú principal"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="tree-options" className="block text-sm text-slate-600">
                    Opciones
                  </label>
                  <textarea
                    id="tree-options"
                    rows={4}
                    value={form.options}
                    onChange={(event) => setField('options', event.target.value)}
                    placeholder={'saludar: Saludar\ncomprar: Comprar'}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={navigationTreesStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId !== null ? 'Guardar cambios' : 'Crear árbol'}
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
            <p className="text-sm font-medium text-slate-700">Árboles de navegación</p>
            {navigationTrees.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay árboles de navegación.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {navigationTrees.map((tree) => (
                  <li key={tree.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {tree.num_options} opciones
                          </span>
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {tree.name}
                        </h3>
                        {tree.options.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {tree.options.map((option, index) => (
                              <span
                                key={index}
                                className="inline-block rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
                              >
                                {formatOption(option)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(tree)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(tree)}
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
        {navigationTreesError !== null && (
          <span className="text-red-600">{navigationTreesError}</span>
        )}
      </span>
    </section>
  );
}
