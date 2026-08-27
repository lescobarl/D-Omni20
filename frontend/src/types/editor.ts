/**
 * Tipos del dominio del editor de OmniBotIA Studio.
 *
 * Contrato:
 * - Los datos de bloques usan convención `snake_case` (alineada con los JSON Schemas del template system).
 * - Toda instancia se identifica por `instance_id` (UUIDv4).
 */

/** Tipos de bloque soportados por el editor. */
export type BlockType =
  | 'hero'
  | 'services_grid'
  | 'calculator'
  | 'testimonials'
  | 'faq'
  | 'lead_form'
  | 'conversion_floating';

/** Categorías funcionales de los bloques. */
export type BlockCategory = 'hero' | 'services' | 'forms' | 'conversion';

/** Definición estática de un bloque disponible en el catálogo. */
export interface IBlockDefinition {
  /** Identificador único del tipo de bloque (snake_case). */
  block_id: string;
  /** Tipo canónico del bloque. */
  type: BlockType;
  /** Nombre visible en la librería. */
  name: string;
  /** Descripción funcional del bloque. */
  description: string;
  /** Versión semántica del bloque. */
  version: string;
  /** Categoría funcional a la que pertenece. */
  category: BlockCategory;
  /** Configuración por defecto del bloque. */
  default_config: Record<string, unknown>;
}

/** Instancia concreta de un bloque insertada en una landing. */
export interface IBlockInstance {
  /** Identificador único de la instancia (UUIDv4). */
  instance_id: string;
  /** Referencia a la definición del catálogo. */
  block_id: string;
  /** Tipo canónico del bloque. */
  type: BlockType;
  /** Nombre visible de la instancia. */
  name: string;
  /** Configuración concreta de la instancia. */
  config: Record<string, unknown>;
}

/**
 * Tipo de workflow de conversión de la landing.
 * Alineado con los 4 workflows definidos en `plans/omnibotia_studio_spec.md`.
 */
export type WorkflowType =
  'direct_checkout' | 'lead_capture' | 'quote_generator' | 'appointment_scheduler';

/** Configuración completa de una landing en edición. */
export interface ILandingConfig {
  /** Identificador opcional de la landing persistida (UUID; ausente en landings locales). */
  id?: string;
  /** Identificador de la campaña (snake_case). */
  campaignId: string;
  /** Título de la landing. */
  title: string;
  /** Tipo de workflow de conversión. */
  workflowType: WorkflowType;
  /** Bloques ordenados de la landing (inmutable). */
  blocks: readonly IBlockInstance[];
}

/** Contrato del store global del editor. */
export interface IEditorState {
  /** Landing en edición. */
  landing: ILandingConfig;
  /** Identificador del bloque seleccionado (o `null` si no hay selección). */
  selectedBlockId: string | null;
  /** Agrega un bloque a la landing desde su definición. */
  addBlock(definition: IBlockDefinition): void;
  /** Agrega un bloque a la landing en una posición concreta (drag & drop). */
  addBlockAt(definition: IBlockDefinition, index: number): void;
  /** Elimina un bloque por su identificador de instancia. */
  removeBlock(instanceId: string): void;
  /** Mueve un bloque hacia arriba o abajo en el orden de la landing. */
  moveBlock(instanceId: string, direction: 'up' | 'down'): void;
  /** Reordena un bloque a la posición de otro (drag & drop del canvas). */
  reorderBlock(activeInstanceId: string, overInstanceId: string): void;
  /** Selecciona un bloque (o deselecciona con `null`). */
  selectBlock(instanceId: string | null): void;
  /** Actualiza la configuración de un bloque de forma inmutable. */
  updateBlockConfig(instanceId: string, patch: Record<string, unknown>): void;
  /** Cambia el título de la landing. */
  setLandingTitle(title: string): void;
  /** Reemplaza la landing completa y limpia la selección (p. ej. al aplicar una generación IA). */
  setLanding(landing: ILandingConfig): void;
  /** Reinicia el editor al estado por defecto. */
  reset(): void;
}
