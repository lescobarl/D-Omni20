/**
 * Pruebas de la sección «Mi perfil» (`ProfileSection`).
 *
 * Contrato:
 * - Muestra los datos de la cuenta (email, nombre, rol de plataforma y rol en el
 *   tenant activo) del usuario autenticado.
 * - Lista las membresías (tenant + rol) del usuario autenticado.
 * - La edición del nombre visible delega en `useAuthStore.updateMe`.
 * - El formulario de cambio de contraseña valida localmente y delega en
 *   `useAuthStore.changePassword`.
 * - El botón «Cerrar sesión» delega en `useAuthStore.logout`.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileSection } from '@/components/Profile/ProfileSection';
import { setAuthService, useAuthStore } from '@/store/authStore';
import {
  makeMembership,
  makeRegularUser,
  makeSuperAdminUser,
  resetAuthSession,
  seedAuthenticatedSession,
} from '@/test/authSession';
import type { IAuthService } from '@/services/studioAuthService';

/** Construye un servicio de autenticación de prueba con acciones espiables. */
function makeAuthService(overrides: Partial<IAuthService> = {}): IAuthService {
  return {
    login: vi.fn(async () => {
      throw new Error('no usado');
    }),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => makeSuperAdminUser()),
    myMemberships: vi.fn(async () => []),
    changePassword: vi.fn(async () => undefined),
    updateMe: vi.fn(async () => makeSuperAdminUser()),
    ...overrides,
  };
}

describe('ProfileSection', () => {
  beforeEach(() => {
    resetAuthSession();
    setAuthService(null);
  });

  afterEach(() => {
    resetAuthSession();
    setAuthService(null);
  });

  it('muestra los datos de la cuenta del usuario autenticado', () => {
    seedAuthenticatedSession({
      user: makeSuperAdminUser(),
      memberships: [makeMembership('test-tenant', 'admin')],
      activeRole: 'admin',
    });
    render(<ProfileSection />);

    expect(screen.getByRole('heading', { name: 'Mi perfil' })).toBeInTheDocument();
    expect(screen.getByText('admin@omni2.app')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Super administrador')).toBeInTheDocument();
    expect(screen.getAllByText('Administrador').length).toBeGreaterThan(0);
  });

  it('muestra «Usuario» y «Sin membresía» para un usuario regular sin membresías', () => {
    seedAuthenticatedSession({
      user: makeRegularUser(),
      memberships: [],
      activeRole: null,
    });
    render(<ProfileSection />);

    expect(screen.getByText('user@omni2.app')).toBeInTheDocument();
    expect(screen.getAllByText('Usuario').length).toBeGreaterThan(0);
    expect(screen.getByText('Sin membresía')).toBeInTheDocument();
    expect(screen.getByText('No perteneces a ningún tenant todavía.')).toBeInTheDocument();
  });

  it('lista las membresías con su tenant y rol legible', () => {
    seedAuthenticatedSession({
      user: makeRegularUser(),
      memberships: [
        makeMembership('tenant-a', 'admin', 'user-regular'),
        makeMembership('tenant-b', 'operador', 'user-regular'),
      ],
      activeRole: 'admin',
    });
    render(<ProfileSection />);

    expect(screen.getByText('Membresías (2)')).toBeInTheDocument();
    expect(screen.getByText('tenant-a')).toBeInTheDocument();
    expect(screen.getByText('tenant-b')).toBeInTheDocument();
    expect(screen.getAllByText('Administrador').length).toBeGreaterThan(0);
    expect(screen.getByText('Operador')).toBeInTheDocument();
  });

  it('valida que el nombre no pueda quedar vacío al editar el perfil', async () => {
    seedAuthenticatedSession();
    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    const nameInput = screen.getByLabelText('Nombre visible');
    await act(async () => {
      await user.clear(nameInput);
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('El nombre no puede estar vacío.');
  });

  it('edita el nombre visible y delega en updateMe', async () => {
    seedAuthenticatedSession();
    const updatedUser = { ...makeSuperAdminUser(), display_name: 'Nuevo Nombre' };
    const authService = makeAuthService({
      updateMe: vi.fn(async () => updatedUser),
    });
    setAuthService(authService);

    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    const nameInput = screen.getByLabelText('Nombre visible');
    await act(async () => {
      await user.clear(nameInput);
      await user.type(nameInput, 'Nuevo Nombre');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(authService.updateMe).toHaveBeenCalledWith({ display_name: 'Nuevo Nombre' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Perfil actualizado correctamente.',
    );
    expect(screen.getByText('Nuevo Nombre')).toBeInTheDocument();
  });

  it('muestra el error del store cuando updateMe no puede actualizar', async () => {
    seedAuthenticatedSession();
    setAuthService(
      makeAuthService({
        updateMe: vi.fn(async () => {
          throw new Error('Fallo de red');
        }),
      }),
    );

    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    const nameInput = screen.getByLabelText('Nombre visible');
    await act(async () => {
      await user.clear(nameInput);
      await user.type(nameInput, 'Otro Nombre');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((alert) => alert.textContent?.includes('Fallo de red'))).toBe(true);
  });

  it('valida la contraseña actual obligatoria antes de cambiar', async () => {
    seedAuthenticatedSession();
    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva1234');
      await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'nueva1234');
      await user.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('La contraseña actual es obligatoria.');
  });

  it('valida la longitud mínima de la nueva contraseña', async () => {
    seedAuthenticatedSession();
    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.type(screen.getByLabelText('Contraseña actual'), 'actual123');
      await user.type(screen.getByLabelText('Nueva contraseña'), 'corta');
      await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'corta');
      await user.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'La nueva contraseña debe tener al menos 8 caracteres.',
    );
  });

  it('valida que la confirmación coincida con la nueva contraseña', async () => {
    seedAuthenticatedSession();
    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.type(screen.getByLabelText('Contraseña actual'), 'actual123');
      await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva1234');
      await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'distinta');
      await user.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'La confirmación no coincide con la nueva contraseña.',
    );
  });

  it('cambia la contraseña y delega en changePassword', async () => {
    seedAuthenticatedSession();
    const authService = makeAuthService();
    setAuthService(authService);

    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.type(screen.getByLabelText('Contraseña actual'), 'actual123');
      await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva1234');
      await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'nueva1234');
      await user.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));
    });

    expect(authService.changePassword).toHaveBeenCalledWith({
      current_password: 'actual123',
      new_password: 'nueva1234',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Contraseña actualizada correctamente.',
    );
  });

  it('muestra el error del backend cuando changePassword falla', async () => {
    seedAuthenticatedSession();
    const authService = makeAuthService({
      changePassword: vi.fn(async () => {
        throw new Error('La contraseña actual es incorrecta.');
      }),
    });
    setAuthService(authService);

    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.type(screen.getByLabelText('Contraseña actual'), 'incorrecta');
      await user.type(screen.getByLabelText('Nueva contraseña'), 'nueva1234');
      await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'nueva1234');
      await user.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La contraseña actual es incorrecta.',
    );
  });

  it('cierra la sesión al pulsar «Cerrar sesión»', async () => {
    seedAuthenticatedSession();
    const logoutSpy = vi
      .spyOn(useAuthStore.getState(), 'logout')
      .mockImplementation(async () => undefined);
    const user = userEvent.setup();
    render(<ProfileSection />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    });

    expect(logoutSpy).toHaveBeenCalled();
    logoutSpy.mockRestore();
  });
});
