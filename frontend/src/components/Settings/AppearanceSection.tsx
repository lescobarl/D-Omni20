/**
 * Sección "Apariencia / Branding" del configurador del tenant.
 *
 * Contrato:
 * - Permite editar la paleta de marca (color primario, acento, superficie, texto e
 *   insignia), el logo y la tipografía del tenant.
 * - Aplica la paleta en vivo vía `applyTheme` (CSS custom properties) para que el
 *   rebranding se vea en toda la aplicación antes de guardar.
 * - Guarda mediante `saveAppearance` (PUT idempotente) y refleja el estado del store.
 * - Permite extraer la paleta, tipografía y logo desde una URL de marca (rebranding) y
 *   aplicarlos al tema en un clic, además de guardar configuraciones reutilizables.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { applyTheme } from '@/core/theme';
import { proposalToTheme } from '@/services/rebrandingService';
import { getRebrandingService, useTenantConfigStore } from '@/store/tenantConfigStore';
import type { IAppConfig, IAppTheme } from '@/types/config';

interface IAppearanceSectionProps {
  /** Configuración validada (aporta el tema por defecto como fallback). */
  config: IAppConfig;
}

/** Campo de color editable de la paleta de marca. */
interface IColorField {
  /** Clave del color dentro del tema (paleta de marca). */
  key: 'primaryColor' | 'accentColor' | 'surfaceColor' | 'textColor' | 'brandBadge';
  /** Etiqueta visible del campo. */
  label: string;
}

const COLOR_FIELDS: IColorField[] = [
  { key: 'primaryColor', label: 'Color primario' },
  { key: 'accentColor', label: 'Color de acento' },
  { key: 'surfaceColor', label: 'Color de superficie' },
  { key: 'textColor', label: 'Color de texto' },
  { key: 'brandBadge', label: 'Color de insignia' },
];

/** Etiqueta de un campo de texto de la apariencia. */
type TextFieldKey = 'logoUrl' | 'fontFamily';

/** Paleta predefinida de marca (arranque minimalista, ejecutivo). */
interface IBrandPreset {
  /** Nombre visible del tema. */
  name: string;
  /** Colores del tema que reemplaza (el resto del borrador se conserva). */
  theme: Pick<
    IAppTheme,
    'primaryColor' | 'accentColor' | 'surfaceColor' | 'textColor' | 'brandBadge'
  >;
}

const BRAND_PRESETS: IBrandPreset[] = [
  {
    name: 'Ejecutivo',
    theme: {
      primaryColor: '#1f2937',
      accentColor: '#4f46e5',
      surfaceColor: '#ffffff',
      textColor: '#0f172a',
      brandBadge: '#111827',
    },
  },
  {
    name: 'Confianza',
    theme: {
      primaryColor: '#2563eb',
      accentColor: '#0ea5e9',
      surfaceColor: '#f8fafc',
      textColor: '#0f172a',
      brandBadge: '#1d4ed8',
    },
  },
  {
    name: 'Esmeralda',
    theme: {
      primaryColor: '#059669',
      accentColor: '#10b981',
      surfaceColor: '#ffffff',
      textColor: '#064e3b',
      brandBadge: '#047857',
    },
  },
  {
    name: 'Ébano y cobre',
    theme: {
      primaryColor: '#18181b',
      accentColor: '#b45309',
      surfaceColor: '#fafaf9',
      textColor: '#18181b',
      brandBadge: '#0c0a09',
    },
  },
];

/**
 * Sección de apariencia del tenant con vista previa en vivo.
 *
 * @example
 * ```tsx
 * <AppearanceSection config={config} />
 * ```
 *
 * @param props - Propiedades de la sección.
 * @returns El formulario de apariencia con paleta, logo, tipografía y vista previa.
 */
export function AppearanceSection({ config }: IAppearanceSectionProps): ReactElement {
  const appearance = useTenantConfigStore((state) => state.appearance);
  const appearanceStatus = useTenantConfigStore((state) => state.appearanceStatus);
  const appearanceError = useTenantConfigStore((state) => state.appearanceError);
  const loadAppearance = useTenantConfigStore((state) => state.loadAppearance);
  const saveAppearance = useTenantConfigStore((state) => state.saveAppearance);
  const appearanceProposal = useTenantConfigStore((state) => state.appearanceProposal);
  const rebrandingStatus = useTenantConfigStore((state) => state.rebrandingStatus);
  const rebrandingError = useTenantConfigStore((state) => state.rebrandingError);
  const rebrandingConfigs = useTenantConfigStore((state) => state.rebrandingConfigs);
  const extractUrl = useTenantConfigStore((state) => state.extractUrl);
  const saveRebranding = useTenantConfigStore((state) => state.saveRebranding);
  const listRebrandingConfigs = useTenantConfigStore((state) => state.listRebrandingConfigs);
  const deleteRebranding = useTenantConfigStore((state) => state.deleteRebranding);

  const [draft, setDraft] = useState<IAppTheme>(appearance ?? config.theme);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [url, setUrl] = useState('');
  const [configName, setConfigName] = useState('');
  const [rebrandSaved, setRebrandSaved] = useState(false);

  // Sección autocontenida: carga la apariencia del tenant al montar.
  useEffect(() => {
    void loadAppearance();
  }, [loadAppearance]);

  // Carga las configuraciones de rebranding guardadas solo si el servicio está disponible.
  useEffect(() => {
    if (getRebrandingService() !== null) {
      void listRebrandingConfigs();
    }
  }, [listRebrandingConfigs]);

  // Sincroniza el borrador con la apariencia persistida cuando termina de cargar
  // y el usuario aún no ha empezado a editar ni acaba de guardar (evita que el
  // efecto limpie la confirmación "Apariencia guardada." justo después del guardado).
  useEffect(() => {
    if (appearanceStatus === 'success' && !dirty && !saved && appearance) {
      setDraft(appearance);
      setSaved(false);
    }
  }, [appearanceStatus, appearance, dirty, saved]);

  const updateColor = (key: IColorField['key'], value: string): void => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setDirty(true);
    setSaved(false);
    applyTheme(next);
  };

  const updateText = (key: TextFieldKey, value: string): void => {
    const next = { ...draft, [key]: value === '' ? undefined : value };
    setDraft(next);
    setDirty(true);
    setSaved(false);
    applyTheme(next);
  };

  const handleSave = async (): Promise<void> => {
    await saveAppearance(draft);
    setDirty(false);
    setSaved(true);
  };

  const applyPreset = (preset: IBrandPreset): void => {
    const next = { ...draft, ...preset.theme };
    setDraft(next);
    setDirty(true);
    setSaved(false);
    applyTheme(next);
  };

  const handleExtract = async (): Promise<void> => {
    if (url.trim() === '') {
      return;
    }
    setRebrandSaved(false);
    await extractUrl(url.trim());
  };

  const handleApplyProposal = async (): Promise<void> => {
    if (appearanceProposal === null) {
      return;
    }
    const theme = proposalToTheme(appearanceProposal, draft);
    setDraft(theme);
    setDirty(true);
    setSaved(false);
    applyTheme(theme);
    await saveAppearance(theme);
  };

  const handleSaveRebranding = async (): Promise<void> => {
    if (url.trim() === '' || configName.trim() === '') {
      return;
    }
    const config = await saveRebranding({ name: configName.trim(), url: url.trim() });
    if (config !== null) {
      setConfigName('');
      setRebrandSaved(true);
    }
  };

  /**
   * Guarda los estilos actuales del tenant como una configuración de rebranding
   * reutilizable (modo snapshot, sin URL). El backend captura la apariencia
   * persistida actual en lugar de extraer estilos de una URL externa.
   */
  const handleSaveCurrentStyles = async (): Promise<void> => {
    if (configName.trim() === '') {
      return;
    }
    const config = await saveRebranding({ name: configName.trim() });
    if (config !== null) {
      setConfigName('');
      setRebrandSaved(true);
    }
  };

  const handleDeleteRebranding = (configId: string): void => {
    void deleteRebranding(configId);
  };

  const isLoading = appearanceStatus === 'loading' && !dirty;

  return (
    <section aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="text-lg font-semibold text-slate-900">
        Apariencia / Branding
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Personaliza la paleta de marca, el logo y la tipografía. Los cambios se aplican en vivo a
        toda la aplicación.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando apariencia…
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Temas de marca</legend>
                <p className="mt-0.5 text-xs text-slate-500">
                  Puntos de partida minimalistas. Al elegir uno, ajusta la paleta abajo y guarda.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BRAND_PRESETS.map((preset) => {
                    const isActive = draft.primaryColor === preset.theme.primaryColor;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => applyPreset(preset)}
                        className={
                          isActive
                            ? 'flex items-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white transition'
                            : 'flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50'
                        }
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-black/10"
                          style={{ backgroundColor: preset.theme.primaryColor }}
                          aria-hidden="true"
                        />
                        {preset.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Paleta de marca</legend>
                <div className="mt-2 space-y-3">
                  {COLOR_FIELDS.map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-3">
                      <label htmlFor={`appearance-${field.key}`} className="text-sm text-slate-600">
                        {field.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`appearance-${field.key}`}
                          type="color"
                          value={draft[field.key]}
                          onChange={(event) => updateColor(field.key, event.target.value)}
                          className="h-8 w-12 cursor-pointer rounded border border-slate-300 bg-white"
                        />
                        <code className="text-xs text-slate-500">{draft[field.key]}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Logo y tipografía</legend>
                <div className="mt-2 space-y-3">
                  <div>
                    <label htmlFor="appearance-logoUrl" className="block text-sm text-slate-600">
                      URL del logo
                    </label>
                    <input
                      id="appearance-logoUrl"
                      type="url"
                      value={draft.logoUrl ?? ''}
                      onChange={(event) => updateText('logoUrl', event.target.value)}
                      placeholder="URL pública del logo (ejemplo: cdn.tudominio.com/logo.png)"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="appearance-fontFamily" className="block text-sm text-slate-600">
                      Tipografía
                    </label>
                    <input
                      id="appearance-fontFamily"
                      type="text"
                      value={draft.fontFamily ?? ''}
                      onChange={(event) => updateText('fontFamily', event.target.value)}
                      placeholder="Inter, system-ui"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </fieldset>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700">Vista previa</p>
              <div
                className="mt-2 rounded-lg border border-slate-200 p-6"
                style={{
                  backgroundColor: draft.surfaceColor,
                  color: draft.textColor,
                  fontFamily: draft.fontFamily ?? undefined,
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="rounded-full px-3 py-1 text-sm font-medium text-white"
                    style={{ backgroundColor: draft.brandBadge }}
                  >
                    OmniBotIA
                  </span>
                  <span className="text-xs opacity-70">Vista previa en vivo</span>
                </div>
                <h3 className="mt-4 text-xl font-semibold" style={{ color: draft.textColor }}>
                  Tu marca, tu color
                </h3>
                <p className="mt-1 text-sm opacity-80">
                  Este es el aspecto que tendrá tu sitio con la paleta seleccionada.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className="rounded px-4 py-2 text-sm font-medium text-white"
                    style={{ backgroundColor: draft.primaryColor }}
                  >
                    Botón principal
                  </button>
                  <button
                    type="button"
                    className="rounded px-4 py-2 text-sm font-medium text-white"
                    style={{ backgroundColor: draft.accentColor }}
                  >
                    Botón de acento
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={appearanceStatus === 'loading' || !dirty}
                  className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Guardar apariencia
                </button>
                <span role="status" aria-live="polite" className="text-sm">
                  {saved && <span className="text-brand-700">Apariencia guardada.</span>}
                  {appearanceError && <span className="text-red-600">{appearanceError}</span>}
                </span>
              </div>
            </div>
          </div>

          {getRebrandingService() !== null && (
            <div className="mt-6 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-700">Importar de URL (rebranding)</h3>
              <p className="mt-1 text-xs text-slate-500">
                Pega la URL pública de una marca para extraer su paleta, tipografía y logo, y
                aplicarlos al tema del tenant con un clic.
              </p>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label htmlFor="appearance-rebrandingUrl" className="sr-only">
                  URL de la marca
                </label>
                <input
                  id="appearance-rebrandingUrl"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="marca.ejemplo.com"
                  className="w-full flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleExtract()}
                  disabled={rebrandingStatus === 'loading' || url.trim() === ''}
                  className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rebrandingStatus === 'loading' ? 'Extrayendo…' : 'Extraer estilos'}
                </button>
              </div>

              {appearanceProposal !== null && (
                <div className="mt-4 rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-700">Propuesta detectada</p>
                    <button
                      type="button"
                      onClick={() => void handleApplyProposal()}
                      disabled={rebrandingStatus === 'loading'}
                      className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Aplicar al tema
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    {appearanceProposal.logo_url !== null && (
                      <img
                        src={appearanceProposal.logo_url}
                        alt="Logo de la marca detectada"
                        className="h-10 w-10 rounded object-contain"
                      />
                    )}
                    {appearanceProposal.detected_fonts.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {appearanceProposal.detected_fonts.map((font) => (
                          <span
                            key={font}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                          >
                            {font}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Primario', value: appearanceProposal.primary_color },
                        { label: 'Acento', value: appearanceProposal.accent_color },
                        { label: 'Superficie', value: appearanceProposal.surface_color },
                        { label: 'Texto', value: appearanceProposal.text_color },
                        { label: 'Insignia', value: appearanceProposal.brand_badge },
                      ].map(
                        (swatch) =>
                          swatch.value !== null && (
                            <span
                              key={swatch.label}
                              className="flex items-center gap-1 text-xs text-slate-600"
                            >
                              <span
                                className="inline-block h-4 w-4 rounded border border-slate-200"
                                style={{ backgroundColor: swatch.value }}
                              />
                              {swatch.label}
                            </span>
                          ),
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <label htmlFor="appearance-rebrandingName" className="sr-only">
                  Nombre de la configuración
                </label>
                <input
                  id="appearance-rebrandingName"
                  type="text"
                  value={configName}
                  onChange={(event) => setConfigName(event.target.value)}
                  placeholder="Nombre de la configuración (ejemplo: Marca X)"
                  className="w-full flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveRebranding()}
                  disabled={
                    rebrandingStatus === 'loading' || url.trim() === '' || configName.trim() === ''
                  }
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Guardar configuración
                </button>
              </div>

              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleSaveCurrentStyles()}
                  disabled={rebrandingStatus === 'loading' || configName.trim() === ''}
                  className="rounded border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Guardar estilos actuales como backup
                </button>
                <p className="text-xs text-slate-500 sm:self-center">
                  Guarda la apariencia actual del tenant sin necesidad de una URL externa.
                </p>
              </div>

              <span role="status" aria-live="polite" className="mt-2 block text-sm">
                {rebrandSaved && <span className="text-brand-700">Configuración guardada.</span>}
                {rebrandingError !== null && (
                  <span className="text-red-600">{rebrandingError}</span>
                )}
              </span>

              {rebrandingConfigs.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {rebrandingConfigs.map((config) => (
                    <li
                      key={config.id}
                      className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700">{config.name}</p>
                        <p className="truncate text-xs text-slate-500">{config.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRebranding(config.id)}
                        disabled={rebrandingStatus === 'loading'}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
