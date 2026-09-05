/**
 * Pruebas de la sección de dominios personalizados (PSEO hosts).
 *
 * Cubren el registro, verificación DNS y eliminación de dominios sobre el store
 * `useHostsStore` con el servicio inyectado (`setPseoHostService`): estado vacío,
 * validación local del dominio obligatorio, registro, listado con el registro TXT,
 * verificación (pendiente → activo), eliminación y error de carga accesible.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DominiosSection } from '@/components/Dominios/DominiosSection';
import { setPseoHostService, useHostsStore } from '@/store/hostsStore';
import { createTestConfig } from '@/test/config';
import { makeHost, makeHostsService } from '@/test/hostsMocks';

describe('DominiosSection', () => {
  beforeEach(() => {
    useHostsStore.getState().reset();
  });

  afterEach(() => {
    useHostsStore.getState().reset();
    setPseoHostService(null);
  });

  it('muestra el estado vacío y el flujo de verificación DNS', async () => {
    const service = makeHostsService();
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    expect(await screen.findByText('Aún no hay dominios personalizados.')).toBeInTheDocument();
    expect(screen.getByText('Verificación DNS')).toBeInTheDocument();
    expect(service.listPseoHosts).toHaveBeenCalledTimes(1);
  });

  it('valida el dominio obligatorio antes de registrar', async () => {
    const service = makeHostsService();
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    await screen.findByText('Aún no hay dominios personalizados.');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Solicitar dominio' }));
    });

    expect(screen.getByText('El dominio es obligatorio.')).toBeInTheDocument();
    expect(service.requestPseoHost).not.toHaveBeenCalled();
  });

  it('registra un dominio desde el formulario y lo agrega a la lista', async () => {
    const service = makeHostsService({
      requestPseoHost: vi.fn(async () => makeHost()),
    });
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    await screen.findByText('Aún no hay dominios personalizados.');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Dominio'), 'portal.miempresa.com');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Solicitar dominio' }));
    });

    expect(service.requestPseoHost).toHaveBeenCalledWith({ host: 'portal.miempresa.com' });
    expect(await screen.findByText('portal.miempresa.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Dominio')).toHaveValue('');
  });

  it('lista los dominios registrados con su estado y registro TXT', async () => {
    const service = makeHostsService({
      listPseoHosts: async () => [makeHost()],
    });
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    expect(await screen.findByText('portal.miempresa.com')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('_omni2-verify.portal.miempresa.com')).toBeInTheDocument();
    expect(screen.getByText('tok-1')).toBeInTheDocument();
  });

  it('verifica un dominio pendiente y lo activa', async () => {
    const service = makeHostsService({
      listPseoHosts: async () => [makeHost()],
      verifyPseoHost: vi.fn(async () =>
        makeHost({ status: 'active', verified_at: '2026-08-19T00:00:00Z' }),
      ),
    });
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    await screen.findByText('portal.miempresa.com');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Verificar' }));
    });

    expect(service.verifyPseoHost).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await screen.findByText('Activo')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verificar' })).not.toBeInTheDocument();
  });

  it('elimina un dominio y vuelve al estado vacío', async () => {
    const service = makeHostsService({
      listPseoHosts: async () => [makeHost()],
    });
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    await screen.findByText('portal.miempresa.com');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deletePseoHost).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await screen.findByText('Aún no hay dominios personalizados.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeHostsService({
      listPseoHosts: async () => {
        throw 'x';
      },
    });
    setPseoHostService(service);
    render(<DominiosSection config={createTestConfig()} />);

    expect(
      await screen.findByText('No se pudieron cargar los dominios personalizados.'),
    ).toBeInTheDocument();
  });
});
