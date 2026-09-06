/**
 * Pruebas de la puerta de autenticación y del filtrado RBAC del shell de la app.
 *
 * Contrato:
 * - Sin sesión válida, `App` muestra la pantalla de inicio de sesión (y una
 *   pantalla de carga mientras se restaura la sesión).
 * - Con sesión autenticada, la navegación y el control plane se filtran por rol
 *   (fail-closed): solo el super-admin ve la gestión de tenants y «Usuarios».
 * - Un usuario no super-admin con rol por tenant no ve el control plane ni las
 *   áreas RBAC a las que no tiene acceso.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/App';
import { createTestConfig } from '@/test/config';
import { setAuthService, useAuthStore } from '@/store/authStore';
import type { IAuthService } from '@/services/studioAuthService';
import { useEditorStore } from '@/store/editorStore';
import { useAdsStore } from '@/store/adsStore';
import { useTenantStore } from '@/store/tenantStore';
import { setTenantService } from '@/store/tenantStore';
import {
  makeMembership,
  makeRegularUser,
  makeSuperAdminUser,
  resetAuthSession,
  seedAuthenticatedSession,
} from '@/test/authSession';

describe('App — puerta de autenticación y RBAC', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
    useAdsStore.getState().reset();
    useTenantStore.getState().reset();
    resetAuthSession();
    setTenantService(null);
  });

  it('muestra la pantalla de carga mientras se restaura la sesión', () => {
    // `App` restaura la sesión al montar (`loadMe`). Con un servicio registrado
    // cuyo `me`/`myMemberships` quedan pendientes, el estado pasa a `loading` y la
    // puerta de autenticación muestra la pantalla de carga (no el login).
    const pending = new Promise<never>(() => {});
    const authService: IAuthService = {
      login: async () => {
        throw new Error('no usado en esta prueba');
      },
      logout: async () => {
        throw new Error('no usado en esta prueba');
      },
      me: () => pending,
      myMemberships: () => pending,
      changePassword: async () => {
        throw new Error('no usado en esta prueba');
      },
      updateMe: async () => {
        throw new Error('no usado en esta prueba');
      },
    };
    setAuthService(authService);

    render(<App config={createTestConfig()} />);

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });

  it('muestra la pantalla de inicio de sesión cuando no hay sesión válida', () => {
    // Sin sesión y con estado resuelto (error) → se muestra el login, no el shell.
    useAuthStore.setState({ isAuthenticated: false, status: 'error', error: null });

    render(<App config={createTestConfig()} />);

    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    // El shell autenticado no debe renderizarse.
    expect(screen.queryByRole('navigation', { name: 'Áreas de la aplicación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nuevo tenant' })).toBeNull();
  });

  it('tras iniciar sesión muestra el shell con la navegación del super-admin', async () => {
    // Simula el flujo real: primero sin sesión (login) y luego una sesión válida
    // de super-admin tras autenticarse.
    useAuthStore.setState({ isAuthenticated: false, status: 'error', error: null });

    const { unmount } = render(<App config={createTestConfig()} />);
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();

    // Se autentica el usuario (super-admin) y se vuelve a montar el shell.
    unmount();
    seedAuthenticatedSession();

    render(<App config={createTestConfig()} />);

    // Cabecera con el nombre de la aplicación y la navegación por áreas.
    expect(screen.getByText('OmniBotIA Studio')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Áreas de la aplicación' })).toBeInTheDocument();
    // El super-admin ve el control plane («Usuarios» y «Tenants») y «Mi perfil».
    expect(screen.getByRole('button', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tenants' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mi perfil' })).toBeInTheDocument();
    // La gestión de tenants ya no se muestra regada en la cabecera.
    expect(screen.queryByRole('button', { name: 'Nuevo tenant' })).toBeNull();
  });

  it('el super-admin gestiona los tenants desde su propia pestaña', async () => {
    const user = userEvent.setup();
    seedAuthenticatedSession();

    render(<App config={createTestConfig()} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Tenants' }));
    });

    expect(screen.getByRole('heading', { name: 'Gestión de tenants' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo tenant' })).toBeInTheDocument();
  });

  it('el super-admin puede navegar al área de usuarios de la plataforma', async () => {
    const user = userEvent.setup();
    seedAuthenticatedSession();

    render(<App config={createTestConfig()} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Usuarios' }));
    });

    expect(screen.getByRole('button', { name: 'Usuarios' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Usuarios' })).toBeInTheDocument();
  });

  it('un usuario no super-admin no ve el control plane ni «Usuarios»', () => {
    // Usuario regular con rol por tenant (configurador): autenticado pero sin
    // privilegios de plataforma.
    seedAuthenticatedSession({
      user: makeRegularUser(),
      memberships: [makeMembership('test-tenant', 'configurador', 'user-regular')],
      activeRole: 'configurador',
      isSuperAdmin: false,
    });

    render(<App config={createTestConfig()} />);

    // El shell autenticado se muestra (no el login).
    expect(screen.getByRole('navigation', { name: 'Áreas de la aplicación' })).toBeInTheDocument();
    // Sin control plane: no hay gestión de tenants ni pestaña «Tenants».
    expect(screen.queryByRole('button', { name: 'Nuevo tenant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tenants' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Renombrar' })).toBeNull();
    // «Usuarios» (platformUsers) está oculto para quien no es super-admin.
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    // El rol configurador sí accede a contenido («Sitio») y a «Mi perfil».
    expect(screen.getByRole('button', { name: 'Sitio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mi perfil' })).toBeInTheDocument();
  });

  it('el operador solo ve las áreas de operación (definición RBAC)', () => {
    seedAuthenticatedSession({
      user: makeRegularUser(),
      memberships: [makeMembership('test-tenant', 'operador', 'user-operador')],
      activeRole: 'operador',
      isSuperAdmin: false,
    });

    render(
      <App
        config={createTestConfig({
          features: {
            ...createTestConfig().features,
            operations: true,
            ads: true,
            hosts: true,
            appearance: true,
          },
        })}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Áreas de la aplicación' })).toBeInTheDocument();
    // Operación sí (admin/operador); contenido y configuración del tenant no.
    expect(screen.getByRole('button', { name: 'Operación del bot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sitio' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Configuración' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dominios' })).toBeNull();
    // Sin control plane ni gestión de usuarios/tenants.
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tenants' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mi perfil' })).toBeInTheDocument();
  });

  it('el admin del tenant accede a contenido, configuración y operación (definición RBAC)', () => {
    seedAuthenticatedSession({
      user: makeRegularUser(),
      memberships: [makeMembership('test-tenant', 'admin', 'user-admin')],
      activeRole: 'admin',
      isSuperAdmin: false,
    });

    render(
      <App
        config={createTestConfig({
          features: {
            ...createTestConfig().features,
            operations: true,
            ads: true,
            hosts: true,
            appearance: true,
          },
        })}
      />,
    );

    // Admin (no super-admin) gestiona el tenant: sitio + configuración + operación.
    expect(screen.getByRole('button', { name: 'Sitio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operación del bot' })).toBeInTheDocument();
    // El control plane queda reservado al super-admin.
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tenants' })).toBeNull();
  });

  it('un usuario no super-admin sin membresía no ve áreas RBAC restringidas', () => {
    // Usuario regular sin membresía en ningún tenant: rol activo nulo.
    seedAuthenticatedSession({
      user: makeRegularUser(),
      memberships: [],
      activeRole: null,
      isSuperAdmin: false,
    });

    render(<App config={createTestConfig()} />);

    // Sin control plane ni «Usuarios»/«Tenants».
    expect(screen.queryByRole('button', { name: 'Nuevo tenant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tenants' })).toBeNull();
    // Sin rol por tenant no accede a contenido («Sitio» está fail-closed).
    expect(screen.queryByRole('button', { name: 'Sitio' })).toBeNull();
  });

  it('el super-admin ve el selector de tenant y puede cambiar el rol activo', async () => {
    const user = userEvent.setup();
    seedAuthenticatedSession({
      user: makeSuperAdminUser(),
      memberships: [
        makeMembership('test-tenant', 'admin', 'user-superadmin'),
        makeMembership('dev-tenant', 'operador', 'user-superadmin'),
      ],
      activeRole: 'admin',
      isSuperAdmin: true,
    });
    setTenantService({
      list: async () => [
        {
          id: 't-0',
          slug: 'test-tenant',
          name: 'Test Tenant',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
        {
          id: 't-1',
          slug: 'dev-tenant',
          name: 'Dev Tenant',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
      ],
      create: async () => {
        throw new Error('no usado en esta prueba');
      },
      update: async () => {
        throw new Error('no usado en esta prueba');
      },
      delete: async () => {
        throw new Error('no usado en esta prueba');
      },
    });

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    expect(selector).toHaveValue('test-tenant');
    // El rol activo inicial es el de la primera membresía (admin).
    expect(useAuthStore.getState().activeRole).toBe('admin');

    await act(async () => {
      await user.selectOptions(selector, 'dev-tenant');
    });

    // Al cambiar de tenant se recalcula el rol activo desde las membresías.
    expect(useAuthStore.getState().activeRole).toBe('operador');
    expect(useTenantStore.getState().activeTenantId).toBe('dev-tenant');
  });

  it('muestra un botón de salida persistente que permite entrar con otro perfil', async () => {
    const user = userEvent.setup();
    seedAuthenticatedSession();
    const logoutSpy = vi.fn(async () => undefined);
    setAuthService({
      login: async () => {
        throw new Error('no usado en esta prueba');
      },
      logout: logoutSpy,
      // Tras cerrar sesión, la restauración automática debe fallar (el token ya
      // no es válido), como ocurre con el backend real.
      me: async () => {
        throw new Error('Sesión cerrada');
      },
      myMemberships: async () => {
        throw new Error('Sesión cerrada');
      },
      changePassword: async () => {
        throw new Error('no usado en esta prueba');
      },
      updateMe: async () => {
        throw new Error('no usado en esta prueba');
      },
    });

    render(<App config={createTestConfig()} />);

    const logoutButton = screen.getByRole('button', { name: 'Cerrar sesión' });
    expect(logoutButton).toBeInTheDocument();

    await act(async () => {
      await user.click(logoutButton);
    });

    // La sesión se cierra y la app vuelve a la pantalla de inicio de sesión,
    // lista para entrar con otro usuario/perfil.
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Áreas de la aplicación' })).toBeNull();
  });
});
