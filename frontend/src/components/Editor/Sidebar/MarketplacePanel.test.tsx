/**
 * Pruebas del panel del Marketplace de Templates.
 *
 * Contrato:
 * - Carga el catálogo del tenant al montar (`fetchTemplates`).
 * - Muestra las tarjetas con nombre, categoría, descripción y descargas.
 * - Permite filtrar por categoría (filtro server-side vía backend).
 * - Importa un template a la campaña activa del editor (`landing.campaignId`).
 * - Sin campaña activa, deshabilita la importación y lo explica de forma accesible.
 * - Maneja el estado de carga y de error de forma accesible.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarketplacePanel } from '@/components/Editor/Sidebar/MarketplacePanel';
import { setMarketplaceService, useMarketplaceStore } from '@/store/marketplaceStore';
import { useEditorStore } from '@/store/editorStore';
import type { IMarketplaceImportResponse, IMarketplaceTemplateRead } from '@/api/types';
import type { IMarketplaceService } from '@/services/marketplaceService';

/** Construye un template del catálogo con valores por defecto. */
function makeTemplate(overrides: Partial<IMarketplaceTemplateRead> = {}): IMarketplaceTemplateRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'tenant-1',
    name: 'Landing de Ventas',
    description: 'Landing de conversión para ventas.',
    category: 'ventas',
    config: { title: 'Nueva Landing', workflowType: 'direct_checkout', blocks: [] },
    thumbnail_url: null,
    is_public: true,
    downloads: 12,
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye una respuesta de importación con valores por defecto. */
function makeImportResponse(
  overrides: Partial<IMarketplaceImportResponse> = {},
): IMarketplaceImportResponse {
  return {
    template: makeTemplate(),
    landing_id: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  };
}

/** Construye un servicio falso que registra llamadas y devuelve valores dados. */
function makeService(overrides: Partial<IMarketplaceService> = {}): IMarketplaceService {
  return {
    list: vi.fn<IMarketplaceService['list']>().mockResolvedValue([]),
    create: vi.fn<IMarketplaceService['create']>().mockResolvedValue(makeTemplate()),
    importTemplate: vi
      .fn<IMarketplaceService['importTemplate']>()
      .mockResolvedValue(makeImportResponse()),
    ...overrides,
  };
}

describe('MarketplacePanel', () => {
  beforeEach(() => {
    useMarketplaceStore.getState().reset();
    useEditorStore.getState().setLanding({
      campaignId: 'campaign-1',
      title: 'Nueva Landing',
      workflowType: 'direct_checkout',
      blocks: [],
    });
    setMarketplaceService(makeService());
  });

  afterEach(() => {
    // El reset corre con el componente aún montado (el cleanup de RTL se ejecuta
    // después, en orden LIFO). Se envuelve en `act` para que las actualizaciones
    // del store (status/importación tras los tests) no se filtren fuera de su
    // ámbito y disparen warnings de act().
    act(() => {
      useMarketplaceStore.getState().reset();
      useEditorStore.getState().reset();
    });
    setMarketplaceService(null);
  });

  it('carga el catálogo y muestra las tarjetas al montar', async () => {
    const template = makeTemplate();
    setMarketplaceService(
      makeService({
        list: vi.fn<IMarketplaceService['list']>().mockResolvedValue([template]),
      }),
    );
    render(<MarketplacePanel />);
    // Drena la carga asíncrona del catálogo (`fetchTemplates`) del mount.
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Marketplace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Landing de Ventas' })).toBeInTheDocument();
    const card = screen.getByRole('listitem');
    expect(within(card).getByText('ventas')).toBeInTheDocument();
    expect(screen.getByText('Landing de conversión para ventas.')).toBeInTheDocument();
    expect(screen.getByText('12 descargas')).toBeInTheDocument();
  });

  it('filtra el catálogo por categoría seleccionada', async () => {
    const list = vi
      .fn<IMarketplaceService['list']>()
      .mockResolvedValue([
        makeTemplate({ id: 't-1', category: 'ventas' }),
        makeTemplate({ id: 't-2', category: 'contacto' }),
      ]);
    setMarketplaceService(makeService({ list }));
    const user = userEvent.setup();
    render(<MarketplacePanel />);
    await act(async () => {});

    await act(async () => {
      await user.selectOptions(screen.getByLabelText('Categoría'), 'ventas');
    });
    await act(async () => {});

    expect(list).toHaveBeenLastCalledWith('ventas');
    expect(screen.getByRole('option', { name: 'ventas' })).toBeInTheDocument();
  });

  it('deshabilita la importación y lo explica sin campaña activa', async () => {
    useEditorStore.getState().reset();
    const template = makeTemplate();
    setMarketplaceService(
      makeService({
        list: vi.fn<IMarketplaceService['list']>().mockResolvedValue([template]),
      }),
    );
    render(<MarketplacePanel />);
    await act(async () => {});

    expect(
      screen.getByText('Selecciona una campaña para poder importar templates.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import from Marketplace' })).toBeDisabled();
  });

  it('importa un template a la campaña activa y muestra la confirmación', async () => {
    const template = makeTemplate();
    const importTemplate = vi
      .fn<IMarketplaceService['importTemplate']>()
      .mockResolvedValue(
        makeImportResponse({ template, landing_id: '55555555-5555-4555-8555-555555555555' }),
      );
    setMarketplaceService(
      makeService({
        list: vi.fn<IMarketplaceService['list']>().mockResolvedValue([template]),
        importTemplate,
      }),
    );
    const user = userEvent.setup();
    render(<MarketplacePanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Import from Marketplace' }));
    });
    await act(async () => {});

    expect(importTemplate).toHaveBeenCalledWith(template.id, 'campaign-1', undefined);
    expect(screen.getByText('Importado. Landing generada.')).toBeInTheDocument();
  });

  it('muestra el estado de carga mientras se carga el catálogo', async () => {
    let resolve!: (value: IMarketplaceTemplateRead[]) => void;
    setMarketplaceService(
      makeService({
        list: vi
          .fn<IMarketplaceService['list']>()
          .mockImplementation(
            () => new Promise<IMarketplaceTemplateRead[]>((res) => (resolve = res)),
          ),
      }),
    );
    render(<MarketplacePanel />);
    await act(async () => {});

    expect(screen.getByText('Cargando templates…')).toBeInTheDocument();

    await act(async () => {
      resolve([]);
    });
    await act(async () => {});

    expect(screen.getByText('No hay templates disponibles.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    setMarketplaceService(
      makeService({
        list: vi
          .fn<IMarketplaceService['list']>()
          .mockRejectedValue(new Error('Servicio no disponible')),
      }),
    );
    render(<MarketplacePanel />);
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
  });
});
