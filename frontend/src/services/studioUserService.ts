/**
 * Servicio de usuarios de plataforma (control plane, super-admin) — puerto + implementación.
 *
 * Contrato:
 * - `IUserService` es el puerto consumido por la UI y el store de usuarios.
 * - `BackendUserService` implementa el puerto vía `IApiClient` (endpoints
 *   `/api/v1/users/*`, sin cabecera de tenant), normalizando las respuestas.
 * - La fábrica `createUserService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IMembershipCreate,
  IMembershipRead,
  IUserCreate,
  IUserRead,
  IUserUpdate,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de usuarios de plataforma (super-admin). */
export interface IUserService {
  /** Lista los usuarios de la plataforma. */
  list(): Promise<IUserRead[]>;
  /** Crea un usuario de plataforma. */
  create(payload: IUserCreate): Promise<IUserRead>;
  /** Actualiza parcialmente un usuario de plataforma. */
  update(userId: string, payload: IUserUpdate): Promise<IUserRead>;
  /** Elimina (soft-delete) un usuario de plataforma. */
  delete(userId: string): Promise<void>;
  /** Lista las membresías (tenant+rol) de un usuario. */
  listMemberships(userId: string): Promise<IMembershipRead[]>;
  /** Añade una membresía (tenant+rol) a un usuario. */
  addMembership(payload: IMembershipCreate): Promise<IMembershipRead>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendUserService implements IUserService {
  /** Nombre de la operación de listado para trazabilidad. */
  private static readonly OPERATION_LIST = 'user.list';
  /** Nombre de la operación de creación para trazabilidad. */
  private static readonly OPERATION_CREATE = 'user.create';
  /** Nombre de la operación de actualización para trazabilidad. */
  private static readonly OPERATION_UPDATE = 'user.update';
  /** Nombre de la operación de eliminación para trazabilidad. */
  private static readonly OPERATION_DELETE = 'user.delete';
  /** Nombre de la operación de membresías para trazabilidad. */
  private static readonly OPERATION_MEMBERSHIPS = 'user.memberships.list';
  /** Nombre de la operación de alta de membresía para trazabilidad. */
  private static readonly OPERATION_ADD_MEMBERSHIP = 'user.memberships.add';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Lista los usuarios de la plataforma (sin cabecera de tenant).
   * @returns Lista de usuarios.
   */
  public async list(): Promise<IUserRead[]> {
    this.logger?.info(BackendUserService.OPERATION_LIST);
    return this.apiClient.listUsers();
  }

  /**
   * Crea un usuario de plataforma (sin cabecera de tenant).
   * @param payload - Datos del nuevo usuario.
   * @returns El usuario creado.
   */
  public async create(payload: IUserCreate): Promise<IUserRead> {
    this.logger?.info(BackendUserService.OPERATION_CREATE, { email: payload.email });
    return this.apiClient.createUser(payload);
  }

  /**
   * Actualiza parcialmente un usuario de plataforma (sin cabecera de tenant).
   * @param userId - Identificador del usuario.
   * @param payload - Campos a actualizar.
   * @returns El usuario actualizado.
   */
  public async update(userId: string, payload: IUserUpdate): Promise<IUserRead> {
    this.logger?.info(BackendUserService.OPERATION_UPDATE, { userId });
    return this.apiClient.updateUser(userId, payload);
  }

  /**
   * Elimina (soft-delete) un usuario de plataforma (sin cabecera de tenant).
   * @param userId - Identificador del usuario.
   */
  public async delete(userId: string): Promise<void> {
    this.logger?.info(BackendUserService.OPERATION_DELETE, { userId });
    await this.apiClient.deleteUser(userId);
  }

  /**
   * Lista las membresías (tenant+rol) de un usuario (sin cabecera de tenant).
   * @param userId - Identificador del usuario.
   * @returns Lista de membresías.
   */
  public async listMemberships(userId: string): Promise<IMembershipRead[]> {
    this.logger?.info(BackendUserService.OPERATION_MEMBERSHIPS, { userId });
    return this.apiClient.listUserMemberships(userId);
  }

  /**
   * Añade una membresía (tenant+rol) a un usuario (sin cabecera de tenant).
   * @param payload - Usuario, tenant y rol.
   * @returns La membresía creada.
   */
  public async addMembership(payload: IMembershipCreate): Promise<IMembershipRead> {
    this.logger?.info(BackendUserService.OPERATION_ADD_MEMBERSHIP, {
      userId: payload.user_id,
      tenantId: payload.tenant_id,
    });
    return this.apiClient.addUserMembership(payload);
  }
}

/**
 * Crea un servicio de usuarios listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IUserService`.
 */
export function createUserService(apiClient: IApiClient, logger?: ILogger): IUserService {
  return new BackendUserService(apiClient, logger);
}
