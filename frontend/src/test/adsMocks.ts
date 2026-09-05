/**
 * Helpers de prueba compartidos para la captación publicitaria (C-1, eslabón ①).
 *
 * Contrato:
 * - Centraliza las factorías de DTOs y el servicio mock (`IAdsService`) para
 *   reutilizarlos en las pruebas del store y del componente de captación (Ads).
 * - Cada factoría acepta overrides parciales para construir casos específicos.
 * - `IAdCampaignRead` es independiente de `IConfigSyncFields`: el backend NO
 *   expone `deleted` ni `version`, solo `revision`/`updated_at`/`created_at`.
 */
import { vi } from 'vitest';
import type { IAdCampaignRead, ILandingRead, IPage } from '@/api/types';
import type { IAdsService } from '@/services/adsService';
import type { ILandingService } from '@/services/landingService';

/** Construye una campaña publicitaria leída del backend (C-1, eslabón ①). */
export function makeAdCampaign(overrides: Partial<IAdCampaignRead> = {}): IAdCampaignRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

/** Construye una página del backend con los ítems dados. */
export function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye un servicio de captación publicitaria con todas las dependencias mockeadas. */
export function makeAdsService(overrides: Partial<IAdsService> = {}): IAdsService {
  return {
    listAdCampaigns: vi.fn<IAdsService['listAdCampaigns']>().mockResolvedValue(makePage([])),
    createAdCampaign: vi.fn<IAdsService['createAdCampaign']>().mockResolvedValue(makeAdCampaign()),
    getAdCampaign: vi.fn<IAdsService['getAdCampaign']>().mockResolvedValue(makeAdCampaign()),
    updateAdCampaign: vi.fn<IAdsService['updateAdCampaign']>().mockResolvedValue(makeAdCampaign()),
    deleteAdCampaign: vi.fn<IAdsService['deleteAdCampaign']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Construye una landing leída del backend (para el selector de destino). */
export function makeLanding(overrides: Partial<ILandingRead> = {}): ILandingRead {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tenant_id: 'tenant-1',
    campaign_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Landing de Prueba',
    config: { title: 'Landing de Prueba', workflowType: 'direct_checkout', blocks: [] },
    compiled_html: null,
    published: false,
    published_at: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio de landings con todas las dependencias mockeadas. */
export function makeLandingService(overrides: Partial<ILandingService> = {}): ILandingService {
  return {
    list: vi.fn<ILandingService['list']>().mockResolvedValue(makePage([])),
    get: vi.fn<ILandingService['get']>().mockResolvedValue(makeLanding()),
    create: vi.fn<ILandingService['create']>().mockResolvedValue(makeLanding()),
    update: vi.fn<ILandingService['update']>().mockResolvedValue(makeLanding()),
    delete: vi.fn<ILandingService['delete']>().mockResolvedValue(undefined),
    publish: vi.fn<ILandingService['publish']>().mockResolvedValue(makeLanding()),
    compile: vi.fn<ILandingService['compile']>().mockResolvedValue({
      html: '',
      compiled_at: '2026-08-18T00:00:00Z',
      duration_ms: 0,
    }),
    generate: vi.fn<ILandingService['generate']>().mockResolvedValue({
      config: {},
      model: 'mock',
      cached: false,
      prompt_tokens: 0,
      completion_tokens: 0,
      generated_at: '2026-08-18T00:00:00Z',
    }),
    ...overrides,
  };
}
