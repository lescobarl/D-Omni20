/**
 * Pruebas del store del Marketplace de Templates.
 *
 * Contrato:
 * - El registro de servicios por DI (`setMarketplaceService`/`getMarketplaceService`)
 *   permite inyectar la implementación `IMarketplaceService` sin acoplar el store.
 * - `fetchTemplates` gestiona los estados `idle | loading | success | error` y
 *   recalcula las categorías disponibles a partir del catálogo cargado.
 * - `setCategory` fija la categoría activa y recarga el catálogo (filtro server-side).
 * - `importTemplate` requiere una campaña; si está vacía degrada a error sin invocar el servicio.
 * - Sin servicio registrado el store degrada a estado de error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMarketplaceService, useMarketplaceStore } from '@/store/marketplaceStore';
import { AppError } from '@/lib/errors';
import type { IMarketplaceImportResponse, IMarketplaceTemplateRead } from '@/api/types';
import type { IMarketplaceService } from '@/services/marketplaceService';

/** Construye un template del catálogo con valores por defecto. */
function makeTemplate(overrides: Partial<IMarketplaceTemplateRead> = {}): IMarketplaceTemplateRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'tenant-1',
    name: 'Landing de Ventas',
    description: null,
    category: 'ventas',
    config: { title: 'Nueva Landing', workflowType: 'direct_checkout', blocks: [] },
    thumbnail_url: null,
    is_public: true,
    downloads: 12,
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye una respuesta de importación con valores por defecto. */
function makeImportResponse(
  overrides: Partial<IMarketplaceImportResponse> = {},
): IMarketplaceImportResponse {
  return {
    template: makeTemplate(),
    landing_id: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  };
}

/** Construye un servicio con todas las dependencias mockeadas por defecto. */
function makeService(overrides: Partial<IMarketplaceService> = {}): IMarketplaceService {
  return {
    list: vi.fn<IMarketplaceService['list']>().mockResolvedValue([]),
    create: vi.fn<IMarketplaceService['create']>().mockResolvedValue(makeTemplate()),
    importTemplate: vi
      .fn<IMarketplaceService['importTemplate']>()
      .mockResolvedValue(makeImportResponse()),
    ...overrides,
  };
}

describe('marketplaceStore', () => {
  beforeEach(() => {
    useMarketplaceStore.getState().reset();
  });

  afterEach(() => {
    useMarketplaceStore.getState().reset();
    setMarketplaceService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useMarketplaceStore.getState();
    expect(state.templates).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.categories).toEqual([]);
    expect(state.activeCategory).toBeNull();
    expect(state.importingId).toBeNull();
    expect(state.importedTemplateId).toBeNull();
    expect(state.lastImportedLandingId).toBeNull();
  });

  it('carga el catálogo y calcula las categorías ordenadas', async () => {
    const list = vi
      .fn<IMarketplaceService['list']>()
      .mockResolvedValue([
        makeTemplate({ id: 't-1', category: 'ventas' }),
        makeTemplate({ id: 't-2', category: 'contacto' }),
        makeTemplate({ id: 't-3', category: 'ventas' }),
      ]);
    setMarketplaceService(makeService({ list }));

    await useMarketplaceStore.getState().fetchTemplates();

    const state = useMarketplaceStore.getState();
    expect(list).toHaveBeenCalledWith(undefined);
    expect(state.status).toBe('success');
    expect(state.templates).toHaveLength(3);
    expect(state.categories).toEqual(['contacto', 'ventas']);
    expect(state.error).toBeNull();
  });

  it('pasa a loading mientras la carga del catálogo está pendiente', async () => {
    let resolve!: (value: IMarketplaceTemplateRead[]) => void;
    const list = vi
      .fn<IMarketplaceService['list']>()
      .mockImplementation(() => new Promise<IMarketplaceTemplateRead[]>((res) => (resolve = res)));
    setMarketplaceService(makeService({ list }));

    const pending = useMarketplaceStore.getState().fetchTemplates();

    expect(useMarketplaceStore.getState().status).toBe('loading');

    resolve([]);
    await pending;

    expect(useMarketplaceStore.getState().status).toBe('success');
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setMarketplaceService(null);

    await useMarketplaceStore.getState().fetchTemplates();

    expect(useMarketplaceStore.getState().status).toBe('error');
    expect(useMarketplaceStore.getState().error).toBe('El marketplace no está disponible.');
  });

  it('propaga el mensaje de un AppError del servicio', async () => {
    const list = vi
      .fn<IMarketplaceService['list']>()
      .mockRejectedValue(
        new AppError('Catálogo no disponible', 'marketplace.template.list', { reason: 'timeout' }),
      );
    setMarketplaceService(makeService({ list }));

    await useMarketplaceStore.getState().fetchTemplates();

    expect(useMarketplaceStore.getState().status).toBe('error');
    expect(useMarketplaceStore.getState().error).toBe('Catálogo no disponible');
  });

  it('filtra por categoría recargando el catálogo', async () => {
    const list = vi.fn<IMarketplaceService['list']>().mockResolvedValue([]);
    setMarketplaceService(makeService({ list }));

    await useMarketplaceStore.getState().setCategory('ventas');

    expect(list).toHaveBeenCalledWith('ventas');
    expect(useMarketplaceStore.getState().activeCategory).toBe('ventas');
    expect(useMarketplaceStore.getState().status).toBe('success');
  });

  it('importa un template y guarda la landing generada', async () => {
    const importTemplate = vi
      .fn<IMarketplaceService['importTemplate']>()
      .mockResolvedValue(
        makeImportResponse({ landing_id: '55555555-5555-4555-8555-555555555555' }),
      );
    setMarketplaceService(makeService({ importTemplate }));

    await useMarketplaceStore.getState().importTemplate('t-1', '  campaign-1  ');

    expect(importTemplate).toHaveBeenCalledWith('t-1', 'campaign-1', undefined);
    const state = useMarketplaceStore.getState();
    expect(state.importingId).toBeNull();
    expect(state.importedTemplateId).toBe('44444444-4444-4444-8444-444444444444');
    expect(state.lastImportedLandingId).toBe('55555555-5555-4555-8555-555555555555');
    expect(state.error).toBeNull();
  });

  it('rechaza importar sin campaña sin invocar el servicio', async () => {
    const importTemplate = vi.fn<IMarketplaceService['importTemplate']>();
    setMarketplaceService(makeService({ importTemplate }));

    await useMarketplaceStore.getState().importTemplate('t-1', '   ');

    expect(importTemplate).not.toHaveBeenCalled();
    expect(useMarketplaceStore.getState().error).toBe(
      'Selecciona una campaña para importar el template.',
    );
  });

  it('degrade a error en importTemplate sin servicio registrado', async () => {
    setMarketplaceService(null);

    await useMarketplaceStore.getState().importTemplate('t-1', 'campaign-1');

    expect(useMarketplaceStore.getState().error).toBe('El marketplace no está disponible.');
  });

  it('reset descarta el catálogo y vuelve al estado inicial', async () => {
    setMarketplaceService(
      makeService({
        list: vi
          .fn<IMarketplaceService['list']>()
          .mockResolvedValue([makeTemplate({ id: 't-1', category: 'ventas' })]),
      }),
    );
    await useMarketplaceStore.getState().fetchTemplates();
    useMarketplaceStore.getState().reset();

    const state = useMarketplaceStore.getState();
    expect(state.templates).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.categories).toEqual([]);
    expect(state.activeCategory).toBeNull();
    expect(state.error).toBeNull();
  });
});
