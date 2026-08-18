/**
 * Pruebas del sistema de configuración sin hardcode.
 *
 * Contrato:
 * - Carga una configuración válida desde una fuente inyectada.
 * - Lanza `ConfigValidationError` cuando faltan variables requeridas.
 * - Parsea feature flags y valida el entorno de aplicación.
 */
import { describe, expect, it } from 'vitest';
import { Config, MemoryConfigSource } from '@/lib/config';
import { ConsoleLogger } from '@/lib/logger';
import { AppError, ConfigValidationError } from '@/lib/errors';

/** Variables de entorno mínimas válidas para los tests. */
const TEST_ENV: Record<string, string> = {
  VITE_APP_NAME: 'OmniBotIA Studio',
  VITE_APP_ENV: 'development',
  VITE_API_BASE_URL: 'http://localhost:8000',
  VITE_TENANT_ID: 'test-tenant',
};

describe('Config', () => {
  it('carga una configuración válida desde la fuente de memoria', () => {
    const config = new Config(new MemoryConfigSource(TEST_ENV), new ConsoleLogger()).load();

    expect(config.appName).toBe('OmniBotIA Studio');
    expect(config.appEnv).toBe('development');
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.tenantId).toBe('test-tenant');
    expect(config.deepSeekApiKey).toBe('');
  });

  it('lanza ConfigValidationError cuando faltan variables requeridas', () => {
    const source = new MemoryConfigSource({ VITE_APP_NAME: 'OmniBotIA Studio' });

    expect(() => new Config(source, new ConsoleLogger()).load()).toThrow(ConfigValidationError);
  });

  it('parsea feature flags desde variables de entorno', () => {
    const source = new MemoryConfigSource({
      ...TEST_ENV,
      VITE_FEATURE_DRAG_DROP: 'true',
      VITE_FEATURE_AI_ASSISTANT: 'false',
      VITE_FEATURE_CODE_EDITOR: '1',
    });
    const config = new Config(source, new ConsoleLogger()).load();

    expect(config.features.dragAndDrop).toBe(true);
    expect(config.features.aiAssistant).toBe(false);
    expect(config.features.codeEditor).toBe(true);
    expect(config.features.templateMarketplace).toBe(false);
  });

  it('rechaza un entorno de aplicación inválido con contexto', () => {
    const source = new MemoryConfigSource({ ...TEST_ENV, VITE_APP_ENV: 'invalid' });

    let caught: unknown;
    try {
      new Config(source, new ConsoleLogger()).load();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    if (caught instanceof AppError) {
      expect(caught.operation).toBe('config.validation');
      expect(caught.context).toEqual({
        envKey: 'VITE_APP_ENV',
        value: 'invalid',
        expected: ['development', 'staging', 'production'],
      });
    }
  });

  it('registra el éxito de carga en el log de auditoría', () => {
    const logger = new ConsoleLogger();
    new Config(new MemoryConfigSource(TEST_ENV), logger).load();

    const operations = logger.getEntries().map((entry) => entry.operation);
    expect(operations).toContain('config.load.success');
  });
});
