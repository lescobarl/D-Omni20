/**
 * Configurador unificado del sitio (landing + páginas del portal).
 *
 * Contrato:
 * - Presenta UNA sola pantalla de configuración con un selector unificado que
 *   lista la landing («Inicio») y todas las páginas del portal juntas, de modo
 *   que el usuario edita todo el sitio sin cambiar de pantalla.
 * - La landing es la «home» del sitio: al seleccionarla se abre el configurador
 *   de landings (que gestiona su propia lista de landings del tenant).
 * - Cada página del portal se lista individualmente; al seleccionarla se abre
 *   el configurador de portal con esa página precargada (`initialSelectedId`) y
 *   sin su selector interno (el selector unificado es la fuente de verdad).
 * - Delega la orquestación real (carga, creación, guardado y publicación) en el
 *   configurador único `PageEditor` según el modo derivado de la selección.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PageEditor, type PageEditorMode } from '@/components/Editor/PageEditor';
import { getLandingService } from '@/store/editorStore';
import { getPortalService } from '@/store/portalStore';
import type { IAppConfig } from '@/types/config';

/** Identificador reservado de la landing («Inicio») en el selector unificado. */
const LANDING_HOME_ID = '__home__';

/** Tipo de página del sitio (landing o portal). */
type SitePageKind = PageEditorMode;

/** Opción del selector unificado de páginas del sitio. */
interface ISitePageOption {
  /** Clave única de la opción (combina grupo e id). */
  key: string;
  /** Tipo de página (landing o portal). */
  kind: SitePageKind;
  /** Identificador de la entidad persistida (vacío para la landing en blanco). */
  id: string;
  /** Nombre legible de la página para el selector. */
  name: string;
  /** Grupo del selector (landing o portal). */
  group: 'landing' | 'portal';
}

/** Selección activa del configurador unificado. */
interface ISiteSelection {
  /** Tipo de página seleccionada. */
  kind: SitePageKind;
  /** Identificador de la entidad seleccionada (vacío para la landing en blanco). */
  id: string;
}

interface ISiteEditorProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
}

/**
 * Configurador unificado del sitio (landing + páginas del portal).
 *
 * @example
 * ```tsx
 * <SiteEditor config={config} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El configurador del sitio con el selector unificado de páginas.
 */
export function SiteEditor({ config }: ISiteEditorProps): ReactElement {
  const [landingOptions, setLandingOptions] = useState<ISitePageOption[]>([]);
  const [portalOptions, setPortalOptions] = useState<ISitePageOption[]>([]);
  const [selection, setSelection] = useState<ISiteSelection>({
    kind: 'landing',
    id: LANDING_HOME_ID,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const portalServiceAvailable = getPortalService() !== null;

  /** Carga las listas de landings y páginas del portal del tenant. */
  const loadLists = async (): Promise<void> => {
    setStatus('loading');
    setError(null);
    const landingSvc = getLandingService();
    const portalSvc = getPortalService();
    try {
      const [landingPage, portalPage] = await Promise.all([
        landingSvc !== null
          ? landingSvc.list({ page: 1, page_size: 100 })
          : Promise.resolve({ items: [] }),
        portalSvc !== null
          ? portalSvc.list({ page: 1, page_size: 100 })
          : Promise.resolve({ items: [] }),
      ]);
      const landings = (landingPage.items ?? []).map((item) => ({
        key: `landing:${item.id}`,
        kind: 'landing' as const,
        id: item.id,
        name: item.name,
        group: 'landing' as const,
      }));
      const portals = (portalPage.items ?? []).map((item) => ({
        key: `portal:${item.id}`,
        kind: 'portal' as const,
        id: item.id,
        name: item.title || item.slug,
        group: 'portal' as const,
      }));
      setLandingOptions(landings);
      setPortalOptions(portals);
      setStatus('idle');
    } catch (loadError) {
      setStatus('error');
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'No se pudieron cargar las páginas del sitio.',
      );
    }
  };

  useEffect(() => {
    void loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Opción «Inicio» (landing) siempre presente en el selector unificado. */
  const homeOption: ISitePageOption = useMemo(
    () => ({
      key: `landing:${LANDING_HOME_ID}`,
      kind: 'landing',
      id: LANDING_HOME_ID,
      name: 'Inicio (Landing)',
      group: 'landing',
    }),
    [],
  );

  /** Opciones de la landing: la «home» más las landings persistidas del tenant. */
  const landingGroupOptions = useMemo(
    () => [homeOption, ...landingOptions],
    [homeOption, landingOptions],
  );

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const key = event.target.value;
    const all = [...landingGroupOptions, ...portalOptions];
    const option = all.find((item) => item.key === key);
    if (!option) {
      return;
    }
    // Al cambiar de tipo de página se refrescan las listas para reflejar
    // entidades recién creadas/guardadas en el otro modo.
    if (option.kind !== selection.kind) {
      void loadLists();
    }
    setSelection({ kind: option.kind, id: option.id });
  };

  const selectedKey =
    selection.kind === 'landing'
      ? `landing:${selection.id}`
      : `portal:${selection.id}`;

  const isPortal = selection.kind === 'portal';
  const portalSelectedId = isPortal ? selection.id : undefined;
  // La landing «Inicio» es un estado en blanco (nueva): no se precarga ninguna
  // entidad. Solo las landings persistidas del tenant llevan `initialSelectedId`.
  const landingSelectedId =
    !isPortal && selection.id !== LANDING_HOME_ID ? selection.id : undefined;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <label htmlFor="site-page-select" className="text-sm font-medium text-slate-600">
          Página del sitio
        </label>
        <select
          id="site-page-select"
          value={selectedKey}
          onChange={handleSelect}
          disabled={status === 'loading'}
          aria-label="Página del sitio a editar"
          className="w-72 rounded border border-slate-300 px-3 py-1 text-sm text-slate-900 focus:border-brand-500 focus:outline-none disabled:opacity-50"
        >
          <optgroup label="Landing">
            {landingGroupOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Páginas del portal">
            {portalOptions.length === 0 ? (
              <option value="" disabled>
                {portalServiceAvailable
                  ? 'Sin páginas todavía'
                  : 'Portal no disponible'}
              </option>
            ) : (
              portalOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.name}
                </option>
              ))
            )}
          </optgroup>
        </select>
        {status === 'error' && error !== null && (
          <span role="alert" className="text-sm text-red-600">
            {error}
          </span>
        )}
      </div>
      {isPortal && portalSelectedId ? (
        <PageEditor
          config={config}
          mode="portal"
          hideSelector
          initialSelectedId={portalSelectedId}
        />
      ) : (
        <PageEditor
          config={config}
          mode="landing"
          hideSelector
          initialSelectedId={landingSelectedId}
        />
      )}
    </div>
  );
}
