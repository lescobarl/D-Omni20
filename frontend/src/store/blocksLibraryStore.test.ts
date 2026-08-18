/**
 * Pruebas del store de la librería de bloques con tests de inmutabilidad.
 *
 * Contrato:
 * - `catalog` referencia el catálogo inmutable `BLOCK_CATALOG`.
 * - Los filtros (categoría y búsqueda) actualizan sin mutar el estado previo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import { useBlocksLibraryStore } from '@/store/blocksLibraryStore';

describe('blocksLibraryStore', () => {
  beforeEach(() => {
    useBlocksLibraryStore.getState().reset();
  });

  it('inicia con el catálogo completo, categoría all y búsqueda vacía', () => {
    const state = useBlocksLibraryStore.getState();
    expect(state.catalog).toBe(BLOCK_CATALOG);
    expect(state.activeCategory).toBe('all');
    expect(state.searchQuery).toBe('');
  });

  it('filtra por categoría sin mutar el estado previo (inmutabilidad)', () => {
    const previous = useBlocksLibraryStore.getState();
    useBlocksLibraryStore.getState().setActiveCategory('services');

    const current = useBlocksLibraryStore.getState();
    expect(current.activeCategory).toBe('services');
    expect(previous.activeCategory).toBe('all');
    expect(previous).not.toBe(current);
  });

  it('actualiza la búsqueda y conserva la referencia inmutable del catálogo', () => {
    const previousCatalog = useBlocksLibraryStore.getState().catalog;
    useBlocksLibraryStore.getState().setSearchQuery('calculadora');

    const state = useBlocksLibraryStore.getState();
    expect(state.searchQuery).toBe('calculadora');
    expect(state.catalog).toBe(previousCatalog);
  });

  it('reinicia filtros y búsqueda a los valores por defecto', () => {
    const store = useBlocksLibraryStore.getState();
    store.setActiveCategory('hero');
    store.setSearchQuery('video');

    useBlocksLibraryStore.getState().reset();
    const state = useBlocksLibraryStore.getState();
    expect(state.activeCategory).toBe('all');
    expect(state.searchQuery).toBe('');
    expect(state.catalog).toBe(BLOCK_CATALOG);
  });
});
