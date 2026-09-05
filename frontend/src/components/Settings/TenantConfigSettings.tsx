/**
 * Contenedor de pestañas de configuración del tenant para el bot.
 *
 * Contrato:
 * - Pestañas accesibles (`role="tablist"`/`tab`/`tabpanel`) con Apariencia,
 *   Contenido, Catálogo y Canales, siguiendo el patrón de `EditorSidebar`.
 * - Todos los paneles permanecen montados y se ocultan con `hidden` para preservar
 *   el estado local de cada sección (borradores y formularios) al cambiar de pestaña.
 * - La sección de apariencia recibe la configuración para proveer el tema por defecto.
 */
import { useState, type ReactElement } from 'react';
import type { IAppConfig } from '@/types/config';
import { AppearanceSection } from '@/components/Settings/AppearanceSection';
import { ContentSection } from '@/components/Settings/ContentSection';
import { CatalogSection } from '@/components/Settings/CatalogSection';
import { ChannelsSection } from '@/components/Settings/ChannelsSection';
import { BotsSection } from '@/components/Settings/BotsSection';

/** Pestañas disponibles del configurador. */
type SettingsTab = 'appearance' | 'content' | 'catalog' | 'channels' | 'bots';

interface ITenantConfigSettingsProps {
  /** Configuración de la aplicación (provee el tema por defecto de apariencia). */
  config: IAppConfig;
}

/** Definición de pestañas en orden de presentación. */
const TABS: ReadonlyArray<{ id: SettingsTab; label: string; panelId: string }> = [
  { id: 'appearance', label: 'Apariencia', panelId: 'settings-panel-appearance' },
  { id: 'content', label: 'Contenido', panelId: 'settings-panel-content' },
  { id: 'catalog', label: 'Catálogo', panelId: 'settings-panel-catalog' },
  { id: 'channels', label: 'Canales', panelId: 'settings-panel-channels' },
  { id: 'bots', label: 'Bots', panelId: 'settings-panel-bots' },
];

/**
 * Configurador del bot con pestañas accesibles.
 *
 * @example
 * ```tsx
 * <TenantConfigSettings config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns Las pestañas de configuración y sus paneles montados.
 */
export function TenantConfigSettings({ config }: ITenantConfigSettingsProps): ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  const tabButtonClass = (selected: boolean): string =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-medium transition ${
      selected
        ? 'border-brand-600 text-brand-700'
        : 'border-transparent text-slate-500 hover:text-slate-700'
    }`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label="Configuración del bot"
        className="flex border-b border-slate-200 bg-white"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-controls={tab.panelId}
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={tabButtonClass(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div
          role="tabpanel"
          id="settings-panel-appearance"
          aria-labelledby="settings-tab-appearance"
          hidden={activeTab !== 'appearance'}
        >
          <AppearanceSection config={config} />
        </div>
        <div
          role="tabpanel"
          id="settings-panel-content"
          aria-labelledby="settings-tab-content"
          hidden={activeTab !== 'content'}
        >
          <ContentSection />
        </div>
        <div
          role="tabpanel"
          id="settings-panel-catalog"
          aria-labelledby="settings-tab-catalog"
          hidden={activeTab !== 'catalog'}
        >
          <CatalogSection />
        </div>
        <div
          role="tabpanel"
          id="settings-panel-channels"
          aria-labelledby="settings-tab-channels"
          hidden={activeTab !== 'channels'}
        >
          <ChannelsSection />
        </div>
        <div
          role="tabpanel"
          id="settings-panel-bots"
          aria-labelledby="settings-tab-bots"
          hidden={activeTab !== 'bots'}
        >
          <BotsSection />
        </div>
      </div>
    </div>
  );
}
