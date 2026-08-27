/**
 * Store del Marketplace de Templates.
 *
 * Contrato:
 * - Registro de servicios por DI: `setMarketplaceService`/`getMarketplaceService` inyectan la
 *   implementación `IMarketplaceService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `fetchTemplates`/`importTemplate` pasan a estado de error
 *   para que la UI conviva sin la dependencia (p. ej. en pruebas).
 * - `fetchTemplates` carga el catálogo (opcional por categoría) y no toca el estado de
 *   importación; recalcula las categorías disponibles a partir del resultado.
 * - `importTemplate` requiere una campaña (se toma del editor vía `landing.campaignId`);
 *   si está vacía, degrada a error sin invocar el servicio.
 */
import { create } from 'zustand';
import type { IMarketplaceTemplateRead } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { IMarketplaceService } from '@/services/marketplaceService';

/** Estado del flujo de carga del catálogo del marketplace. */
export type MarketplaceStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store del marketplace. */
export interface IMarketplaceState {
  /** Templates del catálogo cargados. */
  templates: IMarketplaceTemplateRead[];
  /** Estado actual de la carga del catálogo. */
  status: MarketplaceStatus;
  /** Mensaje del último error (o `null`). */
  error: string | null;
  /** Categorías presentes en el catálogo cargado (para el filtro). */
  categories: string[];
  /** Categoría activa del filtro (o `null` para todas). */
  activeCategory: string | null;
  /** Identificador del template en proceso de importación (o `null`). */
  importingId: string | null;
  /** Identificador del template importado en la última operación exitosa (o `null`). */
  importedTemplateId: string | null;
  /** Identificador de la landing generada en la última importación (o `null`). */
  lastImportedLandingId: string | null;
  /** Carga el catálogo del marketplace (opcional por categoría). */
  fetchTemplates(): Promise<void>;
  /** Fija la categoría activa del filtro y recarga el catálogo. */
  setCategory(category: string | null): Promise<void>;
  /** Importa un template a una campaña (genera una landing en el backend). */
  importTemplate(templateId: string, campaignId: string, name?: string): Promise<void>;
  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IMarketplaceService | null = null;

/**
 * Registra la implementación del servicio del marketplace (composition root).
 * @param implementation - Implementación de `IMarketplaceService` (o `null` en pruebas).
 */
export function setMarketplaceService(implementation: IMarketplaceService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio del marketplace (o `null`). */
export function getMarketplaceService(): IMarketplaceService | null {
  return service;
}

/** Mensaje por defecto cuando el error no es una instancia de `Error`. */
const UNKNOWN_ERROR_MESSAGE = 'No se pudo cargar el marketplace. Inténtalo de nuevo.';

/** Store global del marketplace de templates. */
export const useMarketplaceStore = create<IMarketplaceState>()((set, get) => ({
  templates: [],
  status: 'idle',
  error: null,
  categories: [],
  activeCategory: null,
  importingId: null,
  importedTemplateId: null,
  lastImportedLandingId: null,

  fetchTemplates: async () => {
    if (service === null) {
      set({ status: 'error', error: 'El marketplace no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const templates = await service.list(get().activeCategory ?? undefined);
      const categories = [...new Set(templates.map((template) => template.category))].sort((a, b) =>
        a.localeCompare(b),
      );
      set({ templates, categories, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error:
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : UNKNOWN_ERROR_MESSAGE,
      });
    }
  },

  setCategory: async (category: string | null) => {
    set({ activeCategory: category });
    await get().fetchTemplates();
  },

  importTemplate: async (templateId: string, campaignId: string, name?: string) => {
    if (campaignId.trim() === '') {
      set({ error: 'Selecciona una campaña para importar el template.' });
      return;
    }
    if (service === null) {
      set({ error: 'El marketplace no está disponible.' });
      return;
    }
    set({ importingId: templateId, error: null });
    try {
      const response = await service.importTemplate(templateId, campaignId.trim(), name);
      set({
        importingId: null,
        importedTemplateId: response.template.id,
        lastImportedLandingId: response.landing_id,
        error: null,
      });
    } catch (error) {
      set({
        importingId: null,
        error:
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'No se pudo importar el template.',
      });
    }
  },

  reset: () =>
    set({
      templates: [],
      status: 'idle',
      error: null,
      categories: [],
      activeCategory: null,
      importingId: null,
      importedTemplateId: null,
      lastImportedLandingId: null,
    }),
}));
