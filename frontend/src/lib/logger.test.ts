/**
 * Pruebas del logger de auditoría inmutable.
 *
 * Contrato:
 * - Acumula entradas de forma inmutable y devuelve copias.
 * - Filtra por nivel mínimo y soporta limpieza del registro.
 */
import { describe, expect, it } from 'vitest';
import { ConsoleLogger } from '@/lib/logger';

describe('ConsoleLogger', () => {
  it('acumula entradas de auditoría y devuelve copias inmutables', () => {
    const logger = new ConsoleLogger();
    logger.info('test.op', { key: 'value' });

    const first = logger.getEntries();
    const second = logger.getEntries();
    expect(first).toHaveLength(1);
    expect(first).not.toBe(second);
    expect(second[0].operation).toBe('test.op');
    expect(second[0].level).toBe('info');
    expect(second[0].context).toEqual({ key: 'value' });
  });

  it('registra todos los niveles de severidad', () => {
    const logger = new ConsoleLogger('debug');
    logger.debug('a', {});
    logger.info('b', {});
    logger.warn('c', {});
    logger.error('d', {});

    expect(logger.getEntries().map((entry) => entry.operation)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('vacía el registro de auditoría con clear', () => {
    const logger = new ConsoleLogger();
    logger.info('test.op', {});
    logger.clear();

    expect(logger.getEntries()).toHaveLength(0);
  });
});
