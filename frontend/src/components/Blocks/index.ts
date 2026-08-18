/**
 * Punto de entrada de los componentes de bloques.
 */
export { BlockRenderer } from '@/components/Blocks/BlockRenderer';
export { HeroBlock } from '@/components/Blocks/HeroBlock';
export { ServicesGridBlock } from '@/components/Blocks/ServicesGridBlock';
export { CalculatorBlock } from '@/components/Blocks/CalculatorBlock';
export { FallbackBlock } from '@/components/Blocks/FallbackBlock';
export {
  BLOCK_RENDERERS,
  getBlockRenderer,
  type IBlockRendererProps,
} from '@/components/Blocks/blockRendererRegistry';
