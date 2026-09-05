/**
 * Pruebas del store de configuración del tenant para el bot (apariencia, contenido,
 * catálogo y canales).
 *
 * Contrato:
 * - El registro de servicios por DI (`setTenantConfigService`/`getTenantConfigService`)
 *   permite inyectar la implementación `ITenantConfigService` sin acoplar el store.
 * - `loadAppearance` materializa la paleta vía `applyTheme` sobre la raíz del documento;
 *   ante `null` (404) aplica `DEFAULT_THEME` como fallback.
 * - Cada colección mantiene su propio estado `idle | loading | success | error`.
 * - Sin servicio registrado el store degrada a estado de error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setRebrandingService,
  setTenantConfigService,
  useTenantConfigStore,
} from '@/store/tenantConfigStore';
import { AppError } from '@/lib/errors';
import type {
  IAppearanceProposal,
  ICatalogItemRead,
  IContentItemRead,
  IPage,
  ITenantAppearanceRead,
  ITenantChannelRead,
} from '@/api/types';
import type {
  ICatalogItemInput,
  IContentItemInput,
  ITenantChannelInput,
  ITenantConfigService,
} from '@/services/tenantConfigService';
import type { IRebrandingService } from '@/services/rebrandingService';
import type { IAppTheme } from '@/types/config';
import {
  makeAppearanceProposal,
  makeRebrandingConfig,
  makeRebrandingService,
} from '@/test/tenantConfigMocks';

/** Construye una apariencia de dominio con valores por defecto (IAppTheme). */
function makeAppearance(overrides: Partial<IAppTheme> = {}): IAppTheme {
  return {
    primaryColor: '#10b981',
    accentColor: '#3b82f6',
    surfaceColor: '#ffffff',
    textColor: '#0f172a',
    brandBadge: '#0ea5e9',
    logoUrl: 'https://cdn.omnibotia.example/logo.png',
    fontFamily: 'Inter',
    ...overrides,
  };
}

/** Construye el DTO de apariencia leído del backend (snake_case). */
function makeAppearanceRead(overrides: Partial<ITenantAppearanceRead> = {}): ITenantAppearanceRead {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-1',
    primary_color: '#10b981',
    accent_color: '#3b82f6',
    surface_color: '#ffffff',
    text_color: '#0f172a',
    brand_badge: '#0ea5e9',
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

/** Construye un ítem de contenido leído del backend. */
function makeContentItem(overrides: Partial<IContentItemRead> = {}): IContentItemRead {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: 'tenant-1',
    kind: 'faq',
    title: '¿Cómo funcionan los envíos?',
    content: 'Respuesta de prueba',
    tags: ['ventas'],
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un ítem del catálogo leído del backend. */
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

/** Construye un canal leído del backend (sin secretos ni campo `version`). */
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

/** Construye una página del backend con los ítems dados. */
function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye un servicio con todas las dependencias mockeadas por defecto. */
function makeService(overrides: Partial<ITenantConfigService> = {}): ITenantConfigService {
  return {
    getTenantAppearance: vi
      .fn<ITenantConfigService['getTenantAppearance']>()
      .mockResolvedValue(makeAppearance()),
    saveTenantAppearance: vi
      .fn<ITenantConfigService['saveTenantAppearance']>()
      .mockResolvedValue(makeAppearanceRead()),
    listContentItems: vi
      .fn<ITenantConfigService['listContentItems']>()
      .mockResolvedValue(makePage([])),
    createContentItem: vi
      .fn<ITenantConfigService['createContentItem']>()
      .mockResolvedValue(makeContentItem()),
    getContentItem: vi
      .fn<ITenantConfigService['getContentItem']>()
      .mockResolvedValue(makeContentItem()),
    updateContentItem: vi
      .fn<ITenantConfigService['updateContentItem']>()
      .mockResolvedValue(makeContentItem()),
    deleteContentItem: vi
      .fn<ITenantConfigService['deleteContentItem']>()
      .mockResolvedValue(undefined),
    listCatalogItems: vi
      .fn<ITenantConfigService['listCatalogItems']>()
      .mockResolvedValue(makePage([])),
    createCatalogItem: vi
      .fn<ITenantConfigService['createCatalogItem']>()
      .mockResolvedValue(makeCatalogItem()),
    getCatalogItem: vi
      .fn<ITenantConfigService['getCatalogItem']>()
      .mockResolvedValue(makeCatalogItem()),
    updateCatalogItem: vi
      .fn<ITenantConfigService['updateCatalogItem']>()
      .mockResolvedValue(makeCatalogItem()),
    deleteCatalogItem: vi
      .fn<ITenantConfigService['deleteCatalogItem']>()
      .mockResolvedValue(undefined),
    listChannels: vi.fn<ITenantConfigService['listChannels']>().mockResolvedValue(makePage([])),
    createChannel: vi.fn<ITenantConfigService['createChannel']>().mockResolvedValue(makeChannel()),
    getChannel: vi.fn<ITenantConfigService['getChannel']>().mockResolvedValue(makeChannel()),
    updateChannel: vi.fn<ITenantConfigService['updateChannel']>().mockResolvedValue(makeChannel()),
    deleteChannel: vi.fn<ITenantConfigService['deleteChannel']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('tenantConfigStore', () => {
  beforeEach(() => {
    useTenantConfigStore.getState().reset();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useTenantConfigStore.getState().reset();
    setTenantConfigService(null);
    setRebrandingService(null);
    document.documentElement.removeAttribute('style');
  });

  it('parte del estado inicial por defecto', () => {
    const state = useTenantConfigStore.getState();
    expect(state.appearance).toBeNull();
    expect(state.appearanceStatus).toBe('idle');
    expect(state.appearanceError).toBeNull();
    expect(state.contentItems).toEqual([]);
    expect(state.contentStatus).toBe('idle');
    expect(state.contentError).toBeNull();
    expect(state.catalogItems).toEqual([]);
    expect(state.catalogStatus).toBe('idle');
    expect(state.catalogError).toBeNull();
    expect(state.channels).toEqual([]);
    expect(state.channelsStatus).toBe('idle');
    expect(state.channelsError).toBeNull();
    expect(state.appearanceProposal).toBeNull();
    expect(state.rebrandingConfigs).toEqual([]);
    expect(state.rebrandingStatus).toBe('idle');
    expect(state.rebrandingError).toBeNull();
  });

  describe('apariencia', () => {
    it('carga la apariencia del tenant y la materializa como tema', async () => {
      const theme = makeAppearance({ primaryColor: '#8b5cf6' });
      setTenantConfigService(
        makeService({
          getTenantAppearance: vi
            .fn<ITenantConfigService['getTenantAppearance']>()
            .mockResolvedValue(theme),
        }),
      );
      await useTenantConfigStore.getState().loadAppearance();
      const state = useTenantConfigStore.getState();
      expect(state.appearance).toEqual(theme);
      expect(state.appearanceStatus).toBe('success');
      expect(state.appearanceError).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--omni-brand-500')).toBe(
        '139 92 246',
      );
    });

    it('aplica el tema por defecto cuando la apariencia aún no está configurada (404 → null)', async () => {
      setTenantConfigService(
        makeService({
          getTenantAppearance: vi
            .fn<ITenantConfigService['getTenantAppearance']>()
            .mockResolvedValue(null),
        }),
      );
      await useTenantConfigStore.getState().loadAppearance();
      const state = useTenantConfigStore.getState();
      expect(state.appearance).toBeNull();
      expect(state.appearanceStatus).toBe('success');
      expect(state.appearanceError).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--omni-brand-500')).toBe(
        '16 185 129',
      );
    });

    it('pasa a loading mientras la carga de la apariencia está pendiente', async () => {
      let resolve!: (value: IAppTheme | null) => void;
      const getTenantAppearance = vi
        .fn<ITenantConfigService['getTenantAppearance']>()
        .mockImplementation(() => new Promise<IAppTheme | null>((res) => (resolve = res)));
      setTenantConfigService(makeService({ getTenantAppearance }));
      const pending = useTenantConfigStore.getState().loadAppearance();
      expect(useTenantConfigStore.getState().appearanceStatus).toBe('loading');
      resolve(makeAppearance());
      await pending;
      expect(useTenantConfigStore.getState().appearanceStatus).toBe('success');
      expect(useTenantConfigStore.getState().appearance).toEqual(makeAppearance());
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useTenantConfigStore.getState().loadAppearance();
      const state = useTenantConfigStore.getState();
      expect(state.appearanceStatus).toBe('error');
      expect(state.appearanceError).toBe('La configuración del tenant no está disponible.');
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      setTenantConfigService(
        makeService({
          getTenantAppearance: vi
            .fn<ITenantConfigService['getTenantAppearance']>()
            .mockRejectedValue(
              new AppError('Fallo de apariencia', 'tenant.appearance.get', { status: 500 }),
            ),
        }),
      );
      await useTenantConfigStore.getState().loadAppearance();
      const state = useTenantConfigStore.getState();
      expect(state.appearanceStatus).toBe('error');
      expect(state.appearanceError).toBe('Fallo de apariencia');
    });

    it('propaga el mensaje de un Error genérico del servicio', async () => {
      setTenantConfigService(
        makeService({
          getTenantAppearance: vi
            .fn<ITenantConfigService['getTenantAppearance']>()
            .mockRejectedValue(new Error('Red caída')),
        }),
      );
      await useTenantConfigStore.getState().loadAppearance();
      expect(useTenantConfigStore.getState().appearanceError).toBe('Red caída');
    });

    it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
      setTenantConfigService(
        makeService({
          getTenantAppearance: vi
            .fn<ITenantConfigService['getTenantAppearance']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useTenantConfigStore.getState().loadAppearance();
      const state = useTenantConfigStore.getState();
      expect(state.appearanceStatus).toBe('error');
      expect(state.appearanceError).toBe('No se pudo cargar la apariencia.');
    });

    it('guarda la apariencia, traduce el DTO guardado de vuelta y la materializa', async () => {
      const theme = makeAppearance({
        primaryColor: '#ef4444',
        logoUrl: undefined,
        fontFamily: undefined,
      });
      const saved = makeAppearanceRead({
        primary_color: '#ef4444',
        logo_url: undefined,
        font_family: undefined,
      });
      const saveTenantAppearance = vi
        .fn<ITenantConfigService['saveTenantAppearance']>()
        .mockResolvedValue(saved);
      setTenantConfigService(makeService({ saveTenantAppearance }));
      await useTenantConfigStore.getState().saveAppearance(theme);
      expect(saveTenantAppearance).toHaveBeenCalledWith(theme);
      const state = useTenantConfigStore.getState();
      expect(state.appearance).toEqual(theme);
      expect(state.appearanceStatus).toBe('success');
      expect(state.appearanceError).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--omni-brand-500')).toBe('239 68 68');
      expect(document.documentElement.style.getPropertyValue('--omni-font-family')).toBe('');
    });

    it('degrade a error cuando falla el guardado de la apariencia', async () => {
      setTenantConfigService(
        makeService({
          saveTenantAppearance: vi
            .fn<ITenantConfigService['saveTenantAppearance']>()
            .mockRejectedValue(new AppError('Fallo al guardar', 'tenant.appearance.save', {})),
        }),
      );
      await useTenantConfigStore.getState().saveAppearance(makeAppearance());
      const state = useTenantConfigStore.getState();
      expect(state.appearanceStatus).toBe('error');
      expect(state.appearanceError).toBe('Fallo al guardar');
    });
  });

  describe('contenido', () => {
    it('carga el contenido estructurado del tenant', async () => {
      const items = [makeContentItem()];
      setTenantConfigService(
        makeService({
          listContentItems: vi
            .fn<ITenantConfigService['listContentItems']>()
            .mockResolvedValue(makePage(items)),
        }),
      );
      await useTenantConfigStore.getState().listContentItems();
      const state = useTenantConfigStore.getState();
      expect(state.contentItems).toEqual(items);
      expect(state.contentStatus).toBe('success');
      expect(state.contentError).toBeNull();
    });

    it('crea un ítem de contenido y lo agrega a la colección', async () => {
      const input: IContentItemInput = {
        kind: 'faq',
        title: 'Nueva pregunta frecuente',
        content: 'Cuerpo de la respuesta',
        tags: ['ventas'],
      };
      const created = makeContentItem({ id: '99999999-9999-4999-8999-999999999999' });
      const createContentItem = vi
        .fn<ITenantConfigService['createContentItem']>()
        .mockResolvedValue(created);
      setTenantConfigService(makeService({ createContentItem }));
      await useTenantConfigStore.getState().createContentItem(input);
      expect(createContentItem).toHaveBeenCalledWith(input);
      expect(useTenantConfigStore.getState().contentItems).toEqual([created]);
    });

    it('actualiza un ítem de contenido reemplazándolo en la colección', async () => {
      const original = makeContentItem();
      useTenantConfigStore.setState({ contentItems: [original] });
      const updated = makeContentItem({ title: 'Título actualizado' });
      const updateContentItem = vi
        .fn<ITenantConfigService['updateContentItem']>()
        .mockResolvedValue(updated);
      setTenantConfigService(makeService({ updateContentItem }));
      await useTenantConfigStore
        .getState()
        .updateContentItem(original.id, { title: 'Título actualizado' });
      expect(updateContentItem).toHaveBeenCalledWith(original.id, { title: 'Título actualizado' });
      expect(useTenantConfigStore.getState().contentItems).toEqual([updated]);
    });

    it('elimina un ítem de contenido y lo quita de la colección', async () => {
      const item = makeContentItem();
      useTenantConfigStore.setState({ contentItems: [item] });
      const deleteContentItem = vi
        .fn<ITenantConfigService['deleteContentItem']>()
        .mockResolvedValue(undefined);
      setTenantConfigService(makeService({ deleteContentItem }));
      await useTenantConfigStore.getState().deleteContentItem(item.id);
      expect(deleteContentItem).toHaveBeenCalledWith(item.id);
      expect(useTenantConfigStore.getState().contentItems).toEqual([]);
    });

    it('degrade a error cuando falla la carga de contenido', async () => {
      setTenantConfigService(
        makeService({
          listContentItems: vi
            .fn<ITenantConfigService['listContentItems']>()
            .mockRejectedValue('fallo'),
        }),
      );
      await useTenantConfigStore.getState().listContentItems();
      const state = useTenantConfigStore.getState();
      expect(state.contentStatus).toBe('error');
      expect(state.contentError).toBe('No se pudo cargar el contenido.');
    });

    it('degrade a error en contenido sin servicio registrado', async () => {
      await useTenantConfigStore
        .getState()
        .createContentItem({ kind: 'faq', title: 'Sin servicio' });
      const state = useTenantConfigStore.getState();
      expect(state.contentStatus).toBe('error');
      expect(state.contentError).toBe('La configuración del tenant no está disponible.');
    });
  });

  describe('catálogo', () => {
    it('carga el catálogo del tenant', async () => {
      const items = [makeCatalogItem()];
      setTenantConfigService(
        makeService({
          listCatalogItems: vi
            .fn<ITenantConfigService['listCatalogItems']>()
            .mockResolvedValue(makePage(items)),
        }),
      );
      await useTenantConfigStore.getState().listCatalogItems();
      const state = useTenantConfigStore.getState();
      expect(state.catalogItems).toEqual(items);
      expect(state.catalogStatus).toBe('success');
      expect(state.catalogError).toBeNull();
    });

    it('crea un ítem del catálogo y lo agrega a la colección', async () => {
      const input: ICatalogItemInput = { sku: 'SKU-002', name: 'Nuevo servicio', price: 199.9 };
      const created = makeCatalogItem({
        id: '99999999-9999-4999-8999-999999999999',
        sku: 'SKU-002',
      });
      const createCatalogItem = vi
        .fn<ITenantConfigService['createCatalogItem']>()
        .mockResolvedValue(created);
      setTenantConfigService(makeService({ createCatalogItem }));
      await useTenantConfigStore.getState().createCatalogItem(input);
      expect(createCatalogItem).toHaveBeenCalledWith(input);
      expect(useTenantConfigStore.getState().catalogItems).toEqual([created]);
    });

    it('actualiza un ítem del catálogo reemplazándolo en la colección', async () => {
      const original = makeCatalogItem();
      useTenantConfigStore.setState({ catalogItems: [original] });
      const updated = makeCatalogItem({ price: 150 });
      const updateCatalogItem = vi
        .fn<ITenantConfigService['updateCatalogItem']>()
        .mockResolvedValue(updated);
      setTenantConfigService(makeService({ updateCatalogItem }));
      await useTenantConfigStore.getState().updateCatalogItem(original.id, { price: 150 });
      expect(updateCatalogItem).toHaveBeenCalledWith(original.id, { price: 150 });
      expect(useTenantConfigStore.getState().catalogItems).toEqual([updated]);
    });

    it('elimina un ítem del catálogo y lo quita de la colección', async () => {
      const item = makeCatalogItem();
      useTenantConfigStore.setState({ catalogItems: [item] });
      const deleteCatalogItem = vi
        .fn<ITenantConfigService['deleteCatalogItem']>()
        .mockResolvedValue(undefined);
      setTenantConfigService(makeService({ deleteCatalogItem }));
      await useTenantConfigStore.getState().deleteCatalogItem(item.id);
      expect(deleteCatalogItem).toHaveBeenCalledWith(item.id);
      expect(useTenantConfigStore.getState().catalogItems).toEqual([]);
    });

    it('degrade a error cuando falla la creación de un ítem del catálogo', async () => {
      setTenantConfigService(
        makeService({
          createCatalogItem: vi
            .fn<ITenantConfigService['createCatalogItem']>()
            .mockRejectedValue('fallo'),
        }),
      );
      await useTenantConfigStore
        .getState()
        .createCatalogItem({ sku: 'SKU-003', name: 'Fallido', price: 10 });
      const state = useTenantConfigStore.getState();
      expect(state.catalogStatus).toBe('error');
      expect(state.catalogError).toBe('No se pudo crear el ítem del catálogo.');
    });

    it('degrade a error en catálogo sin servicio registrado', async () => {
      await useTenantConfigStore.getState().listCatalogItems();
      const state = useTenantConfigStore.getState();
      expect(state.catalogStatus).toBe('error');
      expect(state.catalogError).toBe('La configuración del tenant no está disponible.');
    });
  });

  describe('canales', () => {
    it('carga los canales del tenant', async () => {
      const items = [makeChannel()];
      setTenantConfigService(
        makeService({
          listChannels: vi
            .fn<ITenantConfigService['listChannels']>()
            .mockResolvedValue(makePage(items)),
        }),
      );
      await useTenantConfigStore.getState().listChannels();
      const state = useTenantConfigStore.getState();
      expect(state.channels).toEqual(items);
      expect(state.channelsStatus).toBe('success');
      expect(state.channelsError).toBeNull();
    });

    it('crea un canal y lo agrega a la colección', async () => {
      const input: ITenantChannelInput = { phoneNumber: '+521234567890' };
      const created = makeChannel({ id: '99999999-9999-4999-8999-999999999999' });
      const createChannel = vi
        .fn<ITenantConfigService['createChannel']>()
        .mockResolvedValue(created);
      setTenantConfigService(makeService({ createChannel }));
      await useTenantConfigStore.getState().createChannel(input);
      expect(createChannel).toHaveBeenCalledWith(input);
      expect(useTenantConfigStore.getState().channels).toEqual([created]);
    });

    it('actualiza un canal reemplazándolo en la colección', async () => {
      const original = makeChannel();
      useTenantConfigStore.setState({ channels: [original] });
      const updated = makeChannel({ enabled: false });
      const updateChannel = vi
        .fn<ITenantConfigService['updateChannel']>()
        .mockResolvedValue(updated);
      setTenantConfigService(makeService({ updateChannel }));
      await useTenantConfigStore.getState().updateChannel(original.id, { enabled: false });
      expect(updateChannel).toHaveBeenCalledWith(original.id, { enabled: false });
      expect(useTenantConfigStore.getState().channels).toEqual([updated]);
    });

    it('elimina un canal y lo quita de la colección', async () => {
      const channel = makeChannel();
      useTenantConfigStore.setState({ channels: [channel] });
      const deleteChannel = vi
        .fn<ITenantConfigService['deleteChannel']>()
        .mockResolvedValue(undefined);
      setTenantConfigService(makeService({ deleteChannel }));
      await useTenantConfigStore.getState().deleteChannel(channel.id);
      expect(deleteChannel).toHaveBeenCalledWith(channel.id);
      expect(useTenantConfigStore.getState().channels).toEqual([]);
    });

    it('degrade a error cuando falla la carga de canales', async () => {
      setTenantConfigService(
        makeService({
          listChannels: vi.fn<ITenantConfigService['listChannels']>().mockRejectedValue('fallo'),
        }),
      );
      await useTenantConfigStore.getState().listChannels();
      const state = useTenantConfigStore.getState();
      expect(state.channelsStatus).toBe('error');
      expect(state.channelsError).toBe('No se pudieron cargar los canales.');
    });

    it('degrade a error en canales sin servicio registrado', async () => {
      await useTenantConfigStore.getState().listChannels();
      const state = useTenantConfigStore.getState();
      expect(state.channelsStatus).toBe('error');
      expect(state.channelsError).toBe('La configuración del tenant no está disponible.');
    });
  });

  describe('rebranding', () => {
    it('extrae una propuesta desde una URL y la guarda en el estado', async () => {
      const proposal = makeAppearanceProposal();
      setRebrandingService(
        makeRebrandingService({
          extractUrlStyles: vi
            .fn<IRebrandingService['extractUrlStyles']>()
            .mockResolvedValue(proposal),
        }),
      );
      await useTenantConfigStore.getState().extractUrl('https://brand.example.com');
      const state = useTenantConfigStore.getState();
      expect(state.appearanceProposal).toEqual(proposal);
      expect(state.rebrandingStatus).toBe('success');
      expect(state.rebrandingError).toBeNull();
    });

    it('pasa a loading mientras la extracción de la URL está pendiente', async () => {
      let resolve!: (value: IAppearanceProposal) => void;
      const extractUrlStyles = vi
        .fn<IRebrandingService['extractUrlStyles']>()
        .mockImplementation(() => new Promise<IAppearanceProposal>((res) => (resolve = res)));
      setRebrandingService(makeRebrandingService({ extractUrlStyles }));
      const pending = useTenantConfigStore.getState().extractUrl('https://brand.example.com');
      expect(useTenantConfigStore.getState().rebrandingStatus).toBe('loading');
      resolve(makeAppearanceProposal());
      await pending;
      expect(useTenantConfigStore.getState().rebrandingStatus).toBe('success');
    });

    it('degrade a error cuando no hay servicio de rebranding registrado', async () => {
      await useTenantConfigStore.getState().extractUrl('https://brand.example.com');
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingStatus).toBe('error');
      expect(state.rebrandingError).toBe('El servicio de rebranding no está disponible.');
    });

    it('propaga el mensaje de un AppError durante la extracción', async () => {
      setRebrandingService(
        makeRebrandingService({
          extractUrlStyles: vi
            .fn<IRebrandingService['extractUrlStyles']>()
            .mockRejectedValue(
              new AppError('Fallo al extraer', 'tenant.appearance.extract_url', { status: 500 }),
            ),
        }),
      );
      await useTenantConfigStore.getState().extractUrl('https://brand.example.com');
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingStatus).toBe('error');
      expect(state.rebrandingError).toBe('Fallo al extraer');
    });

    it('usa un mensaje por defecto cuando el error de extracción no es una instancia de Error', async () => {
      setRebrandingService(
        makeRebrandingService({
          extractUrlStyles: vi
            .fn<IRebrandingService['extractUrlStyles']>()
            .mockRejectedValue('respuesta no estructurada'),
        }),
      );
      await useTenantConfigStore.getState().extractUrl('https://brand.example.com');
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingStatus).toBe('error');
      expect(state.rebrandingError).toBe('No se pudieron extraer los estilos de la URL.');
    });

    it('guarda una configuración de rebranding y la antepone a la colección', async () => {
      const config = makeRebrandingConfig({ name: 'Marca nueva' });
      const createRebrandingConfig = vi
        .fn<IRebrandingService['createRebrandingConfig']>()
        .mockResolvedValue(config);
      setRebrandingService(
        makeRebrandingService({
          listRebrandingConfigs: vi
            .fn<IRebrandingService['listRebrandingConfigs']>()
            .mockResolvedValue([makeRebrandingConfig()]),
          createRebrandingConfig,
        }),
      );
      await useTenantConfigStore.getState().saveRebranding({
        name: 'Marca nueva',
        url: 'https://brand.example.com',
      });
      expect(createRebrandingConfig).toHaveBeenCalledWith({
        name: 'Marca nueva',
        url: 'https://brand.example.com',
      });
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingConfigs[0]).toEqual(config);
      expect(state.rebrandingStatus).toBe('success');
      expect(state.rebrandingError).toBeNull();
    });

    it('degrade a error cuando falla el guardado de la configuración', async () => {
      setRebrandingService(
        makeRebrandingService({
          createRebrandingConfig: vi
            .fn<IRebrandingService['createRebrandingConfig']>()
            .mockRejectedValue(
              new AppError('Fallo al guardar', 'tenant.appearance.rebranding.create', {}),
            ),
        }),
      );
      await useTenantConfigStore
        .getState()
        .saveRebranding({ name: 'Marca', url: 'https://brand.example.com' });
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingStatus).toBe('error');
      expect(state.rebrandingError).toBe('Fallo al guardar');
    });

    it('lista las configuraciones de rebranding del tenant', async () => {
      const configs = [makeRebrandingConfig()];
      setRebrandingService(
        makeRebrandingService({
          listRebrandingConfigs: vi
            .fn<IRebrandingService['listRebrandingConfigs']>()
            .mockResolvedValue(configs),
        }),
      );
      await useTenantConfigStore.getState().listRebrandingConfigs();
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingConfigs).toEqual(configs);
      expect(state.rebrandingStatus).toBe('success');
      expect(state.rebrandingError).toBeNull();
    });

    it('degrade a error cuando falla la carga de configuraciones', async () => {
      setRebrandingService(
        makeRebrandingService({
          listRebrandingConfigs: vi
            .fn<IRebrandingService['listRebrandingConfigs']>()
            .mockRejectedValue(new Error('Red caída')),
        }),
      );
      await useTenantConfigStore.getState().listRebrandingConfigs();
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingStatus).toBe('error');
      expect(state.rebrandingError).toBe('Red caída');
    });

    it('elimina una configuración de rebranding y la quita de la colección', async () => {
      const config = makeRebrandingConfig();
      const deleteRebrandingConfig = vi
        .fn<IRebrandingService['deleteRebrandingConfig']>()
        .mockResolvedValue(undefined);
      setRebrandingService(
        makeRebrandingService({
          listRebrandingConfigs: vi
            .fn<IRebrandingService['listRebrandingConfigs']>()
            .mockResolvedValue([config]),
          deleteRebrandingConfig,
        }),
      );
      await useTenantConfigStore.getState().listRebrandingConfigs();
      await useTenantConfigStore.getState().deleteRebranding(config.id);
      expect(deleteRebrandingConfig).toHaveBeenCalledWith(config.id);
      expect(useTenantConfigStore.getState().rebrandingConfigs).toEqual([]);
    });

    it('degrade a error cuando falla la eliminación', async () => {
      setRebrandingService(
        makeRebrandingService({
          deleteRebrandingConfig: vi
            .fn<IRebrandingService['deleteRebrandingConfig']>()
            .mockRejectedValue(
              new AppError('Fallo al eliminar', 'tenant.appearance.rebranding.delete', {}),
            ),
        }),
      );
      await useTenantConfigStore
        .getState()
        .deleteRebranding('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      const state = useTenantConfigStore.getState();
      expect(state.rebrandingStatus).toBe('error');
      expect(state.rebrandingError).toBe('Fallo al eliminar');
    });
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useTenantConfigStore.setState({
      appearance: makeAppearance(),
      appearanceStatus: 'success',
      contentItems: [makeContentItem()],
      contentStatus: 'success',
      catalogItems: [makeCatalogItem()],
      catalogStatus: 'success',
      channels: [makeChannel()],
      channelsStatus: 'success',
      appearanceProposal: makeAppearanceProposal(),
      rebrandingConfigs: [makeRebrandingConfig()],
      rebrandingStatus: 'success',
    });
    useTenantConfigStore.getState().reset();
    const state = useTenantConfigStore.getState();
    expect(state.appearance).toBeNull();
    expect(state.appearanceStatus).toBe('idle');
    expect(state.appearanceError).toBeNull();
    expect(state.contentItems).toEqual([]);
    expect(state.contentStatus).toBe('idle');
    expect(state.contentError).toBeNull();
    expect(state.catalogItems).toEqual([]);
    expect(state.catalogStatus).toBe('idle');
    expect(state.catalogError).toBeNull();
    expect(state.channels).toEqual([]);
    expect(state.channelsStatus).toBe('idle');
    expect(state.channelsError).toBeNull();
    expect(state.appearanceProposal).toBeNull();
    expect(state.rebrandingConfigs).toEqual([]);
    expect(state.rebrandingStatus).toBe('idle');
    expect(state.rebrandingError).toBeNull();
  });
});
