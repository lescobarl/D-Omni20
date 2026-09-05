/**
 * Servicio de configuración del tenant para el bot — puerto + implementación (Fase 2).
 *
 * Contrato:
 * - `ITenantConfigService` es el puerto consumido por la UI y el store de configuración.
 * - `BackendTenantConfigService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case).
 * - `getTenantAppearance()` devuelve `null` cuando el tenant no ha configurado apariencia
 *   (HTTP 404) para que la UI aplique la paleta por defecto sin romper el flujo.
 * - La fábrica `createTenantConfigService` es el punto de inyección (composition root).
 */
import { ApiHttpError } from '@/api/errors';
import type { IApiClient } from '@/api/client';
import type {
  IChannelType,
  ICatalogItemCreate,
  ICatalogItemRead,
  ICatalogItemUpdate,
  IContentItemCreate,
  IContentItemRead,
  IContentItemUpdate,
  IContentKind,
  IPage,
  IPageQuery,
  ITenantAppearanceRead,
  ITenantAppearanceUpsert,
  ITenantChannelCreate,
  ITenantChannelRead,
  ITenantChannelUpdate,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';
import type { IAppTheme } from '@/types/config';

/** Entrada de dominio para crear o actualizar un ítem de contenido del bot. */
export interface IContentItemInput {
  /** Tipo de contenido (faq, documento, regla o producto). */
  kind: IContentKind;
  /** Título del ítem de contenido. */
  title: string;
  /** Cuerpo o respuesta del ítem de contenido. */
  content?: string;
  /** Etiquetas opcionales para clasificar el contenido. */
  tags?: string[];
}

/** Entrada de dominio para crear o actualizar un ítem del catálogo del tenant. */
export interface ICatalogItemInput {
  /** SKU único del ítem dentro del tenant. */
  sku: string;
  /** Nombre público del producto o servicio. */
  name: string;
  /** Descripción opcional del producto o servicio. */
  description?: string;
  /** Precio del ítem (el backend lo maneja como `Decimal` → número JSON). */
  price: number;
  /** Moneda ISO 4217 por defecto (`usd`). */
  currency?: string;
  /** Disponibilidad del ítem por defecto (`true`). */
  available?: boolean;
  /** Metadatos libres del ítem. */
  metadata?: Record<string, unknown>;
}

/** Entrada de dominio para crear o actualizar un canal del bot del tenant. */
export interface ITenantChannelInput {
  /** Tipo de canal por defecto (`whatsapp`). */
  channelType?: IChannelType;
  /** Identificador externo del canal (único por tenant). */
  externalId?: string;
  /** Número de teléfono del canal en formato internacional. */
  phoneNumber: string;
  /** Identificador del número en la plataforma del proveedor. */
  phoneNumberId?: string;
  /** Token de acceso (write-only: nunca se devuelve en lecturas). */
  accessToken?: string;
  /** Secreto del webhook (write-only: nunca se devuelve en lecturas). */
  webhookSecret?: string;
  /** Estado habilitado del canal por defecto (`true`). */
  enabled?: boolean;
}

/** Contrato del servicio de configuración del tenant para el bot. */
export interface ITenantConfigService {
  /** Devuelve la apariencia del tenant o `null` si aún no está configurada (404). */
  getTenantAppearance(): Promise<IAppTheme | null>;
  /** Crea o reemplaza la apariencia del tenant (una fila por tenant, PUT idempotente). */
  saveTenantAppearance(theme: IAppTheme): Promise<ITenantAppearanceRead>;
  /** Lista el contenido estructurado del tenant (paginado). */
  listContentItems(query?: IPageQuery): Promise<IPage<IContentItemRead>>;
  /** Crea un ítem de contenido en el tenant activo. */
  createContentItem(input: IContentItemInput): Promise<IContentItemRead>;
  /** Devuelve un ítem de contenido del tenant por su identificador. */
  getContentItem(itemId: string): Promise<IContentItemRead>;
  /** Actualiza un ítem de contenido del tenant (PUT). */
  updateContentItem(itemId: string, input: Partial<IContentItemInput>): Promise<IContentItemRead>;
  /** Elimina lógicamente un ítem de contenido del tenant. */
  deleteContentItem(itemId: string): Promise<void>;
  /** Lista el catálogo del tenant (paginado). */
  listCatalogItems(query?: IPageQuery): Promise<IPage<ICatalogItemRead>>;
  /** Crea un ítem del catálogo en el tenant (SKU único por tenant). */
  createCatalogItem(input: ICatalogItemInput): Promise<ICatalogItemRead>;
  /** Devuelve un ítem del catálogo del tenant por su identificador. */
  getCatalogItem(itemId: string): Promise<ICatalogItemRead>;
  /** Actualiza un ítem del catálogo del tenant (PUT). */
  updateCatalogItem(itemId: string, input: Partial<ICatalogItemInput>): Promise<ICatalogItemRead>;
  /** Elimina lógicamente un ítem del catálogo del tenant. */
  deleteCatalogItem(itemId: string): Promise<void>;
  /** Lista los canales del bot del tenant (paginado, sin secretos). */
  listChannels(query?: IPageQuery): Promise<IPage<ITenantChannelRead>>;
  /** Crea un canal del bot en el tenant (secretos write-only). */
  createChannel(input: ITenantChannelInput): Promise<ITenantChannelRead>;
  /** Devuelve un canal del tenant por su identificador (sin secretos). */
  getChannel(channelId: string): Promise<ITenantChannelRead>;
  /** Actualiza parcialmente un canal del tenant (PATCH). */
  updateChannel(
    channelId: string,
    input: Partial<ITenantChannelInput>,
  ): Promise<ITenantChannelRead>;
  /** Elimina lógicamente un canal del tenant. */
  deleteChannel(channelId: string): Promise<void>;
}

/** Implementación del puerto de configuración del tenant sobre el cliente HTTP. */
export class BackendTenantConfigService implements ITenantConfigService {
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Devuelve la apariencia del tenant traduciendo el DTO a tema de dominio (o `null`). */
  public async getTenantAppearance(): Promise<IAppTheme | null> {
    this.logger?.debug('tenant.appearance.get', {});
    try {
      const appearance = await this.apiClient.getTenantAppearance();
      return {
        primaryColor: appearance.primary_color,
        accentColor: appearance.accent_color,
        surfaceColor: appearance.surface_color,
        textColor: appearance.text_color,
        brandBadge: appearance.brand_badge,
        logoUrl: appearance.logo_url ?? undefined,
        fontFamily: appearance.font_family ?? undefined,
      };
    } catch (error) {
      // 404 = el tenant aún no configuró apariencia; la UI aplica el tema por defecto.
      if (error instanceof ApiHttpError && error.status === 404) {
        this.logger?.info('tenant.appearance.get', { reason: 'not-configured' });
        return null;
      }
      throw error;
    }
  }

  /** Crea o reemplaza la apariencia del tenant traduciendo el tema de dominio al DTO. */
  public async saveTenantAppearance(theme: IAppTheme): Promise<ITenantAppearanceRead> {
    this.logger?.debug('tenant.appearance.upsert', { primaryColor: theme.primaryColor });
    const payload: ITenantAppearanceUpsert = {
      primary_color: theme.primaryColor,
      accent_color: theme.accentColor,
      surface_color: theme.surfaceColor,
      text_color: theme.textColor,
      brand_badge: theme.brandBadge,
      logo_url: theme.logoUrl ?? undefined,
      font_family: theme.fontFamily ?? undefined,
    };
    return this.apiClient.upsertTenantAppearance(payload);
  }

  /** Lista el contenido estructurado del tenant (paginado). */
  public async listContentItems(query?: IPageQuery): Promise<IPage<IContentItemRead>> {
    this.logger?.debug('content.list', {});
    return this.apiClient.listContentItems(query);
  }

  /** Crea un ítem de contenido traduciendo el input de dominio al DTO del backend. */
  public async createContentItem(input: IContentItemInput): Promise<IContentItemRead> {
    this.logger?.debug('content.create', { kind: input.kind, title: input.title });
    const payload: IContentItemCreate = {
      kind: input.kind,
      title: input.title,
      content: input.content ?? '',
      tags: input.tags ?? [],
    };
    return this.apiClient.createContentItem(payload);
  }

  /** Devuelve un ítem de contenido del tenant por su identificador. */
  public async getContentItem(itemId: string): Promise<IContentItemRead> {
    this.logger?.debug('content.get', { itemId });
    return this.apiClient.getContentItem(itemId);
  }

  /** Actualiza un ítem de contenido traduciendo solo los campos presentes. */
  public async updateContentItem(
    itemId: string,
    input: Partial<IContentItemInput>,
  ): Promise<IContentItemRead> {
    this.logger?.debug('content.update', { itemId });
    const payload: IContentItemUpdate = {};
    if (input.kind !== undefined) {
      payload.kind = input.kind;
    }
    if (input.title !== undefined) {
      payload.title = input.title;
    }
    if (input.content !== undefined) {
      payload.content = input.content;
    }
    if (input.tags !== undefined) {
      payload.tags = input.tags;
    }
    return this.apiClient.updateContentItem(itemId, payload);
  }

  /** Elimina lógicamente un ítem de contenido del tenant. */
  public async deleteContentItem(itemId: string): Promise<void> {
    this.logger?.debug('content.delete', { itemId });
    await this.apiClient.deleteContentItem(itemId);
  }

  /** Lista el catálogo del tenant (paginado). */
  public async listCatalogItems(query?: IPageQuery): Promise<IPage<ICatalogItemRead>> {
    this.logger?.debug('catalog.list', {});
    return this.apiClient.listCatalogItems(query);
  }

  /** Crea un ítem del catálogo traduciendo el input de dominio al DTO del backend. */
  public async createCatalogItem(input: ICatalogItemInput): Promise<ICatalogItemRead> {
    this.logger?.debug('catalog.create', { sku: input.sku });
    const payload: ICatalogItemCreate = {
      sku: input.sku,
      name: input.name,
      description: input.description ?? undefined,
      price: input.price,
      currency: input.currency ?? 'usd',
      available: input.available ?? true,
      metadata: input.metadata ?? {},
    };
    return this.apiClient.createCatalogItem(payload);
  }

  /** Devuelve un ítem del catálogo del tenant por su identificador. */
  public async getCatalogItem(itemId: string): Promise<ICatalogItemRead> {
    this.logger?.debug('catalog.get', { itemId });
    return this.apiClient.getCatalogItem(itemId);
  }

  /** Actualiza un ítem del catálogo traduciendo solo los campos presentes. */
  public async updateCatalogItem(
    itemId: string,
    input: Partial<ICatalogItemInput>,
  ): Promise<ICatalogItemRead> {
    this.logger?.debug('catalog.update', { itemId });
    const payload: ICatalogItemUpdate = {};
    if (input.sku !== undefined) {
      payload.sku = input.sku;
    }
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.description !== undefined) {
      payload.description = input.description;
    }
    if (input.price !== undefined) {
      payload.price = input.price;
    }
    if (input.currency !== undefined) {
      payload.currency = input.currency;
    }
    if (input.available !== undefined) {
      payload.available = input.available;
    }
    if (input.metadata !== undefined) {
      payload.metadata = input.metadata;
    }
    return this.apiClient.updateCatalogItem(itemId, payload);
  }

  /** Elimina lógicamente un ítem del catálogo del tenant. */
  public async deleteCatalogItem(itemId: string): Promise<void> {
    this.logger?.debug('catalog.delete', { itemId });
    await this.apiClient.deleteCatalogItem(itemId);
  }

  /** Lista los canales del bot del tenant (paginado, sin secretos). */
  public async listChannels(query?: IPageQuery): Promise<IPage<ITenantChannelRead>> {
    this.logger?.debug('channels.list', {});
    return this.apiClient.listChannels(query);
  }

  /** Crea un canal del bot traduciendo el input de dominio al DTO del backend. */
  public async createChannel(input: ITenantChannelInput): Promise<ITenantChannelRead> {
    this.logger?.debug('channels.create', { phoneNumber: input.phoneNumber });
    const payload: ITenantChannelCreate = {
      channel_type: input.channelType ?? 'whatsapp',
      external_id: input.externalId ?? undefined,
      phone_number: input.phoneNumber,
      phone_number_id: input.phoneNumberId ?? undefined,
      access_token: input.accessToken ?? undefined,
      webhook_secret: input.webhookSecret ?? undefined,
      enabled: input.enabled ?? true,
    };
    return this.apiClient.createChannel(payload);
  }

  /** Devuelve un canal del tenant por su identificador (sin secretos). */
  public async getChannel(channelId: string): Promise<ITenantChannelRead> {
    this.logger?.debug('channels.get', { channelId });
    return this.apiClient.getChannel(channelId);
  }

  /** Actualiza parcialmente un canal traduciendo solo los campos presentes (PATCH). */
  public async updateChannel(
    channelId: string,
    input: Partial<ITenantChannelInput>,
  ): Promise<ITenantChannelRead> {
    this.logger?.debug('channels.update', { channelId });
    const payload: ITenantChannelUpdate = {};
    if (input.channelType !== undefined) {
      payload.channel_type = input.channelType;
    }
    if (input.externalId !== undefined) {
      payload.external_id = input.externalId;
    }
    if (input.phoneNumber !== undefined) {
      payload.phone_number = input.phoneNumber;
    }
    if (input.phoneNumberId !== undefined) {
      payload.phone_number_id = input.phoneNumberId;
    }
    if (input.accessToken !== undefined) {
      payload.access_token = input.accessToken;
    }
    if (input.webhookSecret !== undefined) {
      payload.webhook_secret = input.webhookSecret;
    }
    if (input.enabled !== undefined) {
      payload.enabled = input.enabled;
    }
    return this.apiClient.updateChannel(channelId, payload);
  }

  /** Elimina lógicamente un canal del tenant. */
  public async deleteChannel(channelId: string): Promise<void> {
    this.logger?.debug('channels.delete', { channelId });
    await this.apiClient.deleteChannel(channelId);
  }
}

/**
 * Crea un servicio de configuración del tenant listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `ITenantConfigService`.
 */
export function createTenantConfigService(
  apiClient: IApiClient,
  logger?: ILogger,
): ITenantConfigService {
  return new BackendTenantConfigService(apiClient, logger);
}
