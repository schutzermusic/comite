/**
 * P2A — Contract Operations Intelligence.
 *
 * Todo módulo aqui existe para responder uma pergunta operacional COM dado
 * apurado, ou declarar por que não pode respondê-la. Estes testes travam
 * sobretudo a segunda metade: é fácil escrever inteligência que sempre tem uma
 * resposta, e é exatamente isso que não pode acontecer.
 */

import { describe, it, expect } from 'vitest';
import {
  contractToCash, portfolioToCash, isBilled, type CashStageKey,
} from '@/lib/contracts/trust/contract-to-cash';
import {
  buildObligationsTower, bucketOf, obligationOwners,
} from '@/lib/contracts/trust/obligations-tower';
import {
  buildRenewalHorizon, bandOf, RENEWAL_WINDOWS,
} from '@/lib/contracts/trust/renewal-horizon';
import {
  buildApprovalIntelligence, buildPortfolioApprovals,
} from '@/lib/contracts/trust/approval-intelligence';
import { buildClauseRiskIntelligence } from '@/lib/contracts/trust/clause-risk-intelligence';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import { hasOfficialValue, isMissing } from '@/lib/contracts/trust/trusted';
import type { ContractDetail, ContractRow } from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG } from './fixtures/contract-fixtures';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const ID = 'qa-contract-0001';

const row = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: '[QA] Contrato de Serviços', contract_number: 'QA-0001',
  counterparty_name: 'Fornecedor QA Ltda.', contract_type: 'Prestação de serviços',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13', signed_date: '2026-05-13',
  renewal_date: null, currency: 'BRL', total_value: 1_200_000, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'high', health_score: null,
  owner_user_id: 'u-owner', created_by: 'u-owner', updated_by: 'u-owner',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z', deleted_at: null,
  data_class: 'live',
  ...over,
} as ContractRow);

const base: ContractDetail = {
  contract: row(), clauses: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never, amendments: [], amendmentClauses: [], amendmentsError: null
};

const full: ContractDetail = {
  ...base,
  billingEvents: [
    { id: 'b1', contract_id: ID, milestone_id: null, title: 'Parcela 1', amount: 120_000, due_date: '2026-06-01', paid_at: '2026-06-02', status: 'pago', realized_amount: null, realized_at: null },
    { id: 'b2', contract_id: ID, milestone_id: null, title: 'Parcela 2', amount: 480_000, due_date: '2026-12-01', paid_at: null, status: 'pendente', realized_amount: null, realized_at: null },
  ] as never,
  obligations: [
    { id: 'o1', contract_id: ID, title: 'Aberta com folga e evidência', status: 'open', due_date: '2026-12-01', owner_user_id: 'u-a', evidence: 'Aceite técnico' },
    { id: 'o2', contract_id: ID, title: 'Atrasada', status: 'overdue', due_date: '2026-07-01', owner_user_id: 'u-a', evidence: null },
    { id: 'o3', contract_id: ID, title: 'Concluída', status: 'done', due_date: '2026-06-01', owner_user_id: 'u-b', evidence: 'ok' },
    { id: 'o4', contract_id: ID, title: 'Vence em breve', status: 'open', due_date: '2026-08-25', owner_user_id: null, evidence: null },
    { id: 'o5', contract_id: ID, title: 'Aberta com folga SEM evidência', status: 'open', due_date: '2026-12-20', owner_user_id: 'u-b', evidence: null },
  ] as never,
  approvals: [
    { id: 'a1', contract_id: ID, step_name: 'juridico', status: 'approved', reviewer_user_id: 'u-j', deadline_date: '2026-07-05', started_at: '2026-07-01T00:00:00Z', completed_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' },
    { id: 'a2', contract_id: ID, step_name: 'financeiro', status: 'under_review', reviewer_user_id: 'u-f', deadline_date: '2026-07-06', started_at: '2026-07-02T00:00:00Z', completed_at: null, created_at: '2026-07-02T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' },
  ] as never,
  projectLinks: [{ id: 'pl', contract_id: ID, project_id: PROJECT_CEMIG.id }] as never,
  documents: [
    { id: 'd1', contract_id: ID, title: 'Assinado', document_type: 'contract', status: 'approved', approved_at: null, rejection_reason: null },
  ] as never,
};

/** Contrato com marcos instrumentados (P2B). */
const withMilestones: ContractDetail = {
  ...full,
  milestones: [
    { id: 'm1', contract_id: ID, title: 'Mobilização', status: 'measured', due_date: '2026-06-01', completed_at: '2026-06-02T00:00:00Z', billing_amount: 200_000, measured_amount: 200_000, owner_user_id: 'u-a', evidence: 'Boletim de medição 01', evidence_document_id: null },
    { id: 'm2', contract_id: ID, title: 'Fase 1', status: 'approved', due_date: '2026-07-01', completed_at: '2026-07-05T00:00:00Z', billing_amount: 300_000, measured_amount: null, owner_user_id: 'u-b', evidence: null, evidence_document_id: null },
    { id: 'm3', contract_id: ID, title: 'Encerramento', status: 'pending', due_date: '2026-12-01', completed_at: null, billing_amount: 500_000, measured_amount: null, owner_user_id: null, evidence: null, evidence_document_id: null },
  ] as never,
};

const build = (d: ContractDetail, errors = {}, over: Partial<ContractRow> = {}) =>
  buildTrustedContract({ ...d.contract, ...over }, relationsBatchFromDetail(d, errors), [PROJECT_CEMIG], NOW);

const stage = (stages: ReturnType<typeof contractToCash>, key: CashStageKey) =>
  stages.find((s) => s.key === key)!;

// ═══════════════════════════════════════════════════════════════════
// Contract-to-Cash
// ═══════════════════════════════════════════════════════════════════

describe('contractToCash', () => {
  it('entrega os cinco estágios na ordem da cadeia', () => {
    expect(contractToCash(build(full)).map((s) => s.key))
      .toEqual(['contracted', 'measured', 'approved', 'billed', 'received']);
  });

  it('RECEBIDO nunca tem valor e nunca muda — é sempre "não integrado"', () => {
    for (const detail of [base, full]) {
      const received = stage(contractToCash(build(detail)), 'received');
      expect(received.state).toBe('not-integrated');
      expect(isMissing(received.amount)).toBe(true);
      expect(hasOfficialValue(received.amount)).toBe(false);
      expect(received.shareOfContracted).toBeNull();
      expect(received.note).toMatch(/razão financeiro/i);
    }
  });

  it('MEDIDO sem marco registrado é ausência de REGISTRO — não de instrumentação', () => {
    // P2B instrumentou `contract_milestones`. A lacuna deixou de ser de
    // produto e passou a ser de operação: existe por onde registrar.
    const measured = stage(contractToCash(build(full)), 'measured');
    expect(measured.state).toBe('unmeasured');
    expect(isMissing(measured.amount)).toBe(true);
    if (isMissing(measured.amount)) expect(measured.amount.reason).toBe('no-rows');
    expect(measured.note).toMatch(/não é R\$ 0 medido/i);
  });

  it('MEDIDO soma só o marco que a linha AFIRMA medido', () => {
    const measured = stage(contractToCash(build(withMilestones)), 'measured');
    expect(measured.state).toBe('measured');
    expect(hasOfficialValue(measured.amount)).toBe(true);
    // 200k medido + 300k aprovado. O `pending` de 500k é previsão, não medição.
    if (hasOfficialValue(measured.amount)) expect(measured.amount.value).toBe(500_000);
    if (hasOfficialValue(measured.count)) expect(measured.count.value).toBe(2);
  });

  it('valor medido vence o previsto quando os dois existem', () => {
    const divergente: ContractDetail = {
      ...base,
      milestones: [
        { id: 'm1', contract_id: ID, title: 'Medição 1', status: 'measured', due_date: '2026-06-01', completed_at: '2026-06-02T00:00:00Z', billing_amount: 400_000, measured_amount: 350_000, owner_user_id: 'u-a', evidence: 'Boletim', evidence_document_id: null },
      ] as never,
    };
    const measured = stage(contractToCash(build(divergente)), 'measured');
    if (hasOfficialValue(measured.amount)) expect(measured.amount.value).toBe(350_000);
  });

  it('marcos registrados mas nenhum medido não vira R$ 0 silencioso', () => {
    const soPrevisto: ContractDetail = {
      ...base,
      milestones: [
        { id: 'm1', contract_id: ID, title: 'Previsto', status: 'pending', due_date: '2026-12-01', completed_at: null, billing_amount: 500_000, measured_amount: null, owner_user_id: null, evidence: null, evidence_document_id: null },
      ] as never,
    };
    const measured = stage(contractToCash(build(soPrevisto)), 'measured');
    expect(measured.state).toBe('measured');
    if (hasOfficialValue(measured.amount)) expect(measured.amount.value).toBe(0);
    // ...mas a nota diz o porquê do zero: é apurado, não ausente.
    expect(measured.note).toMatch(/Nenhum dos 1 marco/i);
  });

  it('falha ao ler marcos não vira "nenhum marco"', () => {
    const measured = stage(contractToCash(build(withMilestones, { milestones: 'denied' })), 'measured');
    expect(measured.state).toBe('error');
    expect(hasOfficialValue(measured.amount)).toBe(false);
  });

  it('FATURADO soma só o que a linha afirma realizado', () => {
    const billed = stage(contractToCash(build(full)), 'billed');
    expect(hasOfficialValue(billed.amount)).toBe(true);
    if (hasOfficialValue(billed.amount)) expect(billed.amount.value).toBe(120_000);
    expect(billed.shareOfContracted).toBeCloseTo(0.1, 5);
  });

  it('zero evento de faturamento é AUSÊNCIA de registro, não R$ 0 faturado', () => {
    const billed = stage(contractToCash(build(base)), 'billed');
    expect(billed.state).toBe('unmeasured');
    expect(hasOfficialValue(billed.amount)).toBe(false);
    expect(billed.note).toMatch(/não é R\$ 0/i);
  });

  it('APROVADO só libera valor com a rota INTEIRA aprovada', () => {
    // Rota parcial (1 de 2) não aprova metade do contrato.
    const parcial = stage(contractToCash(build(full)), 'approved');
    expect(parcial.state).toBe('unmeasured');
    expect(hasOfficialValue(parcial.amount)).toBe(false);
    expect(parcial.note).toMatch(/1 de 2/);

    const completo: ContractDetail = {
      ...full,
      approvals: [
        { id: 'a1', contract_id: ID, step_name: 'juridico', status: 'approved', reviewer_user_id: null, deadline_date: null, started_at: '2026-07-01T00:00:00Z', completed_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' },
      ] as never,
    };
    const done = stage(contractToCash(build(completo)), 'approved');
    expect(done.state).toBe('measured');
    if (hasOfficialValue(done.amount)) expect(done.amount.value).toBe(1_200_000);
  });

  it('sem rota de alçada, APROVADO é lacuna de controle — não aprovação tácita', () => {
    const approved = stage(contractToCash(build(base)), 'approved');
    expect(approved.state).toBe('unmeasured');
    expect(approved.note).toMatch(/Nenhuma etapa de alçada/i);
  });

  it('isBilled aceita a afirmação da linha por qualquer das três colunas', () => {
    const ev = (o: Record<string, unknown>) => ({ amount: 1, status: 'pendente', paid_at: null, realized_at: null, ...o }) as never;
    expect(isBilled(ev({ realized_at: '2026-01-01' }))).toBe(true);
    expect(isBilled(ev({ paid_at: '2026-01-01' }))).toBe(true);
    expect(isBilled(ev({ status: 'faturado' }))).toBe(true);
    expect(isBilled(ev({}))).toBe(false);
  });
});

describe('portfolioToCash', () => {
  it('não quebra com carteira vazia e declara os dois estágios sem fonte', () => {
    const stages = portfolioToCash([]);
    expect(stages.map((s) => s.key)).toEqual(['contracted', 'measured', 'approved', 'billed', 'received']);
    expect(stages.find((s) => s.key === 'measured')?.state).toBe('unmeasured');
    // RECEBIDO segue sendo o único estágio sem fonte no produto.
    expect(stages.find((s) => s.key === 'received')?.state).toBe('not-integrated');
  });

  it('respeita o escopo quando a aba operacional o pede explicitamente', () => {
    // A aba operacional mostra o que o usuário selecionou e rotula a origem na
    // tela; esconder o que ele pediu para ver contraria a regra de rotular em
    // vez de ocultar. O padrão restritivo continua valendo para quem não pedir.
    const demo = build(full, {}, { data_class: 'demo' });
    const stages = portfolioToCash([demo], { officialOnly: false });
    const contracted = stages.find((s) => s.key === 'contracted')!;
    expect(hasOfficialValue(contracted.amount)).toBe(true);
    if (hasOfficialValue(contracted.amount)) expect(contracted.amount.value).toBe(1_200_000);

    // E mesmo aí, RECEBIDO segue sem número.
    expect(stages.find((s) => s.key === 'received')?.state).toBe('not-integrated');
  });

  it('agrega a medição da carteira a partir dos marcos de cada contrato', () => {
    const stages = portfolioToCash([build(withMilestones)], { officialOnly: false });
    const measured = stages.find((s) => s.key === 'measured')!;
    expect(measured.state).toBe('measured');
    if (hasOfficialValue(measured.amount)) expect(measured.amount.value).toBe(500_000);
  });

  it('exclui contrato de demonstração da cadeia oficial', () => {
    const demo = build(full, {}, { data_class: 'demo' });
    const stages = portfolioToCash([demo]);
    const contracted = stages.find((s) => s.key === 'contracted')!;
    expect(hasOfficialValue(contracted.amount)).toBe(false);
    expect(contracted.note).toMatch(/origem validada/i);
  });

  it('soma apenas contratos de origem validada', () => {
    const stages = portfolioToCash([build(full), build(full, {}, { id: 'x', data_class: 'demo' })]);
    const contracted = stages.find((s) => s.key === 'contracted')!;
    if (hasOfficialValue(contracted.amount)) expect(contracted.amount.value).toBe(1_200_000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Obligations Control Tower
// ═══════════════════════════════════════════════════════════════════

describe('obligations control tower', () => {
  it('classifica as cinco faixas a partir do estado e do prazo', () => {
    const tower = buildObligationsTower([build(full)], NOW);
    expect(tower.counts).toEqual({ overdue: 1, dueSoon: 1, atRisk: 1, onTrack: 1, completed: 1 });
  });

  it('"em risco" é constatação — aberta, com prazo, e sem evidência', () => {
    const tower = buildObligationsTower([build(full)], NOW);
    const atRisk = tower.entries.find((e) => e.bucket === 'atRisk')!;
    expect(atRisk.hasEvidence).toBe(false);
    expect(atRisk.daysToDue).toBeGreaterThan(15);
  });

  it('concluída fora do prazo sai do atraso — senão a torre nunca esvazia', () => {
    expect(bucketOf({ status: 'done', due_date: '2020-01-01', evidence: null } as never, NOW)).toBe('completed');
  });

  it('cada item carrega responsável, prazo, evidência e contexto do contrato', () => {
    const tower = buildObligationsTower([build(full)], NOW);
    for (const entry of tower.entries) {
      expect(entry.contractCode).toBeTruthy();
      expect(entry.contractTitle).toBeTruthy();
      expect(entry).toHaveProperty('ownerUserId');
      expect(entry).toHaveProperty('dueDate');
      expect(entry).toHaveProperty('evidence');
    }
  });

  it('ordena por gravidade e, dentro dela, por proximidade do prazo', () => {
    const buckets = buildObligationsTower([build(full)], NOW).entries.map((e) => e.bucket);
    expect(buckets).toEqual(['overdue', 'dueSoon', 'atRisk', 'onTrack', 'completed']);
  });

  it('contrato SEM obrigação vira lacuna declarada, não torre vazia silenciosa', () => {
    const tower = buildObligationsTower([build(base)], NOW);
    expect(tower.entries).toEqual([]);
    expect(tower.unmappedContracts).toEqual(['QA-0001']);
    expect(tower.coverage).toEqual({ counted: 1, total: 1 });
  });

  it('falha de leitura não vira torre vazia', () => {
    const tower = buildObligationsTower([build(full, { obligations: 'denied' })], NOW);
    expect(tower.erroredContracts).toEqual(['QA-0001']);
    expect(tower.coverage.counted).toBe(0);
    expect(tower.unmappedContracts).toEqual([]);
  });

  it('agrupa carga por responsável e não perde o não atribuído', () => {
    const owners = obligationOwners(buildObligationsTower([build(full)], NOW));
    expect(owners.some((o) => o.ownerUserId === null)).toBe(true);
    expect(owners[0].overdue).toBe(1);
    // Concluídas não contam como carga.
    expect(owners.reduce((s, o) => s + o.open, 0)).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Renewal Horizon
// ═══════════════════════════════════════════════════════════════════

describe('renewal horizon', () => {
  it('cobre as cinco janelas pedidas, mais vencidos e além', () => {
    expect([...RENEWAL_WINDOWS]).toEqual([180, 120, 90, 60, 30]);
    expect(buildRenewalHorizon([build(full)], NOW).bands.map((b) => b.band))
      .toEqual(['expired', 30, 60, 90, 120, 180, 'beyond']);
  });

  it('mapeia dias para faixa sem sobreposição', () => {
    expect(bandOf(-1)).toBe('expired');
    expect(bandOf(0)).toBe(30);
    expect(bandOf(30)).toBe(30);
    expect(bandOf(31)).toBe(60);
    expect(bandOf(180)).toBe(180);
    expect(bandOf(181)).toBe('beyond');
  });

  it('renewal_date vence end_date quando registrada, e a origem fica visível', () => {
    const h = buildRenewalHorizon([build(full, {}, { renewal_date: '2026-09-15' })], NOW);
    expect(h.entries[0].dateSource).toBe('renewal_date');
    expect(h.entries[0].band).toBe(30);

    const semRenovacao = buildRenewalHorizon([build(full)], NOW);
    expect(semRenovacao.entries[0].dateSource).toBe('end_date');
  });

  it('contrato sem NENHUMA data não é chutado para uma janela', () => {
    const h = buildRenewalHorizon([build(full, {}, { end_date: null, renewal_date: null })], NOW);
    expect(h.entries).toEqual([]);
    expect(h.undatedContracts).toEqual([{ code: 'QA-0001', title: '[QA] Contrato de Serviços' }]);
  });

  it('exposição da faixa é nula quando nenhum contrato dela tem valor apurado', () => {
    const h = buildRenewalHorizon([build(full, {}, { total_value: null })], NOW);
    for (const band of h.bands) expect(band.exposure).toBeNull();
  });

  it('não emite recomendação de renovação — só a janela e o fato', () => {
    const entry = buildRenewalHorizon([build(full)], NOW).entries[0];
    expect(Object.keys(entry)).not.toContain('recommendation');
    expect(Object.keys(entry)).not.toContain('suggestedAction');
  });

  it('demonstração fica fora do horizonte oficial', () => {
    const h = buildRenewalHorizon([build(full, {}, { data_class: 'demo' })], NOW);
    expect(h.entries).toEqual([]);
    expect(h.coverage.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Approval Intelligence
// ═══════════════════════════════════════════════════════════════════

describe('approval intelligence', () => {
  it('aponta a etapa corrente como a primeira aberta da rota', () => {
    const ai = buildApprovalIntelligence(build(full), NOW);
    expect(ai.currentStage?.step).toBe('financeiro');
    expect(ai.currentStage?.reviewerUserId).toBe('u-f');
  });

  it('mede SLA só sobre etapas concluídas', () => {
    const ai = buildApprovalIntelligence(build(full), NOW);
    expect(hasOfficialValue(ai.avgHoursPerStep)).toBe(true);
    if (hasOfficialValue(ai.avgHoursPerStep)) expect(ai.avgHoursPerStep.value).toBe(24);
  });

  it('etapa aberta além do prazo é atraso; concluída fora do prazo é histórico', () => {
    const ai = buildApprovalIntelligence(build(full), NOW);
    expect(ai.overdueSteps.map((s) => s.step)).toEqual(['financeiro']);
    // A jurídica também estourou o prazo, mas já foi concluída.
    expect(ai.steps.find((s) => s.step === 'juridico')?.overdueDays).toBeNull();
  });

  it('gargalo é a etapa aberta há mais tempo — nunca uma já resolvida', () => {
    const ai = buildApprovalIntelligence(build(full), NOW);
    expect(ai.bottleneck?.step).toBe('financeiro');
    expect(ai.bottleneck?.isOpen).toBe(true);
  });

  it('sem rota, declara a lacuna em vez de fingir aprovação', () => {
    const ai = buildApprovalIntelligence(build(base), NOW);
    expect(ai.unavailable).toBe('no-route');
    expect(ai.currentStage).toBeNull();
    expect(hasOfficialValue(ai.avgHoursPerStep)).toBe(false);
  });

  it('falha de leitura é distinta de rota inexistente', () => {
    const ai = buildApprovalIntelligence(build(full, { approvals: 'timeout' }), NOW);
    expect(ai.unavailable).toBe('error');
  });

  it('carteira separa contratos sem rota dos que falharam', () => {
    const p = buildPortfolioApprovals([
      build(full),
      build(base, {}, { id: 'sem-rota', contract_number: 'SEM-ROTA' }),
      build(full, { approvals: 'denied' }, { id: 'erro', contract_number: 'ERRO' }),
    ], NOW);
    expect(p.rows.map((r) => r.code)).toEqual(['QA-0001']);
    expect(p.withoutRoute.map((c) => c.code)).toEqual(['SEM-ROTA']);
    expect(p.erroredContracts).toEqual(['ERRO']);
    expect(p.overdueCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Risk & Clause Intelligence — o módulo que diz "ainda não"
// ═══════════════════════════════════════════════════════════════════

describe('risk & clause intelligence', () => {
  it('as três capacidades passaram a ser acionáveis — P2B instrumentou as duas que faltavam', () => {
    const intel = buildClauseRiskIntelligence([build(full)]);
    const byKey = Object.fromEntries(intel.capabilities.map((c) => [c.key, c]));

    for (const key of ['risks', 'clauses', 'penalties'] as const) {
      // Vazio agora é lacuna OPERACIONAL: existe por onde registrar.
      expect(byKey[key].state, key).toBe('no-records');
      expect(byKey[key].actionable, key).toBe(true);
    }
    // E a lista de penalidades carrega a ressalva de permissão de leitura.
    expect(byKey.penalties.limitation).toMatch(/contracts\.view_penalties/);
  });

  it('cláusula registrada não é cláusula validada', () => {
    const registrada = {
      id: 'c1', contract_id: ID, title: 'Multa por atraso', clause_type: 'penalidade',
      content: null, risk_level: 'high', ai_flagged: false, review_status: 'draft',
      amount: null, percentage: 2, term_days: null, source_document_id: null,
      source_page: 12, source_excerpt: null, reviewed_by: null, reviewed_at: null,
    } as never;
    const comClausula: ContractDetail = { ...full, clauses: [registrada] };
    const cap = buildClauseRiskIntelligence([build(comClausula)])
      .capabilities.find((c) => c.key === 'clauses')!;

    expect(cap.state).toBe('available');
    expect(cap.count).toBe(1);
    // O painel precisa dizer que ninguém conferiu ainda.
    expect(cap.summary).toMatch(/0 validada/);
    expect(cap.limitation).toMatch(/registrar não é validar/i);
  });

  it('registro manual nunca se apresenta como extração automática', () => {
    const manual = {
      id: 'c1', contract_id: ID, title: 'Reajuste', clause_type: 'reajuste',
      content: null, risk_level: 'medium', ai_flagged: false, review_status: 'validated',
      amount: null, percentage: null, term_days: 365, source_document_id: null,
      source_page: null, source_excerpt: null, reviewed_by: 'u-a', reviewed_at: '2026-08-01T00:00:00Z',
    } as never;
    const intel = buildClauseRiskIntelligence([build({ ...full, clauses: [manual] })]);
    expect(intel.clauses.every((c) => c.ai_flagged === false)).toBe(true);
  });

  it('toda capacidade sem dado explica a limitação — nunca fica em branco', () => {
    for (const cap of buildClauseRiskIntelligence([build(full)]).capabilities) {
      if (cap.state === 'available') continue;
      expect(cap.limitation, `${cap.key} sem limitação declarada`).toBeTruthy();
      expect(cap.summary).toBeTruthy();
    }
  });

  it('não fabrica inteligência de cláusula quando não há cláusula', () => {
    const intel = buildClauseRiskIntelligence([build(full)]);
    expect(intel.clauses).toEqual([]);
    expect(intel.capabilities.find((c) => c.key === 'clauses')?.count).toBe(0);
  });

  it('lê as cláusulas do próprio read model quando ninguém as passa', () => {
    const clause = {
      id: 'c9', contract_id: ID, title: 'SLA', clause_type: 'sla', content: null,
      risk_level: 'high', ai_flagged: false, review_status: 'validated',
      amount: null, percentage: null, term_days: null, source_document_id: null,
      source_page: null, source_excerpt: null, reviewed_by: null, reviewed_at: null,
    } as never;
    const intel = buildClauseRiskIntelligence([build({ ...full, clauses: [clause] })]);
    expect(intel.clauses.map((c) => c.id)).toEqual(['c9']);
  });

  it('reconhece cláusulas reais no dia em que existirem', () => {
    const clause = { id: 'c1', contract_id: ID, title: 'SLA', clause_type: 'sla', content: null, risk_level: 'high', ai_flagged: false } as never;
    const intel = buildClauseRiskIntelligence([build(full)], [clause]);
    const cap = intel.capabilities.find((c) => c.key === 'clauses')!;
    expect(cap.state).toBe('available');
    expect(cap.limitation).toBeNull();
  });
});
