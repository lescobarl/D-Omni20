/**
 * Store de configuración y ejecución de workflows de conversión.
 *
 * Contrato:
 * - Registro de servicios por DI: `setWorkflowService`/`getWorkflowService`
 *   inyectan la implementación `IWorkflowService` desde el composition root.
 * - Si no hay servicio registrado, los submit pasan a estado de error para que
 *   la UI conviva sin la dependencia (p. ej. en pruebas de layout).
 * - Cada workflow mantiene su propia cola `IWorkflowSubmission` con su estado,
 *   resultado tipado y error (checkout, lead, quote, appointment).
 * - `DEFAULT_WORKFLOW_TYPE` es la fábrica del valor inicial por defecto.
 */
import { create } from 'zustand';
import { AppError } from '@/lib/errors';
import type {
  IAppointmentResponse,
  ICheckoutResponse,
  ILeadAttributionRead,
  ILeadRead,
  IPaymentRead,
  IQuoteResponse,
} from '@/api/types';
import type {
  IAppointmentInput,
  ICheckoutInput,
  ILeadInput,
  IQuoteInput,
  IWorkflowService,
} from '@/services/workflowService';
import type { WorkflowType } from '@/types/editor';

/** Tipo de workflow por defecto al iniciar el editor. */
export const DEFAULT_WORKFLOW_TYPE: WorkflowType = 'direct_checkout';

/** Estado de un flujo de envío de workflow. */
export type WorkflowStatus = 'idle' | 'loading' | 'success' | 'error';

/** Clave de la cola de envío de cada workflow. */
export type WorkflowSubmissionKey = 'checkout' | 'lead' | 'quote' | 'appointment';

/** Cola tipada de un envío de workflow (estado + resultado + error). */
export interface IWorkflowSubmission<T> {
  /** Estado del flujo de envío. */
  status: WorkflowStatus;
  /** Último resultado exitoso (o `null` si aún no hay). */
  result: T | null;
  /** Mensaje del último error (o `null`). */
  error: string | null;
}

/** Crea una cola vacía (estado `idle`). */
function emptySubmission<T>(): IWorkflowSubmission<T> {
  return { status: 'idle', result: null, error: null };
}

/** Crea una cola en estado `loading`. */
function loadingSubmission<T>(): IWorkflowSubmission<T> {
  return { status: 'loading', result: null, error: null };
}

/** Crea una cola en estado `success` con su resultado. */
function successSubmission<T>(result: T): IWorkflowSubmission<T> {
  return { status: 'success', result, error: null };
}

/** Crea una cola en estado `error` con su mensaje. */
function errorSubmission<T>(error: string): IWorkflowSubmission<T> {
  return { status: 'error', result: null, error };
}

/** Mapea un tipo de workflow a la clave de su cola de envío. */
export function submissionKeyFor(workflowType: WorkflowType): WorkflowSubmissionKey {
  switch (workflowType) {
    case 'lead_capture':
      return 'lead';
    case 'quote_generator':
      return 'quote';
    case 'appointment_scheduler':
      return 'appointment';
    default:
      return 'checkout';
  }
}

/** Extrae el mensaje de un error desconocido (patrón del store de IA). */
export function extractWorkflowError(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Contrato del store de workflows. */
export interface IWorkflowState {
  /** Tipo de workflow seleccionado para la landing en edición. */
  workflowType: WorkflowType;
  /** Cola del checkout directo. */
  checkout: IWorkflowSubmission<ICheckoutResponse>;
  /** Cola de la captura de leads. */
  lead: IWorkflowSubmission<ILeadRead>;
  /** Cola del generador de cotizaciones. */
  quote: IWorkflowSubmission<IQuoteResponse>;
  /** Cola del agendador de citas. */
  appointment: IWorkflowSubmission<IAppointmentResponse>;
  /** Reporte de atribución por campaña del tenant activo (o `null`). */
  attribution: ILeadAttributionRead | null;
  /** Estado de la carga del reporte de atribución. */
  attributionStatus: WorkflowStatus;
  /** Mensaje del último error de atribución (o `null`). */
  attributionError: string | null;
  /** Selecciona el tipo de workflow de la landing. */
  setWorkflowType(workflowType: WorkflowType): void;
  /** Ejecuta un checkout directo en la pasarela. */
  submitCheckout(input: ICheckoutInput): Promise<ICheckoutResponse | null>;
  /** Confirma manualmente un pago sandbox pendiente. */
  confirmCheckout(paymentId: string): Promise<IPaymentRead | null>;
  /** Ejecuta la captura de un lead. */
  submitLead(input: ILeadInput): Promise<ILeadRead | null>;
  /** Ejecuta la generación de una cotización. */
  submitQuote(input: IQuoteInput): Promise<IQuoteResponse | null>;
  /** Ejecuta el agendamiento de una cita. */
  submitAppointment(input: IAppointmentInput): Promise<IAppointmentResponse | null>;
  /** Carga el reporte de atribución por campaña del tenant activo. */
  loadAttribution(): Promise<ILeadAttributionRead | null>;
  /** Limpia la cola de envío de un workflow concreto. */
  resetSubmission(workflowType: WorkflowType): void;
  /** Reinicia el workflow al valor por defecto y limpia todas las colas. */
  reset(): void;
}

/** Servicio de workflows registrado por el composition root (DI). */
let workflowService: IWorkflowService | null = null;

/**
 * Registra la implementación del servicio de workflows.
 * @param service Implementación a inyectar (o `null` para desregistrar).
 */
export function setWorkflowService(service: IWorkflowService | null): void {
  workflowService = service;
}

/**
 * Devuelve el servicio de workflows registrado.
 * @returns La implementación inyectada o `null` si no se ha registrado.
 */
export function getWorkflowService(): IWorkflowService | null {
  return workflowService;
}

/** Store de configuración y ejecución de workflows de conversión. */
export const useWorkflowStore = create<IWorkflowState>()((set) => ({
  workflowType: DEFAULT_WORKFLOW_TYPE,
  checkout: emptySubmission<ICheckoutResponse>(),
  lead: emptySubmission<ILeadRead>(),
  quote: emptySubmission<IQuoteResponse>(),
  appointment: emptySubmission<IAppointmentResponse>(),
  attribution: null,
  attributionStatus: 'idle',
  attributionError: null,

  setWorkflowType: (workflowType) => set({ workflowType }),

  submitCheckout: async (input) => {
    set({ checkout: loadingSubmission<ICheckoutResponse>() });
    const service = getWorkflowService();
    if (service === null) {
      set({
        checkout: errorSubmission<ICheckoutResponse>('El módulo de workflows no está disponible.'),
      });
      return null;
    }
    try {
      const result = await service.createCheckout(input);
      set({ checkout: successSubmission(result) });
      return result;
    } catch (error) {
      set({
        checkout: errorSubmission<ICheckoutResponse>(
          extractWorkflowError(error, 'No se pudo crear el checkout.'),
        ),
      });
      return null;
    }
  },

  confirmCheckout: async (paymentId) => {
    const service = getWorkflowService();
    if (service === null) {
      set({
        checkout: errorSubmission<ICheckoutResponse>('El módulo de workflows no está disponible.'),
      });
      return null;
    }
    try {
      const payment = await service.confirmCheckout(paymentId);
      // La cola de checkout conserva el `CheckoutResponse` original; solo se
      // actualiza el estado para reflejar que la confirmación fue exitosa.
      set((state) => ({
        checkout: {
          status: 'success',
          result: state.checkout.result,
          error: null,
        },
      }));
      return payment;
    } catch (error) {
      set((state) => ({
        checkout: {
          ...state.checkout,
          status: 'error',
          error: extractWorkflowError(error, 'No se pudo confirmar el pago.'),
        },
      }));
      return null;
    }
  },

  submitLead: async (input) => {
    set({ lead: loadingSubmission<ILeadRead>() });
    const service = getWorkflowService();
    if (service === null) {
      set({ lead: errorSubmission<ILeadRead>('El módulo de workflows no está disponible.') });
      return null;
    }
    try {
      const result = await service.captureLead(input);
      set({ lead: successSubmission(result) });
      return result;
    } catch (error) {
      set({
        lead: errorSubmission<ILeadRead>(
          extractWorkflowError(error, 'No se pudo capturar el lead.'),
        ),
      });
      return null;
    }
  },

  submitQuote: async (input) => {
    set({ quote: loadingSubmission<IQuoteResponse>() });
    const service = getWorkflowService();
    if (service === null) {
      set({ quote: errorSubmission<IQuoteResponse>('El módulo de workflows no está disponible.') });
      return null;
    }
    try {
      const result = await service.generateQuote(input);
      set({ quote: successSubmission(result) });
      return result;
    } catch (error) {
      set({
        quote: errorSubmission<IQuoteResponse>(
          extractWorkflowError(error, 'No se pudo generar la cotización.'),
        ),
      });
      return null;
    }
  },

  submitAppointment: async (input) => {
    set({ appointment: loadingSubmission<IAppointmentResponse>() });
    const service = getWorkflowService();
    if (service === null) {
      set({
        appointment: errorSubmission<IAppointmentResponse>(
          'El módulo de workflows no está disponible.',
        ),
      });
      return null;
    }
    try {
      const result = await service.scheduleAppointment(input);
      set({ appointment: successSubmission(result) });
      return result;
    } catch (error) {
      set({
        appointment: errorSubmission<IAppointmentResponse>(
          extractWorkflowError(error, 'No se pudo agendar la cita.'),
        ),
      });
      return null;
    }
  },

  loadAttribution: async () => {
    set({ attributionStatus: 'loading', attributionError: null });
    const service = getWorkflowService();
    if (service === null) {
      set({
        attributionStatus: 'error',
        attributionError: 'El módulo de workflows no está disponible.',
      });
      return null;
    }
    try {
      const report = await service.getLeadAttribution();
      set({ attribution: report, attributionStatus: 'success' });
      return report;
    } catch (error) {
      set({
        attributionStatus: 'error',
        attributionError: extractWorkflowError(error, 'No se pudo cargar la atribución.'),
      });
      return null;
    }
  },

  resetSubmission: (workflowType) => {
    const key = submissionKeyFor(workflowType);
    if (key === 'checkout') {
      set({ checkout: emptySubmission<ICheckoutResponse>() });
    } else if (key === 'lead') {
      set({ lead: emptySubmission<ILeadRead>() });
    } else if (key === 'quote') {
      set({ quote: emptySubmission<IQuoteResponse>() });
    } else {
      set({ appointment: emptySubmission<IAppointmentResponse>() });
    }
  },

  reset: () =>
    set({
      workflowType: DEFAULT_WORKFLOW_TYPE,
      checkout: emptySubmission<ICheckoutResponse>(),
      lead: emptySubmission<ILeadRead>(),
      quote: emptySubmission<IQuoteResponse>(),
      appointment: emptySubmission<IAppointmentResponse>(),
      attribution: null,
      attributionStatus: 'idle',
      attributionError: null,
    }),
}));
