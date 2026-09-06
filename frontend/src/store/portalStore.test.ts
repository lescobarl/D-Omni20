/**
 * Pruebas del store del configurador del Portal del Cliente (modo portal).
 *
 * Contrato:
 * - Es un superset de `IEditorState`: expone `landing` con `title` y `blocks`
 *   como array para reutilizar el configurador único vía `EditorStoreContext`.
 * - Añade campos propios del portal: `slug`, `pageId` y `published`.
 * - `serializePortalConfig`/`deserializePortalConfig` convierten entre el
 *   formato de array del editor y el formato `dict` del backend.
 * - Registro de servicios por DI: `setPortalService`/`getPortalService`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import type { IPortalService } from '@/services/portalService';
import {
  createDefaultPortal,
  deserializePortalConfig,
  getPortalService,
  serializePortalConfig,
  setPortalService,
  usePortalStore,
} from '@/store/portalStore';
import type { ILandingConfig } from '@/types/editor';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeLanding(overrides: Partial<ILandingConfig> = {}): ILandingConfig {
  return {
    id: 'landing-1',
    campaignId: 'campaign-1',
    title: 'Portal de Mi Empresa',
    workflowType: 'direct_checkout',
    blocks: [
      {
        instance_id: 'block-1',
        block_id: 'hero',
        type: 'hero',
        name: 'Hero',
        config: { title: 'Bienvenido' },
      },
    ],
    ...overrides,
  };
}

describe('portalStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortalStore.getState().reset();
  });

  it('parte del estado inicial por defecto', () => {
    const state = usePortalStore.getState();
    expect(state.slug).toBe('');
    expect(state.pageId).toBeNull();
    expect(state.published).toBe(false);
    expect(state.landing.title).toBe('Nuevo Portal');
    expect(state.landing.blocks).toHaveLength(0);
  });

  it('actualiza slug, pageId y published', () => {
    usePortalStore.getState().setSlug('mi-empresa');
    usePortalStore.getState().setPageId('page-1');
    usePortalStore.getState().setPublished(true);

    const state = usePortalStore.getState();
    expect(state.slug).toBe('mi-empresa');
    expect(state.pageId).toBe('page-1');
    expect(state.published).toBe(true);
  });

  it('agrega bloques al landing del portal generando UUIDv4', () => {
    usePortalStore.getState().addBlock(BLOCK_CATALOG[0]);

    const blocks = usePortalStore.getState().landing.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].instance_id).toMatch(UUID_V4_PATTERN);
    expect(blocks[0].type).toBe('hero');
  });

  it('serializa la configuración al formato dict del backend', () => {
    const serialized = serializePortalConfig(makeLanding());

    expect(serialized.title).toBe('Portal de Mi Empresa');
    expect(Array.isArray(serialized.blocks)).toBe(true);
    const block = (serialized.blocks as Array<Record<string, unknown>>)[0];
    expect(block.instance_id).toBe('block-1');
    expect(block.block_id).toBe('hero');
    expect(block.type).toBe('hero');
    expect(block.config).toEqual({ title: 'Bienvenido' });
  });

  it('deserializa la configuración desde el formato dict del backend', () => {
    const landing = deserializePortalConfig({
      title: 'Portal Restaurado',
      blocks: [
        {
          instance_id: 'b1',
          block_id: 'hero',
          type: 'hero',
          name: 'Hero',
          config: { title: 'Hola' },
        },
      ],
    });

    expect(landing.title).toBe('Portal Restaurado');
    expect(landing.blocks).toHaveLength(1);
    expect(landing.blocks[0].instance_id).toBe('b1');
    expect(landing.blocks[0].type).toBe('hero');
    expect(landing.blocks[0].config).toEqual({ title: 'Hola' });
  });

  it('deserializa con valores por defecto ante entradas inválidas', () => {
    const landing = deserializePortalConfig({});

    expect(landing.title).toBe('Nuevo Portal');
    expect(landing.blocks).toHaveLength(0);
  });

  it('toBackendBlocks serializa el landing actual del store', () => {
    usePortalStore.getState().setLanding(makeLanding());

    const serialized = usePortalStore.getState().toBackendBlocks();
    expect(serialized.title).toBe('Portal de Mi Empresa');
    expect(serialized.blocks as Array<Record<string, unknown>>).toHaveLength(1);
  });

  it('applyBackendBlocks reemplaza la configuración desde el backend', () => {
    usePortalStore.getState().applyBackendBlocks({
      title: 'Portal del Backend',
      blocks: [{ instance_id: 'x1', block_id: 'hero', type: 'hero', name: 'Hero', config: {} }],
    });

    const state = usePortalStore.getState();
    expect(state.landing.title).toBe('Portal del Backend');
    expect(state.landing.blocks).toHaveLength(1);
    expect(state.selectedBlockId).toBeNull();
  });

  it('reset restaura el estado inicial completo', () => {
    usePortalStore.getState().setSlug('mi-empresa');
    usePortalStore.getState().setPageId('page-1');
    usePortalStore.getState().setPublished(true);
    usePortalStore.getState().setLanding(makeLanding());

    usePortalStore.getState().reset();

    const state = usePortalStore.getState();
    expect(state.slug).toBe('');
    expect(state.pageId).toBeNull();
    expect(state.published).toBe(false);
    expect(state.landing.title).toBe('Nuevo Portal');
    expect(state.landing.blocks).toHaveLength(0);
  });

  it('createDefaultPortal devuelve una configuración funcional', () => {
    const portal = createDefaultPortal();
    expect(portal.title).toBe('Nuevo Portal');
    expect(portal.blocks).toHaveLength(0);
    expect(portal.id).toMatch(UUID_V4_PATTERN);
  });
});

describe('portalStore DI', () => {
  beforeEach(() => {
    setPortalService(null);
  });

  it('getPortalService devuelve null sin servicio registrado', () => {
    expect(getPortalService()).toBeNull();
  });

  it('setPortalService registra y getPortalService devuelve la implementación', () => {
    const service = {} as IPortalService;
    setPortalService(service);
    expect(getPortalService()).toBe(service);
  });

  it('setPortalService(null) desregistra el servicio', () => {
    setPortalService({} as IPortalService);
    setPortalService(null);
    expect(getPortalService()).toBeNull();
  });
});
