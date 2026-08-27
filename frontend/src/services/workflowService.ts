/**
 * Servicio de workflows de conversión (puerto + implementación).
 *
 * Contrato:
 * - `IWorkflowService` es el puerto consumido por la UI y el store de workflows.
 * - `BackendWorkflowService` implementa el puerto vía `IApiClient` y traduce los
 *   inputs de dominio (camelCase) a los DTOs del backend (snake_case).
 * - La fábrica `createWorkflowService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IAppointmentResponse,
  ICheckoutResponse,
  ILeadRead,
  IPaymentRead,
  IQuoteResponse,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Input de dominio para crear un checkout directo. */
export interface ICheckoutInput {
  /** Monto en unidades mayores (p. ej. 99.5 USD). */
  amount: number;
  /** Moneda ISO 4217 en minúsculas (por defecto `usd`). */
  currency?: string;
  /** Correo del cliente (opcional). */
  customerEmail?: string;
  /** Nombre del cliente (opcional). */
  customerName?: string;
  /** URL de retorno tras pago exitoso (opcional). */
  successUrl?: string;
  /** URL de retorno tras cancelación (opcional). */
  cancelUrl?: string;
  /** Metadatos libres de la transacción (opcional). */
  metadata?: Record<string, unknown>;
}

/** Input de dominio para capturar un lead. */
export interface ILeadInput {
  /** Nombre del prospecto. */
  name: string;
  /** Correo del prospecto. */
  email: string;
  /** Teléfono del prospecto (opcional). */
  phone?: string;
  /** Origen del lead (por defecto `landing`). */
  source?: string;
  /** Metadatos libres del lead (opcional). */
  metadata?: Record<string, unknown>;
}

/** Línea de servicio/producto de una cotización (dominio). */
export interface IQuoteLineInput {
  /** Nombre del servicio. */
  name: string;
  /** Descripción del servicio (opcional). */
  description?: string;
  /** Cantidad (>= 1). */
  quantity: number;
  /** Precio unitario en unidades mayores (> 0). */
  unitPrice: number;
}

/** Input de dominio para generar una cotización. */
export interface IQuoteInput {
  /** Nombre del cliente. */
  customerName: string;
  /** Correo del cliente (opcional). */
  customerEmail?: string;
  /** Moneda ISO 4217 en minúsculas (por defecto `usd`). */
  currency?: string;
  /** Líneas de servicio (al menos una). */
  services: IQuoteLineInput[];
  /** Tasa de impuesto en puntos base (0-10000). */
  taxRateBps?: number;
}

/** Input de dominio para agendar una cita. */
export interface IAppointmentInput {
  /** Nombre del servicio. */
  service: string;
  /** Fecha/hora de inicio en formato ISO 8601. */
  startsAt: string;
  /** Duración en minutos (5-480, por defecto 30). */
  durationMinutes?: number;
  /** Zona horaria IANA (por defecto `UTC`). */
  timezone?: string;
  /** Nombre del cliente. */
  customerName: string;
  /** Correo del cliente (opcional). */
  customerEmail?: string;
  /** Teléfono del cliente (opcional). */
  customerPhone?: string;
  /** Notas de la cita (opcional). */
  notes?: string;
}

/** Puerto del servicio de workflows de conversión. */
export interface IWorkflowService {
  /** Crea un checkout directo en la pasarela. */
  createCheckout(input: ICheckoutInput): Promise<ICheckoutResponse>;
  /** Confirma manualmente un pago sandbox pendiente (idempotente). */
  confirmCheckout(paymentId: string): Promise<IPaymentRead>;
  /** Captura un lead en el tenant activo. */
  captureLead(input: ILeadInput): Promise<ILeadRead>;
  /** Genera una cotización y su PDF. */
  generateQuote(input: IQuoteInput): Promise<IQuoteResponse>;
  /** Agenda una cita y genera su ICS. */
  scheduleAppointment(input: IAppointmentInput): Promise<IAppointmentResponse>;
}

/** Implementación del puerto de workflows sobre el cliente HTTP del backend. */
export class BackendWorkflowService implements IWorkflowService {
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Crea un checkout directo traduciendo el input de dominio al DTO del backend. */
  public async createCheckout(input: ICheckoutInput): Promise<ICheckoutResponse> {
    this.logger?.debug('workflow.checkout.create', { amount: input.amount });
    const response = await this.apiClient.createCheckout({
      amount: input.amount,
      currency: input.currency ?? 'usd',
      customer_email: input.customerEmail ?? null,
      customer_name: input.customerName ?? null,
      success_url: input.successUrl ?? null,
      cancel_url: input.cancelUrl ?? null,
      metadata: input.metadata ?? {},
    });
    this.logger?.info('workflow.checkout.create', {
      paymentId: response.payment_id,
      status: response.status,
      provider: response.provider,
    });
    return response;
  }

  /** Confirma manualmente un pago sandbox pendiente (idempotente). */
  public async confirmCheckout(paymentId: string): Promise<IPaymentRead> {
    this.logger?.debug('workflow.checkout.confirm', { paymentId });
    const payment = await this.apiClient.confirmCheckout(paymentId);
    this.logger?.info('workflow.checkout.confirm', {
      paymentId,
      status: payment.status,
    });
    return payment;
  }

  /** Captura un lead traduciendo el input de dominio al DTO del backend. */
  public async captureLead(input: ILeadInput): Promise<ILeadRead> {
    this.logger?.debug('workflow.lead.capture', { email: input.email });
    const lead = await this.apiClient.captureLead({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      source: input.source ?? 'landing',
      metadata: input.metadata ?? {},
    });
    this.logger?.info('workflow.lead.capture', { leadId: lead.id, status: lead.status });
    return lead;
  }

  /** Genera una cotización traduciendo el input de dominio al DTO del backend. */
  public async generateQuote(input: IQuoteInput): Promise<IQuoteResponse> {
    this.logger?.debug('workflow.quote.generate', { services: input.services.length });
    const response = await this.apiClient.generateQuote({
      customer_name: input.customerName,
      customer_email: input.customerEmail ?? null,
      currency: input.currency ?? 'usd',
      services: input.services.map((line) => ({
        name: line.name,
        description: line.description ?? null,
        quantity: line.quantity,
        unit_price: line.unitPrice,
      })),
      tax_rate_bps: input.taxRateBps ?? 0,
    });
    this.logger?.info('workflow.quote.generate', {
      quoteId: response.quote_id,
      status: response.status,
      total: response.total,
    });
    return response;
  }

  /** Agenda una cita traduciendo el input de dominio al DTO del backend. */
  public async scheduleAppointment(input: IAppointmentInput): Promise<IAppointmentResponse> {
    this.logger?.debug('workflow.appointment.schedule', { service: input.service });
    const response = await this.apiClient.scheduleAppointment({
      service: input.service,
      starts_at: input.startsAt,
      duration_minutes: input.durationMinutes ?? 30,
      timezone: input.timezone ?? 'UTC',
      customer_name: input.customerName,
      customer_email: input.customerEmail ?? null,
      customer_phone: input.customerPhone ?? null,
      notes: input.notes ?? null,
    });
    this.logger?.info('workflow.appointment.schedule', {
      appointmentId: response.appointment_id,
      status: response.status,
      startsAt: response.starts_at,
    });
    return response;
  }
}

/**
 * Fábrica del servicio de workflows.
 * @param apiClient Cliente HTTP de la API v1 (inyectado por DI).
 * @param logger Logger de auditoría opcional.
 * @returns Implementación lista para inyectar en el composition root.
 */
export function createWorkflowService(apiClient: IApiClient, logger?: ILogger): IWorkflowService {
  return new BackendWorkflowService(apiClient, logger);
}
