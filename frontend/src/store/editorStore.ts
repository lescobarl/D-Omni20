/**
 * Store global del editor con persistencia selectiva.
 *
 * Contrato:
 * - Estado actualizado de forma inmutable (sin mutación de referencias previas).
 * - Persiste únicamente `landing` en `localStorage` (`partialize`).
 * - `createDefaultLanding` es la fábrica de estado inicial por defecto.
 * - Expone el DI del servicio de landings (`setLandingService`/`getLandingService`)
 *   y los helpers de serialización/deserialización hacia el formato `dict` del backend.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  IBlockDefinition,
  IEditorState,
  ILandingConfig,
  WorkflowType,
} from '@/types/editor';
import { createBlockInstance } from '@/core/blocks';
import type { ILandingService } from '@/services/landingService';
import { uuidv4 } from '@/utils/uuid';

/**
 * Crea la configuración por defecto de una landing en blanco.
 * @returns Configuración inicial funcional (fábrica, sin referencias compartidas).
 */
export function createDefaultLanding(): ILandingConfig {
  return {
    id: uuidv4(),
    campaignId: '',
    title: 'Nueva Landing',
    workflowType: 'direct_checkout',
    blocks: [],
  };
}

/**
 * Serializa la configuración de la landing al formato `dict` del backend.
 *
 * A diferencia de `serializeLandingConfig` de `core/landingCode.ts` (que alimenta el
 * motor de compilación y descarta los identificadores), esta variante conserva
 * `instance_id` y `block_id` para permitir un round-trip fiel editor ↔ backend:
 * el backend almacena `config` como un `JSONType` sin validar y el compilador solo
 * lee `block.type`/`block.config`, por lo que enriquecer el objeto es seguro.
 *
 * @param landing Configuración de la landing en edición.
 * @returns Objeto serializable para persistir en el backend.
 */
export function serializeLandingConfig(landing: ILandingConfig): Record<string, unknown> {
  return {
    title: landing.title,
    workflowType: landing.workflowType,
    blocks: landing.blocks.map((block) => ({
      instance_id: block.instance_id,
      block_id: block.block_id,
      type: block.type,
      name: block.name,
      config: { ...block.config },
    })),
  };
}

/**
 * Deserializa la configuración de la landing desde el formato `dict` del backend.
 * @param raw Objeto devuelto por el backend (con `title`, `workflowType` y `blocks`).
 * @returns Configuración de la landing en formato de editor.
 */
export function deserializeLandingConfig(raw: Record<string, unknown>): ILandingConfig {
  const title = typeof raw.title === 'string' ? raw.title : 'Nueva Landing';
  const workflowType =
    typeof raw.workflowType === 'string'
      ? (raw.workflowType as ILandingConfig['workflowType'])
      : 'direct_checkout';
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = rawBlocks
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      instance_id:
        typeof entry.instance_id === 'string' ? entry.instance_id : uuidv4(),
      block_id: typeof entry.block_id === 'string' ? entry.block_id : 'hero',
      type: (typeof entry.type === 'string' ? entry.type : 'hero') as ILandingConfig['blocks'][number]['type'],
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
    workflowType,
    blocks,
  };
}

/** Servicio de landings registrado por el composition root (DI). */
let landingService: ILandingService | null = null;

/**
 * Registra la implementación del servicio de landings.
 * @param service Implementación a inyectar (o `null` para desregistrar).
 */
export function setLandingService(service: ILandingService | null): void {
  landingService = service;
}

/**
 * Devuelve el servicio de landings registrado.
 * @returns La implementación inyectada o `null` si no se ha registrado.
 */
export function getLandingService(): ILandingService | null {
  return landingService;
}

/** Store global del editor con persistencia selectiva de la landing. */
export const useEditorStore = create<IEditorState>()(
  persist(
    (set) => ({
      landing: createDefaultLanding(),
      selectedBlockId: null,

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

      reset: () => set({ landing: createDefaultLanding(), selectedBlockId: null }),
    }),
    {
      name: 'omnibotia-editor',
      partialize: (state) => ({ landing: state.landing }),
    },
  ),
);
