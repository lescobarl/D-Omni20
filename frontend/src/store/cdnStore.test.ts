/**
 * Pruebas del store de Despliegue al CDN.
 *
 * Contrato:
 * - `deploy` ejecuta el despliegue de la landing vía el servicio registrado.
 * - Sin servicio registrado, `deploy` degrada a error explicado de forma accesible.
 * - Propaga los mensajes de `AppError`, de `Error` genéricos y usa un mensaje por defecto
 *   cuando el error no es una instancia de `Error`.
 * - `reset` descarta el despliegue y vuelve al estado inicial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICdnDeployResponse } from '@/api/types';
import { AppError } from '@/lib/errors';
import type { ICdnService } from '@/services/cdnService';
import { setCdnService, useCdnStore } from '@/store/cdnStore';

/** Fábrica de `ICdnDeployResponse` con valores por defecto. */
function makeDeployment(overrides: Partial<ICdnDeployResponse> = {}): ICdnDeployResponse {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    landing_id: '11111111-1111-4111-8111-111111111111',
    version: 1,
    url: 'https://cdn.omnibotia.example/landings/11111111-1111-4111-8111-111111111111/v1',
    status: 'deployed',
    deployed_at: '2026-08-19T00:00:00Z',
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio falso que registra llamadas y devuelve valores dados. */
function makeService(overrides: Partial<ICdnService> = {}): ICdnService {
  return {
    deploy: vi.fn<ICdnService['deploy']>().mockResolvedValue(makeDeployment()),
    ...overrides,
  };
}

describe('cdnStore', () => {
  beforeEach(() => {
    useCdnStore.getState().reset();
    setCdnService(null);
  });

  afterEach(() => {
    useCdnStore.getState().reset();
    setCdnService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useCdnStore.getState();
    expect(state.deployment).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });

  it('despliega la landing y guarda la respuesta', async () => {
    const deployment = makeDeployment();
    setCdnService(
      makeService({
        deploy: vi.fn<ICdnService['deploy']>().mockResolvedValue(deployment),
      }),
    );

    await useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');

    const state = useCdnStore.getState();
    expect(state.deployment).toEqual(deployment);
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
  });

  it('pasa a loading mientras el despliegue está pendiente', async () => {
    let resolve!: (value: ICdnDeployResponse) => void;
    const deploy = vi
      .fn<ICdnService['deploy']>()
      .mockImplementation(() => new Promise<ICdnDeployResponse>((res) => (resolve = res)));
    setCdnService(makeService({ deploy }));

    const pending = useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');

    expect(useCdnStore.getState().status).toBe('loading');

    resolve(makeDeployment());
    await pending;

    expect(useCdnStore.getState().status).toBe('success');
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setCdnService(null);

    await useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');

    expect(useCdnStore.getState().status).toBe('error');
    expect(useCdnStore.getState().error).toBe('El despliegue al CDN no está disponible.');
  });

  it('propaga el mensaje de un AppError del servicio', async () => {
    const deploy = vi
      .fn<ICdnService['deploy']>()
      .mockRejectedValue(new AppError('CDN no disponible', 'cdn.deploy', { reason: 'timeout' }));
    setCdnService(makeService({ deploy }));

    await useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');

    expect(useCdnStore.getState().status).toBe('error');
    expect(useCdnStore.getState().error).toBe('CDN no disponible');
  });

  it('propaga el mensaje de un Error genérico del servicio', async () => {
    const deploy = vi
      .fn<ICdnService['deploy']>()
      .mockRejectedValue(new Error('Servicio no disponible'));
    setCdnService(makeService({ deploy }));

    await useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');

    expect(useCdnStore.getState().status).toBe('error');
    expect(useCdnStore.getState().error).toBe('Servicio no disponible');
  });

  it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
    const deploy = vi.fn<ICdnService['deploy']>().mockRejectedValue('fallo desconocido');
    setCdnService(makeService({ deploy }));

    await useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');

    expect(useCdnStore.getState().status).toBe('error');
    expect(useCdnStore.getState().error).toBe(
      'No se pudo desplegar la landing. Inténtalo de nuevo.',
    );
  });

  it('reset descarta el despliegue y vuelve al estado inicial', async () => {
    const deployment = makeDeployment();
    setCdnService(
      makeService({
        deploy: vi.fn<ICdnService['deploy']>().mockResolvedValue(deployment),
      }),
    );
    await useCdnStore.getState().deploy('11111111-1111-4111-8111-111111111111');
    useCdnStore.getState().reset();

    const state = useCdnStore.getState();
    expect(state.deployment).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
  });
});
