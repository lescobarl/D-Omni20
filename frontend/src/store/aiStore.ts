/**
 * Store del asistente IA de generación de landings.
 *
 * Contrato:
 * - Registro de servicios por DI: `setAiService`/`getAiService` inyectan la
 *   implementación `IAiService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `generate` pasa a estado de error para que
 *   la UI conviva sin la dependencia (p. ej. en pruebas de layout).
 */
import { create } from 'zustand';
import { DEFAULT_WORKFLOW_TYPE } from '@/core/aiConfig';
import { AppError } from '@/lib/errors';
import type { IAiGenerationResult, IAiService } from '@/services/aiService';
import type { WorkflowType } from '@/types/editor';

/** Estado del flujo de generación IA. */
export type AiStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store del asistente IA. */
export interface IAiState {
  /** Estado actual del flujo de generación. */
  status: AiStatus;
  /** Prompt introducido por el usuario. */
  prompt: string;
  /** Workflow seleccionado para la generación. */
  workflowType: WorkflowType;
  /** Última generación exitosa (o `null` si aún no hay). */
  result: IAiGenerationResult | null;
  /** Mensaje del último error de generación (o `null`). */
  error: string | null;
  /** Actualiza el prompt sin disparar la generación. */
  setPrompt(prompt: string): void;
  /** Cambia el workflow de la generación. */
  setWorkflowType(workflowType: WorkflowType): void;
  /** Ejecuta la generación IA con el prompt y workflow actuales. */
  generate(): Promise<void>;
  /** Descarta el resultado y vuelve al estado inicial. */
  reset(): void;
}

/** Servicio IA registrado por el composition root (DI). */
let aiService: IAiService | null = null;

/**
 * Registra la implementación del servicio IA.
 * @param service Implementación a inyectar (o `null` para desregistrar).
 */
export function setAiService(service: IAiService | null): void {
  aiService = service;
}

/**
 * Devuelve el servicio IA registrado.
 * @returns La implementación inyectada o `null` si no se ha registrado.
 */
export function getAiService(): IAiService | null {
  return aiService;
}

/** Store del asistente IA de generación de landings. */
export const useAiStore = create<IAiState>()((set, get) => ({
  status: 'idle',
  prompt: '',
  workflowType: DEFAULT_WORKFLOW_TYPE,
  result: null,
  error: null,

  setPrompt: (prompt: string) => set({ prompt, error: null }),

  setWorkflowType: (workflowType: WorkflowType) => set({ workflowType }),

  generate: async () => {
    const { prompt, workflowType } = get();
    if (!prompt.trim()) {
      set({ status: 'error', error: 'Escribe un prompt antes de generar.' });
      return;
    }
    const service = getAiService();
    if (service === null) {
      set({ status: 'error', error: 'El asistente IA no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const result = await service.generate(prompt.trim(), workflowType);
      set({ status: 'success', result });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudo generar la landing.';
      set({ status: 'error', error: message });
    }
  },

  reset: () => set({ status: 'idle', prompt: '', result: null, error: null }),
}));
