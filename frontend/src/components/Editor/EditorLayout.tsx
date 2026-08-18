/**
 * Layout tri-panel del editor.
 *
 * Contrato:
 * - Panel izquierdo: librería de bloques (Sidebar).
 * - Panel central: canvas de edición (Canvas).
 * - Panel derecho: editor de código (CodeEditor).
 */
import type { ReactElement } from 'react';
import { Canvas } from '@/components/Editor/Canvas/Canvas';
import { BlocksLibrary } from '@/components/Editor/Sidebar/BlocksLibrary';
import { CodeEditor } from '@/components/Editor/CodeEditor/CodeEditor';
import { EditorDndContext } from '@/components/Editor/dnd/EditorDndContext';

/**
 * Layout de tres paneles del editor de landings.
 *
 * @example
 * ```tsx
 * <EditorLayout />
 * ```
 *
 * @returns El layout con librería de bloques, canvas y editor de código.
 */
export function EditorLayout(): ReactElement {
  return (
    <EditorDndContext>
      <div className="flex flex-1 overflow-hidden">
        <aside
          aria-label="Librería de bloques"
          className="w-72 shrink-0 border-r border-slate-200 bg-white"
        >
          <BlocksLibrary />
        </aside>
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <Canvas />
        </main>
        <aside
          aria-label="Editor de código"
          className="w-96 shrink-0 border-l border-slate-200 bg-white"
        >
          <CodeEditor />
        </aside>
      </div>
    </EditorDndContext>
  );
}
