/**
 * Registro de renderizadores de bloques por tipo.
 *
 * Contrato:
 * - `BLOCK_RENDERERS` asocia cada `BlockType` con su componente presentacional.
 * - `getBlockRenderer` resuelve el renderizador y cae a `FallbackBlock` si el
 *   tipo aún no tiene implementación dedicada.
 * - Se usa `Partial` para que los tipos sin renderizado dedicado se resuelvan
 *   al respaldo sin romper la compilación.
 */
import type { ComponentType } from 'react';
import type { BlockType, IBlockInstance } from '@/types/editor';
import { CalculatorBlock } from '@/components/Blocks/CalculatorBlock';
import { FallbackBlock } from '@/components/Blocks/FallbackBlock';
import { HeroBlock } from '@/components/Blocks/HeroBlock';
import { PortalBlock } from '@/components/Blocks/PortalBlock';
import { ServicesGridBlock } from '@/components/Blocks/ServicesGridBlock';

/** Propiedades compartidas por todos los renderizadores de bloques. */
export interface IBlockRendererProps {
  /** Instancia de bloque a renderizar. */
  block: IBlockInstance;
}

/** Tipo de componente presentacional de un bloque. */
export type BlockRendererComponent = ComponentType<IBlockRendererProps>;

/** Mapa de renderizadores dedicados por tipo de bloque. */
export const BLOCK_RENDERERS: Readonly<Partial<Record<BlockType, BlockRendererComponent>>> = {
  hero: HeroBlock,
  services_grid: ServicesGridBlock,
  calculator: CalculatorBlock,
  portal: PortalBlock,
};

/**
 * Resuelve el renderizador dedicado de un tipo de bloque.
 *
 * @example
 * ```ts
 * const Renderer = getBlockRenderer('testimonials'); // FallbackBlock
 * ```
 *
 * @param type - Tipo de bloque a resolver.
 * @returns El componente renderizador o `FallbackBlock` si no hay dedicado.
 */
export function getBlockRenderer(type: BlockType): BlockRendererComponent {
  return BLOCK_RENDERERS[type] ?? FallbackBlock;
}
