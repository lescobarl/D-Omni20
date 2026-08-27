/**
 * Pruebas de los 4 formularios de workflow (checkout, leads, cotizaciones y citas).
 *
 * Contrato:
 * - Cada formulario es controlado y expone el feedback de forma accesible
 *   (`role="status"` para carga, `role="alert"` para errores).
 * - Los envíos delegan en `useWorkflowStore.<submit>` con el servicio inyectado
 *   por DI (`setWorkflowService`); el resultado se muestra en una tarjeta.
 * - Los botones de envío se deshabilitan mientras el formulario no es válido.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  IAppointmentResponse,
  ICheckoutResponse,
  ILeadRead,
  IPaymentRead,
  IQuoteResponse,
} from '@/api/types';
import type { IWorkflowService } from '@/services/workflowService';
import { setWorkflowService, useWorkflowStore } from '@/store/workflowStore';
import { AppointmentSchedulerWorkflow } from '@/components/Workflows/AppointmentSchedulerWorkflow';
import { CheckoutWorkflow } from '@/components/Workflows/CheckoutWorkflow';
import { LeadCaptureWorkflow } from '@/components/Workflows/LeadCaptureWorkflow';
import { QuoteGeneratorWorkflow } from '@/components/Workflows/QuoteGeneratorWorkflow';

/** Doble del puerto `IWorkflowService` con los 5 métodos. */
function makeWorkflowServiceMock(): IWorkflowService {
  return {
    createCheckout: vi.fn(),
    confirmCheckout: vi.fn(),
    captureLead: vi.fn(),
    generateQuote: vi.fn(),
    scheduleAppointment: vi.fn(),
  };
}

/** Promesa diferida para simular envíos pendientes (estado de carga). */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fábrica de `ICheckoutResponse`. */
function makeCheckoutResponse(overrides: Partial<ICheckoutResponse> = {}): ICheckoutResponse {
  return {
    payment_id: 'pay-1',
    status: 'pending',
    checkout_url: 'https://checkout.sandbox.local/pay-1',
    provider: 'sandbox',
    ...overrides,
  };
}

/** Fábrica de `IPaymentRead`. */
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

/** Fábrica de `ILeadRead`. */
function makeLeadRead(overrides: Partial<ILeadRead> = {}): ILeadRead {
  return {
    id: 'lead-1',
    tenant_id: 'tenant-1',
    name: 'María García',
    email: 'maria@ejemplo.com',
    phone: '+52 55 1234 5678',
    source: 'landing',
    status: 'new',
    metadata: {},
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IQuoteResponse`. */
function makeQuoteResponse(overrides: Partial<IQuoteResponse> = {}): IQuoteResponse {
  return {
    quote_id: 'quote-1',
    status: 'approved',
    subtotal: 200,
    tax: 32,
    total: 232,
    currency: 'usd',
    pdf_url: 'https://cdn.sandbox.local/quotes/quote-1.pdf',
    ...overrides,
  };
}

/** Fábrica de `IAppointmentResponse`. */
function makeAppointmentResponse(
  overrides: Partial<IAppointmentResponse> = {},
): IAppointmentResponse {
  return {
    appointment_id: 'appt-1',
    status: 'scheduled',
    starts_at: '2026-08-20T15:00:00Z',
    ends_at: '2026-08-20T15:30:00Z',
    timezone: 'America/Mexico_City',
    ics_url: 'https://cdn.sandbox.local/cal/appt-1.ics',
    ...overrides,
  };
}

describe('CheckoutWorkflow', () => {
  let service: IWorkflowService;

  beforeEach(() => {
    service = makeWorkflowServiceMock();
    setWorkflowService(service);
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    setWorkflowService(null);
  });

  it('renderiza el formulario con monto por defecto y monedas ISO', () => {
    render(<CheckoutWorkflow />);

    expect(screen.getByRole('heading', { level: 3, name: 'Checkout Directo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Monto')).toHaveValue(100);
    expect(screen.getByLabelText('Moneda')).toHaveValue('usd');
    expect(screen.getByRole('button', { name: 'Crear checkout' })).toBeEnabled();
  });

  it('deshabilita el envío y no llama al servicio con un monto inválido', async () => {
    const user = userEvent.setup();
    render(<CheckoutWorkflow />);

    const amount = screen.getByLabelText('Monto');
    await act(async () => {
      await user.clear(amount);
      await user.type(amount, '0');
    });

    expect(screen.getByRole('button', { name: 'Crear checkout' })).toBeDisabled();
    expect(service.createCheckout).not.toHaveBeenCalled();
  });

  it('envía el checkout y muestra la tarjeta de resultado con el enlace de pago', async () => {
    const user = userEvent.setup();
    service.createCheckout = vi.fn().mockResolvedValue(makeCheckoutResponse());
    render(<CheckoutWorkflow />);

    await act(async () => {
      await user.type(
        screen.getByLabelText('Correo del cliente (opcional)'),
        'cliente@ejemplo.com',
      );
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear checkout' }));
    });

    expect(service.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        currency: 'usd',
        customerEmail: 'cliente@ejemplo.com',
      }),
    );
    expect(await screen.findByText(/Checkout pending · sandbox/)).toBeInTheDocument();
    expect(screen.getByText(/ID: pay-1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir página de pago' })).toHaveAttribute(
      'href',
      'https://checkout.sandbox.local/pay-1',
    );
    expect(screen.getByRole('button', { name: 'Confirmar pago (sandbox)' })).toBeInTheDocument();
  });

  it('confirma el pago sandbox y muestra el pago formateado', async () => {
    const user = userEvent.setup();
    service.createCheckout = vi.fn().mockResolvedValue(makeCheckoutResponse());
    service.confirmCheckout = vi.fn().mockResolvedValue(makePaymentRead());
    render(<CheckoutWorkflow />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear checkout' }));
    });
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Confirmar pago (sandbox)' }));
    });

    expect(service.confirmCheckout).toHaveBeenCalledWith('pay-1');
    expect(await screen.findByText('Pago confirmado: paid')).toBeInTheDocument();
    expect(screen.getAllByText(/pay-1/).length).toBeGreaterThanOrEqual(2);
  });

  it('muestra el error del servicio de forma accesible', async () => {
    const user = userEvent.setup();
    service.createCheckout = vi.fn().mockRejectedValue(new Error('Pasarela no disponible'));
    render(<CheckoutWorkflow />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear checkout' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Pasarela no disponible');
  });

  it('muestra el estado de carga mientras el checkout está pendiente', async () => {
    const user = userEvent.setup();
    const pending = deferred<ICheckoutResponse>();
    service.createCheckout = vi.fn().mockReturnValue(pending.promise);
    render(<CheckoutWorkflow />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear checkout' }));
    });

    expect(await screen.findByText('Creando checkout…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creando checkout…' })).toBeDisabled();

    await act(async () => {
      pending.resolve(makeCheckoutResponse());
    });
    expect(await screen.findByText(/Checkout pending · sandbox/)).toBeInTheDocument();
  });
});

describe('LeadCaptureWorkflow', () => {
  let service: IWorkflowService;

  beforeEach(() => {
    service = makeWorkflowServiceMock();
    setWorkflowService(service);
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    setWorkflowService(null);
  });

  it('renderiza el formulario con los orígenes de captura', () => {
    render(<LeadCaptureWorkflow />);

    expect(screen.getByRole('heading', { level: 3, name: 'Captura de Leads' })).toBeInTheDocument();
    expect(screen.getByLabelText('Origen')).toHaveValue('landing');
    expect(screen.getByRole('button', { name: 'Capturar lead' })).toBeDisabled();
  });

  it('deshabilita el envío hasta completar nombre y correo', async () => {
    const user = userEvent.setup();
    render(<LeadCaptureWorkflow />);

    const button = screen.getByRole('button', { name: 'Capturar lead' });
    await act(async () => {
      await user.type(screen.getByLabelText('Nombre'), 'María');
    });
    expect(button).toBeDisabled();

    await act(async () => {
      await user.type(screen.getByLabelText('Correo'), 'maria@ejemplo.com');
    });
    expect(button).toBeEnabled();
  });

  it('captura el lead y muestra la tarjeta de resultado con teléfono', async () => {
    const user = userEvent.setup();
    service.captureLead = vi.fn().mockResolvedValue(makeLeadRead());
    render(<LeadCaptureWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre'), 'María García');
      await user.type(screen.getByLabelText('Correo'), 'maria@ejemplo.com');
      await user.type(screen.getByLabelText('Teléfono (opcional)'), '+52 55 1234 5678');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Capturar lead' }));
    });

    expect(service.captureLead).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'María García',
        email: 'maria@ejemplo.com',
        phone: '+52 55 1234 5678',
        source: 'landing',
      }),
    );
    expect(await screen.findByText(/Lead new · origen landing/)).toBeInTheDocument();
    expect(
      screen.getByText(/María García · maria@ejemplo.com · \+52 55 1234 5678/),
    ).toBeInTheDocument();
    expect(screen.getByText(/ID: lead-1/)).toBeInTheDocument();
  });

  it('omite el teléfono en el resumen cuando es null', async () => {
    const user = userEvent.setup();
    service.captureLead = vi.fn().mockResolvedValue(makeLeadRead({ phone: null }));
    render(<LeadCaptureWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre'), 'María García');
      await user.type(screen.getByLabelText('Correo'), 'maria@ejemplo.com');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Capturar lead' }));
    });

    expect(await screen.findByText(/María García · maria@ejemplo.com/)).toBeInTheDocument();
    expect(screen.queryByText(/\+52/)).not.toBeInTheDocument();
  });

  it('muestra el error del servicio de forma accesible', async () => {
    const user = userEvent.setup();
    service.captureLead = vi.fn().mockRejectedValue(new Error('CRM no disponible'));
    render(<LeadCaptureWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre'), 'María García');
      await user.type(screen.getByLabelText('Correo'), 'maria@ejemplo.com');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Capturar lead' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('CRM no disponible');
  });

  it('muestra el estado de carga mientras se registra el lead', async () => {
    const user = userEvent.setup();
    const pending = deferred<ILeadRead>();
    service.captureLead = vi.fn().mockReturnValue(pending.promise);
    render(<LeadCaptureWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre'), 'María García');
      await user.type(screen.getByLabelText('Correo'), 'maria@ejemplo.com');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Capturar lead' }));
    });

    expect(await screen.findByText('Registrando el lead…')).toBeInTheDocument();

    await act(async () => {
      pending.resolve(makeLeadRead());
    });
    expect(await screen.findByText(/Lead new · origen landing/)).toBeInTheDocument();
  });
});

describe('QuoteGeneratorWorkflow', () => {
  let service: IWorkflowService;

  beforeEach(() => {
    service = makeWorkflowServiceMock();
    setWorkflowService(service);
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    setWorkflowService(null);
  });

  it('renderiza una única línea de servicio con el botón de quitar deshabilitado', () => {
    render(<QuoteGeneratorWorkflow />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Generador de Cotizaciones' }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Nombre de la línea/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Quitar línea 1' })).toBeDisabled();
  });

  it('añade y quita líneas de servicio manteniendo al menos una', async () => {
    const user = userEvent.setup();
    render(<QuoteGeneratorWorkflow />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agregar línea' }));
    });

    expect(screen.getAllByLabelText(/Nombre de la línea/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Quitar línea 1' })).toBeEnabled();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Quitar línea 2' }));
    });

    expect(screen.getAllByLabelText(/Nombre de la línea/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Quitar línea 1' })).toBeDisabled();
  });

  it('no envía cuando no hay líneas válidas aunque el botón esté habilitado', async () => {
    const user = userEvent.setup();
    render(<QuoteGeneratorWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Carlos López');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar cotización' }));
    });

    expect(service.generateQuote).not.toHaveBeenCalled();
  });

  it('genera la cotización y muestra el resumen con enlace al PDF', async () => {
    const user = userEvent.setup();
    service.generateQuote = vi.fn().mockResolvedValue(makeQuoteResponse());
    render(<QuoteGeneratorWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Carlos López');
      await user.type(screen.getByLabelText('Nombre de la línea 1'), 'Diseño web');
      await user.clear(screen.getByLabelText('Cantidad de la línea 1'));
      await user.type(screen.getByLabelText('Cantidad de la línea 1'), '2');
      await user.type(screen.getByLabelText('Precio unitario de la línea 1'), '100');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar cotización' }));
    });

    expect(service.generateQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Carlos López',
        currency: 'usd',
        taxRateBps: 1600,
        services: [{ name: 'Diseño web', quantity: 2, unitPrice: 100 }],
      }),
    );
    expect(await screen.findByText(/Cotización approved · USD/)).toBeInTheDocument();
    expect(screen.getByText(/Subtotal/)).toHaveTextContent(/200/);
    expect(screen.getByText(/ID: quote-1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir PDF de la cotización' })).toHaveAttribute(
      'href',
      'https://cdn.sandbox.local/quotes/quote-1.pdf',
    );
  });

  it('no muestra el enlace al PDF cuando la URL es null', async () => {
    const user = userEvent.setup();
    service.generateQuote = vi.fn().mockResolvedValue(makeQuoteResponse({ pdf_url: null }));
    render(<QuoteGeneratorWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Carlos López');
      await user.type(screen.getByLabelText('Nombre de la línea 1'), 'Diseño web');
      await user.type(screen.getByLabelText('Precio unitario de la línea 1'), '100');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar cotización' }));
    });

    expect(await screen.findByText(/Cotización approved · USD/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Abrir PDF de la cotización' }),
    ).not.toBeInTheDocument();
  });

  it('muestra el error del servicio de forma accesible', async () => {
    const user = userEvent.setup();
    service.generateQuote = vi.fn().mockRejectedValue(new Error('Motor de PDF caído'));
    render(<QuoteGeneratorWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Carlos López');
      await user.type(screen.getByLabelText('Nombre de la línea 1'), 'Diseño web');
      await user.type(screen.getByLabelText('Precio unitario de la línea 1'), '100');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar cotización' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Motor de PDF caído');
  });

  it('muestra el estado de carga mientras se genera la cotización', async () => {
    const user = userEvent.setup();
    const pending = deferred<IQuoteResponse>();
    service.generateQuote = vi.fn().mockReturnValue(pending.promise);
    render(<QuoteGeneratorWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Carlos López');
      await user.type(screen.getByLabelText('Nombre de la línea 1'), 'Diseño web');
      await user.type(screen.getByLabelText('Precio unitario de la línea 1'), '100');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar cotización' }));
    });

    expect(await screen.findByText('Generando la cotización y su PDF…')).toBeInTheDocument();

    await act(async () => {
      pending.resolve(makeQuoteResponse());
    });
    expect(await screen.findByText(/Cotización approved · USD/)).toBeInTheDocument();
  });
});

describe('AppointmentSchedulerWorkflow', () => {
  let service: IWorkflowService;

  beforeEach(() => {
    service = makeWorkflowServiceMock();
    setWorkflowService(service);
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    setWorkflowService(null);
  });

  it('renderiza el formulario con duraciones y zonas horarias', () => {
    render(<AppointmentSchedulerWorkflow />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Agendador de Citas' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Duración')).toHaveValue('30');
    expect(screen.getByLabelText('Zona horaria')).toHaveValue('America/Mexico_City');
    expect(screen.getByRole('button', { name: 'Agendar cita' })).toBeDisabled();
  });

  it('deshabilita el envío hasta completar servicio, fecha y nombre', async () => {
    const user = userEvent.setup();
    render(<AppointmentSchedulerWorkflow />);

    const button = screen.getByRole('button', { name: 'Agendar cita' });
    await act(async () => {
      await user.type(screen.getByLabelText('Servicio'), 'Consulta inicial');
    });
    expect(button).toBeDisabled();

    await act(async () => {
      await user.type(screen.getByLabelText('Fecha y hora'), '2026-08-20T15:00');
    });
    expect(button).toBeDisabled();

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana Torres');
    });
    expect(button).toBeEnabled();
  });

  it('agenda la cita y muestra el resumen con enlace ICS', async () => {
    const user = userEvent.setup();
    service.scheduleAppointment = vi.fn().mockResolvedValue(makeAppointmentResponse());
    render(<AppointmentSchedulerWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Servicio'), 'Consulta inicial');
      await user.type(screen.getByLabelText('Fecha y hora'), '2026-08-20T15:00');
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana Torres');
      await user.type(screen.getByLabelText('Correo del cliente (opcional)'), 'ana@ejemplo.com');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agendar cita' }));
    });

    expect(service.scheduleAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'Consulta inicial',
        durationMinutes: 30,
        timezone: 'America/Mexico_City',
        customerName: 'Ana Torres',
        customerEmail: 'ana@ejemplo.com',
      }),
    );
    expect(await screen.findByText(/Cita scheduled · America\/Mexico_City/)).toBeInTheDocument();
    expect(screen.getByText(/→/)).toBeInTheDocument();
    expect(screen.getByText(/ID: appt-1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Descargar invitación (.ics)' })).toHaveAttribute(
      'href',
      'https://cdn.sandbox.local/cal/appt-1.ics',
    );
  });

  it('no muestra el enlace ICS cuando la URL es null', async () => {
    const user = userEvent.setup();
    service.scheduleAppointment = vi
      .fn()
      .mockResolvedValue(makeAppointmentResponse({ ics_url: null }));
    render(<AppointmentSchedulerWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Servicio'), 'Consulta inicial');
      await user.type(screen.getByLabelText('Fecha y hora'), '2026-08-20T15:00');
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana Torres');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agendar cita' }));
    });

    expect(await screen.findByText(/Cita scheduled · America\/Mexico_City/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Descargar invitación (.ics)' }),
    ).not.toBeInTheDocument();
  });

  it('muestra el error del servicio de forma accesible', async () => {
    const user = userEvent.setup();
    service.scheduleAppointment = vi.fn().mockRejectedValue(new Error('Calendario no disponible'));
    render(<AppointmentSchedulerWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Servicio'), 'Consulta inicial');
      await user.type(screen.getByLabelText('Fecha y hora'), '2026-08-20T15:00');
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana Torres');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agendar cita' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Calendario no disponible');
  });

  it('muestra el estado de carga mientras se agenda la cita', async () => {
    const user = userEvent.setup();
    const pending = deferred<IAppointmentResponse>();
    service.scheduleAppointment = vi.fn().mockReturnValue(pending.promise);
    render(<AppointmentSchedulerWorkflow />);

    await act(async () => {
      await user.type(screen.getByLabelText('Servicio'), 'Consulta inicial');
      await user.type(screen.getByLabelText('Fecha y hora'), '2026-08-20T15:00');
      await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana Torres');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agendar cita' }));
    });

    expect(await screen.findByText('Registrando la cita…')).toBeInTheDocument();

    await act(async () => {
      pending.resolve(makeAppointmentResponse());
    });
    expect(await screen.findByText(/Cita scheduled · America\/Mexico_City/)).toBeInTheDocument();
  });
});
