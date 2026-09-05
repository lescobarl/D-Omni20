/**
 * Pantalla de inicio de sesión del estudio (RBAC).
 *
 * Contrato:
 * - Formulario de email+password que delega en `useAuthStore.login`.
 * - Al autenticar, el store carga el perfil y las membresías; la sesión se
 *   restaura al arrancar vía `loadMe` (el token se persiste en `tokenStore`).
 * - Muestra errores de credenciales y un estado de carga mientras autentica.
 * - Es una pantalla independiente (sin cabecera de la app): se renderiza cuando
 *   no hay sesión activa en `App.tsx`.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';

/** Estado del formulario de inicio de sesión. */
interface ILoginForm {
  email: string;
  password: string;
}

const EMPTY_FORM: ILoginForm = { email: '', password: '' };

/**
 * Renderiza la pantalla de inicio de sesión del estudio.
 *
 * @example
 * ```tsx
 * <LoginScreen />;
 * ```
 *
 * @returns La pantalla de login centrada con el formulario de credenciales.
 */
export function LoginScreen(): ReactElement {
  const login = useAuthStore((state) => state.login);
  const status = useAuthStore((state) => state.status);
  const storeError = useAuthStore((state) => state.error);

  const [form, setForm] = useState<ILoginForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const busy = status === 'loading';

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const email = form.email.trim();
    const password = form.password;
    if (email === '') {
      setFormError('El correo electrónico es obligatorio.');
      return;
    }
    if (password === '') {
      setFormError('La contraseña es obligatoria.');
      return;
    }
    setFormError(null);
    try {
      await login(email, password);
    } catch (caught) {
      // El store ya expone el mensaje de error; se muestra junto al formulario.
      setFormError(caught instanceof Error ? caught.message : 'No se pudo iniciar sesión.');
    }
  };

  const errorMessage = formError ?? storeError;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900">OmniBotIA Studio</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Inicia sesión para acceder a tu cuenta.
        </p>

        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-6 space-y-4"
        >
          <Input
            id="login-email"
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="usuario@ejemplo.com"
            required
          />
          <Input
            id="login-password"
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            placeholder="••••••••"
            required
          />

          {errorMessage !== null && (
            <span role="alert" className="block text-sm text-red-600">
              {errorMessage}
            </span>
          )}

          <Button type="submit" loading={busy} className="w-full">
            Iniciar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}
