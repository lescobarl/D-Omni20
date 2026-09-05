/**
 * Catálogo estático de bloques disponibles en el editor.
 *
 * Contrato:
 * - `BLOCK_CATALOG` expone la lista inmutable de definiciones funcionales.
 * - Los `default_config` usan convención `snake_case` (alineada con los schemas del template system).
 */
import type { IBlockDefinition } from '@/types/editor';

/** Catálogo de bloques disponibles en el editor. */
export const BLOCK_CATALOG: readonly IBlockDefinition[] = [
  {
    block_id: 'hero_video',
    type: 'hero',
    name: 'Hero con Video',
    description: 'Sección de apertura con titular, subtítulo y CTA sobre fondo de video.',
    version: '1.0.0',
    category: 'hero',
    default_config: {
      title: '¡Impulsa tu negocio!',
      subtitle: 'Convierte visitantes en clientes con una landing de alto rendimiento.',
      cta_text: 'Comprar ahora',
      background_type: 'video',
    },
  },
  {
    block_id: 'services_grid',
    type: 'services_grid',
    name: 'Cuadrícula de Servicios',
    description: 'Presenta servicios o productos en una cuadrícula seleccionable.',
    version: '1.0.0',
    category: 'services',
    default_config: {
      layout: 'grid_3col',
      selection_mode: 'multiple',
    },
  },
  {
    block_id: 'calculator_js',
    type: 'calculator',
    name: 'Calculadora JS',
    description: 'Calculadora de conversión ejecutada en el navegador (JS embebido).',
    version: '1.0.0',
    category: 'services',
    default_config: {
      tax_rate: 0.16,
      currency: 'MXN',
    },
  },
  {
    block_id: 'portal_autoservicio',
    type: 'portal',
    name: 'Portal del Cliente',
    description: 'Autoservicio del cliente: consulta pagos, cotizaciones, citas y ejercicio ARCO.',
    version: '1.0.0',
    category: 'portal',
    default_config: {
      title: 'Mi portal',
      subtitle: 'Consulta el estado de tus pagos, cotizaciones y citas.',
      button_text: 'Entrar a mi portal',
    },
  },
];
