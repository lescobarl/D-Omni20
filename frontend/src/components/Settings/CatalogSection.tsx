/**
 * Sección "Catálogo" del configurador del tenant.
 *
 * Contrato:
 * - CRUD de `catalog_items` del tenant (SKU, nombre, descripción, precio, moneda y
 *   disponibilidad) con versionado gestionado por el backend.
 * - Sección autocontenida: carga el catálogo al montar y reutiliza un único
 *   formulario para crear y editar ítems (modo edición).
 * - El precio se valida localmente (número finito ≥ 0) antes de enviar.
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { ICatalogItemRead } from '@/api/types';
import type { ICatalogItemInput } from '@/services/tenantConfigService';
import { useTenantConfigStore } from '@/store/tenantConfigStore';

/** Estado del formulario del catálogo (el precio se edita como texto). */
interface ICatalogFormState {
  /** Código SKU único del ítem. */
  sku: string;
  /** Nombre del producto o servicio. */
  name: string;
  /** Descripción opcional del ítem. */
  description: string;
  /** Precio en formato de texto editable (se valida al guardar). */
  price: string;
  /** Código de moneda ISO 4217 (p. ej. MXN, USD). */
  currency: string;
  /** Indica si el ítem está disponible para el bot. */
  available: boolean;
}

const EMPTY_FORM: ICatalogFormState = {
  sku: '',
  name: '',
  description: '',
  price: '',
  currency: 'MXN',
  available: true,
};

/** Formatea el precio con su moneda sin depender de `Intl` (códigos custom seguros). */
function formatPrice(price: number, currency: string): string {
  const symbol = currency.trim().toUpperCase();
  return `${symbol === '' ? 'MXN' : symbol} ${price.toFixed(2)}`;
}

/**
 * Sección de catálogo de productos/servicios del tenant con CRUD completo.
 *
 * @example
 * ```tsx
 * <CatalogSection />
 * ```
 *
 * @returns El formulario del catálogo y la lista de ítems con precio y disponibilidad.
 */
export function CatalogSection(): ReactElement {
  const catalogItems = useTenantConfigStore((state) => state.catalogItems);
  const catalogStatus = useTenantConfigStore((state) => state.catalogStatus);
  const catalogError = useTenantConfigStore((state) => state.catalogError);
  const listCatalogItems = useTenantConfigStore((state) => state.listCatalogItems);
  const createCatalogItem = useTenantConfigStore((state) => state.createCatalogItem);
  const updateCatalogItem = useTenantConfigStore((state) => state.updateCatalogItem);
  const deleteCatalogItem = useTenantConfigStore((state) => state.deleteCatalogItem);

  const [form, setForm] = useState<ICatalogFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Sección autocontenida: carga el catálogo al montar.
  useEffect(() => {
    void listCatalogItems();
  }, [listCatalogItems]);

  const setField = <K extends keyof ICatalogFormState>(
    key: K,
    value: ICatalogFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (item: ICatalogItemRead): void => {
    setForm({
      sku: item.sku,
      name: item.name,
      description: item.description ?? '',
      price: String(item.price),
      currency: item.currency,
      available: item.available,
    });
    setEditingId(item.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const sku = form.sku.trim();
    const name = form.name.trim();
    const price = Number.parseFloat(form.price);
    if (sku === '' || name === '') {
      setFormError('El SKU y el nombre son obligatorios.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Ingresa un precio válido mayor o igual a cero.');
      return;
    }
    const input: ICatalogItemInput = {
      sku,
      name,
      description: form.description.trim() === '' ? undefined : form.description,
      price,
      currency: form.currency.trim() === '' ? undefined : form.currency,
      available: form.available,
    };
    if (editingId !== null) {
      await updateCatalogItem(editingId, input);
    } else {
      await createCatalogItem(input);
    }
    resetForm();
  };

  const handleDelete = async (item: ICatalogItemRead): Promise<void> => {
    await deleteCatalogItem(item.id);
  };

  const isLoading = catalogStatus === 'loading' && catalogItems.length === 0;

  return (
    <section aria-labelledby="catalog-heading">
      <h2 id="catalog-heading" className="text-lg font-semibold text-slate-900">
        Catálogo
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Administra los productos y servicios que el bot puede ofrecer, con precio, moneda y
        disponibilidad. Los cambios quedan versionados automáticamente.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando catálogo…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar ítem del catálogo' : 'Crear ítem del catálogo'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar ítem' : 'Nuevo ítem'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="catalog-sku" className="block text-sm text-slate-600">
                    SKU
                  </label>
                  <input
                    id="catalog-sku"
                    type="text"
                    value={form.sku}
                    onChange={(event) => setField('sku', event.target.value)}
                    placeholder="PROD-001"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="catalog-name" className="block text-sm text-slate-600">
                    Nombre
                  </label>
                  <input
                    id="catalog-name"
                    type="text"
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Consulta médica general"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="catalog-description" className="block text-sm text-slate-600">
                    Descripción
                  </label>
                  <textarea
                    id="catalog-description"
                    rows={3}
                    value={form.description}
                    onChange={(event) => setField('description', event.target.value)}
                    placeholder="Descripción breve del producto o servicio…"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="catalog-price" className="block text-sm text-slate-600">
                      Precio
                    </label>
                    <input
                      id="catalog-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(event) => setField('price', event.target.value)}
                      placeholder="0.00"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="catalog-currency" className="block text-sm text-slate-600">
                      Moneda
                    </label>
                    <input
                      id="catalog-currency"
                      type="text"
                      maxLength={3}
                      value={form.currency}
                      onChange={(event) => setField('currency', event.target.value.toUpperCase())}
                      placeholder="MXN"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="catalog-available"
                    type="checkbox"
                    checked={form.available}
                    onChange={(event) => setField('available', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <label htmlFor="catalog-available" className="text-sm text-slate-600">
                    Disponible para la venta
                  </label>
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={catalogStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId !== null ? 'Guardar cambios' : 'Crear ítem'}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cancelar edición
                </button>
              )}
              <span role="status" aria-live="polite" className="text-sm">
                {formError !== null && <span className="text-red-600">{formError}</span>}
              </span>
            </div>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Ítems del catálogo</p>
            {catalogItems.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay ítems en el catálogo.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {catalogItems.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                            {item.sku}
                          </span>
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.available
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {item.available ? 'Disponible' : 'Agotado'}
                          </span>
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {item.name}
                        </h3>
                        {item.description !== null && item.description !== '' && (
                          <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                            {item.description}
                          </p>
                        )}
                        <p className="mt-1 text-sm font-medium text-brand-700">
                          {formatPrice(item.price, item.currency)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {catalogError !== null && <span className="text-red-600">{catalogError}</span>}
      </span>
    </section>
  );
}
