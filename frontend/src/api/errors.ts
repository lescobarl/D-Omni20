/**
 * Jerarquía de errores de la capa de API con contexto descriptivo.
 *
 * Contrato:
 * - `ApiError` es la raíz de la capa HTTP: extiende `AppError` y añade `status`.
 * - `ApiNetworkError` representa fallos de red (fetch rechazado, status 0).
 * - `ApiHttpError` representa respuestas HTTP no 2xx con cuerpo de error.
 */
import { AppError } from '@/lib/errors';

/** Error base de la capa de API con estado HTTP asociado. */
export class ApiError extends AppError {
  /** Estado HTTP de la respuesta (0 en errores de red). */
  public readonly status: number;

  constructor(
    message: string,
    operation: string,
    status: number,
    context: Record<string, unknown> = {},
  ) {
    super(message, operation, { ...context, status });
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Error de red: la petición no alcanzó el servidor (fetch rechazó). */
export class ApiNetworkError extends ApiError {
  constructor(operation: string, context: Record<string, unknown> = {}) {
    super('No se pudo conectar con el servidor', operation, 0, context);
    this.name = 'ApiNetworkError';
  }
}

/** Error HTTP: el servidor respondió con un estado no 2xx. */
export class ApiHttpError extends ApiError {
  /** Cuerpo de error devuelto por el backend (p. ej. `{ error: { code, message } }`). */
  public readonly body: unknown;

  constructor(
    message: string,
    operation: string,
    status: number,
    body: unknown,
    context: Record<string, unknown> = {},
  ) {
    super(message, operation, status, { ...context, body });
    this.name = 'ApiHttpError';
    this.body = body;
  }
}

/** Guard de tipo para objetos planos (`Record<string, unknown>`). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extrae el mensaje de error del cuerpo estándar del backend.
 *
 * El backend responde `{ error: { code, message, status_code } }` (AppError) o
 * `{ detail }` (validación). Devuelve `null` si no hay mensaje reconocible.
 */
export function extractApiErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const nested = body.error;
  if (isRecord(nested) && typeof nested.message === 'string') {
    return nested.message;
  }
  if (typeof body.message === 'string') {
    return body.message;
  }
  if (typeof body.detail === 'string') {
    return body.detail;
  }
  return null;
}
