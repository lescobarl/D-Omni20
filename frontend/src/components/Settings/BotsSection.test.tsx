/**
 * Pruebas de la sección "Bots" del configurador del tenant (Fase 7).
 *
 * Contrato cubierto:
 * - La sección es autocontenida: carga proveedores, conversaciones, keywords y cola al montar.
 * - Validación del formulario de proveedor (tipo obligatorio y orden entero >= 0).
 * - Traducción del formulario a `IBotProviderInput` (modelo/temperatura vacíos → null).
 * - Alta, alternancia habilitado/deshabilitado y eliminación de proveedores.
 * - Formulario de keywords (término/respuesta obligatorios y prioridad 0-1000) y su
 *   gestión ordenada por prioridad (alta, edición, alternancia y eliminación).
 * - Selección de conversación → carga de mensajes y envío manual a la cola D3.
 * - Monitor de cola D3 (métricas y estado vacío ante error).
 * - Errores del store reflejados en `aria-live` accesibles.
 */
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BotsSection } from '@/components/Settings/BotsSection';
import { setBotService, useBotStore } from '@/store/botStore';
import {
  makeConversation,
  makeKeyword,
  makeMessage,
  makePage,
  makeProvider,
  makeQueueStats,
  makeRouterTrace,
  makeService,
} from '@/test/botMocks';

const CONVERSATION_ID = '66666666-6666-4666-8666-666666666666';

describe('BotsSection', () => {
  beforeEach(() => {
    useBotStore.getState().reset();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useBotStore.getState().reset();
    setBotService(null);
    document.documentElement.removeAttribute('style');
  });

  it('carga proveedores, conversaciones y cola al montar y muestra los estados vacíos', async () => {
    const service = makeService();
    setBotService(service);

    render(<BotsSection />);

    expect(
      await screen.findByText('Aún no hay proveedores de IA configurados.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Aún no hay conversaciones del bot.')).toBeInTheDocument();
    expect(await screen.findByText('Aún no hay keywords configuradas.')).toBeInTheDocument();
    expect(service.listProviders).toHaveBeenCalledTimes(1);
    expect(service.listConversations).toHaveBeenCalledTimes(1);
    expect(service.listKeywords).toHaveBeenCalledTimes(1);
    expect(service.getQueueStats).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Longitud de cola')).toBeInTheDocument();
  });

  it('valida el tipo de proveedor obligatorio', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar proveedor de IA' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    });

    expect(screen.getByText('El tipo de proveedor es obligatorio.')).toBeInTheDocument();
    expect(service.upsertProvider).not.toHaveBeenCalled();
  });

  it('valida que el orden sea un entero mayor o igual a 0', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar proveedor de IA' });
    await user.type(screen.getByLabelText('Tipo de proveedor *'), 'openai');
    // jsdom/user-event no reproduce la escritura de decimales en un input
    // type="number" de forma fiable; fijamos el valor directamente para
    // ejercitar la validación del orden entero.
    fireEvent.change(screen.getByLabelText('Orden *'), { target: { value: '1.5' } });

    // Con `step={1}`, el valor 1.5 es inválido por restricción del navegador
    // (stepMismatch): jsdom bloquearía el submit nativo del botón antes de
    // llegar a la validación de negocio. Disparamos el submit directamente
    // para ejercitar la validación del orden entero del componente.
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Configurar proveedor de IA' }));
    });

    expect(screen.getByText('El orden debe ser un entero mayor o igual a 0.')).toBeInTheDocument();
    expect(service.upsertProvider).not.toHaveBeenCalled();
  });

  it('crea un proveedor con todos los datos opcionales', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar proveedor de IA' });
    await user.type(screen.getByLabelText('Tipo de proveedor *'), 'openai');
    await user.type(screen.getByLabelText('Modelo'), 'gpt-4o-mini');
    await user.type(screen.getByLabelText('Temperatura'), '0.7');
    await user.type(screen.getByLabelText('Prompt base'), 'Eres el asistente de la empresa');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    });

    expect(service.upsertProvider).toHaveBeenCalledWith({
      providerKind: 'openai',
      order: 0,
      enabled: true,
      model: 'gpt-4o-mini',
      temperature: '0.7',
      promptBase: 'Eres el asistente de la empresa',
    });
  });

  it('crea un proveedor solo con el tipo omitiendo los opcionales', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar proveedor de IA' });
    await user.type(screen.getByLabelText('Tipo de proveedor *'), 'openai');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    });

    expect(service.upsertProvider).toHaveBeenCalledWith({
      providerKind: 'openai',
      order: 0,
      enabled: true,
      model: null,
      temperature: null,
      promptBase: '',
    });
  });

  it('lista los proveedores configurados con su estado', async () => {
    const service = makeService({ listProviders: async () => [makeProvider()] });
    setBotService(service);

    render(<BotsSection />);

    expect(await screen.findByText('Habilitado')).toBeInTheDocument();
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('Orden: 0 · Modelo: —')).toBeInTheDocument();
    expect(screen.getByText('Temperatura: —')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshabilitar' })).toBeInTheDocument();
  });

  it('deshabilita un proveedor alternando el estado habilitado', async () => {
    const service = makeService({ listProviders: async () => [makeProvider()] });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByText('Habilitado');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Deshabilitar' }));
    });

    expect(service.upsertProvider).toHaveBeenCalledWith({
      providerKind: 'openai',
      order: 0,
      enabled: false,
      model: null,
      temperature: null,
      promptBase: '',
    });
  });

  it('elimina un proveedor', async () => {
    const service = makeService({ listProviders: async () => [makeProvider()] });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByText('Habilitado');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteProvider).toHaveBeenCalledWith('openai', 0);
  });

  it('selecciona una conversación y carga sus mensajes', async () => {
    const service = makeService({
      listConversations: async () => makePage([makeConversation()]),
      listConversationMessages: async () => makePage([makeMessage()]),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    const conversation = await screen.findByRole('button', {
      name: /new.*5215512345678/,
    });
    await act(async () => {
      await user.click(conversation);
    });

    expect(service.listConversationMessages).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(await screen.findByText('Entrante')).toBeInTheDocument();
    expect(screen.getByText('Hola')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Enviar mensaje de prueba' })).toBeInTheDocument();
  });

  it('valida que el mensaje de prueba no pueda estar vacío', async () => {
    const service = makeService({
      listConversations: async () => makePage([makeConversation()]),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    const conversation = await screen.findByRole('button', {
      name: /new.*5215512345678/,
    });
    await act(async () => {
      await user.click(conversation);
    });
    await screen.findByRole('form', { name: 'Enviar mensaje de prueba' });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Encolar mensaje' }));
    });

    expect(screen.getByText('El mensaje no puede estar vacío.')).toBeInTheDocument();
    expect(service.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('envía un mensaje de prueba y muestra el resultado encolado (202)', async () => {
    const service = makeService({
      listConversations: async () => makePage([makeConversation()]),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    const conversation = await screen.findByRole('button', {
      name: /new.*5215512345678/,
    });
    await act(async () => {
      await user.click(conversation);
    });
    await screen.findByRole('form', { name: 'Enviar mensaje de prueba' });
    await user.type(screen.getByLabelText('Enviar mensaje de prueba a la cola D3'), 'Hola mundo');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Encolar mensaje' }));
    });

    expect(service.sendConversationMessage).toHaveBeenCalledWith(CONVERSATION_ID, 'Hola mundo');
    expect(await screen.findByText('Mensaje encolado (202) · estado: pending')).toBeInTheDocument();
  });

  it('muestra el error de carga de proveedores de forma accesible', async () => {
    const service = makeService({
      listProviders: async () => {
        throw 'x';
      },
    });
    setBotService(service);

    render(<BotsSection />);

    expect(await screen.findByText('No se pudieron cargar los proveedores.')).toBeInTheDocument();
  });

  it('muestra el estado vacío del monitor cuando no hay estadísticas de cola', async () => {
    const service = makeService({
      getQueueStats: async () => {
        throw 'x';
      },
    });
    setBotService(service);

    render(<BotsSection />);

    expect(await screen.findByText('No hay estadísticas de cola disponibles.')).toBeInTheDocument();
    expect(screen.getByText('No se pudieron cargar las estadísticas de cola.')).toBeInTheDocument();
  });

  it('muestra las métricas del monitor de cola D3', async () => {
    const service = makeService({
      getQueueStats: async () =>
        makeQueueStats({
          length: 3,
          pending: 2,
          consumer_lag: 1,
          dlq_count: 1,
          enqueued: 5,
          processed: 4,
          failed: 1,
        }),
    });
    setBotService(service);

    render(<BotsSection />);

    expect(await screen.findByText('Longitud de cola')).toBeInTheDocument();
    expect(screen.getByText('Pendientes')).toBeInTheDocument();
    expect(screen.getByText('Consumer lag')).toBeInTheDocument();
    expect(screen.getByText('DLQ')).toBeInTheDocument();
    expect(screen.getByText('Encolados')).toBeInTheDocument();
    expect(screen.getByText('Procesados')).toBeInTheDocument();
    expect(screen.getByText('Fallidos')).toBeInTheDocument();
    expect(screen.getByText('Stream')).toBeInTheDocument();
    expect(screen.getByText('d3:dev-tenant')).toBeInTheDocument();
  });

  it('valida que el término de una keyword sea obligatorio', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar keyword con prioridad' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar keyword' }));
    });

    expect(screen.getByText('El término es obligatorio.')).toBeInTheDocument();
    expect(service.createKeyword).not.toHaveBeenCalled();
  });

  it('valida que la respuesta de una keyword sea obligatoria', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar keyword con prioridad' });
    await user.type(screen.getByLabelText('Término *'), 'servicio');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar keyword' }));
    });

    expect(screen.getByText('La respuesta es obligatoria.')).toBeInTheDocument();
    expect(service.createKeyword).not.toHaveBeenCalled();
  });

  it('valida que la prioridad de una keyword esté entre 0 y 1000', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar keyword con prioridad' });
    await user.type(screen.getByLabelText('Término *'), 'servicio');
    await user.type(screen.getByLabelText('Respuesta *'), 'Ofrecemos servicios de consultoría.');
    // Con `max={1000}`, el valor 1500 es inválido por restricción del navegador
    // (rangeOverflow): jsdom bloquearía el submit nativo. Disparamos el submit
    // directamente para ejercitar la validación de negocio de la prioridad.
    fireEvent.change(screen.getByLabelText('Prioridad * (0-1000, menor = más prioritario)'), {
      target: { value: '1500' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Configurar keyword con prioridad' }));
    });

    expect(screen.getByText('La prioridad debe ser un entero entre 0 y 1000.')).toBeInTheDocument();
    expect(service.createKeyword).not.toHaveBeenCalled();
  });

  it('crea una keyword con todos los datos', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Configurar keyword con prioridad' });
    await user.type(screen.getByLabelText('Término *'), 'servicio');
    await user.type(screen.getByLabelText('Respuesta *'), 'Ofrecemos servicios de consultoría.');
    fireEvent.change(screen.getByLabelText('Prioridad * (0-1000, menor = más prioritario)'), {
      target: { value: '50' },
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar keyword' }));
    });

    expect(service.createKeyword).toHaveBeenCalledWith({
      term: 'servicio',
      response: 'Ofrecemos servicios de consultoría.',
      priority: 50,
      enabled: true,
    });
  });

  it('lista las keywords configuradas con su prioridad y estado', async () => {
    const service = makeService({
      listKeywords: async () =>
        makePage([
          makeKeyword({ term: 'servicio', priority: 100, response: 'Respuesta servicio' }),
        ]),
    });
    setBotService(service);

    render(<BotsSection />);

    expect(await screen.findByText('Habilitada')).toBeInTheDocument();
    expect(screen.getByText('P100')).toBeInTheDocument();
    expect(screen.getByText('servicio')).toBeInTheDocument();
    expect(screen.getByText('Respuesta servicio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshabilitar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  it('deshabilita una keyword alternando el estado habilitado', async () => {
    const service = makeService({
      listKeywords: async () => makePage([makeKeyword()]),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByText('Habilitada');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Deshabilitar' }));
    });

    expect(service.updateKeyword).toHaveBeenCalledWith(makeKeyword().id, {
      term: 'servicio',
      response: 'Ofrecemos servicios de consultoría.',
      priority: 100,
      enabled: false,
    });
  });

  it('edita una keyword y actualiza sus cambios', async () => {
    const service = makeService({
      listKeywords: async () => makePage([makeKeyword()]),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByText('Habilitada');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    fireEvent.change(screen.getByLabelText('Término *'), { target: { value: 'consultoria' } });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Actualizar keyword' }));
    });

    expect(service.updateKeyword).toHaveBeenCalledWith(makeKeyword().id, {
      term: 'consultoria',
      response: 'Ofrecemos servicios de consultoría.',
      priority: 100,
      enabled: true,
    });
  });

  it('elimina una keyword', async () => {
    const service = makeService({
      listKeywords: async () => makePage([makeKeyword()]),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByText('Habilitada');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteKeyword).toHaveBeenCalledWith(makeKeyword().id);
  });

  it('prueba el router con un mensaje y muestra la rama decidida', async () => {
    const trace = makeRouterTrace();
    const service = makeService({ testRouter: vi.fn().mockResolvedValue(trace) });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Probar router del bot' });
    await user.type(screen.getByLabelText('Mensaje de prueba'), 'Necesito servicio');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Probar router' }));
    });

    expect(service.testRouter).toHaveBeenCalledWith('Necesito servicio');
    expect(await screen.findByText('Ruta:')).toBeInTheDocument();
    expect(screen.getByText('Rama')).toBeInTheDocument();
    expect(screen.getByText('keyword', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/Ofrecemos servicios de consultoría/)).toBeInTheDocument();
    expect(screen.getByText(/· matched —/)).toBeInTheDocument();
  });

  it('valida que el mensaje de prueba del router no esté vacío', async () => {
    const service = makeService();
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Probar router del bot' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Probar router' }));
    });

    expect(screen.getByText('Escribe un mensaje para probar el router.')).toBeInTheDocument();
    expect(service.testRouter).not.toHaveBeenCalled();
  });

  it('muestra el error del store cuando falla el test del router', async () => {
    const service = makeService({
      testRouter: vi.fn().mockRejectedValue(new Error('No se pudo probar el router del bot.')),
    });
    setBotService(service);
    const user = userEvent.setup();

    render(<BotsSection />);

    await screen.findByRole('form', { name: 'Probar router del bot' });
    await user.type(screen.getByLabelText('Mensaje de prueba'), 'Hola');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Probar router' }));
    });

    expect(await screen.findByText('No se pudo probar el router del bot.')).toBeInTheDocument();
  });
});
