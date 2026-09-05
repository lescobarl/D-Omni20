/**
 * Store de configuración del tenant para el bot — apariencia, contenido,
 * catálogo y canales (Fase 2).
 *
 * Contrato:
 * - Registro de servicios por DI: `setTenantConfigService`/`getTenantConfigService`
 *   inyectan la implementación `ITenantConfigService` desde el composition root
 *   (`main.tsx`), activada por la feature flag `appearance`.
 * - Los documentos ingeridos (base de conocimiento RAG) usan su propio servicio:
 *   `setDocumentService`/`getDocumentService` inyectan `IDocumentService`.
 * - Los sinónimos del bot (normalización de vocabulario) usan su propio servicio:
 *   `setSynonymService`/`getSynonymService` inyectan `ISynonymService`.
 * - El rebranding por URL (Fase 5) usa su propio servicio:
 *   `setRebrandingService`/`getRebrandingService` inyectan `IRebrandingService`.
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas).
 * - `loadAppearance` aplica la paleta del tenant vía `applyTheme` (ante 404 aplica
 *   `DEFAULT_THEME`) para que el rebranding sea visible en toda la aplicación.
 * - Cada colección (contenido, catálogo, canales, documentos y sinónimos) mantiene
 *   su propio estado de carga para no bloquear pestañas independientes entre sí.
 */
import { create } from 'zustand';
import type {
  IAppearanceProposal,
  ICatalogItemRead,
  IContentItemRead,
  IDocumentContentRead,
  IDocumentRead,
  IDocumentSearchResult,
  IRebrandingConfigRead,
  ISynonymCreate,
  ISynonymImportRequest,
  ISynonymImportResultRead,
  ISynonymRead,
  ISynonymUpdate,
  ITenantChannelRead,
} from '@/api/types';
import { applyTheme } from '@/core/theme';
import { AppError } from '@/lib/errors';
import type { IDocumentService } from '@/services/documentService';
import type { IRebrandingInput, IRebrandingService } from '@/services/rebrandingService';
import type { ISynonymService } from '@/services/synonymService';
import type {
  ICatalogItemInput,
  IContentItemInput,
  ITenantChannelInput,
  ITenantConfigService,
} from '@/services/tenantConfigService';
import type { IAppTheme } from '@/types/config';

/** Estado de un flujo de configuración del tenant. */
export type TenantConfigStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de configuración del tenant para el bot. */
export interface ITenantConfigState {
  /** Apariencia cargada del tenant (o `null` si aún no está configurada). */
  appearance: IAppTheme | null;
  /** Estado del flujo de apariencia (carga y guardado). */
  appearanceStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de apariencia (o `null`). */
  appearanceError: string | null;

  /** Propuesta de apariencia extraída de una URL de marca (Fase 5). */
  appearanceProposal: IAppearanceProposal | null;
  /** Configuraciones de rebranding guardadas del tenant activo. */
  rebrandingConfigs: IRebrandingConfigRead[];
  /** Estado del flujo de rebranding por URL (extracción y guardado). */
  rebrandingStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de rebranding (o `null`). */
  rebrandingError: string | null;

  /** Contenido estructurado del bot cargado del tenant. */
  contentItems: IContentItemRead[];
  /** Estado del flujo de contenido. */
  contentStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de contenido (o `null`). */
  contentError: string | null;

  /** Catálogo de productos/servicios cargado del tenant. */
  catalogItems: ICatalogItemRead[];
  /** Estado del flujo de catálogo. */
  catalogStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de catálogo (o `null`). */
  catalogError: string | null;

  /** Canales del bot cargados del tenant. */
  channels: ITenantChannelRead[];
  /** Estado del flujo de canales. */
  channelsStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de canales (o `null`). */
  channelsError: string | null;

  /** Documentos ingeridos para la base de conocimiento (RAG) del tenant. */
  documents: IDocumentRead[];
  /** Estado del flujo de documentos ingeridos. */
  documentsStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de documentos (o `null`). */
  documentsError: string | null;

  /** Sinónimos del bot cargados del tenant (normalización de vocabulario). */
  synonyms: ISynonymRead[];
  /** Estado del flujo de sinónimos. */
  synonymsStatus: TenantConfigStatus;
  /** Mensaje del último error del flujo de sinónimos (o `null`). */
  synonymsError: string | null;

  /** Carga la apariencia del tenant y la aplica como tema (404 → tema por defecto). */
  loadAppearance(): Promise<void>;
  /** Guarda la apariencia del tenant (PUT idempotente) y la aplica como tema. */
  saveAppearance(theme: IAppTheme): Promise<void>;
  /** Extrae una propuesta de apariencia desde una URL de marca (Fase 5). */
  extractUrl(url: string): Promise<IAppearanceProposal | null>;
  /** Guarda una configuración de rebranding (re-extrae y aplica los estilos). */
  saveRebranding(input: IRebrandingInput): Promise<IRebrandingConfigRead | null>;
  /** Carga las configuraciones de rebranding guardadas del tenant activo. */
  listRebrandingConfigs(): Promise<void>;
  /** Elimina una configuración de rebranding del tenant activo. */
  deleteRebranding(configId: string): Promise<void>;

  /** Carga el contenido estructurado del bot. */
  listContentItems(): Promise<void>;
  /** Crea un ítem de contenido y lo agrega a la colección. */
  createContentItem(input: IContentItemInput): Promise<void>;
  /** Actualiza un ítem de contenido y refresca la colección. */
  updateContentItem(itemId: string, input: Partial<IContentItemInput>): Promise<void>;
  /** Elimina un ítem de contenido y lo quita de la colección. */
  deleteContentItem(itemId: string): Promise<void>;

  /** Carga el catálogo de productos/servicios del tenant. */
  listCatalogItems(): Promise<void>;
  /** Crea un ítem del catálogo y lo agrega a la colección. */
  createCatalogItem(input: ICatalogItemInput): Promise<void>;
  /** Actualiza un ítem del catálogo y refresca la colección. */
  updateCatalogItem(itemId: string, input: Partial<ICatalogItemInput>): Promise<void>;
  /** Elimina un ítem del catálogo y lo quita de la colección. */
  deleteCatalogItem(itemId: string): Promise<void>;

  /** Carga los canales del bot del tenant. */
  listChannels(): Promise<void>;
  /** Crea un canal del bot y lo agrega a la colección. */
  createChannel(input: ITenantChannelInput): Promise<void>;
  /** Actualiza un canal del bot y refresca la colección. */
  updateChannel(channelId: string, input: Partial<ITenantChannelInput>): Promise<void>;
  /** Elimina un canal del bot y lo quita de la colección. */
  deleteChannel(channelId: string): Promise<void>;

  /** Carga los documentos ingeridos del tenant. */
  listDocuments(): Promise<void>;
  /** Ingiere un archivo local (PDF/TXT/CSV) y lo agrega a la colección. */
  ingestDocumentFile(file: File): Promise<void>;
  /** Ingiere un documento remoto desde una URL y lo agrega a la colección. */
  ingestDocumentUrl(url: string, title?: string): Promise<void>;
  /** Busca documentos por texto libre en la base de conocimiento del tenant. */
  searchDocuments(query: string): Promise<IDocumentSearchResult[]>;
  /** Recupera el contenido completo de un documento ingerido. */
  getDocument(documentId: string): Promise<IDocumentContentRead>;
  /** Elimina un documento ingerido y lo quita de la colección. */
  deleteDocument(documentId: string): Promise<void>;

  /** Carga los sinónimos del bot del tenant. */
  listSynonyms(): Promise<void>;
  /** Crea un sinónimo y lo agrega a la colección. */
  createSynonym(input: ISynonymCreate): Promise<void>;
  /** Actualiza un sinónimo y refresca la colección. */
  updateSynonym(synonymId: string, input: ISynonymUpdate): Promise<void>;
  /** Elimina un sinónimo y lo quita de la colección. */
  deleteSynonym(synonymId: string): Promise<void>;
  /** Importa sinónimos en lote (CSV/JSON) y refresca la colección. */
  importSynonyms(input: ISynonymImportRequest): Promise<ISynonymImportResultRead>;
  /** Exporta los sinónimos como texto CSV o JSON (respuesta cruda del backend). */
  exportSynonyms(format: 'csv' | 'json'): Promise<string>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: ITenantConfigService | null = null;

/**
 * Registra la implementación del servicio de configuración del tenant (composition root).
 * @param implementation - Implementación de `ITenantConfigService` (o `null` en pruebas).
 */
export function setTenantConfigService(implementation: ITenantConfigService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de configuración (o `null`). */
export function getTenantConfigService(): ITenantConfigService | null {
  return service;
}

/** Implementación registrada del servicio de documentos (DI). */
let documentService: IDocumentService | null = null;

/**
 * Registra la implementación del servicio de documentos (composition root).
 * @param implementation - Implementación de `IDocumentService` (o `null` en pruebas).
 */
export function setDocumentService(implementation: IDocumentService | null): void {
  documentService = implementation;
}

/** Devuelve la implementación registrada del servicio de documentos (o `null`). */
export function getDocumentService(): IDocumentService | null {
  return documentService;
}

/** Implementación registrada del servicio de sinónimos (DI). */
let synonymService: ISynonymService | null = null;

/**
 * Registra la implementación del servicio de sinónimos (composition root).
 * @param implementation - Implementación de `ISynonymService` (o `null` en pruebas).
 */
export function setSynonymService(implementation: ISynonymService | null): void {
  synonymService = implementation;
}

/** Devuelve la implementación registrada del servicio de sinónimos (o `null`). */
export function getSynonymService(): ISynonymService | null {
  return synonymService;
}

/** Implementación registrada del servicio de rebranding por URL (DI). */
let rebrandingService: IRebrandingService | null = null;

/**
 * Registra la implementación del servicio de rebranding (composition root).
 * @param implementation - Implementación de `IRebrandingService` (o `null` en pruebas).
 */
export function setRebrandingService(implementation: IRebrandingService | null): void {
  rebrandingService = implementation;
}

/** Devuelve la implementación registrada del servicio de rebranding (o `null`). */
export function getRebrandingService(): IRebrandingService | null {
  return rebrandingService;
}

/** Extrae el mensaje de un error siguiendo la cadena AppError → Error → por defecto. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Store global de configuración del tenant para el bot. */
export const useTenantConfigStore = create<ITenantConfigState>()((set, get) => ({
  appearance: null,
  appearanceStatus: 'idle',
  appearanceError: null,
  appearanceProposal: null,
  rebrandingConfigs: [],
  rebrandingStatus: 'idle',
  rebrandingError: null,

  contentItems: [],
  contentStatus: 'idle',
  contentError: null,

  catalogItems: [],
  catalogStatus: 'idle',
  catalogError: null,

  channels: [],
  channelsStatus: 'idle',
  channelsError: null,

  documents: [],
  documentsStatus: 'idle',
  documentsError: null,

  synonyms: [],
  synonymsStatus: 'idle',
  synonymsError: null,

  loadAppearance: async () => {
    if (service === null) {
      set({
        appearanceStatus: 'error',
        appearanceError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ appearanceStatus: 'loading', appearanceError: null });
    try {
      const appearance = await service.getTenantAppearance();
      // Materializa el tema en la raíz del documento (404 → DEFAULT_THEME dentro de applyTheme).
      applyTheme(appearance);
      set({ appearance, appearanceStatus: 'success', appearanceError: null });
    } catch (error) {
      set({
        appearanceStatus: 'error',
        appearanceError: extractErrorMessage(error, 'No se pudo cargar la apariencia.'),
      });
    }
  },

  saveAppearance: async (theme: IAppTheme) => {
    if (service === null) {
      set({
        appearanceStatus: 'error',
        appearanceError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ appearanceStatus: 'loading', appearanceError: null });
    try {
      const saved = await service.saveTenantAppearance(theme);
      const appearance: IAppTheme = {
        primaryColor: saved.primary_color,
        accentColor: saved.accent_color,
        surfaceColor: saved.surface_color,
        textColor: saved.text_color,
        brandBadge: saved.brand_badge,
        logoUrl: saved.logo_url ?? undefined,
        fontFamily: saved.font_family ?? undefined,
      };
      applyTheme(appearance);
      set({ appearance, appearanceStatus: 'success', appearanceError: null });
    } catch (error) {
      set({
        appearanceStatus: 'error',
        appearanceError: extractErrorMessage(error, 'No se pudo guardar la apariencia.'),
      });
    }
  },

  extractUrl: async (url: string): Promise<IAppearanceProposal | null> => {
    if (rebrandingService === null) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: 'El servicio de rebranding no está disponible.',
      });
      return null;
    }
    set({ rebrandingStatus: 'loading', rebrandingError: null });
    try {
      const proposal = await rebrandingService.extractUrlStyles(url);
      set({ appearanceProposal: proposal, rebrandingStatus: 'success', rebrandingError: null });
      return proposal;
    } catch (error) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: extractErrorMessage(
          error,
          'No se pudieron extraer los estilos de la URL.',
        ),
      });
      return null;
    }
  },

  saveRebranding: async (input: IRebrandingInput): Promise<IRebrandingConfigRead | null> => {
    if (rebrandingService === null) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: 'El servicio de rebranding no está disponible.',
      });
      return null;
    }
    set({ rebrandingStatus: 'loading', rebrandingError: null });
    try {
      const config = await rebrandingService.createRebrandingConfig(input);
      set({
        rebrandingConfigs: [config, ...get().rebrandingConfigs],
        rebrandingStatus: 'success',
        rebrandingError: null,
      });
      return config;
    } catch (error) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: extractErrorMessage(
          error,
          'No se pudo guardar la configuración de rebranding.',
        ),
      });
      return null;
    }
  },

  listRebrandingConfigs: async () => {
    if (rebrandingService === null) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: 'El servicio de rebranding no está disponible.',
      });
      return;
    }
    set({ rebrandingStatus: 'loading', rebrandingError: null });
    try {
      const rebrandingConfigs = await rebrandingService.listRebrandingConfigs();
      set({ rebrandingConfigs, rebrandingStatus: 'success', rebrandingError: null });
    } catch (error) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: extractErrorMessage(
          error,
          'No se pudieron cargar las configuraciones de rebranding.',
        ),
      });
    }
  },

  deleteRebranding: async (configId: string) => {
    if (rebrandingService === null) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: 'El servicio de rebranding no está disponible.',
      });
      return;
    }
    set({ rebrandingStatus: 'loading', rebrandingError: null });
    try {
      await rebrandingService.deleteRebrandingConfig(configId);
      set({
        rebrandingConfigs: get().rebrandingConfigs.filter((config) => config.id !== configId),
        rebrandingStatus: 'success',
        rebrandingError: null,
      });
    } catch (error) {
      set({
        rebrandingStatus: 'error',
        rebrandingError: extractErrorMessage(
          error,
          'No se pudo eliminar la configuración de rebranding.',
        ),
      });
    }
  },

  listContentItems: async () => {
    if (service === null) {
      set({
        contentStatus: 'error',
        contentError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ contentStatus: 'loading', contentError: null });
    try {
      const page = await service.listContentItems();
      set({ contentItems: page.items, contentStatus: 'success', contentError: null });
    } catch (error) {
      set({
        contentStatus: 'error',
        contentError: extractErrorMessage(error, 'No se pudo cargar el contenido.'),
      });
    }
  },

  createContentItem: async (input: IContentItemInput) => {
    if (service === null) {
      set({
        contentStatus: 'error',
        contentError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ contentStatus: 'loading', contentError: null });
    try {
      const item = await service.createContentItem(input);
      set({
        contentItems: [...get().contentItems, item],
        contentStatus: 'success',
        contentError: null,
      });
    } catch (error) {
      set({
        contentStatus: 'error',
        contentError: extractErrorMessage(error, 'No se pudo crear el contenido.'),
      });
    }
  },

  updateContentItem: async (itemId: string, input: Partial<IContentItemInput>) => {
    if (service === null) {
      set({
        contentStatus: 'error',
        contentError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ contentStatus: 'loading', contentError: null });
    try {
      const item = await service.updateContentItem(itemId, input);
      set({
        contentItems: get().contentItems.map((current) => (current.id === itemId ? item : current)),
        contentStatus: 'success',
        contentError: null,
      });
    } catch (error) {
      set({
        contentStatus: 'error',
        contentError: extractErrorMessage(error, 'No se pudo actualizar el contenido.'),
      });
    }
  },

  deleteContentItem: async (itemId: string) => {
    if (service === null) {
      set({
        contentStatus: 'error',
        contentError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ contentStatus: 'loading', contentError: null });
    try {
      await service.deleteContentItem(itemId);
      set({
        contentItems: get().contentItems.filter((current) => current.id !== itemId),
        contentStatus: 'success',
        contentError: null,
      });
    } catch (error) {
      set({
        contentStatus: 'error',
        contentError: extractErrorMessage(error, 'No se pudo eliminar el contenido.'),
      });
    }
  },

  listCatalogItems: async () => {
    if (service === null) {
      set({
        catalogStatus: 'error',
        catalogError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ catalogStatus: 'loading', catalogError: null });
    try {
      const page = await service.listCatalogItems();
      set({ catalogItems: page.items, catalogStatus: 'success', catalogError: null });
    } catch (error) {
      set({
        catalogStatus: 'error',
        catalogError: extractErrorMessage(error, 'No se pudo cargar el catálogo.'),
      });
    }
  },

  createCatalogItem: async (input: ICatalogItemInput) => {
    if (service === null) {
      set({
        catalogStatus: 'error',
        catalogError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ catalogStatus: 'loading', catalogError: null });
    try {
      const item = await service.createCatalogItem(input);
      set({
        catalogItems: [...get().catalogItems, item],
        catalogStatus: 'success',
        catalogError: null,
      });
    } catch (error) {
      set({
        catalogStatus: 'error',
        catalogError: extractErrorMessage(error, 'No se pudo crear el ítem del catálogo.'),
      });
    }
  },

  updateCatalogItem: async (itemId: string, input: Partial<ICatalogItemInput>) => {
    if (service === null) {
      set({
        catalogStatus: 'error',
        catalogError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ catalogStatus: 'loading', catalogError: null });
    try {
      const item = await service.updateCatalogItem(itemId, input);
      set({
        catalogItems: get().catalogItems.map((current) => (current.id === itemId ? item : current)),
        catalogStatus: 'success',
        catalogError: null,
      });
    } catch (error) {
      set({
        catalogStatus: 'error',
        catalogError: extractErrorMessage(error, 'No se pudo actualizar el ítem del catálogo.'),
      });
    }
  },

  deleteCatalogItem: async (itemId: string) => {
    if (service === null) {
      set({
        catalogStatus: 'error',
        catalogError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ catalogStatus: 'loading', catalogError: null });
    try {
      await service.deleteCatalogItem(itemId);
      set({
        catalogItems: get().catalogItems.filter((current) => current.id !== itemId),
        catalogStatus: 'success',
        catalogError: null,
      });
    } catch (error) {
      set({
        catalogStatus: 'error',
        catalogError: extractErrorMessage(error, 'No se pudo eliminar el ítem del catálogo.'),
      });
    }
  },

  listChannels: async () => {
    if (service === null) {
      set({
        channelsStatus: 'error',
        channelsError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ channelsStatus: 'loading', channelsError: null });
    try {
      const page = await service.listChannels();
      set({ channels: page.items, channelsStatus: 'success', channelsError: null });
    } catch (error) {
      set({
        channelsStatus: 'error',
        channelsError: extractErrorMessage(error, 'No se pudieron cargar los canales.'),
      });
    }
  },

  createChannel: async (input: ITenantChannelInput) => {
    if (service === null) {
      set({
        channelsStatus: 'error',
        channelsError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ channelsStatus: 'loading', channelsError: null });
    try {
      const channel = await service.createChannel(input);
      set({
        channels: [...get().channels, channel],
        channelsStatus: 'success',
        channelsError: null,
      });
    } catch (error) {
      set({
        channelsStatus: 'error',
        channelsError: extractErrorMessage(error, 'No se pudo crear el canal.'),
      });
    }
  },

  updateChannel: async (channelId: string, input: Partial<ITenantChannelInput>) => {
    if (service === null) {
      set({
        channelsStatus: 'error',
        channelsError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ channelsStatus: 'loading', channelsError: null });
    try {
      const channel = await service.updateChannel(channelId, input);
      set({
        channels: get().channels.map((current) => (current.id === channelId ? channel : current)),
        channelsStatus: 'success',
        channelsError: null,
      });
    } catch (error) {
      set({
        channelsStatus: 'error',
        channelsError: extractErrorMessage(error, 'No se pudo actualizar el canal.'),
      });
    }
  },

  deleteChannel: async (channelId: string) => {
    if (service === null) {
      set({
        channelsStatus: 'error',
        channelsError: 'La configuración del tenant no está disponible.',
      });
      return;
    }
    set({ channelsStatus: 'loading', channelsError: null });
    try {
      await service.deleteChannel(channelId);
      set({
        channels: get().channels.filter((current) => current.id !== channelId),
        channelsStatus: 'success',
        channelsError: null,
      });
    } catch (error) {
      set({
        channelsStatus: 'error',
        channelsError: extractErrorMessage(error, 'No se pudo eliminar el canal.'),
      });
    }
  },

  listDocuments: async () => {
    if (documentService === null) {
      set({
        documentsStatus: 'error',
        documentsError: 'La base de conocimientos no está disponible.',
      });
      return;
    }
    set({ documentsStatus: 'loading', documentsError: null });
    try {
      const page = await documentService.listDocuments();
      set({ documents: page.items, documentsStatus: 'success', documentsError: null });
    } catch (error) {
      set({
        documentsStatus: 'error',
        documentsError: extractErrorMessage(error, 'No se pudieron cargar los documentos.'),
      });
    }
  },

  ingestDocumentFile: async (file: File) => {
    if (documentService === null) {
      set({
        documentsStatus: 'error',
        documentsError: 'La base de conocimientos no está disponible.',
      });
      return;
    }
    set({ documentsStatus: 'loading', documentsError: null });
    try {
      const result = await documentService.ingestDocumentFile(file);
      set({
        documents: [result.document, ...get().documents],
        documentsStatus: 'success',
        documentsError: null,
      });
    } catch (error) {
      set({
        documentsStatus: 'error',
        documentsError: extractErrorMessage(error, 'No se pudo ingerir el documento.'),
      });
    }
  },

  ingestDocumentUrl: async (url: string, title?: string) => {
    if (documentService === null) {
      set({
        documentsStatus: 'error',
        documentsError: 'La base de conocimientos no está disponible.',
      });
      return;
    }
    set({ documentsStatus: 'loading', documentsError: null });
    try {
      const result = await documentService.ingestDocumentUrl({ url, title });
      set({
        documents: [result.document, ...get().documents],
        documentsStatus: 'success',
        documentsError: null,
      });
    } catch (error) {
      set({
        documentsStatus: 'error',
        documentsError: extractErrorMessage(error, 'No se pudo ingerir la URL.'),
      });
    }
  },

  searchDocuments: async (query: string) => {
    if (documentService === null) {
      set({
        documentsStatus: 'error',
        documentsError: 'La base de conocimientos no está disponible.',
      });
      return [];
    }
    set({ documentsStatus: 'loading', documentsError: null });
    try {
      const results = await documentService.searchDocuments(query);
      set({ documentsStatus: 'success', documentsError: null });
      return results;
    } catch (error) {
      set({
        documentsStatus: 'error',
        documentsError: extractErrorMessage(error, 'No se pudieron buscar los documentos.'),
      });
      return [];
    }
  },

  getDocument: async (documentId: string) => {
    if (documentService === null) {
      set({
        documentsStatus: 'error',
        documentsError: 'La base de conocimientos no está disponible.',
      });
      throw new AppError('La base de conocimientos no está disponible.', 'documents.get', {});
    }
    set({ documentsStatus: 'loading', documentsError: null });
    try {
      const document = await documentService.getDocument(documentId);
      set({ documentsStatus: 'success', documentsError: null });
      return document;
    } catch (error) {
      set({
        documentsStatus: 'error',
        documentsError: extractErrorMessage(error, 'No se pudo recuperar el documento.'),
      });
      throw error;
    }
  },

  deleteDocument: async (documentId: string) => {
    if (documentService === null) {
      set({
        documentsStatus: 'error',
        documentsError: 'La base de conocimientos no está disponible.',
      });
      return;
    }
    set({ documentsStatus: 'loading', documentsError: null });
    try {
      await documentService.deleteDocument(documentId);
      set({
        documents: get().documents.filter((current) => current.id !== documentId),
        documentsStatus: 'success',
        documentsError: null,
      });
    } catch (error) {
      set({
        documentsStatus: 'error',
        documentsError: extractErrorMessage(error, 'No se pudo eliminar el documento.'),
      });
    }
  },

  listSynonyms: async () => {
    if (synonymService === null) {
      set({
        synonymsStatus: 'error',
        synonymsError: 'El servicio de sinónimos no está disponible.',
      });
      return;
    }
    set({ synonymsStatus: 'loading', synonymsError: null });
    try {
      const page = await synonymService.listSynonyms();
      set({ synonyms: page.items, synonymsStatus: 'success', synonymsError: null });
    } catch (error) {
      set({
        synonymsStatus: 'error',
        synonymsError: extractErrorMessage(error, 'No se pudieron cargar los sinónimos.'),
      });
    }
  },

  createSynonym: async (input: ISynonymCreate) => {
    if (synonymService === null) {
      set({
        synonymsStatus: 'error',
        synonymsError: 'El servicio de sinónimos no está disponible.',
      });
      return;
    }
    set({ synonymsStatus: 'loading', synonymsError: null });
    try {
      const created = await synonymService.createSynonym(input);
      set({
        synonyms: [created, ...get().synonyms],
        synonymsStatus: 'success',
        synonymsError: null,
      });
    } catch (error) {
      set({
        synonymsStatus: 'error',
        synonymsError: extractErrorMessage(error, 'No se pudo crear el sinónimo.'),
      });
    }
  },

  updateSynonym: async (synonymId: string, input: ISynonymUpdate) => {
    if (synonymService === null) {
      set({
        synonymsStatus: 'error',
        synonymsError: 'El servicio de sinónimos no está disponible.',
      });
      return;
    }
    set({ synonymsStatus: 'loading', synonymsError: null });
    try {
      const updated = await synonymService.updateSynonym(synonymId, input);
      set({
        synonyms: get().synonyms.map((current) => (current.id === synonymId ? updated : current)),
        synonymsStatus: 'success',
        synonymsError: null,
      });
    } catch (error) {
      set({
        synonymsStatus: 'error',
        synonymsError: extractErrorMessage(error, 'No se pudo actualizar el sinónimo.'),
      });
    }
  },

  deleteSynonym: async (synonymId: string) => {
    if (synonymService === null) {
      set({
        synonymsStatus: 'error',
        synonymsError: 'El servicio de sinónimos no está disponible.',
      });
      return;
    }
    set({ synonymsStatus: 'loading', synonymsError: null });
    try {
      await synonymService.deleteSynonym(synonymId);
      set({
        synonyms: get().synonyms.filter((current) => current.id !== synonymId),
        synonymsStatus: 'success',
        synonymsError: null,
      });
    } catch (error) {
      set({
        synonymsStatus: 'error',
        synonymsError: extractErrorMessage(error, 'No se pudo eliminar el sinónimo.'),
      });
    }
  },

  importSynonyms: async (input: ISynonymImportRequest) => {
    if (synonymService === null) {
      set({
        synonymsStatus: 'error',
        synonymsError: 'El servicio de sinónimos no está disponible.',
      });
      throw new AppError('El servicio de sinónimos no está disponible.', 'synonyms.import', {});
    }
    set({ synonymsStatus: 'loading', synonymsError: null });
    try {
      const result = await synonymService.importSynonyms(input);
      if (result.imported > 0) {
        // Refresca la colección para reflejar los términos importados.
        const page = await synonymService.listSynonyms();
        set({ synonyms: page.items, synonymsStatus: 'success', synonymsError: null });
      } else {
        set({ synonymsStatus: 'success', synonymsError: null });
      }
      return result;
    } catch (error) {
      set({
        synonymsStatus: 'error',
        synonymsError: extractErrorMessage(error, 'No se pudo importar el archivo.'),
      });
      throw error;
    }
  },

  exportSynonyms: async (format: 'csv' | 'json') => {
    if (synonymService === null) {
      set({
        synonymsStatus: 'error',
        synonymsError: 'El servicio de sinónimos no está disponible.',
      });
      throw new AppError('El servicio de sinónimos no está disponible.', 'synonyms.export', {});
    }
    set({ synonymsStatus: 'loading', synonymsError: null });
    try {
      const content = await synonymService.exportSynonyms(format);
      set({ synonymsStatus: 'success', synonymsError: null });
      return content;
    } catch (error) {
      set({
        synonymsStatus: 'error',
        synonymsError: extractErrorMessage(error, 'No se pudo exportar el archivo.'),
      });
      throw error;
    }
  },

  reset: () =>
    set({
      appearance: null,
      appearanceStatus: 'idle',
      appearanceError: null,
      appearanceProposal: null,
      rebrandingConfigs: [],
      rebrandingStatus: 'idle',
      rebrandingError: null,
      contentItems: [],
      contentStatus: 'idle',
      contentError: null,
      catalogItems: [],
      catalogStatus: 'idle',
      catalogError: null,
      channels: [],
      channelsStatus: 'idle',
      channelsError: null,
      documents: [],
      documentsStatus: 'idle',
      documentsError: null,
      synonyms: [],
      synonymsStatus: 'idle',
      synonymsError: null,
    }),
}));
