/**
 * Fábricas y consultas de bloques del dominio.
 *
 * Contrato:
 * - `createBlockInstance` genera una instancia funcional con `instance_id` UUIDv4.
 * - `getBlockDefinition` resuelve una definición del catálogo por tipo de bloque.
 */
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import type { IBlockDefinition, IBlockInstance, BlockType } from '@/types/editor';
import { uuidv4 } from '@/utils/uuid';

/**
 * Crea una instancia de bloque a partir de una definición del catálogo.
 * @param definition Definición de la que se deriva la instancia.
 * @returns Instancia funcional con UUIDv4 y configuración copiada (inmutable).
 */
export function createBlockInstance(definition: IBlockDefinition): IBlockInstance {
  return {
    instance_id: uuidv4(),
    block_id: definition.block_id,
    type: definition.type,
    name: definition.name,
    config: { ...definition.default_config },
  };
}

/**
 * Devuelve la definición del catálogo para un tipo de bloque.
 * @param type Tipo de bloque a resolver.
 * @returns La definición encontrada o `undefined` si no existe en el catálogo.
 */
export function getBlockDefinition(type: BlockType): IBlockDefinition | undefined {
  return BLOCK_CATALOG.find((definition) => definition.type === type);
}
