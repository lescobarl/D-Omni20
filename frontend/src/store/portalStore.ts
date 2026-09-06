/**
 * Store del configurador de páginas del Portal del Cliente (modo portal).
 *
 * Contrato:
 * - Es un superset de `IEditorState`: expone `landing` (con `title` y `blocks`
 *   como array) para que el configurador único reutilice los mismos componentes
 *   de tri-panel vía `EditorStoreContext`.
 * - Añade campos propios del portal: `slug`, `pageId` y `published`.
 * - Serializa/deserializa entre el formato de array del editor y el formato
 *   `dict` que espera el backend (`blocks` como objeto con `title` y `blocks`).
 * - Persiste únicamente la configuración del portal en `localStorage`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IBlockDefinition, IEditorState, ILandingConfig, WorkflowType } from '@/types/editor';
import { createBlockInstance } from '@/core/blocks';
import type { IPortalService } from '@/services/portalService';
import { uuidv4 } from '@/utils/uuid';

/** Estado del store del portal (superset de `IEditorState`). */
export interface IPortalState extends IEditorState {
  /** Slug público de la página del portal (p. ej. `mi-empresa`). */
  slug: string;
  /** Identificador de la página persistida en el backend (si existe). */
  pageId: string | null;
  /** Indica si la página está publicada en el backend. */
  published: boolean;
  /** Cambia el slug de la página. */
  setSlug(slug: string): void;
  /** Marca la página como publicada/despublicada. */
  setPublished(published: boolean): void;
  /** Registra el identificador de la página persistida. */
  setPageId(pageId: string | null): void;
  /** Serializa la configuración al formato `dict` del backend. */
  toBackendBlocks(): Record<string, unknown>;
  /** Reemplaza la configuración desde el formato `dict` del backend. */
  applyBackendBlocks(raw: Record<string, unknown>): void;
}

/**
 * Crea la configuración por defecto de una página del portal en blanco.
 * @returns Configuración inicial funcional (fábrica, sin referencias compartidas).
 */
export function createDefaultPortal(): ILandingConfig {
  return {
    id: uuidv4(),
    campaignId: '',
    title: 'Nuevo Portal',
    workflowType: 'direct_checkout',
    blocks: [],
  };
}

/**
 * Serializa la configuración del portal al formato `dict` del backend.
 * El backend espera `blocks` como un objeto con `title` y `blocks` (array).
 * @param landing Configuración del portal en edición.
 * @returns Objeto serializable para el backend.
 */
export function serializePortalConfig(landing: ILandingConfig): Record<string, unknown> {
  return {
    title: landing.title,
    blocks: landing.blocks.map((block) => ({
      instance_id: block.instance_id,
      block_id: block.block_id,
      type: block.type,
      name: block.name,
      config: block.config,
    })),
  };
}

/**
 * Deserializa la configuración del portal desde el formato `dict` del backend.
 * @param raw Objeto devuelto por el backend (con `title` y `blocks`).
 * @returns Configuración del portal en formato de editor.
 */
export function deserializePortalConfig(raw: Record<string, unknown>): ILandingConfig {
  const title = typeof raw.title === 'string' ? raw.title : 'Nuevo Portal';
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = rawBlocks
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .map((entry) => ({
      instance_id: typeof entry.instance_id === 'string' ? entry.instance_id : uuidv4(),
      block_id: typeof entry.block_id === 'string' ? entry.block_id : 'hero',
      type: (typeof entry.type === 'string'
        ? entry.type
        : 'hero') as ILandingConfig['blocks'][number]['type'],
      name: typeof entry.name === 'string' ? entry.name : 'Bloque',
      config:
        typeof entry.config === 'object' && entry.config !== null
          ? (entry.config as Record<string, unknown>)
          : {},
    }));
  return {
    id: uuidv4(),
    campaignId: '',
    title,
    workflowType: 'direct_checkout',
    blocks,
  };
}

/** Servicio de páginas del portal registrado por el composition root (DI). */
let portalService: IPortalService | null = null;

/**
 * Registra la implementación del servicio de páginas del portal.
 * @param service Implementación a inyectar (o `null` para desregistrar).
 */
export function setPortalService(service: IPortalService | null): void {
  portalService = service;
}

/**
 * Devuelve el servicio de páginas del portal registrado.
 * @returns La implementación inyectada o `null` si no se ha registrado.
 */
export function getPortalService(): IPortalService | null {
  return portalService;
}

/** Store del configurador del portal con persistencia selectiva. */
export const usePortalStore = create<IPortalState>()(
  persist(
    (set, get) => ({
      landing: createDefaultPortal(),
      selectedBlockId: null,
      slug: '',
      pageId: null,
      published: false,

      addBlock: (definition: IBlockDefinition) =>
        set((state) => ({
          landing: {
            ...state.landing,
            blocks: [...state.landing.blocks, createBlockInstance(definition)],
          },
        })),

      addBlockAt: (definition: IBlockDefinition, index: number) =>
        set((state) => {
          const clamped = Math.max(0, Math.min(index, state.landing.blocks.length));
          const blocks = [...state.landing.blocks];
          blocks.splice(clamped, 0, createBlockInstance(definition));
          return { landing: { ...state.landing, blocks } };
        }),

      removeBlock: (instanceId: string) =>
        set((state) => ({
          landing: {
            ...state.landing,
            blocks: state.landing.blocks.filter((block) => block.instance_id !== instanceId),
          },
          selectedBlockId: state.selectedBlockId === instanceId ? null : state.selectedBlockId,
        })),

      moveBlock: (instanceId: string, direction: 'up' | 'down') =>
        set((state) => {
          const index = state.landing.blocks.findIndex((block) => block.instance_id === instanceId);
          if (index === -1) {
            return state;
          }
          const targetIndex = direction === 'up' ? index - 1 : index + 1;
          if (targetIndex < 0 || targetIndex >= state.landing.blocks.length) {
            return state;
          }
          const blocks = [...state.landing.blocks];
          const [moved] = blocks.splice(index, 1);
          blocks.splice(targetIndex, 0, moved);
          return { landing: { ...state.landing, blocks } };
        }),

      reorderBlock: (activeInstanceId: string, overInstanceId: string) =>
        set((state) => {
          if (activeInstanceId === overInstanceId) {
            return state;
          }
          const blocks = state.landing.blocks;
          const fromIndex = blocks.findIndex((block) => block.instance_id === activeInstanceId);
          const toIndex = blocks.findIndex((block) => block.instance_id === overInstanceId);
          if (fromIndex === -1 || toIndex === -1) {
            return state;
          }
          const next = [...blocks];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { landing: { ...state.landing, blocks: next } };
        }),

      selectBlock: (instanceId: string | null) => set({ selectedBlockId: instanceId }),

      updateBlockConfig: (instanceId: string, patch: Record<string, unknown>) =>
        set((state) => ({
          landing: {
            ...state.landing,
            blocks: state.landing.blocks.map((block) =>
              block.instance_id === instanceId
                ? { ...block, config: { ...block.config, ...patch } }
                : block,
            ),
          },
        })),

      setLandingTitle: (title: string) =>
        set((state) => ({
          landing: { ...state.landing, title },
        })),

      setWorkflowType: (workflowType: WorkflowType) =>
        set((state) => ({
          landing: { ...state.landing, workflowType },
        })),

      setLanding: (landing: ILandingConfig) => set({ landing, selectedBlockId: null }),

      reset: () =>
        set({
          landing: createDefaultPortal(),
          selectedBlockId: null,
          slug: '',
          pageId: null,
          published: false,
        }),

      setSlug: (slug: string) => set({ slug }),

      setPublished: (published: boolean) => set({ published }),

      setPageId: (pageId: string | null) => set({ pageId }),

      toBackendBlocks: () => serializePortalConfig(get().landing),

      applyBackendBlocks: (raw: Record<string, unknown>) =>
        set({
          landing: deserializePortalConfig(raw),
          selectedBlockId: null,
        }),
    }),
    {
      name: 'omnibotia-portal',
      partialize: (state) => ({
        landing: state.landing,
        slug: state.slug,
        pageId: state.pageId,
        published: state.published,
      }),
    },
  ),
);
