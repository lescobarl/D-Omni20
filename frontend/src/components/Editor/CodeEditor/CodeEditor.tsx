/**
 * Editor de código de la landing compilada.
 *
 * Contrato:
 * - Muestra la representación compilada de la landing (solo lectura en Fase 1).
 * - Deriva el código mediante el hook `useLandingCode` (cálculo memoizado).
 * - En fases posteriores se integrará Monaco Editor.
 */
import type { ReactElement } from 'react';
import { useLandingCode } from '@/hooks/useLandingCode';

/** Panel que muestra el código generado de la landing. */
export function CodeEditor(): ReactElement {
  const code = useLandingCode();

  return (
    <div className="flex h-full flex-col">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Código
      </h2>
      <pre className="flex-1 overflow-auto bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
