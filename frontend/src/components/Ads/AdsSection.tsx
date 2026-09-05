/**
 * Sección de captación publicitaria (C-1 — eslabón ① del ciclo comercial).
 *
 * Gestiona las campañas publicitarias del tenant con atribución UTM: las
 * lista, crea, edita y elimina consumiendo el store `useAdsStore`, que a su
 * vez depende del servicio `IAdsService` inyectado desde la raíz de
 * composición cuando la feature flag `ads` está habilitada.
 *
 * - Validación local del campo obligatorio (nombre de campaña).
 * - Formulario único para crear y editar (modo edición vía `editingId`).
 * - Errores accesibles con `aria-live` y estados de carga con `role="status"`.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IAdCampaignRead, ILandingRead } from '@/api/types';
import type { IAdCampaignInput } from '@/services/adsService';
import { useAdsStore } from '@/store/adsStore';
import { getLandingService } from '@/store/editorStore';

interface IAdCampaignFormState {
  /** Nombre de la campaña (obligatorio). */
  name: string;
  /** Estado de la campaña. */
  status: string;
  /** Indica si la campaña está habilitada. */
  enabled: boolean;
  /** Parámetro UTM `utm_source`. */
  utmSource: string;
  /** Parámetro UTM `utm_medium`. */
  utmMedium: string;
  /** Parámetro UTM `utm_campaign`. */
  utmCampaign: string;
  /** Parámetro UTM `utm_content`. */
  utmContent: string;
  /** Parámetro UTM `utm_term`. */
  utmTerm: string;
  /** Landing de destino (opcional). */
  landingId: string;
  /** Presupuesto en unidades menores. */
  budgetMinor: string;
  /** Fecha de inicio (ISO 8601, opcional). */
  startAt: string;
  /** Fecha de fin (ISO 8601, opcional). */
  endAt: string;
  /** Notas internas (opcional). */
  notes: string;
}

const EMPTY_FORM: IAdCampaignFormState = {
  name: '',
  status: 'active',
  enabled: true,
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
  landingId: '',
  budgetMinor: '',
  startAt: '',
  endAt: '',
  notes: '',
};

/**
 * Sección de campañas publicitarias del tenant con atribución UTM.
 *
 * Lista, crea, edita y elimina campañas consumiendo el store `useAdsStore`
 * (servicio `IAdsService` inyectado cuando la feature flag `ads` está activa).
 */
export function AdsSection(): ReactElement {
  const adCampaigns = useAdsStore((state) => state.adCampaigns);
  const adCampaignsStatus = useAdsStore((state) => state.adCampaignsStatus);
  const adCampaignsError = useAdsStore((state) => state.adCampaignsError);
  const listAdCampaigns = useAdsStore((state) => state.listAdCampaigns);
  const createAdCampaign = useAdsStore((state) => state.createAdCampaign);
  const updateAdCampaign = useAdsStore((state) => state.updateAdCampaign);
  const deleteAdCampaign = useAdsStore((state) => state.deleteAdCampaign);

  const [form, setForm] = useState<IAdCampaignFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [landings, setLandings] = useState<ILandingRead[]>([]);

  useEffect(() => {
    void listAdCampaigns();
  }, [listAdCampaigns]);

  useEffect(() => {
    const service = getLandingService();
    if (service === null) {
      return;
    }
    let cancelled = false;
    void service
      .list()
      .then((page) => {
        if (!cancelled) {
          setLandings(page.items);
        }
      })
      .catch(() => {
        // Si el listado de landings falla, el selector queda vacío sin romper la UI.
        if (!cancelled) {
          setLandings([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = <K extends keyof IAdCampaignFormState>(
    key: K,
    value: IAdCampaignFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (adCampaign: IAdCampaignRead): void => {
    setForm({
      name: adCampaign.name,
      status: adCampaign.status,
      enabled: adCampaign.enabled,
      utmSource: adCampaign.utm_source ?? '',
      utmMedium: adCampaign.utm_medium ?? '',
      utmCampaign: adCampaign.utm_campaign ?? '',
      utmContent: adCampaign.utm_content ?? '',
      utmTerm: adCampaign.utm_term ?? '',
      landingId: adCampaign.landing_id ?? '',
      budgetMinor: adCampaign.budget_minor === null ? '' : String(adCampaign.budget_minor),
      startAt: adCampaign.start_at ?? '',
      endAt: adCampaign.end_at ?? '',
      notes: adCampaign.notes ?? '',
    });
    setEditingId(adCampaign.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (form.name === '') {
      setFormError('El nombre de la campaña es obligatorio.');
      return;
    }
    const input: IAdCampaignInput = {
      name: form.name,
      status: form.status.trim() === '' ? undefined : form.status,
      enabled: form.enabled,
      utmSource: form.utmSource.trim() === '' ? undefined : form.utmSource,
      utmMedium: form.utmMedium.trim() === '' ? undefined : form.utmMedium,
      utmCampaign: form.utmCampaign.trim() === '' ? undefined : form.utmCampaign,
      utmContent: form.utmContent.trim() === '' ? undefined : form.utmContent,
      utmTerm: form.utmTerm.trim() === '' ? undefined : form.utmTerm,
      landingId: form.landingId.trim() === '' ? undefined : form.landingId,
      budgetMinor: form.budgetMinor.trim() === '' ? undefined : Number(form.budgetMinor),
      startAt: form.startAt.trim() === '' ? undefined : form.startAt,
      endAt: form.endAt.trim() === '' ? undefined : form.endAt,
      notes: form.notes.trim() === '' ? undefined : form.notes,
    };
    if (editingId !== null) {
      await updateAdCampaign(editingId, input);
    } else {
      await createAdCampaign(input);
    }
    resetForm();
  };

  const handleDelete = (adCampaign: IAdCampaignRead): void => {
    void deleteAdCampaign(adCampaign.id);
  };

  const isLoading = adCampaignsStatus === 'loading' && adCampaigns.length === 0;

  return (
    <section aria-labelledby="ads-heading">
      <h2 id="ads-heading" className="text-lg font-semibold text-slate-900">
        Captación publicitaria
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Campañas publicitarias con atribución UTM del ciclo comercial.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Captación ①
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando campañas publicitarias…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar campaña' : 'Crear campaña'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar campaña' : 'Nueva campaña'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="adcampaign-name" className="block text-sm text-slate-600">
                    Nombre
                  </label>
                  <input
                    id="adcampaign-name"
                    type="text"
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Casa vista al lago Tequesquitengo"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adcampaign-status" className="block text-sm text-slate-600">
                      Estado
                    </label>
                    <input
                      id="adcampaign-status"
                      type="text"
                      value={form.status}
                      onChange={(event) => setField('status', event.target.value)}
                      placeholder="active"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-end gap-2 pb-2">
                    <input
                      id="adcampaign-enabled"
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => setField('enabled', event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <label htmlFor="adcampaign-enabled" className="text-sm text-slate-600">
                      Habilitada
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adcampaign-utm-source" className="block text-sm text-slate-600">
                      UTM Fuente
                    </label>
                    <input
                      id="adcampaign-utm-source"
                      type="text"
                      value={form.utmSource}
                      onChange={(event) => setField('utmSource', event.target.value)}
                      placeholder="meta"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="adcampaign-utm-medium" className="block text-sm text-slate-600">
                      UTM Medio
                    </label>
                    <input
                      id="adcampaign-utm-medium"
                      type="text"
                      value={form.utmMedium}
                      onChange={(event) => setField('utmMedium', event.target.value)}
                      placeholder="cpc"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="adcampaign-utm-campaign" className="block text-sm text-slate-600">
                    UTM Campaña
                  </label>
                  <input
                    id="adcampaign-utm-campaign"
                    type="text"
                    value={form.utmCampaign}
                    onChange={(event) => setField('utmCampaign', event.target.value)}
                    placeholder="tequesquitengo-lago"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="adcampaign-utm-content"
                      className="block text-sm text-slate-600"
                    >
                      UTM Contenido
                    </label>
                    <input
                      id="adcampaign-utm-content"
                      type="text"
                      value={form.utmContent}
                      onChange={(event) => setField('utmContent', event.target.value)}
                      placeholder="banner"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="adcampaign-utm-term" className="block text-sm text-slate-600">
                      UTM Término
                    </label>
                    <input
                      id="adcampaign-utm-term"
                      type="text"
                      value={form.utmTerm}
                      onChange={(event) => setField('utmTerm', event.target.value)}
                      placeholder="lago"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adcampaign-landing-id" className="block text-sm text-slate-600">
                      Landing de destino
                    </label>
                    <select
                      id="adcampaign-landing-id"
                      value={form.landingId}
                      onChange={(event) => setField('landingId', event.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Sin landing</option>
                      {landings.map((landing) => (
                        <option key={landing.id} value={landing.id}>
                          {landing.name.trim() === '' ? landing.id : landing.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="adcampaign-budget" className="block text-sm text-slate-600">
                      Presupuesto (centavos)
                    </label>
                    <input
                      id="adcampaign-budget"
                      type="text"
                      inputMode="numeric"
                      value={form.budgetMinor}
                      onChange={(event) => setField('budgetMinor', event.target.value)}
                      placeholder="150000"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adcampaign-start-at" className="block text-sm text-slate-600">
                      Inicio
                    </label>
                    <input
                      id="adcampaign-start-at"
                      type="text"
                      value={form.startAt}
                      onChange={(event) => setField('startAt', event.target.value)}
                      placeholder="2026-08-18T00:00:00Z"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="adcampaign-end-at" className="block text-sm text-slate-600">
                      Fin
                    </label>
                    <input
                      id="adcampaign-end-at"
                      type="text"
                      value={form.endAt}
                      onChange={(event) => setField('endAt', event.target.value)}
                      placeholder="2026-09-30T23:59:59Z"
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="adcampaign-notes" className="block text-sm text-slate-600">
                    Notas
                  </label>
                  <textarea
                    id="adcampaign-notes"
                    rows={3}
                    value={form.notes}
                    onChange={(event) => setField('notes', event.target.value)}
                    placeholder="Detalles de la campaña"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={adCampaignsStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId !== null ? 'Guardar cambios' : 'Crear campaña'}
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
            </div>
            <span role="status" aria-live="polite" className="text-sm">
              {formError !== null && <span className="text-red-600">{formError}</span>}
            </span>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Campañas publicitarias</p>
            {adCampaigns.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay campañas publicitarias.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {adCampaigns.map((adCampaign) => (
                  <li key={adCampaign.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-slate-900">{adCampaign.name}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                            {adCampaign.status}
                          </span>
                          {adCampaign.enabled ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Habilitada
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              Deshabilitada
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {adCampaign.utm_campaign ?? adCampaign.utm_source ?? 'Sin UTM'}
                        </p>
                        {adCampaign.budget_minor !== null && (
                          <p className="mt-1 text-sm text-slate-600">
                            Presupuesto: ${(adCampaign.budget_minor / 100).toFixed(2)}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(adCampaign)}
                          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(adCampaign)}
                          className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
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
        {adCampaignsError !== null && <span className="text-red-600">{adCampaignsError}</span>}
      </span>
    </section>
  );
}
