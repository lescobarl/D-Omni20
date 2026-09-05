/**
 * Configurador del Portal del Cliente (modo portal del configurador único).
 *
 * Contrato:
 * - Es un envoltorio FINO sobre el configurador único `PageEditor` en modo
 *   `portal`. Toda la lógica de orquestación (carga de lista/entidad, creación,
 *   guardado y publicación) vive en `PageEditor`/`createPortalMode`.
 * - Se mantiene como export nombrado en esta ruta para no romper los imports
 *   existentes (`App.tsx` y `PortalEditor.test.tsx`), pero ya NO contiene
 *   lógica duplicada.
 */
import type { ReactElement } from 'react';
import { PageEditor } from '@/components/Editor/PageEditor';
import type { IAppConfig } from '@/types/config';

interface IPortalEditorProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
}

/**
 * Configurador del Portal del Cliente (modo portal del configurador único).
 *
 * @example
 * ```tsx
 * <PortalEditor config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El layout tri-panel del editor con la barra de herramientas del portal.
 */
export function PortalEditor({ config }: IPortalEditorProps): ReactElement {
  return <PageEditor config={config} mode="portal" />;
}
