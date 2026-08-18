/**
 * Sistema de configuración sin hardcode con inyección de dependencias.
 *
 * Contrato:
 * - `IConfigSource` abstrae el origen de las variables de entorno.
 * - `ViteEnvConfigSource` lee variables desde `import.meta.env` (Vite).
 * - `MemoryConfigSource` permite inyectar valores deterministas en tests.
 * - `Config` valida las variables requeridas al arranque y expone una `IAppConfig` tipada.
 */
import type { AppEnvironment, IAppConfig, IConfigDefinition, IFeatureFlags } from '@/types/config';
import { AppError, ConfigValidationError } from '@/lib/errors';
import type { ILogger } from '@/lib/logger';

/** Origen de variables de configuración. */
export interface IConfigSource {
  /** Devuelve el valor crudo de una clave o `undefined` si no existe. */
  get(key: string): string | undefined;
}

/** Fuente que lee variables desde `import.meta.env` (Vite). */
export class ViteEnvConfigSource implements IConfigSource {
  /** Devuelve el valor crudo de una clave de entorno de Vite. */
  public get(key: string): string | undefined {
    return (import.meta.env as Record<string, string | undefined>)[key];
  }
}

/** Fuente en memoria usada en tests y escenarios deterministas. */
export class MemoryConfigSource implements IConfigSource {
  /** Valores de configuración en memoria. */
  private readonly values: Record<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.values = { ...values };
  }

  /** Devuelve el valor crudo de una clave en memoria. */
  public get(key: string): string | undefined {
    return this.values[key];
  }
}

/** Variables de entorno requeridas del frontend mapeadas a `IAppConfig`. */
const REQUIRED_DEFINITIONS: readonly IConfigDefinition[] = [
  { envKey: 'VITE_APP_NAME', field: 'appName', required: true },
  { envKey: 'VITE_APP_ENV', field: 'appEnv', required: true, transform: parseAppEnv },
  { envKey: 'VITE_API_BASE_URL', field: 'apiBaseUrl', required: true },
  { envKey: 'VITE_TENANT_ID', field: 'tenantId', required: true },
  { envKey: 'VITE_DEEPSEEK_API_KEY', field: 'deepSeekApiKey', required: false },
];

/** Definiciones de feature flags mapeadas a `IFeatureFlags`. */
const FEATURE_FLAG_DEFINITIONS: readonly IConfigDefinition[] = [
  {
    envKey: 'VITE_FEATURE_DRAG_DROP',
    field: 'dragAndDrop',
    required: false,
    transform: parseBoolean,
  },
  {
    envKey: 'VITE_FEATURE_AI_ASSISTANT',
    field: 'aiAssistant',
    required: false,
    transform: parseBoolean,
  },
  {
    envKey: 'VITE_FEATURE_CODE_EDITOR',
    field: 'codeEditor',
    required: false,
    transform: parseBoolean,
  },
  {
    envKey: 'VITE_FEATURE_TEMPLATE_MARKETPLACE',
    field: 'templateMarketplace',
    required: false,
    transform: parseBoolean,
  },
];

/** Valores por defecto de los feature flags (fail-closed). */
const FEATURE_FLAG_DEFAULTS: IFeatureFlags = {
  dragAndDrop: false,
  aiAssistant: false,
  codeEditor: false,
  templateMarketplace: false,
};

/** Valida y normaliza el entorno de aplicación. */
function parseAppEnv(raw: string): AppEnvironment {
  if (raw === 'development' || raw === 'staging' || raw === 'production') {
    return raw;
  }
  throw new AppError(`Valor inválido para entorno de aplicación: "${raw}"`, 'config.validation', {
    envKey: 'VITE_APP_ENV',
    value: raw,
    expected: ['development', 'staging', 'production'],
  });
}

/** Convierte un valor textual a booleano (`true`, `1`, `yes` → verdadero). */
function parseBoolean(raw: string): boolean {
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** Cargador de configuración que valida variables requeridas y expone una `IAppConfig`. */
export class Config {
  /** Fuente de variables de entorno inyectada. */
  private readonly source: IConfigSource;
  /** Logger de auditoría inyectado. */
  private readonly logger: ILogger;

  constructor(source: IConfigSource, logger: ILogger) {
    this.source = source;
    this.logger = logger;
  }

  /**
   * Carga y valida la configuración desde la fuente inyectada.
   * @returns La configuración tipada y validada.
   * @throws {ConfigValidationError} Si faltan variables requeridas.
   * @throws {AppError} Si una variable tiene un valor inválido.
   */
  public load(): IAppConfig {
    try {
      const config = this.buildConfig();
      this.logger.info('config.load.success', {
        appEnv: config.appEnv,
        tenantId: config.tenantId,
        features: config.features,
      });
      return config;
    } catch (error) {
      if (error instanceof AppError) {
        this.logger.error(error.operation, error.context);
      } else {
        this.logger.error('config.load.failed', { error: String(error) });
      }
      throw error;
    }
  }

  /** Construye la configuración leyendo y validando las variables de la fuente. */
  private buildConfig(): IAppConfig {
    const missingKeys: string[] = [];
    const values: Record<string, unknown> = {};

    for (const definition of REQUIRED_DEFINITIONS) {
      const raw = this.source.get(definition.envKey);
      if (raw === undefined || raw === '') {
        if (definition.required) {
          missingKeys.push(definition.envKey);
        }
        continue;
      }
      values[definition.field] = definition.transform ? definition.transform(raw) : raw;
    }

    if (missingKeys.length > 0) {
      throw new ConfigValidationError(missingKeys);
    }

    const features: IFeatureFlags = { ...FEATURE_FLAG_DEFAULTS };
    for (const definition of FEATURE_FLAG_DEFINITIONS) {
      const raw = this.source.get(definition.envKey);
      if (raw !== undefined) {
        features[definition.field as keyof IFeatureFlags] =
          definition.transform !== undefined
            ? (definition.transform(raw) as boolean)
            : parseBoolean(raw);
      }
    }

    return {
      appName: values.appName as string,
      appEnv: values.appEnv as AppEnvironment,
      apiBaseUrl: values.apiBaseUrl as string,
      tenantId: values.tenantId as string,
      deepSeekApiKey: (values.deepSeekApiKey as string | undefined) ?? '',
      features,
    };
  }
}
