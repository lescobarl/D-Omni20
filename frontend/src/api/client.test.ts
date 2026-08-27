/**
 * Tests de integración del cliente HTTP con el contrato del backend.
 *
 * Contrato:
 * - Verifica el contrato frontend-backend: rutas `/api/v1`, cabecera
 *   `X-Tenant-Id` (multi-tenancy) y payloads de los endpoints del designer.
 * - Usa un `fetch` inyectado (DI) con respuestas simuladas del backend.
 * - Cubre el flujo completo CRUD + publicar, compilación y manejo de errores.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestConfig } from '@/test/config';
import { createApiClient, HttpApiClient } from './client';
import type { IApiClient, IFetcher } from './client';
import { ApiHttpError, ApiNetworkError, extractApiErrorMessage } from './errors';
import type { ILandingRead, ISchemaVersionRead, IMarketplaceTemplateRead } from './types';

/** Respuesta mínima compatible con `Response` para las pruebas. */
interface IMockResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/** Construye una respuesta JSON simulada del backend. */
function jsonResponse(status: number, body: unknown): IMockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** Construye una respuesta vacía (204 No Content). */
function emptyResponse(status: number): IMockResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => '' };
}

/** Fábrica de una `ILandingRead` de prueba con valores por defecto. */
function makeLanding(overrides: Partial<ILandingRead> = {}): ILandingRead {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'test-tenant',
    campaign_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Landing de Prueba',
    config: { title: 'Nueva Landing', workflowType: 'direct_checkout', blocks: [] },
    compiled_html: null,
    published: false,
    published_at: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de una `ISchemaVersionRead` de prueba con valores por defecto. */
function makeSchemaVersion(overrides: Partial<ISchemaVersionRead> = {}): ISchemaVersionRead {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'test-tenant',
    schema_id: '22222222-2222-4222-8222-222222222222',
    version: '1.0.1',
    schema_json: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
      properties: { telefono: { type: 'string' } },
      required: ['telefono'],
    },
    change_note: 'Añadido teléfono obligatorio',
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de una `IMarketplaceTemplateRead` de prueba con valores por defecto. */
function makeMarketplaceTemplate(
  overrides: Partial<IMarketplaceTemplateRead> = {},
): IMarketplaceTemplateRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'test-tenant',
    name: 'Landing de Ventas',
    description: 'Landing de conversión para ventas.',
    category: 'ventas',
    config: { title: 'Nueva Landing', workflowType: 'direct_checkout', blocks: [] },
    thumbnail_url: null,
    is_public: true,
    downloads: 12,
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

describe('HttpApiClient', () => {
  /** Peticiones registradas por el fetch inyectado. */
  let calls: Array<{ input: string; init?: RequestInit }>;
  /** Handler por defecto de respuestas (se reemplaza por test). */
  let handler: (input: string, init?: RequestInit) => IMockResponse;
  /** Cliente bajo prueba (fetch inyectado, DI). */
  let client: IApiClient;

  const mockFetcher: IFetcher = async (input, init) => {
    calls.push({ input, init });
    return handler(input, init) as unknown as Response;
  };

  beforeEach(() => {
    calls = [];
    handler = () => emptyResponse(204);
    client = HttpApiClient.fromConfig(createTestConfig(), mockFetcher);
  });

  it('consulta el estado de salud sin cabecera de tenant', async () => {
    handler = () =>
      jsonResponse(200, {
        status: 'ok',
        database: 'ok',
        time: '2026-08-18T00:00:00Z',
        app_name: 'OmniBotIA Studio API',
        app_version: '0.2.0',
        backend_env: 'development',
      });

    const result = await client.health();

    expect(result.status).toBe('ok');
    expect(result.app_version).toBe('0.2.0');
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/health');
    expect(calls[0].init?.headers).not.toHaveProperty('X-Tenant-Id');
  });

  it('envía la cabecera X-Tenant-Id en endpoints protegidos', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 });

    const result = await client.listLandings();

    expect(result.total).toBe(0);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/designer');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('serializa los parámetros de paginación en la query string', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 2, page_size: 5 });

    await client.listLandings({ page: 2, page_size: 5 });

    expect(calls[0].input).toBe('http://localhost:8000/api/v1/designer?page=2&page_size=5');
  });

  it('obtiene una landing del tenant por su identificador', async () => {
    const landing = makeLanding();
    handler = () => jsonResponse(200, landing);

    const result = await client.getLanding(landing.id);

    expect(result.id).toBe(landing.id);
    expect(result.name).toBe('Landing de Prueba');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/designer/11111111-1111-4111-8111-111111111111',
    );
  });

  it('ejecuta el flujo completo create→publish→update→delete', async () => {
    const landing = makeLanding();
    const published = makeLanding({
      published: true,
      published_at: '2026-08-18T01:00:00Z',
      revision: 2,
    });
    const renamed = makeLanding({ name: 'Landing Renombrada', revision: 3 });
    const responses = [
      jsonResponse(201, landing),
      jsonResponse(200, published),
      jsonResponse(200, renamed),
      emptyResponse(204),
    ];
    let index = 0;
    handler = () => responses[index++];

    const created = await client.createLanding({
      campaign_id: landing.campaign_id,
      name: landing.name,
      config: landing.config,
    });
    expect(created.id).toBe(landing.id);

    const publishResult = await client.publishLanding(landing.id, { published: true });
    expect(publishResult.published).toBe(true);

    const updateResult = await client.updateLanding(landing.id, { name: 'Landing Renombrada' });
    expect(updateResult.name).toBe('Landing Renombrada');

    await client.deleteLanding(landing.id);

    expect(calls).toHaveLength(4);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
      campaign_id: landing.campaign_id,
      name: 'Landing de Prueba',
    });
    expect(calls[1].input).toBe(
      'http://localhost:8000/api/v1/designer/11111111-1111-4111-8111-111111111111/publish',
    );
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ published: true });
    expect(calls[2].init?.method).toBe('PATCH');
    expect(JSON.parse(calls[2].init?.body as string)).toEqual({ name: 'Landing Renombrada' });
    expect(calls[3].init?.method).toBe('DELETE');
    expect(calls[3].input).toBe(
      'http://localhost:8000/api/v1/designer/11111111-1111-4111-8111-111111111111',
    );
  });

  it('compila una configuración a HTML en /designer/compile', async () => {
    handler = () =>
      jsonResponse(200, {
        html: '<section class="landing" data-title="Demo"></section>',
        compiled_at: '2026-08-18T00:00:00Z',
        duration_ms: 12.5,
      });

    const result = await client.compileLanding({
      config: { title: 'Demo', workflowType: 'direct_checkout', blocks: [] },
      minify: true,
    });

    expect(result.html).toContain('data-title="Demo"');
    expect(result.duration_ms).toBe(12.5);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/designer/compile');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      config: { title: 'Demo', workflowType: 'direct_checkout', blocks: [] },
      minify: true,
    });
  });

  it('genera una configuración con IA en /designer/generate', async () => {
    handler = () =>
      jsonResponse(200, {
        config: {
          title: 'Landing IA',
          workflowType: 'lead_capture',
          blocks: [{ type: 'hero', name: 'Hero IA', config: {} }],
        },
        model: 'deepseek-chat',
        cached: false,
        prompt_tokens: 120,
        completion_tokens: 340,
        generated_at: '2026-08-18T00:00:00Z',
      });

    const result = await client.generateLanding({
      prompt: 'Crea una landing de captura de leads para una clínica dental',
      workflow_type: 'lead_capture',
    });

    expect(result.config).toMatchObject({ title: 'Landing IA' });
    expect(result.model).toBe('deepseek-chat');
    expect(result.cached).toBe(false);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/designer/generate');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      prompt: 'Crea una landing de captura de leads para una clínica dental',
      workflow_type: 'lead_capture',
    });
  });

  it('genera un JSON Schema con IA en /ai/generate-schema', async () => {
    handler = () =>
      jsonResponse(200, {
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'Cliente',
          type: 'object',
        },
        model: 'deepseek-chat',
        cached: false,
        prompt_tokens: 40,
        completion_tokens: 90,
        generated_at: '2026-08-18T00:00:00Z',
      });

    const result = await client.generateSchema({
      prompt: 'Esquema JSON de un cliente',
      name: 'Cliente',
    });

    expect(result.schema).toMatchObject({ title: 'Cliente' });
    expect(result.model).toBe('deepseek-chat');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/ai/generate-schema');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      prompt: 'Esquema JSON de un cliente',
      name: 'Cliente',
    });
  });

  it('lista los JSON Schemas del tenant en /ai/schemas', async () => {
    const schema = {
      id: '22222222-2222-4222-8222-222222222222',
      tenant_id: 'test-tenant',
      name: 'Cliente',
      description: null,
      schema_json: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
      version: '1.0.0',
      created_at: '2026-08-18T00:00:00Z',
      revision: 1,
      updated_at: '2026-08-18T00:00:00Z',
    };
    handler = () => jsonResponse(200, { items: [schema], total: 1, page: 1, page_size: 20 });

    const result = await client.listSchemas();

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/ai/schemas');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('serializa la paginación de schemas en la query string', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 2, page_size: 5 });

    await client.listSchemas({ page: 2, page_size: 5 });

    expect(calls[0].input).toBe('http://localhost:8000/api/v1/ai/schemas?page=2&page_size=5');
  });

  it('valida un JSON Schema en /schemas/validate', async () => {
    handler = () =>
      jsonResponse(200, {
        valid: true,
        errors: 0,
        issues: [],
      });

    const result = await client.validateSchema({
      schema: { type: 'object', properties: { nombre: { type: 'string' } } },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/schemas/validate');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista las versiones de un schema en /schemas/{id}/versions', async () => {
    const version = makeSchemaVersion();
    handler = () => jsonResponse(200, { items: [version], total: 1, page: 1, page_size: 20 });

    const result = await client.listSchemaVersions('22222222-2222-4222-8222-222222222222');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].version).toBe('1.0.1');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/schemas/22222222-2222-4222-8222-222222222222/versions',
    );
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('serializa la paginación de versiones en la query string', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 2, page_size: 5 });

    await client.listSchemaVersions('22222222-2222-4222-8222-222222222222', {
      page: 2,
      page_size: 5,
    });

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/schemas/22222222-2222-4222-8222-222222222222/versions?page=2&page_size=5',
    );
  });

  it('crea una versión de un schema en /schemas/{id}/versions', async () => {
    const version = makeSchemaVersion({ version: '1.1.0', change_note: 'Añadido teléfono' });
    handler = () => jsonResponse(201, version);

    const result = await client.createSchemaVersion('22222222-2222-4222-8222-222222222222', {
      version: '1.1.0',
      change_note: 'Añadido teléfono',
    });

    expect(result.version).toBe('1.1.0');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/schemas/22222222-2222-4222-8222-222222222222/versions',
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      version: '1.1.0',
      change_note: 'Añadido teléfono',
    });
  });

  it('lanza ApiHttpError con el mensaje y contexto del backend', async () => {
    handler = () =>
      jsonResponse(404, {
        error: { code: 'landing.not_found', message: 'Landing no encontrada', status_code: 404 },
      });

    const error = await client
      .getLanding('99999999-9999-4999-8999-999999999999')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiHttpError);
    const apiError = error as ApiHttpError;
    expect(apiError.status).toBe(404);
    expect(apiError.operation).toBe('api.landing.get');
    expect(apiError.message).toBe('Landing no encontrada');
    expect(apiError.context).toMatchObject({ status: 404, url: expect.any(String) });
  });

  it('lanza ApiNetworkError con contexto cuando fetch rechaza', async () => {
    handler = () => {
      throw new TypeError('Failed to fetch');
    };

    const error = await client.listLandings().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiNetworkError);
    const apiError = error as ApiNetworkError;
    expect(apiError.status).toBe(0);
    expect(apiError.operation).toBe('api.landing.list');
    expect(apiError.context).toMatchObject({ url: 'http://localhost:8000/api/v1/designer' });
  });

  it('construye el cliente desde la configuración normalizando la URL base', async () => {
    const api = createApiClient(
      createTestConfig({ apiBaseUrl: 'https://api.example.com/', tenantId: 'tenant-b' }),
      mockFetcher,
    );
    expect(api).toBeInstanceOf(HttpApiClient);

    handler = () => jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 });
    await api.listLandings();

    expect(calls[0].input).toBe('https://api.example.com/api/v1/designer');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'tenant-b' });
  });

  it('invoca el fetch inyectado con el receptor global (evita "Illegal invocation")', async () => {
    let receiver: unknown = null;
    const receiverAwareFetcher: IFetcher = function (this: unknown, _input, _init) {
      receiver = this;
      return Promise.resolve(emptyResponse(204) as unknown as Response);
    };

    client = HttpApiClient.fromConfig(createTestConfig(), receiverAwareFetcher);
    await client.health();

    // `fetch` nativo exige `this === Window`; el cliente debe preservar el
    // receptor global o el navegador lanza "Failed to execute 'fetch'".
    expect(receiver).toBe(globalThis);
  });

  it('lista los templates del marketplace serializando categoría y paginación', async () => {
    handler = () =>
      jsonResponse(200, {
        items: [makeMarketplaceTemplate()],
        total: 1,
        page: 1,
        page_size: 20,
      });

    const result = await client.listMarketplaceTemplates({ page: 2, page_size: 10 }, 'ventas');

    expect(result.items).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/marketplace/templates?page=2&page_size=10&category=ventas',
    );
  });

  it('omite el filtro de categoría del marketplace cuando está vacío', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 });

    await client.listMarketplaceTemplates({}, '');

    expect(calls[0].input).toBe('http://localhost:8000/api/v1/marketplace/templates');
  });

  it('publica un template en el marketplace con POST', async () => {
    handler = () => jsonResponse(201, makeMarketplaceTemplate());

    const result = await client.createMarketplaceTemplate({
      name: 'Landing de Ventas',
      category: 'ventas',
      config: { title: 'Nueva Landing' },
      is_public: true,
    });

    expect(result.id).toBe('44444444-4444-4444-8444-444444444444');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/marketplace/templates');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('importa un template a una campaña con POST', async () => {
    handler = () =>
      jsonResponse(201, {
        template: makeMarketplaceTemplate(),
        landing_id: '55555555-5555-4555-8555-555555555555',
      });

    const result = await client.importMarketplaceTemplate('44444444-4444-4444-8444-444444444444', {
      campaign_id: 'campaign-1',
      name: 'Mi landing',
    });

    expect(result.landing_id).toBe('55555555-5555-4555-8555-555555555555');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/marketplace/templates/44444444-4444-4444-8444-444444444444/import',
    );
    expect(calls[0].init?.method).toBe('POST');
  });

  it('registra un evento de analítica con POST', async () => {
    handler = () =>
      jsonResponse(201, {
        id: '66666666-6666-4666-8666-666666666666',
        tenant_id: 'tenant-1',
        event_type: 'landing.view',
        entity_type: 'landing',
        entity_id: '11111111-1111-4111-8111-111111111111',
        properties: {},
        occurred_at: '2026-08-19T00:00:00Z',
        created_at: '2026-08-19T00:00:00Z',
      });

    const result = await client.recordAnalyticsEvent({
      event_type: 'landing.view',
      entity_type: 'landing',
      entity_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(result.event_type).toBe('landing.view');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/analytics/events');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('obtiene el resumen del dashboard de analítica con GET', async () => {
    handler = () =>
      jsonResponse(200, {
        total_events: 3,
        by_event_type: [
          { event_type: 'landing.view', count: 2 },
          { event_type: 'workflow.completed', count: 1 },
        ],
        recent: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            tenant_id: 'tenant-1',
            event_type: 'landing.view',
            entity_type: null,
            entity_id: null,
            properties: {},
            occurred_at: '2026-08-19T00:00:00Z',
            created_at: '2026-08-19T00:00:00Z',
          },
        ],
      });

    const result = await client.getAnalyticsDashboard();

    expect(result.total_events).toBe(3);
    expect(result.by_event_type).toHaveLength(2);
    expect(result.recent).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/analytics/dashboard');
    expect(calls[0].init?.method).toBe('GET');
  });

  it('despliega la landing al CDN con POST a /cdn/deploy/{id}', async () => {
    handler = () =>
      jsonResponse(201, {
        id: '99999999-9999-4999-8999-999999999999',
        landing_id: '11111111-1111-4111-8111-111111111111',
        version: 1,
        url: 'https://cdn.omnibotia.example/landings/11111111-1111-4111-8111-111111111111/v1',
        status: 'deployed',
        deployed_at: '2026-08-19T00:00:00Z',
        created_at: '2026-08-19T00:00:00Z',
      });

    const result = await client.deployToCdn('11111111-1111-4111-8111-111111111111');

    expect(result.version).toBe(1);
    expect(result.status).toBe('deployed');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/cdn/deploy/11111111-1111-4111-8111-111111111111',
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });
});

describe('extractApiErrorMessage', () => {
  it('extrae el mensaje del cuerpo estándar de error del backend', () => {
    expect(extractApiErrorMessage({ error: { message: 'Landing no encontrada' } })).toBe(
      'Landing no encontrada',
    );
  });

  it('extrae mensajes planos y detail', () => {
    expect(extractApiErrorMessage({ message: 'Algo falló' })).toBe('Algo falló');
    expect(extractApiErrorMessage({ detail: 'Datos inválidos' })).toBe('Datos inválidos');
  });

  it('devuelve null cuando no hay mensaje reconocible', () => {
    expect(extractApiErrorMessage(null)).toBeNull();
    expect(extractApiErrorMessage('texto plano')).toBeNull();
    expect(extractApiErrorMessage({})).toBeNull();
  });
});
