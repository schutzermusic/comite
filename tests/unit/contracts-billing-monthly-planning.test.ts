/**
 * PLANEJAMENTO MENSAL DE FATURAMENTO.
 *
 * Os testes que importam aqui não são os que somam bonito — são os que provam
 * as RECUSAS:
 *
 *   · previsto não vira faturado, e as somas não se encostam
 *   · ausência não vira zero em soma nenhuma
 *   · marco sem data não cai no mês corrente
 *   · `percent_complete` não produz elegibilidade
 *   · atraso de cronograma não vira inadimplemento contratual
 *   · a data do cronograma governado tem procedência declarada
 */
import { describe, it, expect } from 'vitest';
import {
  deriveBillingPlanState, deriveDelays, computeTotals, variance,
  buildMonthlyPortfolio, buildForecast, aggregateBy,
  monthKey, shiftMonth, monthShortLabel,
  isScheduleAnchored, wasReprogrammed,
} from '@/lib/contracts/billing/planning/monthly-planning';
import {
  toMonthPlanRow, type BillingMonthPlanRawRow, type BillingMonthPlanRow,
} from '@/lib/contracts/billing/planning/month-plan-types';

const AS_OF = new Date('2026-09-20T12:00:00');

/** O EVENTO 05 de JA10182283/2025, tal como o contrato o registra. */
const raw = (over: Partial<BillingMonthPlanRawRow> = {}): BillingMonthPlanRawRow => ({
  milestone_id: 'm5', organization_id: 'o1', contract_id: 'c1',
  contract_number: 'JA10182283/2025',
  counterparty_name: 'ENEL GREEN POWER CACHOEIRA DOURADA S.A.',
  project_id: '2774.08/2025',
  title: 'Montagem e fechamento do enrolamento estatórico',
  description: null, status: 'pending',
  milestone_due_date: null, completed_at: null,
  milestone_owner_user_id: null, contract_owner_user_id: null,
  timeline_responsible_user_id: null,
  planned_amount: '803233.98', planned_amount_basis: 'contract_entitlement',
  entitlement_amount: '803233.98', billing_amount: '803233.98',
  measured_amount: null, accepted_value: null, billing_eligible_amount: null,
  currency: 'BRL',
  planned_billing_date: null, planned_billing_date_basis: 'undetermined',
  planned_billing_month: null,
  governed_mapping_count: 0, timeline_item_id: null, timeline_title: null,
  timeline_wbs_code: null, timeline_status: null,
  timeline_planned_finish: null, timeline_forecast_finish: null,
  timeline_actual_finish: null, timeline_is_active: null,
  timeline_percent_complete: null,
  reprogramming_count: 0, last_previous_planned_finish: null,
  last_new_planned_finish: null, last_reprogrammed_at: null,
  requirement_id: 'r5', customer_acceptance_required: true, evidence_required: true,
  measurement_id: null, measurement_status: null, measurement_readiness: null,
  measurement_expected_at: null, measurement_accepted_at: null,
  measurement_evidence_count: null, evidence_document_id: null, evidence: null,
  billing_event_id: null, billing_eligibility_state: null, billing_release_state: null,
  billing_amount_source: null, billing_fiscal_document_status: null,
  billing_receivable_status: null, billing_finance_link_state: null,
  fiscal_document_number: null, fiscal_authorized_at: null,
  receivable_first_due_date: null, receivable_paid_amount_cents: null,
  receivable_open_amount_cents: null, receivable_last_payment_date: null,
  reconciled_settlement_count: null, payment_term_text: null,
  ...over,
});

const row = (over: Partial<BillingMonthPlanRawRow> = {}): BillingMonthPlanRow =>
  toMonthPlanRow(raw(over));

/** O mesmo marco, agora com ponte GOVERNADA até a etapa de 15/10/2026. */
const scheduled = (over: Partial<BillingMonthPlanRawRow> = {}) => row({
  governed_mapping_count: 1,
  timeline_item_id: 't5',
  timeline_title: 'Montagem do enrolamento estatórico',
  timeline_wbs_code: '4.3.2',
  timeline_status: 'in_progress',
  timeline_is_active: true,
  timeline_planned_finish: '2026-10-15',
  planned_billing_date: '2026-10-15',
  planned_billing_date_basis: 'timeline_planned_finish',
  planned_billing_month: '2026-10',
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('estado de planejamento', () => {
  it('marco contratual sem cronograma é PREVISTO — não "sem dado"', () => {
    expect(deriveBillingPlanState(row())).toBe('PLANNED');
  });

  it('com ponte governada e etapa em curso, aguarda o marco do projeto', () => {
    expect(deriveBillingPlanState(scheduled())).toBe('AWAITING_PROJECT_MILESTONE');
  });

  it('percentual de 100% NÃO torna o marco elegível', () => {
    const optimistic = scheduled({
      timeline_percent_complete: '100',
      timeline_status: 'in_progress',
    });
    expect(deriveBillingPlanState(optimistic)).toBe('AWAITING_PROJECT_MILESTONE');
  });

  it('etapa concluída de fato libera a medição, não o faturamento', () => {
    const done = scheduled({ timeline_actual_finish: '2026-10-14', timeline_status: 'completed' });
    expect(deriveBillingPlanState(done)).toBe('AWAITING_MEASUREMENT');
  });

  it('medido pela própria linha, com aceite exigido, para em aprovação', () => {
    const measured = scheduled({ status: 'measured', customer_acceptance_required: true });
    expect(deriveBillingPlanState(measured)).toBe('AWAITING_APPROVAL');
  });

  it('aceite registrado sem a evidência exigida não é elegível', () => {
    const accepted = scheduled({
      measurement_accepted_at: '2026-10-20T10:00:00Z',
      evidence_required: true,
    });
    expect(deriveBillingPlanState(accepted)).toBe('AWAITING_EVIDENCE');
  });

  it('aceite com evidência é ELEGÍVEL; com evento gerado é FATURADO', () => {
    const eligible = scheduled({
      measurement_accepted_at: '2026-10-20T10:00:00Z',
      evidence_document_id: 'doc-1',
    });
    expect(deriveBillingPlanState(eligible)).toBe('ELIGIBLE');
    expect(deriveBillingPlanState({ ...eligible, billingEventId: 'b1' } as BillingMonthPlanRow))
      .toBe('BILLED');
  });

  it('RECEBIDO só existe quando Finanças afirma liquidação', () => {
    const billed = scheduled({ billing_event_id: 'b1' });
    expect(deriveBillingPlanState(billed)).toBe('BILLED');
    const paid = scheduled({ billing_event_id: 'b1', billing_receivable_status: 'PAID' });
    expect(deriveBillingPlanState(paid)).toBe('RECEIVED');
  });

  it('ausência de evento de faturamento NUNCA se lê como recebido', () => {
    expect(deriveBillingPlanState(row())).not.toBe('RECEIVED');
    expect(deriveBillingPlanState(scheduled())).not.toBe('RECEIVED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('as quatro somas não se encostam', () => {
  it('previsto, elegível, faturado e recebido saem separados', () => {
    const totals = computeTotals([
      row({ milestone_id: 'm4' }),                      // previsto, sem mais nada
      scheduled({ milestone_id: 'm5', measurement_accepted_at: '2026-10-20T10:00:00Z', evidence_document_id: 'd' }),
      scheduled({ milestone_id: 'm6', billing_event_id: 'b1', billing_eligible_amount: '800000.00' }),
      scheduled({
        milestone_id: 'm7', billing_event_id: 'b2', billing_eligible_amount: '803233.98',
        billing_receivable_status: 'PAID', receivable_paid_amount_cents: 80323398,
      }),
    ]);

    expect(totals.plannedTotal).toBeCloseTo(803233.98 * 4, 2);
    expect(totals.eligibleTotal).toBeCloseTo(803233.98, 2);
    // Faturado é o valor do EVENTO, não o previsto do marco.
    expect(totals.billedTotal).toBeCloseTo(800000 + 803233.98, 2);
    expect(totals.receivedTotal).toBeCloseTo(803233.98, 2);
  });

  it('nada apurado devolve null — jamais zero', () => {
    const totals = computeTotals([row(), row({ milestone_id: 'm2' })]);
    expect(totals.billedTotal).toBeNull();
    expect(totals.receivedTotal).toBeNull();
    expect(totals.eligibleTotal).toBeNull();
    expect(totals.blockedTotal).toBeNull();
  });

  it('marco sem valor registrado é contado, não somado como zero', () => {
    const totals = computeTotals([row(), row({ milestone_id: 'm2', planned_amount: null, entitlement_amount: null, billing_amount: null })]);
    expect(totals.plannedUnknownCount).toBe(1);
    expect(totals.plannedTotal).toBeCloseTo(803233.98, 2);
  });

  it('variação é null quando falta um dos lados, nunca zero', () => {
    expect(variance(computeTotals([row()]))).toBeNull();
    const both = computeTotals([
      scheduled({ billing_event_id: 'b1', billing_eligible_amount: '803233.98' }),
    ]);
    expect(variance(both)).toBeCloseTo(0, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('o mês', () => {
  it('marco sem data prevista NÃO cai no mês corrente — vai para undated', () => {
    const portfolio = buildMonthlyPortfolio([row(), scheduled()], { asOf: AS_OF });
    expect(portfolio.undated).toHaveLength(1);
    expect(portfolio.months.map((m) => m.month)).toContain('2026-10');
    const october = portfolio.months.find((m) => m.month === '2026-10')!;
    expect(october.rows).toHaveLength(1);
  });

  it('meses da janela aparecem mesmo vazios', () => {
    const window = ['2026-09', '2026-10', '2026-11'];
    const portfolio = buildMonthlyPortfolio([scheduled()], { asOf: AS_OF, window });
    for (const m of window) {
      expect(portfolio.months.map((x) => x.month)).toContain(m);
    }
    expect(portfolio.months.find((m) => m.month === '2026-11')!.totals.plannedTotal).toBeNull();
  });

  it('posiciona passado, corrente e futuro em relação ao asOf', () => {
    const portfolio = buildMonthlyPortfolio(
      [
        scheduled({ milestone_id: 'a', planned_billing_month: '2026-08', planned_billing_date: '2026-08-10' }),
        scheduled({ milestone_id: 'b', planned_billing_month: '2026-09', planned_billing_date: '2026-09-10' }),
        scheduled({ milestone_id: 'c' }),
      ],
      { asOf: AS_OF },
    );
    expect(portfolio.months.find((m) => m.month === '2026-08')!.position).toBe('past');
    expect(portfolio.months.find((m) => m.month === '2026-09')!.position).toBe('current');
    expect(portfolio.months.find((m) => m.month === '2026-10')!.position).toBe('future');
  });

  it('chaves de mês não escorregam pelo fuso', () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthShortLabel('2026-10')).toBe('Out/26');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('previsão rolante', () => {
  const rows = [
    scheduled({ milestone_id: 'a', planned_billing_month: '2026-09', planned_billing_date: '2026-09-25' }),
    scheduled({ milestone_id: 'b', planned_billing_month: '2026-11', planned_billing_date: '2026-11-05' }),
    scheduled({ milestone_id: 'c', planned_billing_month: '2027-06', planned_billing_date: '2027-06-01' }),
    row({ milestone_id: 'd' }),
  ];

  it('separa corrente, 3, 6 meses e horizonte completo', () => {
    const [current, next3, next6, full] = buildForecast(rows, AS_OF);
    expect(current.totals.count).toBe(1);
    expect(next3.totals.count).toBe(2);   // setembro + novembro
    expect(next6.totals.count).toBe(2);
    expect(full.totals.count).toBe(3);    // tudo que tem mês
  });

  it('marco sem data fica fora de TODA janela', () => {
    for (const w of buildForecast(rows, AS_OF)) {
      expect(w.rows.some((r) => r.plannedBillingMonth === null)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('atraso: três perguntas, três respostas', () => {
  const PAST = new Date('2026-11-20T12:00:00');

  it('data prevista vencida sem gatilho evidenciado é atraso de CRONOGRAMA', () => {
    const delays = deriveDelays(scheduled(), PAST);
    expect(delays).toContain('SCHEDULE_MILESTONE_OVERDUE');
    // E não se converte em afirmação contratual nenhuma.
    expect(delays).not.toContain('CONTRACT_DUE_DATE_PASSED');
  });

  it('etapa concluída de fato limpa o atraso de cronograma', () => {
    const done = scheduled({ timeline_actual_finish: '2026-10-14', timeline_status: 'completed' });
    expect(deriveDelays(done, PAST)).not.toContain('SCHEDULE_MILESTONE_OVERDUE');
  });

  it('prazo do próprio marco vencido é outra coisa, e aparece como outra coisa', () => {
    const withDue = scheduled({ milestone_due_date: '2026-10-31' });
    const delays = deriveDelays(withDue, PAST);
    expect(delays).toContain('CONTRACT_DUE_DATE_PASSED');
  });

  it('elegível sem evento gerado é atraso de FATURAMENTO', () => {
    const eligible = scheduled({
      measurement_accepted_at: '2026-10-20T10:00:00Z', evidence_document_id: 'd',
    });
    expect(deriveDelays(eligible, PAST)).toContain('BILLING_DELAYED');
  });

  it('marco já faturado não fica atrasado para faturar', () => {
    const billed = scheduled({ billing_event_id: 'b1' });
    const delays = deriveDelays(billed, PAST);
    expect(delays).not.toContain('BILLING_DELAYED');
    expect(delays).not.toContain('SCHEDULE_MILESTONE_OVERDUE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('procedência da data', () => {
  it('distingue data do cronograma governado de prazo digitado no marco', () => {
    expect(isScheduleAnchored(scheduled())).toBe(true);
    const fromDue = row({
      planned_billing_date: '2026-10-15',
      planned_billing_date_basis: 'milestone_due_date',
      planned_billing_month: '2026-10',
    });
    expect(isScheduleAnchored(fromDue)).toBe(false);
  });

  it('reprogramação é visível na linha', () => {
    expect(wasReprogrammed(scheduled())).toBe(false);
    expect(wasReprogrammed(scheduled({
      reprogramming_count: 2,
      last_previous_planned_finish: '2026-10-15',
      last_new_planned_finish: '2026-11-28',
    }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('agregação', () => {
  it('agrupa por dimensão sem inventar rótulo', () => {
    const buckets = aggregateBy(
      [scheduled(), scheduled({ milestone_id: 'b' }), scheduled({ milestone_id: 'c', contract_id: 'c2' })],
      (r) => r.contractId,
      (key) => (key === 'c1' ? 'ENEL' : 'Outro'),
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0].label).toBe('ENEL');
    expect(buckets[0].totals.count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('JA10182283/2025 — os seis eventos', () => {
  const SIX = [
    { n: 1, amount: '803233.98', title: 'Na assinatura do contrato e liberação para início' },
    { n: 2, amount: '1606467.95', title: 'No transporte do equipamento para nossa fábrica (CIF)' },
    { n: 3, amount: '2008084.94', title: 'Sacar bobinas | Pedido de materiais' },
    { n: 4, amount: '2008084.94', title: 'Apresentação dos materiais em fábrica e projetos/ desenhos' },
    { n: 5, amount: '803233.98', title: 'Montagem e fechamento do enrolamento estatórico' },
    { n: 6, amount: '803233.98', title: 'Na entrega do relatório final' },
  ].map((e) => row({
    milestone_id: `m${e.n}`, title: e.title,
    planned_amount: e.amount, entitlement_amount: e.amount, billing_amount: e.amount,
  }));

  it('os seis entram na previsão mesmo sem cronograma — e ficam NÃO FATURADOS', () => {
    const portfolio = buildMonthlyPortfolio(SIX, { asOf: AS_OF });
    // Sem cronograma, nenhum tem mês: todos em undated, e isso é a verdade.
    expect(portfolio.undated).toHaveLength(6);
    expect(portfolio.totals.count).toBe(6);
    expect(portfolio.totals.plannedTotal).toBeCloseTo(8032339.77, 2);
    // Nenhum evento de faturamento é inventado.
    expect(portfolio.totals.billedTotal).toBeNull();
    expect(portfolio.totals.receivedTotal).toBeNull();
    expect(portfolio.totals.countByState.PLANNED).toBe(6);
  });

  it('o centavo de divergência documental NÃO é arredondado', () => {
    const total = computeTotals(SIX).plannedTotal!;
    // O cabeçalho do instrumento diz 8.032.339,76; a soma dos direitos, ,77.
    expect(total).not.toBeCloseTo(8032339.76, 2);
    expect(total).toBeCloseTo(8032339.77, 2);
  });

  it('com o cronograma de 15/10/2026 aceito, o evento 05 cai em outubro/2026', () => {
    const withSchedule = SIX.map((r, i) => (i === 4
      ? scheduled({ milestone_id: 'm5', title: r.title })
      : r));
    const portfolio = buildMonthlyPortfolio(withSchedule, { asOf: AS_OF });
    const october = portfolio.months.find((m) => m.month === '2026-10')!;
    expect(october.rows).toHaveLength(1);
    expect(october.rows[0].plannedBillingDate).toBe('2026-10-15');
    expect(october.totals.plannedTotal).toBeCloseTo(803233.98, 2);
    // E continua sem nada faturado.
    expect(october.totals.billedTotal).toBeNull();
  });
});
