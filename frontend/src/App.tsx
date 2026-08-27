/**
 * Componente raíz de la aplicación.
 *
 * Contrato:
 * - Recibe la configuración validada por inyección de dependencias.
 * - Muestra la cabecera con datos de entorno y el layout tri-panel del editor.
 */
import type { ReactElement } from 'react';
import type { IAppConfig } from '@/types/config';
import { EditorLayout } from '@/components/Editor/EditorLayout';
import { useEditorStore } from '@/store/editorStore';

interface IAppProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
}

/**
 * Componente raíz de OmniBotIA Studio.
 *
 * @example
 * ```tsx
 * import { createTestConfig } from '@/test/config';
 *
 * <App config={createTestConfig()} />;
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La aplicación renderizada con cabecera y editor.
 */
export default function App({ config }: IAppProps): ReactElement {
  const landingTitle = useEditorStore((state) => state.landing.title);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{config.appName}</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full bg-brand-100 px-3 py-1 font-medium text-brand-700">
              {config.appEnv}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
              Tenant: {config.tenantId}
            </span>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-400">Landing: {landingTitle}</p>
      </header>
      <EditorLayout config={config} />
    </div>
  );
}
