/**
 * Fábrica de configuración para pruebas.
 *
 * Contrato:
 * - `createTestConfig` devuelve una `IAppConfig` válida y tipada.
 * - Permite sobrescribir campos concretos vía `overrides`.
 */
import type { IAppConfig } from '@/types/config';
import { DEFAULT_THEME } from '@/lib/config';

/**
 * Crea una configuración válida para tests.
 * @param overrides Campos a sobrescribir sobre los valores por defecto.
 * @returns Configuración de prueba funcional.
 */
export function createTestConfig(overrides: Partial<IAppConfig> = {}): IAppConfig {
  return {
    appName: 'OmniBotIA Studio',
    appEnv: 'development',
    apiBaseUrl: 'http://localhost:8000',
    tenantId: 'test-tenant',
    clientSubdomainBase: 'clientes.omni2.app',
    deepSeekApiKey: '',
    theme: { ...DEFAULT_THEME },
    features: {
      dragAndDrop: true,
      aiAssistant: false,
      codeEditor: true,
      templateMarketplace: false,
      developerSchemas: false,
      analytics: false,
      cdnDeploy: false,
      appearance: false,
      bots: false,
      operations: false,
      ads: false,
      crm: false,
      hosts: false,
      portal: false,
      maintenanceRunNow: false,
      recipientFiles: false,
    },
    ...overrides,
  };
}
