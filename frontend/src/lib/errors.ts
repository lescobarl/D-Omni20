/**
 * Jerarquía de errores de OmniBotIA Studio con contexto descriptivo.
 *
 * Contrato:
 * - `AppError` es la raíz de todos los errores de dominio: incluye operación y contexto serializable.
 * - `ConfigValidationError` reporta variables de entorno requeridas faltantes.
 */

/** Error base de la aplicación con contexto operacional. */
export class AppError extends Error {
  /** Operación en la que ocurrió el error (p. ej. `config.load`). */
  public readonly operation: string;
  /** Contexto adicional serializable del error. */
  public readonly context: Record<string, unknown>;

  constructor(message: string, operation: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AppError';
    this.operation = operation;
    this.context = context;
  }
}

/** Error lanzado cuando faltan variables de entorno requeridas al arranque. */
export class ConfigValidationError extends AppError {
  /** Variables de entorno faltantes. */
  public readonly missingKeys: readonly string[];

  constructor(missingKeys: readonly string[]) {
    const message = `Faltan variables de entorno requeridas: ${missingKeys.join(', ')}`;
    super(message, 'config.validation', { missingKeys });
    this.name = 'ConfigValidationError';
    this.missingKeys = missingKeys;
  }
}
