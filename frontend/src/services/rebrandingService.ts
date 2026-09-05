/**
 * Servicio de rebranding por URL (Fase 5) — puerto + implementación.
 *
 * Contrato:
 * - `IRebrandingService` es el puerto consumido por la UI y el store de configuración
 *   del tenant para el flujo "Importar de URL" de apariencia/branding.
 * - `BackendRebrandingService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case).
 * - `proposalToTheme` es una función pura que traduce una propuesta de apariencia
 *   (snake_case) al tema del tenant (camelCase) rellenando los huecos con el borrador
 *   actual, de modo que "Aplicar" no pierda los valores ya configurados.
 * - La fábrica `createRebrandingService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IAppearanceProposal,
  IRebrandingConfigCreate,
  IRebrandingConfigRead,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';
import type { IAppTheme } from '@/types/config';

/** Entrada de dominio para guardar una configuración de rebranding. */
export interface IRebrandingInput {
  /** Nombre descriptivo de la configuración (p. ej. el nombre de la marca). */
  name: string;
  /**
   * URL pública de la marca de la que se extraen los estilos. Si se omite
   * (``undefined``), el backend guarda una instantánea de los estilos actuales
   * del tenant como backup (GAP 3).
   */
  url?: string;
}

/** Puerto de rebranding por URL consumido por la UI (Fase 5). */
export interface IRebrandingService {
  /** Extrae una propuesta de apariencia desde una URL de marca (sin persistir). */
  extractUrlStyles(url: string): Promise<IAppearanceProposal>;
  /** Lista las configuraciones de rebranding guardadas del tenant activo. */
  listRebrandingConfigs(): Promise<IRebrandingConfigRead[]>;
  /** Guarda una configuración de rebranding (re-extrae los estilos y los aplica). */
  createRebrandingConfig(input: IRebrandingInput): Promise<IRebrandingConfigRead>;
  /** Elimina una configuración de rebranding del tenant activo. */
  deleteRebrandingConfig(configId: string): Promise<void>;
}

/**
 * Traduce una propuesta de apariencia (snake_case del backend) al tema del tenant
 * (camelCase), usando el borrador actual como respaldo para los campos no detectados.
 * @param proposal - Propuesta devuelta por la extracción de la URL de marca.
 * @param fallback - Tema actual del tenant (los campos ausentes se conservan).
 * @returns Tema aplicable sin perder la configuración previa.
 */
export function proposalToTheme(proposal: IAppearanceProposal, fallback: IAppTheme): IAppTheme {
  return {
    primaryColor: proposal.primary_color ?? fallback.primaryColor,
    accentColor: proposal.accent_color ?? fallback.accentColor,
    surfaceColor: proposal.surface_color ?? fallback.surfaceColor,
    textColor: proposal.text_color ?? fallback.textColor,
    brandBadge: proposal.brand_badge ?? fallback.brandBadge,
    logoUrl: proposal.logo_url ?? fallback.logoUrl,
    fontFamily: proposal.font_family ?? fallback.fontFamily,
  };
}

/** Implementación del puerto de rebranding sobre el cliente HTTP tipado. */
export class BackendRebrandingService implements IRebrandingService {
  /** Cliente HTTP tipado (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger opcional para trazabilidad. */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Extrae una propuesta de apariencia desde una URL de marca (sin persistir). */
  public async extractUrlStyles(url: string): Promise<IAppearanceProposal> {
    this.logger?.debug('rebranding.extractUrlStyles', { url });
    return this.apiClient.extractUrlStyles(url);
  }

  /** Lista las configuraciones de rebranding guardadas del tenant activo. */
  public async listRebrandingConfigs(): Promise<IRebrandingConfigRead[]> {
    this.logger?.debug('rebranding.listRebrandingConfigs', {});
    return this.apiClient.listRebrandingConfigs();
  }

  /**
   * Guarda una configuración de rebranding. Si ``input.url`` se omite, el backend
   * guarda una instantánea de los estilos actuales del tenant (GAP 3).
   */
  public async createRebrandingConfig(input: IRebrandingInput): Promise<IRebrandingConfigRead> {
    this.logger?.debug('rebranding.createRebrandingConfig', { name: input.name, url: input.url });
    const payload: IRebrandingConfigCreate =
      input.url !== undefined ? { name: input.name, url: input.url } : { name: input.name };
    return this.apiClient.createRebrandingConfig(payload);
  }

  /** Elimina una configuración de rebranding del tenant activo. */
  public async deleteRebrandingConfig(configId: string): Promise<void> {
    this.logger?.debug('rebranding.deleteRebrandingConfig', { configId });
    await this.apiClient.deleteRebrandingConfig(configId);
  }
}

/**
 * Crea un servicio de rebranding listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IRebrandingService`.
 */
export function createRebrandingService(
  apiClient: IApiClient,
  logger?: ILogger,
): IRebrandingService {
  return new BackendRebrandingService(apiClient, logger);
}
