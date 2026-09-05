/**
 * Pruebas del servicio de captación publicitaria (C-1, eslabón ①).
 *
 * Contrato:
 * - `BackendAdsService` traduce inputs de dominio (camelCase) a los DTO del
 *   backend (snake_case) con los valores por defecto del contrato
 *   (`status='active'`, `enabled=true`) y delega el CRUD en `IApiClient`.
 * - `updateAdCampaign` traduce únicamente los campos presentes (PATCH).
 * - `createAdsService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IAdCampaignRead, IPage } from '@/api/types';
import { BackendAdsService, createAdsService, type IAdCampaignInput } from '@/services/adsService';
import { makeApiClientMock } from '@/test/apiClientMocks';

/** Identificador de campaña publicitaria usado en las pruebas (C-1). */
const AD_CAMPAIGN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Fábrica de `IAdCampaignRead` (DTO exacto del backend, sin `deleted`/`version`). */
function makeAdCampaign(overrides: Partial<IAdCampaignRead> = {}): IAdCampaignRead {
  return {
    id: AD_CAMPAIGN_ID,
    tenant_id: 'tenant-1',
    name: 'Casa vista al lago Tequesquitengo',
    status: 'active',
    enabled: true,
    utm_source: 'meta',
    utm_medium: 'cpc',
    utm_campaign: 'tequesquitengo-lago',
    utm_content: null,
    utm_term: null,
    landing_id: null,
    budget_minor: null,
    start_at: null,
    end_at: null,
    notes: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de una página paginada con los ítems dados. */
function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

describe('BackendAdsService', () => {
  describe('listAdCampaigns', () => {
    it('delega en el cliente con la query de paginación', async () => {
      const page = makePage([makeAdCampaign()]);
      const apiClient = makeApiClientMock();
      apiClient.listAdCampaigns = vi.fn().mockResolvedValue(page);
      const service = new BackendAdsService(apiClient);

      const result = await service.listAdCampaigns({ page: 1 });

      expect(result).toEqual(page);
      expect(apiClient.listAdCampaigns).toHaveBeenCalledWith({ page: 1 });
    });

    it('omite la query cuando no se provee paginación', async () => {
      const page = makePage([]);
      const apiClient = makeApiClientMock();
      apiClient.listAdCampaigns = vi.fn().mockResolvedValue(page);
      const service = new BackendAdsService(apiClient);

      const result = await service.listAdCampaigns();

      expect(result).toEqual(page);
      expect(apiClient.listAdCampaigns).toHaveBeenCalledWith(undefined);
    });
  });

  describe('createAdCampaign', () => {
    it('traduce un input mínimo al payload snake_case con los valores por defecto', async () => {
      const saved = makeAdCampaign();
      const apiClient = makeApiClientMock();
      apiClient.createAdCampaign = vi.fn().mockResolvedValue(saved);
      const service = new BackendAdsService(apiClient);

      const result = await service.createAdCampaign({ name: 'Casa vista al lago' });

      expect(result).toEqual(saved);
      expect(apiClient.createAdCampaign).toHaveBeenCalledWith({
        name: 'Casa vista al lago',
        status: 'active',
        enabled: true,
        utm_source: undefined,
        utm_medium: undefined,
        utm_campaign: undefined,
        utm_content: undefined,
        utm_term: undefined,
        landing_id: undefined,
        budget_minor: undefined,
        start_at: undefined,
        end_at: undefined,
        notes: undefined,
      });
    });

    it('preserva los campos UTM y el presupuesto cuando se proveen', async () => {
      const saved = makeAdCampaign();
      const apiClient = makeApiClientMock();
      apiClient.createAdCampaign = vi.fn().mockResolvedValue(saved);
      const service = new BackendAdsService(apiClient);

      const input: IAdCampaignInput = {
        name: 'Casa vista al lago Tequesquitengo',
        status: 'paused',
        enabled: false,
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'tequesquitengo-lago',
        utmContent: 'creativo-b',
        utmTerm: 'lago',
        landingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        budgetMinor: 15000,
        startAt: '2026-08-01T00:00:00Z',
        endAt: '2026-12-31T00:00:00Z',
        notes: 'Segmento premium.',
      };

      const result = await service.createAdCampaign(input);

      expect(result).toEqual(saved);
      expect(apiClient.createAdCampaign).toHaveBeenCalledWith({
        name: input.name,
        status: 'paused',
        enabled: false,
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'tequesquitengo-lago',
        utm_content: 'creativo-b',
        utm_term: 'lago',
        landing_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        budget_minor: 15000,
        start_at: '2026-08-01T00:00:00Z',
        end_at: '2026-12-31T00:00:00Z',
        notes: 'Segmento premium.',
      });
    });
  });

  describe('getAdCampaign', () => {
    it('delega en el cliente con el identificador', async () => {
      const saved = makeAdCampaign();
      const apiClient = makeApiClientMock();
      apiClient.getAdCampaign = vi.fn().mockResolvedValue(saved);
      const service = new BackendAdsService(apiClient);

      const result = await service.getAdCampaign(AD_CAMPAIGN_ID);

      expect(result).toEqual(saved);
      expect(apiClient.getAdCampaign).toHaveBeenCalledWith(AD_CAMPAIGN_ID);
    });
  });

  describe('updateAdCampaign', () => {
    it('traduce solo los campos presentes al payload snake_case (PATCH)', async () => {
      const saved = makeAdCampaign({ status: 'paused' });
      const apiClient = makeApiClientMock();
      apiClient.updateAdCampaign = vi.fn().mockResolvedValue(saved);
      const service = new BackendAdsService(apiClient);

      const result = await service.updateAdCampaign(AD_CAMPAIGN_ID, { status: 'paused' });

      expect(result).toEqual(saved);
      expect(apiClient.updateAdCampaign).toHaveBeenCalledWith(AD_CAMPAIGN_ID, {
        status: 'paused',
      });
    });

    it('envía un payload vacío cuando no hay campos presentes', async () => {
      const saved = makeAdCampaign();
      const apiClient = makeApiClientMock();
      apiClient.updateAdCampaign = vi.fn().mockResolvedValue(saved);
      const service = new BackendAdsService(apiClient);

      const result = await service.updateAdCampaign(AD_CAMPAIGN_ID, {});

      expect(result).toEqual(saved);
      expect(apiClient.updateAdCampaign).toHaveBeenCalledWith(AD_CAMPAIGN_ID, {});
    });
  });

  describe('deleteAdCampaign', () => {
    it('delega la eliminación lógica en el cliente', async () => {
      const apiClient = makeApiClientMock();
      apiClient.deleteAdCampaign = vi.fn().mockResolvedValue(undefined);
      const service = new BackendAdsService(apiClient);

      await service.deleteAdCampaign(AD_CAMPAIGN_ID);

      expect(apiClient.deleteAdCampaign).toHaveBeenCalledWith(AD_CAMPAIGN_ID);
    });
  });

  describe('createAdsService', () => {
    it('construye la implementación concreta lista para el composition root', () => {
      const apiClient = makeApiClientMock();
      const service = createAdsService(apiClient);

      expect(service).toBeInstanceOf(BackendAdsService);
    });
  });
});
