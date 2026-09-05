/**
 * Configurador de Landings (modo landing del configurador único).
 *
 * Contrato:
 * - Es un envoltorio FINO sobre el configurador único `PageEditor` en modo
 *   `landing`. Toda la lógica de orquestación (carga de lista/entidad, creación,
 *   guardado y publicación) vive en `PageEditor`/`createLandingMode`.
 * - Se mantiene como export nombrado en esta ruta para no romper los imports
 *   existentes (`App.tsx`), pero ya NO contiene lógica duplicada.
 */
import type { ReactElement } from 'react';
import { PageEditor } from '@/components/Editor/PageEditor';
import type { IAppConfig } from '@/types/config';

interface ILandingEditorProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
}

/**
 * Configurador de Landings (modo landing del configurador único).
 *
 * @example
 * ```tsx
 * <LandingEditor config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El layout tri-panel del editor con la barra de herramientas de la landing.
 */
export function LandingEditor({ config }: ILandingEditorProps): ReactElement {
  return <PageEditor config={config} mode="landing" />;
}
