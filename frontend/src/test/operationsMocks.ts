/**
 * Helpers de prueba compartidos para la operación del bot (Bloque B): contactos,
 * plantillas, árboles de navegación, campañas, destinatarios, intervenciones y
 * mantenimiento.
 *
 * Contrato:
 * - Centraliza las factorías de DTOs y el servicio mock (`IOperationsService`)
 *   para reutilizarlos en las pruebas del store y de los componentes de Operations.
 * - Cada factoría acepta overrides parciales para construir casos específicos.
 * - Todos los DTOs de lectura extienden `IConfigSyncFields`, por lo que incluyen
 *   `revision`, `updated_at` y `deleted` además de `version` y `created_at`.
 */
import { vi } from 'vitest';
import type {
  IActiveConversationRead,
  IBackupMetaRead,
  ICampaignRead,
  ICampaignRecipientRead,
  IContactRead,
  IDispatchResultRead,
  IImportResultRead,
  IMessageSendResultRead,
  IInterventionRead,
  IMaintenanceActionRead,
  IMaintenanceConfigRead,
  IMessageRead,
  INavigationTreeRead,
  IPage,
  IRecipientFilePreviewRead,
  IRecipientFileRead,
  IRestoreResultRead,
  IScheduledRunResultRead,
  IStatsOverviewRead,
  ITableStatsRead,
  ITemplateRead,
} from '@/api/types';
import type { IOperationsService } from '@/services/operationsService';

/** Construye un contacto leído del backend (B.6). */
export function makeContact(overrides: Partial<IContactRead> = {}): IContactRead {
  return {
    id: '51111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-1',
    phone: '+521234567890',
    name: 'Ana García',
    email: 'ana@example.com',
    tags: ['ventas'],
    state: 'new',
    source: 'manual',
    external_contact_id: null,
    last_contact_at: null,
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye una plantilla de mensaje leída del backend (B.5). */
export function makeTemplate(overrides: Partial<ITemplateRead> = {}): ITemplateRead {
  return {
    id: '52222222-2222-4222-8222-222222222222',
    tenant_id: 'tenant-1',
    name: 'Bienvenida',
    body: 'Hola {{nombre}}, bienvenido a OmniBotIA.',
    template_type: 'text',
    variables: ['nombre'],
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un árbol de navegación del bot leído del backend (B.3). */
export function makeNavigationTree(
  overrides: Partial<INavigationTreeRead> = {},
): INavigationTreeRead {
  return {
    id: '53333333-3333-4333-8333-333333333333',
    tenant_id: 'tenant-1',
    name: 'Menú principal',
    num_options: 2,
    options: [
      { key: 'saludar', label: 'Saludar' },
      { key: 'comprar', label: 'Comprar' },
    ],
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye una campaña de envío leída del backend (B.4/C-2). */
export function makeCampaign(overrides: Partial<ICampaignRead> = {}): ICampaignRead {
  return {
    id: '54444444-4444-4444-8444-444444444444',
    tenant_id: 'tenant-1',
    name: 'Campaña de bienvenida',
    template_id: null,
    state: 'draft',
    schedule: null,
    segment_type: null,
    segment_config: null,
    trigger_type: null,
    trigger_event: null,
    landing_id: null,
    last_triggered_at: null,
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un destinatario de campaña leído del backend (B.4). */
export function makeCampaignRecipient(
  overrides: Partial<ICampaignRecipientRead> = {},
): ICampaignRecipientRead {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenant_id: 'tenant-1',
    campaign_id: '54444444-4444-4444-8444-444444444444',
    contact_id: '51111111-1111-4111-8111-111111111111',
    state: 'pending',
    result: null,
    attempts: 0,
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un archivo de destinatarios reutilizable leído del backend (GAP 2). */
export function makeRecipientFile(
  overrides: Partial<IRecipientFileRead> = {},
): IRecipientFileRead {
  return {
    id: '57777777-7777-4777-8777-777777777777',
    tenant_id: 'tenant-1',
    name: 'clientes-ventas.csv',
    content_type: 'text/csv',
    source_meta: { delimiter: ',', columns: ['phone', 'name'] },
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye la vista previa de contactos de un archivo de destinatarios (GAP 2). */
export function makeRecipientFilePreview(
  overrides: Partial<IRecipientFilePreviewRead> = {},
): IRecipientFilePreviewRead {
  return {
    file_id: '57777777-7777-4777-8777-777777777777',
    name: 'clientes-ventas.csv',
    total: 2,
    contacts: [
      { phone: '+521234567890', name: 'Ana García', state: 'new' },
      { phone: '+521198765432', name: 'Luis Pérez', state: 'new' },
    ],
    ...overrides,
  };
}

/** Construye una intervención humana leída del backend (B.7). */
export function makeIntervention(overrides: Partial<IInterventionRead> = {}): IInterventionRead {
  return {
    id: '56666666-6666-4666-8666-666666666666',
    tenant_id: 'tenant-1',
    conversation_id: '88888888-8888-4888-8888-888888888888',
    state: 'pending',
    operator: null,
    notes: null,
    assigned_at: null,
    resolved_at: null,
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un mensaje de la conversación de una intervención (workspace B.7). */
export function makeMessage(overrides: Partial<IMessageRead> = {}): IMessageRead {
  return {
    id: '58888888-8888-4888-8888-888888888888',
    tenant_id: 'tenant-1',
    conversation_id: '88888888-8888-4888-8888-888888888888',
    direction: 'inbound',
    content: 'Hola, necesito ayuda con mi pedido.',
    provider_used: null,
    tokens_used: 0,
    message_id: null,
    queue_status: 'processed',
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye la configuración de mantenimiento leída del backend (B.9). */
export function makeMaintenanceConfig(
  overrides: Partial<IMaintenanceConfigRead> = {},
): IMaintenanceConfigRead {
  return {
    id: '57777777-7777-4777-8777-777777777777',
    tenant_id: 'tenant-1',
    retention_rules: { conversations: 90 },
    maintenance_schedule: '0 3 * * *',
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye el resumen operativo del bot del tenant (B.1 + B.2). */
export function makeStatsOverview(overrides: Partial<IStatsOverviewRead> = {}): IStatsOverviewRead {
  return {
    tenant_id: 'tenant-1',
    active_conversations: 3,
    inbound_messages: 2,
    outbound_messages: 1,
    total_messages: 3,
    escalated: 2,
    resolved: 1,
    resolved_ratio: 0.5,
    unique_contacts: 2,
    daily: [{ date: '2026-08-19', inbound: 2, outbound: 1, total: 3 }],
    by_channel: [
      {
        channel_id: '44444444-4444-4444-8444-444444444444',
        conversation_count: 3,
        message_count: 3,
      },
    ],
    ...overrides,
  };
}

/** Construye el resultado de una acción de mantenimiento del bot (B.9). */
export function makeMaintenanceAction(
  overrides: Partial<IMaintenanceActionRead> = {},
): IMaintenanceActionRead {
  return {
    tenant_id: 'tenant-1',
    action: 'purge',
    deleted_conversations: 2,
    deleted_messages: 4,
    deleted_documents: 0,
    deleted_synonyms: 0,
    deleted_configs: 0,
    duration_ms: 12,
    message: 'Se eliminaron los datos expirados del tenant.',
    ...overrides,
  };
}

/** Construye el resultado de un despacho de campaña (C-2). */
export function makeDispatchResult(
  overrides: Partial<IDispatchResultRead> = {},
): IDispatchResultRead {
  return {
    campaigns_processed: 1,
    recipients_sent: 2,
    recipients_failed: 0,
    recipients_skipped: 0,
    ...overrides,
  };
}

/** Construye el resultado de un envío individual (B.4). */
export function makeMessageSendResult(
  overrides: Partial<IMessageSendResultRead> = {},
): IMessageSendResultRead {
  return {
    state: 'sent',
    result: 'Mensaje enviado correctamente.',
    contact_id: '51111111-1111-4111-8111-111111111111',
    phone: '+521234567890',
    ...overrides,
  };
}

/** Construye el resultado de una importación masiva (B.4/B.6). */
export function makeImportResult(overrides: Partial<IImportResultRead> = {}): IImportResultRead {
  return {
    created: 2,
    skipped: 0,
    failed: 0,
    errors: [],
    ...overrides,
  };
}

/** Construye una página del backend con los ítems dados. */
export function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye una conversación activa leída del backend (Monitor Fase 7). */
export function makeActiveConversation(
  overrides: Partial<IActiveConversationRead> = {},
): IActiveConversationRead {
  return {
    id: '59999999-9999-4999-8999-999999999999',
    tenant_id: 'tenant-1',
    channel_id: '61111111-1111-4111-8111-111111111111',
    external_contact_id: '+521234567890',
    state: 'new',
    is_active: true,
    message_count: 3,
    unread_count: 1,
    last_message_content: 'Hola, necesito ayuda con mi pedido.',
    last_message_direction: 'inbound',
    last_message_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye los metadatos de un backup descargado del tenant (B.9). */
export function makeBackupMeta(overrides: Partial<IBackupMetaRead> = {}): IBackupMetaRead {
  return {
    format: 'omnibotia-operations-backup',
    version: 1,
    tenant_id: 'tenant-1',
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye el resultado de una restauración de backup (B.9). */
export function makeRestoreResult(overrides: Partial<IRestoreResultRead> = {}): IRestoreResultRead {
  return {
    tenant_id: 'tenant-1',
    restored: { contacts: 2, templates: 1 },
    message: 'Backup restaurado correctamente.',
    ...overrides,
  };
}

/** Construye las métricas de una tabla del tenant (B.9 Estado). */
export function makeTableStats(overrides: Partial<ITableStatsRead> = {}): ITableStatsRead {
  return {
    table_name: 'bot_contacts',
    total: 10,
    active: 8,
    inactive: 2,
    ...overrides,
  };
}

/** Construye el resultado de un lote de mantenimiento programado ejecutado (B.9). */
export function makeScheduledRunResult(
  overrides: Partial<IScheduledRunResultRead> = {},
): IScheduledRunResultRead {
  return {
    tenant_id: 'tenant-1',
    tasks: [
      {
        table: 'conversations',
        operation: 'purge',
        status: 'ok',
        executed_at: '2026-08-19T12:00:00Z',
        message: 'Purga completada.',
      },
    ],
    duration_ms: 42,
    message: 'Mantenimiento programado ejecutado.',
    ...overrides,
  };
}

/** Construye un servicio de operación del bot con todas las dependencias mockeadas. */
export function makeService(overrides: Partial<IOperationsService> = {}): IOperationsService {
  return {
    listContacts: vi.fn<IOperationsService['listContacts']>().mockResolvedValue(makePage([])),
    createContact: vi.fn<IOperationsService['createContact']>().mockResolvedValue(makeContact()),
    getContact: vi.fn<IOperationsService['getContact']>().mockResolvedValue(makeContact()),
    updateContact: vi.fn<IOperationsService['updateContact']>().mockResolvedValue(makeContact()),
    deleteContact: vi.fn<IOperationsService['deleteContact']>().mockResolvedValue(undefined),
    listTemplates: vi.fn<IOperationsService['listTemplates']>().mockResolvedValue(makePage([])),
    createTemplate: vi.fn<IOperationsService['createTemplate']>().mockResolvedValue(makeTemplate()),
    getTemplate: vi.fn<IOperationsService['getTemplate']>().mockResolvedValue(makeTemplate()),
    updateTemplate: vi.fn<IOperationsService['updateTemplate']>().mockResolvedValue(makeTemplate()),
    deleteTemplate: vi.fn<IOperationsService['deleteTemplate']>().mockResolvedValue(undefined),
    listNavigationTrees: vi
      .fn<IOperationsService['listNavigationTrees']>()
      .mockResolvedValue(makePage([])),
    createNavigationTree: vi
      .fn<IOperationsService['createNavigationTree']>()
      .mockResolvedValue(makeNavigationTree()),
    getNavigationTree: vi
      .fn<IOperationsService['getNavigationTree']>()
      .mockResolvedValue(makeNavigationTree()),
    updateNavigationTree: vi
      .fn<IOperationsService['updateNavigationTree']>()
      .mockResolvedValue(makeNavigationTree()),
    deleteNavigationTree: vi
      .fn<IOperationsService['deleteNavigationTree']>()
      .mockResolvedValue(undefined),
    listCampaigns: vi.fn<IOperationsService['listCampaigns']>().mockResolvedValue(makePage([])),
    createCampaign: vi.fn<IOperationsService['createCampaign']>().mockResolvedValue(makeCampaign()),
    getCampaign: vi.fn<IOperationsService['getCampaign']>().mockResolvedValue(makeCampaign()),
    updateCampaign: vi.fn<IOperationsService['updateCampaign']>().mockResolvedValue(makeCampaign()),
    deleteCampaign: vi.fn<IOperationsService['deleteCampaign']>().mockResolvedValue(undefined),
    addCampaignRecipient: vi
      .fn<IOperationsService['addCampaignRecipient']>()
      .mockResolvedValue(makeCampaignRecipient()),
    listCampaignRecipients: vi
      .fn<IOperationsService['listCampaignRecipients']>()
      .mockResolvedValue(makePage([])),
    updateCampaignRecipient: vi
      .fn<IOperationsService['updateCampaignRecipient']>()
      .mockResolvedValue(makeCampaignRecipient()),
    dispatchCampaign: vi
      .fn<IOperationsService['dispatchCampaign']>()
      .mockResolvedValue(makeDispatchResult()),
    sendIndividualMessage: vi
      .fn<IOperationsService['sendIndividualMessage']>()
      .mockResolvedValue(makeMessageSendResult()),
    importContactsCsv: vi
      .fn<IOperationsService['importContactsCsv']>()
      .mockResolvedValue(makeImportResult()),
    importCampaignRecipientsCsv: vi
      .fn<IOperationsService['importCampaignRecipientsCsv']>()
      .mockResolvedValue(makeImportResult()),
    uploadRecipientFile: vi
      .fn<IOperationsService['uploadRecipientFile']>()
      .mockResolvedValue(makeRecipientFile()),
    listRecipientFiles: vi
      .fn<IOperationsService['listRecipientFiles']>()
      .mockResolvedValue(makePage([makeRecipientFile()])),
    previewRecipientFile: vi
      .fn<IOperationsService['previewRecipientFile']>()
      .mockResolvedValue(makeRecipientFilePreview()),
    dispatchCampaignFromFile: vi
      .fn<IOperationsService['dispatchCampaignFromFile']>()
      .mockResolvedValue(makeDispatchResult()),
    listInterventions: vi
      .fn<IOperationsService['listInterventions']>()
      .mockResolvedValue(makePage([])),
    createIntervention: vi
      .fn<IOperationsService['createIntervention']>()
      .mockResolvedValue(makeIntervention()),
    getIntervention: vi
      .fn<IOperationsService['getIntervention']>()
      .mockResolvedValue(makeIntervention()),
    updateIntervention: vi
      .fn<IOperationsService['updateIntervention']>()
      .mockResolvedValue(makeIntervention()),
    getInterventionsPendingCount: vi
      .fn<IOperationsService['getInterventionsPendingCount']>()
      .mockResolvedValue({ state: 'pending', count: 0 }),
    assignIntervention: vi
      .fn<IOperationsService['assignIntervention']>()
      .mockResolvedValue(makeIntervention({ state: 'assigned', operator: 'Ana Operadora' })),
    listInterventionMessages: vi
      .fn<IOperationsService['listInterventionMessages']>()
      .mockResolvedValue([]),
    replyIntervention: vi
      .fn<IOperationsService['replyIntervention']>()
      .mockResolvedValue(
        makeMessage({ direction: 'outbound', content: 'Respondido por el operador' }),
      ),
    closeIntervention: vi.fn<IOperationsService['closeIntervention']>().mockResolvedValue({
      intervention_id: '56666666-6666-4666-8666-666666666666',
      state: 'resolved',
      resolved_at: '2026-08-19T12:00:00Z',
      message: 'Intervención cerrada.',
    }),
    getMaintenanceConfig: vi
      .fn<IOperationsService['getMaintenanceConfig']>()
      .mockResolvedValue(null),
    upsertMaintenanceConfig: vi
      .fn<IOperationsService['upsertMaintenanceConfig']>()
      .mockResolvedValue(makeMaintenanceConfig()),
    getStatsOverview: vi
      .fn<IOperationsService['getStatsOverview']>()
      .mockResolvedValue(makeStatsOverview()),
    purgeMaintenance: vi
      .fn<IOperationsService['purgeMaintenance']>()
      .mockResolvedValue(makeMaintenanceAction()),
    optimizeMaintenance: vi
      .fn<IOperationsService['optimizeMaintenance']>()
      .mockResolvedValue(makeMaintenanceAction({ action: 'optimize', duration_ms: 8 })),
    listActiveConversations: vi
      .fn<IOperationsService['listActiveConversations']>()
      .mockResolvedValue(makePage([makeActiveConversation()])),
    createBackup: vi.fn<IOperationsService['createBackup']>().mockResolvedValue(makeBackupMeta()),
    restoreBackup: vi
      .fn<IOperationsService['restoreBackup']>()
      .mockResolvedValue(makeRestoreResult()),
    getTableStats: vi
      .fn<IOperationsService['getTableStats']>()
      .mockResolvedValue([makeTableStats()]),
    runScheduledMaintenance: vi
      .fn<IOperationsService['runScheduledMaintenance']>()
      .mockResolvedValue(makeScheduledRunResult()),
    ...overrides,
  };
}
