/**
 * Sistema de logging de auditoría inmutable para OmniBotIA Studio.
 *
 * Contrato:
 * - `ILogger` expone niveles tipados y un registro de auditoría consultable.
 * - `ConsoleLogger` implementa `ILogger` volcando a consola y acumulando entradas inmutables.
 */

/** Niveles de log soportados. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Entrada inmutable del registro de auditoría. */
export interface ILogEntry {
  /** Marca de tiempo UTC en formato ISO 8601. */
  timestamp: string;
  /** Nivel de severidad de la entrada. */
  level: LogLevel;
  /** Operación registrada (p. ej. `config.load`). */
  operation: string;
  /** Contexto descriptivo de la operación. */
  context: Record<string, unknown>;
}

/** Contrato del logger de auditoría. */
export interface ILogger {
  /** Registra una entrada de depuración. */
  debug(operation: string, context?: Record<string, unknown>): void;
  /** Registra una entrada informativa. */
  info(operation: string, context?: Record<string, unknown>): void;
  /** Registra una advertencia. */
  warn(operation: string, context?: Record<string, unknown>): void;
  /** Registra un error. */
  error(operation: string, context?: Record<string, unknown>): void;
  /** Devuelve una copia del registro de auditoría acumulado. */
  getEntries(): readonly ILogEntry[];
  /** Vacía el registro de auditoría acumulado. */
  clear(): void;
}

/** Peso numérico de cada nivel para filtrar por severidad mínima. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Implementación de consola del logger de auditoría. */
export class ConsoleLogger implements ILogger {
  /** Nivel mínimo que se emite a consola. */
  private readonly minLevel: LogLevel;
  /** Registro inmutable acumulado. */
  private entries: readonly ILogEntry[];

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
    this.entries = [];
  }

  /** Registra una entrada de depuración. */
  public debug(operation: string, context: Record<string, unknown> = {}): void {
    this.write('debug', operation, context);
  }

  /** Registra una entrada informativa. */
  public info(operation: string, context: Record<string, unknown> = {}): void {
    this.write('info', operation, context);
  }

  /** Registra una advertencia. */
  public warn(operation: string, context: Record<string, unknown> = {}): void {
    this.write('warn', operation, context);
  }

  /** Registra un error. */
  public error(operation: string, context: Record<string, unknown> = {}): void {
    this.write('error', operation, context);
  }

  /** Devuelve una copia del registro de auditoría acumulado. */
  public getEntries(): readonly ILogEntry[] {
    return [...this.entries];
  }

  /** Vacía el registro de auditoría acumulado. */
  public clear(): void {
    this.entries = [];
  }

  /** Construye la entrada, la acumula de forma inmutable y la emite si supera el nivel mínimo. */
  private write(level: LogLevel, operation: string, context: Record<string, unknown>): void {
    const entry: ILogEntry = {
      timestamp: new Date().toISOString(),
      level,
      operation,
      context,
    };
    this.entries = [...this.entries, entry];

    if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.minLevel]) {
      const line = `[${entry.timestamp}] [${level.toUpperCase()}] ${operation}`;
      if (level === 'error') {
        console.error(line, context);
      } else if (level === 'warn') {
        console.warn(line, context);
      } else if (level === 'debug') {
        console.debug(line, context);
      } else {
        console.info(line, context);
      }
    }
  }
}
