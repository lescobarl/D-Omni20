/**
 * Panel derecho del editor con pestañas: Código | Vista previa | Workflows.
 *
 * Contrato:
 * - Implementa semántica de pestañas accesible (`tablist`/`tab`/`tabpanel`).
 * - Los paneles permanecen montados y se ocultan con `hidden`: preserva el
 *   contrato de tests y evita recargar Monaco/la vista previa al alternar.
 * - Por defecto arranca en la pestaña de código.
 */
import { useState, type ReactElement } from 'react';
import { CodeEditor } from '@/components/Editor/CodeEditor/CodeEditor';
import { PreviewPanel } from '@/components/Editor/Preview/PreviewPanel';
import { WorkflowPanel } from '@/components/Workflows/WorkflowPanel';
import type { IAppConfig } from '@/types/config';

/** Pestañas disponibles en el panel derecho del editor. */
type RightPanelTab = 'code' | 'preview' | 'workflows';

interface IEditorRightPanelProps {
  /** Configuración validada de la aplicación (para feature flags como CDN). */
  config: IAppConfig;
}

/**
 * Panel derecho del editor con pestañas Código | Vista previa | Workflows.
 *
 * @example
 * ```tsx
 * <EditorRightPanel />
 * ```
 *
 * @returns El panel con las pestañas de código, vista previa y workflows.
 */
export function EditorRightPanel({ config }: IEditorRightPanelProps): ReactElement {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('code');

  const tabButtonClass = (selected: boolean): string =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-medium transition ${
      selected
        ? 'border-brand-600 text-brand-700'
        : 'border-transparent text-slate-500 hover:text-slate-700'
    }`;

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="Panel derecho del editor"
        className="flex border-b border-slate-200"
      >
        <button
          type="button"
          role="tab"
          id="right-tab-code"
          aria-controls="right-panel-code"
          aria-selected={activeTab === 'code'}
          onClick={() => setActiveTab('code')}
          className={tabButtonClass(activeTab === 'code')}
        >
          Código
        </button>
        <button
          type="button"
          role="tab"
          id="right-tab-preview"
          aria-controls="right-panel-preview"
          aria-selected={activeTab === 'preview'}
          onClick={() => setActiveTab('preview')}
          className={tabButtonClass(activeTab === 'preview')}
        >
          Vista previa
        </button>
        <button
          type="button"
          role="tab"
          id="right-tab-workflows"
          aria-controls="right-panel-workflows"
          aria-selected={activeTab === 'workflows'}
          onClick={() => setActiveTab('workflows')}
          className={tabButtonClass(activeTab === 'workflows')}
        >
          Workflows
        </button>
      </div>

      <div
        role="tabpanel"
        id="right-panel-code"
        aria-labelledby="right-tab-code"
        hidden={activeTab !== 'code'}
        className="min-h-0 flex-1"
      >
        <CodeEditor />
      </div>

      <div
        role="tabpanel"
        id="right-panel-preview"
        aria-labelledby="right-tab-preview"
        hidden={activeTab !== 'preview'}
        className="min-h-0 flex-1"
      >
        <PreviewPanel cdnDeploy={config.features.cdnDeploy} />
      </div>

      <div
        role="tabpanel"
        id="right-panel-workflows"
        aria-labelledby="right-tab-workflows"
        hidden={activeTab !== 'workflows'}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <WorkflowPanel />
      </div>
    </div>
  );
}
