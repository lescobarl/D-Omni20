/**
 * Hook de derivación del código compilado de la landing.
 *
 * Contrato:
 * - Lee la landing del store y memoiza la compilación (`useMemo`).
 * - Solo recalcula el código cuando cambia la referencia de `landing`.
 */
import { useMemo } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { generateLandingCode } from '@/core/landingCode';

/**
 * Devuelve el HTML compilado de la landing en edición.
 *
 * @example
 * ```tsx
 * const code = useLandingCode();
 * ```
 *
 * @returns La representación HTML funcional de la landing.
 */
export function useLandingCode(): string {
  const landing = useEditorStore((state) => state.landing);
  return useMemo(() => generateLandingCode(landing), [landing]);
}
