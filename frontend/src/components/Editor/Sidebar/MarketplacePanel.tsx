/**
 * Panel del Marketplace de Templates.
 *
 * Contrato:
 * - Al montarse carga el catálogo del tenant (`useMarketplaceStore.fetchTemplates`).
 * - Permite filtrar el catálogo por categoría (filtro server-side vía backend).
 * - Cada template se muestra como tarjeta con nombre, categoría, descripción y descargas.
 * - El botón "Import from Marketplace" importa el template a la campaña actual del editor
 *   (`landing.campaignId`) y genera una landing en el backend; si no hay campaña activa,
 *   el botón se deshabilita y se muestra el motivo de forma accesible.
 * - Expone el estado del flujo (`idle | loading | success | error`) de forma
 *   accesible (`role="status"` / `role="alert"`).
 */
import { useEffect, type ReactElement } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useMarketplaceStore } from '@/store/marketplaceStore';

/** Formatea el número de descargas de forma localizada. */
function formatDownloads(downloads: number): string {
  return new Intl.NumberFormat('es-MX').format(downloads);
}

/**
 * Panel del Marketplace de Templates.
 * @returns El panel con el filtro de categorías y las tarjetas del catálogo.
 */
export function MarketplacePanel(): ReactElement {
  const templates = useMarketplaceStore((state) => state.templates);
  const status = useMarketplaceStore((state) => state.status);
  const error = useMarketplaceStore((state) => state.error);
  const categories = useMarketplaceStore((state) => state.categories);
  const activeCategory = useMarketplaceStore((state) => state.activeCategory);
  const importingId = useMarketplaceStore((state) => state.importingId);
  const importedTemplateId = useMarketplaceStore((state) => state.importedTemplateId);
  const lastImportedLandingId = useMarketplaceStore((state) => state.lastImportedLandingId);
  const fetchTemplates = useMarketplaceStore((state) => state.fetchTemplates);
  const setCategory = useMarketplaceStore((state) => state.setCategory);
  const importTemplate = useMarketplaceStore((state) => state.importTemplate);
  const campaignId = useEditorStore((state) => state.landing.campaignId);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const isLoading = status === 'loading';
  const hasCampaign = campaignId.trim() !== '';

  const handleImport = (templateId: string): void => {
    if (!hasCampaign) {
      return;
    }
    void importTemplate(templateId, campaignId);
  };

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Marketplace</h2>

      {isLoading && (
        <p role="status" className="text-xs text-slate-500">
          Cargando templates…
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <div>
        <label
          htmlFor="marketplace-category"
          className="mb-1 block text-xs font-medium text-slate-600"
        >
          Categoría
        </label>
        <select
          id="marketplace-category"
          value={activeCategory ?? ''}
          onChange={(event) => {
            void setCategory(event.target.value === '' ? null : event.target.value);
          }}
          className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="">Todas</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {!hasCampaign && (
        <p role="status" className="text-xs text-amber-600">
          Selecciona una campaña para poder importar templates.
        </p>
      )}

      {templates.length === 0 && !isLoading && status !== 'error' && (
        <p className="text-xs text-slate-500">No hay templates disponibles.</p>
      )}

      <ul className="space-y-3">
        {templates.map((template) => {
          const isImporting = importingId === template.id;
          const isImported = importedTemplateId === template.id;
          return (
            <li
              key={template.id}
              className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium text-slate-800">{template.name}</h3>
                  <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    {template.category}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatDownloads(template.downloads)} descargas
                </span>
              </div>
              {template.description !== null && (
                <p className="mt-2 text-xs text-slate-600">{template.description}</p>
              )}
              <button
                type="button"
                onClick={() => handleImport(template.id)}
                disabled={isImporting || !hasCampaign}
                className="mt-3 w-full rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isImporting ? 'Importando…' : 'Import from Marketplace'}
              </button>
              {isImported && lastImportedLandingId !== null && (
                <p role="status" className="mt-2 text-xs text-green-600">
                  Importado. Landing generada.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
