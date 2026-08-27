/**
 * Vista JSON de solo lectura basada en Monaco, cargada de forma diferida.
 *
 * Contrato:
 * - Este módulo es el único que importa la instancia real de Monaco (vía el loader
 *   de `@monaco-editor/react`), de modo que su carga se difiere hasta que el panel
 *   de schemas se monta (`React.lazy` desde `DeveloperSchemaPanel`).
 * - Muestra un JSON Schema (Draft 2020-12) serializado con tema oscuro `vs-dark`.
 * - Recibe el JSON por props para conservar la reactividad del store de schemas.
 */
import type { ReactElement } from 'react';
import Editor, { type BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor/editor/editor.api';

/** Opciones de la vista JSON: solo lectura, tema oscuro y adaptación al contenedor. */
const JSON_VIEW_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  fontSize: 12,
  lineHeight: 18,
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  renderLineHighlight: 'none',
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
};

/** Propiedades de la vista diferida de JSON. */
interface ISchemaJsonViewerProps {
  /** JSON Schema serializado que se muestra en el editor. */
  json: string;
}

/** JSON es un lenguaje incluido por defecto en Monaco; no requiere configuración previa. */
const handleBeforeMount: BeforeMount = () => {
  // Sin configuración extra: `json` ya está registrado por Monaco.
};

/**
 * Vista JSON de solo lectura con resaltado de sintaxis.
 * @param props - Propiedades de la vista (JSON a mostrar).
 * @returns El editor JSON de solo lectura.
 */
export default function SchemaJsonViewer({ json }: ISchemaJsonViewerProps): ReactElement {
  return (
    <Editor
      language="json"
      value={json}
      theme="vs-dark"
      beforeMount={handleBeforeMount}
      options={JSON_VIEW_OPTIONS}
    />
  );
}
