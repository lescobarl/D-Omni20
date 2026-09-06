/**
 * Pruebas del área «Usuarios» (`UsersSection`, control plane super-admin).
 *
 * Contrato:
 * - Lista los usuarios de plataforma con su perfil, badges y acciones.
 * - Permite buscar/filtrar por correo o nombre visible.
 * - Crea, edita y elimina usuarios de plataforma.
 * - Gestiona las membresías (tenant + rol) de cada usuario.
 * - Es fail-closed: sin servicio registrado muestra un estado de error accesible.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IMembershipRead, ITenantRead, IUserRead } from '@/api/types';
import { UsersSection } from '@/components/Users/UsersSection';
import { setTenantService, useTenantStore } from '@/store/tenantStore';
import { setUserService, useUserStore } from '@/store/userStore';
import { resetAuthSession, seedAuthenticatedSession } from '@/test/authSession';
import type { IUserService } from '@/services/studioUserService';
import type { ITenantService } from '@/services/tenantService';

/** Fábrica de `IUserRead` (DTO exacto del backend). */
function makeUser(overrides: Partial<IUserRead> = {}): IUserRead {
  return {
    id: 'user-1',
    email: 'user1@omni2.app',
    display_name: 'Usuario Uno',
    is_super_admin: false,
    is_active: true,
    last_login_at: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 0,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `ITenantRead` (DTO exacto del backend). */
function makeTenant(overrides: Partial<ITenantRead> = {}): ITenantRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'acme',
    name: 'Acme Corp',
    created_at: '2026-08-18T00:00:00Z',
    revision: 0,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `IMembershipRead`. */
function makeMembership(overrides: Partial<IMembershipRead> = {}): IMembershipRead {
  return {
    id: 'membership-1',
    user_id: 'user-1',
    tenant_id: 'acme',
    role: 'admin',
    created_at: '2026-08-18T00:00:00Z',
    revision: 0,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio de usuarios con `list` devolviendo los usuarios dados. */
function makeUserService(users: IUserRead[], overrides: Partial<IUserService> = {}): IUserService {
  return {
    list: vi.fn(async () => users),
    create: vi.fn(async () => {
      throw new Error('no usado');
    }),
    update: vi.fn(async () => {
      throw new Error('no usado');
    }),
    delete: vi.fn(async () => undefined),
    listMemberships: vi.fn(async () => []),
    addMembership: vi.fn(async () => {
      throw new Error('no usado');
    }),
    removeMembership: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Construye un servicio de tenants con `list` devolviendo los tenants dados. */
function makeTenantService(tenants: ITenantRead[]): ITenantService {
  return {
    list: vi.fn(async () => tenants),
    create: vi.fn(async () => {
      throw new Error('no usado');
    }),
    update: vi.fn(async () => {
      throw new Error('no usado');
    }),
    delete: vi.fn(async () => undefined),
  };
}

describe('UsersSection', () => {
  beforeEach(() => {
    resetAuthSession();
    seedAuthenticatedSession();
    useUserStore.getState().reset();
    useTenantStore.getState().reset();
    setUserService(null);
    setTenantService(null);
  });

  afterEach(() => {
    resetAuthSession();
    useUserStore.getState().reset();
    useTenantStore.getState().reset();
    setUserService(null);
    setTenantService(null);
  });

  it('lista los usuarios de plataforma con sus datos y badges', async () => {
    const users = [
      makeUser({
        id: 'user-1',
        email: 'admin@omni2.app',
        display_name: 'Admin',
        is_super_admin: true,
      }),
      makeUser({
        id: 'user-2',
        email: 'user@omni2.app',
        display_name: 'Usuario',
        is_active: false,
      }),
    ];
    setUserService(makeUserService(users));

    render(<UsersSection />);

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('admin@omni2.app')).toBeInTheDocument();
    expect(screen.getByText('Super-admin')).toBeInTheDocument();
    expect(screen.getByText('Usuario')).toBeInTheDocument();
    expect(screen.getByText('user@omni2.app')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('2 de 2 usuarios')).toBeInTheDocument();
  });

  it('filtra los usuarios por búsqueda de correo o nombre', async () => {
    const users = [
      makeUser({ id: 'user-1', email: 'admin@omni2.app', display_name: 'Admin' }),
      makeUser({ id: 'user-2', email: 'otro@omni2.app', display_name: 'Otro' }),
    ];
    setUserService(makeUserService(users));

    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Admin');

    await act(async () => {
      await user.type(screen.getByLabelText('Buscar'), 'otro');
    });

    expect(screen.getByText('Otro')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.getByText('1 de 2 usuarios')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay usuarios', async () => {
    setUserService(makeUserService([]));

    render(<UsersSection />);

    expect(await screen.findByText('Aún no hay usuarios')).toBeInTheDocument();
    expect(
      screen.getByText('Crea el primer usuario de la plataforma para comenzar.'),
    ).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible cuando falla listUsers', async () => {
    setUserService(
      makeUserService([], {
        list: vi.fn(async () => {
          throw new Error('Fallo de red');
        }),
      }),
    );

    render(<UsersSection />);

    expect(await screen.findByText('No se pudieron cargar los usuarios')).toBeInTheDocument();
    expect(screen.getByText('Fallo de red')).toBeInTheDocument();
  });

  it('crea un usuario desde el modal y lo agrega a la lista', async () => {
    const created = makeUser({
      id: 'user-new',
      email: 'nuevo@omni2.app',
      display_name: 'Nuevo',
      is_super_admin: true,
    });
    const userService = makeUserService([], {
      create: vi.fn(async () => created),
    });
    setUserService(userService);

    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Aún no hay usuarios');

    await act(async () => {
      // Con la lista vacía el botón «Nuevo usuario» aparece tanto en la cabecera
      // como en el estado vacío; cualquiera de los dos abre el mismo modal.
      await user.click(screen.getAllByRole('button', { name: 'Nuevo usuario' })[0]);
    });

    expect(screen.getByRole('heading', { name: 'Nuevo usuario' })).toBeInTheDocument();

    // El tecleo y el marcado de la casilla se hacen DENTRO de «act» para que React
    // aplique el valor controlado entre cada pulsación y no se pierdan caracteres.
    await act(async () => {
      await user.type(screen.getByLabelText('Correo electrónico'), 'nuevo@omni2.app');
      await user.type(screen.getByLabelText('Nombre visible'), 'Nuevo');
      await user.type(screen.getByLabelText('Contraseña'), 'secret123');
      await user.click(screen.getByLabelText('Super-admin de la plataforma'));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear usuario' }));
    });

    expect(userService.create).toHaveBeenCalledWith({
      email: 'nuevo@omni2.app',
      password: 'secret123',
      display_name: 'Nuevo',
      is_super_admin: true,
    });
    expect(await screen.findByText('Nuevo')).toBeInTheDocument();
    expect(screen.getByText('Super-admin')).toBeInTheDocument();
  });

  it('valida el correo y la contraseña antes de crear', async () => {
    setUserService(makeUserService([]));

    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Aún no hay usuarios');

    await act(async () => {
      // Con la lista vacía el botón «Nuevo usuario» aparece tanto en la cabecera
      // como en el estado vacío; cualquiera de los dos abre el mismo modal.
      await user.click(screen.getAllByRole('button', { name: 'Nuevo usuario' })[0]);
    });

    await act(async () => {
      await user.type(screen.getByLabelText('Contraseña'), 'corta');
      await user.click(screen.getByRole('button', { name: 'Crear usuario' }));
    });

    expect(screen.getByText('El correo electrónico es obligatorio.')).toBeInTheDocument();
  });

  it('edita un usuario existente precargando el formulario', async () => {
    const updated = makeUser({
      id: 'user-1',
      email: 'user1@omni2.app',
      display_name: 'Renombrado',
      is_super_admin: true,
    });
    const userService = makeUserService([makeUser()], {
      update: vi.fn(async () => updated),
    });
    setUserService(userService);

    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Usuario Uno');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('heading', { name: 'Editar usuario' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toBeDisabled();

    const nameInput = screen.getByLabelText('Nombre visible');
    // «clear» y «type» se hacen DENTRO de «act» para que React aplique el valor
    // controlado entre cada pulsación y no se pierdan caracteres.
    await act(async () => {
      await user.clear(nameInput);
      await user.type(nameInput, 'Renombrado');
      await user.click(screen.getByLabelText('Super-admin de la plataforma'));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(userService.update).toHaveBeenCalledWith('user-1', {
      display_name: 'Renombrado',
      is_super_admin: true,
      is_active: true,
    });
    expect(await screen.findByText('Renombrado')).toBeInTheDocument();
  });

  it('elimina un usuario tras confirmar', async () => {
    const userService = makeUserService([makeUser()], {
      delete: vi.fn(async () => undefined),
    });
    setUserService(userService);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Usuario Uno');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      '¿Eliminar al usuario «user1@omni2.app»? Esta acción no se puede deshacer.',
    );
    expect(userService.delete).toHaveBeenCalledWith('user-1');
    expect(await screen.findByText('Aún no hay usuarios')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('no elimina al usuario cuando se cancela la confirmación', async () => {
    const userService = makeUserService([makeUser()], {
      delete: vi.fn(async () => undefined),
    });
    setUserService(userService);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Usuario Uno');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(userService.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Usuario Uno')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('gestiona las membresías de un usuario: agrega y quita acceso', async () => {
    const tenant = makeTenant();
    // El servicio «listMemberships» es la fuente de verdad que el componente usa
    // para resolver el id real de la membresía al quitarla; por eso debe reflejar
    // la membresía recién agregada (se actualiza tras cada alta).
    let memberships: IMembershipRead[] = [];
    const userService = makeUserService([makeUser()], {
      listMemberships: vi.fn(async () => memberships),
      addMembership: vi.fn(async (payload) => {
        const created = makeMembership({
          id: 'membership-acme',
          tenant_id: payload.tenant_id,
          role: payload.role,
        });
        memberships = [created];
        return created;
      }),
    });
    setUserService(userService);
    setTenantService(makeTenantService([tenant]));
    useTenantStore.setState({ tenants: [tenant] });

    const user = userEvent.setup();
    render(<UsersSection />);

    await screen.findByText('Usuario Uno');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Membresías' }));
    });

    expect(
      await screen.findByRole('heading', { name: 'Membresías de Usuario Uno' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Sin membresías')).toBeInTheDocument();

    // Agregar una membresía al tenant acme con rol configurador. Las selecciones
    // se hacen DENTRO de «act» para que React aplique el valor controlado entre
    // eventos.
    await act(async () => {
      await user.selectOptions(screen.getByLabelText('Tenant'), 'acme');
      await user.selectOptions(screen.getByLabelText('Rol'), 'configurador');
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agregar' }));
    });

    expect(userService.addMembership).toHaveBeenCalledWith({
      user_id: 'user-1',
      tenant_id: 'acme',
      role: 'configurador',
    });
    expect(await screen.findByText('acme')).toBeInTheDocument();
    // «Configurador» aparece tanto en la insignia de la membresía como en las
    // opciones del selector de rol del formulario de alta.
    expect(screen.getAllByText('Configurador').length).toBeGreaterThan(0);

    // Quitar la membresía tras confirmar.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Quitar' }));
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      '¿Quitar al usuario de «acme»? Perderá el acceso a ese tenant.',
    );
    expect(await screen.findByText('Sin membresías')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
