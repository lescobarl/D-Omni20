/**
 * Pruebas del store global del editor con tests de inmutabilidad.
 *
 * Contrato:
 * - Las acciones actualizan el estado sin mutar referencias previas.
 * - Los bloques insertados usan UUIDv4.
 * - La arquitectura permanece agnóstica al negocio tras los cambios.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/store/editorStore';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import type { ILandingConfig } from '@/types/editor';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('editorStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
  });

  it('agrega un bloque generando UUIDv4', () => {
    useEditorStore.getState().addBlock(BLOCK_CATALOG[0]);

    const blocks = useEditorStore.getState().landing.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].instance_id).toMatch(UUID_V4_PATTERN);
    expect(blocks[0].type).toBe('hero');
  });

  it('elimina un bloque sin mutar el estado previo (inmutabilidad)', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.addBlock(BLOCK_CATALOG[1]);

    const previousBlocks = useEditorStore.getState().landing.blocks;
    const previousSnapshot = previousBlocks.map((block) => ({ ...block }));
    const removedId = previousBlocks[0].instance_id;

    useEditorStore.getState().removeBlock(removedId);

    const currentBlocks = useEditorStore.getState().landing.blocks;
    expect(currentBlocks).toHaveLength(1);
    expect(previousBlocks).toHaveLength(2);
    expect(previousBlocks[0]).toEqual(previousSnapshot[0]);
    expect(currentBlocks[0].instance_id).not.toBe(removedId);
  });

  it('mueve un bloque hacia arriba y hacia abajo', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.addBlock(BLOCK_CATALOG[1]);
    store.addBlock(BLOCK_CATALOG[2]);
    const ids = useEditorStore.getState().landing.blocks.map((block) => block.instance_id);

    useEditorStore.getState().moveBlock(ids[2], 'up');
    expect(useEditorStore.getState().landing.blocks[1].instance_id).toBe(ids[2]);

    useEditorStore.getState().moveBlock(ids[2], 'down');
    expect(useEditorStore.getState().landing.blocks[2].instance_id).toBe(ids[2]);
  });

  it('no modifica el estado en movimientos sin efecto', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.addBlock(BLOCK_CATALOG[1]);
    const ids = useEditorStore.getState().landing.blocks.map((block) => block.instance_id);
    const before = useEditorStore.getState().landing.blocks;

    useEditorStore.getState().moveBlock(ids[0], 'up');
    useEditorStore.getState().moveBlock(ids[1], 'down');
    useEditorStore.getState().moveBlock('inexistente', 'up');

    expect(useEditorStore.getState().landing.blocks).toBe(before);
  });

  it('actualiza la configuración de un bloque de forma inmutable', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);

    const previous = useEditorStore.getState().landing.blocks[0];
    const previousConfig = previous.config;

    useEditorStore.getState().updateBlockConfig(previous.instance_id, { title: 'Nuevo titular' });

    const updated = useEditorStore.getState().landing.blocks[0];
    expect(updated.config.title).toBe('Nuevo titular');
    expect(updated.config).not.toBe(previousConfig);
    expect(previousConfig.title).toBe('¡Impulsa tu negocio!');
    expect(updated.instance_id).toBe(previous.instance_id);
  });

  it('selecciona y deselecciona bloques', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    const id = useEditorStore.getState().landing.blocks[0].instance_id;

    useEditorStore.getState().selectBlock(id);
    expect(useEditorStore.getState().selectedBlockId).toBe(id);

    useEditorStore.getState().selectBlock(null);
    expect(useEditorStore.getState().selectedBlockId).toBeNull();
  });

  it('cambia el título y reinicia la landing al estado por defecto', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.setLandingTitle('Landing de Prueba');

    expect(useEditorStore.getState().landing.title).toBe('Landing de Prueba');

    useEditorStore.getState().reset();
    const state = useEditorStore.getState();
    expect(state.landing.title).toBe('Nueva Landing');
    expect(state.landing.blocks).toHaveLength(0);
    expect(state.selectedBlockId).toBeNull();
  });

  it('inserta un bloque en una posición concreta generando UUIDv4', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.addBlock(BLOCK_CATALOG[1]);
    const firstId = useEditorStore.getState().landing.blocks[0].instance_id;

    useEditorStore.getState().addBlockAt(BLOCK_CATALOG[2], 0);

    const blocks = useEditorStore.getState().landing.blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('calculator');
    expect(blocks[0].instance_id).toMatch(UUID_V4_PATTERN);
    expect(blocks[1].instance_id).toBe(firstId);
  });

  it('limita el índice fuera de rango al insertar con addBlockAt', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);

    useEditorStore.getState().addBlockAt(BLOCK_CATALOG[1], 99);
    useEditorStore.getState().addBlockAt(BLOCK_CATALOG[2], -5);

    const blocks = useEditorStore.getState().landing.blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[2].type).toBe('services_grid');
    expect(blocks[0].type).toBe('calculator');
  });

  it('reordena un bloque a la posición de otro (drag & drop)', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.addBlock(BLOCK_CATALOG[1]);
    store.addBlock(BLOCK_CATALOG[2]);
    const ids = useEditorStore.getState().landing.blocks.map((block) => block.instance_id);

    useEditorStore.getState().reorderBlock(ids[0], ids[2]);

    const blocks = useEditorStore.getState().landing.blocks;
    expect(blocks.map((block) => block.instance_id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('no modifica el estado al reordenar sobre sí mismo o con ids inexistentes', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    store.addBlock(BLOCK_CATALOG[1]);
    const ids = useEditorStore.getState().landing.blocks.map((block) => block.instance_id);
    const before = useEditorStore.getState().landing.blocks;

    useEditorStore.getState().reorderBlock(ids[0], ids[0]);
    useEditorStore.getState().reorderBlock('inexistente', ids[0]);
    useEditorStore.getState().reorderBlock(ids[0], 'inexistente');

    expect(useEditorStore.getState().landing.blocks).toBe(before);
    expect(useEditorStore.getState().landing.blocks.map((block) => block.instance_id)).toEqual(ids);
  });

  it('reemplaza la landing completa con setLanding y limpia la selección', () => {
    const store = useEditorStore.getState();
    store.addBlock(BLOCK_CATALOG[0]);
    const id = useEditorStore.getState().landing.blocks[0].instance_id;
    store.selectBlock(id);

    const nextLanding: ILandingConfig = {
      campaignId: 'camp-ia',
      title: 'Landing generada por IA',
      workflowType: 'lead_capture',
      blocks: [],
    };
    useEditorStore.getState().setLanding(nextLanding);

    const state = useEditorStore.getState();
    expect(state.landing).toEqual(nextLanding);
    expect(state.landing.title).toBe('Landing generada por IA');
    expect(state.landing.workflowType).toBe('lead_capture');
    expect(state.landing.blocks).toHaveLength(0);
    expect(state.selectedBlockId).toBeNull();
  });
});
