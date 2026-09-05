/**
 * Servicio de Tenants (control plane) — puerto + implementación.
 *
 * Contrato:
 * - `ITenantService` es el puerto consumido por la UI y el store de tenant.
 * - `BackendTenantService` implementa el puerto vía `IApiClient` (endpoints
 *   control plane `/api/v1/tenants`, sin cabecera de tenant), normalizando las
 *   respuestas del backend.
 * - La fábrica `createTenantService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type { ITenantCreate, ITenantRead, ITenantUpdate } from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de tenants (control plane). */
export interface ITenantService {
  /** Lista los tenants disponibles para el selector de runtime. */
  list(): Promise<ITenantRead[]>;
  /** Crea un tenant (control plane). */
  create(payload: ITenantCreate): Promise<ITenantRead>;
  /** Actualiza el nombre de un tenant por su slug (control plane, slug inmutable). */
  update(slug: string, payload: ITenantUpdate): Promise<ITenantRead>;
  /** Elimina (soft-delete) un tenant por su slug (control plane). */
  delete(slug: string): Promise<void>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendTenantService implements ITenantService {
  /** Nombre de la operación de listado para trazabilidad. */
  private static readonly OPERATION_LIST = 'tenant.list';
  /** Nombre de la operación de creación para trazabilidad. */
  private static readonly OPERATION_CREATE = 'tenant.create';
  /** Nombre de la operación de actualización para trazabilidad. */
  private static readonly OPERATION_UPDATE = 'tenant.update';
  /** Nombre de la operación de eliminación para trazabilidad. */
  private static readonly OPERATION_DELETE = 'tenant.delete';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Lista los tenants disponibles (control plane, sin cabecera de tenant).
   * @returns Lista de tenants activos.
   */
  public async list(): Promise<ITenantRead[]> {
    this.logger?.info(BackendTenantService.OPERATION_LIST);
    return this.apiClient.listTenants();
  }

  /**
   * Crea un tenant (control plane, sin cabecera de tenant).
   * @param payload - Slug y nombre del nuevo tenant.
   * @returns El tenant creado.
   */
  public async create(payload: ITenantCreate): Promise<ITenantRead> {
    this.logger?.info(BackendTenantService.OPERATION_CREATE, { slug: payload.slug });
    return this.apiClient.createTenant(payload);
  }

  /**
   * Actualiza el nombre de un tenant por su slug (control plane, slug inmutable).
   * @param slug - Slug del tenant a actualizar.
   * @param payload - Nuevo nombre del tenant.
   * @returns El tenant actualizado.
   */
  public async update(slug: string, payload: ITenantUpdate): Promise<ITenantRead> {
    this.logger?.info(BackendTenantService.OPERATION_UPDATE, { slug });
    return this.apiClient.updateTenant(slug, payload);
  }

  /**
   * Elimina (soft-delete) un tenant por su slug (control plane).
   * @param slug - Slug del tenant a eliminar.
   */
  public async delete(slug: string): Promise<void> {
    this.logger?.info(BackendTenantService.OPERATION_DELETE, { slug });
    await this.apiClient.deleteTenant(slug);
  }
}

/**
 * Crea un servicio de tenants listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `ITenantService`.
 */
export function createTenantService(apiClient: IApiClient, logger?: ILogger): ITenantService {
  return new BackendTenantService(apiClient, logger);
}
