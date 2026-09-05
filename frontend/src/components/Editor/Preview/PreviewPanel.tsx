/**
 * Panel de vista previa del HTML compilado de la landing.
 *
 * Contrato:
 * - Muestra el HTML compilado en un `<iframe>` aislado (`sandbox=""`) cuando la
 *   compilación termina o está en curso; el `sandbox` vacío impide scripts/plugins
 *   dentro del documento de vista previa (seguridad).
 * - Expone controles de la cabecera: alternar `minify` (recompilación diferida vía
 *   `useCompiledLanding`) y descargar el HTML con `downloadHtml` (habilitado solo
 *   cuando hay un resultado compilado, `status === 'success'`).
 * - Representa cada estado del flujo de forma accesible: `role="alert"` para errores,
 *   `role="status"` (aria-live) para el estado de compilación y placeholder para `idle`.
 */
import type { ReactElement } from 'react';
import { CdnDeploymentPanel } from '@/components/Editor/Preview/CdnDeploymentPanel';
import { useCompiledLanding } from '@/hooks/useCompiledLanding';
import { buildDownloadFileName, downloadHtml } from '@/lib/htmlDownload';
import { useCompilerStore } from '@/store/compilerStore';
import { useEditorStoreContext } from '@/store/editorStoreContext';

/** Mensaje por defecto cuando el estado de error no incluye detalle. */
const DEFAULT_COMPILE_ERROR = 'No se pudo compilar la landing.';

interface IPreviewPanelProps {
  /** Habilita el panel de despliegue al CDN (feature flag `cdnDeploy`). */
  cdnDeploy?: boolean;
}

/**
 * Panel de vista previa del HTML compilado de la landing.
 *
 * @example
 * ```tsx
 * <PreviewPanel />
 * ```
 *
 * @returns La cabecera con controles y el área de vista previa o estado.
 */
export function PreviewPanel({ cdnDeploy = false }: IPreviewPanelProps): ReactElement {
  const { status, html, durationMs, error } = useCompiledLanding();
  const minify = useCompilerStore((state) => state.minify);
  const setMinify = useCompilerStore((state) => state.setMinify);
  const store = useEditorStoreContext();
  const landingTitle = store((state) => state.landing.title);

  /** Solo se puede descargar cuando existe un resultado compilado. */
  const canDownload = status === 'success' && html !== '';

  const handleDownload = (): void => {
    if (!canDownload) return;
    downloadHtml(html, buildDownloadFileName(landingTitle));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Vista previa</h2>
          <div className="flex items-center gap-3">
            <label
              htmlFor="preview-minify"
              className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600"
            >
              <input
                id="preview-minify"
                type="checkbox"
                checked={minify}
                onChange={(event) => setMinify(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-brand-600"
              />
              Minificar HTML
            </label>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!canDownload}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Descargar HTML
            </button>
          </div>
        </div>
      </div>

      {cdnDeploy && <CdnDeploymentPanel />}

      <div className="min-h-0 flex-1">
        {status === 'error' && (
          <div role="alert" className="p-4">
            <p className="text-sm font-medium text-red-600">{error ?? DEFAULT_COMPILE_ERROR}</p>
          </div>
        )}
        {status === 'idle' && (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-sm text-slate-500">
              Compila la landing para ver la vista previa aquí.
            </p>
          </div>
        )}
        {(status === 'compiling' || status === 'success') && (
          <iframe
            title="Vista previa de la landing"
            sandbox=""
            srcDoc={html}
            className="h-full w-full border-0"
          />
        )}
      </div>

      <div role="status" aria-live="polite" className="border-t border-slate-200 px-4 py-2">
        {status === 'compiling' && <p className="text-xs text-slate-500">Compilando…</p>}
        {status === 'success' && durationMs !== null && (
          <p className="text-xs text-slate-500">Compilado en {durationMs.toFixed(0)} ms</p>
        )}
      </div>
    </div>
  );
}
