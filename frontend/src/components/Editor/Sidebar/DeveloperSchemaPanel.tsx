/**
 * Panel del editor de JSON Schemas para desarrolladores.
 *
 * Contrato:
 * - Recibe el prompt y el nombre opcional y ejecuta la generación vía
 *   `useSchemaStore.generate` (el servicio se inyecta por DI en el composition root).
 * - Al montarse carga la lista de schemas del tenant (`useSchemaStore.fetchSchemas`).
 * - Al seleccionar un schema carga su historial de versiones
 *   (`useSchemaStore.fetchVersions`) y permite crear nuevas versiones
 *   (instantánea + nota) con la versión sugerida auto-incrementada.
 * - Muestra el schema generado, el seleccionado o la versión seleccionada en una
 *   vista Monaco de solo lectura (JSON, Draft 2020-12) cargada de forma diferida
 *   (`React.lazy`), con un respaldo `<pre><code>` mientras carga (mismo contrato de tests).
 * - Expone el estado del flujo (`idle | loading | success | error`) de forma
 *   accesible (`role="status"` / `role="alert"`).
 */
import { Suspense, lazy, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { VisualSchemaEditor } from '@/components/Editor/VisualSchema/VisualSchemaEditor';
import { useSchemaStore } from '@/store/schemaStore';

/** Vista JSON cargada de forma diferida (Monaco fuera de la ruta crítica). */
const SchemaJsonViewer = lazy(() => import('./SchemaJsonViewer'));

/**
 * JSON de respaldo que se muestra mientras la vista diferida carga.
 * @param props - Propiedades del respaldo (JSON a mostrar).
 */
function JsonFallback({ json }: { json: string }): ReactElement {
  return (
    <pre className="h-full overflow-auto whitespace-pre bg-slate-900 p-3 font-mono text-xs text-slate-200">
      <code>{json}</code>
    </pre>
  );
}

/**
 * Incrementa el último segmento numérico de una versión semver.
 * @param version Versión actual (p. ej. `1.0.0`).
 * @returns La versión sugerida siguiente (p. ej. `1.0.1`).
 */
function bumpVersion(version: string): string {
  const parts = version.split('.');
  const last = parts.length > 0 ? Number(parts[parts.length - 1]) : Number.NaN;
  parts[parts.length - 1] = String(Number.isFinite(last) ? last + 1 : 1);
  return parts.join('.');
}

/**
 * Panel del editor de JSON Schemas para desarrolladores.
 *
 * @example
 * ```tsx
 * <DeveloperSchemaPanel />
 * ```
 *
 * @returns El formulario de generación, la lista de schemas y la vista JSON.
 */
export function DeveloperSchemaPanel(): ReactElement {
  const status = useSchemaStore((state) => state.status);
  const prompt = useSchemaStore((state) => state.prompt);
  const name = useSchemaStore((state) => state.name);
  const result = useSchemaStore((state) => state.result);
  const schemas = useSchemaStore((state) => state.schemas);
  const selectedSchemaId = useSchemaStore((state) => state.selectedSchemaId);
  const versions = useSchemaStore((state) => state.versions);
  const versionsStatus = useSchemaStore((state) => state.versionsStatus);
  const selectedVersionId = useSchemaStore((state) => state.selectedVersionId);
  const versionsError = useSchemaStore((state) => state.versionsError);
  const error = useSchemaStore((state) => state.error);
  const setPrompt = useSchemaStore((state) => state.setPrompt);
  const setName = useSchemaStore((state) => state.setName);
  const fetchSchemas = useSchemaStore((state) => state.fetchSchemas);
  const generate = useSchemaStore((state) => state.generate);
  const selectSchema = useSchemaStore((state) => state.selectSchema);
  const fetchVersions = useSchemaStore((state) => state.fetchVersions);
  const createVersion = useSchemaStore((state) => state.createVersion);
  const selectVersion = useSchemaStore((state) => state.selectVersion);
  const visualMode = useSchemaStore((state) => state.visualMode);
  const setVisualMode = useSchemaStore((state) => state.setVisualMode);
  const setDraftSchema = useSchemaStore((state) => state.setDraftSchema);
  const [versionInput, setVersionInput] = useState('');
  const [changeNote, setChangeNote] = useState('');

  // Carga la lista de schemas del tenant al montar el panel.
  useEffect(() => {
    void fetchSchemas();
  }, [fetchSchemas]);

  // Al seleccionar un schema carga su historial de versiones y sugiere la siguiente.
  useEffect(() => {
    if (selectedSchemaId === null) {
      return;
    }
    const schema = schemas.find((item) => item.id === selectedSchemaId) ?? null;
    setVersionInput(schema !== null ? bumpVersion(schema.version) : '1.0.0');
    setChangeNote('');
    void fetchVersions(selectedSchemaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchemaId]);

  const isGenerating = status === 'loading';
  const isVersioning = versionsStatus === 'loading';

  // El schema visible: la versión seleccionada, el schema seleccionado o el recién generado.
  const selectedSchema = schemas.find((schema) => schema.id === selectedSchemaId) ?? null;
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;

  const visibleSchema =
    selectedVersion !== null
      ? selectedVersion.schema_json
      : selectedSchema !== null
        ? selectedSchema.schema_json
        : result !== null
          ? result.schema
          : null;

  const visibleTitle =
    selectedVersion !== null
      ? `v${selectedVersion.version}`
      : selectedSchema !== null
        ? selectedSchema.name
        : result !== null
          ? ((result.schema['title'] as string | undefined) ?? 'Schema generado')
          : null;

  const visibleJson = visibleSchema !== null ? JSON.stringify(visibleSchema, null, 2) : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void generate();
  };

  // Crea una nueva versión del schema seleccionado con la nota de cambio.
  const handleCreateVersion = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (selectedSchemaId === null || versionInput.trim() === '') {
      return;
    }
    void createVersion(versionInput.trim(), changeNote);
  };

  // Abre el editor visual sembrando el schema visible (o un objeto vacío).
  const handleOpenVisualEditor = (): void => {
    setDraftSchema(visibleSchema ?? { type: 'object', properties: {} });
    setVisualMode(true);
  };

  // En modo visual el panel muestra el editor visual en lugar del formulario.
  if (visualMode) {
    return <VisualSchemaEditor />;
  }

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Editor de Schemas</h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="schema-name" className="mb-1 block text-xs font-medium text-slate-600">
            Nombre (opcional)
          </label>
          <input
            id="schema-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isGenerating}
            placeholder="Ej.: Cliente"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="schema-prompt" className="mb-1 block text-xs font-medium text-slate-600">
            Describe el JSON Schema que quieres generar
          </label>
          <textarea
            id="schema-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            disabled={isGenerating}
            placeholder="Ej.: Esquema JSON de un cliente con nombre, email y teléfono opcional."
            className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <button
          type="submit"
          disabled={isGenerating || prompt.trim() === ''}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isGenerating ? 'Generando…' : 'Generar schema'}
        </button>
      </form>

      <button
        type="button"
        onClick={handleOpenVisualEditor}
        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Abrir editor visual
      </button>

      <div role="status" aria-live="polite" className="mt-3">
        {status === 'loading' && (
          <p className="text-sm text-slate-500">
            Generando el JSON Schema, esto puede tardar unos segundos…
          </p>
        )}
        {status === 'error' && error !== null && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>

      {schemas.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Schemas guardados
          </h3>
          <ul className="space-y-1">
            {schemas.map((schema) => (
              <li key={schema.id}>
                <button
                  type="button"
                  onClick={() => selectSchema(schema.id)}
                  aria-pressed={schema.id === selectedSchemaId}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-sm transition ${
                    schema.id === selectedSchemaId
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'
                  }`}
                >
                  <span className="font-medium">{schema.name}</span>
                  <span className="ml-1 text-xs text-slate-400">v{schema.version}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedSchemaId !== null && (
        <div className="mt-3 rounded-md border border-slate-200 p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Versiones
          </h3>

          <div role="status" aria-live="polite">
            {versionsStatus === 'loading' && (
              <p className="text-sm text-slate-500">Cargando versiones…</p>
            )}
            {versionsStatus === 'error' && versionsError !== null && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {versionsError}
              </p>
            )}
          </div>

          {versions.length > 0 && (
            <ul className="mt-1 space-y-1">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => selectVersion(version.id)}
                    aria-pressed={version.id === selectedVersionId}
                    className={`w-full rounded-md border px-2 py-1.5 text-left text-sm transition ${
                      version.id === selectedVersionId
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'
                    }`}
                  >
                    <span className="font-medium">v{version.version}</span>
                    {version.change_note !== null && (
                      <span className="ml-1 text-xs text-slate-400">{version.change_note}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCreateVersion} className="mt-2 space-y-2">
            <div>
              <label
                htmlFor="schema-version"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Nueva versión
              </label>
              <input
                id="schema-version"
                type="text"
                value={versionInput}
                onChange={(event) => setVersionInput(event.target.value)}
                disabled={isVersioning}
                placeholder="Ej.: 1.0.1"
                className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label
                htmlFor="schema-version-note"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Nota del cambio
              </label>
              <textarea
                id="schema-version-note"
                value={changeNote}
                onChange={(event) => setChangeNote(event.target.value)}
                rows={2}
                disabled={isVersioning}
                placeholder="Ej.: Añadido campo de teléfono obligatorio."
                className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
              />
            </div>

            <button
              type="submit"
              disabled={isVersioning || versionInput.trim() === ''}
              className="w-full rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              {isVersioning ? 'Creando…' : 'Crear versión'}
            </button>
          </form>
        </div>
      )}

      {visibleJson !== null && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {visibleTitle ?? 'Vista previa'}
          </h3>
          <div className="h-64 overflow-hidden rounded-md border border-slate-200">
            <Suspense fallback={<JsonFallback json={visibleJson} />}>
              <SchemaJsonViewer json={visibleJson} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
