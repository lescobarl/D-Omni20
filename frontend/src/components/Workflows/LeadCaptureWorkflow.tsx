/**
 * Workflow de captura de leads.
 *
 * Contrato:
 * - Formulario controlado (nombre, correo, teléfono y origen) que envía la
 *   captura vía `useWorkflowStore.submitLead` (el servicio se inyecta por DI
 *   en el composition root).
 * - Muestra el resumen del `ILeadRead` (id, estado y origen) en una tarjeta.
 * - Embebe el reporte de atribución por campaña (`LeadAttributionView`), que
 *   carga `GET /api/v1/workflows/leads/attribution` al montarse vía store.
 * - El feedback se expone de forma accesible (`role="status"` / `role="alert"`).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { deriveSourceFromUtm, extractUtmParams } from '@/core/utm';
import { LeadAttributionView } from './LeadAttributionView';
import { resolveLandingContext, useCurrentLanding } from './landingContext';

/** Orígenes de captura soportados por el formulario. */
const LEAD_SOURCES: readonly string[] = ['landing', 'facebook', 'google', 'referral', 'other'];

/**
 * Formulario de captura de prospectos.
 *
 * @example
 * ```tsx
 * <LeadCaptureWorkflow />
 * ```
 *
 * @returns El formulario de captura y el resumen del lead registrado.
 */
export function LeadCaptureWorkflow(): ReactElement {
  const lead = useWorkflowStore((state) => state.lead);
  const submitLead = useWorkflowStore((state) => state.submitLead);
  const landing = useCurrentLanding();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<string>(() => {
    const utm = extractUtmParams(window.location.search);
    return deriveSourceFromUtm(utm['utm_source']) ?? 'landing';
  });

  const isSubmitting = lead.status === 'loading';
  const canSubmit = name.trim() !== '' && email.trim() !== '';
  const result = lead.result;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    const utm = extractUtmParams(window.location.search);
    const landingContext = resolveLandingContext(landing);
    const metadata: Record<string, unknown> = { ...utm };
    if (landingContext) Object.assign(metadata, landingContext);
    void submitLead({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      source,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  };

  return (
    <section aria-label="Captura de leads" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Captura de Leads</h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="lead-name" className="mb-1 block text-xs font-medium text-slate-600">
            Nombre
          </label>
          <input
            id="lead-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isSubmitting}
            placeholder="María García"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="lead-email" className="mb-1 block text-xs font-medium text-slate-600">
            Correo
          </label>
          <input
            id="lead-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            placeholder="maria@ejemplo.com"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="lead-phone" className="mb-1 block text-xs font-medium text-slate-600">
            Teléfono (opcional)
          </label>
          <input
            id="lead-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={isSubmitting}
            placeholder="+52 55 1234 5678"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="lead-source" className="mb-1 block text-xs font-medium text-slate-600">
            Origen
          </label>
          <select
            id="lead-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          >
            {LEAD_SOURCES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !canSubmit}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? 'Capturando…' : 'Capturar lead'}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {isSubmitting && <p className="text-sm text-slate-500">Registrando el lead…</p>}
        {lead.status === 'error' && lead.error !== null && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {lead.error}
          </p>
        )}
      </div>

      {result !== null && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-slate-800">
            Lead {result.status} · origen {result.source}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {result.name} · {result.email}
            {result.phone !== null && result.phone !== '' ? ` · ${result.phone}` : ''}
          </p>
          <p className="mt-1 text-xs text-slate-500">ID: {result.id}</p>
        </div>
      )}

      <LeadAttributionView />
    </section>
  );
}
