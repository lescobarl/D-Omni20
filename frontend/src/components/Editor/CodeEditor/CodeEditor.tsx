/**
 * Editor de código de la landing compilada (Monaco Editor, carga diferida).
 *
 * Contrato:
 * - Muestra la representación compilada de la landing en modo solo lectura.
 * - Deriva el código mediante el hook `useLandingCode` (cálculo memoizado).
 * - Carga Monaco de forma diferida (`React.lazy`): mantiene el bundle de Monaco (~4 MB) fuera de
 *   la ruta crítica de arranque para no bloquear el primer renderizado de la aplicación.
 * - Mientras Monaco carga muestra el código como `<pre><code>` (mismo contrato de tests y mejora
 *   progresiva de UX: el código aparece al instante y se actualiza al editor al estar listo).
 * - El contenedor exterior no lleva `aria-label`: el `<aside>` de `EditorLayout` ya lo nombra
 *   como "Editor de código" (evita el riesgo de `aria-prohibited-attr` de axe).
 */
import { Suspense, lazy, type ReactElement } from 'react';
import { useLandingCode } from '@/hooks/useLandingCode';

/** Editor Monaco cargado de forma diferida (solo se descarga cuando el panel se monta). */
const MonacoCodeEditor = lazy(() => import('./MonacoCodeEditor'));

/**
 * Código de respaldo que se muestra mientras Monaco carga de forma diferida.
 * @param props - Propiedades del respaldo (código a mostrar).
 */
function CodeFallback({ code }: { code: string }): ReactElement {
  return (
    <pre className="h-full overflow-auto whitespace-pre bg-slate-900 p-3 font-mono text-xs text-slate-200">
      <code>{code}</code>
    </pre>
  );
}

/** Panel que muestra el código generado de la landing. */
export function CodeEditor(): ReactElement {
  const code = useLandingCode();

  return (
    <div className="flex h-full flex-col">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Código
      </h2>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<CodeFallback code={code} />}>
          <MonacoCodeEditor code={code} />
        </Suspense>
      </div>
    </div>
  );
}
