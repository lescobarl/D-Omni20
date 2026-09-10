import { describe, expect, it } from 'vitest';
import { formatCurrency, getSlaBadge, getSlaTooltip } from '@/components/Crm/crmFormat';
import { makeDeal, makeSla } from '@/test/crmMocks';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('crmFormat', () => {
  describe('formatCurrency', () => {
    it('formatea montos en MXN usando minor units con es-MX', () => {
      expect(formatCurrency(3500000, 'MXN')).toBe('$35,000.00');
    });

    it('formatea montos en USD usando minor units con es-MX', () => {
      expect(formatCurrency(9999, 'USD')).toBe('$99.99');
    });
  });

  describe('getSlaBadge', () => {
    it('devuelve null para una oportunidad cerrada', () => {
      const deal = makeDeal({ status: 'won' });
      expect(getSlaBadge(deal, makeSla())).toBeNull();
    });

    it('devuelve null cuando no existe política SLA', () => {
      expect(getSlaBadge(makeDeal(), undefined)).toBeNull();
    });

    it('marca SLA vencido cuando supera los días máximos de permanencia', () => {
      const deal = makeDeal({ created_at: new Date(Date.now() - 40 * DAY_MS).toISOString() });
      const sla = makeSla({ max_response_hours: 4, max_stay_days: 15 });
      expect(getSlaBadge(deal, sla)).toEqual({
        label: 'SLA vencido',
        className: 'bg-red-100 text-red-700',
      });
    });

    it('marca SLA por vencer cuando supera las horas de respuesta', () => {
      const deal = makeDeal({ created_at: new Date(Date.now() - 10 * HOUR_MS).toISOString() });
      const sla = makeSla({ max_response_hours: 4, max_stay_days: 15 });
      expect(getSlaBadge(deal, sla)).toEqual({
        label: 'SLA por vencer',
        className: 'bg-amber-100 text-amber-700',
      });
    });

    it('marca SLA al día cuando está dentro de los límites', () => {
      const deal = makeDeal({ created_at: new Date(Date.now() - 2 * HOUR_MS).toISOString() });
      const sla = makeSla({ max_response_hours: 4, max_stay_days: 15 });
      expect(getSlaBadge(deal, sla)).toEqual({
        label: 'SLA al día',
        className: 'bg-green-100 text-green-700',
      });
    });
  });

  describe('getSlaTooltip', () => {
    it('devuelve null para una oportunidad cerrada o sin política', () => {
      expect(getSlaTooltip(makeDeal({ status: 'won' }), makeSla())).toBeNull();
      expect(getSlaTooltip(makeDeal(), undefined)).toBeNull();
    });

    it('describe el exceso temporal cuando el SLA está vencido', () => {
      const deal = makeDeal({ created_at: new Date(Date.now() - 40 * DAY_MS).toISOString() });
      const sla = makeSla({ max_response_hours: 4, max_stay_days: 15 });
      expect(getSlaTooltip(deal, sla)).toBe('Vencido hace 25 d');
    });

    it('describe el exceso del tiempo de respuesta cuando está por vencer', () => {
      const deal = makeDeal({ created_at: new Date(Date.now() - 10 * HOUR_MS).toISOString() });
      const sla = makeSla({ max_response_hours: 4, max_stay_days: 15 });
      expect(getSlaTooltip(deal, sla)).toBe('Tiempo de respuesta excedido hace 6 h');
    });

    it('devuelve null cuando el SLA está al día', () => {
      const deal = makeDeal({ created_at: new Date(Date.now() - 2 * HOUR_MS).toISOString() });
      const sla = makeSla({ max_response_hours: 4, max_stay_days: 15 });
      expect(getSlaTooltip(deal, sla)).toBeNull();
    });
  });
});
