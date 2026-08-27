/**
 * Pruebas del servicio de generación IA de JSON Schemas.
 *
 * Contrato:
 * - `BackendSchemaService.generate` delega en `IApiClient.generateSchema`.
 * - Incluye el nombre opcional solo cuando está presente (y recortado).
 * - Normaliza la respuesta del backend (snake_case) a `ISchemaGenerationResult` (camelCase).
 * - `list` devuelve los items de la primera página de `IApiClient.listSchemas`.
 * - `createSchemaService` expone una implementación lista para el composition root.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IApiClient } from '@/api/client';
import type {
  ISchemaGenerateResponse,
  ISchemaVersionCreateRequest,
  ISchemaVersionRead,
} from '@/api/types';
import { BackendSchemaService, createSchemaService } from '@/services/schemaService';

/** Construye un doble de `IApiClient` con todos los métodos del contrato. */
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

/** Fábrica de `ISchemaGenerateResponse` (DTO exacto del backend). */
function makeResponse(overrides: Partial<ISchemaGenerateResponse> = {}): ISchemaGenerateResponse {
  return {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
      properties: { nombre: { type: 'string' } },
      required: ['nombre'],
    },
    model: 'deepseek-chat',
    cached: false,
    prompt_tokens: 40,
    completion_tokens: 90,
    generated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `ISchemaVersionRead` (DTO exacto del backend). */
function makeSchemaVersion(overrides: Partial<ISchemaVersionRead> = {}): ISchemaVersionRead {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'tenant-1',
    schema_id: '22222222-2222-4222-8222-222222222222',
    version: '1.0.1',
    schema_json: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
      properties: { nombre: { type: 'string' } },
      required: ['nombre'],
    },
    change_note: 'Añadido campo obligatorio',
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

describe('BackendSchemaService', () => {
  it('genera un schema llamando a generateSchema solo con el prompt', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateSchema as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = new BackendSchemaService(apiClient);

    const result = await service.generate('Esquema JSON de un cliente');

    expect(apiClient.generateSchema).toHaveBeenCalledTimes(1);
    expect(apiClient.generateSchema).toHaveBeenCalledWith({
      prompt: 'Esquema JSON de un cliente',
    });
    expect(result.schema).toMatchObject({ title: 'Cliente' });
    expect(result.model).toBe('deepseek-chat');
    expect(result.cached).toBe(false);
    expect(result.promptTokens).toBe(40);
    expect(result.completionTokens).toBe(90);
    expect(result.generatedAt).toBe('2026-08-18T00:00:00Z');
  });

  it('incluye el nombre recortado en la petición cuando se proporciona', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateSchema as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = new BackendSchemaService(apiClient);

    await service.generate('Prompt', '  Cliente  ');

    expect(apiClient.generateSchema).toHaveBeenCalledWith({
      prompt: 'Prompt',
      name: 'Cliente',
    });
  });

  it('omite el nombre cuando es solo espacios', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateSchema as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = new BackendSchemaService(apiClient);

    await service.generate('Prompt', '   ');

    expect(apiClient.generateSchema).toHaveBeenCalledWith({ prompt: 'Prompt' });
  });

  it('refleja el flag de caché del backend en el resultado', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateSchema as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ cached: true }),
    );
    const service = new BackendSchemaService(apiClient);

    const result = await service.generate('Repetido');

    expect(result.cached).toBe(true);
  });

  it('lista los schemas de la primera página', async () => {
    const apiClient = makeApiClientMock();
    const items = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        tenant_id: 'tenant-1',
        name: 'Cliente',
        description: null,
        schema_json: { type: 'object' },
        version: '1.0.0',
        created_at: '2026-08-18T00:00:00Z',
        revision: 1,
        updated_at: '2026-08-18T00:00:00Z',
      },
    ];
    (apiClient.listSchemas as ReturnType<typeof vi.fn>).mockResolvedValue({
      items,
      total: 1,
      page: 1,
      page_size: 20,
    });
    const service = new BackendSchemaService(apiClient);

    const result = await service.list();

    expect(apiClient.listSchemas).toHaveBeenCalledTimes(1);
    expect(result).toEqual(items);
  });

  it('propaga errores de la API sin envolverlos', async () => {
    const apiClient = makeApiClientMock();
    const failure = new Error('agotado');
    (apiClient.generateSchema as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const service = new BackendSchemaService(apiClient);

    await expect(service.generate('Prompt')).rejects.toBe(failure);
  });

  it('valida un schema y normaliza las incidencias del backend', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.validateSchema as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: false,
      errors: 1,
      issues: [{ path: 'properties.nombre', message: 'no es de tipo string', keyword: 'type' }],
    });
    const service = new BackendSchemaService(apiClient);

    const result = await service.validate({
      type: 'object',
      properties: { nombre: { type: 'number' } },
    });

    expect(apiClient.validateSchema).toHaveBeenCalledTimes(1);
    expect(apiClient.validateSchema).toHaveBeenCalledWith({
      schema: { type: 'object', properties: { nombre: { type: 'number' } } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toBe(1);
    expect(result.issues).toEqual([
      { path: 'properties.nombre', message: 'no es de tipo string', keyword: 'type' },
    ]);
  });

  it('incluye los datos en la petición de validación cuando se proporcionan', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.validateSchema as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: true,
      errors: 0,
      issues: [],
    });
    const service = new BackendSchemaService(apiClient);

    await service.validate({ type: 'object' }, { nombre: 'Ana' });

    expect(apiClient.validateSchema).toHaveBeenCalledWith({
      schema: { type: 'object' },
      data: { nombre: 'Ana' },
    });
  });

  it('lista las versiones de un schema delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    const version = makeSchemaVersion();
    (apiClient.listSchemaVersions as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [version],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const service = new BackendSchemaService(apiClient);

    const versions = await service.listVersions('22222222-2222-4222-8222-222222222222');

    expect(apiClient.listSchemaVersions).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(versions).toEqual([version]);
  });

  it('crea una versión con la nota del cambio y devuelve la versión creada', async () => {
    const apiClient = makeApiClientMock();
    const created = makeSchemaVersion();
    (apiClient.createSchemaVersion as ReturnType<typeof vi.fn>).mockResolvedValue(created);
    const service = new BackendSchemaService(apiClient);
    const input: ISchemaVersionCreateRequest = {
      version: '1.0.1',
      change_note: 'Añadido campo obligatorio',
    };

    const result = await service.createVersion('22222222-2222-4222-8222-222222222222', input);

    expect(apiClient.createSchemaVersion).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      input,
    );
    expect(result).toBe(created);
  });
});

describe('createSchemaService', () => {
  it('construye una implementación BackendSchemaService desde el cliente', () => {
    const apiClient = makeApiClientMock();
    const service = createSchemaService(apiClient);

    expect(service).toBeInstanceOf(BackendSchemaService);
  });

  it('delega en el cliente inyectado durante la generación', async () => {
    const apiClient = makeApiClientMock();
    (apiClient.generateSchema as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse());
    const service = createSchemaService(apiClient);

    await service.generate('Hola');

    expect(apiClient.generateSchema).toHaveBeenCalledWith({ prompt: 'Hola' });
  });
});
