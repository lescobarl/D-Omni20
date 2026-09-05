/**
 * Servicio de autenticación de estudio (RBAC) — puerto + implementación.
 *
 * Contrato:
 * - `IAuthService` es el puerto consumido por la UI y el `authStore`.
 * - `BackendAuthService` implementa el puerto vía `IApiClient` (endpoints
 *   `/api/v1/auth/*`, sin cabecera de tenant), normalizando las respuestas.
 * - La fábrica `createAuthService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IChangePasswordRequest,
  ILoginRequest,
  ILoginResponse,
  IMembershipRead,
  IUserRead,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de autenticación de estudio. */
export interface IAuthService {
  /** Inicia sesión con email+password; el cliente guarda el JWT. */
  login(payload: ILoginRequest): Promise<ILoginResponse>;
  /** Cierra la sesión actual invalidando el token. */
  logout(): Promise<void>;
  /** Devuelve el perfil del usuario autenticado (restauración de sesión). */
  me(): Promise<IUserRead>;
  /** Devuelve las membresías (tenant+rol) del usuario autenticado. */
  myMemberships(): Promise<IMembershipRead[]>;
  /** Cambia la contraseña del usuario autenticado. */
  changePassword(payload: IChangePasswordRequest): Promise<void>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendAuthService implements IAuthService {
  /** Nombre de la operación de login para trazabilidad. */
  private static readonly OPERATION_LOGIN = 'auth.login';
  /** Nombre de la operación de logout para trazabilidad. */
  private static readonly OPERATION_LOGOUT = 'auth.logout';
  /** Nombre de la operación de perfil para trazabilidad. */
  private static readonly OPERATION_ME = 'auth.me';
  /** Nombre de la operación de membresías para trazabilidad. */
  private static readonly OPERATION_MEMBERSHIPS = 'auth.myMemberships';
  /** Nombre de la operación de cambio de contraseña para trazabilidad. */
  private static readonly OPERATION_CHANGE_PASSWORD = 'auth.changePassword';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Inicia sesión con email+password (sin cabecera de tenant).
   * @param payload - Credenciales del usuario.
   * @returns Perfil del usuario + token de acceso.
   */
  public async login(payload: ILoginRequest): Promise<ILoginResponse> {
    this.logger?.info(BackendAuthService.OPERATION_LOGIN, { email: payload.email });
    return this.apiClient.login(payload);
  }

  /**
   * Cierra la sesión actual invalidando el token (sin cabecera de tenant).
   */
  public async logout(): Promise<void> {
    this.logger?.info(BackendAuthService.OPERATION_LOGOUT);
    await this.apiClient.logout();
  }

  /**
   * Devuelve el perfil del usuario autenticado (sin cabecera de tenant).
   * @returns Perfil del usuario.
   */
  public async me(): Promise<IUserRead> {
    this.logger?.info(BackendAuthService.OPERATION_ME);
    return this.apiClient.getMe();
  }

  /**
   * Devuelve las membresías (tenant+rol) del usuario autenticado.
   * @returns Lista de membresías.
   */
  public async myMemberships(): Promise<IMembershipRead[]> {
    this.logger?.info(BackendAuthService.OPERATION_MEMBERSHIPS);
    return this.apiClient.getMyMemberships();
  }

  /**
   * Cambia la contraseña del usuario autenticado (sin cabecera de tenant).
   * @param payload - Contraseña actual y nueva.
   */
  public async changePassword(payload: IChangePasswordRequest): Promise<void> {
    this.logger?.info(BackendAuthService.OPERATION_CHANGE_PASSWORD);
    await this.apiClient.changePassword(payload);
  }
}

/**
 * Crea un servicio de autenticación listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IAuthService`.
 */
export function createAuthService(apiClient: IApiClient, logger?: ILogger): IAuthService {
  return new BackendAuthService(apiClient, logger);
}
