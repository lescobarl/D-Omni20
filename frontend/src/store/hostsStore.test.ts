/**
 * Pruebas del store de dominios personalizados (PSEO hosts) — registro, verificación
 * DNS y activación de los dominios propios del tenant para el serving público.
 *
 * Contrato:
 * - Usa las factorías compartidas de `@/test/hostsMocks` para construir DTOs y
 *   el servicio mock (`IPseoHostService`), evitando duplicación en cada prueba.
 * - El flujo se aísla por colección: el store mantiene estado de carga/error
 *   independiente, por lo que el `describe` verifica solo su propia colección.
 * - El backend devuelve `GET /pseo/hosts` como un **arreglo plano**, por lo que
 *   `listPseoHosts` asigna `hosts: hosts` directamente (sin `.items` de página).
 * - `afterEach` desregistra el servicio para que las pruebas siguientes empiecen
 *   sin dependencia (estado de error estable al no haber servicio registrado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { setPseoHostService, useHostsStore } from '@/store/hostsStore';
import type { IPseoHostInput, IPseoHostService } from '@/services/hostsService';
import { makeHost, makeHostsService } from '@/test/hostsMocks';

describe('hostsStore', () => {
  beforeEach(() => {
    useHostsStore.getState().reset();
  });

  afterEach(() => {
    useHostsStore.getState().reset();
    setPseoHostService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useHostsStore.getState();
    expect(state.hosts).toEqual([]);
    expect(state.hostsStatus).toBe('idle');
    expect(state.hostsError).toBeNull();
  });

  describe('dominios personalizados', () => {
    it('carga los dominios personalizados del tenant (arreglo plano)', async () => {
      const listPseoHosts = vi
        .fn<IPseoHostService['listPseoHosts']>()
        .mockResolvedValue([makeHost()]);
      setPseoHostService(makeHostsService({ listPseoHosts }));

      await useHostsStore.getState().listPseoHosts();

      expect(listPseoHosts).toHaveBeenCalledTimes(1);
      expect(useHostsStore.getState().hosts).toEqual([makeHost()]);
      expect(useHostsStore.getState().hostsStatus).toBe('success');
    });

    it('registra un dominio personalizado y lo agrega a la colección', async () => {
      const created = makeHost({ host: 'portal.nuevaempresa.com' });
      const requestPseoHost = vi
        .fn<IPseoHostService['requestPseoHost']>()
        .mockResolvedValue(created);
      setPseoHostService(makeHostsService({ requestPseoHost }));

      const input: IPseoHostInput = { host: 'portal.nuevaempresa.com' };
      await useHostsStore.getState().requestPseoHost(input);

      expect(requestPseoHost).toHaveBeenCalledWith(input);
      expect(useHostsStore.getState().hosts).toEqual([created]);
    });

    it('verifica un dominio personalizado reemplazándolo en la colección', async () => {
      const original = makeHost();
      useHostsStore.setState({ hosts: [original] });
      const verified = makeHost({ status: 'active', verified_at: '2026-08-19T00:00:00Z' });
      const verifyPseoHost = vi
        .fn<IPseoHostService['verifyPseoHost']>()
        .mockResolvedValue(verified);
      setPseoHostService(makeHostsService({ verifyPseoHost }));

      await useHostsStore.getState().verifyPseoHost(original.id);

      expect(verifyPseoHost).toHaveBeenCalledWith(original.id);
      expect(useHostsStore.getState().hosts).toEqual([verified]);
    });

    it('elimina un dominio personalizado y lo quita de la colección', async () => {
      const toRemove = makeHost();
      useHostsStore.setState({
        hosts: [
          toRemove,
          makeHost({ id: '99999999-9999-4999-8999-999999999999', host: 'portal.otra.com' }),
        ],
      });
      const deletePseoHost = vi
        .fn<IPseoHostService['deletePseoHost']>()
        .mockResolvedValue(undefined);
      setPseoHostService(makeHostsService({ deletePseoHost }));

      await useHostsStore.getState().deletePseoHost(toRemove.id);

      expect(deletePseoHost).toHaveBeenCalledWith(toRemove.id);
      expect(useHostsStore.getState().hosts).toHaveLength(1);
    });

    it('degrade a error cuando falla la carga de dominios personalizados', async () => {
      const listPseoHosts = vi.fn<IPseoHostService['listPseoHosts']>().mockRejectedValue('fallo');
      setPseoHostService(makeHostsService({ listPseoHosts }));

      await useHostsStore.getState().listPseoHosts();

      expect(useHostsStore.getState().hostsStatus).toBe('error');
      expect(useHostsStore.getState().hostsError).toBe(
        'No se pudieron cargar los dominios personalizados.',
      );
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const listPseoHosts = vi.fn<IPseoHostService['listPseoHosts']>().mockRejectedValue(
        new AppError('Fallo al listar dominios personalizados', 'pseo.hosts.list', {
          status: 500,
        }),
      );
      setPseoHostService(makeHostsService({ listPseoHosts }));

      await useHostsStore.getState().listPseoHosts();

      expect(useHostsStore.getState().hostsStatus).toBe('error');
      expect(useHostsStore.getState().hostsError).toBe('Fallo al listar dominios personalizados');
    });

    it('propaga el mensaje de un Error genérico del servicio', async () => {
      const listPseoHosts = vi
        .fn<IPseoHostService['listPseoHosts']>()
        .mockRejectedValue(new Error('Red caída'));
      setPseoHostService(makeHostsService({ listPseoHosts }));

      await useHostsStore.getState().listPseoHosts();

      expect(useHostsStore.getState().hostsStatus).toBe('error');
      expect(useHostsStore.getState().hostsError).toBe('Red caída');
    });

    it('degrade a error en dominios personalizados sin servicio registrado', async () => {
      await useHostsStore.getState().requestPseoHost({ host: 'portal.sin-servicio.com' });

      expect(useHostsStore.getState().hostsStatus).toBe('error');
      expect(useHostsStore.getState().hostsError).toBe(
        'La sección de dominios personalizados no está disponible.',
      );
    });
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useHostsStore.setState({
      hosts: [makeHost()],
      hostsStatus: 'success',
      hostsError: 'error residual',
    });

    useHostsStore.getState().reset();

    const state = useHostsStore.getState();
    expect(state.hosts).toEqual([]);
    expect(state.hostsStatus).toBe('idle');
    expect(state.hostsError).toBeNull();
  });
});
