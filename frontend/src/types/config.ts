/**
 * Tipos del sistema de configuración de OmniBotIA Studio.
 *
 * Contrato:
 * - `IAppConfig` es la configuración validada y tipada disponible en toda la aplicación.
 * - `IFeatureFlags` agrupa las banderas de funcionalidad (feature flags).
 * - `IConfigDefinition` declara el mapeo entre variables de entorno y campos de configuración.
 */

/** Entorno de ejecución soportado por la aplicación. */
export type AppEnvironment = 'development' | 'staging' | 'production';

/** Banderas de funcionalidad que activan o desactivan módulos del editor. */
export interface IFeatureFlags {
  /** Habilita el drag & drop en el canvas. */
  dragAndDrop: boolean;
  /** Habilita el asistente de IA. */
  aiAssistant: boolean;
  /** Habilita el editor de código (Monaco en fases posteriores). */
  codeEditor: boolean;
  /** Habilita el marketplace de plantillas. */
  templateMarketplace: boolean;
}

/** Configuración tipada y validada de la aplicación. */
export interface IAppConfig {
  /** Nombre público de la aplicación. */
  appName: string;
  /** Entorno de ejecución actual. */
  appEnv: AppEnvironment;
  /** URL base de la API del backend. */
  apiBaseUrl: string;
  /** Identificador del tenant aislado. */
  tenantId: string;
  /** Clave de API de DeepSeek (solo desarrollo; nunca en producción). */
  deepSeekApiKey: string;
  /** Banderas de funcionalidad activas. */
  features: IFeatureFlags;
}

/** Declaración de una variable de entorno mapeada a un campo de configuración. */
export interface IConfigDefinition {
  /** Clave de la variable de entorno (p. ej. `VITE_API_BASE_URL`). */
  envKey: string;
  /** Campo de destino dentro de `IAppConfig` o `IFeatureFlags`. */
  field: string;
  /** Indica si la variable es obligatoria al arranque. */
  required: boolean;
  /** Transformador opcional aplicado al valor crudo de la variable. */
  transform?: (raw: string) => unknown;
}
