/**
 * Renderizador presentacional del bloque `hero`.
 *
 * Contrato:
 * - Recibe una instancia de bloque y muestra titular, subtítulo y CTA.
 * - Es presentacional puro: no accede al store global ni ejecuta efectos.
 */
import type { ReactElement } from 'react';
import type { IBlockInstance } from '@/types/editor';

interface IHeroBlockProps {
  /** Instancia de bloque de tipo `hero` a renderizar. */
  block: IBlockInstance;
}

/**
 * Renderiza la sección de apertura (hero) de una landing.
 *
 * @example
 * ```tsx
 * <HeroBlock block={heroInstance} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La sección hero con titular, subtítulo y botón de CTA.
 */
export function HeroBlock({ block }: IHeroBlockProps): ReactElement {
  return (
    <div className="rounded bg-gradient-to-r from-brand-50 to-accent-50 p-4">
      <h3 className="text-lg font-semibold text-slate-900">{String(block.config.title ?? '')}</h3>
      <p className="mt-1 text-sm text-slate-600">{String(block.config.subtitle ?? '')}</p>
      <button
        type="button"
        className="mt-3 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white"
      >
        {String(block.config.cta_text ?? '')}
      </button>
    </div>
  );
}
