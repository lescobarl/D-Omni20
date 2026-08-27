/**
 * Panel de despliegue al CDN (Fase 10).
 *
 * Contrato:
 * - Lee la landing en edición desde `useEditorStore` (id y título) sin recibir props.
 * - `useCdnStore.deploy(landingId)` ejecuta `POST /api/v1/cdn/deploy/{id}` y guarda
 *   la respuesta con la URL pública versionada.
 * - Sin `landing.id` (landing local aún no persistida en el backend) el botón queda
 *   deshabilitado con una explicación; si el id no existe, el backend devuelve 404 y
 *   el error se muestra de forma accesible.
 * - Expone el estado (`idle | loading | success | error`) accesiblemente
 *   (`role="status"` / `role="alert"`).
 */
import { type ReactElement } from 'react';
import { useCdnStore } from '@/store/cdnStore';
import { useEditorStore } from '@/store/editorStore';

/**
 * Panel de despliegue al CDN integrado en la vista previa.
 * @returns La sección con el botón de despliegue y el estado del flujo.
 */
export function CdnDeploymentPanel(): ReactElement {
  const landingId = useEditorStore((state) => state.landing.id);
  const deployment = useCdnStore((state) => state.deployment);
  const status = useCdnStore((state) => state.status);
  const error = useCdnStore((state) => state.error);
  const deploy = useCdnStore((state) => state.deploy);

  const hasLandingId = landingId !== undefined && landingId.length > 0;
  const isLoading = status === 'loading';

  const handleDeploy = (): void => {
    if (landingId !== undefined) {
      void deploy(landingId);
    }
  };

  return (
    <section
      aria-labelledby="cdn-deploy-heading"
      className="mt-3 rounded-md border border-slate-200 bg-white p-3"
    >
      <h3 id="cdn-deploy-heading" className="text-xs font-semibold text-slate-700">
        Despliegue al CDN
      </h3>

      {!hasLandingId && (
        <p role="status" className="mt-1 text-xs text-slate-500">
          La landing aún no está persistida en el backend; el despliegue estará disponible al
          guardar la campaña.
        </p>
      )}

      {isLoading && (
        <p role="status" className="mt-1 text-xs text-slate-500">
          Desplegando la landing al CDN…
        </p>
      )}

      {status === 'error' && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}

      {status === 'success' && deployment !== null && (
        <div className="mt-1 space-y-1">
          <p role="status" className="text-xs text-green-700">
            Desplegada la versión {deployment.version} ({deployment.status}).
          </p>
          <a
            href={deployment.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-brand-700 underline"
          >
            Abrir URL del CDN
          </a>
        </div>
      )}

      <button
        type="button"
        onClick={handleDeploy}
        disabled={!hasLandingId || isLoading}
        className="mt-2 inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Desplegar al CDN
      </button>
    </section>
  );
}
