/**
 * Barra lateral del editor con pestañas: Bloques | IA | Schemas | Marketplace | Analítica.
 *
 * Contrato:
 * - Las pestañas "IA", "Schemas", "Marketplace" y "Analítica" solo se muestran si las
 *   banderas correspondientes de `features` están activas.
 * - Implementa semántica de pestañas accesible (`tablist`/`tab`/`tabpanel`).
 * - Por defecto arranca en la pestaña de bloques.
 */
import { useState, type ReactElement } from 'react';
import type { IAppConfig } from '@/types/config';
import { AIPanel } from '@/components/Editor/Sidebar/AIPanel';
import { AnalyticsDashboard } from '@/components/Editor/Sidebar/AnalyticsDashboard';
import { BlocksLibrary } from '@/components/Editor/Sidebar/BlocksLibrary';
import { DeveloperSchemaPanel } from '@/components/Editor/Sidebar/DeveloperSchemaPanel';
import { MarketplacePanel } from '@/components/Editor/Sidebar/MarketplacePanel';

/** Pestañas disponibles en la barra lateral. */
type SidebarTab = 'blocks' | 'ai' | 'developer' | 'marketplace' | 'analytics';

interface IEditorSidebarProps {
  /** Configuración validada de la aplicación (banderas de funcionalidad). */
  config: IAppConfig;
}

/**
 * Barra lateral del editor con pestañas Bloques | IA | Schemas | Marketplace | Analítica.
 *
 * @example
 * ```tsx
 * <EditorSidebar config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La barra lateral con las pestañas disponibles.
 */
export function EditorSidebar({ config }: IEditorSidebarProps): ReactElement {
  const [activeTab, setActiveTab] = useState<SidebarTab>('blocks');
  const aiEnabled = config.features.aiAssistant;
  const analyticsEnabled = config.features.analytics;
  const developerEnabled = config.features.developerSchemas;
  const marketplaceEnabled = config.features.templateMarketplace;

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
        aria-label="Panel lateral del editor"
        className="flex border-b border-slate-200"
      >
        <button
          type="button"
          role="tab"
          id="sidebar-tab-blocks"
          aria-controls="sidebar-panel-blocks"
          aria-selected={activeTab === 'blocks'}
          onClick={() => setActiveTab('blocks')}
          className={tabButtonClass(activeTab === 'blocks')}
        >
          Bloques
        </button>
        {aiEnabled && (
          <button
            type="button"
            role="tab"
            id="sidebar-tab-ai"
            aria-controls="sidebar-panel-ai"
            aria-selected={activeTab === 'ai'}
            onClick={() => setActiveTab('ai')}
            className={tabButtonClass(activeTab === 'ai')}
          >
            IA
          </button>
        )}
        {developerEnabled && (
          <button
            type="button"
            role="tab"
            id="sidebar-tab-developer"
            aria-controls="sidebar-panel-developer"
            aria-selected={activeTab === 'developer'}
            onClick={() => setActiveTab('developer')}
            className={tabButtonClass(activeTab === 'developer')}
          >
            Schemas
          </button>
        )}
        {marketplaceEnabled && (
          <button
            type="button"
            role="tab"
            id="sidebar-tab-marketplace"
            aria-controls="sidebar-panel-marketplace"
            aria-selected={activeTab === 'marketplace'}
            onClick={() => setActiveTab('marketplace')}
            className={tabButtonClass(activeTab === 'marketplace')}
          >
            Marketplace
          </button>
        )}
        {analyticsEnabled && (
          <button
            type="button"
            role="tab"
            id="sidebar-tab-analytics"
            aria-controls="sidebar-panel-analytics"
            aria-selected={activeTab === 'analytics'}
            onClick={() => setActiveTab('analytics')}
            className={tabButtonClass(activeTab === 'analytics')}
          >
            Analítica
          </button>
        )}
      </div>

      <div
        role="tabpanel"
        id="sidebar-panel-blocks"
        aria-labelledby="sidebar-tab-blocks"
        hidden={activeTab !== 'blocks'}
        className="flex-1 overflow-y-auto"
      >
        <BlocksLibrary />
      </div>

      {aiEnabled && (
        <div
          role="tabpanel"
          id="sidebar-panel-ai"
          aria-labelledby="sidebar-tab-ai"
          hidden={activeTab !== 'ai'}
          className="flex-1 overflow-y-auto"
        >
          <AIPanel />
        </div>
      )}
      {developerEnabled && (
        <div
          role="tabpanel"
          id="sidebar-panel-developer"
          aria-labelledby="sidebar-tab-developer"
          hidden={activeTab !== 'developer'}
          className="flex-1 overflow-y-auto"
        >
          <DeveloperSchemaPanel />
        </div>
      )}
      {marketplaceEnabled && (
        <div
          role="tabpanel"
          id="sidebar-panel-marketplace"
          aria-labelledby="sidebar-tab-marketplace"
          hidden={activeTab !== 'marketplace'}
          className="flex-1 overflow-y-auto"
        >
          <MarketplacePanel />
        </div>
      )}
      {analyticsEnabled && (
        <div
          role="tabpanel"
          id="sidebar-panel-analytics"
          aria-labelledby="sidebar-tab-analytics"
          hidden={activeTab !== 'analytics'}
          className="flex-1 overflow-y-auto"
        >
          <AnalyticsDashboard />
        </div>
      )}
    </div>
  );
}
