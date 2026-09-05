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
  /** Habilita el editor de JSON Schemas para desarrolladores. */
  developerSchemas: boolean;
  /** Habilita el dashboard de analítica avanzada. */
  analytics: boolean;
  /** Habilita el despliegue al CDN desde la vista previa. */
  cdnDeploy: boolean;
  /** Habilita la configuración de apariencia del tenant (rebranding). */
  appearance: boolean;
  /** Habilita la sección Bots/Conversaciones (Fase 7). */
  bots: boolean;
  /** Habilita la 3ª área Operación del Bot (Bloque B de LAE Omni2.0). */
  operations: boolean;
  /** Habilita la sección Captación/ADS (C-1, eslabón ① de atribución UTM). */
  ads: boolean;
  /** Habilita el subsistema CRM (pipeline "Ventas", tareas, SLA y embudo). */
  crm: boolean;
  /** Habilita la sección Dominios personalizados (PSEO hosts). */
  hosts: boolean;
  /** Habilita la ejecución manual del mantenimiento programado (B.9). */
  maintenanceRunNow: boolean;
  /** Habilita el envío masivo sobre archivos de destinatarios reutilizables (GAP 2). */
  recipientFiles: boolean;
  /** Habilita el configurador del Portal del Cliente (modo portal del editor). */
  portal: boolean;
}

/** Paleta de apariencia del tenant usada como tema por defecto (rebranding). */
export interface IAppTheme {
  /** Color primario de la marca (hex, p. ej. `#10b981`). */
  primaryColor: string;
  /** Color de acento (hex). */
  accentColor: string;
  /** Color de superficie o fondo (hex). */
  surfaceColor: string;
  /** Color de texto principal (hex). */
  textColor: string;
  /** Color de la insignia de marca (hex). */
  brandBadge: string;
  /** URL opcional del logo del tenant. */
  logoUrl?: string;
  /** Fuente tipográfica opcional del tenant. */
  fontFamily?: string;
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
  /** Dominio base bajo el que se sirven los subdominios de los tenants (p. ej. `clientes.omni2.app`). */
  clientSubdomainBase: string;
  /** Clave de API de DeepSeek (solo desarrollo; nunca en producción). */
  deepSeekApiKey: string;
  /** Tema por defecto del tenant (fallback ante ausencia de apariencia). */
  theme: IAppTheme;
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
