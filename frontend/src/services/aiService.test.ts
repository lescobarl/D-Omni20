/**
 * Pruebas del servicio de generación IA de landings.
 *
 * Contrato:
 * - `BackendAiService.generate` delega en `IApiClient.generateLanding`.
 * - Normaliza la respuesta del backend a `IAiGenerationResult`.
 * - `createAiService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IApiClient } from '@/api/client';
import type { IAiGenerationResponse } from '@/api/types';
import { BackendAiService, createAiService } from '@/services/aiService';

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

function makeResponse(overrides: Partial<IAiGenerationResponse> = {}): IAiGenerationResponse {
  return {
    config: {
      title: 'Landing IA',
      workflowType: 'lead_capture',
      blocks: [{ type: 'hero', name: 'Hero IA', config: { title: 'Hola' } }],
    },
    model: 'deepseek-chat',
    cached: false,
    prompt_tokens: 120,
    completion_tokens: 340,
    generated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

describe('BackendAiService', () => {
  it('genera una landing llamando a generateLanding con prompt y workflow', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateLanding as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = new BackendAiService(apiClient);

    const result = await service.generate('Crea una landing dental', 'lead_capture');

    expect(apiClient.generateLanding).toHaveBeenCalledTimes(1);
    expect(apiClient.generateLanding).toHaveBeenCalledWith({
      prompt: 'Crea una landing dental',
      workflow_type: 'lead_capture',
    });
    expect(result.config.title).toBe('Landing IA');
    expect(result.config.workflowType).toBe('lead_capture');
    expect(result.config.blocks[0].block_id).toBe('hero_video');
    expect(result.model).toBe('deepseek-chat');
    expect(result.cached).toBe(false);
    expect(result.promptTokens).toBe(120);
    expect(result.completionTokens).toBe(340);
    expect(result.generatedAt).toBe('2026-08-18T00:00:00Z');
  });

  it('refleja el flag de caché del backend en el resultado', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateLanding as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ cached: true }),
    );
    const service = new BackendAiService(apiClient);

    const result = await service.generate('Repetido', 'direct_checkout');

    expect(result.cached).toBe(true);
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const failure = new Error('agotado');
    (apiClient.generateLanding as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const service = new BackendAiService(apiClient);

    await expect(service.generate('Prompt', 'direct_checkout')).rejects.toBe(failure);
  });
});

describe('createAiService', () => {
  it('construye una implementación BackendAiService desde el cliente', () => {
    const apiClient = makeApiClientMock();
    const service = createAiService(apiClient);

    expect(service).toBeInstanceOf(BackendAiService);
  });

  it('delega en el cliente inyectado durante la generación', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateLanding as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = createAiService(apiClient);

    await service.generate('Hola', 'quote_generator');

    expect(apiClient.generateLanding).toHaveBeenCalledWith({
      prompt: 'Hola',
      workflow_type: 'quote_generator',
    });
  });
});
