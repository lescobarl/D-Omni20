/**
 * Helpers de prueba compartidos para los dominios personalizados (PSEO hosts).
 *
 * Contrato:
 * - Centraliza la factoría del DTO `IPseoHostRead` y el servicio mock
 *   (`IPseoHostService`) para reutilizarlos en las pruebas del store y del
 *   componente de dominios (Dominios).
 * - Cada factoría acepta overrides parciales para construir casos específicos.
 * - El backend devuelve `GET /pseo/hosts` como un **arreglo plano**, por lo que
 *   `listPseoHosts` mock resuelve `IPseoHostRead[]` directamente (sin `IPage`).
 */
import { vi } from 'vitest';
import type { IPseoHostRead } from '@/api/types';
import type { IPseoHostService } from '@/services/hostsService';

/** Construye un dominio personalizado leído del backend (PSEO hosts). */
export function makeHost(overrides: Partial<IPseoHostRead> = {}): IPseoHostRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: 'tenant-1',
    host: 'portal.miempresa.com',
    status: 'pending',
    verify_token: 'tok-1',
    verified_at: null,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    revision: 1,
    deleted: false,
    ...overrides,
  };
}

/** Construye un servicio de dominios personalizados con las dependencias mockeadas. */
export function makeHostsService(overrides: Partial<IPseoHostService> = {}): IPseoHostService {
  return {
    listPseoHosts: vi.fn<IPseoHostService['listPseoHosts']>().mockResolvedValue([]),
    requestPseoHost: vi.fn<IPseoHostService['requestPseoHost']>().mockResolvedValue(makeHost()),
    verifyPseoHost: vi
      .fn<IPseoHostService['verifyPseoHost']>()
      .mockResolvedValue(makeHost({ status: 'active', verified_at: '2026-08-19T00:00:00Z' })),
    deletePseoHost: vi.fn<IPseoHostService['deletePseoHost']>().mockResolvedValue(undefined),
    ...overrides,
  };
}
