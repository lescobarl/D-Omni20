/**
 * Pruebas del servicio de workflows de conversión.
 *
 * Contrato:
 * - `BackendWorkflowService` traduce los inputs de dominio (camelCase) a los
 *   DTOs del backend (snake_case) y delega en `IApiClient`.
 * - Aplica valores por defecto (moneda `usd`, origen `landing`, impuesto 0,
 *   duración 30 min, zona horaria `UTC`).
 * - Propaga los errores de la API sin envolverlos.
 * - `createWorkflowService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  IAppointmentResponse,
  ICheckoutResponse,
  ILeadAttributionRead,
  ILeadRead,
  IPaymentRead,
  IQuoteResponse,
} from '@/api/types';
import { BackendWorkflowService, createWorkflowService } from '@/services/workflowService';
import { makeApiClientMock } from '@/test/apiClientMocks';

/** Fábrica de `ICheckoutResponse` (DTO exacto del backend). */
function makeCheckoutResponse(overrides: Partial<ICheckoutResponse> = {}): ICheckoutResponse {
  return {
    payment_id: 'pay-1',
    status: 'pending',
    checkout_url: 'https://checkout.sandbox.local/pay-1',
    provider: 'sandbox',
    ...overrides,
  };
}

/** Fábrica de `IPaymentRead` (DTO exacto del backend). */
function makePaymentRead(overrides: Partial<IPaymentRead> = {}): IPaymentRead {
  return {
    id: 'pay-1',
    tenant_id: 'tenant-1',
    amount_minor: 10000,
    currency: 'usd',
    status: 'paid',
    provider: 'sandbox',
    provider_session_id: 'sess-1',
    customer_email: 'cliente@example.com',
    customer_name: 'Cliente Demo',
    metadata: {},
    failure_reason: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `ILeadRead` (DTO exacto del backend). */
function makeLeadRead(overrides: Partial<ILeadRead> = {}): ILeadRead {
  return {
    id: 'lead-1',
    tenant_id: 'tenant-1',
    name: 'María López',
    email: 'maria@example.com',
    phone: null,
    source: 'landing',
    status: 'new',
    metadata: {},
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
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

/** Fábrica de `IQuoteResponse` (DTO exacto del backend). */
function makeQuoteResponse(overrides: Partial<IQuoteResponse> = {}): IQuoteResponse {
  return {
    quote_id: 'quote-1',
    status: 'issued',
    subtotal: 100,
    tax: 16,
    total: 116,
    currency: 'usd',
    pdf_url: 'https://pdf.sandbox.local/quote-1.pdf',
    ...overrides,
  };
}

/** Fábrica de `IAppointmentResponse` (DTO exacto del backend). */
function makeAppointmentResponse(
  overrides: Partial<IAppointmentResponse> = {},
): IAppointmentResponse {
  return {
    appointment_id: 'appt-1',
    status: 'scheduled',
    starts_at: '2026-08-20T15:00:00Z',
    ends_at: '2026-08-20T15:30:00Z',
    timezone: 'America/Mexico_City',
    ics_url: 'https://ics.sandbox.local/appt-1.ics',
    ...overrides,
  };
}

describe('BackendWorkflowService', () => {
  it('crea un checkout traduciendo camelCase a snake_case con valores por defecto', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.createCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCheckoutResponse(),
    );
    const service = new BackendWorkflowService(apiClient);

    const result = await service.createCheckout({ amount: 99.5 });

    expect(apiClient.createCheckout).toHaveBeenCalledTimes(1);
    expect(apiClient.createCheckout).toHaveBeenCalledWith({
      amount: 99.5,
      currency: 'usd',
      customer_email: null,
      customer_name: null,
      success_url: null,
      cancel_url: null,
      metadata: {},
    });
    expect(result.payment_id).toBe('pay-1');
    expect(result.status).toBe('pending');
    expect(result.provider).toBe('sandbox');
  });

  it('crea un checkout con los datos opcionales cuando se proveen', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.createCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCheckoutResponse(),
    );
    const service = new BackendWorkflowService(apiClient);

    await service.createCheckout({
      amount: 250,
      currency: 'mxn',
      customerEmail: 'cliente@example.com',
      customerName: 'Cliente Demo',
      successUrl: 'https://app.local/success',
      cancelUrl: 'https://app.local/cancel',
      metadata: { campaign: 'summer' },
    });

    expect(apiClient.createCheckout).toHaveBeenCalledWith({
      amount: 250,
      currency: 'mxn',
      customer_email: 'cliente@example.com',
      customer_name: 'Cliente Demo',
      success_url: 'https://app.local/success',
      cancel_url: 'https://app.local/cancel',
      metadata: { campaign: 'summer' },
    });
  });

  it('confirma un pago sandbox delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.confirmCheckout as ReturnType<typeof vi.fn>).mockResolvedValue(makePaymentRead());
    const service = new BackendWorkflowService(apiClient);

    const payment = await service.confirmCheckout('pay-1');

    expect(apiClient.confirmCheckout).toHaveBeenCalledWith('pay-1');
    expect(payment.id).toBe('pay-1');
    expect(payment.status).toBe('paid');
    expect(payment.amount_minor).toBe(10000);
  });

  it('captura un lead traduciendo camelCase a snake_case con origen por defecto', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.captureLead as ReturnType<typeof vi.fn>).mockResolvedValue(makeLeadRead());
    const service = new BackendWorkflowService(apiClient);

    const lead = await service.captureLead({ name: 'María López', email: 'maria@example.com' });

    expect(apiClient.captureLead).toHaveBeenCalledWith({
      name: 'María López',
      email: 'maria@example.com',
      phone: null,
      source: 'landing',
      metadata: {},
    });
    expect(lead.id).toBe('lead-1');
    expect(lead.status).toBe('new');
  });

  it('captura un lead con teléfono y origen explícito', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.captureLead as ReturnType<typeof vi.fn>).mockResolvedValue(makeLeadRead());
    const service = new BackendWorkflowService(apiClient);

    await service.captureLead({
      name: 'María López',
      email: 'maria@example.com',
      phone: '5551234567',
      source: 'facebook',
      metadata: { ad: 'camp-1' },
    });

    expect(apiClient.captureLead).toHaveBeenCalledWith({
      name: 'María López',
      email: 'maria@example.com',
      phone: '5551234567',
      source: 'facebook',
      metadata: { ad: 'camp-1' },
    });
  });

  it('genera una cotización traduciendo las líneas y aplicando impuesto 0 por defecto', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateQuote as ReturnType<typeof vi.fn>).mockResolvedValue(makeQuoteResponse());
    const service = new BackendWorkflowService(apiClient);

    const quote = await service.generateQuote({
      customerName: 'Cliente Demo',
      services: [
        { name: 'Limpieza dental', quantity: 1, unitPrice: 100, description: 'Básica' },
        { name: 'Blanqueamiento', quantity: 2, unitPrice: 50 },
      ],
    });

    expect(apiClient.generateQuote).toHaveBeenCalledWith({
      customer_name: 'Cliente Demo',
      customer_email: null,
      currency: 'usd',
      services: [
        { name: 'Limpieza dental', description: 'Básica', quantity: 1, unit_price: 100 },
        { name: 'Blanqueamiento', description: null, quantity: 2, unit_price: 50 },
      ],
      tax_rate_bps: 0,
    });
    expect(quote.quote_id).toBe('quote-1');
    expect(quote.total).toBe(116);
    expect(quote.pdf_url).toBe('https://pdf.sandbox.local/quote-1.pdf');
  });

  it('genera una cotización con correo, moneda y tasa de impuesto explícitas', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateQuote as ReturnType<typeof vi.fn>).mockResolvedValue(makeQuoteResponse());
    const service = new BackendWorkflowService(apiClient);

    await service.generateQuote({
      customerName: 'Cliente Demo',
      customerEmail: 'cliente@example.com',
      currency: 'mxn',
      taxRateBps: 1600,
      services: [{ name: 'Consulta', quantity: 1, unitPrice: 500 }],
    });

    expect(apiClient.generateQuote).toHaveBeenCalledWith({
      customer_name: 'Cliente Demo',
      customer_email: 'cliente@example.com',
      currency: 'mxn',
      services: [{ name: 'Consulta', description: null, quantity: 1, unit_price: 500 }],
      tax_rate_bps: 1600,
    });
  });

  it('agenda una cita traduciendo camelCase a snake_case con duración y zona por defecto', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.scheduleAppointment as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAppointmentResponse(),
    );
    const service = new BackendWorkflowService(apiClient);

    const appointment = await service.scheduleAppointment({
      service: 'Consulta dental',
      startsAt: '2026-08-20T15:00:00Z',
      customerName: 'Cliente Demo',
    });

    expect(apiClient.scheduleAppointment).toHaveBeenCalledWith({
      service: 'Consulta dental',
      starts_at: '2026-08-20T15:00:00Z',
      duration_minutes: 30,
      timezone: 'UTC',
      customer_name: 'Cliente Demo',
      customer_email: null,
      customer_phone: null,
      notes: null,
    });
    expect(appointment.appointment_id).toBe('appt-1');
    expect(appointment.timezone).toBe('America/Mexico_City');
    expect(appointment.ics_url).toBe('https://ics.sandbox.local/appt-1.ics');
  });

  it('agenda una cita con duración, zona horaria y datos del cliente explícitos', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.scheduleAppointment as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAppointmentResponse(),
    );
    const service = new BackendWorkflowService(apiClient);

    await service.scheduleAppointment({
      service: 'Consulta dental',
      startsAt: '2026-08-20T15:00:00Z',
      durationMinutes: 60,
      timezone: 'America/Mexico_City',
      customerName: 'Cliente Demo',
      customerEmail: 'cliente@example.com',
      customerPhone: '5551234567',
      notes: 'Primera visita',
    });

    expect(apiClient.scheduleAppointment).toHaveBeenCalledWith({
      service: 'Consulta dental',
      starts_at: '2026-08-20T15:00:00Z',
      duration_minutes: 60,
      timezone: 'America/Mexico_City',
      customer_name: 'Cliente Demo',
      customer_email: 'cliente@example.com',
      customer_phone: '5551234567',
      notes: 'Primera visita',
    });
  });

  it('obtiene la atribución por campaña delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.getLeadAttribution as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeLeadAttributionRead(),
    );
    const service = new BackendWorkflowService(apiClient);

    const result = await service.getLeadAttribution();

    expect(apiClient.getLeadAttribution).toHaveBeenCalledTimes(1);
    expect(apiClient.getLeadAttribution).toHaveBeenCalledWith();
    expect(result.total_leads).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('propaga los errores de la atribución sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const failure = new Error('reporte no disponible');
    (apiClient.getLeadAttribution as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const service = new BackendWorkflowService(apiClient);

    await expect(service.getLeadAttribution()).rejects.toBe(failure);
  });

  it('propaga los errores de la API sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const failure = new Error('pasarela caída');
    (apiClient.createCheckout as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const service = new BackendWorkflowService(apiClient);

    await expect(service.createCheckout({ amount: 10 })).rejects.toBe(failure);
  });
});

describe('createWorkflowService', () => {
  it('construye una implementación BackendWorkflowService desde el cliente', () => {
    const apiClient = makeApiClientMock();
    const service = createWorkflowService(apiClient);

    expect(service).toBeInstanceOf(BackendWorkflowService);
  });

  it('delega en el cliente inyectado durante la generación de una cotización', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateQuote as ReturnType<typeof vi.fn>).mockResolvedValue(makeQuoteResponse());
    const service = createWorkflowService(apiClient);

    await service.generateQuote({
      customerName: 'Cliente Demo',
      services: [{ name: 'Consulta', quantity: 1, unitPrice: 100 }],
    });

    expect(apiClient.generateQuote).toHaveBeenCalledWith({
      customer_name: 'Cliente Demo',
      customer_email: null,
      currency: 'usd',
      services: [{ name: 'Consulta', description: null, quantity: 1, unit_price: 100 }],
      tax_rate_bps: 0,
    });
  });
});
