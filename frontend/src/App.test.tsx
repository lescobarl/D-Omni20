/**
 * Pruebas del componente raíz de la aplicación.
 *
 * Contrato:
 * - Renderiza la cabecera con la configuración inyectada.
 * - Agrega bloques desde la librería y los muestra en el canvas.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/App';
import { createTestConfig } from '@/test/config';
import { useEditorStore } from '@/store/editorStore';
import { usePortalStore } from '@/store/portalStore';
import { useAdsStore } from '@/store/adsStore';
import { useTenantStore } from '@/store/tenantStore';
import { setTenantService } from '@/store/tenantStore';
import { resetAuthSession, seedAuthenticatedSession } from '@/test/authSession';
import type { ITenantService } from '@/services/tenantService';
import type { ITenantRead } from '@/api/types';

/** Servicio de tenants de prueba que devuelve una lista fija. */
function createTenantServiceStub(tenants: ITenantRead[]): ITenantService {
  return {
    list: async () => tenants,
    create: async () => {
      throw new Error('no usado en esta prueba');
    },
    update: async () => {
      throw new Error('no usado en esta prueba');
    },
    delete: async () => {
      throw new Error('no usado en esta prueba');
    },
  };
}

/** Construye un `ITenantRead` de prueba con valores por defecto. */
function makeTenant(overrides: Partial<ITenantRead>): ITenantRead {
  return {
    id: `id-${overrides.slug ?? 'tenant'}`,
    slug: 'tenant',
    name: 'Tenant',
    created_at: '',
    revision: 0,
    updated_at: '',
    ...overrides,
  };
}

/**
 * Servicio de tenants de prueba con estado mutable para ejercitar el CRUD.
 *
 * Mantiene una lista interna que `create`/`update`/`delete` mutan, de modo que
 * el `loadTenants` interno del store refleja los cambios tras cada operación.
 */
function createCrudTenantServiceStub(initial: ITenantRead[]): ITenantService & {
  listState: () => ITenantRead[];
} {
  let state = [...initial];
  return {
    list: async () => [...state],
    create: async (payload) => {
      const created = makeTenant({
        id: `id-${payload.slug}`,
        slug: payload.slug,
        name: payload.name,
      });
      state = [...state, created];
      return created;
    },
    update: async (slug, payload) => {
      const updated = makeTenant({
        ...(state.find((tenant) => tenant.slug === slug) ?? {}),
        slug,
        name: payload.name,
      });
      state = state.map((tenant) => (tenant.slug === slug ? updated : tenant));
      return updated;
    },
    delete: async (slug) => {
      state = state.filter((tenant) => tenant.slug !== slug);
    },
    listState: () => [...state],
  };
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
    useAdsStore.getState().reset();
    useTenantStore.getState().reset();
    resetAuthSession();
    setTenantService(null);
    seedAuthenticatedSession();
  });

  it('renderiza el nombre de la aplicación y el tenant de arranque desde la configuración', () => {
    render(<App config={createTestConfig()} />);

    expect(screen.getByText('OmniBotIA Studio')).toBeInTheDocument();
    // Sin servicio registrado (p. ej. en pruebas) el selector degrada al tenant
    // de configuración y no rompe la UI.
    expect(screen.getByText('test-tenant')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
  });

  it('muestra el estado vacío del canvas cuando no hay bloques', () => {
    render(<App config={createTestConfig()} />);

    expect(
      screen.getByText('Selecciona un bloque de la librería para comenzar.'),
    ).toBeInTheDocument();
  });

  it('agrega un bloque desde la librería y lo muestra en el canvas', async () => {
    const user = userEvent.setup();
    render(<App config={createTestConfig()} />);

    // `act` explícito: el clic actualiza el store de Zustand y los suscriptores
    // (Canvas/CodeEditor) re-renderizan en un microtask posterior al act de
    // user-event, lo que dispararía "not wrapped in act(...)".
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Hero con Video/ }));
    });

    expect(screen.getByText('¡Impulsa tu negocio!')).toBeInTheDocument();
    expect(screen.getByText('Comprar ahora')).toBeInTheDocument();
  });

  it('oculta el acceso a «Operación del bot» cuando la feature está deshabilitada', () => {
    render(<App config={createTestConfig()} />);

    expect(screen.queryByRole('button', { name: 'Operación del bot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Operación del bot' })).toBeNull();
  });

  it('muestra el acceso a «Operación del bot» cuando la feature está habilitada', () => {
    render(
      <App
        config={createTestConfig({
          features: { ...createTestConfig().features, operations: true },
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Operación del bot' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('alterna entre el editor y el área de operación del bot', async () => {
    const user = userEvent.setup();
    render(
      <App
        config={createTestConfig({
          features: { ...createTestConfig().features, operations: true },
        })}
      />,
    );

    // `act` explícito: el clic actualiza el estado local de la vista y la
    // transición editor ↔ operación re-renderiza suscripciones en un microtask.
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Operación del bot' }));
    });

    expect(screen.getByRole('button', { name: 'Operación del bot' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('tablist', { name: 'Operación del bot' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');

    // La navegación es persistente: se vuelve al editor pulsando «Sitio», no un
    // botón genérico «Volver al editor».
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Sitio' }));
    });

    expect(screen.getByRole('button', { name: 'Operación del bot' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('tablist', { name: 'Operación del bot' })).toBeNull();
  });

  it('oculta el acceso a «Captación» cuando la feature está deshabilitada', () => {
    render(<App config={createTestConfig()} />);

    expect(screen.queryByRole('button', { name: 'Captación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Captación publicitaria' })).toBeNull();
  });

  it('muestra el acceso a «Captación» cuando la feature está habilitada', () => {
    render(
      <App
        config={createTestConfig({
          features: { ...createTestConfig().features, ads: true },
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Captación' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('alterna entre el editor y la sección de captación publicitaria', async () => {
    const user = userEvent.setup();
    render(
      <App
        config={createTestConfig({
          features: { ...createTestConfig().features, ads: true },
        })}
      />,
    );

    // `act` explícito: el clic actualiza el estado local de la vista y la
    // transición editor ↔ captación re-renderiza suscripciones en un microtask.
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Captación' }));
    });

    expect(screen.getByRole('button', { name: 'Captación' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Captación publicitaria' })).toBeInTheDocument();

    // La navegación es persistente: se vuelve al editor pulsando «Sitio», no un
    // botón genérico «Volver al editor».
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Sitio' }));
    });

    expect(screen.getByRole('button', { name: 'Captación' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('heading', { name: 'Captación publicitaria' })).toBeNull();
  });

  it('muestra el selector de tenant con los tenants disponibles y preselecciona el activo', async () => {
    setTenantService(
      createTenantServiceStub([
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
        {
          id: 't-2',
          slug: 'escobar',
          name: 'Escobar',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
      ]),
    );

    render(<App config={createTestConfig()} />);

    // Espera a que la carga asíncrona de tenants termine y el selector aparezca.
    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    expect(selector).toBeInTheDocument();
    // El tenant de arranque (config) se preselecciona.
    expect(selector).toHaveValue('test-tenant');
    expect(screen.getByRole('option', { name: 'Test Tenant' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dev Tenant' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Escobar' })).toBeInTheDocument();
  });

  it('cambia el tenant activo al seleccionar otra opción', async () => {
    const user = userEvent.setup();
    setTenantService(
      createTenantServiceStub([
        {
          id: 't-1',
          slug: 'dev-tenant',
          name: 'Dev Tenant',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
        {
          id: 't-2',
          slug: 'escobar',
          name: 'Escobar',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
      ]),
    );

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    await act(async () => {
      await user.selectOptions(selector, 'escobar');
    });

    expect(selector).toHaveValue('escobar');
    expect(useTenantStore.getState().activeTenantId).toBe('escobar');
  });

  it('al cambiar de tenant reinicia los stores del editor/portal (aislamiento entre tenants)', async () => {
    const user = userEvent.setup();
    setTenantService(
      createTenantServiceStub([
        {
          id: 't-1',
          slug: 'dev-tenant',
          name: 'Dev Tenant',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
        {
          id: 't-2',
          slug: 'escobar',
          name: 'Escobar',
          created_at: '',
          revision: 0,
          updated_at: '',
        },
      ]),
    );

    // Simula una landing del tenant anterior persistida en el store global del
    // editor (el canvas la mostraría si no se reiniciara al cambiar de tenant).
    useEditorStore.getState().setLanding({
      id: 'landing-dev',
      campaignId: 'camp-dev',
      title: 'Landing del tenant dev',
      workflowType: 'direct_checkout',
      blocks: [],
    });
    usePortalStore.getState().setLanding({
      id: 'portal-dev',
      campaignId: '',
      title: 'Portal del tenant dev',
      workflowType: 'direct_checkout',
      blocks: [],
    });

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    await act(async () => {
      await user.selectOptions(selector, 'escobar');
    });

    // El store del editor ya no conserva la landing del tenant anterior.
    expect(useEditorStore.getState().landing.title).not.toBe('Landing del tenant dev');
    expect(usePortalStore.getState().landing.title).not.toBe('Portal del tenant dev');
  });

  it('muestra el botón «Nuevo tenant» y abre el modal de creación', async () => {
    const user = userEvent.setup();
    setTenantService(
      createTenantServiceStub([makeTenant({ id: 't-1', slug: 'dev-tenant', name: 'Dev Tenant' })]),
    );

    render(<App config={createTestConfig()} />);

    await screen.findByRole('combobox', { name: 'Tenant activo' });
    // La gestión de tenants vive en su propia pestaña (control plane).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Tenants' }));
    });
    const createButton = screen.getByRole('button', { name: 'Nuevo tenant' });
    expect(createButton).toBeInTheDocument();

    await act(async () => {
      await user.click(createButton);
    });

    const dialog = screen.getByRole('dialog', { name: 'Nuevo tenant' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Slug')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nombre')).toBeInTheDocument();
  });

  it('crea un tenant, actualiza la lista y lo selecciona como activo', async () => {
    const user = userEvent.setup();
    const service = createCrudTenantServiceStub([
      makeTenant({ id: 't-1', slug: 'dev-tenant', name: 'Dev Tenant' }),
    ]);
    setTenantService(service);

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Tenants' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Nuevo tenant' }));
    });

    const dialog = screen.getByRole('dialog', { name: 'Nuevo tenant' });
    await act(async () => {
      await user.type(within(dialog).getByLabelText('Slug'), 'nuevo-tenant');
      await user.type(within(dialog).getByLabelText('Nombre'), 'Nuevo Tenant');
      await user.click(within(dialog).getByRole('button', { name: 'Crear tenant' }));
    });

    // El store recarga la lista y el nuevo tenant aparece como opción y activo.
    expect(service.listState().map((tenant) => tenant.slug)).toContain('nuevo-tenant');
    expect(useTenantStore.getState().activeTenantId).toBe('nuevo-tenant');
    expect(await screen.findByRole('option', { name: 'Nuevo Tenant' })).toBeInTheDocument();
    expect(selector).toHaveValue('nuevo-tenant');
  });

  it('edita (renombra) el tenant seleccionado y refleja el nuevo nombre', async () => {
    const user = userEvent.setup();
    const service = createCrudTenantServiceStub([
      makeTenant({ id: 't-1', slug: 'dev-tenant', name: 'Dev Tenant' }),
      makeTenant({ id: 't-2', slug: 'escobar', name: 'Escobar' }),
    ]);
    setTenantService(service);

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    // Selecciona el tenant a renombrar.
    await act(async () => {
      await user.selectOptions(selector, 'escobar');
    });

    // La gestión de tenants vive en su propia pestaña (control plane).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Tenants' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Renombrar' }));
    });

    const dialog = screen.getByRole('dialog', { name: 'Renombrar tenant' });
    const nameInput = within(dialog).getByLabelText('Nombre');
    await act(async () => {
      await user.clear(nameInput);
      await user.type(nameInput, 'Escobar Renovado');
      await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.listState().find((tenant) => tenant.slug === 'escobar')?.name).toBe(
      'Escobar Renovado',
    );
    // El slug es inmutable y el tenant sigue activo con el nuevo nombre.
    expect(useTenantStore.getState().activeTenantId).toBe('escobar');
    expect(await screen.findByRole('option', { name: 'Escobar Renovado' })).toBeInTheDocument();
  });

  it('elimina el tenant seleccionado tras confirmar y lo quita de la lista', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const service = createCrudTenantServiceStub([
      makeTenant({ id: 't-1', slug: 'dev-tenant', name: 'Dev Tenant' }),
      makeTenant({ id: 't-2', slug: 'escobar', name: 'Escobar' }),
    ]);
    setTenantService(service);

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    await act(async () => {
      await user.selectOptions(selector, 'escobar');
    });

    // La gestión de tenants vive en su propia pestaña (control plane).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Tenants' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(service.listState().map((tenant) => tenant.slug)).not.toContain('escobar');
    expect(screen.queryByRole('option', { name: 'Escobar' })).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('al eliminar el tenant activo cambia al primer tenant restante', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const service = createCrudTenantServiceStub([
      makeTenant({ id: 't-1', slug: 'dev-tenant', name: 'Dev Tenant' }),
      makeTenant({ id: 't-2', slug: 'escobar', name: 'Escobar' }),
    ]);
    setTenantService(service);

    render(<App config={createTestConfig()} />);

    const selector = await screen.findByRole('combobox', { name: 'Tenant activo' });
    // El tenant de arranque (config) es el activo por defecto: dev-tenant.
    expect(selector).toHaveValue('dev-tenant');

    // La gestión de tenants vive en su propia pestaña (control plane).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Tenants' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    // El store degrada al primer tenant restante (escobar) tras el reload.
    expect(useTenantStore.getState().activeTenantId).toBe('escobar');
    expect(await screen.findByRole('option', { name: 'Escobar' })).toBeInTheDocument();
    expect(selector).toHaveValue('escobar');
    confirmSpy.mockRestore();
  });
});
