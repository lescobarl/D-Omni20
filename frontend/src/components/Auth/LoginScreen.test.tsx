/**
 * Pruebas de la pantalla de inicio de sesión (`LoginScreen`).
 *
 * Contrato:
 * - Renderiza el formulario de email+password y delega en `useAuthStore.login`.
 * - Valida localmente que email y password no estén vacíos.
 * - Muestra el error del backend (o del store) de forma accesible (`role="alert"`).
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ILoginResponse } from '@/api/types';
import { LoginScreen } from '@/components/Auth/LoginScreen';
import { AppError } from '@/lib/errors';
import { setAuthService, useAuthStore } from '@/store/authStore';
import { makeSuperAdminUser, resetAuthSession } from '@/test/authSession';

describe('LoginScreen', () => {
  beforeEach(() => {
    resetAuthSession();
  });

  afterEach(() => {
    resetAuthSession();
  });

  it('renderiza el título, la descripción y el formulario de credenciales', () => {
    render(<LoginScreen />);

    expect(screen.getByRole('heading', { name: 'OmniBotIA Studio' })).toBeInTheDocument();
    expect(screen.getByText('Inicia sesión para acceder a tu cuenta.')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('valida el correo obligatorio antes de enviar', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('El correo electrónico es obligatorio.');
  });

  it('valida la contraseña obligatoria cuando el correo está presente', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await act(async () => {
      await user.type(screen.getByLabelText('Correo electrónico'), 'admin@omni2.app');
      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('La contraseña es obligatoria.');
  });

  it('llama a login con email y password al enviar credenciales válidas', async () => {
    const loginSpy = vi
      .spyOn(useAuthStore.getState(), 'login')
      .mockImplementation(async () => undefined);
    const user = userEvent.setup();
    render(<LoginScreen />);

    await act(async () => {
      await user.type(screen.getByLabelText('Correo electrónico'), 'admin@omni2.app');
      await user.type(screen.getByLabelText('Contraseña'), 'secret123');
      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    });

    expect(loginSpy).toHaveBeenCalledWith('admin@omni2.app', 'secret123');
    loginSpy.mockRestore();
  });

  it('muestra el error del backend cuando login falla', async () => {
    const authService = {
      login: vi.fn(async () => {
        throw new AppError('Credenciales inválidas.', 'auth.login');
      }),
      logout: vi.fn(async () => undefined),
      me: vi.fn(async () => {
        throw new Error('no usado');
      }),
      myMemberships: vi.fn(async () => []),
      changePassword: vi.fn(async () => undefined),
      updateMe: vi.fn(async () => {
        throw new Error('no usado');
      }),
    };
    setAuthService(authService);

    const user = userEvent.setup();
    render(<LoginScreen />);

    await act(async () => {
      await user.type(screen.getByLabelText('Correo electrónico'), 'admin@omni2.app');
      await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
  });

  it('muestra el estado de carga mientras autentica', async () => {
    // Promesa controlada por la prueba: evita dejar un temporizador pendiente
    // que dispare actualizaciones de estado después de que el entorno de la
    // prueba se haya desmontado (causa de rechazos no controlados en la suite).
    let resolveLogin!: (value: ILoginResponse) => void;
    const loginPromise = new Promise<ILoginResponse>((resolve) => {
      resolveLogin = resolve;
    });
    const authService = {
      login: vi.fn(() => loginPromise),
      logout: vi.fn(async () => undefined),
      me: vi.fn(async () => makeSuperAdminUser()),
      myMemberships: vi.fn(async () => []),
      changePassword: vi.fn(async () => undefined),
      updateMe: vi.fn(async () => makeSuperAdminUser()),
    };
    setAuthService(authService);

    const user = userEvent.setup();
    render(<LoginScreen />);

    await act(async () => {
      await user.type(screen.getByLabelText('Correo electrónico'), 'admin@omni2.app');
      await user.type(screen.getByLabelText('Contraseña'), 'secret123');
      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    });

    expect(screen.getByRole('button', { name: 'Cargando…' })).toBeDisabled();

    // Resuelve la autenticación pendiente dentro de la prueba para que el
    // flujo asíncrono (login -> perfil/membresías -> estado) termine aquí.
    await act(async () => {
      resolveLogin({
        access_token: 'token',
        token_type: 'bearer',
        user: makeSuperAdminUser(),
      });
    });
  });
});
