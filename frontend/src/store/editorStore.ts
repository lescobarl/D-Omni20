/**
 * Store global del editor con persistencia selectiva.
 *
 * Contrato:
 * - Estado actualizado de forma inmutable (sin mutación de referencias previas).
 * - Persiste únicamente `landing` en `localStorage` (`partialize`).
 * - `createDefaultLanding` es la fábrica de estado inicial por defecto.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IBlockDefinition, IEditorState, ILandingConfig } from '@/types/editor';
import { createBlockInstance } from '@/core/blocks';

/**
 * Crea la configuración por defecto de una landing en blanco.
 * @returns Configuración inicial funcional (fábrica, sin referencias compartidas).
 */
export function createDefaultLanding(): ILandingConfig {
  return {
    campaignId: '',
    title: 'Nueva Landing',
    workflowType: 'direct_checkout',
    blocks: [],
  };
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

      reset: () => set({ landing: createDefaultLanding(), selectedBlockId: null }),
    }),
    {
      name: 'omnibotia-editor',
      partialize: (state) => ({ landing: state.landing }),
    },
  ),
);
