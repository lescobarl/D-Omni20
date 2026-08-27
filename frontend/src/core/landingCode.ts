/**
 * Generador de representación compilada de una landing.
 *
 * Contrato:
 * - `generateLandingCode` produce una representación HTML funcional de la landing con su workflow.
 * - `serializeLandingConfig` traduce la `ILandingConfig` del editor al contrato JSON que
 *   consume el motor de compilación del backend (`config.title` y `config.blocks[].type|config`).
 * - Es lógica pura: no depende del DOM y es testeable de forma aislada.
 */
import type { BlockType, IBlockInstance, ILandingConfig } from '@/types/editor';

/** Bloque serializado en el contrato JSON del motor de compilación del backend. */
export interface ISerializedBlock {
  /** Tipo canónico del bloque (p. ej. `hero`, `services_grid`). */
  type: BlockType;
  /** Nombre visible de la instancia. */
  name: string;
  /** Configuración concreta de la instancia (copia inmutable). */
  config: Record<string, unknown>;
}

/** Renderiza la configuración de una instancia como atributos de datos. */
function renderConfig(instance: IBlockInstance): string {
  return Object.entries(instance.config)
    .map(([key, value]) => `data-${key}="${String(value)}"`)
    .join(' ');
}

/**
 * Genera el HTML compilado de la landing con su workflow y bloques.
 * @param landing Configuración de la landing en edición.
 * @returns Representación HTML funcional de la landing.
 */
export function generateLandingCode(landing: ILandingConfig): string {
  const blocks = landing.blocks
    .map(
      (instance) =>
        `  <article class="block block--${instance.type}" data-instance-id="${instance.instance_id}" ${renderConfig(instance)}>\n    <h2>${instance.name}</h2>\n  </article>`,
    )
    .join('\n');

  return [
    `<!-- OmniBotIA Studio | Workflow: ${landing.workflowType} | Campaign: ${landing.campaignId} -->`,
    `<section class="landing" data-title="${landing.title}">`,
    blocks,
    `</section>`,
    ``,
  ].join('\n');
}

/**
 * Serializa la configuración del editor al contrato JSON del backend de compilación.
 *
 * El motor Jinja2 del backend lee `config.title` e itera `config.blocks` usando
 * `block.type` y `block.config` (véase `backend/app/services/compiler_service.py`).
 * La configuración de cada bloque se copia para no compartir referencias mutables.
 *
 * @param landing Configuración de la landing en edición.
 * @returns Configuración serializada lista para `POST /designer/compile`.
 */
export function serializeLandingConfig(landing: ILandingConfig): Record<string, unknown> {
  return {
    title: landing.title,
    workflowType: landing.workflowType,
    blocks: landing.blocks.map((instance): ISerializedBlock => ({
      type: instance.type,
      name: instance.name,
      config: { ...instance.config },
    })),
  };
}
