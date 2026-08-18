/**
 * Pruebas del renderizador funcional de bloques.
 *
 * Contrato:
 * - Renderiza cada tipo de bloque según su configuración.
 * - Cubre la rama por defecto para tipos pendientes de implementación.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '@/components/Blocks/BlockRenderer';
import { createBlockInstance } from '@/core/blocks';
import { BLOCK_CATALOG } from '@/core/blockCatalog';
import type { IBlockInstance } from '@/types/editor';

/** Crea una instancia de prueba a partir del índice del catálogo. */
function instanceAt(index: number): IBlockInstance {
  return createBlockInstance(BLOCK_CATALOG[index]);
}

describe('BlockRenderer', () => {
  it('renderiza un bloque hero con su configuración', () => {
    render(<BlockRenderer block={instanceAt(0)} />);

    expect(screen.getByText('¡Impulsa tu negocio!')).toBeInTheDocument();
    expect(
      screen.getByText('Convierte visitantes en clientes con una landing de alto rendimiento.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comprar ahora' })).toBeInTheDocument();
  });

  it('renderiza una cuadrícula de servicios', () => {
    render(<BlockRenderer block={instanceAt(1)} />);

    expect(screen.getByText('Cuadrícula de Servicios')).toBeInTheDocument();
    expect(screen.getByText(/Layout: grid_3col/)).toBeInTheDocument();
  });

  it('renderiza una calculadora JS', () => {
    render(<BlockRenderer block={instanceAt(2)} />);

    expect(screen.getByText('Calculadora JS')).toBeInTheDocument();
    expect(screen.getByText(/Impuesto: 0.16/)).toBeInTheDocument();
  });

  it('muestra el estado pendiente para tipos sin renderizado dedicado', () => {
    const instance: IBlockInstance = {
      instance_id: 'pending-id',
      block_id: 'testimonials',
      type: 'testimonials',
      name: 'Testimonios',
      config: {},
    };
    render(<BlockRenderer block={instance} />);

    expect(screen.getByText(/pendiente de renderizado/)).toBeInTheDocument();
  });
});
