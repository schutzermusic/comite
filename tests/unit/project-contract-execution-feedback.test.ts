/**
 * PROJETO → CONTRATO: as RECUSAS da realimentação de execução.
 *
 * Os testes que importam aqui provam o que a camada se nega a afirmar:
 * que cronograma não vira medição, que medição não vira aceite, que aceite
 * não vira nota, e que ausência de mapeamento permanece NÃO APURADO em vez de
 * virar "não ocorreu".
 */
import { describe, it, expect } from 'vitest';
import {
  deriveExecutionFeedback, deriveTriggerAssessment, triggerAgreesWithView,
  rollupExecution, EXECUTION_FEEDBACK,
} from '@/lib/projects/contract/execution-feedback';
import type { ProjectContractMilestone } from '@/lib/projects/contract/project-contract-types';
import {
  toProjectContractFinancial, toProjectContractMilestone,
} from '@/lib/projects/contract/project-contract-types';

/** Marco do projeto como JA10182283/2025 está hoje: direito e exigência, sem operação. */
const base = (over: Partial<ProjectContractMilestone> = {}): ProjectContractMilestone => ({
  projectId: 'proj-2774', organizationId: 'o1', contractId: 'c1', milestoneId: 'm1',
  title: 'Evento 01', description: null, milestoneType: 'evento_contratual',
  status: 'pending', dueDate: null, completedAt: null,
  entitlementAmount: 803233.98, entitlementCurrency: 'BRL', entitlementRuleCount: 1,
  entitlementSharePercent: 10, plannedBillingAmount: 803233.98,
  entitlementSourceDocumentId: 'd1', entitlementSourcePage: 1,
  entitlementSourceReference: 'Parte A, item 4',
  measurementRequired: true, requiredDocumentType: 'boletim_medicao',
  evidenceRequired: true, reportRequired: false, technicalReportRequired: false,
  customerAcceptanceRequired: true,
  governedMappingCount: 0, timelineItemId: null, timelineProjectId: null,
  timelineTitle: null, timelineWbsCode: null, timelineStatus: null,
  timelinePercentComplete: null, timelinePlannedFinish: null, timelineActualFinish: null,
  triggerAssessment: 'NOT_ASSESSED',
  measurementId: null, measurementStatus: null, measurementReadiness: null,
  measurementAcceptedAt: null, acceptedValue: null, measurementEvidenceCount: null,
  measuredAmount: null, evidenceDocumentId: null,
  billingEventId: null, billingEligibilityState: null, billingReleaseState: null,
  billingReceivableStatus: null,
  ...over,
});

/** Marco com ponte ACEITA até uma etapa real de cronograma. */
const mapped = (over: Partial<ProjectContractMilestone> = {}) => base({
  governedMappingCount: 1, timelineItemId: 't1', timelineProjectId: 'proj-2774',
  timelineTitle: 'Transporte do estator', timelineWbsCode: '3.2.1',
  timelineStatus: 'in_progress', triggerAssessment: 'NOT_OCCURRED', ...over,
});

describe('apuração do gatilho — ausência de mapeamento é NÃO APURADO', () => {
  it('sem mapeamento governado → NOT_ASSESSED, nunca NOT_OCCURRED', () => {
    expect(deriveTriggerAssessment(base())).toBe('NOT_ASSESSED');
    // A diferença é o ponto inteiro: "ninguém olhou" ≠ "olhou e não ocorreu".
    expect(deriveTriggerAssessment(base())).not.toBe('NOT_OCCURRED');
  });

  it('mapeamento apenas PROPOSTO não conta como ponte', () => {
    // `governedMappingCount` só conta aceitos; a etapa existir não basta.
    expect(deriveTriggerAssessment(base({ governedMappingCount: 0, timelineItemId: 't1' })))
      .toBe('NOT_ASSESSED');
  });

  it('ponte aceita com etapa aberta → NOT_OCCURRED', () => {
    expect(deriveTriggerAssessment(mapped())).toBe('NOT_OCCURRED');
  });

  it('ponte aceita com fim REAL registrado → OCCURRED', () => {
    expect(deriveTriggerAssessment(mapped({ timelineStatus: 'completed' }))).toBe('OCCURRED');
    expect(deriveTriggerAssessment(mapped({ timelineActualFinish: '2026-03-01' }))).toBe('OCCURRED');
  });

  it('percent_complete = 100 NÃO é prova de conclusão', () => {
    const row = mapped({ timelinePercentComplete: 100, timelineStatus: 'in_progress' });
    expect(deriveTriggerAssessment(row)).toBe('NOT_OCCURRED');
    expect(deriveExecutionFeedback(row).state).toBe('TRIGGER_NOT_OCCURRED');
  });

  it('a derivação da tela concorda com a coluna da visão 175', () => {
    for (const row of [
      base(),
      mapped(),
      mapped({ timelineStatus: 'completed', triggerAssessment: 'OCCURRED' }),
    ]) {
      expect(triggerAgreesWithView(row)).toBe(true);
    }
    // E detecta quando divergem — que é o defeito que ela existe para pegar.
    expect(triggerAgreesWithView(base({ triggerAssessment: 'OCCURRED' }))).toBe(false);
  });
});

describe('a cadeia de realimentação, elo por elo', () => {
  it('sem nada apurado → NOT_ASSESSED, tracejado', () => {
    const fb = deriveExecutionFeedback(base());
    expect(fb.state).toBe('NOT_ASSESSED');
    expect(fb.dashed).toBe(true);
    expect(fb.triggerAssessed).toBe(false);
  });

  it('execução concluída NÃO vira medição', () => {
    const fb = deriveExecutionFeedback(mapped({ timelineStatus: 'completed' }));
    expect(fb.state).toBe('EXECUTION_COMPLETE');
    expect(fb.state).not.toBe('ELIGIBLE_TO_BILL');
  });

  it('medição submetida NÃO vira aceite', () => {
    expect(deriveExecutionFeedback(mapped({
      measurementId: 'x', measurementStatus: 'SUBMITTED',
    })).state).toBe('AWAITING_CUSTOMER_ACCEPTANCE');
  });

  it('medido com aceite EXIGIDO para em AWAITING_CUSTOMER_ACCEPTANCE', () => {
    expect(deriveExecutionFeedback(base({
      status: 'measured', customerAcceptanceRequired: true,
    })).state).toBe('AWAITING_CUSTOMER_ACCEPTANCE');
  });

  it('medido com aceite DISPENSADO pelo contrato torna-se elegível', () => {
    expect(deriveExecutionFeedback(base({
      status: 'measured', customerAcceptanceRequired: false,
    })).state).toBe('ELIGIBLE_TO_BILL');
  });

  it('aceite registrado torna elegível — e elegível não é faturado', () => {
    const row = base({ measurementId: 'x', measurementStatus: 'ACCEPTED' });
    expect(deriveExecutionFeedback(row).state).toBe('ELIGIBLE_TO_BILL');
    expect(row.billingEventId).toBeNull();
  });

  it('NENHUM estado implica nota emitida ou pagamento recebido', () => {
    // A afirmação vale para a matriz inteira, inclusive BILLING_EVENT_EXISTS:
    // faturar é ato de Contratos, emitir é do Fiscal, receber é de Finanças.
    for (const d of Object.values(EXECUTION_FEEDBACK)) {
      expect(d.impliesInvoiceOrPayment).toBe(false);
    }
  });

  it('progresso de cronograma nunca produz evento de faturamento', () => {
    const avancado = mapped({ timelinePercentComplete: 100, timelineStatus: 'completed' });
    const fb = deriveExecutionFeedback(avancado);
    expect(fb.state).toBe('EXECUTION_COMPLETE');
    expect(avancado.billingEventId).toBeNull();
    expect(avancado.measurementId).toBeNull();
    expect(avancado.acceptedValue).toBeNull();
  });
});

describe('JA10182283/2025 → 2774.08/2025: o retrato de hoje', () => {
  const eventos = [
    { id: 'e1', amount: 803233.98, pct: 10 },
    { id: 'e2', amount: 1606467.95, pct: 20 },
    { id: 'e3', amount: 2008084.94, pct: 25 },
    { id: 'e4', amount: 2008084.94, pct: 25 },
    { id: 'e5', amount: 803233.98, pct: 10 },
    { id: 'e6', amount: 803233.98, pct: 10 },
  ].map((e) => base({
    milestoneId: e.id, entitlementAmount: e.amount, entitlementSharePercent: e.pct,
  }));

  it('os 6 permanecem NÃO APURADOS enquanto não houver cronograma governado', () => {
    for (const m of eventos) {
      expect(deriveExecutionFeedback(m).state).toBe('NOT_ASSESSED');
      expect(m.triggerAssessment).toBe('NOT_ASSESSED');
    }
  });

  it('nada de execução, aceite ou caixa é afirmado', () => {
    const r = rollupExecution(eventos);
    expect(r.milestoneCount).toBe(6);
    expect(r.assessedCount).toBe(0);
    expect(r.notAssessedCount).toBe(6);
    expect(r.eligibleToBillCount).toBe(0);
    expect(r.billedCount).toBe(0);
    expect(r.eligibleEntitlement).toBeNull();   // e NÃO zero
  });

  it('o direito inteiro está na faixa não apurada, e soma 8.032.339,77', () => {
    expect(rollupExecution(eventos).unassessedEntitlement).toBeCloseTo(8032339.77, 2);
  });

  it('os percentuais somam 100', () => {
    const total = eventos.reduce((s, m) => s + (m.entitlementSharePercent ?? 0), 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

describe('normalização — o centavo documental sobrevive', () => {
  it('valor e direito continuam DOIS números, e a divergência tem lugar', () => {
    const fin = toProjectContractFinancial({
      organization_id: 'o1', project_id: 'proj-2774', contract_id: 'c1',
      link_source: 'contract_project_links', linked_at: null,
      contract_number: 'JA10182283/2025', contract_value: '8032339.76',
      entitlement_total: '8032339.77', reconciliation_delta: '0.01',
      entitlement_rule_count: 6, milestone_count: 6,
      measured_total: null, accepted_total: null,
      billed_event_count: 0, governed_mapped_milestone_count: 0,
    });
    expect(fin.contractValue).toBe(8032339.76);
    expect(fin.entitlementTotal).toBe(8032339.77);
    expect(fin.reconciliationDelta).toBeCloseTo(0.01, 10);
    // Os dois não se fundem: nenhum getter devolve "o valor" do contrato.
    expect(fin.contractValue).not.toBe(fin.entitlementTotal);
    // Ausência permanece ausência.
    expect(fin.measuredTotal).toBeNull();
    expect(fin.acceptedTotal).toBeNull();
  });

  it('delta ausente não é conciliado', () => {
    const fin = toProjectContractFinancial({
      organization_id: 'o', project_id: 'p', contract_id: 'c',
      link_source: 'contracts.project_id', contract_number: 'X',
      contract_value: '100', entitlement_total: null, reconciliation_delta: null,
    });
    expect(fin.reconciliationDelta).toBeNull();
    expect(fin.reconciliationDelta).not.toBe(0);
  });

  it('marco sem cronograma normaliza para NOT_ASSESSED e contagens zeradas', () => {
    const m = toProjectContractMilestone({
      project_id: 'p', organization_id: 'o', contract_id: 'c', milestone_id: 'm',
      title: 'Evento 01', status: 'pending',
      entitlement_amount: '803233.98', entitlement_share_percent: '10.000000',
      governed_mapping_count: null, trigger_assessment: 'NOT_ASSESSED',
      measured_amount: null, measurement_accepted_value: null,
      customer_acceptance_required: true,
    });
    expect(m.entitlementAmount).toBe(803233.98);
    expect(m.entitlementSharePercent).toBe(10);
    expect(m.governedMappingCount).toBe(0);
    expect(m.measuredAmount).toBeNull();      // e NÃO 0
    expect(m.acceptedValue).toBeNull();       // e NÃO 0
    expect(deriveExecutionFeedback(m).state).toBe('NOT_ASSESSED');
  });
});
