/**
 * Helpers de prueba compartidos para la configuración del tenant (apariencia,
 * contenido, catálogo, canales, documentos de la base de conocimiento RAG y
 * sinónimos del bot).
 *
 * Contrato:
 * - Centraliza las factorías de DTOs y los servicios mock (`ITenantConfigService`,
 *   `IDocumentService` e `ISynonymService`) para reutilizarlos en las pruebas
 *   del store y de los componentes de Settings.
 * - Cada factoría acepta overrides parciales para construir casos específicos.
 */
import { vi } from 'vitest';
import type {
  IAppearanceProposal,
  ICatalogItemRead,
  IContentItemRead,
  IDocumentContentRead,
  IDocumentRead,
  IDocumentSearchResult,
  IIngestResultRead,
  IPage,
  IRebrandingConfigRead,
  ISynonymImportResultRead,
  ISynonymRead,
  ITenantAppearanceRead,
  ITenantChannelRead,
} from '@/api/types';
import type { IDocumentService } from '@/services/documentService';
import type { IRebrandingService } from '@/services/rebrandingService';
import type { ISynonymService } from '@/services/synonymService';
import type { ITenantConfigService } from '@/services/tenantConfigService';
import type { IAppTheme } from '@/types/config';

/** Construye una apariencia de dominio con valores por defecto (IAppTheme). */
export function makeAppearance(overrides: Partial<IAppTheme> = {}): IAppTheme {
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
export function makeAppearanceRead(
  overrides: Partial<ITenantAppearanceRead> = {},
): ITenantAppearanceRead {
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
export function makeContentItem(overrides: Partial<IContentItemRead> = {}): IContentItemRead {
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
export function makeCatalogItem(overrides: Partial<ICatalogItemRead> = {}): ICatalogItemRead {
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
export function makeChannel(overrides: Partial<ITenantChannelRead> = {}): ITenantChannelRead {
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

/** Construye un documento ingerido leído del backend (Fase 1 — RAG). */
export function makeDocument(overrides: Partial<IDocumentRead> = {}): IDocumentRead {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenant_id: 'tenant-1',
    title: 'Manual de usuario',
    source_type: 'pdf',
    source_ref: null,
    size_bytes: 1024,
    metadata: {},
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye el contenido completo de un documento ingerido. */
export function makeDocumentContentRead(
  overrides: Partial<IDocumentContentRead> = {},
): IDocumentContentRead {
  return {
    ...makeDocument(),
    content: 'Contenido de prueba del manual de usuario.',
    ...overrides,
  };
}

/** Construye el resultado de una ingesta (documento + fragmentos creados). */
export function makeIngestResult(overrides: Partial<IIngestResultRead> = {}): IIngestResultRead {
  return {
    document: makeDocumentContentRead(),
    chunks_created: 2,
    warnings: [],
    ...overrides,
  };
}

/** Construye un resultado de búsqueda en la base de conocimiento. */
export function makeDocumentSearchResult(
  overrides: Partial<IDocumentSearchResult> = {},
): IDocumentSearchResult {
  return {
    document_id: '55555555-5555-4555-8555-555555555555',
    title: 'Manual de usuario',
    snippet: 'Fragmento relevante de la base de conocimiento…',
    score: 0.95,
    ...overrides,
  };
}

/** Construye una página del backend con los ítems dados. */
export function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye un servicio con todas las dependencias mockeadas por defecto. */
export function makeService(overrides: Partial<ITenantConfigService> = {}): ITenantConfigService {
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

/** Construye un servicio de documentos con todas las dependencias mockeadas. */
export function makeDocumentService(overrides: Partial<IDocumentService> = {}): IDocumentService {
  return {
    listDocuments: vi
      .fn<IDocumentService['listDocuments']>()
      .mockResolvedValue(makePage([makeDocument()])),
    ingestDocumentFile: vi
      .fn<IDocumentService['ingestDocumentFile']>()
      .mockResolvedValue(makeIngestResult()),
    ingestDocumentUrl: vi
      .fn<IDocumentService['ingestDocumentUrl']>()
      .mockResolvedValue(makeIngestResult()),
    searchDocuments: vi.fn<IDocumentService['searchDocuments']>().mockResolvedValue([]),
    getDocument: vi
      .fn<IDocumentService['getDocument']>()
      .mockResolvedValue(makeDocumentContentRead()),
    deleteDocument: vi.fn<IDocumentService['deleteDocument']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Construye un sinónimo leído del backend (Fase 2 — normalización). */
export function makeSynonym(overrides: Partial<ISynonymRead> = {}): ISynonymRead {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    tenant_id: 'tenant-1',
    term: 'automóvil',
    synonyms: ['auto', 'carro'],
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye el resultado de una importación de sinónimos en lote. */
export function makeSynonymImportResult(
  overrides: Partial<ISynonymImportResultRead> = {},
): ISynonymImportResultRead {
  return {
    imported: 2,
    skipped: 0,
    failed: 0,
    errors: [],
    ...overrides,
  };
}

/** Construye una propuesta de apariencia extraída de una URL de marca (Fase 5). */
export function makeAppearanceProposal(
  overrides: Partial<IAppearanceProposal> = {},
): IAppearanceProposal {
  return {
    primary_color: '#0055AA',
    accent_color: '#FF6600',
    surface_color: '#F5F5F5',
    text_color: '#111111',
    brand_badge: '#FF6600',
    logo_url: 'https://brand.example.com/logo-brand.png',
    font_family: 'Open Sans',
    detected_fonts: ['Open Sans', 'Roboto'],
    ...overrides,
  };
}

/** Construye una configuración de rebranding leída del backend (Fase 5). */
export function makeRebrandingConfig(
  overrides: Partial<IRebrandingConfigRead> = {},
): IRebrandingConfigRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: 'tenant-1',
    name: 'Marca',
    url: 'https://brand.example.com',
    extracted: { ...makeAppearanceProposal() },
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    applied_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio de rebranding con todas las dependencias mockeadas. */
export function makeRebrandingService(
  overrides: Partial<IRebrandingService> = {},
): IRebrandingService {
  return {
    extractUrlStyles: vi
      .fn<IRebrandingService['extractUrlStyles']>()
      .mockResolvedValue(makeAppearanceProposal()),
    listRebrandingConfigs: vi
      .fn<IRebrandingService['listRebrandingConfigs']>()
      .mockResolvedValue([makeRebrandingConfig()]),
    createRebrandingConfig: vi
      .fn<IRebrandingService['createRebrandingConfig']>()
      .mockResolvedValue(makeRebrandingConfig()),
    deleteRebrandingConfig: vi
      .fn<IRebrandingService['deleteRebrandingConfig']>()
      .mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Construye un servicio de sinónimos con todas las dependencias mockeadas. */
export function makeSynonymService(overrides: Partial<ISynonymService> = {}): ISynonymService {
  return {
    listSynonyms: vi
      .fn<ISynonymService['listSynonyms']>()
      .mockResolvedValue(makePage([makeSynonym()])),
    createSynonym: vi.fn<ISynonymService['createSynonym']>().mockResolvedValue(makeSynonym()),
    updateSynonym: vi.fn<ISynonymService['updateSynonym']>().mockResolvedValue(makeSynonym()),
    deleteSynonym: vi.fn<ISynonymService['deleteSynonym']>().mockResolvedValue(undefined),
    importSynonyms: vi
      .fn<ISynonymService['importSynonyms']>()
      .mockResolvedValue(makeSynonymImportResult()),
    exportSynonyms: vi
      .fn<ISynonymService['exportSynonyms']>()
      .mockResolvedValue('term,synonyms\nautomóvil,auto|carro'),
    ...overrides,
  };
}
