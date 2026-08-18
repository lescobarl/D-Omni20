/**
 * Editor de código basado en Monaco, cargado de forma diferida.
 *
 * Contrato:
 * - Este módulo es el único que importa la instancia real de Monaco (vía `setupMonaco`), de modo
 *   que su carga se difiere hasta que el panel de código se monta (React.lazy desde CodeEditor).
 * - Al importarse configura el worker y el loader locales (sin CDN) y registra el lenguaje Jinja2
 *   en `beforeMount` con el tema oscuro `vs-dark`.
 * - Recibe el código compilado por props para conservar la reactividad del hook `useLandingCode`.
 */
import type { ReactElement } from 'react';
import Editor, { type BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor/editor/editor.api';
import { JINJA2_LANGUAGE_ID, registerJinja2Language } from '@/monaco/jinja2';
import '@/monaco/setupMonaco';

/** Opciones del editor: solo lectura, tema oscuro y adaptación automática al contenedor. */
const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  fontSize: 12,
  lineHeight: 18,
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  renderLineHighlight: 'none',
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
};

/** Propiedades del editor diferido de código. */
interface IMonacoCodeEditorProps {
  /** Código compilado de la landing que se muestra en el editor. */
  code: string;
}

/** Registra el lenguaje Jinja2 antes de que Monaco cree el editor. */
const handleBeforeMount: BeforeMount = (monaco) => {
  registerJinja2Language(monaco);
};

/**
 * Panel del editor Monaco en modo solo lectura con resaltado de sintaxis Jinja2.
 * @param props - Propiedades del editor (código a mostrar).
 * @returns El editor de código de la landing.
 */
export default function MonacoCodeEditor({ code }: IMonacoCodeEditorProps): ReactElement {
  return (
    <Editor
      language={JINJA2_LANGUAGE_ID}
      value={code}
      theme="vs-dark"
      beforeMount={handleBeforeMount}
      options={EDITOR_OPTIONS}
    />
  );
}
