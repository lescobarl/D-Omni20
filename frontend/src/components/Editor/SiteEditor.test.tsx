/**
 * Pruebas del configurador unificado del sitio (landing + páginas del portal).
 *
 * Contrato de navegación validado:
 * - Presenta UNA sola pantalla con un selector unificado que lista la landing
 *   («Inicio») y todas las páginas del portal juntas, sin cambiar de pantalla.
 * - Al seleccionar una página del portal se abre el configurador de portal con
 *   esa página precargada (`initialSelectedId`) y SIN su selector interno
 *   (`hideSelector`): el selector unificado es la única fuente de navegación.
 * - Al seleccionar la landing («Inicio») se abre el configurador de landings.
 * - El usuario nunca se pierde: siempre hay una selección activa visible y el
 *   selector unificado permanece presente en todas las vistas.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteEditor } from '@/components/Editor/SiteEditor';
import { setLandingService, useEditorStore } from '@/store/editorStore';
import { setPortalService, usePortalStore } from '@/store/portalStore';
import { makeLanding, makeLandingService } from '@/test/adsMocks';
import type { IPortalPageRead } from '@/api/types';
import type { IPortalService } from '@/services/portalService';
import { createTestConfig } from '@/test/config';

// Aísla el layout tri-panel: estas pruebas validan la barra de navegación
// unificada y la delegación de modo, no el canvas interno.
vi.mock('@/components/Editor/EditorLayout', () => ({
  EditorLayout: () => <div data-testid="editor-layout" />,
}));

function makePortalPage(overrides: Partial<IPortalPageRead> = {}): IPortalPageRead {
  return {
    id: 'portal-page-1',
    tenant_id: 'tenant-1',
    slug: 'mi-empresa',
    title: 'Portal de Mi Empresa',
    blocks: { title: 'Portal de Mi Empresa', blocks: [] },
    compiled_html: null,
    published: false,
    published_at: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

function makePortalService(overrides: Partial<IPortalService> = {}): IPortalService {
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    publish: vi.fn(),
    generate: vi.fn(),
    ...overrides,
  };
}

describe('SiteEditor (configurador unificado del sitio)', () => {
  const config = createTestConfig();

  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
    usePortalStore.getState().reset();
    setLandingService(null);
    setPortalService(null);
  });

  afterEach(() => {
    act(() => {
      useEditorStore.getState().reset();
      usePortalStore.getState().reset();
    });
    setLandingService(null);
    setPortalService(null);
  });

  it('muestra un selector unificado con la landing y las páginas del portal juntas', async () => {
    const landingService = makeLandingService({
      list: vi.fn().mockResolvedValue({
        items: [makeLanding({ id: 'landing-1', name: 'Landing de Venta' })],
        total: 1,
        page: 1,
        page_size: 100,
      }),
    });
    const portalService = makePortalService({
      list: vi.fn().mockResolvedValue({
        items: [makePortalPage({ id: 'portal-page-1', title: 'Portal de Mi Empresa' })],
        total: 1,
        page: 1,
        page_size: 100,
      }),
    });
    setLandingService(landingService);
    setPortalService(portalService);

    render(<SiteEditor config={config} />);

    const selector = await screen.findByLabelText('Página del sitio a editar');
    // Un solo selector unificado: no hay un segundo selector de páginas.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);

    // La landing «Inicio» siempre está presente.
    expect(within(selector).getByText('Inicio (Landing)')).toBeInTheDocument();
    // Las landings persistidas y las páginas del portal aparecen juntas.
    expect(within(selector).getByText('Landing de Venta')).toBeInTheDocument();
    expect(within(selector).getByText('Portal de Mi Empresa')).toBeInTheDocument();
  });

  it('abre el configurador de landings por defecto (selección «Inicio») sin selector interno duplicado', async () => {
    const landingService = makeLandingService();
    const portalService = makePortalService({
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 }),
    });
    setLandingService(landingService);
    setPortalService(portalService);

    render(<SiteEditor config={config} />);

    // La vista por defecto es la landing: su barra de herramientas usa «Nombre».
    expect(await screen.findByLabelText('Nombre')).toBeInTheDocument();
    // El selector unificado es el único combobox visible (la landing no muestra
    // su selector interno porque SiteEditor delega sin `hideSelector` en modo
    // landing, pero el modo landing no renderiza selector interno por defecto).
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByTestId('editor-layout')).toBeInTheDocument();
  });

  it('al elegir una página del portal precarga esa página y oculta el selector interno', async () => {
    const landingService = makeLandingService();
    const portalService = makePortalService({
      list: vi.fn().mockResolvedValue({
        items: [makePortalPage({ id: 'portal-page-1', title: 'Portal de Mi Empresa' })],
        total: 1,
        page: 1,
        page_size: 100,
      }),
      get: vi.fn().mockResolvedValue(
        makePortalPage({
          id: 'portal-page-1',
          title: 'Portal de Mi Empresa',
          slug: 'mi-empresa',
        }),
      ),
    });
    setLandingService(landingService);
    setPortalService(portalService);
    const user = userEvent.setup();

    render(<SiteEditor config={config} />);

    const selector = await screen.findByLabelText('Página del sitio a editar');
    await act(async () => {
      await user.selectOptions(selector, 'portal:portal-page-1');
    });

    // La página del portal se precarga: su barra de herramientas usa «Título» y
    // muestra el campo «Slug» (propio del modo portal).
    await waitFor(() => {
      expect(screen.getByLabelText('Título')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Slug')).toHaveValue('mi-empresa');
    // El selector interno del portal está oculto: solo queda el selector unificado.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    // La barra de identidad indica qué página se está editando (no se pierde uno).
    const identityBar = screen.getByText('Editando').parentElement;
    expect(identityBar).not.toBeNull();
    expect(
      within(identityBar as HTMLElement).getByText('Portal de Mi Empresa'),
    ).toBeInTheDocument();
    expect(within(identityBar as HTMLElement).getByText('/mi-empresa')).toBeInTheDocument();
    expect(portalService.get).toHaveBeenCalledWith('portal-page-1');
  });

  it('vuelve a la landing al elegir «Inicio» desde una página del portal sin cambiar de pantalla', async () => {
    const landingService = makeLandingService();
    const portalService = makePortalService({
      list: vi.fn().mockResolvedValue({
        items: [makePortalPage({ id: 'portal-page-1', title: 'Portal de Mi Empresa' })],
        total: 1,
        page: 1,
        page_size: 100,
      }),
      get: vi.fn().mockResolvedValue(
        makePortalPage({
          id: 'portal-page-1',
          title: 'Portal de Mi Empresa',
          slug: 'mi-empresa',
        }),
      ),
    });
    setLandingService(landingService);
    setPortalService(portalService);
    const user = userEvent.setup();

    render(<SiteEditor config={config} />);

    const selector = await screen.findByLabelText('Página del sitio a editar');
    await act(async () => {
      await user.selectOptions(selector, 'portal:portal-page-1');
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Título')).toBeInTheDocument();
    });

    // Regresa a la landing «Inicio» desde la misma pantalla.
    await act(async () => {
      await user.selectOptions(selector, 'landing:__home__');
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    });
    // Sigue habiendo un único selector unificado (no se duplican pantallas).
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByTestId('editor-layout')).toBeInTheDocument();
  });

  it('muestra «Portal no disponible» cuando el servicio del portal no está registrado', async () => {
    const landingService = makeLandingService();
    setLandingService(landingService);
    // No se registra el servicio del portal.

    render(<SiteEditor config={config} />);

    const selector = await screen.findByLabelText('Página del sitio a editar');
    expect(within(selector).getByText('Portal no disponible')).toBeInTheDocument();
    // La landing sigue siendo editable sin romper la UI.
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
  });

  it('muestra «Sin páginas todavía» cuando el portal está disponible pero vacío', async () => {
    const landingService = makeLandingService();
    const portalService = makePortalService({
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 }),
    });
    setLandingService(landingService);
    setPortalService(portalService);

    render(<SiteEditor config={config} />);

    const selector = await screen.findByLabelText('Página del sitio a editar');
    expect(within(selector).getByText('Sin páginas todavía')).toBeInTheDocument();
  });
});
