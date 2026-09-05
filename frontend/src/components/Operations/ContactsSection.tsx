/**
 * Sección "Contactos" del área de operación del bot (B.6 — eslabón ① Captación).
 *
 * Contrato:
 * - CRUD de `contacts` del tenant (teléfono, nombre, correo, etiquetas, estado,
 *   origen e identificador externo) gestionado por el backend con RLS.
 * - Sección autocontenida: carga el directorio al montar y reutiliza un único
 *   formulario para crear y editar contactos (modo edición).
 * - El teléfono se valida localmente (obligatorio) antes de enviar.
 * - Las etiquetas se editan como texto separado por comas y se normalizan a
 *   `string[]`; los campos vacíos se envían como `undefined`.
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import type { IContactRead } from '@/api/types';
import type { IContactInput } from '@/services/operationsService';
import { useOperationsStore } from '@/store/operationsStore';
import { Badge, Button, EmptyState, ErrorState, Input } from '@/components/ui';

/** Estado del formulario de contactos (las etiquetas se editan como texto). */
interface IContactFormState {
  /** Teléfono del contacto en formato internacional (obligatorio, único por tenant). */
  phone: string;
  /** Nombre del contacto. */
  name: string;
  /** Correo electrónico del contacto. */
  email: string;
  /** Etiquetas separadas por comas (se normalizan a `string[]` al guardar). */
  tags: string;
  /** Estado del contacto por defecto (`new`). */
  state: string;
  /** Origen de la captación por defecto (`manual`). */
  source: string;
  /** Identificador externo (p. ej. WhatsApp ID) para atribución. */
  externalContactId: string;
}

const EMPTY_FORM: IContactFormState = {
  phone: '',
  name: '',
  email: '',
  tags: '',
  state: 'new',
  source: 'manual',
  externalContactId: '',
};

/** Normaliza un texto de etiquetas separadas por comas a un arreglo no vacío. */
function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * Sección de directorio de contactos del tenant con CRUD completo (B.6).
 *
 * @example
 * ```tsx
 * <ContactsSection />
 * ```
 *
 * @returns El formulario de contactos y la lista del directorio segmentable.
 */
export function ContactsSection(): ReactElement {
  const contacts = useOperationsStore((state) => state.contacts);
  const contactsStatus = useOperationsStore((state) => state.contactsStatus);
  const contactsError = useOperationsStore((state) => state.contactsError);
  const listContacts = useOperationsStore((state) => state.listContacts);
  const createContact = useOperationsStore((state) => state.createContact);
  const updateContact = useOperationsStore((state) => state.updateContact);
  const deleteContact = useOperationsStore((state) => state.deleteContact);
  const importResult = useOperationsStore((state) => state.importResult);
  const importStatus = useOperationsStore((state) => state.importStatus);
  const importError = useOperationsStore((state) => state.importError);
  const importContactsCsv = useOperationsStore((state) => state.importContactsCsv);

  const [form, setForm] = useState<IContactFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [csvError, setCsvError] = useState<string | null>(null);

  // Sección autocontenida: carga el directorio al montar.
  useEffect(() => {
    void listContacts();
  }, [listContacts]);

  const setField = <K extends keyof IContactFormState>(
    key: K,
    value: IContactFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (contact: IContactRead): void => {
    setForm({
      phone: contact.phone,
      name: contact.name ?? '',
      email: contact.email ?? '',
      tags: (contact.tags ?? []).join(', '),
      state: contact.state,
      source: contact.source,
      externalContactId: contact.external_contact_id ?? '',
    });
    setEditingId(contact.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const phone = form.phone.trim();
    if (phone === '') {
      setFormError('El teléfono es obligatorio.');
      return;
    }
    const tags = parseTags(form.tags);
    const input: IContactInput = {
      phone,
      name: form.name.trim() === '' ? undefined : form.name,
      email: form.email.trim() === '' ? undefined : form.email,
      tags: tags.length === 0 ? undefined : tags,
      state: form.state.trim() === '' ? undefined : form.state,
      source: form.source.trim() === '' ? undefined : form.source,
      externalContactId: form.externalContactId.trim() === '' ? undefined : form.externalContactId,
    };
    if (editingId !== null) {
      await updateContact(editingId, input);
    } else {
      await createContact(input);
    }
    resetForm();
  };

  const handleDelete = async (contact: IContactRead): Promise<void> => {
    await deleteContact(contact.id);
  };

  const handleCsvFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    void file.text().then(setCsvText);
  };

  const handleImport = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (csvText.trim() === '') {
      setCsvError('Pega el contenido del CSV (con cabecera) o selecciona un archivo.');
      return;
    }
    setCsvError(null);
    await importContactsCsv({ csv: csvText, delimiter: ',' });
  };

  const isLoading = contactsStatus === 'loading' && contacts.length === 0;

  return (
    <section aria-labelledby="contacts-heading">
      <h2 id="contacts-heading" className="text-lg font-semibold text-slate-900">
        Contactos
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Directorio segmentable del tenant con etiquetas y origen. Cada lead captado se registra aquí
        y queda disponible para campañas e intervención.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Captación ①
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando contactos…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar contacto' : 'Crear contacto'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar contacto' : 'Nuevo contacto'}
              </legend>
              <div className="mt-2 space-y-3">
                <Input
                  id="contact-phone"
                  label="Teléfono"
                  type="text"
                  value={form.phone}
                  onChange={(event) => setField('phone', event.target.value)}
                  placeholder="+521234567890"
                  required
                />
                <Input
                  id="contact-name"
                  label="Nombre"
                  type="text"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="Ana García"
                />
                <Input
                  id="contact-email"
                  label="Correo"
                  type="email"
                  value={form.email}
                  onChange={(event) => setField('email', event.target.value)}
                  placeholder="ana@example.com"
                />
                <Input
                  id="contact-tags"
                  label="Etiquetas"
                  type="text"
                  value={form.tags}
                  onChange={(event) => setField('tags', event.target.value)}
                  placeholder="ventas, vip"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    id="contact-state"
                    label="Estado"
                    type="text"
                    value={form.state}
                    onChange={(event) => setField('state', event.target.value)}
                    placeholder="new"
                  />
                  <Input
                    id="contact-source"
                    label="Origen"
                    type="text"
                    value={form.source}
                    onChange={(event) => setField('source', event.target.value)}
                    placeholder="manual"
                  />
                </div>
                <Input
                  id="contact-external-id"
                  label="Id externo"
                  type="text"
                  value={form.externalContactId}
                  onChange={(event) => setField('externalContactId', event.target.value)}
                  placeholder="wa:521234567890"
                />
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={contactsStatus === 'loading'}>
                {editingId !== null ? 'Guardar cambios' : 'Crear contacto'}
              </Button>
              {editingId !== null && (
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancelar edición
                </Button>
              )}
              <span role="status" aria-live="polite" className="text-sm">
                {formError !== null && <span className="text-red-600">{formError}</span>}
              </span>
            </div>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Contactos del directorio</p>
            {contacts.length === 0 ? (
              <EmptyState title="Aún no hay contactos en el directorio." />
            ) : (
              <ul className="mt-2 space-y-3">
                {contacts.map((contact) => (
                  <li key={contact.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral" mono>
                            {contact.phone}
                          </Badge>
                          <Badge tone="sky">{contact.state}</Badge>
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {contact.name !== null && contact.name !== ''
                            ? contact.name
                            : 'Sin nombre'}
                        </h3>
                        {contact.email !== null && contact.email !== '' && (
                          <p className="mt-1 truncate text-sm text-slate-500">{contact.email}</p>
                        )}
                        {contact.tags.length > 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            {contact.tags.map((tag) => `#${tag}`).join(' ')}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-400">
                          Origen: {contact.source}
                          {contact.external_contact_id !== null &&
                            ` · Ext: ${contact.external_contact_id}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => startEdit(contact)}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => void handleDelete(contact)}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 p-4 lg:col-span-2">
            <p className="text-sm font-medium text-slate-700">Carga masiva de contactos (CSV)</p>
            <p className="mt-1 text-xs text-slate-500">
              Pega el contenido del CSV con cabecera (p. ej.{' '}
              <code>phone,nombre,email,etiquetas,estado,origen,id_externo</code>) o selecciona un
              archivo. El delimitador por defecto es la coma. Solo se crean los contactos cuyo
              teléfono no exista ya en el tenant.
            </p>
            <form onSubmit={(event) => void handleImport(event)} className="mt-3 space-y-3">
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Archivo CSV de contactos"
                onChange={handleCsvFile}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
              />
              <textarea
                id="contacts-csv"
                aria-label="Contenido CSV de contactos"
                value={csvText}
                onChange={(event) => {
                  setCsvText(event.target.value);
                  setCsvError(null);
                }}
                rows={4}
                placeholder={'phone,nombre\n5215500000000,Ana García'}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={importStatus === 'loading'}>
                  {importStatus === 'loading' ? 'Importando…' : 'Importar contactos'}
                </Button>
                <span role="status" aria-live="polite" className="text-sm">
                  {csvError !== null && <span className="text-red-600">{csvError}</span>}
                  {importError !== null && <span className="text-red-600">{importError}</span>}
                </span>
              </div>
              {importResult !== null && (
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Creados</dt>
                    <dd className="font-semibold text-emerald-600">{importResult.created}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Omitidos (duplicados)</dt>
                    <dd className="font-semibold text-slate-600">{importResult.skipped}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Con error</dt>
                    <dd className="font-semibold text-red-600">{importResult.failed}</dd>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="col-span-3">
                      <dt className="text-xs text-slate-500">Errores por fila</dt>
                      <dd>
                        <ul className="mt-1 max-h-24 space-y-1 overflow-y-auto text-xs text-red-600">
                          {importResult.errors.map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </form>
          </div>
        </div>
      )}

      {contactsError !== null && (
        <div role="status" aria-live="polite" className="mt-2">
          <ErrorState message={contactsError} onRetry={() => void listContacts()} />
        </div>
      )}
    </section>
  );
}
