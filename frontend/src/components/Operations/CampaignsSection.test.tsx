/**
 * Pruebas de la sección "Campañas" del área de operación del bot (B.4/C-2).
 *
 * Contrato:
 * - Carga las campañas de envío al montar (una sola llamada a `listCampaigns`).
 * - Renderiza su eslabón del ciclo comercial (`Captación ① · Recuperación ⑦ ·
 *   Recompra ⑨`) para respetar el contrato de `OperationsArea` (todas las
 *   pestañas muestran su eslabón).
 * - CRUD completo: crear, editar, eliminar y estados vacío/error accesibles.
 * - La validación local exige el nombre antes de enviar.
 * - El estado se elige en un `select` y la programación es un texto opcional.
 * - Segmentación (C-2): por etiquetas de contacto (con coincidencia any/all) o
 *   por evento; disparo (C-2): agendado o por evento de workflow.
 */
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignsSection } from '@/components/Operations/CampaignsSection';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { setLandingService } from '@/store/editorStore';
import { makeLanding, makeLandingService } from '@/test/adsMocks';
import { createTestConfig } from '@/test/config';
import type { IAppConfig } from '@/types/config';
import {
  makeCampaign,
  makeDispatchResult,
  makePage,
  makeRecipientFile,
  makeRecipientFilePreview,
  makeService,
} from '@/test/operationsMocks';

describe('CampaignsSection', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useOperationsStore.getState().reset();
    setOperationsService(null);
    setLandingService(null);
  });

  it('muestra el estado vacío y su eslabón del ciclo comercial', async () => {
    const service = makeService();
    setOperationsService(service);

    render(<CampaignsSection config={createTestConfig()} />);

    expect(await screen.findByText('Aún no hay campañas de envío.')).toBeInTheDocument();
    expect(screen.getByText('Captación ① · Recuperación ⑦ · Recompra ⑨')).toBeInTheDocument();
    expect(service.listCampaigns).toHaveBeenCalledTimes(1);
  });

  it('valida el nombre obligatorio antes de crear', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<CampaignsSection config={createTestConfig()} />);

    await screen.findByText('Aún no hay campañas de envío.');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
    });
    expect(screen.getByText('El nombre es obligatorio.')).toBeInTheDocument();
    expect(service.createCampaign).not.toHaveBeenCalled();
  });

  it('crea una campaña desde el formulario y la agrega a la lista', async () => {
    const service = makeService({
      createCampaign: vi.fn(async () =>
        makeCampaign({
          name: 'Campaña de ventas',
          template_id: '61111111-1111-4111-8111-111111111111',
          state: 'scheduled',
          schedule: '2026-08-20T10:00:00Z',
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<CampaignsSection config={createTestConfig()} />);

    await screen.findByText('Aún no hay campañas de envío.');
    await user.type(screen.getByLabelText('Nombre'), 'Campaña de ventas');
    await user.type(screen.getByLabelText('Plantilla'), '61111111-1111-4111-8111-111111111111');
    await user.selectOptions(screen.getByLabelText('Estado'), 'scheduled');
    await user.type(screen.getByLabelText('Programación'), '2026-08-20T10:00:00Z');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
    });

    expect(service.createCampaign).toHaveBeenCalledWith({
      name: 'Campaña de ventas',
      templateId: '61111111-1111-4111-8111-111111111111',
      state: 'scheduled',
      schedule: '2026-08-20T10:00:00Z',
      segmentType: undefined,
      segmentConfig: undefined,
      triggerType: undefined,
      triggerEvent: undefined,
      landingId: undefined,
    });
    expect(await screen.findByText('Campaña de ventas')).toBeInTheDocument();
  });

  it('lista las campañas de envío con sus datos', async () => {
    const service = makeService({
      listCampaigns: async () => makePage([makeCampaign()]),
    });
    setOperationsService(service);

    render(<CampaignsSection config={createTestConfig()} />);

    expect(await screen.findByText('Campaña de bienvenida')).toBeInTheDocument();
    const listItem = screen.getByText('Campaña de bienvenida').closest('li');
    expect(within(listItem as HTMLElement).getByText('Borrador')).toBeInTheDocument();
  });

  it('edita una campaña existente precargando el formulario', async () => {
    const service = makeService({
      listCampaigns: async () => makePage([makeCampaign()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<CampaignsSection config={createTestConfig()} />);

    await screen.findByText('Campaña de bienvenida');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar campaña' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Campaña de bienvenida');
    expect(screen.getByLabelText('Plantilla')).toHaveValue('');
    expect(screen.getByLabelText('Estado')).toHaveValue('draft');
    expect(screen.getByLabelText('Programación')).toHaveValue('');
    expect(screen.getByLabelText('Segmentación')).toHaveValue('');
    expect(screen.getByLabelText('Disparo')).toHaveValue('');

    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Campaña de bienvenida actualizada');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateCampaign).toHaveBeenCalledWith('54444444-4444-4444-8444-444444444444', {
      name: 'Campaña de bienvenida actualizada',
      templateId: undefined,
      state: 'draft',
      schedule: undefined,
      segmentType: undefined,
      segmentConfig: undefined,
      triggerType: undefined,
      triggerEvent: undefined,
      landingId: undefined,
    });
  });

  it('crea una campaña con segmentación por etiquetas y disparo por evento (C-2)', async () => {
    const service = makeService({
      createCampaign: vi.fn(async () =>
        makeCampaign({
          name: 'Campaña de recompra',
          segment_type: 'tags',
          segment_config: { tags: ['cliente', 'vip'], match: 'any' },
          trigger_type: 'event',
          trigger_event: 'checkout.created',
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<CampaignsSection config={createTestConfig()} />);

    await screen.findByText('Aún no hay campañas de envío.');
    await user.type(screen.getByLabelText('Nombre'), 'Campaña de recompra');
    await user.selectOptions(screen.getByLabelText('Segmentación'), 'tags');
    await user.type(
      screen.getByLabelText('Etiquetas de contacto (separadas por coma)'),
      'cliente, vip',
    );
    await user.selectOptions(screen.getByLabelText('Disparo'), 'event');
    await user.selectOptions(screen.getByLabelText('Evento de disparo'), 'checkout.created');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
    });

    expect(service.createCampaign).toHaveBeenCalledWith({
      name: 'Campaña de recompra',
      templateId: undefined,
      state: 'draft',
      schedule: undefined,
      segmentType: 'tags',
      segmentConfig: { tags: ['cliente', 'vip'], match: 'any' },
      triggerType: 'event',
      triggerEvent: 'checkout.created',
      landingId: undefined,
    });
  });

  it('edita una campaña C-2 precargando segmentación y disparo', async () => {
    const service = makeService({
      listCampaigns: async () =>
        makePage([
          makeCampaign({
            name: 'Campaña de postventa',
            segment_type: 'tags',
            segment_config: { tags: ['postventa'], match: 'all' },
            trigger_type: 'event',
            trigger_event: 'payment.completed',
          }),
        ]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<CampaignsSection config={createTestConfig()} />);

    await screen.findByText('Campaña de postventa');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByLabelText('Segmentación')).toHaveValue('tags');
    expect(screen.getByLabelText('Etiquetas de contacto (separadas por coma)')).toHaveValue(
      'postventa',
    );
    expect(screen.getByLabelText('Coincidencia')).toHaveValue('all');
    expect(screen.getByLabelText('Disparo')).toHaveValue('event');
    expect(screen.getByLabelText('Evento de disparo')).toHaveValue('payment.completed');
  });

  it('lista una campaña C-2 mostrando su segmentación y disparo por evento', async () => {
    const service = makeService({
      listCampaigns: async () =>
        makePage([
          makeCampaign({
            name: 'Campaña de recuperación',
            segment_type: 'tags',
            segment_config: { tags: ['cliente', 'vip'], match: 'any' },
            trigger_type: 'event',
            trigger_event: 'checkout.created',
          }),
        ]),
    });
    setOperationsService(service);

    render(<CampaignsSection config={createTestConfig()} />);

    expect(await screen.findByText('Campaña de recuperación')).toBeInTheDocument();
    expect(screen.getByText('Etiquetas (cualquiera): cliente, vip')).toBeInTheDocument();
    expect(screen.getByText('Disparo por evento: checkout.created')).toBeInTheDocument();
  });

  it('elimina una campaña y vuelve al estado vacío', async () => {
    const service = makeService({
      listCampaigns: async () => makePage([makeCampaign()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<CampaignsSection config={createTestConfig()} />);

    await screen.findByText('Campaña de bienvenida');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteCampaign).toHaveBeenCalledWith('54444444-4444-4444-8444-444444444444');
    expect(await screen.findByText('Aún no hay campañas de envío.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listCampaigns: async () => {
        throw 'x';
      },
    });
    setOperationsService(service);

    render(<CampaignsSection config={createTestConfig()} />);

    expect(await screen.findByText('No se pudieron cargar las campañas.')).toBeInTheDocument();
  });

  describe('GAP 2 · envío masivo sobre archivos existentes', () => {
    const gap2Config = (): IAppConfig =>
      createTestConfig({
        features: { ...createTestConfig().features, recipientFiles: true },
      });

    it('oculta la sección cuando la feature está desactivada', async () => {
      const service = makeService({
        listCampaigns: async () => makePage([makeCampaign()]),
      });
      setOperationsService(service);

      render(<CampaignsSection config={createTestConfig()} />);

      await screen.findByText('Campaña de bienvenida');
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'Destinatarios' }));
      });

      expect(
        screen.queryByText('Envío masivo sobre archivos existentes'),
      ).not.toBeInTheDocument();
      expect(service.listRecipientFiles).not.toHaveBeenCalled();
    });

    it('lista los archivos existentes al abrir destinatarios', async () => {
      const service = makeService({
        listCampaigns: async () => makePage([makeCampaign()]),
        listRecipientFiles: vi.fn(async () => makePage([makeRecipientFile()])),
      });
      setOperationsService(service);
      const user = userEvent.setup();

      render(<CampaignsSection config={gap2Config()} />);

      await screen.findByText('Campaña de bienvenida');
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Destinatarios' }));
      });

      expect(await screen.findByText('Envío masivo sobre archivos existentes')).toBeInTheDocument();
      expect(await screen.findByText('clientes-ventas.csv')).toBeInTheDocument();
      expect(service.listRecipientFiles).toHaveBeenCalledTimes(1);
    });

    it('muestra la vista previa de contactos de un archivo', async () => {
      const service = makeService({
        listCampaigns: async () => makePage([makeCampaign()]),
        listRecipientFiles: vi.fn(async () => makePage([makeRecipientFile()])),
        previewRecipientFile: vi.fn(async () => makeRecipientFilePreview()),
      });
      setOperationsService(service);
      const user = userEvent.setup();

      render(<CampaignsSection config={gap2Config()} />);

      await screen.findByText('Campaña de bienvenida');
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Destinatarios' }));
      });
      await screen.findByText('clientes-ventas.csv');

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Vista previa de contactos' }));
      });

      expect(await screen.findByText('Vista previa: clientes-ventas.csv (2 contactos)')).toBeInTheDocument();
      expect(screen.getByText('+521234567890')).toBeInTheDocument();
      expect(screen.getByText('Ana García')).toBeInTheDocument();
      expect(screen.getByText('+521198765432')).toBeInTheDocument();
      expect(screen.getByText('Luis Pérez')).toBeInTheDocument();
      expect(service.previewRecipientFile).toHaveBeenCalledWith(
        '57777777-7777-4777-8777-777777777777',
      );
    });

    it('despacha la campaña desde un archivo existente', async () => {
      const service = makeService({
        listCampaigns: async () => makePage([makeCampaign()]),
        listRecipientFiles: async () => makePage([makeRecipientFile()]),
        dispatchCampaignFromFile: vi.fn(async () => makeDispatchResult()),
      });
      setOperationsService(service);
      const user = userEvent.setup();

      render(<CampaignsSection config={gap2Config()} />);

      await screen.findByText('Campaña de bienvenida');
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Destinatarios' }));
      });
      await screen.findByText('clientes-ventas.csv');

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Enviar desde archivo' }));
      });

      expect(service.dispatchCampaignFromFile).toHaveBeenCalledWith(
        '54444444-4444-4444-8444-444444444444',
        '57777777-7777-4777-8777-777777777777',
      );
    });

    it('guarda un nuevo archivo de destinatarios desde el CSV pegado', async () => {
      const service = makeService({
        listCampaigns: async () => makePage([makeCampaign()]),
        listRecipientFiles: async () => makePage([]),
        uploadRecipientFile: vi.fn(async () => makeRecipientFile()),
      });
      setOperationsService(service);
      const user = userEvent.setup();

      render(<CampaignsSection config={gap2Config()} />);

      await screen.findByText('Campaña de bienvenida');
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Destinatarios' }));
      });
      await screen.findByText('Envío masivo sobre archivos existentes');

      await user.type(
        screen.getByPlaceholderText(/phone,name\s+5215512345678,Ana García/),
        '5215512345678,Ana García',
      );
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Guardar archivo' }));
      });

      expect(service.uploadRecipientFile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/^archivo-/),
          contentType: 'text/csv',
          rawCsv: '5215512345678,Ana García',
          sourceMeta: { delimiter: ',' },
        }),
      );
    });

    it('valida que el CSV no esté vacío antes de guardar', async () => {
      const service = makeService({
        listCampaigns: async () => makePage([makeCampaign()]),
        listRecipientFiles: async () => makePage([]),
      });
      setOperationsService(service);
      const user = userEvent.setup();

      render(<CampaignsSection config={gap2Config()} />);

      await screen.findByText('Campaña de bienvenida');
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Destinatarios' }));
      });
      await screen.findByText('Envío masivo sobre archivos existentes');

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Guardar archivo' }));
      });

      expect(
        screen.getByText('Pega el contenido CSV o sube un archivo antes de guardarlo.'),
      ).toBeInTheDocument();
      expect(service.uploadRecipientFile).not.toHaveBeenCalled();
    });
  });

  describe('GAP 12 · campaña de recompra vinculada a una landing/pasarela de origen', () => {
    it('muestra las landings reales en el selector y envía el landingId al crear', async () => {
      const landing = makeLanding({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        name: 'Landing Recompra Verano',
      });
      const service = makeService({
        createCampaign: vi.fn(async () =>
          makeCampaign({
            name: 'Campaña de recompra',
            landing_id: landing.id,
          }),
        ),
      });
      const landingService = makeLandingService({
        list: async () => makePage([landing]),
      });
      setOperationsService(service);
      setLandingService(landingService);
      const user = userEvent.setup();

      render(<CampaignsSection config={createTestConfig()} />);

      await screen.findByText('Aún no hay campañas de envío.');
      const select = screen.getByLabelText('Landing / pasarela de origen');
      expect(select).toBeInTheDocument();
      // Las landings reales del tenant se renderizan con su nombre visible.
      expect(screen.getByRole('option', { name: 'Landing Recompra Verano' })).toBeInTheDocument();
      expect(select).toHaveValue('');

      await user.type(screen.getByLabelText('Nombre'), 'Campaña de recompra');
      await user.selectOptions(select, landing.id);

      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
      });

      // El payload envía el landingId de la landing/pasarela seleccionada.
      expect(service.createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ landingId: landing.id }),
      );
      // La tarjeta de la campaña muestra la procedencia (origen) de forma legible.
      expect(await screen.findByText('Origen: Landing Recompra Verano')).toBeInTheDocument();
    });

    it('degrada sin romperse cuando el servicio de landings no está registrado', async () => {
      const service = makeService();
      setOperationsService(service);
      // No se registra setLandingService: el selector se renderiza vacío sin crash.
      render(<CampaignsSection config={createTestConfig()} />);

      await screen.findByText('Aún no hay campañas de envío.');
      const select = screen.getByLabelText('Landing / pasarela de origen');
      expect(select).toBeInTheDocument();
      expect(select).toHaveValue('');
      expect(
        screen.queryByRole('option', { name: 'Landing Recompra Verano' }),
      ).not.toBeInTheDocument();
    });
  });
});
