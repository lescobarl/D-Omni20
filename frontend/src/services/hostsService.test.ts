/**
 * Pruebas del servicio de dominios personalizados (PSEO hosts).
 *
 * Contrato:
 * - `BackendPseoHostService` delega el CRUD en `IApiClient`, traduciendo el input
 *   de dominio (`{ host }`) al DTO del backend (`IPseoHostRequest`). No hay
 *   traducción camelCase ↔ snake_case adicional porque el único campo del payload
 *   (`host`) mantiene el mismo nombre en ambos lados.
 * - El backend devuelve `GET /pseo/hosts` como un **arreglo plano**
 *   (`list[PseoHostRead]`, NO paginado): `listPseoHosts` no acepta `IPageQuery`
 *   y devuelve directamente `IPseoHostRead[]`.
 * - `createPseoHostService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BackendPseoHostService,
  createPseoHostService,
  type IPseoHostInput,
} from '@/services/hostsService';
import { makeApiClientMock } from '@/test/apiClientMocks';
import { makeHost } from '@/test/hostsMocks';

/** Identificador de dominio personalizado usado en las pruebas. */
const HOST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('BackendPseoHostService', () => {
  describe('listPseoHosts', () => {
    it('delega en el cliente y devuelve el arreglo plano de dominios', async () => {
      const hosts = [makeHost()];
      const apiClient = makeApiClientMock();
      apiClient.listPseoHosts = vi.fn().mockResolvedValue(hosts);
      const service = new BackendPseoHostService(apiClient);

      const result = await service.listPseoHosts();

      expect(result).toEqual(hosts);
      expect(apiClient.listPseoHosts).toHaveBeenCalledTimes(1);
    });

    it('devuelve un arreglo vacío cuando el tenant no tiene dominios', async () => {
      const apiClient = makeApiClientMock();
      apiClient.listPseoHosts = vi.fn().mockResolvedValue([]);
      const service = new BackendPseoHostService(apiClient);

      const result = await service.listPseoHosts();

      expect(result).toEqual([]);
      expect(apiClient.listPseoHosts).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestPseoHost', () => {
    it('traduce el input de dominio al DTO del backend', async () => {
      const saved = makeHost();
      const apiClient = makeApiClientMock();
      apiClient.requestPseoHost = vi.fn().mockResolvedValue(saved);
      const service = new BackendPseoHostService(apiClient);

      const input: IPseoHostInput = { host: 'portal.miempresa.com' };
      const result = await service.requestPseoHost(input);

      expect(result).toEqual(saved);
      expect(apiClient.requestPseoHost).toHaveBeenCalledWith({ host: 'portal.miempresa.com' });
    });
  });

  describe('verifyPseoHost', () => {
    it('delega en el cliente con el identificador del dominio', async () => {
      const verified = makeHost({ status: 'active', verified_at: '2026-08-19T00:00:00Z' });
      const apiClient = makeApiClientMock();
      apiClient.verifyPseoHost = vi.fn().mockResolvedValue(verified);
      const service = new BackendPseoHostService(apiClient);

      const result = await service.verifyPseoHost(HOST_ID);

      expect(result).toEqual(verified);
      expect(apiClient.verifyPseoHost).toHaveBeenCalledWith(HOST_ID);
    });
  });

  describe('deletePseoHost', () => {
    it('delega la eliminación lógica en el cliente', async () => {
      const apiClient = makeApiClientMock();
      apiClient.deletePseoHost = vi.fn().mockResolvedValue(undefined);
      const service = new BackendPseoHostService(apiClient);

      await service.deletePseoHost(HOST_ID);

      expect(apiClient.deletePseoHost).toHaveBeenCalledWith(HOST_ID);
    });
  });

  describe('createPseoHostService', () => {
    it('construye la implementación concreta lista para el composition root', () => {
      const apiClient = makeApiClientMock();
      const service = createPseoHostService(apiClient);

      expect(service).toBeInstanceOf(BackendPseoHostService);
    });
  });
});
