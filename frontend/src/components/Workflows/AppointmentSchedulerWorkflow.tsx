/**
 * Workflow de agendador de citas.
 *
 * Contrato:
 * - Formulario controlado (servicio, fecha/hora, duración, zona horaria y
 *   datos del cliente) que agenda la cita vía
 *   `useWorkflowStore.submitAppointment` (el servicio se inyecta por DI en el
 *   composition root).
 * - Convierte el valor `datetime-local` (hora local del navegador) a ISO 8601
 *   UTC antes de enviarlo.
 * - Muestra el resumen del `IAppointmentResponse` (inicio, fin, zona y ICS).
 * - El feedback se expone de forma accesible (`role="status"` / `role="alert"`).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { resolveLandingContext, useCurrentLanding } from './landingContext';

/** Duraciones soportadas (minutos) para la cita. */
const DURATIONS: readonly number[] = [15, 30, 60, 90, 120];

/** Zonas horarias IANA soportadas por el agendador. */
const TIMEZONES: readonly string[] = [
  'UTC',
  'America/Mexico_City',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/Madrid',
];

/**
 * Formulario de agendamiento de citas.
 *
 * @example
 * ```tsx
 * <AppointmentSchedulerWorkflow />
 * ```
 *
 * @returns El formulario de reserva y el resumen de la cita generada.
 */
export function AppointmentSchedulerWorkflow(): ReactElement {
  const appointment = useWorkflowStore((state) => state.appointment);
  const submitAppointment = useWorkflowStore((state) => state.submitAppointment);
  const landing = useCurrentLanding();

  const [service, setService] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [timezone, setTimezone] = useState('America/Mexico_City');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const isSubmitting = appointment.status === 'loading';
  const canSubmit = service.trim() !== '' && startsAt !== '' && customerName.trim() !== '';
  const result = appointment.result;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    const landingContext = resolveLandingContext(landing);
    void submitAppointment({
      service: service.trim(),
      startsAt: new Date(startsAt).toISOString(),
      durationMinutes: Number(durationMinutes),
      timezone,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      landingId: landingContext?.landing_id,
      campaignId: landingContext?.campaign_id,
    });
  };

  return (
    <section aria-label="Agendador de citas" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Agendador de Citas</h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="appointment-service"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Servicio
          </label>
          <input
            id="appointment-service"
            type="text"
            value={service}
            onChange={(event) => setService(event.target.value)}
            disabled={isSubmitting}
            placeholder="Consulta inicial"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label
            htmlFor="appointment-starts-at"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Fecha y hora
          </label>
          <input
            id="appointment-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label
            htmlFor="appointment-duration"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Duración
          </label>
          <select
            id="appointment-duration"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          >
            {DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="appointment-timezone"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Zona horaria
          </label>
          <select
            id="appointment-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="appointment-name"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Nombre del cliente
          </label>
          <input
            id="appointment-name"
            type="text"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            disabled={isSubmitting}
            placeholder="Ana Torres"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label
            htmlFor="appointment-email"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Correo del cliente (opcional)
          </label>
          <input
            id="appointment-email"
            type="email"
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            disabled={isSubmitting}
            placeholder="ana@ejemplo.com"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label
            htmlFor="appointment-phone"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Teléfono (opcional)
          </label>
          <input
            id="appointment-phone"
            type="tel"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            disabled={isSubmitting}
            placeholder="+52 55 9876 5432"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !canSubmit}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? 'Agendando…' : 'Agendar cita'}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {isSubmitting && <p className="text-sm text-slate-500">Registrando la cita…</p>}
        {appointment.status === 'error' && appointment.error !== null && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {appointment.error}
          </p>
        )}
      </div>

      {result !== null && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-slate-800">
            Cita {result.status} · {result.timezone}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {new Date(result.starts_at).toLocaleString('es-MX')} →{' '}
            {new Date(result.ends_at).toLocaleString('es-MX')}
          </p>
          <p className="mt-1 text-xs text-slate-500">ID: {result.appointment_id}</p>
          {result.ics_url !== null && (
            <a
              href={result.ics_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block w-full rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Descargar invitación (.ics)
            </a>
          )}
        </div>
      )}
    </section>
  );
}
