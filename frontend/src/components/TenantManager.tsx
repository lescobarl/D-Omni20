/**
 * Controles de CRUD de tenants (control plane) de la pestaña «Tenants».
 *
 * Contrato:
 * - Botón «Nuevo tenant» abre un modal para CREAR un tenant (slug + nombre).
 * - Botones «Renombrar» y «Eliminar» operan sobre el tenant activo seleccionado.
 * - La edición solo permite cambiar el nombre (el slug es inmutable).
 * - La eliminación pide confirmación y delega en el store, que recarga la lista
 *   y degrada el tenant activo si se elimina el seleccionado.
 * - Consume las acciones `createTenant`/`updateTenant`/`deleteTenant` ya
 *   presentes en `useTenantStore` (no reimplementa la capa de datos).
 */
import { useCallback, useState, type FormEvent, type ReactElement } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import { useTenantStore } from '@/store/tenantStore';

/** Estado del formulario de creación de un tenant. */
interface ICreateForm {
  /** Slug canónico del tenant (inmutable tras la creación). */
  slug: string;
  /** Nombre legible del tenant. */
  name: string;
}

/** Estado del formulario de edición (solo nombre; el slug es inmutable). */
interface IEditForm {
  /** Nombre legible del tenant (el slug es inmutable). */
  name: string;
}

const EMPTY_CREATE: ICreateForm = { slug: '', name: '' };

/**
 * Renderiza los controles de gestión de tenants (control plane).
 *
 * @returns Botones de crear/editar/eliminar y sus modales.
 */
export function TenantManager(): ReactElement {
  const tenants = useTenantStore((state) => state.tenants);
  const activeTenantId = useTenantStore((state) => state.activeTenantId);
  const status = useTenantStore((state) => state.status);
  const error = useTenantStore((state) => state.error);
  const createTenant = useTenantStore((state) => state.createTenant);
  const updateTenant = useTenantStore((state) => state.updateTenant);
  const deleteTenant = useTenantStore((state) => state.deleteTenant);
  const setActiveTenant = useTenantStore((state) => state.setActiveTenant);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ICreateForm>(EMPTY_CREATE);
  const [editForm, setEditForm] = useState<IEditForm>({ name: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Callbacks estables para `onClose` de los modales: evitan que el efecto de
  // foco del `Modal` se re-ejecute en cada render (p. ej. al teclear) y robe el
  // foco del campo activo.
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeEdit = useCallback(() => setEditOpen(false), []);

  // Tenant activo (objeto) para editar/eliminar; `null` si no hay selección.
  const activeTenant = tenants.find((tenant) => tenant.slug === activeTenantId) ?? null;
  const hasActiveTenant = activeTenant !== null;

  const openCreate = (): void => {
    setCreateForm(EMPTY_CREATE);
    setFormError(null);
    setCreateOpen(true);
  };

  const openEdit = (): void => {
    if (activeTenant === null) return;
    setEditForm({ name: activeTenant.name });
    setFormError(null);
    setEditOpen(true);
  };

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const slug = createForm.slug.trim();
    const name = createForm.name.trim();
    if (slug === '') {
      setFormError('El slug es obligatorio.');
      return;
    }
    if (name === '') {
      setFormError('El nombre es obligatorio.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const created = await createTenant({ slug, name });
      // Refleja el tenant recién creado seleccionándolo como activo.
      setActiveTenant(created.slug);
      setCreateOpen(false);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo crear el tenant.');
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (activeTenant === null) return;
    const name = editForm.name.trim();
    if (name === '') {
      setFormError('El nombre es obligatorio.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await updateTenant(activeTenant.slug, { name });
      setEditOpen(false);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo actualizar el tenant.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (activeTenant === null) return;
    const confirmed = window.confirm(
      `¿Eliminar el tenant «${activeTenant.name || activeTenant.slug}»? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setFormError(null);
    try {
      await deleteTenant(activeTenant.slug);
      // El store recarga la lista y degrada el tenant activo si se eliminó el
      // seleccionado; la UI refleja el nuevo activo tras el reload.
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo eliminar el tenant.');
    } finally {
      setBusy(false);
    }
  };

  const isLoading = status === 'loading';

  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={openCreate} disabled={isLoading}>
          Nuevo tenant
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={openEdit}
          disabled={!hasActiveTenant || isLoading}
        >
          Renombrar
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => void handleDelete()}
          disabled={!hasActiveTenant || isLoading || busy}
        >
          Eliminar
        </Button>
      </div>

      <Modal open={createOpen} onClose={closeCreate} title="Nuevo tenant">
        <form onSubmit={(event) => void handleCreate(event)} className="space-y-4">
          <Input
            id="tenant-create-slug"
            label="Slug"
            type="text"
            value={createForm.slug}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, slug: event.target.value }))
            }
            placeholder="mi-tenant"
            hint="Identificador único e inmutable (X-Tenant-Id)."
            required
          />
          <Input
            id="tenant-create-name"
            label="Nombre"
            type="text"
            value={createForm.name}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Mi Tenant"
            required
          />
          {formError !== null && (
            <span role="status" className="block text-sm text-red-600">
              {formError}
            </span>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={busy}>
              Crear tenant
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={editOpen} onClose={closeEdit} title="Renombrar tenant">
        <form onSubmit={(event) => void handleEdit(event)} className="space-y-4">
          <Input
            id="tenant-edit-name"
            label="Nombre"
            type="text"
            value={editForm.name}
            onChange={(event) => setEditForm({ name: event.target.value })}
            required
          />
          {activeTenant !== null && (
            <p className="text-xs text-slate-400">
              Slug inmutable:{' '}
              <span className="font-medium text-slate-600">{activeTenant.slug}</span>
            </p>
          )}
          {formError !== null && (
            <span role="status" className="block text-sm text-red-600">
              {formError}
            </span>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={busy}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </Modal>

      {error !== null && (
        <span role="status" aria-live="polite" className="sr-only">
          {error}
        </span>
      )}
    </>
  );
}
