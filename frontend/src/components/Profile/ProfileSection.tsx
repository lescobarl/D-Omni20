/**
 * Sección «Mi perfil» del estudio (RBAC).
 *
 * Contrato:
 * - Muestra el perfil del usuario autenticado (email, nombre, flag de
 *   super-admin) y su rol activo en el tenant activo.
 * - Lista las membresías (tenant + rol) del usuario autenticado.
 * - Formulario para cambiar la contraseña (verifica la actual) que delega en
 *   `useAuthStore.changePassword`.
 * - Botón de cierre de sesión que delega en `useAuthStore.logout`.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Badge, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import type { IRole } from '@/api/types';

/** Etiquetas legibles de los roles por tenant. */
const ROLE_LABELS: Record<IRole, string> = {
  admin: 'Administrador',
  configurador: 'Configurador',
  operador: 'Operador',
};

/** Estado del formulario de cambio de contraseña. */
interface IPasswordForm {
  /** Contraseña actual del usuario. */
  currentPassword: string;
  /** Nueva contraseña (mínimo 8 caracteres). */
  newPassword: string;
  /** Confirmación de la nueva contraseña. */
  confirmPassword: string;
}

const EMPTY_PASSWORD_FORM: IPasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

/**
 * Renderiza la sección «Mi perfil» con datos de la cuenta, membresías y el
 * formulario de cambio de contraseña.
 *
 * @returns La sección de perfil del usuario autenticado.
 */
export function ProfileSection(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const memberships = useAuthStore((state) => state.memberships);
  const activeRole = useAuthStore((state) => state.activeRole);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const status = useAuthStore((state) => state.status);
  const storeError = useAuthStore((state) => state.error);
  const changePassword = useAuthStore((state) => state.changePassword);
  const updateMe = useAuthStore((state) => state.updateMe);
  const logout = useAuthStore((state) => state.logout);

  const [form, setForm] = useState<IPasswordForm>(EMPTY_PASSWORD_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edición del nombre visible del perfil.
  const [editOpen, setEditOpen] = useState(false);
  const [nameValue, setNameValue] = useState(user?.display_name ?? '');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  const busy = status === 'loading';

  const handleUpdateProfile = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = nameValue.trim();
    if (name === '') {
      setEditError('El nombre no puede estar vacío.');
      return;
    }
    setEditError(null);
    setEditSuccess(null);
    const updated = await updateMe({ display_name: name });
    if (updated !== null) {
      setNameValue(updated.display_name ?? '');
      setEditOpen(false);
      setEditSuccess('Perfil actualizado correctamente.');
    } else {
      setEditError(storeError ?? 'No se pudo actualizar el perfil.');
    }
  };

  const handleChangePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const currentPassword = form.currentPassword;
    const newPassword = form.newPassword;
    if (currentPassword === '') {
      setFormError('La contraseña actual es obligatoria.');
      return;
    }
    if (newPassword.length < 8) {
      setFormError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (newPassword !== form.confirmPassword) {
      setFormError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setFormError(null);
    setSuccess(null);
    try {
      await changePassword(currentPassword, newPassword);
      setForm(EMPTY_PASSWORD_FORM);
      setSuccess('Contraseña actualizada correctamente.');
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo cambiar la contraseña.');
    }
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await logout();
    } catch (caught) {
      // El store ya cerró la sesión local en `finally` y la capa API auditó el
      // fallo; aquí solo se propaga el contexto del invariante (servicio ausente)
      // sin silenciarlo.
      console.error('[auth.logout] fallo tras el cierre local de sesión', caught);
    }
  };

  const errorMessage = formError ?? storeError;

  return (
    <section aria-labelledby="profile-heading" className="mx-auto max-w-3xl space-y-6 p-6">
      <h2 id="profile-heading" className="text-xl font-semibold text-slate-900">
        Mi perfil
      </h2>

      {/* Datos de la cuenta */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Datos de la cuenta
        </h3>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Correo electrónico</dt>
            <dd className="font-medium text-slate-900">{user?.email ?? '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Nombre</dt>
            <dd className="flex items-center gap-3">
              <span className="font-medium text-slate-900">{user?.display_name ?? '—'}</span>
              {!editOpen && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setNameValue(user?.display_name ?? '');
                    setEditError(null);
                    setEditOpen(true);
                  }}
                >
                  Editar
                </Button>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Rol de plataforma</dt>
            <dd>
              {isSuperAdmin ? (
                <Badge tone="brand">Super administrador</Badge>
              ) : (
                <Badge tone="neutral">Usuario</Badge>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Rol en el tenant activo</dt>
            <dd>
              {activeRole !== null ? (
                <Badge tone="sky">{ROLE_LABELS[activeRole]}</Badge>
              ) : (
                <Badge tone="muted">Sin membresía</Badge>
              )}
            </dd>
          </div>
        </dl>

        {editOpen && (
          <form
            noValidate
            onSubmit={(event) => void handleUpdateProfile(event)}
            className="mt-4 space-y-3 border-t border-slate-100 pt-4"
          >
            <Input
              id="profile-name"
              label="Nombre visible"
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
              required
            />
            {editError !== null && (
              <span role="alert" className="block text-sm text-red-600">
                {editError}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" loading={busy}>
                Guardar
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditOpen(false);
                  setEditError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {editSuccess !== null && (
          <span role="status" className="mt-3 block text-sm text-green-600">
            {editSuccess}
          </span>
        )}
      </div>

      {/* Membresías */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Membresías ({memberships.length})
        </h3>
        {memberships.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No perteneces a ningún tenant todavía.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {memberships.map((membership) => (
              <li
                key={membership.id}
                className="flex items-center justify-between gap-4 py-2 text-sm"
              >
                <span className="font-medium text-slate-900">{membership.tenant_id}</span>
                <Badge tone="sky">{ROLE_LABELS[membership.role]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cambio de contraseña */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Cambiar contraseña
        </h3>
        <form
          noValidate
          onSubmit={(event) => void handleChangePassword(event)}
          className="mt-4 space-y-4"
        >
          <Input
            id="profile-current-password"
            label="Contraseña actual"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, currentPassword: event.target.value }))
            }
            required
          />
          <Input
            id="profile-new-password"
            label="Nueva contraseña"
            type="password"
            autoComplete="new-password"
            hint="Mínimo 8 caracteres."
            value={form.newPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, newPassword: event.target.value }))
            }
            required
          />
          <Input
            id="profile-confirm-password"
            label="Confirmar nueva contraseña"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(event) =>
              setForm((current) => ({ ...current, confirmPassword: event.target.value }))
            }
            required
          />

          {errorMessage !== null && (
            <span role="alert" className="block text-sm text-red-600">
              {errorMessage}
            </span>
          )}
          {success !== null && (
            <span role="status" className="block text-sm text-green-600">
              {success}
            </span>
          )}

          <Button type="submit" loading={busy}>
            Actualizar contraseña
          </Button>
        </form>
      </div>

      {/* Cierre de sesión */}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => void handleLogout()}>
          Cerrar sesión
        </Button>
      </div>
    </section>
  );
}
