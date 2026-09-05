/**
 * Servicio de captación publicitaria (C-1, eslabón ① del ciclo comercial) —
 * puerto + implementación.
 *
 * Contrato:
 * - `IAdsService` es el puerto consumido por la UI y el store de captación.
 * - `BackendAdsService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case) y
 *   aplicando los valores por defecto del contrato (`status='active'`,
 *   `enabled=true`).
 * - `updateAdCampaign` traduce únicamente los campos presentes (PATCH).
 * - La fábrica `createAdsService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  IAdCampaignCreate,
  IAdCampaignRead,
  IAdCampaignUpdate,
  IPage,
  IPageQuery,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Entrada de dominio para crear o actualizar una campaña publicitaria (C-1). */
export interface IAdCampaignInput {
  /** Nombre de la campaña (1-255 caracteres, obligatorio). */
  name: string;
  /** Estado por defecto (`active`). */
  status?: string;
  /** Indica si la campaña participa en la atribución UTM (por defecto `true`). */
  enabled?: boolean;
  /** Origen UTM (p. ej. `meta`, `google`). */
  utmSource?: string;
  /** Medio UTM (p. ej. `cpc`, `cpm`). */
  utmMedium?: string;
  /** Campaña UTM (p. ej. `tequesquitengo-lago`). */
  utmCampaign?: string;
  /** Contenido UTM (variante creativa, opcional). */
  utmContent?: string;
  /** Término UTM (palabra clave, opcional). */
  utmTerm?: string;
  /** Landing asociada (opcional). */
  landingId?: string;
  /** Presupuesto en unidades menores (>= 0, opcional). */
  budgetMinor?: number;
  /** Inicio programado (ISO 8601, opcional). */
  startAt?: string;
  /** Fin programado (ISO 8601, opcional). */
  endAt?: string;
  /** Notas internas (máx. 4000 caracteres, opcional). */
  notes?: string;
}

/** Puerto de captación publicitaria consumido por la UI (C-1, eslabón ①). */
export interface IAdsService {
  /** Lista las campañas publicitarias del tenant activo (paginado). */
  listAdCampaigns(query?: IPageQuery): Promise<IPage<IAdCampaignRead>>;
  /** Crea una campaña publicitaria traduciendo el input de dominio al DTO. */
  createAdCampaign(input: IAdCampaignInput): Promise<IAdCampaignRead>;
  /** Devuelve una campaña publicitaria del tenant activo por su identificador. */
  getAdCampaign(adCampaignId: string): Promise<IAdCampaignRead>;
  /**
   * Actualiza parcialmente una campaña publicitaria traduciendo solo los
   * campos presentes (PATCH).
   */
  updateAdCampaign(
    adCampaignId: string,
    input: Partial<IAdCampaignInput>,
  ): Promise<IAdCampaignRead>;
  /** Elimina lógicamente una campaña publicitaria del tenant activo. */
  deleteAdCampaign(adCampaignId: string): Promise<void>;
}

/** Implementación del puerto `IAdsService` vía `IApiClient` (DI). */
export class BackendAdsService implements IAdsService {
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /** Lista las campañas publicitarias del tenant (paginado). */
  public async listAdCampaigns(query?: IPageQuery): Promise<IPage<IAdCampaignRead>> {
    this.logger?.debug('ads.campaigns.list', {});
    return this.apiClient.listAdCampaigns(query);
  }

  /** Crea una campaña traduciendo el input de dominio al DTO del backend. */
  public async createAdCampaign(input: IAdCampaignInput): Promise<IAdCampaignRead> {
    this.logger?.debug('ads.campaigns.create', { name: input.name });
    const payload: IAdCampaignCreate = {
      name: input.name,
      status: input.status ?? 'active',
      enabled: input.enabled ?? true,
      utm_source: input.utmSource ?? undefined,
      utm_medium: input.utmMedium ?? undefined,
      utm_campaign: input.utmCampaign ?? undefined,
      utm_content: input.utmContent ?? undefined,
      utm_term: input.utmTerm ?? undefined,
      landing_id: input.landingId ?? undefined,
      budget_minor: input.budgetMinor ?? undefined,
      start_at: input.startAt ?? undefined,
      end_at: input.endAt ?? undefined,
      notes: input.notes ?? undefined,
    };
    return this.apiClient.createAdCampaign(payload);
  }

  /** Devuelve una campaña del tenant por su identificador. */
  public async getAdCampaign(adCampaignId: string): Promise<IAdCampaignRead> {
    this.logger?.debug('ads.campaigns.get', { adCampaignId });
    return this.apiClient.getAdCampaign(adCampaignId);
  }

  /** Actualiza una campaña traduciendo solo los campos presentes (PATCH). */
  public async updateAdCampaign(
    adCampaignId: string,
    input: Partial<IAdCampaignInput>,
  ): Promise<IAdCampaignRead> {
    this.logger?.debug('ads.campaigns.update', { adCampaignId });
    const payload: IAdCampaignUpdate = {};
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.status !== undefined) {
      payload.status = input.status;
    }
    if (input.enabled !== undefined) {
      payload.enabled = input.enabled;
    }
    if (input.utmSource !== undefined) {
      payload.utm_source = input.utmSource;
    }
    if (input.utmMedium !== undefined) {
      payload.utm_medium = input.utmMedium;
    }
    if (input.utmCampaign !== undefined) {
      payload.utm_campaign = input.utmCampaign;
    }
    if (input.utmContent !== undefined) {
      payload.utm_content = input.utmContent;
    }
    if (input.utmTerm !== undefined) {
      payload.utm_term = input.utmTerm;
    }
    if (input.landingId !== undefined) {
      payload.landing_id = input.landingId;
    }
    if (input.budgetMinor !== undefined) {
      payload.budget_minor = input.budgetMinor;
    }
    if (input.startAt !== undefined) {
      payload.start_at = input.startAt;
    }
    if (input.endAt !== undefined) {
      payload.end_at = input.endAt;
    }
    if (input.notes !== undefined) {
      payload.notes = input.notes;
    }
    return this.apiClient.updateAdCampaign(adCampaignId, payload);
  }

  /** Elimina lógicamente una campaña del tenant. */
  public async deleteAdCampaign(adCampaignId: string): Promise<void> {
    this.logger?.debug('ads.campaigns.delete', { adCampaignId });
    await this.apiClient.deleteAdCampaign(adCampaignId);
  }
}

/**
 * Crea un servicio de captación publicitaria listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IAdsService`.
 */
export function createAdsService(apiClient: IApiClient, logger?: ILogger): IAdsService {
  return new BackendAdsService(apiClient, logger);
}
