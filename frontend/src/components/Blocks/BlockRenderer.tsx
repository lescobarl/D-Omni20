/**
 * Renderizador de bloques según su tipo.
 *
 * Contrato:
 * - Delega en el registro de renderizadores (`blockRendererRegistry`).
 * - Es presentacional puro: no accede al store global.
 */
import type { ReactElement } from 'react';
import {
  getBlockRenderer,
  type IBlockRendererProps,
} from '@/components/Blocks/blockRendererRegistry';

/**
 * Renderiza una instancia de bloque mediante su renderizador registrado.
 *
 * @example
 * ```tsx
 * <BlockRenderer block={instance} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La representación visual del bloque según su tipo.
 */
export function BlockRenderer({ block }: IBlockRendererProps): ReactElement {
  const Renderer = getBlockRenderer(block.type);
  return <Renderer block={block} />;
}
