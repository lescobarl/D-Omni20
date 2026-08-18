/**
 * Store de la librería de bloques (catálogo y filtros).
 *
 * Contrato:
 * - Estado actualizado de forma inmutable (sin mutación de referencias previas).
 * - `catalog` referencia el catálogo inmutable `BLOCK_CATALOG`.
 * - Los filtros (categoría y búsqueda) preparan la UX de la Fase 5.
 */
import { create } from 'zustand';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import type { BlockCategory, IBlockDefinition } from '@/types/editor';

/** Filtro de categoría permitido en la librería. */
export type CategoryFilter = BlockCategory | 'all';

/** Contrato del store de la librería de bloques. */
export interface IBlocksLibraryState {
  /** Catálogo inmutable de bloques disponibles. */
  catalog: readonly IBlockDefinition[];
  /** Categoría activa del filtro (o `all` para mostrar todas). */
  activeCategory: CategoryFilter;
  /** Consulta de búsqueda por nombre o descripción. */
  searchQuery: string;
  /** Establece la categoría activa del filtro. */
  setActiveCategory(category: CategoryFilter): void;
  /** Establece la consulta de búsqueda. */
  setSearchQuery(query: string): void;
  /** Reinicia filtros y búsqueda a los valores por defecto. */
  reset(): void;
}

/** Categoría de filtro por defecto: todas las categorías. */
export const DEFAULT_ACTIVE_CATEGORY: CategoryFilter = 'all';

/** Store de la librería de bloques del editor. */
export const useBlocksLibraryStore = create<IBlocksLibraryState>()((set) => ({
  catalog: BLOCK_CATALOG,
  activeCategory: DEFAULT_ACTIVE_CATEGORY,
  searchQuery: '',
  setActiveCategory: (category) => set({ activeCategory: category }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  reset: () => set({ activeCategory: DEFAULT_ACTIVE_CATEGORY, searchQuery: '' }),
}));
