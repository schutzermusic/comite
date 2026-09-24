/**
 * Definições da Visão Geral de Operações — cada número com regra escrita:
 *  • atividade crítica / vencida;
 *  • janela de execução próxima;
 *  • fila de medição por quem tem o próximo passo — e APPROVED_FOR_CUSTOMER
 *    nunca se confunde com aceite do cliente;
 *  • pendência de medição da OPERAÇÃO (não do cliente, não de Contratos).
 */
import { describe, expect, it } from 'vitest';
import {
  daysBetween, horizonOf, isCriticalActivity, isMaterialOpenRisk, isOperationalMeasurementPending,
  isOverdueActivity, measurementLane, projectAtRisk, type ActivityLike,
} from '@/lib/operations/overview-rules';
import type { MeasurementStatus } from '@/lib/projects/measurements/types';

const TODAY = '2026-09-24';
const act = (over: Partial<ActivityLike & { actual_start: string | null }> = {}) => ({
  status: 'not_started', priority: 'medium', delay_status: 'on_track', is_milestone: false, is_summary: false,
  planned_start: '2026-10-01', planned_finish: '2026-10-10', actual_finish: null, actual_start: null, ...over,
});

describe('atividade crítica e vencida', () => {
  it('crítica por prioridade, por sinal de atraso ou por término vencido', () => {
    expect(isCriticalActivity(act({ priority: 'critical' }), TODAY)).toBe(true);
    expect(isCriticalActivity(act({ delay_status: 'blocked' }), TODAY)).toBe(true);
    expect(isCriticalActivity(act({ planned_finish: '2026-09-20' }), TODAY)).toBe(true);
    expect(isCriticalActivity(act(), TODAY)).toBe(false);
  });
  it('concluída, cancelada ou linha-resumo nunca é crítica', () => {
    expect(isCriticalActivity(act({ priority: 'critical', status: 'completed' }), TODAY)).toBe(false);
    expect(isCriticalActivity(act({ priority: 'critical', status: 'cancelled' }), TODAY)).toBe(false);
    expect(isCriticalActivity(act({ priority: 'critical', is_summary: true }), TODAY)).toBe(false);
    expect(isCriticalActivity(act({ priority: 'critical', actual_finish: '2026-09-01' }), TODAY)).toBe(false);
  });
  it('vencida = término planejado antes de hoje e ainda aberta', () => {
    expect(isOverdueActivity(act({ planned_finish: '2026-09-23' }), TODAY)).toBe(true);
    expect(isOverdueActivity(act({ planned_finish: TODAY }), TODAY)).toBe(false);
  });
});

describe('janela de execução', () => {
  it('conta dias civis', () => {
    expect(daysBetween('2026-09-24', '2026-10-01')).toBe(7);
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0);
  });
  it('não iniciada ancora no início; em andamento ancora no término', () => {
    expect(horizonOf(act({ planned_start: '2026-09-30' }), TODAY)).toBe(7);
    expect(horizonOf(act({ planned_start: '2026-10-05', planned_finish: '2026-10-20' }), TODAY)).toBe(14);
    expect(horizonOf(act({ status: 'in_progress', planned_start: '2026-09-01', planned_finish: '2026-10-20' }), TODAY)).toBe(30);
    expect(horizonOf(act({ planned_start: '2026-12-01', planned_finish: '2026-12-10' }), TODAY)).toBeNull();
    expect(horizonOf(act({ planned_start: '2026-09-01', planned_finish: '2026-09-10' }), TODAY)).toBeNull();
  });
});

describe('medições', () => {
  it('pacote aprovado para envio NÃO é aceite do cliente', () => {
    expect(measurementLane('APPROVED_FOR_CUSTOMER')).toBe('SEND_TO_CUSTOMER');
    expect(measurementLane('AWAITING_CUSTOMER_ACCEPTANCE')).toBe('AWAITING_CUSTOMER');
    expect(measurementLane('ACCEPTED')).toBe('BILLING_ELIGIBLE');
  });
  it('todo estado canônico cai numa fila', () => {
    const all: MeasurementStatus[] = ['PLANNED', 'IN_PREPARATION', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'UNDER_REVIEW',
      'APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_CORRECTION_REQUESTED', 'ACCEPTED', 'REJECTED',
      'RETURNED_FOR_CORRECTION', 'CANCELLED', 'SUPERSEDED'];
    for (const s of all) expect(measurementLane(s)).toBeTruthy();
    expect(measurementLane('RETURNED_FOR_CORRECTION')).toBe('CORRECTION');
    expect(measurementLane('CUSTOMER_CORRECTION_REQUESTED')).toBe('CORRECTION');
  });
  it('pendência da operação: em preparo, devolvida, ou planejada já vencida', () => {
    expect(isOperationalMeasurementPending('IN_PREPARATION', null, TODAY)).toBe(true);
    expect(isOperationalMeasurementPending('RETURNED_FOR_CORRECTION', null, TODAY)).toBe(true);
    expect(isOperationalMeasurementPending('PLANNED', '2026-09-20', TODAY)).toBe(true);
    expect(isOperationalMeasurementPending('PLANNED', '2026-10-20', TODAY)).toBe(false);
    expect(isOperationalMeasurementPending('AWAITING_CUSTOMER_ACCEPTANCE', '2026-09-01', TODAY)).toBe(false);
    expect(isOperationalMeasurementPending('SUBMITTED', '2026-09-01', TODAY)).toBe(false);
  });
});

describe('risco', () => {
  it('risco material = aberto/mitigando e alto/crítico', () => {
    expect(isMaterialOpenRisk({ status: 'open', severity: 'high', responsible_id: null })).toBe(true);
    expect(isMaterialOpenRisk({ status: 'mitigating', severity: 'critical', responsible_id: 'u' })).toBe(true);
    expect(isMaterialOpenRisk({ status: 'resolved', severity: 'critical', responsible_id: null })).toBe(false);
    expect(isMaterialOpenRisk({ status: 'open', severity: 'medium', responsible_id: null })).toBe(false);
    expect(projectAtRisk(0, 0)).toBe(false);
    expect(projectAtRisk(1, 0)).toBe(true);
    expect(projectAtRisk(0, 2)).toBe(true);
  });
});
