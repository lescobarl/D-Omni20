/**
 * Pruebas del configurador del Portal del Cliente (modo portal).
 *
 * Contrato:
 * - Reutiliza `EditorLayout` (configurador único landing/portal) — se mockea en
 *   estas pruebas para aislar la barra de herramientas del portal.
 * - Guarda la página: crea cuando `pageId` es nulo y actualiza cuando existe.
 * - (Des)publica la página delegando en `IPortalService.publish`.
 * - Maneja errores de forma accesible cuando el servicio no está disponible.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalEditor } from '@/components/Portal/PortalEditor';
import { setPortalService, usePortalStore } from '@/store/portalStore';
import type { IPortalPageRead, IPortalPageUpdate } from '@/api/types';
import type { IPortalService } from '@/services/portalService';
import { createTestConfig } from '@/test/config';

vi.mock('@/components/Editor/EditorLayout', () => ({
  EditorLayout: () => <div data-testid="editor-layout" />,
}));

function makePage(overrides: Partial<IPortalPageRead> = {}): IPortalPageRead {
  return {
    id: 'page-1',
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

function makeService(overrides: Partial<IPortalService> = {}): IPortalService {
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

describe('PortalEditor', () => {
  const config = createTestConfig();

  beforeEach(() => {
    localStorage.clear();
    usePortalStore.getState().reset();
    setPortalService(null);
  });

  afterEach(() => {
    act(() => {
      usePortalStore.getState().reset();
    });
    setPortalService(null);
  });

  it('renderiza la barra de herramientas del portal y el layout del editor', () => {
    render(<PortalEditor config={config} />);

    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeInTheDocument();
    expect(screen.getByTestId('editor-layout')).toBeInTheDocument();
  });

  it('muestra error cuando no hay servicio registrado al guardar', async () => {
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.type(screen.getByLabelText('Slug'), 'mi-empresa');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'El servicio del portal no está disponible.',
      );
    });
  });

  it('muestra error cuando el slug está vacío al guardar', async () => {
    const service = makeService();
    setPortalService(service);
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Introduce un slug para la página del portal.',
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('crea la página del portal cuando pageId es nulo', async () => {
    const service = makeService({
      create: vi.fn().mockResolvedValue(makePage({ id: 'page-1', published: false })),
    });
    setPortalService(service);
    usePortalStore.getState().setLandingTitle('Portal de Mi Empresa');
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.type(screen.getByLabelText('Slug'), 'mi-empresa');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => {
      expect(service.create).toHaveBeenCalledTimes(1);
    });
    const payload = (service.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.slug).toBe('mi-empresa');
    expect(payload.title).toBe('Portal de Mi Empresa');
    await waitFor(() => {
      expect(usePortalStore.getState().pageId).toBe('page-1');
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Página del portal creada.');
    });
  });

  it('actualiza la página del portal cuando pageId ya existe', async () => {
    const service = makeService({
      update: vi.fn().mockResolvedValue(makePage({ id: 'page-1', published: false })),
    });
    setPortalService(service);
    usePortalStore.getState().setPageId('page-1');
    usePortalStore.getState().setSlug('mi-empresa');
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => {
      expect(service.update).toHaveBeenCalledTimes(1);
    });
    expect(service.create).not.toHaveBeenCalled();
    const [pageId, payload] = (service.update as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      IPortalPageUpdate,
    ];
    expect(pageId).toBe('page-1');
    expect(payload.slug).toBe('mi-empresa');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Página del portal guardada.');
    });
  });

  it('propaga el error del servicio al guardar', async () => {
    const service = makeService({
      create: vi.fn().mockRejectedValue(new Error('fallo de red')),
    });
    setPortalService(service);
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.type(screen.getByLabelText('Slug'), 'mi-empresa');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('fallo de red');
    });
  });

  it('pide guardar antes de publicar cuando pageId es nulo', async () => {
    const service = makeService();
    setPortalService(service);
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Publicar' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Guarda la página antes de publicarla.',
    );
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('publica la página del portal delegando en publish', async () => {
    const service = makeService({
      publish: vi.fn().mockResolvedValue(makePage({ id: 'page-1', published: true })),
    });
    setPortalService(service);
    usePortalStore.getState().setPageId('page-1');
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Publicar' }));
    });

    await waitFor(() => {
      expect(service.publish).toHaveBeenCalledWith('page-1', { published: true });
    });
    await waitFor(() => {
      expect(usePortalStore.getState().published).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Página del portal publicada.');
    });
  });

  it('despublica la página del portal cuando ya está publicada', async () => {
    const service = makeService({
      publish: vi.fn().mockResolvedValue(makePage({ id: 'page-1', published: false })),
    });
    setPortalService(service);
    usePortalStore.getState().setPageId('page-1');
    usePortalStore.getState().setPublished(true);
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Despublicar' }));
    });

    await waitFor(() => {
      expect(service.publish).toHaveBeenCalledWith('page-1', { published: false });
    });
    await waitFor(() => {
      expect(usePortalStore.getState().published).toBe(false);
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Página del portal despublicada.');
    });
  });

  it('carga contenido DISTINTO al seleccionar dos páginas diferentes', async () => {
    const pageUno = makePage({
      id: 'page-1',
      slug: 'inicio',
      title: 'Página Uno',
      blocks: {
        title: 'Página Uno',
        blocks: [
          {
            instance_id: 'a1',
            block_id: 'hero',
            type: 'hero',
            name: 'Hero Uno',
            config: { heading: 'Contenido Uno' },
          },
        ],
      },
    });
    const pageDos = makePage({
      id: 'page-2',
      slug: 'servicios',
      title: 'Página Dos',
      blocks: {
        title: 'Página Dos',
        blocks: [
          {
            instance_id: 'b1',
            block_id: 'services_grid',
            type: 'services_grid',
            name: 'Servicios Dos',
            config: { heading: 'Contenido Dos' },
          },
        ],
      },
    });
    const service = makeService({
      list: vi.fn().mockResolvedValue({
        items: [pageUno, pageDos],
        total: 2,
        page: 1,
        page_size: 100,
      }),
      get: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'page-1' ? pageUno : pageDos),
      ),
    });
    setPortalService(service);
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    // Espera a que se carguen las dos páginas en el selector.
    await waitFor(() => {
      expect(screen.getByLabelText('Página')).toHaveDisplayValue('— Selecciona una página —');
    });
    await waitFor(() => {
      expect(service.list).toHaveBeenCalledTimes(1);
    });

    // Selecciona la primera página y verifica su contenido en el store.
    await act(async () => {
      await user.selectOptions(screen.getByLabelText('Página'), 'page-1');
    });
    await waitFor(() => {
      expect(usePortalStore.getState().pageId).toBe('page-1');
    });
    expect(usePortalStore.getState().landing.title).toBe('Página Uno');
    expect(usePortalStore.getState().landing.blocks).toHaveLength(1);
    expect(usePortalStore.getState().landing.blocks[0].name).toBe('Hero Uno');

    // Selecciona la segunda página y verifica que su contenido es DISTINTO.
    await act(async () => {
      await user.selectOptions(screen.getByLabelText('Página'), 'page-2');
    });
    await waitFor(() => {
      expect(usePortalStore.getState().pageId).toBe('page-2');
    });
    expect(usePortalStore.getState().landing.title).toBe('Página Dos');
    expect(usePortalStore.getState().landing.blocks).toHaveLength(1);
    expect(usePortalStore.getState().landing.blocks[0].name).toBe('Servicios Dos');
    expect(usePortalStore.getState().landing.blocks[0].name).not.toBe('Hero Uno');
  });

  it('añade la página recién creada a la lista del selector', async () => {
    const created = makePage({
      id: 'page-nueva',
      slug: 'contacto',
      title: 'Página de Contacto',
      published: false,
    });
    const service = makeService({
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 }),
      create: vi.fn().mockResolvedValue(created),
    });
    setPortalService(service);
    const user = userEvent.setup();
    render(<PortalEditor config={config} />);

    // Estado vacío: no hay páginas todavía.
    await waitFor(() => {
      expect(screen.getByText('Aún no hay páginas en el portal')).toBeInTheDocument();
    });

    // Crea la primera página desde el estado vacío (handleNew reinicia el título).
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear primera página' }));
    });
    await act(async () => {
      await user.clear(screen.getByLabelText('Título'));
      await user.type(screen.getByLabelText('Título'), 'Página de Contacto');
      await user.type(screen.getByLabelText('Slug'), 'contacto');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => {
      expect(service.create).toHaveBeenCalledTimes(1);
    });
    const payload = (service.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.slug).toBe('contacto');
    expect(payload.title).toBe('Página de Contacto');

    // La página creada aparece como opción del selector y queda seleccionada.
    await waitFor(() => {
      expect(screen.getByLabelText('Página')).toHaveDisplayValue('Página de Contacto');
    });
    const select = screen.getByLabelText('Página') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((option) => option.value);
    expect(optionValues).toContain('page-nueva');
    expect(usePortalStore.getState().pageId).toBe('page-nueva');
  });
});
