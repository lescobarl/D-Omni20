/**
 * Servicio del subsistema CRM (P3) — pipeline "Ventas", tareas, SLA, embudo y
 * resumen del cliente — puerto + implementación.
 *
 * Contrato:
 * - `ICrmService` es el puerto consumido por la UI y el store del CRM.
 * - `BackendCrmService` implementa el puerto vía `IApiClient`, traduciendo los
 *   inputs de dominio (camelCase) a los DTO del backend (snake_case) y
 *   aplicando los valores por defecto del contrato (probabilidad 0, moneda
 *   `USD`, estado de tarea `pending`, prioridad `medium`).
 * - `updateStage`/`updateDeal`/`updateTask` traducen únicamente los campos
 *   presentes (PATCH).
 * - La fábrica `createCrmService` es el punto de inyección (composition root).
 */
import type { IApiClient } from '@/api/client';
import type {
  CrmCurrency,
  CrmStageOutcome,
  CrmTaskPriority,
  CrmTaskStatus,
  ICrmDealsQuery,
  ICrmSummaryRead,
  ICrmTasksQuery,
  IDealCreate,
  IDealRead,
  IDealUpdate,
  IFunnelRead,
  IPage,
  ISlaRead,
  ISlaUpsert,
  IStageChangeRead,
  IStageCreate,
  IStageRead,
  IStageUpdate,
  ITaskCreate,
  ITaskRead,
  ITaskUpdate,
} from '@/api/types';
import type { ILogger } from '@/lib/logger';

/** Entrada de dominio para crear o actualizar una etapa del pipeline (P3). */
export interface IStageInput {
  /** Nombre de la etapa (1-64 caracteres, obligatorio). */
  name: string;
  /** Orden de presentación (>= 0, por defecto 0). */
  order?: number;
  /** Probabilidad por defecto 0-100 (por defecto 0). */
  defaultProbability?: number;
  /** Indica si la etapa cierra la oportunidad (por defecto `false`). */
  isTerminal?: boolean;
  /** Resultado estructural del cierre; exigido si `isTerminal` es `true`. */
  outcome?: CrmStageOutcome | null;
}

/** Entrada de dominio para crear o actualizar una oportunidad (P3, M1). */
export interface IDealInput {
  /** Título de la oportunidad (1-255 caracteres, obligatorio). */
  title: string;
  /** Etapa inicial de la oportunidad. */
  stageId: string;
  /** Importe en unidades menores (>= 0, por defecto 0). */
  amountMinor?: number;
  /** Moneda (por defecto `USD`). */
  currency?: CrmCurrency;
  /** Probabilidad 0-100 (por defecto 0). */
  probability?: number;
  /** Vendedor responsable (opcional). */
  ownerId?: string | null;
  /** Contacto vinculado (opcional). */
  contactId?: string | null;
  /** Lead de origen (opcional). */
  leadId?: string | null;
  /** Cotización vinculada (opcional). */
  quoteId?: string | null;
  /** Pago vinculado (opcional). */
  paymentId?: string | null;
  /** Fecha esperada de cierre (ISO 8601 `YYYY-MM-DD`, opcional). */
  expectedCloseAt?: string | null;
  /** Metadatos libres (por defecto `{}`). */
  metadata?: Record<string, unknown>;
}

/** Entrada de dominio para actualizar una oportunidad (PATCH, incluye mover de etapa). */
export interface IDealUpdateInput extends Partial<IDealInput> {
  /** Nota del movimiento (máx. 4000 caracteres, opcional). */
  note?: string;
  /** Razón de cierre perdido; obligatoria si el cierre es `lost`. */
  lostReason?: string;
}

/** Entrada de dominio para crear o actualizar una tarea de seguimiento (P3, M2). */
export interface ITaskInput {
  /** Oportunidad vinculada (opcional; el endpoint `/deals/{id}/tasks` lo ancla). */
  dealId?: string | null;
  /** Contacto vinculado (opcional). */
  contactId?: string | null;
  /** Título de la tarea (1-255 caracteres, obligatorio). */
  title: string;
  /** Fecha límite (ISO 8601, opcional). */
  dueAt?: string | null;
  /** Estado (por defecto `pending`). */
  status?: CrmTaskStatus;
  /** Prioridad (por defecto `medium`). */
  priority?: CrmTaskPriority;
  /** Responsable (opcional). */
  assigneeId?: string | null;
}

/** Entrada de dominio para la política SLA de una etapa (P3, M5). */
export interface ISlaInput {
  /** Etapa a la que aplica la política. */
  stageId: string;
  /** Horas máximas para responder (>= 0). */
  maxResponseHours: number;
  /** Días máximos de permanencia en la etapa (>= 0). */
  maxStayDays: number;
}

/** Puerto del subsistema CRM consumido por la UI (P3). */
export interface ICrmService {
  /** Lista las etapas del pipeline del tenant activo (orden estable). */
  listStages(): Promise<IStageRead[]>;
  /** Crea una etapa del pipeline traduciendo el input de dominio al DTO. */
  createStage(input: IStageInput): Promise<IStageRead>;
  /** Devuelve una etapa del pipeline por su identificador. */
  getStage(stageId: string): Promise<IStageRead>;
  /** Actualiza parcialmente una etapa traduciendo solo los campos presentes. */
  updateStage(stageId: string, input: Partial<IStageInput>): Promise<IStageRead>;
  /** Elimina lógicamente una etapa del pipeline. */
  deleteStage(stageId: string): Promise<void>;
  /** Lista las oportunidades del tenant activo (paginado + filtros). */
  listDeals(query?: ICrmDealsQuery): Promise<IPage<IDealRead>>;
  /** Crea una oportunidad traduciendo el input de dominio al DTO. */
  createDeal(input: IDealInput): Promise<IDealRead>;
  /** Devuelve una oportunidad por su identificador. */
  getDeal(dealId: string): Promise<IDealRead>;
  /** Actualiza parcialmente una oportunidad (incluye mover de etapa). */
  updateDeal(dealId: string, input: IDealUpdateInput): Promise<IDealRead>;
  /** Elimina lógicamente una oportunidad. */
  deleteDeal(dealId: string): Promise<void>;
  /** Devuelve el historial de movimientos de etapa de una oportunidad. */
  listDealHistory(dealId: string): Promise<IStageChangeRead[]>;
  /** Lista las tareas vinculadas a una oportunidad (paginado). */
  listDealTasks(dealId: string, query?: ICrmTasksQuery): Promise<IPage<ITaskRead>>;
  /** Crea una tarea anclada a una oportunidad. */
  createDealTask(dealId: string, input: ITaskInput): Promise<ITaskRead>;
  /** Lista las tareas del tenant activo (paginado + filtro por deal). */
  listTasks(query?: ICrmTasksQuery): Promise<IPage<ITaskRead>>;
  /** Crea una tarea de seguimiento traduciendo el input de dominio al DTO. */
  createTask(input: ITaskInput): Promise<ITaskRead>;
  /** Devuelve una tarea por su identificador. */
  getTask(taskId: string): Promise<ITaskRead>;
  /** Actualiza parcialmente una tarea traduciendo solo los campos presentes. */
  updateTask(taskId: string, input: Partial<ITaskInput>): Promise<ITaskRead>;
  /** Elimina lógicamente una tarea. */
  deleteTask(taskId: string): Promise<void>;
  /** Lista las políticas SLA por etapa del tenant activo. */
  listSla(): Promise<ISlaRead[]>;
  /** Crea o actualiza la política SLA de una etapa traduciendo el input. */
  upsertSla(input: ISlaInput): Promise<ISlaRead>;
  /** Devuelve el reporte del embudo comercial del tenant activo. */
  getFunnel(): Promise<IFunnelRead>;
  /** Devuelve el resumen de oportunidades de un cliente por email (P4, portal). */
  getCrmSummary(email: string): Promise<ICrmSummaryRead>;
}

/** Implementación del puerto `ICrmService` vía `IApiClient` (DI). */
export class BackendCrmService implements ICrmService {
  constructor(
    private readonly apiClient: IApiClient,
    private readonly logger?: ILogger,
  ) {}

  /** Lista las etapas del pipeline del tenant (orden estable). */
  public async listStages(): Promise<IStageRead[]> {
    this.logger?.debug('crm.stages.list', {});
    return this.apiClient.listStages();
  }

  /** Crea una etapa traduciendo el input de dominio al DTO del backend. */
  public async createStage(input: IStageInput): Promise<IStageRead> {
    this.logger?.debug('crm.stages.create', { name: input.name });
    const payload: IStageCreate = {
      name: input.name,
      order: input.order ?? 0,
      default_probability: input.defaultProbability ?? 0,
      is_terminal: input.isTerminal ?? false,
      outcome: input.outcome ?? undefined,
    };
    return this.apiClient.createStage(payload);
  }

  /** Devuelve una etapa del pipeline por su identificador. */
  public async getStage(stageId: string): Promise<IStageRead> {
    this.logger?.debug('crm.stages.get', { stageId });
    return this.apiClient.getStage(stageId);
  }

  /** Actualiza una etapa traduciendo solo los campos presentes (PATCH). */
  public async updateStage(stageId: string, input: Partial<IStageInput>): Promise<IStageRead> {
    this.logger?.debug('crm.stages.update', { stageId });
    const payload: IStageUpdate = {};
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.order !== undefined) {
      payload.order = input.order;
    }
    if (input.defaultProbability !== undefined) {
      payload.default_probability = input.defaultProbability;
    }
    if (input.isTerminal !== undefined) {
      payload.is_terminal = input.isTerminal;
    }
    if (input.outcome !== undefined) {
      payload.outcome = input.outcome;
    }
    return this.apiClient.updateStage(stageId, payload);
  }

  /** Elimina lógicamente una etapa del pipeline. */
  public async deleteStage(stageId: string): Promise<void> {
    this.logger?.debug('crm.stages.delete', { stageId });
    await this.apiClient.deleteStage(stageId);
  }

  /** Lista las oportunidades del tenant (paginado + filtros). */
  public async listDeals(query?: ICrmDealsQuery): Promise<IPage<IDealRead>> {
    this.logger?.debug('crm.deals.list', {});
    return this.apiClient.listDeals(query);
  }

  /** Crea una oportunidad traduciendo el input de dominio al DTO del backend. */
  public async createDeal(input: IDealInput): Promise<IDealRead> {
    this.logger?.debug('crm.deals.create', { title: input.title });
    const payload: IDealCreate = {
      title: input.title,
      stage_id: input.stageId,
      amount_minor: input.amountMinor ?? 0,
      currency: input.currency ?? 'USD',
      probability: input.probability ?? 0,
      owner_id: input.ownerId ?? undefined,
      contact_id: input.contactId ?? undefined,
      lead_id: input.leadId ?? undefined,
      quote_id: input.quoteId ?? undefined,
      payment_id: input.paymentId ?? undefined,
      expected_close_at: input.expectedCloseAt ?? undefined,
      metadata: input.metadata ?? undefined,
    };
    return this.apiClient.createDeal(payload);
  }

  /** Devuelve una oportunidad por su identificador. */
  public async getDeal(dealId: string): Promise<IDealRead> {
    this.logger?.debug('crm.deals.get', { dealId });
    return this.apiClient.getDeal(dealId);
  }

  /** Actualiza una oportunidad traduciendo solo los campos presentes (PATCH). */
  public async updateDeal(dealId: string, input: IDealUpdateInput): Promise<IDealRead> {
    this.logger?.debug('crm.deals.update', { dealId });
    const payload: IDealUpdate = {};
    if (input.title !== undefined) {
      payload.title = input.title;
    }
    if (input.stageId !== undefined) {
      payload.stage_id = input.stageId;
    }
    if (input.amountMinor !== undefined) {
      payload.amount_minor = input.amountMinor;
    }
    if (input.currency !== undefined) {
      payload.currency = input.currency;
    }
    if (input.probability !== undefined) {
      payload.probability = input.probability;
    }
    if (input.ownerId !== undefined) {
      payload.owner_id = input.ownerId;
    }
    if (input.contactId !== undefined) {
      payload.contact_id = input.contactId;
    }
    if (input.leadId !== undefined) {
      payload.lead_id = input.leadId;
    }
    if (input.quoteId !== undefined) {
      payload.quote_id = input.quoteId;
    }
    if (input.paymentId !== undefined) {
      payload.payment_id = input.paymentId;
    }
    if (input.expectedCloseAt !== undefined) {
      payload.expected_close_at = input.expectedCloseAt;
    }
    if (input.metadata !== undefined) {
      payload.metadata = input.metadata;
    }
    if (input.note !== undefined) {
      payload.note = input.note;
    }
    if (input.lostReason !== undefined) {
      payload.lost_reason = input.lostReason;
    }
    return this.apiClient.updateDeal(dealId, payload);
  }

  /** Elimina lógicamente una oportunidad. */
  public async deleteDeal(dealId: string): Promise<void> {
    this.logger?.debug('crm.deals.delete', { dealId });
    await this.apiClient.deleteDeal(dealId);
  }

  /** Devuelve el historial de movimientos de etapa de una oportunidad. */
  public async listDealHistory(dealId: string): Promise<IStageChangeRead[]> {
    this.logger?.debug('crm.deals.history', { dealId });
    return this.apiClient.listDealHistory(dealId);
  }

  /** Lista las tareas vinculadas a una oportunidad (paginado). */
  public async listDealTasks(dealId: string, query?: ICrmTasksQuery): Promise<IPage<ITaskRead>> {
    this.logger?.debug('crm.deals.tasks.list', { dealId });
    return this.apiClient.listDealTasks(dealId, query);
  }

  /** Crea una tarea anclada a una oportunidad. */
  public async createDealTask(dealId: string, input: ITaskInput): Promise<ITaskRead> {
    this.logger?.debug('crm.deals.tasks.create', { dealId, title: input.title });
    const payload: ITaskCreate = {
      deal_id: dealId,
      contact_id: input.contactId ?? undefined,
      title: input.title,
      due_at: input.dueAt ?? undefined,
      status: input.status ?? 'pending',
      priority: input.priority ?? 'medium',
      assignee_id: input.assigneeId ?? undefined,
    };
    return this.apiClient.createDealTask(dealId, payload);
  }

  /** Lista las tareas del tenant (paginado + filtro por deal). */
  public async listTasks(query?: ICrmTasksQuery): Promise<IPage<ITaskRead>> {
    this.logger?.debug('crm.tasks.list', {});
    return this.apiClient.listTasks(query);
  }

  /** Crea una tarea traduciendo el input de dominio al DTO del backend. */
  public async createTask(input: ITaskInput): Promise<ITaskRead> {
    this.logger?.debug('crm.tasks.create', { title: input.title });
    const payload: ITaskCreate = {
      deal_id: input.dealId ?? undefined,
      contact_id: input.contactId ?? undefined,
      title: input.title,
      due_at: input.dueAt ?? undefined,
      status: input.status ?? 'pending',
      priority: input.priority ?? 'medium',
      assignee_id: input.assigneeId ?? undefined,
    };
    return this.apiClient.createTask(payload);
  }

  /** Devuelve una tarea por su identificador. */
  public async getTask(taskId: string): Promise<ITaskRead> {
    this.logger?.debug('crm.tasks.get', { taskId });
    return this.apiClient.getTask(taskId);
  }

  /** Actualiza una tarea traduciendo solo los campos presentes (PATCH). */
  public async updateTask(taskId: string, input: Partial<ITaskInput>): Promise<ITaskRead> {
    this.logger?.debug('crm.tasks.update', { taskId });
    const payload: ITaskUpdate = {};
    if (input.dealId !== undefined) {
      payload.deal_id = input.dealId;
    }
    if (input.contactId !== undefined) {
      payload.contact_id = input.contactId;
    }
    if (input.title !== undefined) {
      payload.title = input.title;
    }
    if (input.dueAt !== undefined) {
      payload.due_at = input.dueAt;
    }
    if (input.status !== undefined) {
      payload.status = input.status;
    }
    if (input.priority !== undefined) {
      payload.priority = input.priority;
    }
    if (input.assigneeId !== undefined) {
      payload.assignee_id = input.assigneeId;
    }
    return this.apiClient.updateTask(taskId, payload);
  }

  /** Elimina lógicamente una tarea. */
  public async deleteTask(taskId: string): Promise<void> {
    this.logger?.debug('crm.tasks.delete', { taskId });
    await this.apiClient.deleteTask(taskId);
  }

  /** Lista las políticas SLA por etapa del tenant. */
  public async listSla(): Promise<ISlaRead[]> {
    this.logger?.debug('crm.sla.list', {});
    return this.apiClient.listSla();
  }

  /** Crea o actualiza la política SLA de una etapa traduciendo el input. */
  public async upsertSla(input: ISlaInput): Promise<ISlaRead> {
    this.logger?.debug('crm.sla.upsert', { stageId: input.stageId });
    const payload: ISlaUpsert = {
      stage_id: input.stageId,
      max_response_hours: input.maxResponseHours,
      max_stay_days: input.maxStayDays,
    };
    return this.apiClient.upsertSla(payload);
  }

  /** Devuelve el reporte del embudo comercial del tenant. */
  public async getFunnel(): Promise<IFunnelRead> {
    this.logger?.debug('crm.funnel.get', {});
    return this.apiClient.getFunnel();
  }

  /** Devuelve el resumen de oportunidades de un cliente por email (P4, portal). */
  public async getCrmSummary(email: string): Promise<ICrmSummaryRead> {
    this.logger?.debug('crm.summary.get', { email });
    return this.apiClient.getCrmSummary(email);
  }
}

/**
 * Crea un servicio del subsistema CRM listo para el composition root.
 * @param apiClient - Cliente HTTP tipado del backend.
 * @param logger - Logger opcional (inyectado para trazabilidad).
 * @returns Implementación concreta de `ICrmService`.
 */
export function createCrmService(apiClient: IApiClient, logger?: ILogger): ICrmService {
  return new BackendCrmService(apiClient, logger);
}
