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
import type { ILandingRead } from './types';

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
      });

    const result = await client.compileLanding({
      config: { title: 'Demo', workflowType: 'direct_checkout', blocks: [] },
    });

    expect(result.html).toContain('data-title="Demo"');
    expect(calls[0].input).toBe('http://localhost:8000/api/v1/designer/compile');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      config: { title: 'Demo', workflowType: 'direct_checkout', blocks: [] },
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
