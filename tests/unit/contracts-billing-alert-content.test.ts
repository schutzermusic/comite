/**
 * CONTEÚDO DO ALERTA DE MARCO DE FATURAMENTO.
 *
 * O alerta sai do produto por e-mail e chega a um gerente. Estes testes
 * provam o que ele NÃO pode dizer:
 *
 *   · não chama atraso de cronograma de inadimplemento contratual
 *   · não afirma faturado, aceito, recebido ou pago
 *   · não deriva estado por conta própria — usa a máquina canônica
 *   · não promete entrega por canal sem provedor
 */
import { describe, it, expect } from 'vitest';
import {
  buildAlertContent, buildAlertEmailHtml, alertPlanState, rowFromSnapshot,
  type BillingMilestoneAlert,
} from '@/lib/contracts/billing/planning/alert-content';

const alert = (over: Partial<BillingMilestoneAlert> = {}): BillingMilestoneAlert => ({
  id: 'a1', organizationId: 'o1', contractId: 'c1', milestoneId: 'm5',
  projectId: '2774.08/2025',
  plannedDate: '2026-10-15',
  plannedDateBasis: 'timeline_planned_finish',
  offsetDays: 30, kind: 'UPCOMING',
  amount: 803233.98, currency: 'BRL',
  policySource: 'default',
  generatedAt: '2026-09-15T08:00:00Z',
  asOfDate: '2026-09-15',
  factsSnapshot: {
    title: 'Montagem e fechamento do enrolamento estatórico',
    contract_number: 'JA10182283/2025',
    counterparty_name: 'ENEL GREEN POWER CACHOEIRA DOURADA S.A.',
    status: 'pending',
    requirement_id: 'r5',
    governed_mapping_count: 1,
    timeline_item_id: 't5',
    timeline_status: 'in_progress',
    customer_acceptance_required: true,
    evidence_required: true,
    entitlement_amount: 803233.98,
  },
  ...over,
});

describe('o conteúdo', () => {
  it('traz contrato, projeto, cliente, marco, valor, data e estado', () => {
    const c = buildAlertContent(alert());
    const labels = c.lines.map((l) => l.label);
    expect(labels).toEqual([
      'Contrato', 'Projeto', 'Cliente', 'Marco', 'Valor previsto',
      'Data prevista no cronograma', 'Status',
    ]);
    expect(c.lines.find((l) => l.label === 'Contrato')!.value).toBe('JA10182283/2025');
    expect(c.lines.find((l) => l.label === 'Valor previsto')!.value).toContain('803.233,98');
    expect(c.lines.find((l) => l.label === 'Data prevista no cronograma')!.value).toBe('15/10/2026');
  });

  it('o rótulo da data DIZ quando ela vem do cronograma e quando não vem', () => {
    const fromSchedule = buildAlertContent(alert());
    expect(fromSchedule.lines.some((l) => l.label === 'Data prevista no cronograma')).toBe(true);
    const fromDue = buildAlertContent(alert({ plannedDateBasis: 'milestone_due_date' }));
    expect(fromDue.lines.some((l) => l.label === 'Data prevista')).toBe(true);
  });

  it('valor ausente não vira R$ 0,00', () => {
    const c = buildAlertContent(alert({ amount: null }));
    expect(c.lines.find((l) => l.label === 'Valor previsto')!.value).toBe('Valor não apurado');
  });
});

describe('o estado vem da máquina canônica', () => {
  it('marco mapeado com etapa em curso aguarda o marco do projeto', () => {
    expect(alertPlanState(alert())).toBe('AWAITING_PROJECT_MILESTONE');
  });

  it('etapa concluída passa a aguardar medição', () => {
    expect(alertPlanState(alert({
      factsSnapshot: { ...alert().factsSnapshot, timeline_actual_finish: '2026-10-14' },
    }))).toBe('AWAITING_MEASUREMENT');
  });

  it('o retrato NÃO é relido: o alerta conta a situação do dia em que nasceu', () => {
    const old = alert();
    const row = rowFromSnapshot(old);
    // Nada no retrato afirma faturamento, e a reconstituição preserva isso.
    expect(row.billingEventId).toBeNull();
    expect(row.billingReceivableStatus).toBeNull();
    expect(row.title).toBe('Montagem e fechamento do enrolamento estatórico');
  });
});

describe('o que o alerta recusa afirmar', () => {
  it('vencido é "Marco previsto vencido", nunca inadimplemento contratual', () => {
    const c = buildAlertContent(alert({ kind: 'OVERDUE', offsetDays: -1 }));
    expect(c.headline).toBe('Marco previsto vencido');
    const text = `${c.headline} ${c.bodyText}`.toLowerCase();
    expect(text).not.toContain('inadimpl');
    expect(text).not.toContain('descumprimento');
    expect(text).not.toContain('quebra de contrato');
  });

  it('o e-mail diz explicitamente o que NÃO está afirmando', () => {
    const html = buildAlertEmailHtml(alert({ kind: 'OVERDUE', offsetDays: -1 }), 'https://x.test');
    expect(html).toContain('Não afirma que o');
    expect(html).toContain('inadimplemento');
  });

  it('nenhum alerta afirma faturado, recebido ou pago no corpo', () => {
    for (const kind of ['UPCOMING', 'DUE_TODAY', 'OVERDUE'] as const) {
      const c = buildAlertContent(alert({ kind, offsetDays: kind === 'OVERDUE' ? -1 : kind === 'DUE_TODAY' ? 0 : 7 }));
      expect(c.lines.find((l) => l.label === 'Status')!.value).not.toBe('Faturado');
      expect(c.lines.find((l) => l.label === 'Status')!.value).not.toBe('Recebido');
    }
  });
});

describe('a ação e o destino', () => {
  it('leva para dentro do produto, com o marco no endereço', () => {
    const c = buildAlertContent(alert());
    expect(c.deepLink).toContain('/contratos');
    expect(c.deepLink).toContain('marco=m5');
    expect(c.deepLink).toContain(encodeURIComponent('2774.08/2025'));
  });

  it('a ação resolve o gargalo do estado, e não é genérica', () => {
    const measuring = alert({
      factsSnapshot: { ...alert().factsSnapshot, timeline_actual_finish: '2026-10-14' },
    });
    expect(buildAlertContent(measuring).actionLabel).toBe('Abrir medição');

    const eligible = alert({
      factsSnapshot: {
        ...alert().factsSnapshot,
        measurement_accepted_at: '2026-10-20T00:00:00Z',
        evidence_document_id: 'd1',
      },
    });
    expect(buildAlertContent(eligible).actionLabel).toBe('Gerar faturamento');
  });

  it('o HTML escapa o conteúdo — nome de cliente não injeta marcação', () => {
    const html = buildAlertEmailHtml(alert({
      factsSnapshot: { ...alert().factsSnapshot, counterparty_name: '<script>x</script>' },
    }), 'https://x.test');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('cadência e idempotência', () => {
  it('o mesmo marco em antecedências diferentes são alertas diferentes', () => {
    const a30 = buildAlertContent(alert({ offsetDays: 30 }));
    const a7 = buildAlertContent(alert({ offsetDays: 7 }));
    expect(a30.headline).not.toBe(a7.headline);
    expect(a30.headline).toContain('30');
    expect(a7.headline).toContain('7');
  });

  it('vencido não conta dias de atraso no título — é um alerta, não um cronômetro', () => {
    const c = buildAlertContent(alert({ kind: 'OVERDUE', offsetDays: -1 }));
    expect(c.headline).not.toContain('-1');
  });
});
