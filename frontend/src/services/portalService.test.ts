/**
 * Pruebas del servicio de Páginas del Portal del Cliente.
 *
 * Contrato:
 * - `BackendPortalService` delega cada método en el método correspondiente de
 *   `IApiClient` (listPortalPages, getPortalPage, createPortalPage,
 *   updatePortalPage, deletePortalPage, publishPortalPage, generatePortalPage).
 * - `createPortalService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IPage, IPortalPageAiGenerationResponse, IPortalPageRead } from '@/api/types';
import { BackendPortalService, createPortalService } from '@/services/portalService';
import { makeApiClientMock } from '@/test/apiClientMocks';

function makePage(overrides: Partial<IPortalPageRead> = {}): IPortalPageRead {
  return {
    id: 'page-1',
    tenant_id: 'tenant-1',
    slug: 'mi-empresa',
    title: 'Portal de Mi Empresa',
    blocks: { title: 'Portal de Mi Empresa', blocks: [] },
    compiled_html: null,
    published: false,
    published_at: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

function makePageList(overrides: Partial<IPage<IPortalPageRead>> = {}): IPage<IPortalPageRead> {
  return {
    items: [makePage()],
    total: 1,
    page: 1,
    page_size: 20,
    ...overrides,
  };
}

function makeGeneration(
  overrides: Partial<IPortalPageAiGenerationResponse> = {},
): IPortalPageAiGenerationResponse {
  return {
    slug: 'mi-empresa',
    title: 'Portal IA',
    blocks: { title: 'Portal IA', blocks: [] },
    model: 'deepseek-chat',
    cached: false,
    prompt_tokens: 120,
    completion_tokens: 340,
    generated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

describe('BackendPortalService', () => {
  it('lista páginas del portal delegando en listPortalPages', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.listPortalPages as ReturnType<typeof vi.fn>).mockResolvedValue(makePageList());
    const service = new BackendPortalService(apiClient);

    const result = await service.list({ page: 2, page_size: 10 });

    expect(apiClient.listPortalPages).toHaveBeenCalledTimes(1);
    expect(apiClient.listPortalPages).toHaveBeenCalledWith({ page: 2, page_size: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].slug).toBe('mi-empresa');
  });

  it('obtiene una página del portal delegando en getPortalPage', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.getPortalPage as ReturnType<typeof vi.fn>).mockResolvedValue(makePage());
    const service = new BackendPortalService(apiClient);

    const result = await service.get('page-1');

    expect(apiClient.getPortalPage).toHaveBeenCalledWith('page-1');
    expect(result.id).toBe('page-1');
  });

  it('crea una página del portal delegando en createPortalPage', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.createPortalPage as ReturnType<typeof vi.fn>).mockResolvedValue(makePage());
    const service = new BackendPortalService(apiClient);
    const payload = {
      slug: 'mi-empresa',
      title: 'Portal',
      blocks: { title: 'Portal', blocks: [] },
    };

    const result = await service.create(payload);

    expect(apiClient.createPortalPage).toHaveBeenCalledWith(payload);
    expect(result.slug).toBe('mi-empresa');
  });

  it('actualiza una página del portal delegando en updatePortalPage', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.updatePortalPage as ReturnType<typeof vi.fn>).mockResolvedValue(
      makePage({ title: 'Portal Renombrado' }),
    );
    const service = new BackendPortalService(apiClient);
    const payload = { title: 'Portal Renombrado' };

    const result = await service.update('page-1', payload);

    expect(apiClient.updatePortalPage).toHaveBeenCalledWith('page-1', payload);
    expect(result.title).toBe('Portal Renombrado');
  });

  it('elimina una página del portal delegando en deletePortalPage', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.deletePortalPage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const service = new BackendPortalService(apiClient);

    await service.delete('page-1');

    expect(apiClient.deletePortalPage).toHaveBeenCalledWith('page-1');
  });

  it('(des)publica una página del portal delegando en publishPortalPage', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.publishPortalPage as ReturnType<typeof vi.fn>).mockResolvedValue(
      makePage({ published: true }),
    );
    const service = new BackendPortalService(apiClient);

    const result = await service.publish('page-1', { published: true });

    expect(apiClient.publishPortalPage).toHaveBeenCalledWith('page-1', { published: true });
    expect(result.published).toBe(true);
  });

  it('genera una página del portal delegando en generatePortalPage', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generatePortalPage as ReturnType<typeof vi.fn>).mockResolvedValue(makeGeneration());
    const service = new BackendPortalService(apiClient);

    const result = await service.generate({ prompt: 'Portal de una clínica dental' });

    expect(apiClient.generatePortalPage).toHaveBeenCalledWith({
      prompt: 'Portal de una clínica dental',
    });
    expect(result.title).toBe('Portal IA');
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const failure = new Error('agotado');
    (apiClient.createPortalPage as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const service = new BackendPortalService(apiClient);

    await expect(
      service.create({ slug: 'x', title: 'X', blocks: { title: 'X', blocks: [] } }),
    ).rejects.toBe(failure);
  });
});

describe('createPortalService', () => {
  it('construye una implementación BackendPortalService desde el cliente', () => {
    const apiClient = makeApiClientMock();
    const service = createPortalService(apiClient);

    expect(service).toBeInstanceOf(BackendPortalService);
  });
});
