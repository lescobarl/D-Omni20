/**
 * Servicio de Analítica Avanzada — puerto + implementación.
 *
 * Contrato:
 * - `IAnalyticsService` es el puerto consumido por la UI y el store de analítica.
 * - `BackendAnalyticsService` implementa el puerto vía `IApiClient.recordAnalyticsEvent`
 *   y `IApiClient.getAnalyticsDashboard`, normalizando el resumen del dashboard al
 *   dominio (Fase 9).
 * - La fábrica `createAnalyticsService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IAnalyticsDashboardResponse,
  IAnalyticsEventCreateRequest,
  IAnalyticsEventRead,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Contrato del servicio de analítica avanzada. */
export interface IAnalyticsService {
  /** Registra un evento de analítica en el tenant activo. */
  recordEvent(payload: IAnalyticsEventCreateRequest): Promise<IAnalyticsEventRead>;
  /** Obtiene el resumen del dashboard de analítica del tenant activo. */
  getDashboard(): Promise<IAnalyticsDashboardResponse>;
}

/** Implementación del puerto contra el backend HTTP vía `IApiClient`. */
export class BackendAnalyticsService implements IAnalyticsService {
  /** Nombre de la operación de registro de eventos para trazabilidad. */
  private static readonly OPERATION_RECORD = 'analytics.event.record';
  /** Nombre de la operación de consulta del dashboard para trazabilidad. */
  private static readonly OPERATION_DASHBOARD = 'analytics.dashboard.get';

  /**
   * @param apiClient - Cliente HTTP tipado del backend.
   * @param logger - Logger opcional (inyectado para trazabilidad).
   */
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Registra un evento de analítica en el tenant activo.
   * @param payload - Datos del evento a registrar (tipo + metadatos).
   * @returns El evento persistido con su identificador.
   */
  public async recordEvent(payload: IAnalyticsEventCreateRequest): Promise<IAnalyticsEventRead> {
    this.logger?.info(BackendAnalyticsService.OPERATION_RECORD, { eventType: payload.event_type });
    return this.apiClient.recordAnalyticsEvent(payload);
  }

  /**
   * Obtiene el resumen del dashboard de analítica del tenant activo.
   * @returns Resumen agregado (totales, desglose por tipo y eventos recientes).
   */
  public async getDashboard(): Promise<IAnalyticsDashboardResponse> {
    this.logger?.debug(BackendAnalyticsService.OPERATION_DASHBOARD, {});
    return this.apiClient.getAnalyticsDashboard();
  }
}

/**
 * Crea un servicio de analítica listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IAnalyticsService`.
 */
export function createAnalyticsService(apiClient: IApiClient, logger?: ILogger): IAnalyticsService {
  return new BackendAnalyticsService(apiClient, logger);
}
