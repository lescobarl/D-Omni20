/**
 * Contexto de atribución de landing para los workflows de conversión.
 *
 * Contrato:
 * - Los workflows (checkout, leads, cotizaciones y citas) se montan siempre
 *   dentro del editor (`WorkflowPanel`), por lo que pueden leer la landing en
 *   edición mediante `useEditorStoreContext()((s) => s.landing)`.
 * - `resolveLandingContext` devuelve el hilo compartido `{ landing_id,
 *   campaign_id }` SOLO cuando la landing tiene una campaña configurada
 *   (`campaignId` no vacío). Esto evita atribuir conversiones a landings
 *   locales sin campaña y mantiene deterministas los tests existentes (la
 *   landing por defecto usa `campaignId: ''` y un `id` UUID no determinista).
 * - Para checkout/leads el contexto se fusiona en `metadata` (el backend
 *   persiste `metadata_json`). Para cotizaciones/citas el backend no expone un
 *   canal de metadatos, por lo que el contexto se transporta en campos
 *   opcionales del input de dominio que NO se transmiten al DTO del backend.
 */
import type { ILandingConfig } from '@/types/editor';
import { useEditorStoreContext } from '@/store/editorStoreContext';

/** Hilo compartido de atribución de una conversión a su landing y campaña. */
export type ILandingContext = {
  /** Identificador de la landing persistida (snake_case). */
  landing_id: string;
  /** Identificador de la campaña de la landing (snake_case). */
  campaign_id: string;
};

/**
 * Lee la landing en edición desde el contexto del editor.
 * @returns La landing activa (por defecto la del store global del editor).
 */
export function useCurrentLanding(): ILandingConfig {
  return useEditorStoreContext()((state) => state.landing);
}

/**
 * Resuelve el contexto de atribución de la landing actual.
 * @param landing Landing en edición.
 * @returns `{ landing_id, campaign_id }` si la landing tiene campaña
 *   configurada; `null` en caso contrario (landing local sin campaña).
 */
export function resolveLandingContext(
  landing: ILandingConfig,
): ILandingContext | null {
  if (!landing.id || landing.campaignId.trim() === '') return null;
  return {
    landing_id: landing.id,
    campaign_id: landing.campaignId,
  };
}
