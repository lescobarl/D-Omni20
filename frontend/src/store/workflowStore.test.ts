/**
 * Pruebas del store de workflows: inmutabilidad y flujos de envío con DI.
 *
 * Contrato:
 * - `setWorkflowType` actualiza el valor sin mutar el estado previo.
 * - `reset` restaura el workflow por defecto y limpia las colas.
 * - Con un servicio inyectado (`setWorkflowService`), los submit delegan en él,
 *   actualizan su cola (`loading` → `success`/`error`) y devuelven el resultado.
 * - Sin servicio registrado, los submit pasan a estado de error controlado.
 * - `confirmCheckout` conserva el `CheckoutResponse` original en la cola.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IAppointmentResponse,
  ICheckoutResponse,
  ILeadAttributionRead,
  IPaymentRead,
} from '@/api/types';
import type { IWorkflowService } from '@/services/workflowService';
import { setWorkflowService, useWorkflowStore } from '@/store/workflowStore';

/** Construye un doble del puerto `IWorkflowService` con los 5 métodos. */
function makeWorkflowServiceMock(): IWorkflowService {
  return {
    createCheckout: vi.fn(),
    confirmCheckout: vi.fn(),
    captureLead: vi.fn(),
    getLeadAttribution: vi.fn(),
    generateQuote: vi.fn(),
    scheduleAppointment: vi.fn(),
  };
}

/** Fábrica de `ICheckoutResponse` para los flujos de pago. */
function makeCheckoutResponse(overrides: Partial<ICheckoutResponse> = {}): ICheckoutResponse {
  return {
    payment_id: 'pay-1',
    status: 'pending',
    checkout_url: 'https://checkout.sandbox.local/pay-1',
    provider: 'sandbox',
    ...overrides,
  };
}

/** Fábrica de `IPaymentRead` para la confirmación manual. */
function makePaymentRead(overrides: Partial<IPaymentRead> = {}): IPaymentRead {
  return {
    id: 'pay-1',
    tenant_id: 'tenant-1',
    amount_minor: 10000,
    currency: 'usd',
    status: 'paid',
    provider: 'sandbox',
    provider_session_id: null,
    customer_email: null,
    customer_name: null,
    metadata: {},
    failure_reason: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IAppointmentResponse` para el agendamiento. */
function makeAppointmentResponse(
  overrides: Partial<IAppointmentResponse> = {},
): IAppointmentResponse {
  return {
    appointment_id: 'appt-1',
    status: 'scheduled',
    starts_at: '2026-08-20T15:00:00Z',
    ends_at: '2026-08-20T15:30:00Z',
    timezone: 'America/Mexico_City',
    ics_url: null,
    ...overrides,
  };
}

/** Fábrica de `ILeadAttributionRead` (DTO exacto del backend). */
function makeLeadAttributionRead(
  overrides: Partial<ILeadAttributionRead> = {},
): ILeadAttributionRead {
  return {
    rows: [
      { campaign: 'c1', source: 'google', total: 1, new: 1, contacted: 0, converted: 0, lost: 0 },
      { campaign: 'c1', source: 'facebook', total: 1, new: 0, contacted: 1, converted: 0, lost: 0 },
    ],
    total_leads: 2,
    generated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    setWorkflowService(null);
  });

  it('inicia con el workflow por defecto direct_checkout', () => {
    expect(useWorkflowStore.getState().workflowType).toBe('direct_checkout');
  });

  it('actualiza el workflow sin mutar el estado previo (inmutabilidad)', () => {
    const previous = useWorkflowStore.getState();
    useWorkflowStore.getState().setWorkflowType('quote_generator');

    const current = useWorkflowStore.getState();
    expect(current.workflowType).toBe('quote_generator');
    expect(previous.workflowType).toBe('direct_checkout');
    expect(previous).not.toBe(current);
  });

  it('reinicia al workflow por defecto y limpia las colas', () => {
    useWorkflowStore.getState().setWorkflowType('appointment_scheduler');
    useWorkflowStore.setState({ checkout: { status: 'error', result: null, error: 'boom' } });
    useWorkflowStore.setState({
      attribution: makeLeadAttributionRead(),
      attributionStatus: 'success',
    });
    useWorkflowStore.getState().reset();

    expect(useWorkflowStore.getState().workflowType).toBe('direct_checkout');
    expect(useWorkflowStore.getState().checkout).toEqual({
      status: 'idle',
      result: null,
      error: null,
    });
    expect(useWorkflowStore.getState().attribution).toBeNull();
    expect(useWorkflowStore.getState().attributionStatus).toBe('idle');
    expect(useWorkflowStore.getState().attributionError).toBeNull();
  });

  it('submitCheckout con servicio inyectado pasa a success y devuelve el resultado', async () => {
    const service = makeWorkflowServiceMock();
    (service.createCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(makeCheckoutResponse());
    setWorkflowService(service);

    const result = await useWorkflowStore
      .getState()
      .submitCheckout({ amount: 99.5, currency: 'usd' });

    expect(service.createCheckout).toHaveBeenCalledWith({ amount: 99.5, currency: 'usd' });
    expect(result).toEqual(makeCheckoutResponse());
    expect(useWorkflowStore.getState().checkout).toEqual({
      status: 'success',
      result: makeCheckoutResponse(),
      error: null,
    });
  });

  it('submitCheckout con error del servicio pasa a error con el mensaje', async () => {
    const service = makeWorkflowServiceMock();
    (service.createCheckout as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('pasarela caída'),
    );
    setWorkflowService(service);

    const result = await useWorkflowStore.getState().submitCheckout({ amount: 10 });

    expect(result).toBeNull();
    expect(useWorkflowStore.getState().checkout).toEqual({
      status: 'error',
      result: null,
      error: 'pasarela caída',
    });
  });

  it('submitCheckout sin servicio registrado pasa a error controlado', async () => {
    const result = await useWorkflowStore.getState().submitCheckout({ amount: 10 });

    expect(result).toBeNull();
    expect(useWorkflowStore.getState().checkout).toEqual({
      status: 'error',
      result: null,
      error: 'El módulo de workflows no está disponible.',
    });
  });

  it('confirmCheckout delega en el servicio y conserva el CheckoutResponse original', async () => {
    const service = makeWorkflowServiceMock();
    (service.createCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(makeCheckoutResponse());
    (service.confirmCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(makePaymentRead());
    setWorkflowService(service);

    await useWorkflowStore.getState().submitCheckout({ amount: 100 });
    const payment = await useWorkflowStore.getState().confirmCheckout('pay-1');

    expect(service.confirmCheckout).toHaveBeenCalledWith('pay-1');
    expect(payment?.status).toBe('paid');
    expect(useWorkflowStore.getState().checkout).toEqual({
      status: 'success',
      result: makeCheckoutResponse(),
      error: null,
    });
  });

  it('confirmCheckout con error mantiene el resultado previo y marca error', async () => {
    const service = makeWorkflowServiceMock();
    (service.createCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(makeCheckoutResponse());
    (service.confirmCheckout as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('pago ya confirmado'),
    );
    setWorkflowService(service);

    await useWorkflowStore.getState().submitCheckout({ amount: 100 });
    const payment = await useWorkflowStore.getState().confirmCheckout('pay-1');

    expect(payment).toBeNull();
    expect(useWorkflowStore.getState().checkout).toEqual({
      status: 'error',
      result: makeCheckoutResponse(),
      error: 'pago ya confirmado',
    });
  });

  it('submitAppointment con servicio inyectado actualiza su cola y devuelve el resultado', async () => {
    const service = makeWorkflowServiceMock();
    (service.scheduleAppointment as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAppointmentResponse(),
    );
    setWorkflowService(service);

    const result = await useWorkflowStore.getState().submitAppointment({
      service: 'Consulta dental',
      startsAt: '2026-08-20T15:00:00Z',
      customerName: 'Cliente Demo',
    });

    expect(service.scheduleAppointment).toHaveBeenCalledWith({
      service: 'Consulta dental',
      startsAt: '2026-08-20T15:00:00Z',
      customerName: 'Cliente Demo',
    });
    expect(result).toEqual(makeAppointmentResponse());
    expect(useWorkflowStore.getState().appointment).toEqual({
      status: 'success',
      result: makeAppointmentResponse(),
      error: null,
    });
  });

  it('loadAttribution con servicio inyectado pasa a success y devuelve el reporte', async () => {
    const service = makeWorkflowServiceMock();
    (service.getLeadAttribution as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeLeadAttributionRead(),
    );
    setWorkflowService(service);

    const result = await useWorkflowStore.getState().loadAttribution();

    expect(service.getLeadAttribution).toHaveBeenCalledTimes(1);
    expect(result).toEqual(makeLeadAttributionRead());
    expect(useWorkflowStore.getState().attribution).toEqual(makeLeadAttributionRead());
    expect(useWorkflowStore.getState().attributionStatus).toBe('success');
    expect(useWorkflowStore.getState().attributionError).toBeNull();
  });

  it('loadAttribution con error del servicio pasa a error con el mensaje', async () => {
    const service = makeWorkflowServiceMock();
    (service.getLeadAttribution as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('reporte no disponible'),
    );
    setWorkflowService(service);

    const result = await useWorkflowStore.getState().loadAttribution();

    expect(result).toBeNull();
    expect(useWorkflowStore.getState().attributionStatus).toBe('error');
    expect(useWorkflowStore.getState().attributionError).toBe('reporte no disponible');
  });

  it('loadAttribution sin servicio registrado pasa a error controlado', async () => {
    const result = await useWorkflowStore.getState().loadAttribution();

    expect(result).toBeNull();
    expect(useWorkflowStore.getState().attributionStatus).toBe('error');
    expect(useWorkflowStore.getState().attributionError).toBe(
      'El módulo de workflows no está disponible.',
    );
  });
});
