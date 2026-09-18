/**
 * EXPOSIÇÃO, RECONCILIAÇÃO E GARGALO.
 *
 * O teste central deste arquivo é o de um centavo: a divergência real entre o
 * cabeçalho do contrato JA10182283/2025 e a soma dos seis eventos precisa
 * aparecer, e um contrato conferido precisa poder dizer "zero" sem virar
 * "não dá para comparar".
 */
import { describe, it, expect } from 'vitest';
import {
  computeExposure, reconcileEntitlement, computeRevenueBlock, diagnoseBottleneck,
} from '@/lib/contracts/measurement/milestone-exposure';
import { findBottleneck } from '@/lib/contracts/trust/contract-to-cash';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import type { CashStage } from '@/lib/contracts/trust/contract-to-cash';
import { missing, derived } from '@/lib/contracts/trust/trusted';

const row = (over: Partial<MilestoneWorkbenchRow> = {}): MilestoneWorkbenchRow => ({
  id: 'm', organizationId: 'o', contractId: 'c', projectId: 'p',
  title: 'Evento 01', description: null, milestoneType: null, status: 'pending',
  dueDate: null, completedAt: null, billingAmount: 100, measuredAmount: null,
  ownerUserId: null, evidence: null, evidenceDocumentId: null,
  entitlementAmount: 100, entitlementCurrency: 'BRL',
  entitlementSourceDocumentId: 'd', entitlementSourcePage: 1,
  entitlementSourceReference: 'Parte A', entitlementRuleCount: 1,
  requirementId: 'r', requirementCount: 1,
  customerAcceptanceRequired: true, evidenceRequired: true,
  requiredDocumentType: null, reportRequired: null, technicalReportRequired: null,
  governedMappingCount: 0, timelineItemId: null, timelineProjectId: null,
  timelineTitle: null, timelineWbsCode: null, timelineStatus: null,
  timelinePercentComplete: null, timelinePlannedFinish: null, timelineActualFinish: null,
  measurementId: null, measurementStatus: null, measurementReadiness: null,
  measurementReadinessReasons: [], measurementExpectedAt: null,
  measurementSubmittedAt: null, measurementAcceptedAt: null,
  acceptedValue: null, acceptedCurrency: null,
  measurementEvidenceCount: null, measurementMissingRequirementCount: null,
  billingEventId: null, billingEligibilityState: null, billingReleaseState: null,
  billingEligibleAmount: null, billingCurrency: null, billingAmountSource: null,
  billingFiscalDocumentStatus: null, billingReceivableStatus: null, billingFinanceLinkState: null,
  ...over,
});

describe('computeExposure — três verdades somadas em separado', () => {
  it('direito soma; apurado e aceito permanecem null quando ninguém apurou', () => {
    const e = computeExposure([row(), row({ id: 'm2' })]);
    expect(e.entitlementTotal).toBe(200);
    expect(e.measuredTotal).toBeNull();   // e NÃO 0
    expect(e.acceptedTotal).toBeNull();   // e NÃO 0
    expect(e.billedTotal).toBeNull();
  });

  it('o previsto nunca entra no total apurado', () => {
    const e = computeExposure([row({ status: 'measured', billingAmount: 999, measuredAmount: null })]);
    expect(e.measuredTotal).toBeNull();
  });

  it('contagens distinguem gatilho apurado de marco existente', () => {
    // O marco elegível precisa de aceite REGISTRADO e da evidência exigida.
    // `status: 'measured'` sozinho não serve mais: medir é ato de quem
    // executa, e este contrato exige aprovação de Boletim de Medição.
    const e = computeExposure([
      row(), row({ id: 'm2' }),
      row({ id: 'm3', status: 'approved', evidenceDocumentId: 'bm-03' }),
    ]);
    expect(e.counts.total).toBe(3);
    expect(e.counts.triggerAssessed).toBe(1);
    expect(e.counts.readyToBill).toBe(1);
  });

  it('marco apenas MEDIDO não entra na contagem de elegíveis', () => {
    const e = computeExposure([row({ status: 'measured', customerAcceptanceRequired: true })]);
    expect(e.counts.readyToBill).toBe(0);
  });
});

describe('reconcileEntitlement — o centavo do JA10182283/2025', () => {
  it('expõe a divergência de R$ 0,01 sem conciliar', () => {
    const r = reconcileEntitlement(8032339.76, 8032339.77);
    expect(r).not.toBeNull();
    expect(r!.delta).toBeCloseTo(0.01, 4);
    expect(r!.headerTotal).toBe(8032339.76);
    expect(r!.entitlementTotal).toBe(8032339.77);
  });

  it('contrato conferido devolve delta ZERO, não null', () => {
    // "Conferido: zero" é informação; "não dá para comparar" é outra coisa.
    const r = reconcileEntitlement(1000, 1000);
    expect(r).not.toBeNull();
    expect(r!.delta).toBe(0);
  });

  it('não compara quando falta uma das pontas', () => {
    expect(reconcileEntitlement(null, 1000)).toBeNull();
    expect(reconcileEntitlement(1000, null)).toBeNull();
  });

  it('não inventa divergência por ponto flutuante', () => {
    // 0.1 + 0.2 = 0.30000000000000004; em centavos inteiros, não.
    expect(reconcileEntitlement(0.3, 0.1 + 0.2)!.delta).toBe(0);
  });
});

describe('computeRevenueBlock', () => {
  it('o não apurado é o resto, e não se confunde com zero medido', () => {
    const b = computeRevenueBlock([row(), row({ id: 'm2' })], 8032339.77);
    expect(b.accepted).toBe(0);
    expect(b.measuredPending).toBe(0);
    expect(b.unassessed).toBeCloseTo(8032339.77, 2);
  });

  it('aceito não é contado duas vezes com apurado', () => {
    const b = computeRevenueBlock([row({ measuredAmount: 100, acceptedValue: 90 })], 1000);
    expect(b.accepted).toBe(90);
    expect(b.measuredPending).toBe(0);
    expect(b.unassessed).toBe(910);
  });
});

describe('findBottleneck', () => {
  const stage = (key: string, state: CashStage['state']): CashStage => ({
    key: key as CashStage['key'], label: key,
    amount: state === 'measured' ? derived(1, { rule: 'r', from: ['contracts'] }) : missing<number>('no-rows'),
    count: missing<number>('no-rows'), state, note: null, shareOfContracted: null,
  });

  it('aponta o primeiro estágio não apurado', () => {
    const b = findBottleneck([
      stage('contracted', 'measured'), stage('measured', 'unmeasured'),
      stage('approved', 'unmeasured'), stage('billed', 'unmeasured'),
      stage('received', 'not-integrated'),
    ]);
    expect(b?.stage.key).toBe('measured');
    expect(b?.index).toBe(1);
  });

  it('não-integrado NUNCA é gargalo — não está ao alcance de quem lê Contratos', () => {
    const b = findBottleneck([
      stage('contracted', 'measured'), stage('measured', 'measured'),
      stage('approved', 'measured'), stage('billed', 'measured'),
      stage('received', 'not-integrated'),
    ]);
    expect(b).toBeNull();
  });
});

describe('diagnoseBottleneck — causa lida do dado', () => {
  it('sem cronograma no projeto, a causa é o cronograma ausente', () => {
    const d = diagnoseBottleneck([row(), row({ id: 'm2' })], 'proj-1', false);
    expect(d?.note).toContain('não possui itens de cronograma');
    expect(d?.note).toContain('2 marco(s)');
    expect(d?.actionLabel).toBe('Importar cronograma');
  });

  it('com cronograma presente, a causa é o mapeamento ausente', () => {
    const d = diagnoseBottleneck([row()], 'proj-1', true);
    expect(d?.note).toContain('não foram mapeadas');
    expect(d?.actionLabel).toBe('Mapear cronograma');
  });

  it('elegível para faturar não oferece ação automática', () => {
    const d = diagnoseBottleneck([row({
      status: 'approved', measuredAmount: 100, evidenceDocumentId: 'bm-01',
    })], 'p', true);
    expect(d?.note).toContain('ato humano');
    expect(d?.actionLabel).toBeNull();
  });

  it('medido sem aceite aponta o ACEITE como gargalo, não o faturamento', () => {
    const d = diagnoseBottleneck([row({
      status: 'measured', measuredAmount: 100, customerAcceptanceRequired: true,
    })], 'p', true);
    expect(d?.note).not.toContain('ato humano');
  });

  it('sem marcos, diz que falta lastro contratual', () => {
    expect(diagnoseBottleneck([], null, false)?.note).toContain('Nenhum marco contratual');
  });
});

describe('JA10182283/2025 — a leitura atual da aba', () => {
  const eventos = [803233.98, 1606467.95, 2008084.94, 2008084.94, 803233.98, 803233.98]
    .map((amount, i) => row({ id: `e${i + 1}`, billingAmount: amount, entitlementAmount: amount }));

  it('direito soma 8.032.339,77; apurado, aceito e faturado seguem não apurados', () => {
    const e = computeExposure(eventos);
    expect(e.entitlementTotal).toBeCloseTo(8032339.77, 2);
    expect(e.measuredTotal).toBeNull();
    expect(e.acceptedTotal).toBeNull();
    expect(e.billedTotal).toBeNull();
    expect(e.counts.triggerAssessed).toBe(0);
    expect(e.counts.billed).toBe(0);
  });

  it('100% do contratado cai no segmento NÃO APURADO', () => {
    const b = computeRevenueBlock(eventos, 8032339.76);
    expect(b.accepted).toBe(0);
    expect(b.measuredPending).toBe(0);
    expect(b.unassessed).toBeCloseTo(8032339.76, 2);
  });

  it('a divergência de um centavo é exibível', () => {
    const e = computeExposure(eventos);
    expect(reconcileEntitlement(8032339.76, e.entitlementTotal)!.delta).toBeCloseTo(0.01, 4);
  });
});
