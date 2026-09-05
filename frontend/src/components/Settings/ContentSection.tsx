/**
 * Sección "Contenido / Base de conocimientos" del configurador del tenant.
 *
 * Contrato:
 * - CRUD de `content_items` del bot (FAQ, documentos, reglas y productos) con
 *   versionado gestionado por el backend (tupla sync, `version` en cada lectura).
 * - Subpanel "Documentos": ingesta de base de conocimiento (archivos PDF/TXT/CSV
 *   o URLs) y búsqueda por texto, aislada por tenant y con vista expandible.
 * - Subpanel "Sinónimos": normalización de vocabulario con alta individual o
 *   múltiple, edición, borrado e importación/exportación de archivo (CSV o JSON).
 * - Sección autocontenida: carga su propia colección al montar y usa un único
 *   formulario reutilizado para crear y editar ítems (modo edición).
 * - Las etiquetas se ingresan separadas por comas y se normalizan al enviar.
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type {
  IContentItemRead,
  IContentKind,
  IDocumentContentRead,
  IDocumentRead,
  IDocumentSearchResult,
  IDocumentSourceType,
  ISynonymRead,
} from '@/api/types';
import type { IContentItemInput } from '@/services/tenantConfigService';
import { useTenantConfigStore } from '@/store/tenantConfigStore';

/** Opciones de tipo de contenido del bot (etiqueta visible + valor). */
const KIND_OPTIONS: ReadonlyArray<{ value: IContentKind; label: string }> = [
  { value: 'faq', label: 'Pregunta frecuente (FAQ)' },
  { value: 'document', label: 'Documento' },
  { value: 'rule', label: 'Regla' },
  { value: 'product', label: 'Producto' },
];

/** Estado del formulario de contenido (tipo, título, cuerpo y etiquetas). */
interface IContentFormState {
  /** Tipo de ítem de contenido (p. ej. faq). */
  kind: IContentKind;
  /** Título del ítem de contenido. */
  title: string;
  /** Cuerpo o respuesta del ítem de contenido. */
  content: string;
  /** Etiquetas separadas por comas (se parsean al guardar). */
  tags: string;
}

const EMPTY_FORM: IContentFormState = { kind: 'faq', title: '', content: '', tags: '' };

/** Etiqueta legible de un tipo de contenido. */
function kindLabel(kind: IContentKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

/** Convierte la entrada de etiquetas separadas por comas en un arreglo normalizado. */
function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Formatea un tamaño de archivo en bytes a una unidad legible. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Etiqueta legible de un tipo de origen de documento. */
function sourceTypeLabel(sourceType: IDocumentSourceType): string {
  const labels: Record<IDocumentSourceType, string> = {
    pdf: 'PDF',
    txt: 'Texto',
    csv: 'CSV',
    url: 'URL',
  };
  return labels[sourceType];
}

/** Descarga el contenido dado como un archivo local (exportación de sinónimos). */
function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Sección de contenido estructurado del bot con CRUD completo.
 *
 * @example
 * ```tsx
 * <ContentSection />
 * ```
 *
 * @returns El formulario de contenido y la lista de ítems de la base de conocimientos.
 */
export function ContentSection(): ReactElement {
  const contentItems = useTenantConfigStore((state) => state.contentItems);
  const contentStatus = useTenantConfigStore((state) => state.contentStatus);
  const contentError = useTenantConfigStore((state) => state.contentError);
  const listContentItems = useTenantConfigStore((state) => state.listContentItems);
  const createContentItem = useTenantConfigStore((state) => state.createContentItem);
  const updateContentItem = useTenantConfigStore((state) => state.updateContentItem);
  const deleteContentItem = useTenantConfigStore((state) => state.deleteContentItem);
  const documents = useTenantConfigStore((state) => state.documents);
  const documentsStatus = useTenantConfigStore((state) => state.documentsStatus);
  const documentsError = useTenantConfigStore((state) => state.documentsError);
  const listDocuments = useTenantConfigStore((state) => state.listDocuments);
  const ingestDocumentFile = useTenantConfigStore((state) => state.ingestDocumentFile);
  const ingestDocumentUrl = useTenantConfigStore((state) => state.ingestDocumentUrl);
  const searchDocuments = useTenantConfigStore((state) => state.searchDocuments);
  const getDocument = useTenantConfigStore((state) => state.getDocument);
  const deleteDocument = useTenantConfigStore((state) => state.deleteDocument);
  const synonyms = useTenantConfigStore((state) => state.synonyms);
  const synonymsStatus = useTenantConfigStore((state) => state.synonymsStatus);
  const synonymsError = useTenantConfigStore((state) => state.synonymsError);
  const listSynonyms = useTenantConfigStore((state) => state.listSynonyms);
  const createSynonym = useTenantConfigStore((state) => state.createSynonym);
  const updateSynonym = useTenantConfigStore((state) => state.updateSynonym);
  const deleteSynonym = useTenantConfigStore((state) => state.deleteSynonym);
  const importSynonyms = useTenantConfigStore((state) => state.importSynonyms);
  const exportSynonyms = useTenantConfigStore((state) => state.exportSynonyms);

  const [form, setForm] = useState<IContentFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentUrl, setDocumentUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<IDocumentSearchResult[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<IDocumentContentRead | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [synonymTerm, setSynonymTerm] = useState('');
  const [synonymItems, setSynonymItems] = useState('');
  const [synonymEditId, setSynonymEditId] = useState<string | null>(null);
  const [synonymImportText, setSynonymImportText] = useState('');
  const [synonymImportFormat, setSynonymImportFormat] = useState<'csv' | 'json'>('csv');
  const [synonymExportFormat, setSynonymExportFormat] = useState<'csv' | 'json'>('csv');
  const [synonymError, setSynonymError] = useState<string | null>(null);
  const [synonymMessage, setSynonymMessage] = useState<string | null>(null);

  // Sección autocontenida: carga la base de conocimientos al montar.
  useEffect(() => {
    void listContentItems();
  }, [listContentItems]);

  // Subpanel de documentos: carga los documentos ingeridos del tenant al montar.
  useEffect(() => {
    void listDocuments();
  }, [listDocuments]);

  // Subpanel de sinónimos: carga los sinónimos del tenant al montar.
  useEffect(() => {
    void listSynonyms();
  }, [listSynonyms]);

  const setField = <K extends keyof IContentFormState>(
    key: K,
    value: IContentFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (item: IContentItemRead): void => {
    setForm({
      kind: item.kind,
      title: item.title,
      content: item.content,
      tags: item.tags.join(', '),
    });
    setEditingId(item.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const title = form.title.trim();
    if (title === '') {
      setFormError('El título es obligatorio.');
      return;
    }
    const input: IContentItemInput = {
      kind: form.kind,
      title,
      content: form.content.trim() === '' ? undefined : form.content,
      tags: parseTags(form.tags),
    };
    if (editingId !== null) {
      await updateContentItem(editingId, input);
    } else {
      await createContentItem(input);
    }
    resetForm();
  };

  const handleDelete = async (item: IContentItemRead): Promise<void> => {
    await deleteContentItem(item.id);
  };

  const handleIngestFile = async (): Promise<void> => {
    if (documentFile === null) {
      setDocumentError('Selecciona un archivo PDF, TXT o CSV para ingerir.');
      return;
    }
    setDocumentError(null);
    await ingestDocumentFile(documentFile);
    setDocumentFile(null);
  };

  const handleIngestUrl = async (): Promise<void> => {
    const url = documentUrl.trim();
    if (url === '') {
      setDocumentError('Introduce una URL pública del documento.');
      return;
    }
    setDocumentError(null);
    await ingestDocumentUrl(url);
    setDocumentUrl('');
  };

  const handleSearch = async (): Promise<void> => {
    const query = searchQuery.trim();
    if (query === '') {
      setSearchResults([]);
      return;
    }
    setDocumentError(null);
    const results = await searchDocuments(query);
    setSearchResults(results);
  };

  const handleExpand = async (document: IDocumentRead): Promise<void> => {
    if (expandedId === document.id) {
      setExpandedId(null);
      setExpandedContent(null);
      return;
    }
    setDocumentError(null);
    try {
      const content = await getDocument(document.id);
      setExpandedId(document.id);
      setExpandedContent(content);
    } catch {
      // El error ya quedó registrado en `documentsError` del store.
      setExpandedId(null);
      setExpandedContent(null);
    }
  };

  const handleDeleteDocument = async (document: IDocumentRead): Promise<void> => {
    await deleteDocument(document.id);
    if (expandedId === document.id) {
      setExpandedId(null);
      setExpandedContent(null);
    }
  };

  const startSynonymEdit = (synonym: ISynonymRead): void => {
    setSynonymEditId(synonym.id);
    setSynonymTerm(synonym.term);
    setSynonymItems(synonym.synonyms.join(', '));
    setSynonymError(null);
    setSynonymMessage(null);
  };

  const cancelSynonymEdit = (): void => {
    setSynonymEditId(null);
    setSynonymTerm('');
    setSynonymItems('');
  };

  const handleCreateSynonym = async (): Promise<void> => {
    const term = synonymTerm.trim();
    const items = parseTags(synonymItems);
    if (term === '') {
      setSynonymError('El término es obligatorio.');
      return;
    }
    if (items.length === 0) {
      setSynonymError('Indica al menos un sinónimo separado por comas.');
      return;
    }
    setSynonymError(null);
    setSynonymMessage(null);
    if (synonymEditId !== null) {
      await updateSynonym(synonymEditId, { term, synonyms: items });
      setSynonymMessage('Sinónimo actualizado correctamente.');
    } else {
      await createSynonym({ term, synonyms: items });
      setSynonymMessage('Sinónimo creado correctamente.');
    }
    cancelSynonymEdit();
  };

  const handleDeleteSynonym = async (synonym: ISynonymRead): Promise<void> => {
    await deleteSynonym(synonym.id);
    if (synonymEditId === synonym.id) {
      cancelSynonymEdit();
    }
    setSynonymMessage(null);
  };

  const handleImportSynonyms = async (): Promise<void> => {
    const content = synonymImportText.trim();
    if (content === '') {
      setSynonymError('Pega el contenido CSV o JSON a importar.');
      return;
    }
    setSynonymError(null);
    setSynonymMessage(null);
    try {
      const result = await importSynonyms({ content, format: synonymImportFormat });
      setSynonymImportText('');
      setSynonymMessage(
        `Importación completada: ${result.imported} creados, ${result.skipped} omitidos, ${result.failed} con errores.`,
      );
    } catch {
      // El error quedó registrado en `synonymsError` del store (importSynonyms lanza).
      setSynonymMessage(null);
    }
  };

  const handleExportSynonyms = async (): Promise<void> => {
    setSynonymError(null);
    setSynonymMessage(null);
    try {
      const content = await exportSynonyms(synonymExportFormat);
      downloadTextFile(
        `sinonimos.${synonymExportFormat}`,
        content,
        synonymExportFormat === 'json'
          ? 'application/json;charset=utf-8'
          : 'text/csv;charset=utf-8',
      );
      setSynonymMessage('Archivo exportado correctamente.');
    } catch {
      // El error quedó registrado en `synonymsError` del store (exportSynonyms lanza).
      setSynonymMessage(null);
    }
  };

  const isLoading = contentStatus === 'loading' && contentItems.length === 0;
  const isDocumentsLoading = documentsStatus === 'loading' && documents.length === 0;
  const isSynonymsLoading = synonymsStatus === 'loading' && synonyms.length === 0;

  return (
    <section aria-labelledby="content-heading">
      <h2 id="content-heading" className="text-lg font-semibold text-slate-900">
        Contenido / Base de conocimientos
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Administra las preguntas frecuentes, documentos y reglas que el bot usa para responder. Los
        cambios quedan versionados automáticamente.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando contenido…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar ítem de contenido' : 'Crear ítem de contenido'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar ítem' : 'Nuevo ítem'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="content-kind" className="block text-sm text-slate-600">
                    Tipo
                  </label>
                  <select
                    id="content-kind"
                    value={form.kind}
                    onChange={(event) => setField('kind', event.target.value as IContentKind)}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="content-title" className="block text-sm text-slate-600">
                    Título
                  </label>
                  <input
                    id="content-title"
                    type="text"
                    value={form.title}
                    onChange={(event) => setField('title', event.target.value)}
                    placeholder="¿Cómo recupero mi contraseña?"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="content-body" className="block text-sm text-slate-600">
                    Respuesta / cuerpo
                  </label>
                  <textarea
                    id="content-body"
                    rows={4}
                    value={form.content}
                    onChange={(event) => setField('content', event.target.value)}
                    placeholder="Escribe la respuesta que dará el bot…"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="content-tags" className="block text-sm text-slate-600">
                    Etiquetas (separadas por comas)
                  </label>
                  <input
                    id="content-tags"
                    type="text"
                    value={form.tags}
                    onChange={(event) => setField('tags', event.target.value)}
                    placeholder="cuenta, contraseña, soporte"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={contentStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId !== null ? 'Guardar cambios' : 'Crear ítem'}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cancelar edición
                </button>
              )}
              <span role="status" aria-live="polite" className="text-sm">
                {formError !== null && <span className="text-red-600">{formError}</span>}
              </span>
            </div>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Ítems de contenido</p>
            {contentItems.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay contenido configurado.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {contentItems.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {kindLabel(item.kind)}
                        </span>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {item.title}
                        </h3>
                        {item.content !== '' && (
                          <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.content}</p>
                        )}
                        {item.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <section aria-labelledby="documents-heading" className="mt-8 border-t border-slate-200 pt-6">
        <h3 id="documents-heading" className="text-base font-semibold text-slate-900">
          Documentos (base de conocimiento RAG)
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Sube archivos (PDF, TXT o CSV) o ingiere una URL para ampliar la base de conocimiento del
          bot.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Ingesta</legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="document-file" className="block text-sm text-slate-600">
                    Archivo (PDF, TXT o CSV)
                  </label>
                  <input
                    id="document-file"
                    type="file"
                    accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                    className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
                  />
                  <button
                    type="button"
                    onClick={() => void handleIngestFile()}
                    disabled={documentsStatus === 'loading'}
                    className="mt-2 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Ingerir archivo
                  </button>
                </div>
                <div>
                  <label htmlFor="document-url" className="block text-sm text-slate-600">
                    URL del documento
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      id="document-url"
                      type="url"
                      value={documentUrl}
                      onChange={(event) => setDocumentUrl(event.target.value)}
                      placeholder="URL pública del documento (ejemplo: ejemplo.com/manual.pdf)"
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void handleIngestUrl()}
                      disabled={documentsStatus === 'loading'}
                      className="shrink-0 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Ingerir URL
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                Buscar en la base de conocimiento
              </legend>
              <div className="mt-2 flex gap-2">
                <input
                  id="document-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSearch();
                    }
                  }}
                  placeholder="¿Qué tema quieres buscar?"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleSearch()}
                  className="shrink-0 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Buscar
                </button>
              </div>
              {searchResults.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {searchResults.map((result) => (
                    <li key={result.document_id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-semibold text-slate-900">{result.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500">{result.snippet}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Relevancia: {result.score.toFixed(2)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">Documentos ingeridos</p>
            {isDocumentsLoading ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Cargando documentos…
              </p>
            ) : documents.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay documentos ingeridos.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {documents.map((document) => (
                  <li key={document.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {sourceTypeLabel(document.source_type)}
                        </span>
                        <h4 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {document.title}
                        </h4>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatBytes(document.size_bytes)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void handleExpand(document)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          {expandedId === document.id ? 'Ocultar' : 'Ver'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteDocument(document)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                    {expandedId === document.id && expandedContent !== null && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="whitespace-pre-wrap text-sm text-slate-600">
                          {expandedContent.content}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <span role="status" aria-live="polite" className="text-sm">
          {documentError !== null && <span className="text-red-600">{documentError}</span>}
          {documentsError !== null && <span className="text-red-600">{documentsError}</span>}
        </span>
      </section>

      <section aria-labelledby="synonyms-heading" className="mt-8 border-t border-slate-200 pt-6">
        <h3 id="synonyms-heading" className="text-base font-semibold text-slate-900">
          Sinónimos (normalización de vocabulario)
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Define sinónimos para que el bot normalice las variantes de un mismo término antes de
          buscar la respuesta.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {synonymEditId !== null ? 'Editar sinónimo' : 'Agregar sinónimo'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="synonym-term" className="block text-sm text-slate-600">
                    Término
                  </label>
                  <input
                    id="synonym-term"
                    type="text"
                    value={synonymTerm}
                    onChange={(event) => setSynonymTerm(event.target.value)}
                    placeholder="automóvil"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="synonym-items" className="block text-sm text-slate-600">
                    Sinónimos (separados por comas)
                  </label>
                  <input
                    id="synonym-items"
                    type="text"
                    value={synonymItems}
                    onChange={(event) => setSynonymItems(event.target.value)}
                    placeholder="auto, carro, coche"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleCreateSynonym()}
                disabled={synonymsStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {synonymEditId !== null ? 'Guardar cambios' : 'Agregar sinónimo'}
              </button>
              {synonymEditId !== null && (
                <button
                  type="button"
                  onClick={cancelSynonymEdit}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cancelar edición
                </button>
              )}
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Importar / Exportar</legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="synonym-import" className="block text-sm text-slate-600">
                    Contenido CSV o JSON (término,sinónimos)
                  </label>
                  <textarea
                    id="synonym-import"
                    rows={3}
                    value={synonymImportText}
                    onChange={(event) => setSynonymImportText(event.target.value)}
                    placeholder="automóvil,auto|carro|coche"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      id="synonym-import-format"
                      value={synonymImportFormat}
                      onChange={(event) =>
                        setSynonymImportFormat(event.target.value as 'csv' | 'json')
                      }
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleImportSynonyms()}
                      disabled={synonymsStatus === 'loading'}
                      className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Importar
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="synonym-export-format"
                    value={synonymExportFormat}
                    onChange={(event) =>
                      setSynonymExportFormat(event.target.value as 'csv' | 'json')
                    }
                    className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleExportSynonyms()}
                    disabled={synonymsStatus === 'loading'}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Exportar
                  </button>
                </div>
              </div>
            </fieldset>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">Sinónimos definidos</p>
            {isSynonymsLoading ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Cargando sinónimos…
              </p>
            ) : synonyms.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay sinónimos definidos.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {synonyms.map((synonym) => (
                  <li key={synonym.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-slate-900">{synonym.term}</h4>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {synonym.synonyms.map((item) => (
                            <span
                              key={item}
                              className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startSynonymEdit(synonym)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSynonym(synonym)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <span role="status" aria-live="polite" className="text-sm">
          {synonymError !== null && <span className="text-red-600">{synonymError}</span>}
          {synonymsError !== null && <span className="text-red-600">{synonymsError}</span>}
          {synonymMessage !== null && <span className="text-brand-700">{synonymMessage}</span>}
        </span>
      </section>

      <span role="status" aria-live="polite" className="text-sm">
        {contentError !== null && <span className="text-red-600">{contentError}</span>}
      </span>
    </section>
  );
}
