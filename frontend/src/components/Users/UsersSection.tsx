/**
 * Área «Usuarios» (control plane, super-admin).
 *
 * Contrato:
 * - Gestiona los usuarios de plataforma: lista con búsqueda, creación, edición y
 *   eliminación de usuarios (perfil + flag de super-admin).
 * - Para cada usuario permite gestionar sus membresías (tenant + rol) por tenant.
 * - Consume `useUserStore` (CRUD de usuarios) y `useTenantStore` (opciones de
 *   tenant para asignar membresías). Es fail-closed: si no hay servicio o el
 *   usuario no es super-admin, muestra un estado vacío/error sin romper la UI.
 * - Solo se monta desde `App.tsx` cuando el contexto RBAC permite
 *   `platformUsers` (super-admin), por lo que aquí no se re-evalúa el permiso.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import type { IRole, IUserRead } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useTenantStore } from '@/store/tenantStore';
import { useUserStore } from '@/store/userStore';

/** Etiquetas legibles de los roles por tenant. */
const ROLE_LABELS: Record<IRole, string> = {
  admin: 'Administrador',
  configurador: 'Configurador',
  operador: 'Operador',
};

/** Opciones de rol para los selectores. */
const ROLE_OPTIONS: readonly IRole[] = ['admin', 'configurador', 'operador'];

/** Formulario de creación/edición de usuario. */
interface IUserForm {
  email: string;
  displayName: string;
  password: string;
  isSuperAdmin: boolean;
  isActive: boolean;
}

/** Formulario de nueva membresía (tenant + rol). */
interface IMembershipForm {
  tenantId: string;
  role: IRole;
}

/** Estado inicial del formulario de usuario. */
const EMPTY_USER_FORM: IUserForm = {
  email: '',
  displayName: '',
  password: '',
  isSuperAdmin: false,
  isActive: true,
};

/** Estado inicial del formulario de membresía. */
const EMPTY_MEMBERSHIP_FORM: IMembershipForm = {
  tenantId: '',
  role: 'operador',
};

/** Formatea una fecha ISO a una cadena local corta. */
function formatDate(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

/**
 * Área de gestión de usuarios de plataforma (super-admin).
 *
 * @returns La sección «Usuarios» con lista, creación/edición y membresías.
 */
export function UsersSection(): ReactElement {
  const users = useUserStore((state) => state.users);
  const status = useUserStore((state) => state.status);
  const error = useUserStore((state) => state.error);
  const listUsers = useUserStore((state) => state.listUsers);
  const createUser = useUserStore((state) => state.createUser);
  const updateUser = useUserStore((state) => state.updateUser);
  const deleteUser = useUserStore((state) => state.deleteUser);
  const listUserMemberships = useUserStore((state) => state.listUserMemberships);
  const addUserMembership = useUserStore((state) => state.addUserMembership);
  const removeUserMembership = useUserStore((state) => state.removeUserMembership);

  const tenants = useTenantStore((state) => state.tenants);

  // Búsqueda por email/nombre.
  const [query, setQuery] = useState('');
  // Usuario en edición (creación si es `null`).
  const [editing, setEditing] = useState<IUserRead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<IUserForm>(EMPTY_USER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Usuario del que se gestionan membresías.
  const [membershipUser, setMembershipUser] = useState<IUserRead | null>(null);
  const [memberships, setMemberships] = useState<Record<string, string>>({});
  const [membershipForm, setMembershipForm] = useState<IMembershipForm>(EMPTY_MEMBERSHIP_FORM);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(false);

  useEffect(() => {
    void listUsers();
  }, [listUsers]);

  // Filtro por búsqueda (email o nombre visible).
  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term === '') return users;
    return users.filter(
      (user) =>
        user.email.toLowerCase().includes(term) ||
        (user.display_name ?? '').toLowerCase().includes(term),
    );
  }, [users, query]);

  const openCreate = (): void => {
    setForm(EMPTY_USER_FORM);
    setFormError(null);
    setCreateOpen(true);
  };

  const openEdit = (user: IUserRead): void => {
    setEditing(user);
    setForm({
      email: user.email,
      displayName: user.display_name ?? '',
      password: '',
      isSuperAdmin: user.is_super_admin,
      isActive: user.is_active,
    });
    setFormError(null);
    setEditOpen(true);
  };

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const email = form.email.trim();
    if (email === '') {
      setFormError('El correo electrónico es obligatorio.');
      return;
    }
    if (form.password.length < 8) {
      setFormError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const created = await createUser({
      email,
      password: form.password,
      display_name: form.displayName.trim() === '' ? null : form.displayName.trim(),
      is_super_admin: form.isSuperAdmin,
    });
    setSaving(false);
    if (created === null) {
      setFormError('No se pudo crear el usuario. Revisa los datos e inténtalo de nuevo.');
      return;
    }
    setCreateOpen(false);
  };

  const handleUpdate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (editing === null) return;
    const payload: {
      display_name?: string | null;
      password?: string;
      is_super_admin?: boolean;
      is_active?: boolean;
    } = {
      display_name: form.displayName.trim() === '' ? null : form.displayName.trim(),
      is_super_admin: form.isSuperAdmin,
      is_active: form.isActive,
    };
    if (form.password.trim() !== '') {
      if (form.password.length < 8) {
        setFormError('La contraseña debe tener al menos 8 caracteres.');
        return;
      }
      payload.password = form.password;
    }
    setSaving(true);
    setFormError(null);
    const updated = await updateUser(editing.id, payload);
    setSaving(false);
    if (updated === null) {
      setFormError('No se pudo actualizar el usuario. Inténtalo de nuevo.');
      return;
    }
    setEditOpen(false);
    setEditing(null);
  };

  const handleDelete = async (user: IUserRead): Promise<void> => {
    const confirmed = window.confirm(
      `¿Eliminar al usuario «${user.email}»? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    await deleteUser(user.id);
  };

  // Carga las membresías del usuario seleccionado para gestionarlas.
  const openMemberships = async (user: IUserRead): Promise<void> => {
    setMembershipUser(user);
    setMembershipError(null);
    setMembershipForm({ ...EMPTY_MEMBERSHIP_FORM, tenantId: tenants[0]?.slug ?? '' });
    setMembershipLoading(true);
    const list = await listUserMemberships(user.id);
    const map: Record<string, string> = {};
    for (const membership of list) {
      map[membership.tenant_id] = membership.role;
    }
    setMemberships(map);
    setMembershipLoading(false);
  };

  const closeMemberships = (): void => {
    setMembershipUser(null);
    setMemberships({});
    setMembershipError(null);
  };

  const handleAddMembership = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (membershipUser === null) return;
    if (membershipForm.tenantId === '') {
      setMembershipError('Selecciona un tenant.');
      return;
    }
    if (memberships[membershipForm.tenantId] !== undefined) {
      setMembershipError('El usuario ya es miembro de ese tenant.');
      return;
    }
    setMembershipSaving(true);
    setMembershipError(null);
    const added = await addUserMembership({
      user_id: membershipUser.id,
      tenant_id: membershipForm.tenantId,
      role: membershipForm.role,
    });
    setMembershipSaving(false);
    if (added === null) {
      setMembershipError('No se pudo agregar la membresía. Inténtalo de nuevo.');
      return;
    }
    setMemberships((current) => ({ ...current, [added.tenant_id]: added.role }));
    setMembershipForm((current) => ({ ...current, tenantId: '' }));
  };

  const handleRemoveMembership = async (tenantId: string): Promise<void> => {
    if (membershipUser === null) return;
    const confirmed = window.confirm(
      `¿Quitar al usuario de «${tenantId}»? Perderá el acceso a ese tenant.`,
    );
    if (!confirmed) return;
    setMembershipSaving(true);
    setMembershipError(null);
    // Se elimina vía el store de usuarios (membresías del usuario). Como aquí no
    // se dispone del id de membresía en el mapa local (clave = tenant), se recarga
    // la lista para resolver el id real y se delega la baja al store.
    void listUserMemberships(membershipUser.id).then((list) => {
      const target = list.find((item) => item.tenant_id === tenantId);
      if (target === undefined) {
        setMembershipSaving(false);
        return;
      }
      void removeUserMembership(membershipUser.id, target.id).then(() => {
        setMemberships((current) => {
          const next = { ...current };
          delete next[tenantId];
          return next;
        });
        setMembershipSaving(false);
      });
    });
  };

  const isLoading = status === 'loading' && users.length === 0;

  return (
    <section aria-labelledby="users-heading" className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h2 id="users-heading" className="text-lg font-semibold text-slate-900">
            Usuarios
          </h2>
          <p className="text-sm text-slate-500">
            Gestiona los usuarios de la plataforma y sus accesos por tenant.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          Nuevo usuario
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        {status === 'error' && users.length === 0 ? (
          <ErrorState
            message="No se pudieron cargar los usuarios"
            detail={error ?? undefined}
            onRetry={() => void listUsers()}
          />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Input
                type="search"
                label="Buscar"
                placeholder="Buscar por correo o nombre…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="max-w-sm"
              />
              <span className="text-sm text-slate-500">
                {filteredUsers.length} de {users.length} usuarios
              </span>
            </div>

            {isLoading ? (
              <p className="text-sm text-slate-500">Cargando usuarios…</p>
            ) : filteredUsers.length === 0 ? (
              <EmptyState
                title={users.length === 0 ? 'Aún no hay usuarios' : 'Sin resultados'}
                description={
                  users.length === 0
                    ? 'Crea el primer usuario de la plataforma para comenzar.'
                    : 'Ningún usuario coincide con la búsqueda.'
                }
                actionLabel={users.length === 0 ? 'Nuevo usuario' : undefined}
                onAction={users.length === 0 ? openCreate : undefined}
              />
            ) : (
              <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {filteredUsers.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-900">
                          {user.display_name ?? user.email}
                        </span>
                        {user.is_super_admin ? (
                          <Badge tone="brand">Super-admin</Badge>
                        ) : null}
                        {!user.is_active ? <Badge tone="danger">Inactivo</Badge> : null}
                      </div>
                      <p className="truncate text-sm text-slate-500">{user.email}</p>
                      <p className="text-xs text-slate-400">
                        Último acceso: {formatDate(user.last_login_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void openMemberships(user)}
                      >
                        Membresías
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => openEdit(user)}>
                        Editar
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void handleDelete(user)}>
                        Eliminar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Modal de creación de usuario */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo usuario">
        <form
          onSubmit={(event) => void handleCreate(event)}
          noValidate
          className="space-y-4"
        >
          <Input
            label="Correo electrónico"
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="usuario@ejemplo.com"
          />
          <Input
            label="Nombre visible"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            placeholder="Nombre y apellido (opcional)"
          />
          <Input
            label="Contraseña"
            type="password"
            required
            hint="Mínimo 8 caracteres."
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isSuperAdmin}
              onChange={(event) => setForm({ ...form, isSuperAdmin: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Super-admin de la plataforma
          </label>
          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Crear usuario
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de edición de usuario */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Editar usuario">
        <form
          onSubmit={(event) => void handleUpdate(event)}
          noValidate
          className="space-y-4"
        >
          <Input
            label="Correo electrónico"
            type="email"
            value={form.email}
            disabled
            hint="El correo es el identificador de acceso y no se puede cambiar."
          />
          <Input
            label="Nombre visible"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            placeholder="Nombre y apellido"
          />
          <Input
            label="Nueva contraseña"
            type="password"
            hint="Déjala vacía para no cambiarla. Mínimo 8 caracteres."
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isSuperAdmin}
              onChange={(event) => setForm({ ...form, isSuperAdmin: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Super-admin de la plataforma
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Cuenta activa
          </label>
          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de membresías del usuario */}
      <Modal
        open={membershipUser !== null}
        onClose={closeMemberships}
        title={`Membresías de ${membershipUser?.display_name ?? membershipUser?.email ?? ''}`}
      >
        {membershipUser !== null ? (
          <div className="space-y-4">
            {membershipLoading ? (
              <p className="text-sm text-slate-500">Cargando membresías…</p>
            ) : (
              <>
                {Object.keys(memberships).length === 0 ? (
                  <EmptyState
                    title="Sin membresías"
                    description="Este usuario aún no tiene acceso a ningún tenant."
                  />
                ) : (
                  <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
                    {Object.entries(memberships).map(([tenantId, role]) => (
                      <li
                        key={tenantId}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {tenantId}
                          </p>
                          <Badge tone="sky">{ROLE_LABELS[role as IRole] ?? role}</Badge>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleRemoveMembership(tenantId)}
                          disabled={membershipSaving}
                        >
                          Quitar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <form
                  onSubmit={(event) => void handleAddMembership(event)}
                  noValidate
                  className="space-y-3 border-t border-slate-200 pt-4"
                >
                  <p className="text-sm font-medium text-slate-700">Agregar acceso a un tenant</p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label
                        htmlFor="membership-tenant"
                        className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                      >
                        Tenant
                      </label>
                      <select
                        id="membership-tenant"
                        value={membershipForm.tenantId}
                        onChange={(event) =>
                          setMembershipForm({ ...membershipForm, tenantId: event.target.value })
                        }
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      >
                        <option value="">Selecciona un tenant…</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.slug} value={tenant.slug}>
                            {tenant.name || tenant.slug}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label
                        htmlFor="membership-role"
                        className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                      >
                        Rol
                      </label>
                      <select
                        id="membership-role"
                        value={membershipForm.role}
                        onChange={(event) =>
                          setMembershipForm({
                            ...membershipForm,
                            role: event.target.value as IRole,
                          })
                        }
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="submit" variant="primary" loading={membershipSaving}>
                      Agregar
                    </Button>
                  </div>
                  {membershipError ? (
                    <p className="text-sm text-red-600">{membershipError}</p>
                  ) : null}
                </form>
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
