/**
 * Servicio de Despliegue al CDN — puerto + implementación (Fase 10).
 *
 * Contrato:
 * - `ICdnService` es el puerto consumido por la UI y el store de despliegue.
 * - `BackendCdnService` implementa el puerto vía `IApiClient.deployToCdn`,
 *   normalizando la respuesta del backend (`CdnDeployResponse`).
 * - La fábrica `createCdnService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type { ICdnDeployResponse } from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de despliegue al CDN. */
export interface ICdnService {
  /** Despliega la landing del tenant activo al CDN y devuelve la URL pública. */
  deploy(landingId: string): Promise<ICdnDeployResponse>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendCdnService implements ICdnService {
  /** Nombre de la operación de despliegue al CDN para trazabilidad. */
  private static readonly OPERATION_DEPLOY = 'cdn.deploy';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Despliega la landing del tenant activo al CDN.
   * @param landingId - Identificador de la landing a desplegar.
   * @returns Respuesta con la URL pública y versión compilada.
   */
  public async deploy(landingId: string): Promise<ICdnDeployResponse> {
    this.logger?.info(BackendCdnService.OPERATION_DEPLOY, { landingId });
    return this.apiClient.deployToCdn(landingId);
  }
}

/**
 * Crea un servicio de despliegue al CDN listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `ICdnService`.
 */
export function createCdnService(apiClient: IApiClient, logger?: ILogger): ICdnService {
  return new BackendCdnService(apiClient, logger);
}
