/**
 * Servicio de operación del bot (Bloque B de LAE Omni2.0) — puerto + implementación.
 *
 * Contrato:
 * - `IOperationsService` es el puerto consumido por la UI y el store de operación.
 * - `BackendOperationsService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case).
 * - `getMaintenanceConfig()` devuelve `null` cuando el tenant no tiene configuración
 *   (HTTP 404) para que la UI muestre el formulario por defecto sin romper el flujo.
 * - La fábrica `createOperationsService` es el punto de inyección (composition root).
 */
import { ApiHttpError } from '@/api/errors';
import type { IApiClient } from '@/api/client';
import type {
  IActiveConversationRead,
  IBackupMetaRead,
  ICampaignCreate,
  ICampaignRead,
  ICampaignRecipientCreate,
  ICampaignRecipientRead,
  ICampaignRecipientUpdate,
  ICampaignUpdate,
  IContactCreate,
  IContactRead,
  IContactUpdate,
  IDispatchResultRead,
  IImportResultRead,
  IIndividualSendInput,
  IMessageSendResultRead,
  IInterventionAssignRequest,
  IInterventionCloseResult,
  IInterventionCreate,
  IInterventionPendingCountRead,
  IInterventionRead,
  IInterventionReplyRequest,
  IInterventionUpdate,
  IMaintenanceActionRead,
  IMaintenanceConfigRead,
  IMaintenanceConfigUpsert,
  IMessageRead,
  IRecipientFileCreate,
  IRecipientFileDispatchInput,
  IRecipientFilePreviewRead,
  IRecipientFileRead,
  IRestoreResultRead,
  INavigationTreeCreate,
  INavigationTreeRead,
  INavigationTreeUpdate,
  IPage,
  IPageQuery,
  IPurgeRequest,
  IScheduledRunResultRead,
  IStatsOverviewRead,
  ITableStatsRead,
  ITemplateCreate,
  ITemplateRead,
  ITemplateUpdate,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Entrada de dominio para crear o actualizar un contacto del bot (B.6). */
export interface IContactInput {
  /** Teléfono del contacto en formato internacional (único por tenant). */
  phone: string;
  /** Nombre del contacto. */
  name?: string;
  /** Correo electrónico del contacto. */
  email?: string;
  /** Etiquetas para segmentar el directorio. */
  tags?: string[];
  /** Estado del contacto por defecto (`new`). */
  state?: string;
  /** Origen de la captación por defecto (`manual`). */
  source?: string;
  /** Identificador externo (p. ej. WhatsApp ID) para atribución. */
  externalContactId?: string;
  /** Última fecha de contacto (ISO 8601). */
  lastContactAt?: string;
}

/** Entrada de dominio para crear o actualizar una plantilla de mensaje (B.5). */
export interface ITemplateInput {
  /** Nombre de la plantilla (único por tenant). */
  name: string;
  /** Cuerpo del mensaje con variables ``{{ }}``. */
  body?: string;
  /** Tipo de plantilla por defecto (`text`). */
  templateType?: string;
  /** Variables declaradas en el cuerpo. */
  variables?: string[];
}

/** Entrada de dominio para crear o actualizar un árbol de navegación (B.3). */
export interface INavigationTreeInput {
  /** Nombre del árbol (único por tenant). */
  name: string;
  /** Número de opciones del menú principal. */
  numOptions?: number;
  /** Opciones del árbol (estructura libre del flujo del bot). */
  options?: Array<Record<string, unknown>>;
}

/** Entrada de dominio para crear o actualizar una campaña de envío (B.4/C-2). */
export interface ICampaignInput {
  /** Nombre de la campaña. */
  name: string;
  /** Plantilla de mensaje asociada. */
  templateId?: string;
  /** Estado por defecto (`draft`). */
  state?: string;
  /** Programación del envío (ISO 8601). */
  schedule?: string;
  /** Tipo de segmentación (C-2): `tags`, `event` o sin valor (todas las audiencias). */
  segmentType?: string;
  /** Configuración de segmentación (C-2): etiquetas o contexto del evento. */
  segmentConfig?: Record<string, unknown>;
  /** Tipo de disparo (C-2): `scheduled`, `event` o sin valor. */
  triggerType?: string;
  /** Evento de workflow que dispara la campaña (C-2). */
  triggerEvent?: string;
  /** Landing/pasarela que origina la campaña (C-2, GAP-12). */
  landingId?: string;
}

/** Entrada de dominio para añadir o actualizar un destinatario de campaña (B.4). */
export interface ICampaignRecipientInput {
  /** Contacto destinatario (único por campaña). */
  contactId: string;
  /** Estado del envío por defecto (`pending`). */
  state?: string;
  /** Resultado del envío (p. ej. `delivered`). */
  result?: string;
  /** Número de reintentos por defecto (`0`). */
  attempts?: number;
}

/** Entrada de dominio para importar contactos o destinatarios desde CSV (B.4/B.6). */
export interface ICsvImportInput {
  /** Contenido del archivo CSV (con cabecera). */
  csv: string;
  /** Delimitador de campos (por defecto `,`). */
  delimiter?: string;
}

/** Entrada de dominio para subir un archivo de destinatarios reutilizable (GAP 2). */
export interface IRecipientFileInput {
  /** Nombre legible del archivo. */
  name: string;
  /** Tipo de contenido (p. ej. `text/csv`). */
  contentType: string;
  /** Contenido del CSV crudo (con cabecera `phone` y opcionalmente `name`). */
  rawCsv: string;
  /** Metadatos de origen (delimitador, columnas detectadas, etc.). */
  sourceMeta?: Record<string, unknown>;
}

/** Entrada de dominio para crear o actualizar una intervención humana (B.7). */
export interface IInterventionInput {
  /** Conversación que requiere intervención (cola B.7 → eslabón ⑤). */
  conversationId: string;
  /** Estado por defecto (`pending`). */
  state?: string;
  /** Operador asignado. */
  operator?: string;
  /** Notas del operador. */
  notes?: string;
  /** Fecha de asignación (ISO 8601). */
  assignedAt?: string;
  /** Fecha de resolución (ISO 8601). */
  resolvedAt?: string;
}

/** Entrada de dominio para la configuración de mantenimiento (B.9). */
export interface IMaintenanceConfigInput {
  /** Reglas de retención (estructura libre). */
  retentionRules?: Record<string, unknown>;
  /** Programación del mantenimiento (p. ej. `0 3 * * *`). */
  maintenanceSchedule?: string;
}

/** Consulta de listado de intervenciones (filtro opcional por estado). */
export interface IInterventionQuery extends IPageQuery {
  /** Filtra la cola por estado (p. ej. `pending`). */
  state?: string;
}

/** Contrato del servicio de operación del bot (Bloque B). */
export interface IOperationsService {
  /** Lista los contactos del tenant (paginado). */
  listContacts(query?: IPageQuery): Promise<IPage<IContactRead>>;
  /** Crea un contacto en el tenant (teléfono único por tenant). */
  createContact(input: IContactInput): Promise<IContactRead>;
  /** Devuelve un contacto del tenant por su identificador. */
  getContact(contactId: string): Promise<IContactRead>;
  /** Actualiza un contacto del tenant (PUT, solo campos presentes). */
  updateContact(contactId: string, input: Partial<IContactInput>): Promise<IContactRead>;
  /** Elimina lógicamente un contacto del tenant. */
  deleteContact(contactId: string): Promise<void>;
  /** Lista las plantillas de mensaje del tenant (paginado). */
  listTemplates(query?: IPageQuery): Promise<IPage<ITemplateRead>>;
  /** Crea una plantilla de mensaje en el tenant (nombre único por tenant). */
  createTemplate(input: ITemplateInput): Promise<ITemplateRead>;
  /** Devuelve una plantilla del tenant por su identificador. */
  getTemplate(templateId: string): Promise<ITemplateRead>;
  /** Actualiza una plantilla del tenant (PUT, solo campos presentes). */
  updateTemplate(templateId: string, input: Partial<ITemplateInput>): Promise<ITemplateRead>;
  /** Elimina lógicamente una plantilla del tenant. */
  deleteTemplate(templateId: string): Promise<void>;
  /** Lista los árboles de navegación del bot del tenant (paginado). */
  listNavigationTrees(query?: IPageQuery): Promise<IPage<INavigationTreeRead>>;
  /** Crea un árbol de navegación del bot en el tenant (nombre único por tenant). */
  createNavigationTree(input: INavigationTreeInput): Promise<INavigationTreeRead>;
  /** Devuelve un árbol de navegación del tenant por su identificador. */
  getNavigationTree(treeId: string): Promise<INavigationTreeRead>;
  /** Actualiza un árbol de navegación del tenant (PUT, solo campos presentes). */
  updateNavigationTree(
    treeId: string,
    input: Partial<INavigationTreeInput>,
  ): Promise<INavigationTreeRead>;
  /** Elimina lógicamente un árbol de navegación del tenant. */
  deleteNavigationTree(treeId: string): Promise<void>;
  /** Lista las campañas de envío del tenant (paginado). */
  listCampaigns(query?: IPageQuery): Promise<IPage<ICampaignRead>>;
  /** Crea una campaña de envío en el tenant. */
  createCampaign(input: ICampaignInput): Promise<ICampaignRead>;
  /** Devuelve una campaña del tenant por su identificador. */
  getCampaign(campaignId: string): Promise<ICampaignRead>;
  /** Actualiza una campaña del tenant (PUT, solo campos presentes). */
  updateCampaign(campaignId: string, input: Partial<ICampaignInput>): Promise<ICampaignRead>;
  /** Elimina lógicamente una campaña del tenant. */
  deleteCampaign(campaignId: string): Promise<void>;
  /** Añade un destinatario a una campaña del tenant. */
  addCampaignRecipient(
    campaignId: string,
    input: ICampaignRecipientInput,
  ): Promise<ICampaignRecipientRead>;
  /** Lista los destinatarios de una campaña del tenant (paginado). */
  listCampaignRecipients(
    campaignId: string,
    query?: IPageQuery,
  ): Promise<IPage<ICampaignRecipientRead>>;
  /** Actualiza el estado de un destinatario de campaña (PUT). */
  updateCampaignRecipient(
    recipientId: string,
    input: Partial<ICampaignRecipientInput>,
  ): Promise<ICampaignRecipientRead>;
  /** Despacha una campaña del tenant de forma inmediata (POST /campaigns/{id}/dispatch, C-2). */
  dispatchCampaign(campaignId: string): Promise<IDispatchResultRead>;
  /** Envía un mensaje individual a un teléfono reutilizando una plantilla del tenant (POST /messages/send-individual, B.4). */
  sendIndividualMessage(input: IIndividualSendInput): Promise<IMessageSendResultRead>;
  /** Importa contactos en lote desde CSV (POST /contacts/import-csv, B.6). */
  importContactsCsv(input: ICsvImportInput): Promise<IImportResultRead>;
  /** Importa destinatarios de una campaña en lote desde CSV (POST /campaigns/{id}/recipients/import-csv, B.4). */
  importCampaignRecipientsCsv(
    campaignId: string,
    input: ICsvImportInput,
  ): Promise<IImportResultRead>;
  /** Sube un archivo de destinatarios reutilizable (POST /operations/recipient-files, GAP 2). */
  uploadRecipientFile(input: IRecipientFileInput): Promise<IRecipientFileRead>;
  /** Lista los archivos de destinatarios reutilizables del tenant (paginado, GAP 2). */
  listRecipientFiles(query?: IPageQuery): Promise<IPage<IRecipientFileRead>>;
  /** Vista previa de los contactos de un archivo (dry-run, sin insertar, GAP 2). */
  previewRecipientFile(fileId: string): Promise<IRecipientFilePreviewRead>;
  /** Despacha una campaña desde un archivo de destinatarios (POST /campaigns/{id}/dispatch-from-file, GAP 2). */
  dispatchCampaignFromFile(campaignId: string, fileId: string): Promise<IDispatchResultRead>;
  /** Lista las intervenciones humanas del tenant (paginado, filtro por estado). */
  listInterventions(query?: IInterventionQuery): Promise<IPage<IInterventionRead>>;
  /** Crea una intervención humana sobre una conversación (cola B.7 → eslabón ⑤). */
  createIntervention(input: IInterventionInput): Promise<IInterventionRead>;
  /** Devuelve una intervención del tenant por su identificador. */
  getIntervention(interventionId: string): Promise<IInterventionRead>;
  /** Actualiza una intervención humana del tenant (PUT, solo campos presentes). */
  updateIntervention(
    interventionId: string,
    input: Partial<IInterventionInput>,
  ): Promise<IInterventionRead>;
  /** Devuelve el contador de intervenciones pendientes del tenant (badge 🆕 del panel). */
  getInterventionsPendingCount(): Promise<IInterventionPendingCountRead>;
  /** Asigna una intervención pendiente a un operador humano (B.7). */
  assignIntervention(interventionId: string, operator: string): Promise<IInterventionRead>;
  /** Lista los mensajes de la conversación de una intervención (workspace "Atendiendo"). */
  listInterventionMessages(interventionId: string): Promise<IMessageRead[]>;
  /** Responde a la conversación de una intervención en nombre del operador (B.7). */
  replyIntervention(interventionId: string, content: string): Promise<IMessageRead>;
  /** Cierra una intervención humana y marca su resolución (B.7). */
  closeIntervention(interventionId: string): Promise<IInterventionCloseResult>;
  /** Devuelve la configuración de mantenimiento del tenant o `null` si no existe (404). */
  getMaintenanceConfig(): Promise<IMaintenanceConfigRead | null>;
  /** Crea o reemplaza la configuración de mantenimiento del tenant (PUT idempotente). */
  upsertMaintenanceConfig(input: IMaintenanceConfigInput): Promise<IMaintenanceConfigRead>;
  /** Devuelve el resumen operativo del bot del tenant (B.1 Dashboard + B.2 Estadísticas). */
  getStatsOverview(): Promise<IStatsOverviewRead>;
  /** Ejecuta la purga por dominio del tenant (POST /maintenance/purge). */
  purgeMaintenance(payload: IPurgeRequest): Promise<IMaintenanceActionRead>;
  /** Ejecuta la optimización física del almacén del tenant (POST /maintenance/optimize). */
  optimizeMaintenance(): Promise<IMaintenanceActionRead>;
  /** Lista las conversaciones activas del bot del tenant (paginado, Monitor Fase 7). */
  listActiveConversations(query?: IPageQuery): Promise<IPage<IActiveConversationRead>>;
  /** Descarga el backup de la configuración de operación del tenant (B.9). */
  createBackup(): Promise<IBackupMetaRead>;
  /** Restaura un backup de la configuración de operación del tenant (B.9). */
  restoreBackup(file: File): Promise<IRestoreResultRead>;
  /** Devuelve el conteo total/activo/inactivo por tabla del tenant (B.9 Estado). */
  getTableStats(): Promise<ITableStatsRead[]>;
  /** Ejecuta manualmente el mantenimiento programado configurado del tenant (B.9). */
  runScheduledMaintenance(): Promise<IScheduledRunResultRead>;
}

/** Implementación del puerto de operación del bot sobre el cliente HTTP. */
export class BackendOperationsService implements IOperationsService {
  /** Cliente HTTP de la API v1 (inyectado por DI). */
  private readonly apiClient: IApiClient;
  /** Logger de auditoría opcional (regla CLAUDE: log de auditoría). */
  private readonly logger?: ILogger;

  constructor(apiClient: IApiClient, logger?: ILogger) {
    this.apiClient = apiClient;
    this.logger = logger;
  }

  /** Lista los contactos del tenant (paginado). */
  public async listContacts(query?: IPageQuery): Promise<IPage<IContactRead>> {
    this.logger?.debug('operations.contacts.list', {});
    return this.apiClient.listContacts(query);
  }

  /** Crea un contacto traduciendo el input de dominio al DTO del backend. */
  public async createContact(input: IContactInput): Promise<IContactRead> {
    this.logger?.debug('operations.contacts.create', { phone: input.phone });
    const payload: IContactCreate = {
      phone: input.phone,
      name: input.name ?? undefined,
      email: input.email ?? undefined,
      tags: input.tags ?? [],
      state: input.state ?? 'new',
      source: input.source ?? 'manual',
      external_contact_id: input.externalContactId ?? undefined,
      last_contact_at: input.lastContactAt ?? undefined,
    };
    return this.apiClient.createContact(payload);
  }

  /** Devuelve un contacto del tenant por su identificador. */
  public async getContact(contactId: string): Promise<IContactRead> {
    this.logger?.debug('operations.contacts.get', { contactId });
    return this.apiClient.getContact(contactId);
  }

  /** Actualiza un contacto traduciendo solo los campos presentes (PUT). */
  public async updateContact(
    contactId: string,
    input: Partial<IContactInput>,
  ): Promise<IContactRead> {
    this.logger?.debug('operations.contacts.update', { contactId });
    const payload: IContactUpdate = {};
    if (input.phone !== undefined) {
      payload.phone = input.phone;
    }
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.email !== undefined) {
      payload.email = input.email;
    }
    if (input.tags !== undefined) {
      payload.tags = input.tags;
    }
    if (input.state !== undefined) {
      payload.state = input.state;
    }
    if (input.source !== undefined) {
      payload.source = input.source;
    }
    if (input.externalContactId !== undefined) {
      payload.external_contact_id = input.externalContactId;
    }
    if (input.lastContactAt !== undefined) {
      payload.last_contact_at = input.lastContactAt;
    }
    return this.apiClient.updateContact(contactId, payload);
  }

  /** Elimina lógicamente un contacto del tenant. */
  public async deleteContact(contactId: string): Promise<void> {
    this.logger?.debug('operations.contacts.delete', { contactId });
    await this.apiClient.deleteContact(contactId);
  }

  /** Lista las plantillas de mensaje del tenant (paginado). */
  public async listTemplates(query?: IPageQuery): Promise<IPage<ITemplateRead>> {
    this.logger?.debug('operations.templates.list', {});
    return this.apiClient.listTemplates(query);
  }

  /** Crea una plantilla traduciendo el input de dominio al DTO del backend. */
  public async createTemplate(input: ITemplateInput): Promise<ITemplateRead> {
    this.logger?.debug('operations.templates.create', { name: input.name });
    const payload: ITemplateCreate = {
      name: input.name,
      body: input.body ?? '',
      template_type: input.templateType ?? 'text',
      variables: input.variables ?? [],
    };
    return this.apiClient.createTemplate(payload);
  }

  /** Devuelve una plantilla del tenant por su identificador. */
  public async getTemplate(templateId: string): Promise<ITemplateRead> {
    this.logger?.debug('operations.templates.get', { templateId });
    return this.apiClient.getTemplate(templateId);
  }

  /** Actualiza una plantilla traduciendo solo los campos presentes (PUT). */
  public async updateTemplate(
    templateId: string,
    input: Partial<ITemplateInput>,
  ): Promise<ITemplateRead> {
    this.logger?.debug('operations.templates.update', { templateId });
    const payload: ITemplateUpdate = {};
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.body !== undefined) {
      payload.body = input.body;
    }
    if (input.templateType !== undefined) {
      payload.template_type = input.templateType;
    }
    if (input.variables !== undefined) {
      payload.variables = input.variables;
    }
    return this.apiClient.updateTemplate(templateId, payload);
  }

  /** Elimina lógicamente una plantilla del tenant. */
  public async deleteTemplate(templateId: string): Promise<void> {
    this.logger?.debug('operations.templates.delete', { templateId });
    await this.apiClient.deleteTemplate(templateId);
  }

  /** Lista los árboles de navegación del bot del tenant (paginado). */
  public async listNavigationTrees(query?: IPageQuery): Promise<IPage<INavigationTreeRead>> {
    this.logger?.debug('operations.navigation-trees.list', {});
    return this.apiClient.listNavigationTrees(query);
  }

  /** Crea un árbol de navegación traduciendo el input de dominio al DTO del backend. */
  public async createNavigationTree(input: INavigationTreeInput): Promise<INavigationTreeRead> {
    this.logger?.debug('operations.navigation-trees.create', { name: input.name });
    const payload: INavigationTreeCreate = {
      name: input.name,
      num_options: input.numOptions ?? 0,
      options: input.options ?? [],
    };
    return this.apiClient.createNavigationTree(payload);
  }

  /** Devuelve un árbol de navegación del tenant por su identificador. */
  public async getNavigationTree(treeId: string): Promise<INavigationTreeRead> {
    this.logger?.debug('operations.navigation-trees.get', { treeId });
    return this.apiClient.getNavigationTree(treeId);
  }

  /** Actualiza un árbol de navegación traduciendo solo los campos presentes (PUT). */
  public async updateNavigationTree(
    treeId: string,
    input: Partial<INavigationTreeInput>,
  ): Promise<INavigationTreeRead> {
    this.logger?.debug('operations.navigation-trees.update', { treeId });
    const payload: INavigationTreeUpdate = {};
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.numOptions !== undefined) {
      payload.num_options = input.numOptions;
    }
    if (input.options !== undefined) {
      payload.options = input.options;
    }
    return this.apiClient.updateNavigationTree(treeId, payload);
  }

  /** Elimina lógicamente un árbol de navegación del tenant. */
  public async deleteNavigationTree(treeId: string): Promise<void> {
    this.logger?.debug('operations.navigation-trees.delete', { treeId });
    await this.apiClient.deleteNavigationTree(treeId);
  }

  /** Lista las campañas de envío del tenant (paginado). */
  public async listCampaigns(query?: IPageQuery): Promise<IPage<ICampaignRead>> {
    this.logger?.debug('operations.campaigns.list', {});
    return this.apiClient.listCampaigns(query);
  }

  /** Crea una campaña traduciendo el input de dominio al DTO del backend. */
  public async createCampaign(input: ICampaignInput): Promise<ICampaignRead> {
    this.logger?.debug('operations.campaigns.create', { name: input.name });
    const payload: ICampaignCreate = {
      name: input.name,
      template_id: input.templateId ?? undefined,
      state: input.state ?? 'draft',
      schedule: input.schedule ?? undefined,
      segment_type: input.segmentType ?? undefined,
      segment_config: input.segmentConfig ?? undefined,
      trigger_type: input.triggerType ?? undefined,
      trigger_event: input.triggerEvent ?? undefined,
      landing_id: input.landingId ?? undefined,
    };
    return this.apiClient.createCampaign(payload);
  }

  /** Devuelve una campaña del tenant por su identificador. */
  public async getCampaign(campaignId: string): Promise<ICampaignRead> {
    this.logger?.debug('operations.campaigns.get', { campaignId });
    return this.apiClient.getCampaign(campaignId);
  }

  /** Actualiza una campaña traduciendo solo los campos presentes (PUT). */
  public async updateCampaign(
    campaignId: string,
    input: Partial<ICampaignInput>,
  ): Promise<ICampaignRead> {
    this.logger?.debug('operations.campaigns.update', { campaignId });
    const payload: ICampaignUpdate = {};
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.templateId !== undefined) {
      payload.template_id = input.templateId;
    }
    if (input.state !== undefined) {
      payload.state = input.state;
    }
    if (input.schedule !== undefined) {
      payload.schedule = input.schedule;
    }
    if (input.segmentType !== undefined) {
      payload.segment_type = input.segmentType;
    }
    if (input.segmentConfig !== undefined) {
      payload.segment_config = input.segmentConfig;
    }
    if (input.triggerType !== undefined) {
      payload.trigger_type = input.triggerType;
    }
    if (input.triggerEvent !== undefined) {
      payload.trigger_event = input.triggerEvent;
    }
    if (input.landingId !== undefined) {
      payload.landing_id = input.landingId;
    }
    return this.apiClient.updateCampaign(campaignId, payload);
  }

  /** Elimina lógicamente una campaña del tenant. */
  public async deleteCampaign(campaignId: string): Promise<void> {
    this.logger?.debug('operations.campaigns.delete', { campaignId });
    await this.apiClient.deleteCampaign(campaignId);
  }

  /** Añade un destinatario a una campaña traduciendo el input de dominio al DTO. */
  public async addCampaignRecipient(
    campaignId: string,
    input: ICampaignRecipientInput,
  ): Promise<ICampaignRecipientRead> {
    this.logger?.debug('operations.recipients.add', { campaignId, contactId: input.contactId });
    const payload: ICampaignRecipientCreate = {
      contact_id: input.contactId,
      state: input.state ?? 'pending',
      result: input.result ?? undefined,
      attempts: input.attempts ?? 0,
    };
    return this.apiClient.addCampaignRecipient(campaignId, payload);
  }

  /** Lista los destinatarios de una campaña del tenant (paginado). */
  public async listCampaignRecipients(
    campaignId: string,
    query?: IPageQuery,
  ): Promise<IPage<ICampaignRecipientRead>> {
    this.logger?.debug('operations.recipients.list', { campaignId });
    return this.apiClient.listCampaignRecipients(campaignId, query);
  }

  /** Actualiza el estado de un destinatario traduciendo solo los campos presentes (PUT). */
  public async updateCampaignRecipient(
    recipientId: string,
    input: Partial<ICampaignRecipientInput>,
  ): Promise<ICampaignRecipientRead> {
    this.logger?.debug('operations.recipients.update', { recipientId });
    const payload: ICampaignRecipientUpdate = {};
    if (input.state !== undefined) {
      payload.state = input.state;
    }
    if (input.result !== undefined) {
      payload.result = input.result;
    }
    if (input.attempts !== undefined) {
      payload.attempts = input.attempts;
    }
    return this.apiClient.updateCampaignRecipient(recipientId, payload);
  }

  /** Despacha una campaña del tenant de forma inmediata. */
  public async dispatchCampaign(campaignId: string): Promise<IDispatchResultRead> {
    this.logger?.debug('operations.campaigns.dispatch', { campaignId });
    return this.apiClient.dispatchCampaign(campaignId);
  }

  /** Envía un mensaje individual a un teléfono reutilizando una plantilla del tenant (B.4). */
  public async sendIndividualMessage(input: IIndividualSendInput): Promise<IMessageSendResultRead> {
    this.logger?.debug('operations.messages.send-individual', { phone: input.phone });
    return this.apiClient.sendIndividualMessage(input);
  }

  /** Importa contactos en lote desde CSV (texto crudo). */
  public async importContactsCsv(input: ICsvImportInput): Promise<IImportResultRead> {
    this.logger?.debug('operations.contacts.import', {});
    return this.apiClient.importContactsCsv({ csv: input.csv, delimiter: input.delimiter ?? ',' });
  }

  /** Importa destinatarios de una campaña en lote desde CSV (texto crudo). */
  public async importCampaignRecipientsCsv(
    campaignId: string,
    input: ICsvImportInput,
  ): Promise<IImportResultRead> {
    this.logger?.debug('operations.recipients.import', { campaignId });
    return this.apiClient.importCampaignRecipientsCsv(campaignId, {
      csv: input.csv,
      delimiter: input.delimiter ?? ',',
    });
  }

  /** Sube un archivo de destinatarios reutilizable traduciendo el input de dominio al DTO (GAP 2). */
  public async uploadRecipientFile(input: IRecipientFileInput): Promise<IRecipientFileRead> {
    this.logger?.debug('operations.recipient-files.create', { name: input.name });
    const payload: IRecipientFileCreate = {
      name: input.name,
      content_type: input.contentType,
      raw_csv: input.rawCsv,
      source_meta: input.sourceMeta ?? {},
    };
    return this.apiClient.uploadRecipientFile(payload);
  }

  /** Lista los archivos de destinatarios reutilizables del tenant (paginado, GAP 2). */
  public async listRecipientFiles(query?: IPageQuery): Promise<IPage<IRecipientFileRead>> {
    this.logger?.debug('operations.recipient-files.list', {});
    return this.apiClient.listRecipientFiles(query);
  }

  /** Vista previa de los contactos de un archivo (dry-run, sin insertar, GAP 2). */
  public async previewRecipientFile(fileId: string): Promise<IRecipientFilePreviewRead> {
    this.logger?.debug('operations.recipient-files.preview', { fileId });
    return this.apiClient.previewRecipientFile(fileId);
  }

  /** Despacha una campaña desde un archivo de destinatarios (GAP 2). */
  public async dispatchCampaignFromFile(
    campaignId: string,
    fileId: string,
  ): Promise<IDispatchResultRead> {
    this.logger?.debug('operations.campaigns.dispatch-from-file', { campaignId, fileId });
    const payload: IRecipientFileDispatchInput = { file_id: fileId };
    return this.apiClient.dispatchCampaignFromFile(campaignId, payload);
  }

  /** Lista las intervenciones humanas del tenant (paginado, filtro por estado). */
  public async listInterventions(query?: IInterventionQuery): Promise<IPage<IInterventionRead>> {
    this.logger?.debug('operations.interventions.list', { state: query?.state });
    return this.apiClient.listInterventions(query);
  }

  /** Crea una intervención humana traduciendo el input de dominio al DTO del backend. */
  public async createIntervention(input: IInterventionInput): Promise<IInterventionRead> {
    this.logger?.debug('operations.interventions.create', {
      conversationId: input.conversationId,
    });
    const payload: IInterventionCreate = {
      conversation_id: input.conversationId,
      state: input.state ?? 'pending',
      operator: input.operator ?? undefined,
      notes: input.notes ?? undefined,
      assigned_at: input.assignedAt ?? undefined,
      resolved_at: input.resolvedAt ?? undefined,
    };
    return this.apiClient.createIntervention(payload);
  }

  /** Devuelve una intervención del tenant por su identificador. */
  public async getIntervention(interventionId: string): Promise<IInterventionRead> {
    this.logger?.debug('operations.interventions.get', { interventionId });
    return this.apiClient.getIntervention(interventionId);
  }

  /** Actualiza una intervención traduciendo solo los campos presentes (PUT). */
  public async updateIntervention(
    interventionId: string,
    input: Partial<IInterventionInput>,
  ): Promise<IInterventionRead> {
    this.logger?.debug('operations.interventions.update', { interventionId });
    const payload: IInterventionUpdate = {};
    if (input.state !== undefined) {
      payload.state = input.state;
    }
    if (input.operator !== undefined) {
      payload.operator = input.operator;
    }
    if (input.notes !== undefined) {
      payload.notes = input.notes;
    }
    if (input.assignedAt !== undefined) {
      payload.assigned_at = input.assignedAt;
    }
    if (input.resolvedAt !== undefined) {
      payload.resolved_at = input.resolvedAt;
    }
    return this.apiClient.updateIntervention(interventionId, payload);
  }

  /** Devuelve el contador de intervenciones pendientes del tenant (badge 🆕 del panel). */
  public async getInterventionsPendingCount(): Promise<IInterventionPendingCountRead> {
    this.logger?.debug('operations.interventions.pending-count', {});
    return this.apiClient.getInterventionsPendingCount();
  }

  /** Asigna una intervención pendiente a un operador humano traduciendo el input al DTO (B.7). */
  public async assignIntervention(
    interventionId: string,
    operator: string,
  ): Promise<IInterventionRead> {
    this.logger?.debug('operations.interventions.assign', { interventionId, operator });
    const payload: IInterventionAssignRequest = { operator };
    return this.apiClient.assignIntervention(interventionId, payload);
  }

  /** Lista los mensajes de la conversación de una intervención (workspace "Atendiendo"). */
  public async listInterventionMessages(interventionId: string): Promise<IMessageRead[]> {
    this.logger?.debug('operations.interventions.messages.list', { interventionId });
    return this.apiClient.listInterventionMessages(interventionId);
  }

  /** Responde a la conversación de una intervención en nombre del operador (B.7). */
  public async replyIntervention(interventionId: string, content: string): Promise<IMessageRead> {
    this.logger?.debug('operations.interventions.reply', { interventionId });
    const payload: IInterventionReplyRequest = { content };
    return this.apiClient.replyIntervention(interventionId, payload);
  }

  /** Cierra una intervención humana y marca su resolución (B.7). */
  public async closeIntervention(interventionId: string): Promise<IInterventionCloseResult> {
    this.logger?.debug('operations.interventions.close', { interventionId });
    return this.apiClient.closeIntervention(interventionId);
  }

  /** Devuelve la configuración de mantenimiento del tenant o `null` si no existe (404). */
  public async getMaintenanceConfig(): Promise<IMaintenanceConfigRead | null> {
    this.logger?.debug('operations.maintenance.get', {});
    try {
      return await this.apiClient.getMaintenanceConfig();
    } catch (error) {
      // 404 = el tenant aún no configuró mantenimiento; la UI aplica los valores por defecto.
      if (error instanceof ApiHttpError && error.status === 404) {
        this.logger?.info('operations.maintenance.get', { reason: 'not-configured' });
        return null;
      }
      throw error;
    }
  }

  /** Crea o reemplaza la configuración de mantenimiento traduciendo el input de dominio. */
  public async upsertMaintenanceConfig(
    input: IMaintenanceConfigInput,
  ): Promise<IMaintenanceConfigRead> {
    this.logger?.debug('operations.maintenance.upsert', {});
    const payload: IMaintenanceConfigUpsert = {
      retention_rules: input.retentionRules ?? {},
      maintenance_schedule: input.maintenanceSchedule ?? undefined,
    };
    return this.apiClient.upsertMaintenanceConfig(payload);
  }

  /** Devuelve el resumen operativo del bot del tenant (B.1 Dashboard + B.2 Estadísticas). */
  public async getStatsOverview(): Promise<IStatsOverviewRead> {
    this.logger?.debug('operations.stats.overview', {});
    return this.apiClient.getOperationsStatsOverview();
  }

  /** Ejecuta la purga por dominio del tenant (POST /maintenance/purge). */
  public async purgeMaintenance(payload: IPurgeRequest): Promise<IMaintenanceActionRead> {
    this.logger?.debug('operations.maintenance.purge', { scope: payload.scope });
    return this.apiClient.purgeMaintenance(payload);
  }

  /** Ejecuta la optimización física del almacén del tenant (POST /maintenance/optimize). */
  public async optimizeMaintenance(): Promise<IMaintenanceActionRead> {
    this.logger?.debug('operations.maintenance.optimize', {});
    return this.apiClient.optimizeMaintenance();
  }

  /** Lista las conversaciones activas del bot del tenant (paginado, Monitor Fase 7). */
  public async listActiveConversations(
    query?: IPageQuery,
  ): Promise<IPage<IActiveConversationRead>> {
    this.logger?.debug('operations.monitor.active-conversations', { query });
    return this.apiClient.listActiveConversations(query);
  }

  /** Descarga el backup de la configuración de operación del tenant (B.9). */
  public async createBackup(): Promise<IBackupMetaRead> {
    this.logger?.debug('operations.maintenance.backup', {});
    return this.apiClient.createBackup();
  }

  /** Restaura un backup de la configuración de operación del tenant (B.9). */
  public async restoreBackup(file: File): Promise<IRestoreResultRead> {
    this.logger?.debug('operations.maintenance.restore', {});
    return this.apiClient.restoreBackup(file);
  }

  /** Devuelve el conteo total/activo/inactivo por tabla del tenant (B.9 Estado). */
  public async getTableStats(): Promise<ITableStatsRead[]> {
    this.logger?.debug('operations.maintenance.table-stats', {});
    return this.apiClient.getTableStats();
  }

  /** Ejecuta manualmente el mantenimiento programado configurado del tenant (B.9). */
  public async runScheduledMaintenance(): Promise<IScheduledRunResultRead> {
    this.logger?.debug('operations.maintenance.run-scheduled', {});
    return this.apiClient.runScheduledMaintenance();
  }
}

/**
 * Crea un servicio de operación del bot listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `IOperationsService`.
 */
export function createOperationsService(
  apiClient: IApiClient,
  logger?: ILogger,
): IOperationsService {
  return new BackendOperationsService(apiClient, logger);
}
