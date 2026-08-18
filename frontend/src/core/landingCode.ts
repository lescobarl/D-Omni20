/**
 * Generador de representación compilada de una landing.
 *
 * Contrato:
 * - `generateLandingCode` produce una representación HTML funcional de la landing con su workflow.
 * - Es lógica pura: no depende del DOM y es testeable de forma aislada.
 */
import type { IBlockInstance, ILandingConfig } from '@/types/editor';

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
