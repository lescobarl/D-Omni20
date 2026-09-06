/**
 * Panel del asistente IA para generar landings o páginas del portal desde un prompt.
 *
 * Contrato:
 * - Configurador único basado en IA generativa: el mismo panel genera tanto
 *   landings como páginas del portal mediante un selector de modo.
 * - Recibe el prompt (y el workflow en modo landing) y ejecuta la generación vía
 *   `useAiStore.generate` (el servicio IA se inyecta por DI en el composition root).
 * - Muestra el estado del flujo (`idle | loading | success | error`) de forma
 *   accesible (`role="status"` / `role="alert"`).
 * - Permite aplicar el resultado generado al store del editor activo (landing o
 *   portal) mediante `useEditorStoreContext().setLanding`.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { WORKFLOW_DEFINITIONS } from '@/core/workflows';
import { useAiStore, type AiMode } from '@/store/aiStore';
import { useEditorStoreContext } from '@/store/editorStoreContext';
import type { WorkflowType } from '@/types/editor';

/**
 * Panel del asistente IA de generación (landing o portal).
 *
 * @example
 * ```tsx
 * <AIPanel />
 * ```
 *
 * @returns El formulario de generación IA y el resumen del resultado.
 */
export function AIPanel(): ReactElement {
  const status = useAiStore((state) => state.status);
  const prompt = useAiStore((state) => state.prompt);
  const workflowType = useAiStore((state) => state.workflowType);
  const mode = useAiStore((state) => state.mode);
  const result = useAiStore((state) => state.result);
  const error = useAiStore((state) => state.error);
  const setPrompt = useAiStore((state) => state.setPrompt);
  const setWorkflowType = useAiStore((state) => state.setWorkflowType);
  const setMode = useAiStore((state) => state.setMode);
  const generate = useAiStore((state) => state.generate);
  const editorStore = useEditorStoreContext();
  const setLanding = editorStore((state) => state.setLanding);

  /** Indica si el resultado actual ya se aplicó al editor. */
  const [applied, setApplied] = useState(false);

  // Al generar un nuevo resultado se vuelve a habilitar la acción de aplicar.
  useEffect(() => {
    setApplied(false);
  }, [result]);

  const isGenerating = status === 'loading';
  const isPortal = mode === 'portal';

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void generate();
  };

  const handleModeChange = (nextMode: AiMode): void => {
    setMode(nextMode);
    setApplied(false);
  };

  const handleApply = (): void => {
    if (result === null) return;
    setLanding(result.config);
    setApplied(true);
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Asistente IA</h2>

      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-slate-600">Tipo de página</span>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => handleModeChange('landing')}
            disabled={isGenerating}
            aria-pressed={!isPortal}
            className={`rounded px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
              !isPortal
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Landing
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('portal')}
            disabled={isGenerating}
            aria-pressed={isPortal}
            className={`rounded px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
              isPortal ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Portal
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="ai-prompt" className="mb-1 block text-xs font-medium text-slate-600">
            {isPortal
              ? 'Describe la página del portal que quieres generar'
              : 'Describe la landing que quieres generar'}
          </label>
          <textarea
            id="ai-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            disabled={isGenerating}
            placeholder={
              isPortal
                ? 'Ej.: Portal del cliente con servicios, testimonios y formulario de contacto.'
                : 'Ej.: Landing de venta para una clínica dental con testimonios y formulario de cotización.'
            }
            className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        {!isPortal && (
          <div>
            <label htmlFor="ai-workflow" className="mb-1 block text-xs font-medium text-slate-600">
              Workflow de conversión
            </label>
            <select
              id="ai-workflow"
              value={workflowType}
              onChange={(event) => setWorkflowType(event.target.value as WorkflowType)}
              disabled={isGenerating}
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
            >
              {WORKFLOW_DEFINITIONS.map((workflow) => (
                <option key={workflow.type} value={workflow.type}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          disabled={isGenerating || prompt.trim() === ''}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isGenerating ? 'Generando…' : isPortal ? 'Generar página del portal' : 'Generar landing'}
        </button>
      </form>

      <div role="status" aria-live="polite" className="mt-3">
        {status === 'loading' && (
          <p className="text-sm text-slate-500">
            Generando {isPortal ? 'la página del portal' : 'la landing'}, esto puede tardar unos
            segundos…
          </p>
        )}
        {status === 'error' && error !== null && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>

      {result !== null && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-slate-800">{result.config.title}</p>
          <p className="mt-1 text-xs text-slate-500">
            {result.config.blocks.length} bloques · modelo {result.model} ·{' '}
            {result.cached ? 'desde caché' : 'generado'}
          </p>
          <button
            type="button"
            onClick={handleApply}
            disabled={applied}
            className="mt-2 w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {applied
              ? isPortal
                ? 'Aplicada al portal'
                : 'Aplicada al editor'
              : isPortal
                ? 'Aplicar al portal'
                : 'Aplicar al editor'}
          </button>
        </div>
      )}
    </div>
  );
}
