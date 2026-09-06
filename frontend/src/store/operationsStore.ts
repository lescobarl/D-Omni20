/**
 * Store de operación del bot (Bloque B de LAE Omni2.0) — contactos, plantillas,
 * árboles, campañas, intervención humana y mantenimiento (B.1-B.9).
 *
 * Contrato:
 * - Registro de servicios por DI: `setOperationsService`/`getOperationsService`
 *   inyectan la implementación `IOperationsService` desde el composition root
 *   (`main.tsx`), activada por la feature flag `operations`.
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas).
 * - Cada colección (contactos, plantillas, árboles, campañas, destinatarios e
 *   intervenciones) mantiene su propio estado de carga para no bloquear pestañas
 *   independientes entre sí.
 * - `loadMaintenanceConfig` devuelve `null` (HTTP 404) cuando el tenant aún no
 *   tiene configuración de mantenimiento, dejando que la UI muestre el formulario
 *   por defecto sin romper el flujo.
 */
import { create } from 'zustand';
import type {
  IActiveConversationRead,
  IBackupMetaRead,
  ICampaignRead,
  ICampaignRecipientRead,
  IContactRead,
  IDispatchResultRead,
  IImportResultRead,
  IIndividualSendInput,
  IMessageSendResultRead,
  IInterventionRead,
  IMaintenanceActionRead,
  IMaintenanceConfigRead,
  IMessageRead,
  INavigationTreeRead,
  IPurgeRequest,
  IRecipientFilePreviewRead,
  IRecipientFileRead,
  IRestoreResultRead,
  IScheduledRunResultRead,
  IStatsOverviewRead,
  ITableStatsRead,
  ITemplateRead,
} from '@/api/types';
import { AppError } from '@/lib/errors';
import type {
  ICampaignInput,
  ICampaignRecipientInput,
  IContactInput,
  ICsvImportInput,
  IInterventionInput,
  IInterventionQuery,
  IMaintenanceConfigInput,
  INavigationTreeInput,
  IOperationsService,
  IRecipientFileInput,
  ITemplateInput,
} from '@/services/operationsService';

/** Estado de un flujo de operación del bot. */
export type OperationsStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store de operación del bot. */
export interface IOperationsState {
  /** Contactos del tenant cargados (B.6). */
  contacts: IContactRead[];
  /** Estado del flujo de contactos. */
  contactsStatus: OperationsStatus;
  /** Mensaje del último error del flujo de contactos (o `null`). */
  contactsError: string | null;

  /** Plantillas de mensaje del tenant cargadas (B.5). */
  templates: ITemplateRead[];
  /** Estado del flujo de plantillas. */
  templatesStatus: OperationsStatus;
  /** Mensaje del último error del flujo de plantillas (o `null`). */
  templatesError: string | null;

  /** Árboles de navegación del bot cargados (B.3). */
  navigationTrees: INavigationTreeRead[];
  /** Estado del flujo de árboles de navegación. */
  navigationTreesStatus: OperationsStatus;
  /** Mensaje del último error del flujo de árboles (o `null`). */
  navigationTreesError: string | null;

  /** Campañas de envío del tenant cargadas (B.4). */
  campaigns: ICampaignRead[];
  /** Estado del flujo de campañas. */
  campaignsStatus: OperationsStatus;
  /** Mensaje del último error del flujo de campañas (o `null`). */
  campaignsError: string | null;

  /** Destinatarios de la campaña seleccionada (B.4). */
  campaignRecipients: ICampaignRecipientRead[];
  /** Identificador de la campaña cuyos destinatarios están cargados (o `null`). */
  campaignRecipientsCampaignId: string | null;
  /** Estado del flujo de destinatarios. */
  campaignRecipientsStatus: OperationsStatus;
  /** Mensaje del último error del flujo de destinatarios (o `null`). */
  campaignRecipientsError: string | null;

  /** Intervenciones humanas de la cola B.7 cargadas (eslabón ⑤). */
  interventions: IInterventionRead[];
  /** Estado del flujo de intervenciones. */
  interventionsStatus: OperationsStatus;
  /** Mensaje del último error del flujo de intervenciones (o `null`). */
  interventionsError: string | null;

  /** Contador de intervenciones pendientes del tenant (badge 🆕 del panel). */
  pendingCount: number;
  /** Estado del flujo del contador de pendientes. */
  pendingCountStatus: OperationsStatus;
  /** Mensaje del último error del contador de pendientes (o `null`). */
  pendingCountError: string | null;

  /** Mensajes de la conversación de la intervención en atención (workspace "Atendiendo"). */
  interventionMessages: IMessageRead[];
  /** Identificador de la intervención cuyos mensajes están cargados (o `null`). */
  interventionMessagesInterventionId: string | null;
  /** Estado del flujo de mensajes de la intervención activa. */
  interventionMessagesStatus: OperationsStatus;
  /** Mensaje del último error del flujo de mensajes (o `null`). */
  interventionMessagesError: string | null;
  /** Identificador de la intervención abierta en el workspace "Atendiendo" (o `null`). */
  activeInterventionId: string | null;

  /** Configuración de mantenimiento del tenant (o `null` si no existe, B.9). */
  maintenanceConfig: IMaintenanceConfigRead | null;
  /** Estado del flujo de mantenimiento. */
  maintenanceStatus: OperationsStatus;
  /** Mensaje del último error del flujo de mantenimiento (o `null`). */
  maintenanceError: string | null;

  /** Resumen operativo del bot del tenant (B.1 Dashboard + B.2 Estadísticas). */
  statsOverview: IStatsOverviewRead | null;
  /** Estado del flujo del resumen operativo. */
  statsOverviewStatus: OperationsStatus;
  /** Mensaje del último error del flujo del resumen operativo (o `null`). */
  statsOverviewError: string | null;

  /** Resultado de la última acción de mantenimiento ejecutada (B.9). */
  maintenanceAction: IMaintenanceActionRead | null;
  /** Estado del flujo de acciones de mantenimiento. */
  maintenanceActionStatus: OperationsStatus;
  /** Mensaje del último error de las acciones de mantenimiento (o `null`). */
  maintenanceActionError: string | null;

  /** Conversaciones activas del bot del tenant (Monitor Fase 7). */
  activeConversations: IActiveConversationRead[];
  /** Estado del flujo de conversaciones activas. */
  activeConversationsStatus: OperationsStatus;
  /** Mensaje del último error del flujo de conversaciones activas (o `null`). */
  activeConversationsError: string | null;

  /** Metadatos del último backup descargado del tenant (B.9). */
  backupMeta: IBackupMetaRead | null;
  /** Estado del flujo de descarga de backup. */
  backupStatus: OperationsStatus;
  /** Mensaje del último error del flujo de backup (o `null`). */
  backupError: string | null;

  /** Resultado de la última restauración de backup ejecutada (B.9). */
  restoreResult: IRestoreResultRead | null;
  /** Estado del flujo de restauración de backup. */
  restoreStatus: OperationsStatus;
  /** Mensaje del último error del flujo de restauración (o `null`). */
  restoreError: string | null;

  /** Métricas por tabla del tenant (B.9 Estado). */
  tableStats: ITableStatsRead[];
  /** Estado del flujo de métricas por tabla. */
  tableStatsStatus: OperationsStatus;
  /** Mensaje del último error del flujo de métricas por tabla (o `null`). */
  tableStatsError: string | null;

  /** Resultado del último mantenimiento programado ejecutado manualmente (B.9). */
  scheduledRunResult: IScheduledRunResultRead | null;
  /** Estado del flujo de mantenimiento programado manual. */
  scheduledRunStatus: OperationsStatus;
  /** Mensaje del último error del mantenimiento programado manual (o `null`). */
  scheduledRunError: string | null;

  /** Resultado del último despacho de campaña ejecutado (C-2). */
  dispatchResult: IDispatchResultRead | null;
  /** Estado del flujo de despacho de campañas. */
  dispatchStatus: OperationsStatus;
  /** Mensaje del último error del flujo de despacho (o `null`). */
  dispatchError: string | null;
  /** Resultado del último envío individual ejecutado (B.4). */
  individualSendResult: IMessageSendResultRead | null;
  /** Estado del flujo de envío individual. */
  individualSendStatus: OperationsStatus;
  /** Mensaje del último error del flujo de envío individual (o `null`). */
  individualSendError: string | null;

  /** Resultado de la última importación masiva ejecutada (B.4/B.6). */
  importResult: IImportResultRead | null;
  /** Estado del flujo de importación masiva. */
  importStatus: OperationsStatus;
  /** Mensaje del último error del flujo de importación (o `null`). */
  importError: string | null;

  /** Archivos de destinatarios reutilizables del tenant cargados (GAP 2). */
  recipientFiles: IRecipientFileRead[];
  /** Estado del flujo de archivos de destinatarios. */
  recipientFilesStatus: OperationsStatus;
  /** Mensaje del último error del flujo de archivos de destinatarios (o `null`). */
  recipientFilesError: string | null;
  /** Vista previa de contactos del archivo seleccionado (dry-run, GAP 2). */
  recipientFilePreview: IRecipientFilePreviewRead | null;
  /** Estado del flujo de vista previa de archivo. */
  recipientFilePreviewStatus: OperationsStatus;
  /** Mensaje del último error del flujo de vista previa (o `null`). */
  recipientFilePreviewError: string | null;

  /** Carga el directorio de contactos del tenant. */
  listContacts(): Promise<void>;
  /** Crea un contacto y lo agrega a la colección. */
  createContact(input: IContactInput): Promise<void>;
  /** Actualiza un contacto y refresca la colección. */
  updateContact(contactId: string, input: Partial<IContactInput>): Promise<void>;
  /** Elimina un contacto y lo quita de la colección. */
  deleteContact(contactId: string): Promise<void>;

  /** Carga las plantillas de mensaje del tenant. */
  listTemplates(): Promise<void>;
  /** Crea una plantilla y la agrega a la colección. */
  createTemplate(input: ITemplateInput): Promise<void>;
  /** Actualiza una plantilla y refresca la colección. */
  updateTemplate(templateId: string, input: Partial<ITemplateInput>): Promise<void>;
  /** Elimina una plantilla y la quita de la colección. */
  deleteTemplate(templateId: string): Promise<void>;

  /** Carga los árboles de navegación del bot del tenant. */
  listNavigationTrees(): Promise<void>;
  /** Crea un árbol de navegación y lo agrega a la colección. */
  createNavigationTree(input: INavigationTreeInput): Promise<void>;
  /** Actualiza un árbol de navegación y refresca la colección. */
  updateNavigationTree(treeId: string, input: Partial<INavigationTreeInput>): Promise<void>;
  /** Elimina un árbol de navegación y lo quita de la colección. */
  deleteNavigationTree(treeId: string): Promise<void>;

  /** Carga las campañas de envío del tenant. */
  listCampaigns(): Promise<void>;
  /** Crea una campaña y la agrega a la colección. */
  createCampaign(input: ICampaignInput): Promise<void>;
  /** Actualiza una campaña y refresca la colección. */
  updateCampaign(campaignId: string, input: Partial<ICampaignInput>): Promise<void>;
  /** Elimina una campaña y la quita de la colección. */
  deleteCampaign(campaignId: string): Promise<void>;

  /** Carga los destinatarios de una campaña (reemplaza la colección actual). */
  listCampaignRecipients(campaignId: string): Promise<void>;
  /** Añade un destinatario a la campaña y lo agrega a la colección. */
  addCampaignRecipient(campaignId: string, input: ICampaignRecipientInput): Promise<void>;
  /** Actualiza el estado de un destinatario y refresca la colección. */
  updateCampaignRecipient(
    recipientId: string,
    input: Partial<ICampaignRecipientInput>,
  ): Promise<void>;
  /** Despacha una campaña del tenant de forma inmediata (C-2). */
  dispatchCampaign(campaignId: string): Promise<void>;
  /** Envía un mensaje individual a un teléfono reutilizando una plantilla del tenant (B.4). */
  sendIndividualMessage(input: IIndividualSendInput): Promise<void>;
  /** Importa contactos en lote desde CSV (B.6). */
  importContactsCsv(input: ICsvImportInput): Promise<void>;
  /** Importa destinatarios de una campaña en lote desde CSV (B.4). */
  importCampaignRecipientsCsv(campaignId: string, input: ICsvImportInput): Promise<void>;

  /** Carga los archivos de destinatarios reutilizables del tenant (GAP 2). */
  listRecipientFiles(): Promise<void>;
  /** Sube un archivo de destinatarios reutilizable y lo agrega a la colección (GAP 2). */
  uploadRecipientFile(input: IRecipientFileInput): Promise<void>;
  /** Carga la vista previa de contactos de un archivo (dry-run, sin insertar, GAP 2). */
  previewRecipientFile(fileId: string): Promise<void>;
  /** Despacha una campaña desde un archivo de destinatarios reutilizable (GAP 2). */
  dispatchCampaignFromFile(campaignId: string, fileId: string): Promise<void>;

  /** Carga la cola de intervenciones humanas (filtro opcional por estado). */
  listInterventions(query?: IInterventionQuery): Promise<void>;
  /** Crea una intervención y la agrega a la cola. */
  createIntervention(input: IInterventionInput): Promise<void>;
  /** Actualiza una intervención y refresca la cola. */
  updateIntervention(interventionId: string, input: Partial<IInterventionInput>): Promise<void>;
  /** Carga el contador de intervenciones pendientes del tenant (badge 🆕 del panel). */
  loadPendingCount(): Promise<void>;
  /** Abre o cierra el workspace "Atendiendo" de una intervención. */
  setActiveIntervention(interventionId: string | null): void;
  /** Asigna una intervención pendiente a un operador humano (B.7). */
  assignIntervention(interventionId: string, operator: string): Promise<void>;
  /** Carga los mensajes de la conversación de una intervención (workspace "Atendiendo"). */
  listInterventionMessages(interventionId: string): Promise<void>;
  /** Responde a la conversación de una intervención en nombre del operador (B.7). */
  replyIntervention(interventionId: string, content: string): Promise<void>;
  /** Cierra una intervención humana y refresca la cola (B.7). */
  closeIntervention(interventionId: string): Promise<void>;

  /** Carga la configuración de mantenimiento del tenant (404 → `null`). */
  loadMaintenanceConfig(): Promise<void>;
  /** Crea o reemplaza la configuración de mantenimiento (PUT idempotente). */
  upsertMaintenanceConfig(input: IMaintenanceConfigInput): Promise<void>;
  /** Carga el resumen operativo del bot del tenant (B.1 Dashboard + B.2 Estadísticas). */
  loadStatsOverview(): Promise<void>;
  /** Ejecuta la purga por dominio del tenant (POST /maintenance/purge). */
  purgeMaintenance(payload: IPurgeRequest): Promise<void>;
  /** Ejecuta la optimización física del almacén del tenant (POST /maintenance/optimize). */
  optimizeMaintenance(): Promise<void>;
  /** Carga las conversaciones activas del bot del tenant (Monitor Fase 7). */
  loadActiveConversations(): Promise<void>;
  /** Descarga el backup de la configuración de operación del tenant (B.9). */
  createBackup(): Promise<void>;
  /** Restaura un backup de la configuración de operación del tenant (B.9). */
  restoreBackup(file: File): Promise<void>;
  /** Carga el conteo total/activo/inactivo por tabla del tenant (B.9 Estado). */
  loadTableStats(): Promise<void>;
  /** Ejecuta manualmente el mantenimiento programado configurado del tenant (B.9). */
  runScheduledMaintenance(): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: IOperationsService | null = null;

/**
 * Registra la implementación del servicio de operación del bot (composition root).
 * @param implementation - Implementación de `IOperationsService` (o `null` en pruebas).
 */
export function setOperationsService(implementation: IOperationsService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio de operación (o `null`). */
export function getOperationsService(): IOperationsService | null {
  return service;
}

/** Extrae el mensaje de un error siguiendo la cadena AppError → Error → por defecto. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Store global de operación del bot. */
export const useOperationsStore = create<IOperationsState>()((set, get) => ({
  contacts: [],
  contactsStatus: 'idle',
  contactsError: null,

  templates: [],
  templatesStatus: 'idle',
  templatesError: null,

  navigationTrees: [],
  navigationTreesStatus: 'idle',
  navigationTreesError: null,

  campaigns: [],
  campaignsStatus: 'idle',
  campaignsError: null,

  campaignRecipients: [],
  campaignRecipientsCampaignId: null,
  campaignRecipientsStatus: 'idle',
  campaignRecipientsError: null,

  interventions: [],
  interventionsStatus: 'idle',
  interventionsError: null,

  pendingCount: 0,
  pendingCountStatus: 'idle',
  pendingCountError: null,

  interventionMessages: [],
  interventionMessagesInterventionId: null,
  interventionMessagesStatus: 'idle',
  interventionMessagesError: null,
  activeInterventionId: null,

  maintenanceConfig: null,
  maintenanceStatus: 'idle',
  maintenanceError: null,

  statsOverview: null,
  statsOverviewStatus: 'idle',
  statsOverviewError: null,

  maintenanceAction: null,
  maintenanceActionStatus: 'idle',
  maintenanceActionError: null,

  activeConversations: [],
  activeConversationsStatus: 'idle',
  activeConversationsError: null,

  backupMeta: null,
  backupStatus: 'idle',
  backupError: null,
  restoreResult: null,
  restoreStatus: 'idle',
  restoreError: null,

  dispatchResult: null,
  dispatchStatus: 'idle',
  dispatchError: null,
  individualSendResult: null,
  individualSendStatus: 'idle',
  individualSendError: null,

  importResult: null,
  importStatus: 'idle',
  importError: null,

  recipientFiles: [],
  recipientFilesStatus: 'idle',
  recipientFilesError: null,
  recipientFilePreview: null,
  recipientFilePreviewStatus: 'idle',
  recipientFilePreviewError: null,

  tableStats: [],
  tableStatsStatus: 'idle',
  tableStatsError: null,

  scheduledRunResult: null,
  scheduledRunStatus: 'idle',
  scheduledRunError: null,

  listContacts: async () => {
    if (service === null) {
      set({
        contactsStatus: 'error',
        contactsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ contactsStatus: 'loading', contactsError: null });
    try {
      const page = await service.listContacts();
      set({ contacts: page.items, contactsStatus: 'success', contactsError: null });
    } catch (error) {
      set({
        contactsStatus: 'error',
        contactsError: extractErrorMessage(error, 'No se pudieron cargar los contactos.'),
      });
    }
  },

  createContact: async (input: IContactInput) => {
    if (service === null) {
      set({
        contactsStatus: 'error',
        contactsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ contactsStatus: 'loading', contactsError: null });
    try {
      const contact = await service.createContact(input);
      set({
        contacts: [...get().contacts, contact],
        contactsStatus: 'success',
        contactsError: null,
      });
    } catch (error) {
      set({
        contactsStatus: 'error',
        contactsError: extractErrorMessage(error, 'No se pudo crear el contacto.'),
      });
    }
  },

  updateContact: async (contactId: string, input: Partial<IContactInput>) => {
    if (service === null) {
      set({
        contactsStatus: 'error',
        contactsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ contactsStatus: 'loading', contactsError: null });
    try {
      const contact = await service.updateContact(contactId, input);
      set({
        contacts: get().contacts.map((current) => (current.id === contactId ? contact : current)),
        contactsStatus: 'success',
        contactsError: null,
      });
    } catch (error) {
      set({
        contactsStatus: 'error',
        contactsError: extractErrorMessage(error, 'No se pudo actualizar el contacto.'),
      });
    }
  },

  deleteContact: async (contactId: string) => {
    if (service === null) {
      set({
        contactsStatus: 'error',
        contactsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ contactsStatus: 'loading', contactsError: null });
    try {
      await service.deleteContact(contactId);
      set({
        contacts: get().contacts.filter((current) => current.id !== contactId),
        contactsStatus: 'success',
        contactsError: null,
      });
    } catch (error) {
      set({
        contactsStatus: 'error',
        contactsError: extractErrorMessage(error, 'No se pudo eliminar el contacto.'),
      });
    }
  },

  listTemplates: async () => {
    if (service === null) {
      set({
        templatesStatus: 'error',
        templatesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ templatesStatus: 'loading', templatesError: null });
    try {
      const page = await service.listTemplates();
      set({ templates: page.items, templatesStatus: 'success', templatesError: null });
    } catch (error) {
      set({
        templatesStatus: 'error',
        templatesError: extractErrorMessage(error, 'No se pudieron cargar las plantillas.'),
      });
    }
  },

  createTemplate: async (input: ITemplateInput) => {
    if (service === null) {
      set({
        templatesStatus: 'error',
        templatesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ templatesStatus: 'loading', templatesError: null });
    try {
      const template = await service.createTemplate(input);
      set({
        templates: [...get().templates, template],
        templatesStatus: 'success',
        templatesError: null,
      });
    } catch (error) {
      set({
        templatesStatus: 'error',
        templatesError: extractErrorMessage(error, 'No se pudo crear la plantilla.'),
      });
    }
  },

  updateTemplate: async (templateId: string, input: Partial<ITemplateInput>) => {
    if (service === null) {
      set({
        templatesStatus: 'error',
        templatesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ templatesStatus: 'loading', templatesError: null });
    try {
      const template = await service.updateTemplate(templateId, input);
      set({
        templates: get().templates.map((current) =>
          current.id === templateId ? template : current,
        ),
        templatesStatus: 'success',
        templatesError: null,
      });
    } catch (error) {
      set({
        templatesStatus: 'error',
        templatesError: extractErrorMessage(error, 'No se pudo actualizar la plantilla.'),
      });
    }
  },

  deleteTemplate: async (templateId: string) => {
    if (service === null) {
      set({
        templatesStatus: 'error',
        templatesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ templatesStatus: 'loading', templatesError: null });
    try {
      await service.deleteTemplate(templateId);
      set({
        templates: get().templates.filter((current) => current.id !== templateId),
        templatesStatus: 'success',
        templatesError: null,
      });
    } catch (error) {
      set({
        templatesStatus: 'error',
        templatesError: extractErrorMessage(error, 'No se pudo eliminar la plantilla.'),
      });
    }
  },

  listNavigationTrees: async () => {
    if (service === null) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ navigationTreesStatus: 'loading', navigationTreesError: null });
    try {
      const page = await service.listNavigationTrees();
      set({
        navigationTrees: page.items,
        navigationTreesStatus: 'success',
        navigationTreesError: null,
      });
    } catch (error) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: extractErrorMessage(error, 'No se pudieron cargar los árboles.'),
      });
    }
  },

  createNavigationTree: async (input: INavigationTreeInput) => {
    if (service === null) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ navigationTreesStatus: 'loading', navigationTreesError: null });
    try {
      const tree = await service.createNavigationTree(input);
      set({
        navigationTrees: [...get().navigationTrees, tree],
        navigationTreesStatus: 'success',
        navigationTreesError: null,
      });
    } catch (error) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: extractErrorMessage(error, 'No se pudo crear el árbol.'),
      });
    }
  },

  updateNavigationTree: async (treeId: string, input: Partial<INavigationTreeInput>) => {
    if (service === null) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ navigationTreesStatus: 'loading', navigationTreesError: null });
    try {
      const tree = await service.updateNavigationTree(treeId, input);
      set({
        navigationTrees: get().navigationTrees.map((current) =>
          current.id === treeId ? tree : current,
        ),
        navigationTreesStatus: 'success',
        navigationTreesError: null,
      });
    } catch (error) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: extractErrorMessage(error, 'No se pudo actualizar el árbol.'),
      });
    }
  },

  deleteNavigationTree: async (treeId: string) => {
    if (service === null) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ navigationTreesStatus: 'loading', navigationTreesError: null });
    try {
      await service.deleteNavigationTree(treeId);
      set({
        navigationTrees: get().navigationTrees.filter((current) => current.id !== treeId),
        navigationTreesStatus: 'success',
        navigationTreesError: null,
      });
    } catch (error) {
      set({
        navigationTreesStatus: 'error',
        navigationTreesError: extractErrorMessage(error, 'No se pudo eliminar el árbol.'),
      });
    }
  },

  listCampaigns: async () => {
    if (service === null) {
      set({
        campaignsStatus: 'error',
        campaignsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignsStatus: 'loading', campaignsError: null });
    try {
      const page = await service.listCampaigns();
      set({ campaigns: page.items, campaignsStatus: 'success', campaignsError: null });
    } catch (error) {
      set({
        campaignsStatus: 'error',
        campaignsError: extractErrorMessage(error, 'No se pudieron cargar las campañas.'),
      });
    }
  },

  createCampaign: async (input: ICampaignInput) => {
    if (service === null) {
      set({
        campaignsStatus: 'error',
        campaignsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignsStatus: 'loading', campaignsError: null });
    try {
      const campaign = await service.createCampaign(input);
      set({
        campaigns: [...get().campaigns, campaign],
        campaignsStatus: 'success',
        campaignsError: null,
      });
    } catch (error) {
      set({
        campaignsStatus: 'error',
        campaignsError: extractErrorMessage(error, 'No se pudo crear la campaña.'),
      });
    }
  },

  updateCampaign: async (campaignId: string, input: Partial<ICampaignInput>) => {
    if (service === null) {
      set({
        campaignsStatus: 'error',
        campaignsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignsStatus: 'loading', campaignsError: null });
    try {
      const campaign = await service.updateCampaign(campaignId, input);
      set({
        campaigns: get().campaigns.map((current) =>
          current.id === campaignId ? campaign : current,
        ),
        campaignsStatus: 'success',
        campaignsError: null,
      });
    } catch (error) {
      set({
        campaignsStatus: 'error',
        campaignsError: extractErrorMessage(error, 'No se pudo actualizar la campaña.'),
      });
    }
  },

  deleteCampaign: async (campaignId: string) => {
    if (service === null) {
      set({
        campaignsStatus: 'error',
        campaignsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignsStatus: 'loading', campaignsError: null });
    try {
      await service.deleteCampaign(campaignId);
      set({
        campaigns: get().campaigns.filter((current) => current.id !== campaignId),
        campaignsStatus: 'success',
        campaignsError: null,
      });
    } catch (error) {
      set({
        campaignsStatus: 'error',
        campaignsError: extractErrorMessage(error, 'No se pudo eliminar la campaña.'),
      });
    }
  },

  listCampaignRecipients: async (campaignId: string) => {
    if (service === null) {
      set({
        campaignRecipientsStatus: 'error',
        campaignRecipientsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignRecipientsStatus: 'loading', campaignRecipientsError: null });
    try {
      const page = await service.listCampaignRecipients(campaignId);
      set({
        campaignRecipients: page.items,
        campaignRecipientsCampaignId: campaignId,
        campaignRecipientsStatus: 'success',
        campaignRecipientsError: null,
      });
    } catch (error) {
      set({
        campaignRecipientsStatus: 'error',
        campaignRecipientsError: extractErrorMessage(
          error,
          'No se pudieron cargar los destinatarios.',
        ),
      });
    }
  },

  addCampaignRecipient: async (campaignId: string, input: ICampaignRecipientInput) => {
    if (service === null) {
      set({
        campaignRecipientsStatus: 'error',
        campaignRecipientsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignRecipientsStatus: 'loading', campaignRecipientsError: null });
    try {
      const recipient = await service.addCampaignRecipient(campaignId, input);
      set({
        campaignRecipients: [...get().campaignRecipients, recipient],
        campaignRecipientsCampaignId: campaignId,
        campaignRecipientsStatus: 'success',
        campaignRecipientsError: null,
      });
    } catch (error) {
      set({
        campaignRecipientsStatus: 'error',
        campaignRecipientsError: extractErrorMessage(error, 'No se pudo añadir el destinatario.'),
      });
    }
  },

  updateCampaignRecipient: async (recipientId: string, input: Partial<ICampaignRecipientInput>) => {
    if (service === null) {
      set({
        campaignRecipientsStatus: 'error',
        campaignRecipientsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ campaignRecipientsStatus: 'loading', campaignRecipientsError: null });
    try {
      const recipient = await service.updateCampaignRecipient(recipientId, input);
      set({
        campaignRecipients: get().campaignRecipients.map((current) =>
          current.id === recipientId ? recipient : current,
        ),
        campaignRecipientsStatus: 'success',
        campaignRecipientsError: null,
      });
    } catch (error) {
      set({
        campaignRecipientsStatus: 'error',
        campaignRecipientsError: extractErrorMessage(
          error,
          'No se pudo actualizar el destinatario.',
        ),
      });
    }
  },

  dispatchCampaign: async (campaignId: string) => {
    if (service === null) {
      set({
        dispatchStatus: 'error',
        dispatchError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ dispatchStatus: 'loading', dispatchError: null });
    try {
      const result = await service.dispatchCampaign(campaignId);
      set({
        dispatchResult: result,
        dispatchStatus: 'success',
        dispatchError: null,
      });
      await get().listCampaigns();
    } catch (error) {
      set({
        dispatchStatus: 'error',
        dispatchError: extractErrorMessage(error, 'No se pudo despachar la campaña.'),
      });
    }
  },

  sendIndividualMessage: async (input: IIndividualSendInput) => {
    if (service === null) {
      set({
        individualSendStatus: 'error',
        individualSendError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ individualSendStatus: 'loading', individualSendError: null });
    try {
      const result = await service.sendIndividualMessage(input);
      set({
        individualSendResult: result,
        individualSendStatus: 'success',
        individualSendError: null,
      });
    } catch (error) {
      set({
        individualSendStatus: 'error',
        individualSendError: extractErrorMessage(error, 'No se pudo enviar el mensaje.'),
      });
    }
  },

  importContactsCsv: async (input: ICsvImportInput) => {
    if (service === null) {
      set({
        importStatus: 'error',
        importError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ importStatus: 'loading', importError: null });
    try {
      const result = await service.importContactsCsv(input);
      set({
        importResult: result,
        importStatus: 'success',
        importError: null,
      });
      await get().listContacts();
    } catch (error) {
      set({
        importStatus: 'error',
        importError: extractErrorMessage(error, 'No se pudieron importar los contactos.'),
      });
    }
  },

  importCampaignRecipientsCsv: async (campaignId: string, input: ICsvImportInput) => {
    if (service === null) {
      set({
        importStatus: 'error',
        importError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ importStatus: 'loading', importError: null });
    try {
      const result = await service.importCampaignRecipientsCsv(campaignId, input);
      set({
        importResult: result,
        importStatus: 'success',
        importError: null,
      });
      await get().listCampaignRecipients(campaignId);
    } catch (error) {
      set({
        importStatus: 'error',
        importError: extractErrorMessage(error, 'No se pudieron importar los destinatarios.'),
      });
    }
  },

  listRecipientFiles: async () => {
    if (service === null) {
      set({
        recipientFilesStatus: 'error',
        recipientFilesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ recipientFilesStatus: 'loading', recipientFilesError: null });
    try {
      const page = await service.listRecipientFiles();
      set({
        recipientFiles: page.items,
        recipientFilesStatus: 'success',
        recipientFilesError: null,
      });
    } catch (error) {
      set({
        recipientFilesStatus: 'error',
        recipientFilesError: extractErrorMessage(
          error,
          'No se pudieron cargar los archivos de destinatarios.',
        ),
      });
    }
  },

  uploadRecipientFile: async (input: IRecipientFileInput) => {
    if (service === null) {
      set({
        recipientFilesStatus: 'error',
        recipientFilesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ recipientFilesStatus: 'loading', recipientFilesError: null });
    try {
      await service.uploadRecipientFile(input);
      set({ recipientFilesStatus: 'success', recipientFilesError: null });
      await get().listRecipientFiles();
    } catch (error) {
      set({
        recipientFilesStatus: 'error',
        recipientFilesError: extractErrorMessage(
          error,
          'No se pudo subir el archivo de destinatarios.',
        ),
      });
    }
  },

  previewRecipientFile: async (fileId: string) => {
    if (service === null) {
      set({
        recipientFilePreviewStatus: 'error',
        recipientFilePreviewError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ recipientFilePreviewStatus: 'loading', recipientFilePreviewError: null });
    try {
      const preview = await service.previewRecipientFile(fileId);
      set({
        recipientFilePreview: preview,
        recipientFilePreviewStatus: 'success',
        recipientFilePreviewError: null,
      });
    } catch (error) {
      set({
        recipientFilePreviewStatus: 'error',
        recipientFilePreviewError: extractErrorMessage(
          error,
          'No se pudo cargar la vista previa del archivo.',
        ),
      });
    }
  },

  dispatchCampaignFromFile: async (campaignId: string, fileId: string) => {
    if (service === null) {
      set({
        dispatchStatus: 'error',
        dispatchError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ dispatchStatus: 'loading', dispatchError: null });
    try {
      const result = await service.dispatchCampaignFromFile(campaignId, fileId);
      set({
        dispatchResult: result,
        dispatchStatus: 'success',
        dispatchError: null,
      });
      await get().listCampaigns();
    } catch (error) {
      set({
        dispatchStatus: 'error',
        dispatchError: extractErrorMessage(
          error,
          'No se pudo despachar la campaña desde el archivo.',
        ),
      });
    }
  },

  listInterventions: async (query?: IInterventionQuery) => {
    if (service === null) {
      set({
        interventionsStatus: 'error',
        interventionsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionsStatus: 'loading', interventionsError: null });
    try {
      const page = await service.listInterventions(query);
      set({
        interventions: page.items,
        interventionsStatus: 'success',
        interventionsError: null,
      });
    } catch (error) {
      set({
        interventionsStatus: 'error',
        interventionsError: extractErrorMessage(error, 'No se pudieron cargar las intervenciones.'),
      });
    }
  },

  createIntervention: async (input: IInterventionInput) => {
    if (service === null) {
      set({
        interventionsStatus: 'error',
        interventionsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionsStatus: 'loading', interventionsError: null });
    try {
      const intervention = await service.createIntervention(input);
      set({
        interventions: [...get().interventions, intervention],
        interventionsStatus: 'success',
        interventionsError: null,
      });
    } catch (error) {
      set({
        interventionsStatus: 'error',
        interventionsError: extractErrorMessage(error, 'No se pudo crear la intervención.'),
      });
    }
  },

  updateIntervention: async (interventionId: string, input: Partial<IInterventionInput>) => {
    if (service === null) {
      set({
        interventionsStatus: 'error',
        interventionsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionsStatus: 'loading', interventionsError: null });
    try {
      const intervention = await service.updateIntervention(interventionId, input);
      set({
        interventions: get().interventions.map((current) =>
          current.id === interventionId ? intervention : current,
        ),
        interventionsStatus: 'success',
        interventionsError: null,
      });
    } catch (error) {
      set({
        interventionsStatus: 'error',
        interventionsError: extractErrorMessage(error, 'No se pudo actualizar la intervención.'),
      });
    }
  },

  loadPendingCount: async () => {
    if (service === null) {
      set({
        pendingCountStatus: 'error',
        pendingCountError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ pendingCountStatus: 'loading', pendingCountError: null });
    try {
      const pending = await service.getInterventionsPendingCount();
      set({
        pendingCount: pending.count,
        pendingCountStatus: 'success',
        pendingCountError: null,
      });
    } catch (error) {
      set({
        pendingCountStatus: 'error',
        pendingCountError: extractErrorMessage(
          error,
          'No se pudo cargar el contador de intervenciones pendientes.',
        ),
      });
    }
  },

  setActiveIntervention: (interventionId: string | null) => {
    const current = get().interventionMessagesInterventionId;
    set({
      activeInterventionId: interventionId,
      interventionMessages: current === interventionId ? get().interventionMessages : [],
      interventionMessagesInterventionId: interventionId,
      interventionMessagesStatus: 'idle',
      interventionMessagesError: null,
    });
  },

  assignIntervention: async (interventionId: string, operator: string) => {
    if (service === null) {
      set({
        interventionsStatus: 'error',
        interventionsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionsStatus: 'loading', interventionsError: null });
    try {
      const intervention = await service.assignIntervention(interventionId, operator);
      set({
        interventions: get().interventions.map((current) =>
          current.id === interventionId ? intervention : current,
        ),
        interventionsStatus: 'success',
        interventionsError: null,
      });
      // El contador de pendientes cambió tras la asignación: se refresca.
      void get().loadPendingCount();
    } catch (error) {
      set({
        interventionsStatus: 'error',
        interventionsError: extractErrorMessage(error, 'No se pudo asignar la intervención.'),
      });
    }
  },

  listInterventionMessages: async (interventionId: string) => {
    if (service === null) {
      set({
        interventionMessagesStatus: 'error',
        interventionMessagesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionMessagesStatus: 'loading', interventionMessagesError: null });
    try {
      const messages = await service.listInterventionMessages(interventionId);
      set({
        interventionMessages: messages,
        interventionMessagesInterventionId: interventionId,
        interventionMessagesStatus: 'success',
        interventionMessagesError: null,
      });
    } catch (error) {
      set({
        interventionMessagesStatus: 'error',
        interventionMessagesError: extractErrorMessage(
          error,
          'No se pudieron cargar los mensajes de la intervención.',
        ),
      });
    }
  },

  replyIntervention: async (interventionId: string, content: string) => {
    if (service === null) {
      set({
        interventionMessagesStatus: 'error',
        interventionMessagesError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionMessagesStatus: 'loading', interventionMessagesError: null });
    try {
      const message = await service.replyIntervention(interventionId, content);
      set({
        interventionMessages: [...get().interventionMessages, message],
        interventionMessagesStatus: 'success',
        interventionMessagesError: null,
      });
    } catch (error) {
      set({
        interventionMessagesStatus: 'error',
        interventionMessagesError: extractErrorMessage(
          error,
          'No se pudo enviar la respuesta del operador.',
        ),
      });
    }
  },

  closeIntervention: async (interventionId: string) => {
    if (service === null) {
      set({
        interventionsStatus: 'error',
        interventionsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ interventionsStatus: 'loading', interventionsError: null });
    try {
      const result = await service.closeIntervention(interventionId);
      const resolved = get().interventions.map((current) =>
        current.id === result.intervention_id
          ? { ...current, state: result.state, resolved_at: result.resolved_at }
          : current,
      );
      set({
        interventions: resolved,
        interventionsStatus: 'success',
        interventionsError: null,
        activeInterventionId:
          get().activeInterventionId === interventionId ? null : get().activeInterventionId,
        interventionMessages:
          get().interventionMessagesInterventionId === interventionId
            ? []
            : get().interventionMessages,
        interventionMessagesInterventionId:
          get().interventionMessagesInterventionId === interventionId
            ? null
            : get().interventionMessagesInterventionId,
      });
      // El contador de pendientes cambió tras el cierre: se refresca.
      void get().loadPendingCount();
    } catch (error) {
      set({
        interventionsStatus: 'error',
        interventionsError: extractErrorMessage(error, 'No se pudo cerrar la intervención.'),
      });
    }
  },

  loadMaintenanceConfig: async () => {
    if (service === null) {
      set({
        maintenanceStatus: 'error',
        maintenanceError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ maintenanceStatus: 'loading', maintenanceError: null });
    try {
      const maintenanceConfig = await service.getMaintenanceConfig();
      set({
        maintenanceConfig,
        maintenanceStatus: 'success',
        maintenanceError: null,
      });
    } catch (error) {
      set({
        maintenanceStatus: 'error',
        maintenanceError: extractErrorMessage(error, 'No se pudo cargar el mantenimiento.'),
      });
    }
  },

  upsertMaintenanceConfig: async (input: IMaintenanceConfigInput) => {
    if (service === null) {
      set({
        maintenanceStatus: 'error',
        maintenanceError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ maintenanceStatus: 'loading', maintenanceError: null });
    try {
      const maintenanceConfig = await service.upsertMaintenanceConfig(input);
      set({
        maintenanceConfig,
        maintenanceStatus: 'success',
        maintenanceError: null,
      });
    } catch (error) {
      set({
        maintenanceStatus: 'error',
        maintenanceError: extractErrorMessage(error, 'No se pudo guardar el mantenimiento.'),
      });
    }
  },

  loadStatsOverview: async () => {
    if (service === null) {
      set({
        statsOverviewStatus: 'error',
        statsOverviewError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ statsOverviewStatus: 'loading', statsOverviewError: null });
    try {
      const statsOverview = await service.getStatsOverview();
      set({
        statsOverview,
        statsOverviewStatus: 'success',
        statsOverviewError: null,
      });
    } catch (error) {
      set({
        statsOverviewStatus: 'error',
        statsOverviewError: extractErrorMessage(error, 'No se pudo cargar el resumen operativo.'),
      });
    }
  },

  loadActiveConversations: async () => {
    if (service === null) {
      set({
        activeConversationsStatus: 'error',
        activeConversationsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ activeConversationsStatus: 'loading', activeConversationsError: null });
    try {
      const page = await service.listActiveConversations();
      set({
        activeConversations: page.items,
        activeConversationsStatus: 'success',
        activeConversationsError: null,
      });
    } catch (error) {
      set({
        activeConversationsStatus: 'error',
        activeConversationsError: extractErrorMessage(
          error,
          'No se pudieron cargar las conversaciones activas.',
        ),
      });
    }
  },

  purgeMaintenance: async (payload: IPurgeRequest) => {
    if (service === null) {
      set({
        maintenanceActionStatus: 'error',
        maintenanceActionError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ maintenanceActionStatus: 'loading', maintenanceActionError: null });
    try {
      const maintenanceAction = await service.purgeMaintenance(payload);
      set({
        maintenanceAction,
        maintenanceActionStatus: 'success',
        maintenanceActionError: null,
      });
    } catch (error) {
      set({
        maintenanceActionStatus: 'error',
        maintenanceActionError: extractErrorMessage(error, 'No se pudo ejecutar la purga.'),
      });
    }
  },

  optimizeMaintenance: async () => {
    if (service === null) {
      set({
        maintenanceActionStatus: 'error',
        maintenanceActionError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ maintenanceActionStatus: 'loading', maintenanceActionError: null });
    try {
      const maintenanceAction = await service.optimizeMaintenance();
      set({
        maintenanceAction,
        maintenanceActionStatus: 'success',
        maintenanceActionError: null,
      });
    } catch (error) {
      set({
        maintenanceActionStatus: 'error',
        maintenanceActionError: extractErrorMessage(error, 'No se pudo ejecutar la optimización.'),
      });
    }
  },

  createBackup: async () => {
    if (service === null) {
      set({
        backupStatus: 'error',
        backupError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ backupStatus: 'loading', backupError: null });
    try {
      const backupMeta = await service.createBackup();
      set({
        backupMeta,
        backupStatus: 'success',
        backupError: null,
      });
    } catch (error) {
      set({
        backupStatus: 'error',
        backupError: extractErrorMessage(error, 'No se pudo descargar el backup.'),
      });
    }
  },

  restoreBackup: async (file: File) => {
    if (service === null) {
      set({
        restoreStatus: 'error',
        restoreError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ restoreStatus: 'loading', restoreError: null });
    try {
      const restoreResult = await service.restoreBackup(file);
      set({
        restoreResult,
        restoreStatus: 'success',
        restoreError: null,
      });
    } catch (error) {
      set({
        restoreStatus: 'error',
        restoreError: extractErrorMessage(error, 'No se pudo restaurar el backup.'),
      });
    }
  },

  loadTableStats: async () => {
    if (service === null) {
      set({
        tableStatsStatus: 'error',
        tableStatsError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ tableStatsStatus: 'loading', tableStatsError: null });
    try {
      const tableStats = await service.getTableStats();
      set({
        tableStats,
        tableStatsStatus: 'success',
        tableStatsError: null,
      });
    } catch (error) {
      set({
        tableStatsStatus: 'error',
        tableStatsError: extractErrorMessage(
          error,
          'No se pudieron cargar las métricas por tabla.',
        ),
      });
    }
  },

  runScheduledMaintenance: async () => {
    if (service === null) {
      set({
        scheduledRunStatus: 'error',
        scheduledRunError: 'La operación del bot no está disponible.',
      });
      return;
    }
    set({ scheduledRunStatus: 'loading', scheduledRunError: null });
    try {
      const scheduledRunResult = await service.runScheduledMaintenance();
      set({
        scheduledRunResult,
        scheduledRunStatus: 'success',
        scheduledRunError: null,
      });
    } catch (error) {
      set({
        scheduledRunStatus: 'error',
        scheduledRunError: extractErrorMessage(
          error,
          'No se pudo ejecutar el mantenimiento programado.',
        ),
      });
    }
  },

  reset: () =>
    set({
      contacts: [],
      contactsStatus: 'idle',
      contactsError: null,
      templates: [],
      templatesStatus: 'idle',
      templatesError: null,
      navigationTrees: [],
      navigationTreesStatus: 'idle',
      navigationTreesError: null,
      campaigns: [],
      campaignsStatus: 'idle',
      campaignsError: null,
      campaignRecipients: [],
      campaignRecipientsCampaignId: null,
      campaignRecipientsStatus: 'idle',
      campaignRecipientsError: null,
      interventions: [],
      interventionsStatus: 'idle',
      interventionsError: null,
      pendingCount: 0,
      pendingCountStatus: 'idle',
      pendingCountError: null,
      interventionMessages: [],
      interventionMessagesInterventionId: null,
      interventionMessagesStatus: 'idle',
      interventionMessagesError: null,
      activeInterventionId: null,
      maintenanceConfig: null,
      maintenanceStatus: 'idle',
      maintenanceError: null,
      statsOverview: null,
      statsOverviewStatus: 'idle',
      statsOverviewError: null,
      maintenanceAction: null,
      maintenanceActionStatus: 'idle',
      maintenanceActionError: null,
      activeConversations: [],
      activeConversationsStatus: 'idle',
      activeConversationsError: null,
      backupMeta: null,
      backupStatus: 'idle',
      backupError: null,
      restoreResult: null,
      restoreStatus: 'idle',
      restoreError: null,
      dispatchResult: null,
      dispatchStatus: 'idle',
      dispatchError: null,
      importResult: null,
      importStatus: 'idle',
      importError: null,
      recipientFiles: [],
      recipientFilesStatus: 'idle',
      recipientFilesError: null,
      recipientFilePreview: null,
      recipientFilePreviewStatus: 'idle',
      recipientFilePreviewError: null,
      tableStats: [],
      tableStatsStatus: 'idle',
      tableStatsError: null,
      scheduledRunResult: null,
      scheduledRunStatus: 'idle',
      scheduledRunError: null,
    }),
}));
