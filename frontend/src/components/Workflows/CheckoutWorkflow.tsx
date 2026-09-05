/**
 * Workflow de checkout directo con integración de pasarela de pago.
 *
 * Contrato:
 * - Formulario controlado (monto, moneda, correo y nombre del cliente) que
 *   envía el checkout vía `useWorkflowStore.submitCheckout` (el servicio se
 *   inyecta por DI en el composition root).
 * - Muestra el resumen del `ICheckoutResponse` (id, estado, proveedor y URL de
 *   pago) y permite confirmar el pago sandbox con
 *   `useWorkflowStore.confirmCheckout` (idempotente).
 * - El estado de confirmación (`IPaymentRead`) es local porque el store
 *   conserva el `ICheckoutResponse` original, no el pago confirmado.
 * - El feedback se expone de forma accesible (`role="status"` / `role="alert"`).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { IPaymentRead } from '@/api/types';
import { useWorkflowStore } from '@/store/workflowStore';
import { resolveLandingContext, useCurrentLanding } from './landingContext';

/** Monedas ISO 4217 (minúsculas) soportadas por la pasarela. */
const CURRENCIES: readonly string[] = ['usd', 'eur', 'mxn', 'cop', 'brl'];

/** Formatea un monto en unidades mayores con la moneda indicada. */
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

/**
 * Formulario de checkout directo con confirmación de pago sandbox.
 *
 * @example
 * ```tsx
 * <CheckoutWorkflow />
 * ```
 *
 * @returns El formulario de pago y el resumen del checkout generado.
 */
export function CheckoutWorkflow(): ReactElement {
  const checkout = useWorkflowStore((state) => state.checkout);
  const submitCheckout = useWorkflowStore((state) => state.submitCheckout);
  const confirmCheckout = useWorkflowStore((state) => state.confirmCheckout);
  const landing = useCurrentLanding();

  const [amount, setAmount] = useState('100');
  const [currency, setCurrency] = useState('usd');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [payment, setPayment] = useState<IPaymentRead | null>(null);

  const isSubmitting = checkout.status === 'loading';
  const amountNumber = Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const result = checkout.result;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!amountValid) return;
    const landingContext = resolveLandingContext(landing);
    void submitCheckout({
      amount: amountNumber,
      currency,
      customerEmail: customerEmail.trim() || undefined,
      customerName: customerName.trim() || undefined,
      metadata: landingContext ?? undefined,
    });
  };

  const handleConfirm = (paymentId: string): void => {
    setIsConfirming(true);
    void confirmCheckout(paymentId).then((confirmed) => {
      setIsConfirming(false);
      if (confirmed !== null) setPayment(confirmed);
    });
  };

  return (
    <section aria-label="Checkout directo" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Checkout Directo</h3>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="checkout-amount"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Monto
          </label>
          <input
            id="checkout-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={isSubmitting}
            placeholder="99.50"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label
            htmlFor="checkout-currency"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Moneda
          </label>
          <select
            id="checkout-currency"
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

        <div>
          <label htmlFor="checkout-email" className="mb-1 block text-xs font-medium text-slate-600">
            Correo del cliente (opcional)
          </label>
          <input
            id="checkout-email"
            type="email"
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            disabled={isSubmitting}
            placeholder="cliente@ejemplo.com"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <div>
          <label htmlFor="checkout-name" className="mb-1 block text-xs font-medium text-slate-600">
            Nombre del cliente (opcional)
          </label>
          <input
            id="checkout-name"
            type="text"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            disabled={isSubmitting}
            placeholder="Juan Pérez"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !amountValid}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? 'Creando checkout…' : 'Crear checkout'}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {isSubmitting && (
          <p className="text-sm text-slate-500">Creando el checkout en la pasarela…</p>
        )}
        {checkout.status === 'error' && checkout.error !== null && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {checkout.error}
          </p>
        )}
      </div>

      {result !== null && (
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-slate-800">
            Checkout {result.status} · {result.provider}
          </p>
          <p className="mt-1 text-xs text-slate-500">ID: {result.payment_id}</p>
          <a
            href={result.checkout_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block w-full rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-brand-700"
          >
            Abrir página de pago
          </a>
          <button
            type="button"
            onClick={() => handleConfirm(result.payment_id)}
            disabled={isConfirming}
            className="mt-2 w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isConfirming ? 'Confirmando…' : 'Confirmar pago (sandbox)'}
          </button>
        </div>
      )}

      {payment !== null && (
        <div role="status" className="mt-3 rounded-md border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-800">Pago confirmado: {payment.status}</p>
          <p className="mt-1 text-xs text-slate-500">
            {payment.id} · {formatCurrency(payment.amount_minor / 100, payment.currency)}
          </p>
        </div>
      )}
    </section>
  );
}
