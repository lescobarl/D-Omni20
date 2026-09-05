/**
 * Store del subsistema CRM (P3) — pipeline "Ventas", tareas, SLA, embudo y
 * resumen del cliente (eslabones ⑤ y ⑥ de LAE Omni2.0).
 *
 * Contrato:
 * - Registro de servicios por DI: `setCrmService`/`getCrmService` inyectan la
 *   implementación `ICrmService` desde el composition root (`main.tsx`),
 *   activada por la feature flag `crm`.
 * - Si no hay servicio registrado, todas las acciones pasan a estado de error para
 *   que la UI conviva sin la dependencia (p. ej. en pruebas). El CRM es opcional
 *   y fail-closed: nunca bloquea las demás áreas del panel de operación.
 * - Cada colección (etapas, oportunidades, tareas, SLA y embudo) mantiene su
 *   propio estado de carga para no bloquear las demás áreas del CRM.
 */
import { create } from 'zustand';
import type {
  ICrmSummaryRead,
  IDealRead,
  IFunnelRead,
  ISlaRead,
  IStageChangeRead,
  IStageRead,
  ITaskRead,
} from '@/api/types';
import { AppError } from '@/lib/errors';
import type {
  ICrmService,
  IDealInput,
  IDealUpdateInput,
  IStageInput,
  ISlaInput,
  ITaskInput,
} from '@/services/crmService';

/** Estado de un flujo del subsistema CRM. */
export type CrmStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store del subsistema CRM. */
export interface ICrmState {
  /** Etapas del pipeline del tenant cargadas (P3, M1). */
  stages: IStageRead[];
  /** Estado del flujo de etapas. */
  stagesStatus: CrmStatus;
  /** Mensaje del último error del flujo de etapas (o `null`). */
  stagesError: string | null;

  /** Oportunidades del pipeline del tenant cargadas (P3, M1). */
  deals: IDealRead[];
  /** Estado del flujo de oportunidades. */
  dealsStatus: CrmStatus;
  /** Mensaje del último error del flujo de oportunidades (o `null`). */
  dealsError: string | null;

  /** Tareas de seguimiento del tenant cargadas (P3, M2). */
  tasks: ITaskRead[];
  /** Estado del flujo de tareas. */
  tasksStatus: CrmStatus;
  /** Mensaje del último error del flujo de tareas (o `null`). */
  tasksError: string | null;

  /** Políticas SLA por etapa del tenant cargadas (P3, M5). */
  sla: ISlaRead[];
  /** Estado del flujo de SLA. */
  slaStatus: CrmStatus;
  /** Mensaje del último error del flujo de SLA (o `null`). */
  slaError: string | null;

  /** Reporte del embudo comercial del tenant (P3, M4). */
  funnel: IFunnelRead | null;
  /** Estado del flujo del embudo. */
  funnelStatus: CrmStatus;
  /** Mensaje del último error del flujo del embudo (o `null`). */
  funnelError: string | null;

  /** Resumen de oportunidades de un cliente por email (P4, portal). */
  summary: ICrmSummaryRead | null;
  /** Estado del flujo del resumen. */
  summaryStatus: CrmStatus;
  /** Mensaje del último error del flujo del resumen (o `null`). */
  summaryError: string | null;

  /** Carga las etapas del pipeline del tenant. */
  listStages(): Promise<void>;
  /** Crea una etapa y la agrega a la colección. */
  createStage(input: IStageInput): Promise<void>;
  /** Actualiza una etapa y refresca la colección. */
  updateStage(stageId: string, input: Partial<IStageInput>): Promise<void>;
  /** Elimina una etapa y la quita de la colección. */
  deleteStage(stageId: string): Promise<void>;

  /** Carga las oportunidades del pipeline del tenant. */
  listDeals(): Promise<void>;
  /** Crea una oportunidad y la agrega a la colección. */
  createDeal(input: IDealInput): Promise<void>;
  /** Actualiza una oportunidad (incluye mover de etapa) y refresca la colección. */
  updateDeal(dealId: string, input: IDealUpdateInput): Promise<void>;
  /** Elimina una oportunidad y la quita de la colección. */
  deleteDeal(dealId: string): Promise<void>;
  /** Carga el historial de movimientos de etapa de una oportunidad. */
  listDealHistory(dealId: string): Promise<IStageChangeRead[]>;
  /** Crea una tarea anclada a una oportunidad y refresca las tareas. */
  createDealTask(dealId: string, input: ITaskInput): Promise<void>;

  /** Carga las tareas del tenant activo. */
  listTasks(): Promise<void>;
  /** Crea una tarea y la agrega a la colección. */
  createTask(input: ITaskInput): Promise<void>;
  /** Actualiza una tarea y refresca la colección. */
  updateTask(taskId: string, input: Partial<ITaskInput>): Promise<void>;
  /** Elimina una tarea y la quita de la colección. */
  deleteTask(taskId: string): Promise<void>;

  /** Carga las políticas SLA por etapa del tenant. */
  listSla(): Promise<void>;
  /** Crea o actualiza una política SLA y refresca la colección. */
  upsertSla(input: ISlaInput): Promise<void>;

  /** Carga el reporte del embudo comercial del tenant. */
  getFunnel(): Promise<void>;
  /** Carga el resumen de oportunidades de un cliente por email (P4, portal). */
  getCrmSummary(email: string): Promise<void>;

  /** Reinicia el estado al inicial por defecto. */
  reset(): void;
}

/** Implementación registrada del servicio (DI). */
let service: ICrmService | null = null;

/**
 * Registra la implementación del servicio del CRM (composition root).
 * @param implementation - Implementación de `ICrmService` (o `null` en pruebas).
 */
export function setCrmService(implementation: ICrmService | null): void {
  service = implementation;
}

/** Devuelve la implementación registrada del servicio del CRM (o `null`). */
export function getCrmService(): ICrmService | null {
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

/** Store global del subsistema CRM. */
export const useCrmStore = create<ICrmState>()((set, get) => ({
  stages: [],
  stagesStatus: 'idle',
  stagesError: null,

  deals: [],
  dealsStatus: 'idle',
  dealsError: null,

  tasks: [],
  tasksStatus: 'idle',
  tasksError: null,

  sla: [],
  slaStatus: 'idle',
  slaError: null,

  funnel: null,
  funnelStatus: 'idle',
  funnelError: null,

  summary: null,
  summaryStatus: 'idle',
  summaryError: null,

  listStages: async () => {
    if (service === null) {
      set({
        stagesStatus: 'error',
        stagesError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ stagesStatus: 'loading', stagesError: null });
    try {
      const stages = await service.listStages();
      set({ stages, stagesStatus: 'success', stagesError: null });
    } catch (error) {
      set({
        stagesStatus: 'error',
        stagesError: extractErrorMessage(error, 'No se pudieron cargar las etapas del pipeline.'),
      });
    }
  },

  createStage: async (input: IStageInput) => {
    if (service === null) {
      set({
        stagesStatus: 'error',
        stagesError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ stagesStatus: 'loading', stagesError: null });
    try {
      const stage = await service.createStage(input);
      set({
        stages: [...get().stages, stage].sort((a, b) => a.order - b.order),
        stagesStatus: 'success',
        stagesError: null,
      });
    } catch (error) {
      set({
        stagesStatus: 'error',
        stagesError: extractErrorMessage(error, 'No se pudo crear la etapa del pipeline.'),
      });
    }
  },

  updateStage: async (stageId: string, input: Partial<IStageInput>) => {
    if (service === null) {
      set({
        stagesStatus: 'error',
        stagesError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ stagesStatus: 'loading', stagesError: null });
    try {
      const stage = await service.updateStage(stageId, input);
      set({
        stages: get()
          .stages.map((current) => (current.id === stageId ? stage : current))
          .sort((a, b) => a.order - b.order),
        stagesStatus: 'success',
        stagesError: null,
      });
    } catch (error) {
      set({
        stagesStatus: 'error',
        stagesError: extractErrorMessage(error, 'No se pudo actualizar la etapa del pipeline.'),
      });
    }
  },

  deleteStage: async (stageId: string) => {
    if (service === null) {
      set({
        stagesStatus: 'error',
        stagesError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ stagesStatus: 'loading', stagesError: null });
    try {
      await service.deleteStage(stageId);
      set({
        stages: get().stages.filter((current) => current.id !== stageId),
        stagesStatus: 'success',
        stagesError: null,
      });
    } catch (error) {
      set({
        stagesStatus: 'error',
        stagesError: extractErrorMessage(error, 'No se pudo eliminar la etapa del pipeline.'),
      });
    }
  },

  listDeals: async () => {
    if (service === null) {
      set({
        dealsStatus: 'error',
        dealsError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ dealsStatus: 'loading', dealsError: null });
    try {
      const page = await service.listDeals();
      set({ deals: page.items, dealsStatus: 'success', dealsError: null });
    } catch (error) {
      set({
        dealsStatus: 'error',
        dealsError: extractErrorMessage(error, 'No se pudieron cargar las oportunidades.'),
      });
    }
  },

  createDeal: async (input: IDealInput) => {
    if (service === null) {
      set({
        dealsStatus: 'error',
        dealsError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ dealsStatus: 'loading', dealsError: null });
    try {
      const deal = await service.createDeal(input);
      set({
        deals: [...get().deals, deal],
        dealsStatus: 'success',
        dealsError: null,
      });
    } catch (error) {
      set({
        dealsStatus: 'error',
        dealsError: extractErrorMessage(error, 'No se pudo crear la oportunidad.'),
      });
    }
  },

  updateDeal: async (dealId: string, input: IDealUpdateInput) => {
    if (service === null) {
      set({
        dealsStatus: 'error',
        dealsError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ dealsStatus: 'loading', dealsError: null });
    try {
      const deal = await service.updateDeal(dealId, input);
      set({
        deals: get().deals.map((current) => (current.id === dealId ? deal : current)),
        dealsStatus: 'success',
        dealsError: null,
      });
    } catch (error) {
      set({
        dealsStatus: 'error',
        dealsError: extractErrorMessage(error, 'No se pudo actualizar la oportunidad.'),
      });
    }
  },

  deleteDeal: async (dealId: string) => {
    if (service === null) {
      set({
        dealsStatus: 'error',
        dealsError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ dealsStatus: 'loading', dealsError: null });
    try {
      await service.deleteDeal(dealId);
      set({
        deals: get().deals.filter((current) => current.id !== dealId),
        dealsStatus: 'success',
        dealsError: null,
      });
    } catch (error) {
      set({
        dealsStatus: 'error',
        dealsError: extractErrorMessage(error, 'No se pudo eliminar la oportunidad.'),
      });
    }
  },

  listDealHistory: async (dealId: string) => {
    if (service === null) {
      set({
        dealsStatus: 'error',
        dealsError: 'El CRM no está disponible.',
      });
      return [];
    }
    try {
      return await service.listDealHistory(dealId);
    } catch (error) {
      set({
        dealsStatus: 'error',
        dealsError: extractErrorMessage(error, 'No se pudo cargar el historial de la oportunidad.'),
      });
      return [];
    }
  },

  createDealTask: async (dealId: string, input: ITaskInput) => {
    if (service === null) {
      set({
        tasksStatus: 'error',
        tasksError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ tasksStatus: 'loading', tasksError: null });
    try {
      const task = await service.createDealTask(dealId, input);
      set({
        tasks: [...get().tasks, task],
        tasksStatus: 'success',
        tasksError: null,
      });
    } catch (error) {
      set({
        tasksStatus: 'error',
        tasksError: extractErrorMessage(error, 'No se pudo crear la tarea de la oportunidad.'),
      });
    }
  },

  listTasks: async () => {
    if (service === null) {
      set({
        tasksStatus: 'error',
        tasksError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ tasksStatus: 'loading', tasksError: null });
    try {
      const page = await service.listTasks();
      set({ tasks: page.items, tasksStatus: 'success', tasksError: null });
    } catch (error) {
      set({
        tasksStatus: 'error',
        tasksError: extractErrorMessage(error, 'No se pudieron cargar las tareas.'),
      });
    }
  },

  createTask: async (input: ITaskInput) => {
    if (service === null) {
      set({
        tasksStatus: 'error',
        tasksError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ tasksStatus: 'loading', tasksError: null });
    try {
      const task = await service.createTask(input);
      set({
        tasks: [...get().tasks, task],
        tasksStatus: 'success',
        tasksError: null,
      });
    } catch (error) {
      set({
        tasksStatus: 'error',
        tasksError: extractErrorMessage(error, 'No se pudo crear la tarea.'),
      });
    }
  },

  updateTask: async (taskId: string, input: Partial<ITaskInput>) => {
    if (service === null) {
      set({
        tasksStatus: 'error',
        tasksError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ tasksStatus: 'loading', tasksError: null });
    try {
      const task = await service.updateTask(taskId, input);
      set({
        tasks: get().tasks.map((current) => (current.id === taskId ? task : current)),
        tasksStatus: 'success',
        tasksError: null,
      });
    } catch (error) {
      set({
        tasksStatus: 'error',
        tasksError: extractErrorMessage(error, 'No se pudo actualizar la tarea.'),
      });
    }
  },

  deleteTask: async (taskId: string) => {
    if (service === null) {
      set({
        tasksStatus: 'error',
        tasksError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ tasksStatus: 'loading', tasksError: null });
    try {
      await service.deleteTask(taskId);
      set({
        tasks: get().tasks.filter((current) => current.id !== taskId),
        tasksStatus: 'success',
        tasksError: null,
      });
    } catch (error) {
      set({
        tasksStatus: 'error',
        tasksError: extractErrorMessage(error, 'No se pudo eliminar la tarea.'),
      });
    }
  },

  listSla: async () => {
    if (service === null) {
      set({
        slaStatus: 'error',
        slaError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ slaStatus: 'loading', slaError: null });
    try {
      const sla = await service.listSla();
      set({ sla, slaStatus: 'success', slaError: null });
    } catch (error) {
      set({
        slaStatus: 'error',
        slaError: extractErrorMessage(error, 'No se pudieron cargar las políticas SLA.'),
      });
    }
  },

  upsertSla: async (input: ISlaInput) => {
    if (service === null) {
      set({
        slaStatus: 'error',
        slaError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ slaStatus: 'loading', slaError: null });
    try {
      const policy = await service.upsertSla(input);
      set({
        sla: [...get().sla.filter((current) => current.stage_id !== policy.stage_id), policy],
        slaStatus: 'success',
        slaError: null,
      });
    } catch (error) {
      set({
        slaStatus: 'error',
        slaError: extractErrorMessage(error, 'No se pudo guardar la política SLA.'),
      });
    }
  },

  getFunnel: async () => {
    if (service === null) {
      set({
        funnelStatus: 'error',
        funnelError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ funnelStatus: 'loading', funnelError: null });
    try {
      const funnel = await service.getFunnel();
      set({ funnel, funnelStatus: 'success', funnelError: null });
    } catch (error) {
      set({
        funnelStatus: 'error',
        funnelError: extractErrorMessage(error, 'No se pudo cargar el embudo comercial.'),
      });
    }
  },

  getCrmSummary: async (email: string) => {
    if (service === null) {
      set({
        summaryStatus: 'error',
        summaryError: 'El CRM no está disponible.',
      });
      return;
    }
    set({ summaryStatus: 'loading', summaryError: null });
    try {
      const summary = await service.getCrmSummary(email);
      set({ summary, summaryStatus: 'success', summaryError: null });
    } catch (error) {
      set({
        summaryStatus: 'error',
        summaryError: extractErrorMessage(error, 'No se pudo cargar el resumen del cliente.'),
      });
    }
  },

  reset: () =>
    set({
      stages: [],
      stagesStatus: 'idle',
      stagesError: null,
      deals: [],
      dealsStatus: 'idle',
      dealsError: null,
      tasks: [],
      tasksStatus: 'idle',
      tasksError: null,
      sla: [],
      slaStatus: 'idle',
      slaError: null,
      funnel: null,
      funnelStatus: 'idle',
      funnelError: null,
      summary: null,
      summaryStatus: 'idle',
      summaryError: null,
    }),
}));
