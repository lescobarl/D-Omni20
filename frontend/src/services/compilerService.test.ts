/**
 * Pruebas del servicio de compilación de landings.
 *
 * Contrato:
 * - `BackendCompilerService.compile` delega en `IApiClient.compileLanding`.
 * - Normaliza la respuesta del backend (snake_case) a `ICompilationResult` (camelCase).
 * - `createCompilerService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IApiClient } from '@/api/client';
import type { ILandingCompileResponse } from '@/api/types';
import {
  BackendCompilerService,
  DEFAULT_MINIFY,
  DEFAULT_TEMPLATE_NAME,
  createCompilerService,
} from '@/services/compilerService';

function makeApiClientMock(): IApiClient {
  return {
    health: vi.fn(),
    listLandings: vi.fn(),
    getLanding: vi.fn(),
    createLanding: vi.fn(),
    updateLanding: vi.fn(),
    deleteLanding: vi.fn(),
    publishLanding: vi.fn(),
    compileLanding: vi.fn(),
    generateLanding: vi.fn(),
    generateSchema: vi.fn(),
    listSchemas: vi.fn(),
    validateSchema: vi.fn(),
    listSchemaVersions: vi.fn(),
    createSchemaVersion: vi.fn(),
    createCheckout: vi.fn(),
    confirmCheckout: vi.fn(),
    captureLead: vi.fn(),
    generateQuote: vi.fn(),
    scheduleAppointment: vi.fn(),
    listMarketplaceTemplates: vi.fn(),
    createMarketplaceTemplate: vi.fn(),
    importMarketplaceTemplate: vi.fn(),
    recordAnalyticsEvent: vi.fn(),
    getAnalyticsDashboard: vi.fn(),
    deployToCdn: vi.fn(),
  };
}

function makeResponse(overrides: Partial<ILandingCompileResponse> = {}): ILandingCompileResponse {
  return {
    html: '<section class="landing" data-title="Demo"></section>',
    compiled_at: '2026-08-18T00:00:00Z',
    duration_ms: 12.5,
    ...overrides,
  };
}

function makeConfig(): Record<string, unknown> {
  return {
    title: 'Demo',
    workflowType: 'direct_checkout',
    blocks: [{ type: 'hero', name: 'Hero', config: { title: 'Hola' } }],
  };
}

describe('BackendCompilerService', () => {
  it('compila una configuración llamando a compileLanding con template por defecto y minify false', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.compileLanding as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = new BackendCompilerService(apiClient);

    const result = await service.compile({ config: makeConfig() });

    expect(apiClient.compileLanding).toHaveBeenCalledTimes(1);
    expect(apiClient.compileLanding).toHaveBeenCalledWith({
      config: makeConfig(),
      template_name: DEFAULT_TEMPLATE_NAME,
      minify: DEFAULT_MINIFY,
    });
    expect(result.html).toBe('<section class="landing" data-title="Demo"></section>');
    expect(result.durationMs).toBe(12.5);
    expect(result.compiledAt).toBe('2026-08-18T00:00:00Z');
  });

  it('propaga la opción minify cuando se solicita', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.compileLanding as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = new BackendCompilerService(apiClient);

    await service.compile({ config: makeConfig(), minify: true });

    expect(apiClient.compileLanding).toHaveBeenCalledWith({
      config: makeConfig(),
      template_name: DEFAULT_TEMPLATE_NAME,
      minify: true,
    });
  });

  it('normaliza la respuesta snake_case del backend a camelCase', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.compileLanding as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ duration_ms: 3.25, compiled_at: '2026-08-18T01:00:00Z' }),
    );
    const service = new BackendCompilerService(apiClient);

    const result = await service.compile({ config: makeConfig() });

    expect(result.durationMs).toBe(3.25);
    expect(result.compiledAt).toBe('2026-08-18T01:00:00Z');
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const failure = new Error('plantilla inválida');
    (apiClient.compileLanding as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const service = new BackendCompilerService(apiClient);

    await expect(service.compile({ config: makeConfig() })).rejects.toBe(failure);
  });
});

describe('createCompilerService', () => {
  it('construye una implementación BackendCompilerService desde el cliente', () => {
    const apiClient = makeApiClientMock();
    const service = createCompilerService(apiClient);

    expect(service).toBeInstanceOf(BackendCompilerService);
  });

  it('delega en el cliente inyectado durante la compilación', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.compileLanding as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = createCompilerService(apiClient);

    await service.compile({ config: makeConfig(), minify: true });

    expect(apiClient.compileLanding).toHaveBeenCalledWith({
      config: makeConfig(),
      template_name: DEFAULT_TEMPLATE_NAME,
      minify: true,
    });
  });
});
