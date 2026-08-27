/**
 * Workflow de generador de cotizaciones.
 *
 * Contrato:
 * - Formulario controlado (cliente, correo, moneda, líneas de servicio con
 *   cantidades y precios, y tasa de impuesto) que envía la cotización vía
 *   `useWorkflowStore.submitQuote` (el servicio se inyecta por DI en el
 *   composition root).
 * - Las líneas se gestionan localmente como borradores; solo se envían las
 *   líneas válidas (nombre no vacío, cantidad >= 1 y precio > 0).
 * - Muestra el resumen del `IQuoteResponse` (subtotal, impuesto, total y PDF).
 * - El feedback se expone de forma accesible (`role="status"` / `role="alert"`).
 */
import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { IQuoteLineInput } from '@/services/workflowService';
import { useWorkflowStore } from '@/store/workflowStore';

/** Monedas ISO 4217 (minúsculas) soportadas por el generador. */
const CURRENCIES: readonly string[] = ['usd', 'eur', 'mxn', 'cop', 'brl'];

/** Borrador de una línea de cotización en edición. */
interface IQuoteLineDraft {
  /** Identificador estable de la línea (para React keys). */
  id: number;
  /** Nombre del servicio o producto. */
  name: string;
  /** Cantidad como texto editable. */
  quantity: string;
  /** Precio unitario como texto editable. */
  unitPrice: string;
}

/** Crea un borrador de línea vacío. */
function createEmptyLine(id: number): IQuoteLineDraft {
  return { id, name: '', quantity: '1', unitPrice: '' };
}

/** Formatea un monto en unidades mayores con la moneda indicada. */
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

/**
 * Formulario de generación de cotizaciones con líneas dinámicas.
 *
 * @example
 * ```tsx
 * <QuoteGeneratorWorkflow />
 * ```
 *
 * @returns El formulario de cotización y el resumen con enlace al PDF.
 */
export function QuoteGeneratorWorkflow(): ReactElement {
  const quote = useWorkflowStore((state) => state.quote);
  const submitQuote = useWorkflowStore((state) => state.submitQuote);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [taxRateBps, setTaxRateBps] = useState('1600');
  const [lines, setLines] = useState<IQuoteLineDraft[]>(() => [createEmptyLine(1)]);
  const nextLineId = useRef(2);

  const isSubmitting = quote.status === 'loading';
  const result = quote.result;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const services: IQuoteLineInput[] = lines
      .map((line) => ({
        name: line.name.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      }))
      .filter(
        (line) =>
          line.name !== '' &&
          Number.isFinite(line.quantity) &&
          line.quantity > 0 &&
          Number.isFinite(line.unitPrice) &&
          line.unitPrice > 0,
      );
    if (customerName.trim() === '' || services.length === 0) return;
    void submitQuote({
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim() || undefined,
      currency,
      services,
      taxRateBps: Number(taxRateBps),
    });
  };

  const updateLine = (id: number, patch: Partial<IQuoteLineDraft>): void => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: number): void => {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.id !== id),
    );
  };

  const addLine = (): void => {
    setLines((current) => [...current, createEmptyLine(nextLineId.current)]);
    nextLineId.current += 1;
  };

  return (
    <section aria-label="Generador de cotizaciones" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Generador de Cotizaciones</h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="quote-customer-name"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Nombre del cliente
          </label>
          <input
            id="quote-customer-name"
            type="text"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            disabled={isSubmitting}
            placeholder="Carlos López"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label
            htmlFor="quote-customer-email"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Correo del cliente (opcional)
          </label>
          <input
            id="quote-customer-email"
            type="email"
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            disabled={isSubmitting}
            placeholder="carlos@ejemplo.com"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="quote-currency" className="mb-1 block text-xs font-medium text-slate-600">
            Moneda
          </label>
          <select
            id="quote-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Líneas de servicio</p>
          {lines.map((line, index) => (
            <div
              key={line.id}
              className="space-y-2 rounded-md border border-slate-200 p-2"
              aria-label={`Línea ${index + 1}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={line.name}
                  onChange={(event) => updateLine(line.id, { name: event.target.value })}
                  disabled={isSubmitting}
                  placeholder="Nombre del servicio"
                  aria-label={`Nombre de la línea ${index + 1}`}
                  className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  disabled={isSubmitting || lines.length === 1}
                  aria-label={`Quitar línea ${index + 1}`}
                  className="shrink-0 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                >
                  Quitar
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                  disabled={isSubmitting}
                  placeholder="Cantidad"
                  aria-label={`Cantidad de la línea ${index + 1}`}
                  className="w-24 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                  disabled={isSubmitting}
                  placeholder="Precio unitario"
                  aria-label={`Precio unitario de la línea ${index + 1}`}
                  className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addLine}
            disabled={isSubmitting}
            className="w-full rounded-md border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
          >
            Agregar línea
          </button>
        </div>

        <div>
          <label htmlFor="quote-tax" className="mb-1 block text-xs font-medium text-slate-600">
            Tasa de impuesto (puntos base, 0–10000)
          </label>
          <input
            id="quote-tax"
            type="number"
            min="0"
            max="10000"
            step="100"
            value={taxRateBps}
            onChange={(event) => setTaxRateBps(event.target.value)}
            disabled={isSubmitting}
            placeholder="1600 = 16 %"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || customerName.trim() === ''}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? 'Generando cotización…' : 'Generar cotización'}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {isSubmitting && (
          <p className="text-sm text-slate-500">Generando la cotización y su PDF…</p>
        )}
        {quote.status === 'error' && quote.error !== null && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {quote.error}
          </p>
        )}
      </div>

      {result !== null && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-slate-800">
            Cotización {result.status} · {result.currency.toUpperCase()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Subtotal {formatCurrency(result.subtotal, result.currency)} · Impuesto{' '}
            {formatCurrency(result.tax, result.currency)} · Total{' '}
            {formatCurrency(result.total, result.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">ID: {result.quote_id}</p>
          {result.pdf_url !== null && (
            <a
              href={result.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block w-full rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Abrir PDF de la cotización
            </a>
          )}
        </div>
      )}
    </section>
  );
}
