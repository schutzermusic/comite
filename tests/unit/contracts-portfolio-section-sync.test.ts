/**
 * Sincronização das seções globais com a verdade canônica do contrato.
 *
 * Travas:
 *   · marco contratual ≠ evento de faturamento
 *   · requisito de aprovação sem fluxo → configuração pendente
 *   · requires_attention da carteira = interpretações operacionais (7), não cláusulas (21)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { portfolioBillingStageLabel } from '@/lib/contracts/measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import {
  buildPortfolioApprovalRequirements,
  APPROVAL_REQUIREMENT_STATE_LABEL,
} from '@/lib/contracts/trust/approval-requirements';
import { buildClauseRiskIntelligence } from '@/lib/contracts/trust/clause-risk-intelligence';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import type { ContractDetail, ContractRow } from '@/lib/contracts/contract-service';
import { buildContractIntelligence } from '@/lib/contracts/intelligence/operational-interpretations';

const PAGE = readFileSync('src/app/(main)/contratos/page.tsx', 'utf8');

function milestone(over: Partial<MilestoneWorkbenchRow> = {}): MilestoneWorkbenchRow {
  return {
    id: 'm1',
    organizationId: 'org',
    contractId: 'c1',
    projectId: null,
    title: 'Evento 01',
    description: null,
    milestoneType: null,
    status: 'pending',
    dueDate: null,
    completedAt: null,
    billingAmount: 100,
    measuredAmount: null,
    ownerUserId: null,
    evidence: null,
    evidenceDocumentId: null,
    entitlementAmount: 100,
    entitlementCurrency: 'BRL',
    entitlementSourceDocumentId: null,
    entitlementSourcePage: 10,
    entitlementSourceReference: null,
    entitlementRuleCount: 1,
    requirementId: 'req-1',
    requirementCount: 1,
    customerAcceptanceRequired: true,
    evidenceRequired: null,
    requiredDocumentType: null,
    reportRequired: null,
    technicalReportRequired: null,
    governedMappingCount: 0,
    timelineItemId: null,
    timelineProjectId: null,
    timelineTitle: null,
    timelineWbsCode: null,
    timelineStatus: null,
    timelinePercentComplete: null,
    timelinePlannedFinish: null,
    timelineActualFinish: null,
    measurementId: null,
    measurementStatus: null,
    measurementReadiness: null,
    measurementReadinessReasons: [],
    measurementExpectedAt: null,
    measurementSubmittedAt: null,
    measurementAcceptedAt: null,
    acceptedValue: null,
    acceptedCurrency: null,
    measurementEvidenceCount: null,
    measurementMissingRequirementCount: null,
    billingEventId: null,
    billingEligibilityState: null,
    billingReleaseState: null,
    billingEligibleAmount: null,
    billingCurrency: null,
    billingAmountSource: null,
    billingFiscalDocumentStatus: null,
    billingReceivableStatus: null,
    billingFinanceLinkState: null,
    ...over,
  };
}

describe('portfolio billing stage labels', () => {
  it('marco com direito e sem ponte é previsto contratualmente — não faturado', () => {
    expect(portfolioBillingStageLabel(milestone())).toBe('Previsto contratualmente');
  });

  it('recebido só quando Finanças afirma PAID', () => {
    expect(portfolioBillingStageLabel(milestone({
      billingEventId: 'be-1',
      billingReceivableStatus: 'PAID',
      governedMappingCount: 1,
      timelineItemId: 't1',
      timelineStatus: 'completed',
      timelineActualFinish: '2026-01-01',
      measurementStatus: 'ACCEPTED',
      measurementAcceptedAt: '2026-01-02',
      status: 'approved',
    }))).toBe('Recebido');
  });

  it('billingEventId sem recebimento não vira Recebido', () => {
    const label = portfolioBillingStageLabel(milestone({
      billingEventId: 'be-1',
      governedMappingCount: 1,
      timelineItemId: 't1',
      timelineStatus: 'completed',
      timelineActualFinish: '2026-01-01',
      measurementStatus: 'ACCEPTED',
      measurementAcceptedAt: '2026-01-02',
      status: 'approved',
    }));
    expect(label).not.toBe('Recebido');
    expect(['Faturado', 'Elegível para faturar']).toContain(label);
  });
});

describe('portfolio approval requirements', () => {
  it('exigência sem fluxo vira configuração pendente — não inventa aprovação', () => {
    const result = buildPortfolioApprovalRequirements({
      contracts: [{ id: 'c1', code: 'JA10182283/2025', title: 'Contrato' }],
      billingConditions: [{
        id: 'bc1',
        organization_id: 'org',
        contract_id: 'c1',
        title: 'Pagamento somente por serviços autorizados e aceitos',
        source_page: 40,
        source_amendment_id: null,
        source_clause_id: null,
        source_document_id: null,
        source_reference: null,
        effective_from: null,
        effective_until: null,
        predecessor_id: null,
        effect: 'added',
        created_at: '2026-01-01',
        created_by: null,
        condition_type: 'technical_acceptance_required',
        requirement_text: null,
        milestone_id: null,
        responsible_party_id: null,
        required_document_type: null,
        elapsed_period_days: null,
      }],
      measurementRequirements: [{
        id: 'mr1',
        organization_id: 'org',
        contract_id: 'c1',
        title: 'Medição do Evento 01',
        source_page: 12,
        source_amendment_id: null,
        source_clause_id: null,
        source_document_id: null,
        source_reference: null,
        effective_from: null,
        effective_until: null,
        predecessor_id: null,
        effect: 'added',
        created_at: '2026-01-01',
        created_by: null,
        report_required: null,
        report_type: null,
        required_document_type: null,
        technical_report_required: null,
        tests_inspection_required: null,
        evidence_required: null,
        customer_acceptance_required: true,
        responsible_party_id: null,
        annex_reference: null,
        applicability: null,
        billing_condition_id: null,
        milestone_id: 'm1',
      }],
      legacyApprovalsByContract: new Map(),
      sharedRequestsByContract: new Map(),
      milestonesByContract: new Map([['c1', [milestone({ id: 'm1' })]]]),
    });

    expect(result.requirements.length).toBe(2);
    expect(result.pendingConfigurationCount).toBe(2);
    expect(result.requirements.every((r) => r.state === 'pending_configuration')).toBe(true);
    expect(APPROVAL_REQUIREMENT_STATE_LABEL.pending_configuration)
      .toBe('Configuração pendente / aprovação requerida');
  });
});

describe('carteira global sincroniza com as fontes canônicas', () => {
  it('Faturamentos monta a bancada de marcos antes dos eventos', () => {
    expect(PAGE).toContain('PortfolioBillingMilestones');
    expect(PAGE).toContain('Marcos contratuais de faturamento');
    expect(PAGE).toContain('ContractToCashPanel');
  });

  it('Aprovações consome requisitos governados além das rotas de alçada', () => {
    expect(PAGE).toContain('PortfolioApprovalRequirementsPanel');
    expect(PAGE).toContain('usePortfolioApprovalRequirements');
    expect(PAGE).toContain('ApprovalIntelligencePanel');
  });

  it('o contador de atenção da torre não filtra clauses.interpretation_state', () => {
    expect(PAGE).toContain('buildContractIntelligence(contract.operationalInterpretations.value)');
    expect(PAGE).not.toMatch(
      /contract\.clauses\.value\.filter[\s\S]{0,120}interpretation_state === 'requires_attention'/,
    );
  });
});

describe('JA10182283 shape — attention count', () => {
  const row = (over: Partial<ContractRow> = {}): ContractRow => ({
    id: '0a795a7b-ad6f-4569-b1d5-df9ed204c0c6',
    organization_id: 'org', project_id: null, client_id: null, supplier_id: null,
    title: 'JA10182283/2025', contract_number: 'JA10182283/2025',
    counterparty_name: 'ENEL', contract_type: 'Prestação de serviços',
    status: 'active', lifecycle_stage: null,
    start_date: '2025-01-01', end_date: '2026-12-31', signed_date: null,
    renewal_date: null, currency: 'BRL', total_value: 8_032_339.77, monthly_value: null,
    payment_terms: null, scope_summary: null, risk_level: 'medium', health_score: null,
    owner_user_id: null, created_by: null, updated_by: null,
    created_at: '2025-01-01', updated_at: '2025-01-01', deleted_at: null,
    data_class: 'live',
    ...over,
  } as ContractRow);

  it('21 cláusulas requires_attention não viram attentionCount da carteira', () => {
    const clauses = Array.from({ length: 21 }, (_, i) => ({
      id: `cl-${i}`,
      contract_id: row().id,
      title: `Cláusula ${i}`,
      clause_type: 'geral',
      interpretation_state: 'requires_attention',
    }));
    const ops = Array.from({ length: 7 }, (_, i) => ({
      id: `op-${i}`,
      organization_id: 'org',
      contract_id: row().id,
      analysis_id: 'a1',
      source_document_id: 'd1',
      family: i < 3 ? 'guarantees' : 'insurance_requirements',
      fingerprint: `fp-${i}`,
      normalized_payload: { title: `Item ${i}` },
      source_page: i + 1,
      source_excerpt: 'x',
      confidence: 0.2,
      provider: 'p',
      model: 'm',
      pipeline_version: 'contract-operationalization/1.0.0',
      requesting_user_id: null,
      trust_state: 'requires_attention',
      trust_reasons: ['low_confidence'],
      trust_policy_version: 'contract-operational-trust/1.0.0',
      created_at: `2026-09-14T11:22:${String(10 + i).padStart(2, '0')}.000Z`,
    }));

    const detail: ContractDetail = {
      contract: row(),
      operationalInterpretations: ops as never,
      operationalInterpretationsError: null,
      clauses: clauses as never,
      obligationDefinitions: [],
      penalties: [],
      milestones: [],
      risks: [],
      files: [],
      aiAnalyses: [],
      billingEvents: [] as never,
      obligations: [] as never,
      approvals: [] as never,
      projectLinks: [] as never,
      riskLinks: [] as never,
      documents: [] as never,
      amendments: [],
      amendmentClauses: [],
      amendmentsError: null,
    };

    expect(buildContractIntelligence(ops as never).attentionCount).toBe(7);
    const trusted = buildTrustedContract(detail.contract, relationsBatchFromDetail(detail), []);
    const intel = buildClauseRiskIntelligence([trusted], undefined, { officialOnly: false });
    expect(intel.attentionCount).toBe(7);
    expect(intel.pendingProposals).toHaveLength(7);
    expect(intel.clauses).toHaveLength(21);
  });
});
