/**
 * Layout tri-panel del editor.
 *
 * Contrato:
 * - Panel izquierdo: barra lateral con pestañas Bloques | IA (EditorSidebar).
 * - Panel central: canvas de edición (Canvas).
 * - Panel derecho: panel con pestañas Código | Vista previa (EditorRightPanel).
 */
import type { ReactElement } from 'react';
import { Canvas } from '@/components/Editor/Canvas/Canvas';
import { EditorSidebar } from '@/components/Editor/Sidebar/EditorSidebar';
import { EditorRightPanel } from '@/components/Editor/RightPanel/EditorRightPanel';
import { EditorDndContext } from '@/components/Editor/dnd/EditorDndContext';
import type { IAppConfig } from '@/types/config';

interface IEditorLayoutProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
}

/**
 * Layout de tres paneles del editor de landings.
 *
 * @example
 * ```tsx
 * <EditorLayout config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El layout con barra lateral, canvas y panel derecho con pestañas.
 */
export function EditorLayout({ config }: IEditorLayoutProps): ReactElement {
  return (
    <EditorDndContext>
      <div className="flex flex-1 overflow-hidden">
        <aside
          aria-label="Librería de bloques"
          className="w-72 shrink-0 border-r border-slate-200 bg-white"
        >
          <EditorSidebar config={config} />
        </aside>
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <Canvas />
        </main>
        <aside
          aria-label="Editor de código"
          className="w-96 shrink-0 border-l border-slate-200 bg-white"
        >
          <EditorRightPanel config={config} />
        </aside>
      </div>
    </EditorDndContext>
  );
}
