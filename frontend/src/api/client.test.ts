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
import { resetActiveTenant, setActiveTenant } from '@/lib/tenantContext';
import type {
  IAdCampaignRead,
  IAppearanceProposal,
  ICatalogItemRead,
  IContentItemRead,
  ILandingRead,
  IMarketplaceTemplateRead,
  IRebrandingConfigRead,
  ISchemaVersionRead,
  ITenantAppearanceRead,
  ITenantChannelRead,
} from './types';

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

/** Fábrica de una `ITenantAppearanceRead` de prueba con valores por defecto. */
function makeTenantAppearanceRead(
  overrides: Partial<ITenantAppearanceRead> = {},
): ITenantAppearanceRead {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'test-tenant',
    primary_color: '#10b981',
    accent_color: '#3b82f6',
    surface_color: '#ffffff',
    text_color: '#0f172a',
    brand_badge: 'OmniBotIA',
    logo_url: 'https://cdn.omnibotia.example/logo.png',
    font_family: 'Inter',
    version: 1,
    revision: 1,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

/** Fábrica de una `IAppearanceProposal` de prueba con valores por defecto (Fase 5). */
function makeAppearanceProposal(overrides: Partial<IAppearanceProposal> = {}): IAppearanceProposal {
  return {
    primary_color: '#0055AA',
    accent_color: '#FF6600',
    surface_color: '#F5F5F5',
    text_color: '#111111',
    brand_badge: '#FF6600',
    logo_url: 'https://brand.example.com/logo-brand.png',
    font_family: 'Open Sans',
    detected_fonts: ['Open Sans', 'Roboto'],
    ...overrides,
  };
}

/** Fábrica de una `IRebrandingConfigRead` de prueba con valores por defecto (Fase 5). */
function makeRebrandingConfig(
  overrides: Partial<IRebrandingConfigRead> = {},
): IRebrandingConfigRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: 'test-tenant',
    name: 'Marca',
    url: 'https://brand.example.com',
    extracted: { ...makeAppearanceProposal() },
    version: 1,
    revision: 1,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    deleted: false,
    applied_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de una `IContentItemRead` de prueba con valores por defecto. */
function makeContentItemRead(overrides: Partial<IContentItemRead> = {}): IContentItemRead {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: 'test-tenant',
    kind: 'faq',
    title: '¿Cómo funcionan los envíos?',
    content: 'Respuesta de prueba',
    tags: ['ventas'],
    version: 1,
    revision: 1,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

/** Fábrica de una `ICatalogItemRead` de prueba con valores por defecto. */
function makeCatalogItemRead(overrides: Partial<ICatalogItemRead> = {}): ICatalogItemRead {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'test-tenant',
    sku: 'SKU-001',
    name: 'Consultoría OmniBotIA',
    description: null,
    price: 99.9,
    currency: 'usd',
    available: true,
    metadata: { featured: true },
    version: 1,
    revision: 1,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

/** Fábrica de una `ITenantChannelRead` de prueba con valores por defecto. */
function makeChannelRead(overrides: Partial<ITenantChannelRead> = {}): ITenantChannelRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'test-tenant',
    channel_type: 'whatsapp',
    external_id: null,
    phone_number: '+521234567890',
    phone_number_id: null,
    enabled: true,
    revision: 1,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

/** Fábrica de una `IAdCampaignRead` de prueba (C-1, eslabón ①). */
function makeAdCampaign(overrides: Partial<IAdCampaignRead> = {}): IAdCampaignRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: 'test-tenant',
    name: 'Casa vista al lago Tequesquitengo',
    status: 'active',
    enabled: true,
    utm_source: 'meta',
    utm_medium: 'cpc',
    utm_campaign: 'tequesquitengo-lago',
    utm_content: null,
    utm_term: null,
    landing_id: null,
    budget_minor: null,
    start_at: null,
    end_at: null,
    notes: null,
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
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
    // El contexto de tenant es un singleton de módulo: se limpia entre pruebas
    // para que el cliente degrade al tenant de construcción (config).
    resetActiveTenant();
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

  it('lee el tenant activo en tiempo de petición cuando se fija en runtime', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 });

    // Se fija un tenant activo en runtime (selector FASE D): el cliente debe
    // usar ese tenant en lugar del de construcción para todas las llamadas.
    setActiveTenant({ slug: 'escobar', id: 'escobar' });
    await client.listLandings();

    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'escobar' });
  });

  it('lista los tenants disponibles sin cabecera de tenant (control plane)', async () => {
    handler = () =>
      jsonResponse(200, [
        { id: 't-1', slug: 'dev-tenant', name: 'Dev Tenant', created_at: '', revision: 0, updated_at: '' },
        { id: 't-2', slug: 'escobar', name: 'Escobar', created_at: '', revision: 0, updated_at: '' },
      ]);

    const result = await client.listTenants();

    expect(result).toHaveLength(2);
    expect(result[1].slug).toBe('escobar');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenants');
    expect(calls[0].init?.headers).not.toHaveProperty('X-Tenant-Id');
  });

  it('crea un tenant con POST /api/v1/tenants sin cabecera de tenant (control plane)', async () => {
    handler = () =>
      jsonResponse(201, {
        id: 't-3',
        slug: 'acme',
        name: 'Acme Corp',
        created_at: '',
        revision: 0,
        updated_at: '',
      });

    const result = await client.createTenant({ slug: 'acme', name: 'Acme Corp' });

    expect(result.slug).toBe('acme');
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenants');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ slug: 'acme', name: 'Acme Corp' });
    expect(calls[0].init?.headers).not.toHaveProperty('X-Tenant-Id');
  });

  it('actualiza el nombre de un tenant con PATCH /api/v1/tenants/{slug} sin cabecera de tenant', async () => {
    handler = () =>
      jsonResponse(200, {
        id: 't-1',
        slug: 'acme',
        name: 'Acme Corp Renamed',
        created_at: '',
        revision: 1,
        updated_at: '',
      });

    const result = await client.updateTenant('acme', { name: 'Acme Corp Renamed' });

    expect(result.name).toBe('Acme Corp Renamed');
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenants/acme');
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: 'Acme Corp Renamed' });
    expect(calls[0].init?.headers).not.toHaveProperty('X-Tenant-Id');
  });

  it('elimina un tenant con DELETE /api/v1/tenants/{slug} sin cabecera de tenant (204)', async () => {
    handler = () => emptyResponse(204);

    await client.deleteTenant('acme');

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenants/acme');
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].init?.headers).not.toHaveProperty('X-Tenant-Id');
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

  it('obtiene la apariencia del tenant en GET /tenant/appearance', async () => {
    const appearance = makeTenantAppearanceRead();
    handler = () => jsonResponse(200, appearance);

    const result = await client.getTenantAppearance();

    expect(result.id).toBe(appearance.id);
    expect(result.primary_color).toBe('#10b981');
    expect(result.font_family).toBe('Inter');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenant/appearance');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('crea o reemplaza la apariencia del tenant con PUT /tenant/appearance', async () => {
    const saved = makeTenantAppearanceRead({ primary_color: '#ff0000', version: 2, revision: 2 });
    handler = () => jsonResponse(200, saved);

    const result = await client.upsertTenantAppearance({
      primary_color: '#ff0000',
      accent_color: '#3b82f6',
      surface_color: '#ffffff',
      text_color: '#0f172a',
      brand_badge: 'OmniBotIA',
      logo_url: 'https://cdn.omnibotia.example/logo.png',
      font_family: 'Roboto',
    });

    expect(result.primary_color).toBe('#ff0000');
    expect(result.version).toBe(2);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenant/appearance');
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      primary_color: '#ff0000',
      accent_color: '#3b82f6',
      surface_color: '#ffffff',
      text_color: '#0f172a',
      brand_badge: 'OmniBotIA',
      logo_url: 'https://cdn.omnibotia.example/logo.png',
      font_family: 'Roboto',
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lanza ApiHttpError cuando la apariencia del tenant aún no existe (404)', async () => {
    handler = () =>
      jsonResponse(404, {
        error: {
          code: 'tenant_appearance.not_found',
          message: 'Apariencia no encontrada',
          status_code: 404,
        },
      });

    const error = await client.getTenantAppearance().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiHttpError);
    const apiError = error as ApiHttpError;
    expect(apiError.status).toBe(404);
    expect(apiError.operation).toBe('tenant.appearance.get');
    expect(apiError.message).toBe('Apariencia no encontrada');
  });

  it('extrae una propuesta de estilos desde una URL de marca con POST /tenant/appearance/extract-url', async () => {
    const proposal = makeAppearanceProposal();
    handler = () => jsonResponse(200, proposal);

    const result = await client.extractUrlStyles('https://brand.example.com');

    expect(result.primary_color).toBe('#0055AA');
    expect(result.detected_fonts).toEqual(['Open Sans', 'Roboto']);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenant/appearance/extract-url');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      url: 'https://brand.example.com',
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista las configuraciones de rebranding en GET /tenant/appearance/rebranding', async () => {
    const configs = [makeRebrandingConfig()];
    handler = () => jsonResponse(200, configs);

    const result = await client.listRebrandingConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Marca');
    expect(result[0].applied_at).toBe('2026-08-18T00:00:00Z');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenant/appearance/rebranding');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('guarda una configuración de rebranding con POST /tenant/appearance/rebranding', async () => {
    const saved = makeRebrandingConfig({ version: 2, revision: 2 });
    handler = () => jsonResponse(201, saved);

    const result = await client.createRebrandingConfig({
      name: 'Marca',
      url: 'https://brand.example.com',
    });

    expect(result.version).toBe(2);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/tenant/appearance/rebranding');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      name: 'Marca',
      url: 'https://brand.example.com',
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('elimina una configuración de rebranding con DELETE /tenant/appearance/rebranding/{id}', async () => {
    handler = () => emptyResponse(204);

    await client.deleteRebrandingConfig('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/tenant/appearance/rebranding/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista el contenido del tenant serializando la paginación en GET /content', async () => {
    const item = makeContentItemRead();
    handler = () => jsonResponse(200, { items: [item], total: 1, page: 2, page_size: 5 });

    const result = await client.listContentItems({ page: 2, page_size: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('¿Cómo funcionan los envíos?');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/content?page=2&page_size=5');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('crea un ítem de contenido con POST /content', async () => {
    const created = makeContentItemRead();
    handler = () => jsonResponse(201, created);

    const result = await client.createContentItem({
      kind: 'faq',
      title: '¿Cómo recupero mi contraseña?',
      content: 'Ve a la sección de seguridad.',
      tags: ['cuenta'],
    });

    expect(result.id).toBe(created.id);
    expect(result.kind).toBe('faq');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/content');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      kind: 'faq',
      title: '¿Cómo recupero mi contraseña?',
      content: 'Ve a la sección de seguridad.',
      tags: ['cuenta'],
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('obtiene un ítem de contenido por su identificador en GET /content/{id}', async () => {
    const item = makeContentItemRead();
    handler = () => jsonResponse(200, item);

    const result = await client.getContentItem(item.id);

    expect(result.title).toBe('¿Cómo funcionan los envíos?');
    expect(result.tags).toEqual(['ventas']);
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/content/22222222-2222-4222-8222-222222222222',
    );
  });

  it('actualiza un ítem de contenido con PUT /content/{id}', async () => {
    const updated = makeContentItemRead({ title: 'Título actualizado', revision: 2 });
    handler = () => jsonResponse(200, updated);

    const result = await client.updateContentItem(updated.id, {
      title: 'Título actualizado',
    });

    expect(result.title).toBe('Título actualizado');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/content/22222222-2222-4222-8222-222222222222',
    );
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ title: 'Título actualizado' });
  });

  it('elimina un ítem de contenido con DELETE /content/{id}', async () => {
    handler = () => emptyResponse(204);

    await client.deleteContentItem('22222222-2222-4222-8222-222222222222');

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/content/22222222-2222-4222-8222-222222222222',
    );
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista el catálogo del tenant serializando la paginación en GET /catalog', async () => {
    const item = makeCatalogItemRead();
    handler = () => jsonResponse(200, { items: [item], total: 1, page: 1, page_size: 20 });

    const result = await client.listCatalogItems();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sku).toBe('SKU-001');
    expect(result.items[0].price).toBe(99.9);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/catalog');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('normaliza el precio decimal enviado como string por el backend (wire → number)', async () => {
    const rawItem = { ...makeCatalogItemRead(), price: '99.90' } as unknown as ICatalogItemRead;
    handler = () => jsonResponse(200, { items: [rawItem], total: 1, page: 1, page_size: 20 });

    const result = await client.listCatalogItems();

    expect(typeof result.items[0].price).toBe('number');
    expect(result.items[0].price).toBe(99.9);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/catalog');
  });

  it('degrada a 0 cuando el precio del backend no es numérico', async () => {
    const rawItem = { ...makeCatalogItemRead(), price: 'no-valido' } as unknown as ICatalogItemRead;
    handler = () => jsonResponse(200, { items: [rawItem], total: 1, page: 1, page_size: 20 });

    const result = await client.listCatalogItems();

    expect(result.items[0].price).toBe(0);
  });

  it('crea un ítem del catálogo con POST /catalog', async () => {
    const created = makeCatalogItemRead({ sku: 'SKU-002', name: 'Soporte Premium' });
    handler = () => jsonResponse(201, created);

    const result = await client.createCatalogItem({
      sku: 'SKU-002',
      name: 'Soporte Premium',
      price: 149.9,
      currency: 'MXN',
    });

    expect(result.sku).toBe('SKU-002');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/catalog');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      sku: 'SKU-002',
      name: 'Soporte Premium',
      price: 149.9,
      currency: 'MXN',
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('obtiene un ítem del catálogo por su identificador en GET /catalog/{id}', async () => {
    const item = makeCatalogItemRead();
    handler = () => jsonResponse(200, item);

    const result = await client.getCatalogItem(item.id);

    expect(result.name).toBe('Consultoría OmniBotIA');
    expect(result.available).toBe(true);
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/catalog/33333333-3333-4333-8333-333333333333',
    );
  });

  it('actualiza un ítem del catálogo con PUT /catalog/{id}', async () => {
    const updated = makeCatalogItemRead({ name: 'Consultoría Premium', price: 129.9, revision: 2 });
    handler = () => jsonResponse(200, updated);

    const result = await client.updateCatalogItem(updated.id, {
      name: 'Consultoría Premium',
      price: 129.9,
    });

    expect(result.name).toBe('Consultoría Premium');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/catalog/33333333-3333-4333-8333-333333333333',
    );
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      name: 'Consultoría Premium',
      price: 129.9,
    });
  });

  it('elimina un ítem del catálogo con DELETE /catalog/{id}', async () => {
    handler = () => emptyResponse(204);

    await client.deleteCatalogItem('33333333-3333-4333-8333-333333333333');

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/catalog/33333333-3333-4333-8333-333333333333',
    );
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista los canales del bot serializando la paginación en GET /channels', async () => {
    const channel = makeChannelRead();
    handler = () => jsonResponse(200, { items: [channel], total: 1, page: 1, page_size: 20 });

    const result = await client.listChannels();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].phone_number).toBe('+521234567890');
    expect(result.items[0].enabled).toBe(true);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/channels');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('crea un canal de WhatsApp con POST /channels enviando los secretos write-only', async () => {
    const created = makeChannelRead({ phone_number: '5215512345678' });
    handler = () => jsonResponse(201, created);

    const result = await client.createChannel({
      phone_number: '5215512345678',
      external_id: 'wa-123',
      phone_number_id: '10293847561234567',
      access_token: 'EAAG123',
      webhook_secret: 'secret',
      enabled: true,
    });

    expect(result.phone_number).toBe('5215512345678');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/channels');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      phone_number: '5215512345678',
      external_id: 'wa-123',
      phone_number_id: '10293847561234567',
      access_token: 'EAAG123',
      webhook_secret: 'secret',
      enabled: true,
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('obtiene un canal por su identificador en GET /channels/{id}', async () => {
    const channel = makeChannelRead();
    handler = () => jsonResponse(200, channel);

    const result = await client.getChannel(channel.id);

    expect(result.channel_type).toBe('whatsapp');
    expect(result.external_id).toBeNull();
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/channels/44444444-4444-4444-8444-444444444444',
    );
  });

  it('actualiza parcialmente un canal con PATCH /channels/{id}', async () => {
    const updated = makeChannelRead({ enabled: false, revision: 2 });
    handler = () => jsonResponse(200, updated);

    const result = await client.updateChannel(updated.id, { enabled: false });

    expect(result.enabled).toBe(false);
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/channels/44444444-4444-4444-8444-444444444444',
    );
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ enabled: false });
  });

  it('elimina un canal con DELETE /channels/{id}', async () => {
    handler = () => emptyResponse(204);

    await client.deleteChannel('44444444-4444-4444-8444-444444444444');

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/channels/44444444-4444-4444-8444-444444444444',
    );
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista las conversaciones del bot en GET /bot/conversations', async () => {
    const conversation = {
      id: '66666666-6666-4666-8666-666666666666',
      tenant_id: 'test-tenant',
      channel_id: '44444444-4444-4444-8444-444444444444',
      external_contact_id: '5215512345678',
      state: 'new',
      last_message_at: '2026-08-19T00:00:00Z',
      revision: 1,
      updated_at: '2026-08-19T00:00:00Z',
      deleted: false,
      created_at: '2026-08-19T00:00:00Z',
    };
    handler = () => jsonResponse(200, { items: [conversation], total: 1, page: 1, page_size: 20 });

    const result = await client.listConversations();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].external_contact_id).toBe('5215512345678');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/bot/conversations');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('serializa la paginación de conversaciones en la query string', async () => {
    handler = () => jsonResponse(200, { items: [], total: 0, page: 2, page_size: 10 });

    await client.listConversations({ page: 2, page_size: 10 });

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/bot/conversations?page=2&page_size=10',
    );
  });

  it('lista los mensajes de una conversación en GET /bot/conversations/{id}/messages', async () => {
    const message = {
      id: '77777777-7777-4777-8777-777777777777',
      tenant_id: 'test-tenant',
      conversation_id: '66666666-6666-4666-8666-666666666666',
      direction: 'inbound',
      content: 'Hola',
      provider_used: null,
      tokens_used: 0,
      message_id: null,
      queue_status: 'processed',
      revision: 1,
      updated_at: '2026-08-19T00:00:00Z',
      deleted: false,
      created_at: '2026-08-19T00:00:00Z',
    };
    handler = () => jsonResponse(200, { items: [message], total: 1, page: 1, page_size: 20 });

    const result = await client.listConversationMessages(message.conversation_id, {
      page: 1,
    });

    expect(result.items[0].content).toBe('Hola');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/bot/conversations/66666666-6666-4666-8666-666666666666/messages?page=1',
    );
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('envía un mensaje de prueba con POST /bot/conversations/{id}/messages', async () => {
    const result = {
      message_id: 'm-1',
      conversation_id: '66666666-6666-4666-8666-666666666666',
      direction: 'outbound',
      queue_status: 'pending',
      accepted: true,
    };
    handler = () => jsonResponse(202, result);

    const enqueued = await client.sendConversationMessage('66666666-6666-4666-8666-666666666666', {
      content: 'Hola mundo',
    });

    expect(enqueued.accepted).toBe(true);
    expect(enqueued.queue_status).toBe('pending');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/bot/conversations/66666666-6666-4666-8666-666666666666/messages',
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ content: 'Hola mundo' });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista los proveedores de IA del tenant en GET /bot/providers', async () => {
    const provider = {
      id: '55555555-5555-4555-8555-555555555555',
      tenant_id: 'test-tenant',
      provider_kind: 'openai',
      order: 0,
      enabled: true,
      model: null,
      temperature: null,
      prompt_base: '',
      revision: 1,
      updated_at: '2026-08-19T00:00:00Z',
      deleted: false,
    };
    handler = () => jsonResponse(200, [provider]);

    const result = await client.listBotProviders();

    expect(result).toHaveLength(1);
    expect(result[0].provider_kind).toBe('openai');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/bot/providers');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('crea o reemplaza un proveedor de IA con PUT /bot/providers', async () => {
    const saved = {
      id: '55555555-5555-4555-8555-555555555555',
      tenant_id: 'test-tenant',
      provider_kind: 'deepseek',
      order: 1,
      enabled: true,
      model: 'deepseek-chat',
      temperature: '0.3',
      prompt_base: 'Eres el asistente de la empresa.',
      revision: 2,
      updated_at: '2026-08-19T00:00:00Z',
      deleted: false,
    };
    handler = () => jsonResponse(200, saved);

    const result = await client.upsertBotProvider({
      provider_kind: 'deepseek',
      order: 1,
      enabled: true,
      model: 'deepseek-chat',
      temperature: '0.3',
      prompt_base: 'Eres el asistente de la empresa.',
    });

    expect(result.provider_kind).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/bot/providers');
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      provider_kind: 'deepseek',
      order: 1,
      enabled: true,
      model: 'deepseek-chat',
      temperature: '0.3',
      prompt_base: 'Eres el asistente de la empresa.',
    });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('elimina un proveedor de IA con DELETE /bot/providers/{provider_kind}/{order}', async () => {
    handler = () => emptyResponse(204);

    await client.deleteBotProvider('openai', 0);

    expect(calls[0].input).toBe('http://localhost:8000/api/v1/bot/providers/openai/0');
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('obtiene las estadísticas de la cola D3 en GET /bot/queue/tenant-stats', async () => {
    const stats = {
      tenant_id: 'test-tenant',
      stream: 'd3:test-tenant',
      length: 3,
      pending: 1,
      consumer_lag: null,
      dlq_count: 0,
      enqueued: 12,
      processed: 9,
      failed: 0,
    };
    handler = () => jsonResponse(200, stats);

    const result = await client.getBotQueueStats();

    expect(result.length).toBe(3);
    expect(result.processed).toBe(9);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/bot/queue/tenant-stats');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('prueba el router del bot en POST /bot/router/test', async () => {
    const trace = {
      matched_route: 'keyword',
      branch: 'keyword',
      keyword: 'servicio',
      keyword_priority: 100,
      intent: null,
      response: 'Ofrecemos servicios de consultoría.',
      confidence: 1,
      steps: [{ order: 0, branch: 'keyword', outcome: 'matched', detail: 'Coincide la keyword.' }],
    };
    handler = () => jsonResponse(200, trace);

    const result = await client.testRouter('Necesito servicio');

    expect(result.matched_route).toBe('keyword');
    expect(result.steps).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/bot/router/test');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ message: 'Necesito servicio' });
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('lista las campañas publicitarias serializando la paginación en GET /ads', async () => {
    handler = () =>
      jsonResponse(200, {
        items: [makeAdCampaign()],
        total: 1,
        page: 2,
        page_size: 5,
      });

    const result = await client.listAdCampaigns({ page: 2, page_size: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Casa vista al lago Tequesquitengo');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/ads?page=2&page_size=5');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('crea una campaña publicitaria con POST /ads enviando el payload UTM', async () => {
    handler = () => jsonResponse(201, makeAdCampaign());

    const result = await client.createAdCampaign({
      name: 'Casa vista al lago Tequesquitengo',
      status: 'active',
      enabled: true,
      utm_source: 'meta',
      utm_medium: 'cpc',
      utm_campaign: 'tequesquitengo-lago',
    });

    expect(result.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/ads');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
    expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
      name: 'Casa vista al lago Tequesquitengo',
      utm_campaign: 'tequesquitengo-lago',
    });
  });

  it('obtiene una campaña publicitaria por su identificador en GET /ads/{id}', async () => {
    handler = () => jsonResponse(200, makeAdCampaign());

    const result = await client.getAdCampaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(result.status).toBe('active');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/ads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
  });

  it('actualiza parcialmente una campaña publicitaria con PATCH /ads/{id}', async () => {
    handler = () => jsonResponse(200, makeAdCampaign({ status: 'paused' }));

    const result = await client.updateAdCampaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      status: 'paused',
    });

    expect(result.status).toBe('paused');
    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/ads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(calls[0].init?.method).toBe('PATCH');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Tenant-Id': 'test-tenant' });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ status: 'paused' });
  });

  it('elimina una campaña publicitaria con DELETE /ads/{id} (204)', async () => {
    handler = () => emptyResponse(204);

    await client.deleteAdCampaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(calls[0].input).toBe(
      'http://localhost:8000/api/v1/ads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(calls[0].init?.method).toBe('DELETE');
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
