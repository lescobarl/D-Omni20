/**
 * Mapeo de configuraciones de landing generadas por IA al dominio del editor.
 *
 * Contrato:
 * - El backend normaliza la salida del modelo a `{ title, workflowType, blocks }`
 *   donde cada bloque es `{ type, name, config }` (véase `_validate_config` en
 *   `backend/app/services/ai_service.py`).
 * - `mapAiConfigToLanding` traduce esa forma a `ILandingConfig` asignando
 *   `instance_id` UUIDv4 y resolviendo `block_id` desde el catálogo local
 *   (fallback `dynamic_<type>` para tipos aún no presentes en el catálogo).
 */
import { getBlockDefinition } from '@/core/blocks';
import { AppError } from '@/lib/errors';
import type { BlockType, IBlockInstance, ILandingConfig, WorkflowType } from '@/types/editor';
import { uuidv4 } from '@/utils/uuid';

/** Título por defecto cuando el modelo no devuelve uno válido. */
export const DEFAULT_AI_TITLE = 'Landing generada por IA';

/** Workflow por defecto cuando el modelo no devuelve uno soportado. */
export const DEFAULT_WORKFLOW_TYPE: WorkflowType = 'direct_checkout';

/** Operación de auditoría del mapeo de configuraciones IA. */
const MAP_OPERATION = 'ai.mapConfig';

/**
 * ¿El valor es un tipo de workflow soportado por el editor?
 * @param value Valor a comprobar.
 * @returns `true` si es uno de los 4 workflows del sistema.
 */
export function isWorkflowType(value: unknown): value is WorkflowType {
  return (
    value === 'direct_checkout' ||
    value === 'lead_capture' ||
    value === 'quote_generator' ||
    value === 'appointment_scheduler'
  );
}

/**
 * Mapea un bloque crudo de la respuesta IA a una instancia del editor.
 * @param raw Bloque crudo (objeto ya normalizado por el backend).
 * @returns Instancia con `instance_id` UUIDv4 y `block_id` del catálogo o `dynamic_<type>`.
 */
function mapAiBlock(raw: Record<string, unknown>): IBlockInstance {
  const type = (typeof raw.type === 'string' ? raw.type : 'hero') as BlockType;
  const definition = getBlockDefinition(type);
  const rawConfig = raw.config;
  return {
    instance_id: uuidv4(),
    block_id: definition?.block_id ?? `dynamic_${type}`,
    type,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : (definition?.name ?? type),
    config:
      typeof rawConfig === 'object' && rawConfig !== null
        ? { ...(rawConfig as Record<string, unknown>) }
        : {},
  };
}

/**
 * Convierte una configuración IA del backend en una `ILandingConfig` del editor.
 * @param raw Configuración cruda devuelta por `POST /designer/generate`.
 * @returns Configuración de landing válida para el editor.
 * @throws {AppError} Si `raw` no es un objeto (respuesta inválida del backend).
 */
export function mapAiConfigToLanding(raw: unknown): ILandingConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError('La configuración IA no es un objeto válido', MAP_OPERATION, {
      reason: 'not_object',
    });
  }

  const source = raw as Record<string, unknown>;
  const title =
    typeof source.title === 'string' && source.title.trim()
      ? source.title.trim()
      : DEFAULT_AI_TITLE;
  const workflowType: WorkflowType = isWorkflowType(source.workflowType)
    ? source.workflowType
    : DEFAULT_WORKFLOW_TYPE;

  const blocks: IBlockInstance[] = [];
  const rawBlocks = source.blocks;
  if (Array.isArray(rawBlocks)) {
    for (const block of rawBlocks) {
      if (typeof block !== 'object' || block === null) continue;
      blocks.push(mapAiBlock(block as Record<string, unknown>));
    }
  }

  return { campaignId: '', title, workflowType, blocks };
}

/**
 * Convierte la configuración de una página del Portal del Cliente generada por IA
 * en una `ILandingConfig` del editor.
 *
 * El endpoint `POST /portal-pages/generate` devuelve `blocks` con la forma
 * `{ title, blocks: [...] }` (el dict de configuración completo de la página),
 * por lo que el mapeo reutiliza la misma normalización que una landing.
 *
 * @param raw Configuración cruda de la página devuelta por el backend.
 * @returns Configuración de página válida para el editor (mismo dominio que una landing).
 * @throws {AppError} Si `raw` no es un objeto (respuesta inválida del backend).
 */
export function mapAiConfigToPortal(raw: unknown): ILandingConfig {
  return mapAiConfigToLanding(raw);
}
