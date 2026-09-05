/**
 * Pruebas unitarias del módulo de RBAC (Role-Based Access Control).
 *
 * Cubre la matriz de acceso por área funcional y rol, el bypass del
 * super-administrador y el comportamiento "fail-closed" ante roles o
 * áreas desconocidas.
 */
import { describe, expect, it } from 'vitest';

import type { IRole } from '@/api/types';
import {
  canAccessArea,
  canManagePlatformUsers,
  canManageTenantMembers,
  type IRbacContext,
  type RbacArea,
} from './rbac';

const ROLES: IRole[] = ['admin', 'configurador', 'operador'];

function contextFor(role: IRole | null, isSuperAdmin = false): IRbacContext {
  return { role, isSuperAdmin };
}

describe('canAccessArea', () => {
  it('niega el acceso a cualquier área sin rol y sin ser super-admin (fail-closed)', () => {
    const areas: RbacArea[] = [
      'tenants',
      'platformUsers',
      'tenantMembers',
      'tenantConfig',
      'content',
      'operations',
      'analytics',
      'profile',
    ];
    for (const area of areas) {
      expect(canAccessArea(area, contextFor(null))).toBe(false);
    }
  });

  it('niega el acceso a un rol desconocido (fail-closed)', () => {
    const unknown = 'desconocido' as unknown as IRole;
    const areas: RbacArea[] = [
      'tenants',
      'platformUsers',
      'tenantMembers',
      'tenantConfig',
      'content',
      'operations',
    ];
    for (const area of areas) {
      expect(canAccessArea(area, contextFor(unknown))).toBe(false);
    }
    // «analytics» y «profile» se conceden a cualquier rol autenticado (no null),
    // por lo que un rol desconocido pero no nulo sí accede a esas áreas.
    expect(canAccessArea('analytics', contextFor(unknown))).toBe(true);
    expect(canAccessArea('profile', contextFor(unknown))).toBe(true);
  });

  it('devuelve false para un área no contemplada (default fail-closed)', () => {
    const area = 'noExiste' as RbacArea;
    expect(canAccessArea(area, contextFor('admin'))).toBe(false);
    expect(canAccessArea(area, contextFor(null, true))).toBe(false);
  });

  it('solo permite «tenants» y «platformUsers» al super-admin', () => {
    const superAdmin = contextFor('admin', true);
    expect(canAccessArea('tenants', superAdmin)).toBe(true);
    expect(canAccessArea('platformUsers', superAdmin)).toBe(true);
    // Un rol normal (aunque sea admin de tenant) no accede a la gestión de plataforma.
    expect(canAccessArea('tenants', contextFor('admin'))).toBe(false);
    expect(canAccessArea('platformUsers', contextFor('admin'))).toBe(false);
  });

  it('permite «tenantMembers» solo a admin (o super-admin)', () => {
    expect(canAccessArea('tenantMembers', contextFor('admin'))).toBe(true);
    expect(canAccessArea('tenantMembers', contextFor('configurador'))).toBe(false);
    expect(canAccessArea('tenantMembers', contextFor('operador'))).toBe(false);
    expect(canAccessArea('tenantMembers', contextFor(null, true))).toBe(true);
  });

  it('permite «tenantConfig» y «content» a admin y configurador', () => {
    for (const area of ['tenantConfig', 'content'] as RbacArea[]) {
      expect(canAccessArea(area, contextFor('admin'))).toBe(true);
      expect(canAccessArea(area, contextFor('configurador'))).toBe(true);
      expect(canAccessArea(area, contextFor('operador'))).toBe(false);
      expect(canAccessArea(area, contextFor(null, true))).toBe(true);
    }
  });

  it('permite «operations» a admin y operador (no a configurador)', () => {
    expect(canAccessArea('operations', contextFor('admin'))).toBe(true);
    expect(canAccessArea('operations', contextFor('operador'))).toBe(true);
    expect(canAccessArea('operations', contextFor('configurador'))).toBe(false);
    expect(canAccessArea('operations', contextFor(null, true))).toBe(true);
  });

  it('permite «analytics» y «profile» a cualquier rol autenticado', () => {
    for (const area of ['analytics', 'profile'] as RbacArea[]) {
      for (const role of ROLES) {
        expect(canAccessArea(area, contextFor(role))).toBe(true);
      }
      expect(canAccessArea(area, contextFor(null, true))).toBe(true);
    }
  });
});

describe('canManageTenantMembers', () => {
  it('es true solo para admin o super-admin', () => {
    expect(canManageTenantMembers(contextFor('admin'))).toBe(true);
    expect(canManageTenantMembers(contextFor('configurador'))).toBe(false);
    expect(canManageTenantMembers(contextFor('operador'))).toBe(false);
    expect(canManageTenantMembers(contextFor(null, true))).toBe(true);
    expect(canManageTenantMembers(contextFor(null))).toBe(false);
  });
});

describe('canManagePlatformUsers', () => {
  it('es true solo para el super-admin', () => {
    expect(canManagePlatformUsers(contextFor('admin', true))).toBe(true);
    expect(canManagePlatformUsers(contextFor('admin'))).toBe(false);
    expect(canManagePlatformUsers(contextFor('configurador'))).toBe(false);
    expect(canManagePlatformUsers(contextFor('operador'))).toBe(false);
    expect(canManagePlatformUsers(contextFor(null))).toBe(false);
  });
});
