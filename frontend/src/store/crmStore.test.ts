/**
 * Pruebas del store del subsistema CRM (`crmStore`) — pipeline, tareas, SLA,
 * embudo y resumen del cliente.
 *
 * Contrato:
 * - Usa la factoría compartida `makeService` de `@/test/crmMocks` para construir
 *   el servicio mock (`ICrmService`), evitando duplicación.
 * - Cada flujo se aísla por colección: el store mantiene estados de carga/error
 *   independientes, por lo que cada `describe` verifica solo su propia colección.
 * - `afterEach` desregistra el servicio para que las pruebas siguientes empiecen
 *   sin dependencia (estado de error estable al no haber servicio registrado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { setCrmService, useCrmStore } from '@/store/crmStore';
import type {
  IDealInput,
  IDealUpdateInput,
  ICrmService,
  IStageInput,
  ITaskInput,
  ISlaInput,
} from '@/services/crmService';
import {
  makeDeal,
  makeFunnel,
  makePage,
  makeService,
  makeSla,
  makeStage,
  makeStageChange,
  makeSummary,
  makeTask,
} from '@/test/crmMocks';

describe('crmStore', () => {
  beforeEach(() => {
    useCrmStore.getState().reset();
  });

  afterEach(() => {
    useCrmStore.getState().reset();
    setCrmService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useCrmStore.getState();
    expect(state.stages).toEqual([]);
    expect(state.stagesStatus).toBe('idle');
    expect(state.deals).toEqual([]);
    expect(state.dealsStatus).toBe('idle');
    expect(state.tasks).toEqual([]);
    expect(state.tasksStatus).toBe('idle');
    expect(state.sla).toEqual([]);
    expect(state.slaStatus).toBe('idle');
    expect(state.funnel).toBeNull();
    expect(state.funnelStatus).toBe('idle');
    expect(state.summary).toBeNull();
    expect(state.summaryStatus).toBe('idle');
  });

  describe('etapas del pipeline', () => {
    it('listStages carga las etapas en éxito', async () => {
      const stage = makeStage();
      const service = makeService({
        listStages: vi.fn<ICrmService['listStages']>().mockResolvedValue([stage]),
      });
      setCrmService(service);

      await useCrmStore.getState().listStages();

      const state = useCrmStore.getState();
      expect(state.stages).toEqual([stage]);
      expect(state.stagesStatus).toBe('success');
      expect(state.stagesError).toBeNull();
    });

    it('createStage agrega la etapa ordenada por order', async () => {
      const low = makeStage({ id: 'stage-low', order: 1 });
      const high = makeStage({ id: 'stage-high', order: 5 });
      const created = makeStage({ id: 'stage-new', order: 3 });
      useCrmStore.setState({ stages: [high, low], stagesStatus: 'success' });
      const service = makeService({
        createStage: vi.fn<ICrmService['createStage']>().mockResolvedValue(created),
      });
      setCrmService(service);

      await useCrmStore.getState().createStage({ name: 'Nueva', order: 3 } satisfies IStageInput);

      const state = useCrmStore.getState();
      expect(state.stages.map((item) => item.id)).toEqual(['stage-low', 'stage-new', 'stage-high']);
      expect(state.stagesStatus).toBe('success');
    });

    it('updateStage reemplaza la etapa y reordena', async () => {
      const updated = makeStage({ id: 'stage-1', name: 'Ganada', order: 1 });
      useCrmStore.setState({
        stages: [makeStage({ id: 'stage-1', order: 2 }), makeStage({ id: 'stage-2', order: 1 })],
      });
      const service = makeService({
        updateStage: vi.fn<ICrmService['updateStage']>().mockResolvedValue(updated),
      });
      setCrmService(service);

      await useCrmStore.getState().updateStage('stage-1', { name: 'Ganada' });

      const state = useCrmStore.getState();
      expect(state.stages.map((item) => item.id)).toEqual(['stage-1', 'stage-2']);
      expect(state.stages[0].name).toBe('Ganada');
    });

    it('deleteStage quita la etapa de la colección', async () => {
      useCrmStore.setState({
        stages: [makeStage({ id: 'stage-1' }), makeStage({ id: 'stage-2' })],
      });
      const service = makeService({
        deleteStage: vi.fn<ICrmService['deleteStage']>().mockResolvedValue(undefined),
      });
      setCrmService(service);

      await useCrmStore.getState().deleteStage('stage-1');

      const state = useCrmStore.getState();
      expect(state.stages.map((item) => item.id)).toEqual(['stage-2']);
      expect(state.stagesStatus).toBe('success');
    });

    it('degrade a error si el servicio no está registrado', async () => {
      await useCrmStore.getState().listStages();
      const state = useCrmStore.getState();
      expect(state.stagesStatus).toBe('error');
      expect(state.stagesError).toBe('El CRM no está disponible.');
    });

    it('listStages registra el error de la capa de servicio', async () => {
      const service = makeService({
        listStages: vi
          .fn<ICrmService['listStages']>()
          .mockRejectedValue(new AppError('CRM caído.', 'crm.listStages')),
      });
      setCrmService(service);

      await useCrmStore.getState().listStages();

      const state = useCrmStore.getState();
      expect(state.stagesStatus).toBe('error');
      expect(state.stagesError).toBe('CRM caído.');
    });
  });

  describe('oportunidades', () => {
    it('listDeals carga la página de oportunidades', async () => {
      const deal = makeDeal();
      const service = makeService({
        listDeals: vi.fn<ICrmService['listDeals']>().mockResolvedValue(makePage([deal])),
      });
      setCrmService(service);

      await useCrmStore.getState().listDeals();

      const state = useCrmStore.getState();
      expect(state.deals).toEqual([deal]);
      expect(state.dealsStatus).toBe('success');
    });

    it('createDeal agrega la oportunidad', async () => {
      const deal = makeDeal();
      const service = makeService({
        createDeal: vi.fn<ICrmService['createDeal']>().mockResolvedValue(deal),
      });
      setCrmService(service);

      await useCrmStore.getState().createDeal({ title: 'Nuevo' } as unknown as IDealInput);

      const state = useCrmStore.getState();
      expect(state.deals).toContainEqual(deal);
      expect(state.dealsStatus).toBe('success');
    });

    it('updateDeal reemplaza la oportunidad', async () => {
      useCrmStore.setState({ deals: [makeDeal({ id: 'deal-1' })] });
      const service = makeService({
        updateDeal: vi
          .fn<ICrmService['updateDeal']>()
          .mockResolvedValue(makeDeal({ id: 'deal-1' })),
      });
      setCrmService(service);

      await useCrmStore.getState().updateDeal('deal-1', {} as unknown as IDealUpdateInput);

      const state = useCrmStore.getState();
      expect(state.deals).toHaveLength(1);
      expect(state.deals[0].id).toBe('deal-1');
      expect(state.dealsStatus).toBe('success');
    });

    it('deleteDeal quita la oportunidad', async () => {
      useCrmStore.setState({ deals: [makeDeal({ id: 'deal-1' }), makeDeal({ id: 'deal-2' })] });
      setCrmService(
        makeService({
          deleteDeal: vi.fn<ICrmService['deleteDeal']>().mockResolvedValue(undefined),
        }),
      );

      await useCrmStore.getState().deleteDeal('deal-1');

      expect(useCrmStore.getState().deals.map((item) => item.id)).toEqual(['deal-2']);
    });

    it('listDealHistory devuelve el historial de movimientos', async () => {
      const history = [makeStageChange()];
      setCrmService(
        makeService({
          listDealHistory: vi.fn<ICrmService['listDealHistory']>().mockResolvedValue(history),
        }),
      );

      const result = await useCrmStore.getState().listDealHistory('deal-1');

      expect(result).toEqual(history);
    });

    it('listDealHistory degrada a error y devuelve [] sin servicio', async () => {
      const result = await useCrmStore.getState().listDealHistory('deal-1');
      expect(result).toEqual([]);
      expect(useCrmStore.getState().dealsStatus).toBe('error');
    });
  });

  describe('tareas', () => {
    it('listTasks carga la página de tareas', async () => {
      const task = makeTask();
      setCrmService(
        makeService({
          listTasks: vi.fn<ICrmService['listTasks']>().mockResolvedValue(makePage([task])),
        }),
      );

      await useCrmStore.getState().listTasks();

      const state = useCrmStore.getState();
      expect(state.tasks).toEqual([task]);
      expect(state.tasksStatus).toBe('success');
    });

    it('createTask agrega la tarea', async () => {
      const task = makeTask();
      setCrmService(
        makeService({ createTask: vi.fn<ICrmService['createTask']>().mockResolvedValue(task) }),
      );

      await useCrmStore.getState().createTask({ title: 'Seguimiento' } satisfies ITaskInput);

      expect(useCrmStore.getState().tasks).toContainEqual(task);
    });

    it('createDealTask agrega la tarea anclada a la oportunidad', async () => {
      const task = makeTask();
      setCrmService(
        makeService({
          createDealTask: vi.fn<ICrmService['createDealTask']>().mockResolvedValue(task),
        }),
      );

      await useCrmStore
        .getState()
        .createDealTask('deal-1', { title: 'Anclada' } satisfies ITaskInput);

      const state = useCrmStore.getState();
      expect(state.tasks).toContainEqual(task);
      expect(state.tasksStatus).toBe('success');
    });

    it('updateTask reemplaza la tarea', async () => {
      const updated = makeTask({ id: 'task-1', status: 'done' });
      useCrmStore.setState({ tasks: [makeTask({ id: 'task-1' })] });
      setCrmService(
        makeService({ updateTask: vi.fn<ICrmService['updateTask']>().mockResolvedValue(updated) }),
      );

      await useCrmStore.getState().updateTask('task-1', { status: 'done' });

      expect(useCrmStore.getState().tasks[0]).toEqual(updated);
    });

    it('deleteTask quita la tarea', async () => {
      useCrmStore.setState({ tasks: [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })] });
      setCrmService(
        makeService({
          deleteTask: vi.fn<ICrmService['deleteTask']>().mockResolvedValue(undefined),
        }),
      );

      await useCrmStore.getState().deleteTask('task-1');

      expect(useCrmStore.getState().tasks.map((item) => item.id)).toEqual(['task-2']);
    });
  });

  describe('SLA y embudo', () => {
    it('listSla carga las políticas', async () => {
      const policy = makeSla();
      setCrmService(
        makeService({ listSla: vi.fn<ICrmService['listSla']>().mockResolvedValue([policy]) }),
      );

      await useCrmStore.getState().listSla();

      const state = useCrmStore.getState();
      expect(state.sla).toEqual([policy]);
      expect(state.slaStatus).toBe('success');
    });

    it('upsertSla reemplaza la política de la misma etapa', async () => {
      const policy = makeSla();
      useCrmStore.setState({ sla: [makeSla()] });
      setCrmService(
        makeService({ upsertSla: vi.fn<ICrmService['upsertSla']>().mockResolvedValue(policy) }),
      );

      await useCrmStore.getState().upsertSla({} as unknown as ISlaInput);

      const state = useCrmStore.getState();
      expect(state.sla).toEqual([policy]);
      expect(state.slaStatus).toBe('success');
    });

    it('getFunnel carga el embudo comercial', async () => {
      const funnel = makeFunnel();
      setCrmService(
        makeService({ getFunnel: vi.fn<ICrmService['getFunnel']>().mockResolvedValue(funnel) }),
      );

      await useCrmStore.getState().getFunnel();

      const state = useCrmStore.getState();
      expect(state.funnel).toEqual(funnel);
      expect(state.funnelStatus).toBe('success');
    });

    it('getCrmSummary carga el resumen del cliente por email', async () => {
      const summary = makeSummary();
      setCrmService(
        makeService({
          getCrmSummary: vi.fn<ICrmService['getCrmSummary']>().mockResolvedValue(summary),
        }),
      );

      await useCrmStore.getState().getCrmSummary('cliente@test.local');

      const state = useCrmStore.getState();
      expect(state.summary).toEqual(summary);
      expect(state.summaryStatus).toBe('success');
    });
  });
});
