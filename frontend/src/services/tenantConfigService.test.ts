/**
 * Pruebas del servicio de configuración del tenant para el bot.
 *
 * Contrato:
 * - `BackendTenantConfigService` traduce inputs de dominio (camelCase) a los DTO
 *   del backend (snake_case) y devuelve lecturas normalizadas al dominio.
 * - `getTenantAppearance` devuelve `null` ante HTTP 404 (tenant sin apariencia)
 *   y propaga cualquier otro error sin envolverlo.
 * - `createTenantConfigService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiHttpError, ApiNetworkError } from '@/api/errors';
import type {
  ICatalogItemRead,
  IContentItemRead,
  IPage,
  IPageQuery,
  ITenantAppearanceRead,
  ITenantChannelRead,
} from '@/api/types';
import type { IAppTheme } from '@/types/config';
import {
  BackendTenantConfigService,
  createTenantConfigService,
  type IContentItemInput,
  type ICatalogItemInput,
  type ITenantChannelInput,
} from '@/services/tenantConfigService';
import { makeApiClientMock } from '@/test/apiClientMocks';

/** Fábrica de `ITenantAppearanceRead` (DTO exacto del backend, incluye versión). */
function makeAppearanceRead(overrides: Partial<ITenantAppearanceRead> = {}): ITenantAppearanceRead {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-1',
    primary_color: '#10b981',
    accent_color: '#3b82f6',
    surface_color: '#ffffff',
    text_color: '#0f172a',
    brand_badge: 'OmniBotIA',
    logo_url: 'https://cdn.omnibotia.example/logo.png',
    font_family: 'Inter',
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IContentItemRead` (DTO exacto del backend, incluye versión). */
function makeContentItem(overrides: Partial<IContentItemRead> = {}): IContentItemRead {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: 'tenant-1',
    kind: 'faq',
    title: '¿Cómo funcionan los envíos?',
    content: 'Respuesta',
    tags: ['ventas'],
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `ICatalogItemRead` (DTO exacto del backend, incluye versión). */
function makeCatalogItem(overrides: Partial<ICatalogItemRead> = {}): ICatalogItemRead {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'tenant-1',
    sku: 'SKU-001',
    name: 'Consultoría OmniBotIA',
    description: null,
    price: 99.9,
    currency: 'usd',
    available: true,
    metadata: { featured: true },
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `ITenantChannelRead` (DTO exacto: NO incluye versión). */
function makeChannel(overrides: Partial<ITenantChannelRead> = {}): ITenantChannelRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'tenant-1',
    channel_type: 'whatsapp',
    external_id: null,
    phone_number: '+521234567890',
    phone_number_id: null,
    enabled: true,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IPage<T>` (respuesta paginada del backend). */
function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

describe('BackendTenantConfigService', () => {
  describe('getTenantAppearance', () => {
    it('traduce la apariencia snake_case del backend al tema de dominio', async () => {
      const apiClient = makeApiClientMock();
      apiClient.getTenantAppearance = vi.fn().mockResolvedValue(makeAppearanceRead());
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.getTenantAppearance();

      expect(apiClient.getTenantAppearance).toHaveBeenCalledWith();
      expect(result).toEqual({
        primaryColor: '#10b981',
        accentColor: '#3b82f6',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
        brandBadge: 'OmniBotIA',
        logoUrl: 'https://cdn.omnibotia.example/logo.png',
        fontFamily: 'Inter',
      });
    });

    it('omite logo y tipografía cuando el backend no los define', async () => {
      const apiClient = makeApiClientMock();
      apiClient.getTenantAppearance = vi
        .fn()
        .mockResolvedValue(makeAppearanceRead({ logo_url: undefined, font_family: undefined }));
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.getTenantAppearance();

      expect(result).toEqual({
        primaryColor: '#10b981',
        accentColor: '#3b82f6',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
        brandBadge: 'OmniBotIA',
        logoUrl: undefined,
        fontFamily: undefined,
      });
    });

    it('devuelve null ante 404 (el tenant aún no configuró apariencia)', async () => {
      const notFound = new ApiHttpError('No encontrado', 'tenant.appearance.get', 404, {
        detail: 'not found',
      });
      const apiClient = makeApiClientMock();
      apiClient.getTenantAppearance = vi.fn().mockRejectedValue(notFound);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.getTenantAppearance();

      expect(result).toBeNull();
    });

    it('propaga errores que no son 404 sin envolverlos', async () => {
      const networkError = new ApiNetworkError('tenant.appearance.get');
      const apiClient = makeApiClientMock();
      apiClient.getTenantAppearance = vi.fn().mockRejectedValue(networkError);
      const service = new BackendTenantConfigService(apiClient);

      await expect(service.getTenantAppearance()).rejects.toBe(networkError);
    });
  });

  describe('saveTenantAppearance', () => {
    it('traduce el tema de dominio al payload snake_case completo', async () => {
      const saved = makeAppearanceRead();
      const apiClient = makeApiClientMock();
      apiClient.upsertTenantAppearance = vi.fn().mockResolvedValue(saved);
      const service = new BackendTenantConfigService(apiClient);
      const theme: IAppTheme = {
        primaryColor: '#10b981',
        accentColor: '#3b82f6',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
        brandBadge: 'OmniBotIA',
        logoUrl: 'https://cdn.omnibotia.example/logo.png',
        fontFamily: 'Inter',
      };

      const result = await service.saveTenantAppearance(theme);

      expect(apiClient.upsertTenantAppearance).toHaveBeenCalledWith({
        primary_color: '#10b981',
        accent_color: '#3b82f6',
        surface_color: '#ffffff',
        text_color: '#0f172a',
        brand_badge: 'OmniBotIA',
        logo_url: 'https://cdn.omnibotia.example/logo.png',
        font_family: 'Inter',
      });
      expect(result).toEqual(saved);
    });

    it('envía logo y tipografía explícitamente indefinidos cuando faltan', async () => {
      const apiClient = makeApiClientMock();
      apiClient.upsertTenantAppearance = vi.fn().mockResolvedValue(makeAppearanceRead());
      const service = new BackendTenantConfigService(apiClient);
      const theme: IAppTheme = {
        primaryColor: '#ef4444',
        accentColor: '#3b82f6',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
        brandBadge: 'OmniBotIA',
      };

      await service.saveTenantAppearance(theme);

      expect(apiClient.upsertTenantAppearance).toHaveBeenCalledWith({
        primary_color: '#ef4444',
        accent_color: '#3b82f6',
        surface_color: '#ffffff',
        text_color: '#0f172a',
        brand_badge: 'OmniBotIA',
        logo_url: undefined,
        font_family: undefined,
      });
    });
  });

  describe('contenido', () => {
    it('lista el contenido del tenant con la query de paginación', async () => {
      const page = makePage([makeContentItem()]);
      const query: IPageQuery = { page: 2, page_size: 10 };
      const apiClient = makeApiClientMock();
      apiClient.listContentItems = vi.fn().mockResolvedValue(page);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.listContentItems(query);

      expect(apiClient.listContentItems).toHaveBeenCalledWith(query);
      expect(result).toEqual(page);
    });

    it('crea un ítem de contenido con contenido y etiquetas por defecto', async () => {
      const created = makeContentItem();
      const apiClient = makeApiClientMock();
      apiClient.createContentItem = vi.fn().mockResolvedValue(created);
      const service = new BackendTenantConfigService(apiClient);
      const input: IContentItemInput = { kind: 'faq', title: '¿Cómo funcionan los envíos?' };

      const result = await service.createContentItem(input);

      expect(apiClient.createContentItem).toHaveBeenCalledWith({
        kind: 'faq',
        title: '¿Cómo funcionan los envíos?',
        content: '',
        tags: [],
      });
      expect(result).toEqual(created);
    });

    it('crea un ítem de contenido con valores explícitos', async () => {
      const created = makeContentItem({ kind: 'rule', title: 'Horario', tags: ['reglas'] });
      const apiClient = makeApiClientMock();
      apiClient.createContentItem = vi.fn().mockResolvedValue(created);
      const service = new BackendTenantConfigService(apiClient);
      const input: IContentItemInput = {
        kind: 'rule',
        title: 'Horario',
        content: 'Lunes a viernes 9-18',
        tags: ['reglas'],
      };

      await service.createContentItem(input);

      expect(apiClient.createContentItem).toHaveBeenCalledWith({
        kind: 'rule',
        title: 'Horario',
        content: 'Lunes a viernes 9-18',
        tags: ['reglas'],
      });
    });

    it('devuelve un ítem de contenido por su identificador', async () => {
      const item = makeContentItem();
      const apiClient = makeApiClientMock();
      apiClient.getContentItem = vi.fn().mockResolvedValue(item);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.getContentItem(item.id);

      expect(apiClient.getContentItem).toHaveBeenCalledWith(item.id);
      expect(result).toEqual(item);
    });

    it('actualiza solo los campos presentes de un ítem de contenido', async () => {
      const updated = makeContentItem({ title: 'Nuevo título' });
      const apiClient = makeApiClientMock();
      apiClient.updateContentItem = vi.fn().mockResolvedValue(updated);
      const service = new BackendTenantConfigService(apiClient);

      await service.updateContentItem(updated.id, { title: 'Nuevo título' });

      expect(apiClient.updateContentItem).toHaveBeenCalledWith(updated.id, {
        title: 'Nuevo título',
      });
    });

    it('elimina un ítem de contenido delegando en el cliente', async () => {
      const itemId = '22222222-2222-4222-8222-222222222222';
      const apiClient = makeApiClientMock();
      apiClient.deleteContentItem = vi.fn().mockResolvedValue(undefined);
      const service = new BackendTenantConfigService(apiClient);

      await service.deleteContentItem(itemId);

      expect(apiClient.deleteContentItem).toHaveBeenCalledWith(itemId);
    });
  });

  describe('catálogo', () => {
    it('lista el catálogo del tenant con la query de paginación', async () => {
      const page = makePage([makeCatalogItem()]);
      const query: IPageQuery = { page: 1, page_size: 50 };
      const apiClient = makeApiClientMock();
      apiClient.listCatalogItems = vi.fn().mockResolvedValue(page);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.listCatalogItems(query);

      expect(apiClient.listCatalogItems).toHaveBeenCalledWith(query);
      expect(result).toEqual(page);
    });

    it('crea un ítem del catálogo con descripción, moneda, disponibilidad y metadata por defecto', async () => {
      const created = makeCatalogItem();
      const apiClient = makeApiClientMock();
      apiClient.createCatalogItem = vi.fn().mockResolvedValue(created);
      const service = new BackendTenantConfigService(apiClient);
      const input: ICatalogItemInput = {
        sku: 'SKU-001',
        name: 'Consultoría OmniBotIA',
        price: 99.9,
      };

      const result = await service.createCatalogItem(input);

      expect(apiClient.createCatalogItem).toHaveBeenCalledWith({
        sku: 'SKU-001',
        name: 'Consultoría OmniBotIA',
        description: undefined,
        price: 99.9,
        currency: 'usd',
        available: true,
        metadata: {},
      });
      expect(result).toEqual(created);
    });

    it('crea un ítem del catálogo con valores explícitos', async () => {
      const apiClient = makeApiClientMock();
      apiClient.createCatalogItem = vi.fn().mockResolvedValue(makeCatalogItem());
      const service = new BackendTenantConfigService(apiClient);
      const input: ICatalogItemInput = {
        sku: 'SKU-002',
        name: 'Soporte premium',
        description: 'Soporte prioritario',
        price: 150,
        currency: 'mxn',
        available: false,
        metadata: { plan: 'premium' },
      };

      await service.createCatalogItem(input);

      expect(apiClient.createCatalogItem).toHaveBeenCalledWith({
        sku: 'SKU-002',
        name: 'Soporte premium',
        description: 'Soporte prioritario',
        price: 150,
        currency: 'mxn',
        available: false,
        metadata: { plan: 'premium' },
      });
    });

    it('devuelve un ítem del catálogo por su identificador', async () => {
      const item = makeCatalogItem();
      const apiClient = makeApiClientMock();
      apiClient.getCatalogItem = vi.fn().mockResolvedValue(item);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.getCatalogItem(item.id);

      expect(apiClient.getCatalogItem).toHaveBeenCalledWith(item.id);
      expect(result).toEqual(item);
    });

    it('actualiza solo los campos presentes de un ítem del catálogo', async () => {
      const itemId = '33333333-3333-4333-8333-333333333333';
      const updated = makeCatalogItem({ price: 150, metadata: { a: 1 } });
      const apiClient = makeApiClientMock();
      apiClient.updateCatalogItem = vi.fn().mockResolvedValue(updated);
      const service = new BackendTenantConfigService(apiClient);

      await service.updateCatalogItem(itemId, { price: 150, metadata: { a: 1 } });

      expect(apiClient.updateCatalogItem).toHaveBeenCalledWith(itemId, {
        price: 150,
        metadata: { a: 1 },
      });
    });

    it('elimina un ítem del catálogo delegando en el cliente', async () => {
      const itemId = '33333333-3333-4333-8333-333333333333';
      const apiClient = makeApiClientMock();
      apiClient.deleteCatalogItem = vi.fn().mockResolvedValue(undefined);
      const service = new BackendTenantConfigService(apiClient);

      await service.deleteCatalogItem(itemId);

      expect(apiClient.deleteCatalogItem).toHaveBeenCalledWith(itemId);
    });
  });

  describe('canales', () => {
    it('lista los canales del bot con la query de paginación', async () => {
      const page = makePage([makeChannel()]);
      const query: IPageQuery = { page: 1, page_size: 10 };
      const apiClient = makeApiClientMock();
      apiClient.listChannels = vi.fn().mockResolvedValue(page);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.listChannels(query);

      expect(apiClient.listChannels).toHaveBeenCalledWith(query);
      expect(result).toEqual(page);
    });

    it('crea un canal con tipo, externos y habilitado por defecto', async () => {
      const created = makeChannel();
      const apiClient = makeApiClientMock();
      apiClient.createChannel = vi.fn().mockResolvedValue(created);
      const service = new BackendTenantConfigService(apiClient);
      const input: ITenantChannelInput = { phoneNumber: '+521234567890' };

      const result = await service.createChannel(input);

      expect(apiClient.createChannel).toHaveBeenCalledWith({
        channel_type: 'whatsapp',
        external_id: undefined,
        phone_number: '+521234567890',
        phone_number_id: undefined,
        access_token: undefined,
        webhook_secret: undefined,
        enabled: true,
      });
      expect(result).toEqual(created);
    });

    it('crea un canal con todos los datos opcionales', async () => {
      const apiClient = makeApiClientMock();
      apiClient.createChannel = vi.fn().mockResolvedValue(makeChannel());
      const service = new BackendTenantConfigService(apiClient);
      const input: ITenantChannelInput = {
        channelType: 'whatsapp',
        externalId: 'WA-123',
        phoneNumber: '+521234567890',
        phoneNumberId: '107262793025103',
        accessToken: 'token-secreto',
        webhookSecret: 'webhook-secreto',
        enabled: false,
      };

      await service.createChannel(input);

      expect(apiClient.createChannel).toHaveBeenCalledWith({
        channel_type: 'whatsapp',
        external_id: 'WA-123',
        phone_number: '+521234567890',
        phone_number_id: '107262793025103',
        access_token: 'token-secreto',
        webhook_secret: 'webhook-secreto',
        enabled: false,
      });
    });

    it('devuelve un canal por su identificador', async () => {
      const channel = makeChannel();
      const apiClient = makeApiClientMock();
      apiClient.getChannel = vi.fn().mockResolvedValue(channel);
      const service = new BackendTenantConfigService(apiClient);

      const result = await service.getChannel(channel.id);

      expect(apiClient.getChannel).toHaveBeenCalledWith(channel.id);
      expect(result).toEqual(channel);
    });

    it('actualiza parcialmente un canal (PATCH) con solo los campos presentes', async () => {
      const channelId = '44444444-4444-4444-8444-444444444444';
      const updated = makeChannel({ enabled: false });
      const apiClient = makeApiClientMock();
      apiClient.updateChannel = vi.fn().mockResolvedValue(updated);
      const service = new BackendTenantConfigService(apiClient);

      await service.updateChannel(channelId, { enabled: false });

      expect(apiClient.updateChannel).toHaveBeenCalledWith(channelId, { enabled: false });
    });

    it('elimina un canal delegando en el cliente', async () => {
      const channelId = '44444444-4444-4444-8444-444444444444';
      const apiClient = makeApiClientMock();
      apiClient.deleteChannel = vi.fn().mockResolvedValue(undefined);
      const service = new BackendTenantConfigService(apiClient);

      await service.deleteChannel(channelId);

      expect(apiClient.deleteChannel).toHaveBeenCalledWith(channelId);
    });
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiError = new ApiNetworkError('content.list');
    const apiClient = makeApiClientMock();
    apiClient.listContentItems = vi.fn().mockRejectedValue(apiError);
    const service = new BackendTenantConfigService(apiClient);

    await expect(service.listContentItems()).rejects.toBe(apiError);
  });
});

describe('createTenantConfigService', () => {
  it('construye una implementación BackendTenantConfigService desde el cliente', () => {
    const apiClient = makeApiClientMock();

    const service = createTenantConfigService(apiClient);

    expect(service).toBeInstanceOf(BackendTenantConfigService);
  });

  it('delega en el cliente inyectado durante la carga de contenido', async () => {
    const page = makePage([makeContentItem()]);
    const apiClient = makeApiClientMock();
    apiClient.listContentItems = vi.fn().mockResolvedValue(page);

    const service = createTenantConfigService(apiClient);
    const result = await service.listContentItems();

    expect(result).toEqual(page);
  });
});
