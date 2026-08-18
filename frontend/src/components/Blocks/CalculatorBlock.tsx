/**
 * Renderizador presentacional del bloque `calculator`.
 *
 * Contrato:
 * - Recibe una instancia de bloque y muestra la tasa y moneda configuradas.
 * - Es presentacional puro: no accede al store global ni ejecuta efectos.
 */
import type { ReactElement } from 'react';
import type { IBlockInstance } from '@/types/editor';

interface ICalculatorBlockProps {
  /** Instancia de bloque de tipo `calculator` a renderizar. */
  block: IBlockInstance;
}

/**
 * Renderiza la calculadora de conversión JS de una landing.
 *
 * @example
 * ```tsx
 * <CalculatorBlock block={calculatorInstance} />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La calculadora con tasa impositiva y moneda configuradas.
 */
export function CalculatorBlock({ block }: ICalculatorBlockProps): ReactElement {
  return (
    <div className="rounded bg-white p-4">
      <h3 className="text-sm font-medium text-slate-700">{block.name}</h3>
      <p className="mt-1 text-xs text-slate-400">
        Impuesto: {String(block.config.tax_rate ?? '')} · Moneda:{' '}
        {String(block.config.currency ?? '')}
      </p>
    </div>
  );
}
