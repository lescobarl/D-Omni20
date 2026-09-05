import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChannelsSection } from '@/components/Settings/ChannelsSection';
import { setTenantConfigService, useTenantConfigStore } from '@/store/tenantConfigStore';
import { makeChannel, makePage, makeService } from '@/test/tenantConfigMocks';

describe('ChannelsSection', () => {
  beforeEach(() => {
    useTenantConfigStore.getState().reset();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useTenantConfigStore.getState().reset();
    setTenantConfigService(null);
    document.documentElement.removeAttribute('style');
  });

  it('muestra el estado vacío cuando no hay canales conectados', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<ChannelsSection />);

    expect(await screen.findByText('Aún no hay canales conectados.')).toBeInTheDocument();
    expect(service.listChannels).toHaveBeenCalledTimes(1);
  });

  it('valida el número de teléfono obligatorio', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ChannelsSection />);

    await screen.findByRole('form', { name: 'Conectar canal de WhatsApp' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Conectar canal' }));
    });

    expect(screen.getByText('El número de teléfono es obligatorio.')).toBeInTheDocument();
    expect(service.createChannel).not.toHaveBeenCalled();
  });

  it('crea un canal de WhatsApp con todos los datos opcionales', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ChannelsSection />);

    await screen.findByRole('form', { name: 'Conectar canal de WhatsApp' });
    await user.type(screen.getByLabelText('Número de teléfono *'), '5215512345678');
    await user.type(screen.getByLabelText('Identificador externo'), 'wa-123');
    await user.type(screen.getByLabelText('ID del número de teléfono (Meta)'), '10293847561234567');
    await user.type(screen.getByLabelText('Token de acceso'), 'EAAG123');
    await user.type(screen.getByLabelText('Secreto del webhook'), 'secret');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Conectar canal' }));
    });

    expect(service.createChannel).toHaveBeenCalledWith({
      phoneNumber: '5215512345678',
      externalId: 'wa-123',
      phoneNumberId: '10293847561234567',
      accessToken: 'EAAG123',
      webhookSecret: 'secret',
      enabled: true,
    });
  });

  it('crea un canal solo con el teléfono omitiendo los opcionales', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ChannelsSection />);

    await screen.findByRole('form', { name: 'Conectar canal de WhatsApp' });
    await user.type(screen.getByLabelText('Número de teléfono *'), '5215512345678');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Conectar canal' }));
    });

    expect(service.createChannel).toHaveBeenCalledWith({
      phoneNumber: '5215512345678',
      externalId: undefined,
      phoneNumberId: undefined,
      accessToken: undefined,
      webhookSecret: undefined,
      enabled: true,
    });
  });

  it('avisa que los tokens y secretos son write-only', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<ChannelsSection />);

    expect(
      await screen.findByText(
        'Los tokens y secretos son write-only: se almacenan cifrados y nunca se muestran de nuevo.',
      ),
    ).toBeInTheDocument();
  });

  it('lista los canales conectados con sus datos', async () => {
    const service = makeService({ listChannels: async () => makePage([makeChannel()]) });
    setTenantConfigService(service);

    render(<ChannelsSection />);

    expect(await screen.findByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('+521234567890')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('ID externo: —')).toBeInTheDocument();
    expect(screen.getByText('ID de Meta: —')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
  });

  it('desconecta un canal alternando el estado habilitado', async () => {
    const service = makeService({ listChannels: async () => makePage([makeChannel()]) });
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ChannelsSection />);

    await screen.findByText('Conectado');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Desconectar' }));
    });

    expect(service.updateChannel).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', {
      enabled: false,
    });
  });

  it('elimina un canal', async () => {
    const service = makeService({ listChannels: async () => makePage([makeChannel()]) });
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ChannelsSection />);

    await screen.findByText('Conectado');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteChannel).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listChannels: async () => {
        throw 'x';
      },
    });
    setTenantConfigService(service);

    render(<ChannelsSection />);

    expect(await screen.findByText('No se pudieron cargar los canales.')).toBeInTheDocument();
  });
});
