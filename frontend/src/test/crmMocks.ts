/**
 * Fábricas de mocks del subsistema CRM (P3).
 * Siguen el patrón de `operationsMocks.ts`: cada fábrica devuelve un read-model
 * completo con la tupla sync (revision/updated_at) y permite sobrescribir
 * cualquier campo con `...overrides` al final.
 */
import { vi } from 'vitest';
import type {
  ICrmSummaryRead,
  IDealRead,
  IFunnelRead,
  IFunnelStageRead,
  IPage,
  ISlaRead,
  IStageChangeRead,
  IStageRead,
  ITaskRead,
} from '@/api/types';
import type { ICrmService } from '@/services/crmService';

/** Etapa del pipeline con valores por defecto estables para los tests. */
export function makeStage(overrides: Partial<IStageRead> = {}): IStageRead {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-1',
    name: 'Prospección',
    order: 0,
    default_probability: 10,
    is_terminal: false,
    outcome: null,
    created_at: '2026-08-01T12:00:00.000Z',
    revision: 1,
    updated_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Oportunidad comercial con valores por defecto estables para los tests. */
export function makeDeal(overrides: Partial<IDealRead> = {}): IDealRead {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: 'tenant-1',
    title: 'Casa Vista al Lago',
    stage_id: '11111111-1111-4111-8111-111111111111',
    amount_minor: 3500000,
    currency: 'MXN',
    probability: 25,
    status: 'open',
    owner_id: null,
    contact_id: null,
    lead_id: null,
    quote_id: null,
    payment_id: null,
    expected_close_at: null,
    metadata: {},
    closed_at: null,
    won_at: null,
    lost_at: null,
    lost_reason: null,
    created_at: '2026-08-01T12:00:00.000Z',
    revision: 1,
    updated_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Tarea de seguimiento con valores por defecto estables para los tests. */
export function makeTask(overrides: Partial<ITaskRead> = {}): ITaskRead {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'tenant-1',
    deal_id: null,
    contact_id: null,
    title: 'Seguimiento de visita',
    due_at: null,
    status: 'pending',
    priority: 'medium',
    assignee_id: null,
    completed_at: null,
    created_at: '2026-08-01T12:00:00.000Z',
    revision: 1,
    updated_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Política SLA de una etapa con valores por defecto estables. */
export function makeSla(overrides: Partial<ISlaRead> = {}): ISlaRead {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: 'tenant-1',
    stage_id: '11111111-1111-4111-8111-111111111111',
    max_response_hours: 4,
    max_stay_days: 15,
    created_at: '2026-08-01T12:00:00.000Z',
    revision: 1,
    updated_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Registro inmutable de un movimiento de etapa (append-only). */
export function makeStageChange(overrides: Partial<IStageChangeRead> = {}): IStageChangeRead {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenant_id: 'tenant-1',
    deal_id: '22222222-2222-4222-8222-222222222222',
    from_stage_id: null,
    to_stage_id: '11111111-1111-4111-8111-111111111111',
    changed_by: 'sistema',
    note: null,
    created_at: '2026-08-01T12:00:00.000Z',
    revision: 1,
    updated_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Agregación de una etapa dentro del embudo comercial (M4). */
export function makeFunnelStage(overrides: Partial<IFunnelStageRead> = {}): IFunnelStageRead {
  return {
    stage_id: '11111111-1111-4111-8111-111111111111',
    stage_name: 'Prospección',
    count: 5,
    total_amount_minor: 17500000,
    weighted_value_minor: 4375000,
    conversion_rate: 40,
    avg_cycle_days: 7,
    ...overrides,
  };
}

/** Reporte del embudo comercial con una etapa por defecto. */
export function makeFunnel(overrides: Partial<IFunnelRead> = {}): IFunnelRead {
  return {
    stages: [makeFunnelStage()],
    total_deals: 5,
    won_count: 1,
    lost_count: 1,
    open_count: 3,
    won_amount_minor: 3500000,
    close_rate: 20,
    avg_cycle_days: 21,
    ...overrides,
  };
}

/** Resumen del cliente (P4, portal) con una oportunidad y una tarea por defecto. */
export function makeSummary(overrides: Partial<ICrmSummaryRead> = {}): ICrmSummaryRead {
  const deals = [makeDeal()];
  const tasks = [makeTask({ deal_id: deals[0].id })];
  return {
    deals,
    tasks,
    total_deals: 1,
    open_deals: 1,
    won_deals: 0,
    ...overrides,
  };
}

/** Construye una página del backend con los ítems dados. */
export function makePage<T>(items: T[]): IPage<T> {
  return { items, total: items.length, page: 1, page_size: 20 };
}

/** Construye un servicio CRM con todas las dependencias mockeadas. */
export function makeService(overrides: Partial<ICrmService> = {}): ICrmService {
  return {
    listStages: vi.fn<ICrmService['listStages']>().mockResolvedValue([]),
    createStage: vi.fn<ICrmService['createStage']>().mockResolvedValue(makeStage()),
    getStage: vi.fn<ICrmService['getStage']>().mockResolvedValue(makeStage()),
    updateStage: vi.fn<ICrmService['updateStage']>().mockResolvedValue(makeStage()),
    deleteStage: vi.fn<ICrmService['deleteStage']>().mockResolvedValue(undefined),
    listDeals: vi.fn<ICrmService['listDeals']>().mockResolvedValue(makePage([])),
    createDeal: vi.fn<ICrmService['createDeal']>().mockResolvedValue(makeDeal()),
    getDeal: vi.fn<ICrmService['getDeal']>().mockResolvedValue(makeDeal()),
    updateDeal: vi.fn<ICrmService['updateDeal']>().mockResolvedValue(makeDeal()),
    deleteDeal: vi.fn<ICrmService['deleteDeal']>().mockResolvedValue(undefined),
    listDealHistory: vi.fn<ICrmService['listDealHistory']>().mockResolvedValue([makeStageChange()]),
    listDealTasks: vi.fn<ICrmService['listDealTasks']>().mockResolvedValue(makePage([makeTask()])),
    createDealTask: vi.fn<ICrmService['createDealTask']>().mockResolvedValue(makeTask()),
    listTasks: vi.fn<ICrmService['listTasks']>().mockResolvedValue(makePage([])),
    createTask: vi.fn<ICrmService['createTask']>().mockResolvedValue(makeTask()),
    getTask: vi.fn<ICrmService['getTask']>().mockResolvedValue(makeTask()),
    updateTask: vi.fn<ICrmService['updateTask']>().mockResolvedValue(makeTask()),
    deleteTask: vi.fn<ICrmService['deleteTask']>().mockResolvedValue(undefined),
    listSla: vi.fn<ICrmService['listSla']>().mockResolvedValue([]),
    upsertSla: vi.fn<ICrmService['upsertSla']>().mockResolvedValue(makeSla()),
    getFunnel: vi.fn<ICrmService['getFunnel']>().mockResolvedValue(makeFunnel()),
    getCrmSummary: vi.fn<ICrmService['getCrmSummary']>().mockResolvedValue(makeSummary()),
    ...overrides,
  };
}
