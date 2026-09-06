/**
 * Servicio de miembros por tenant (RBAC, admin) — puerto + implementación.
 *
 * Contrato:
 * - `IMembershipService` es el puerto consumido por la UI y el store.
 * - `BackendMembershipService` implementa el puerto vía `IApiClient` (endpoints
 *   `/api/v1/members/*`, con cabecera de tenant del tenant activo).
 * - La fábrica `createMembershipService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type { IMemberAddRequest, IMembershipRead, IMembershipUpdate } from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de miembros por tenant (RBAC, admin). */
export interface IMembershipService {
  /** Lista los miembros del tenant activo. */
  list(): Promise<IMembershipRead[]>;
  /** Añade un miembro al tenant activo por email. */
  add(payload: IMemberAddRequest): Promise<IMembershipRead>;
  /** Actualiza el rol de un miembro del tenant activo. */
  update(membershipId: string, payload: IMembershipUpdate): Promise<IMembershipRead>;
  /** Elimina un miembro del tenant activo. */
  remove(membershipId: string): Promise<void>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendMembershipService implements IMembershipService {
  /** Nombre de la operación de listado para trazabilidad. */
  private static readonly OPERATION_LIST = 'members.list';
  /** Nombre de la operación de alta para trazabilidad. */
  private static readonly OPERATION_ADD = 'members.add';
  /** Nombre de la operación de actualización para trazabilidad. */
  private static readonly OPERATION_UPDATE = 'members.update';
  /** Nombre de la operación de eliminación para trazabilidad. */
  private static readonly OPERATION_REMOVE = 'members.remove';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Lista los miembros del tenant activo (con cabecera de tenant).
   * @returns Lista de membresías del tenant activo.
   */
  public async list(): Promise<IMembershipRead[]> {
    this.logger?.info(BackendMembershipService.OPERATION_LIST);
    return this.apiClient.listMembers();
  }

  /**
   * Añade un miembro al tenant activo por email (con cabecera de tenant).
   * @param payload - Email, rol y datos opcionales del nuevo miembro.
   * @returns La membresía creada.
   */
  public async add(payload: IMemberAddRequest): Promise<IMembershipRead> {
    this.logger?.info(BackendMembershipService.OPERATION_ADD, { email: payload.email });
    return this.apiClient.addMember(payload);
  }

  /**
   * Actualiza el rol de un miembro del tenant activo (con cabecera de tenant).
   * @param membershipId - Identificador de la membresía.
   * @param payload - Nuevo rol.
   * @returns La membresía actualizada.
   */
  public async update(membershipId: string, payload: IMembershipUpdate): Promise<IMembershipRead> {
    this.logger?.info(BackendMembershipService.OPERATION_UPDATE, { membershipId });
    return this.apiClient.updateMember(membershipId, payload);
  }

  /**
   * Elimina un miembro del tenant activo (con cabecera de tenant).
   * @param membershipId - Identificador de la membresía.
   */
  public async remove(membershipId: string): Promise<void> {
    this.logger?.info(BackendMembershipService.OPERATION_REMOVE, { membershipId });
    await this.apiClient.removeMember(membershipId);
  }
}

/**
 * Crea un servicio de miembros listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IMembershipService`.
 */
export function createMembershipService(
  apiClient: IApiClient,
  logger?: ILogger,
): IMembershipService {
  return new BackendMembershipService(apiClient, logger);
}
