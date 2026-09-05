/**
 * Contenedor de pestañas de la 3ª área «Operación del Bot» (Bloque B de LAE Omni2.0).
 *
 * Contrato:
 * - Fail-closed: solo se renderiza si el tenant habilita `features.operations`.
 * - Pestañas accesibles (`role="tablist"`/`tab`/`tabpanel`) con las 9 pantallas
 *   B.1-B.9: Dashboard, Estadísticas, Árboles, Campañas, Plantillas, Contactos,
 *   Intervención Humana, Monitor y Mantenimiento.
 * - Todos los paneles permanecen montados y se ocultan con `hidden` para preservar
 *   el estado local de cada sección (borradores y formularios) al cambiar de pestaña.
 * - Las 9 pantallas B.1-B.9 se implementan por fases (P1-P7) y permanecen
 *   montadas para preservar su estado local al cambiar de pestaña.
 * - P1 implementa las pantallas B.5 (Plantillas) y B.6 (Contactos) con CRUD
 *   completo; P2 añade la pantalla B.3 (Árboles); P3 añade la pantalla B.4
 *   (Campañas); P4 añade la pantalla B.7 (Intervención Humana); P5 añade la
 *   pantalla B.8 (Monitor); P6 añade las pantallas B.1 (Dashboard) y B.2
 *   (Estadísticas); P7 añade la pantalla B.9 (Mantenimiento) con limpieza y
 *   optimización del almacén. Ninguna pestaña conserva panel placeholder.
 */
import { useState, type ReactElement } from 'react';
import type { IAppConfig } from '@/types/config';
import { CrmSection } from '@/components/Crm/PipelineSection';
import { CampaignsSection } from '@/components/Operations/CampaignsSection';
import { ContactsSection } from '@/components/Operations/ContactsSection';
import { DashboardOperativo } from '@/components/Operations/DashboardOperativo';
import { EstadisticasBot } from '@/components/Operations/EstadisticasBot';
import { InterventionsSection } from '@/components/Operations/InterventionsSection';
import { MantenimientoBot } from '@/components/Operations/MantenimientoBot';
import { MonitorSection } from '@/components/Operations/MonitorSection';
import { TemplatesSection } from '@/components/Operations/TemplatesSection';
import { TreesSection } from '@/components/Operations/TreesSection';

/** Pestañas disponibles del área de operación del bot (B.1-B.9). */
type OperationsTab =
  | 'dashboard'
  | 'stats'
  | 'trees'
  | 'campaigns'
  | 'templates'
  | 'contacts'
  | 'intervention'
  | 'monitor'
  | 'maintenance'
  | 'sales';

interface IOperationsAreaProps {
  /** Configuración de la aplicación (habilita la 3ª área vía `features.operations`). */
  config: IAppConfig;
}

/**
 * Definición de pestañas en orden de presentación siguiendo el flujo orgánico de
 * configuración y operación del bot:
 *   1. Configuración (entradas): Plantillas (B.5), Árboles (B.3), Contactos (B.6),
 *      Campañas (B.4).
 *   2. Operación en vivo (runtime): Monitor (B.8), Intervención Humana (B.7),
 *      Mantenimiento (B.9).
 *   3. Resultados (salidas): Dashboard (B.1), Estadísticas (B.2).
 * La pestaña «Ventas» (CRM) es condicional y se muestra al final.
 */
const TABS: ReadonlyArray<{
  id: OperationsTab;
  label: string;
  panelId: string;
}> = [
  {
    id: 'templates',
    label: 'Plantillas',
    panelId: 'operations-panel-templates',
  },
  {
    id: 'trees',
    label: 'Árboles',
    panelId: 'operations-panel-trees',
  },
  {
    id: 'contacts',
    label: 'Contactos',
    panelId: 'operations-panel-contacts',
  },
  {
    id: 'campaigns',
    label: 'Campañas',
    panelId: 'operations-panel-campaigns',
  },
  {
    id: 'monitor',
    label: 'Monitor',
    panelId: 'operations-panel-monitor',
  },
  {
    id: 'intervention',
    label: 'Intervención Humana',
    panelId: 'operations-panel-intervention',
  },
  {
    id: 'maintenance',
    label: 'Mantenimiento',
    panelId: 'operations-panel-maintenance',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    panelId: 'operations-panel-dashboard',
  },
  {
    id: 'stats',
    label: 'Estadísticas',
    panelId: 'operations-panel-stats',
  },
  {
    id: 'sales',
    label: 'Ventas',
    panelId: 'operations-panel-sales',
  },
];

/**
 * Área de operación del bot con pestañas accesibles (B.1-B.9).
 *
 * @example
 * ```tsx
 * <OperationsArea config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns Las pestañas de operación y sus paneles montados.
 */
export function OperationsArea({ config }: IOperationsAreaProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<OperationsTab>('dashboard');

  // Fail-closed: el área solo existe si el tenant habilita la 3ª área. `App` ya
  // controla el acceso, pero el componente se comporta de forma autocontenida.
  if (!config.features.operations) {
    return null;
  }

  const tabButtonClass = (selected: boolean): string =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-medium transition ${
      selected
        ? 'border-brand-600 text-brand-700'
        : 'border-transparent text-slate-500 hover:text-slate-700'
    }`;

  // Fail-closed: la pestaña «Ventas» (CRM P3) solo aparece si la bandera `crm`
  // está activa; el resto de pestañas B.1-B.9 no dependen de esa bandera.
  const visibleTabs = config.features.crm ? TABS : TABS.filter((tab) => tab.id !== 'sales');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label="Operación del bot"
        className="flex border-b border-slate-200 bg-white"
      >
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`operations-tab-${tab.id}`}
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
        {visibleTabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={tab.panelId}
            aria-labelledby={`operations-tab-${tab.id}`}
            hidden={activeTab !== tab.id}
          >
            {tab.id === 'dashboard' ? (
              <DashboardOperativo />
            ) : tab.id === 'stats' ? (
              <EstadisticasBot />
            ) : tab.id === 'contacts' ? (
              <ContactsSection />
            ) : tab.id === 'templates' ? (
              <TemplatesSection />
            ) : tab.id === 'trees' ? (
              <TreesSection />
            ) : tab.id === 'campaigns' ? (
              <CampaignsSection config={config} />
            ) : tab.id === 'intervention' ? (
              <InterventionsSection />
            ) : tab.id === 'monitor' ? (
              <MonitorSection />
            ) : tab.id === 'maintenance' ? (
              <MantenimientoBot />
            ) : tab.id === 'sales' ? (
              <CrmSection />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
