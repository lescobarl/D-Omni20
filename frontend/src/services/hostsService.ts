/**
 * Servicio de dominios personalizados (PSEO hosts) — puerto + implementación.
 *
 * Contrato:
 * - `IPseoHostService` es el puerto consumido por la UI y el store de dominios.
 * - `BackendPseoHostService` implementa el puerto vía `IApiClient`, traduciendo el
 *   input de dominio (`{ host }`) al DTO del backend (`IPseoHostRequest`). No hay
 *   traducción camelCase ↔ snake_case adicional porque el único campo del payload
 *   (`host`) mantiene el mismo nombre en ambos lados.
 * - El backend devuelve `GET /pseo/hosts` como un **arreglo plano**
 *   (`list[PseoHostRead]`, NO paginado), por lo que `listPseoHosts` no acepta
 *   `IPageQuery` y devuelve directamente `IPseoHostRead[]`.
 * - Solo los hosts con `status === 'active'` se sirven públicamente; la UI muestra
 *   el token de verificación TXT (`_omni2-verify.{host}`) para los pendientes.
 * - La fábrica `createPseoHostService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type { IPseoHostRead, IPseoHostRequest } from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Entrada de dominio para registrar un dominio personalizado (PSEO hosts). */
export interface IPseoHostInput {
  /** Dominio personalizado a registrar (p. ej. `portal.miempresa.com`). */
  host: string;
}

/** Puerto de dominios personalizados consumido por la UI (PSEO hosts). */
export interface IPseoHostService {
  /** Lista los dominios personalizados del tenant activo (arreglo plano, sin paginar). */
  listPseoHosts(): Promise<IPseoHostRead[]>;
  /** Registra un dominio personalizado traduciendo el input de dominio al DTO. */
  requestPseoHost(input: IPseoHostInput): Promise<IPseoHostRead>;
  /** Verifica la propiedad DNS de un dominio y lo activa (idempotente). */
  verifyPseoHost(hostId: string): Promise<IPseoHostRead>;
  /** Elimina lógicamente un dominio personalizado del tenant activo. */
  deletePseoHost(hostId: string): Promise<void>;
}

/** Implementación del puerto `IPseoHostService` vía `IApiClient` (DI). */
export class BackendPseoHostService implements IPseoHostService {
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /** Lista los dominios personalizados del tenant (arreglo plano). */
  public async listPseoHosts(): Promise<IPseoHostRead[]> {
    this.logger?.debug('pseo.hosts.list', {});
    return this.apiClient.listPseoHosts();
  }

  /** Registra un dominio traduciendo el input de dominio al DTO del backend. */
  public async requestPseoHost(input: IPseoHostInput): Promise<IPseoHostRead> {
    this.logger?.debug('pseo.hosts.request', { host: input.host });
    const payload: IPseoHostRequest = { host: input.host };
    return this.apiClient.requestPseoHost(payload);
  }

  /** Verifica la propiedad DNS de un dominio y lo activa (idempotente). */
  public async verifyPseoHost(hostId: string): Promise<IPseoHostRead> {
    this.logger?.debug('pseo.hosts.verify', { hostId });
    return this.apiClient.verifyPseoHost(hostId);
  }

  /** Elimina lógicamente un dominio del tenant. */
  public async deletePseoHost(hostId: string): Promise<void> {
    this.logger?.debug('pseo.hosts.delete', { hostId });
    await this.apiClient.deletePseoHost(hostId);
  }
}

/**
 * Crea un servicio de dominios personalizados listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IPseoHostService`.
 */
export function createPseoHostService(apiClient: IApiClient, logger?: ILogger): IPseoHostService {
  return new BackendPseoHostService(apiClient, logger);
}
