/**
 * O CICLO MEDIÇÃO → ANÁLISE CONTRATUAL → ACEITE, provado sem banco.
 *
 * ─── O que estes testes defendem ───────────────────────────────────────────
 *
 * As três confusões que o produto NÃO pode voltar a fazer:
 *
 *   1. aprovar para envio ≠ aceite da Contratante;
 *   2. análise contratual ≠ espera do cliente (são prazos de pessoas diferentes);
 *   3. "informação não localizada" ≠ "requisito não atendido".
 *
 * Nada aqui toca rede nem Postgres: o que é testado é o VOCABULÁRIO e as
 * derivações puras, que é onde as confusões acima realmente moram.
 */
import { describe, expect, it } from 'vitest';

import {
  MEASUREMENT_STATUS_LABEL, REVIEW_BUCKET_ORDER, REVIEW_QUEUE_STATUSES,
  SLA_STATE_LABEL, parseSla, reviewBucketOf,
  type MeasurementStatus,
} from '@/lib/projects/measurements/types';
import {
  VERDICT_PRECEDENCE, VERDICT_TONE, groupFindings, parsePreAnalysis,
  preAnalysisHeadline, requiresHumanDecision,
} from '@/lib/projects/measurements/preanalysis';
import {
  HANDOFFS, buildHandoffContent, handoffDeepLink, handoffKey, slaReminderRoles,
} from '@/lib/projects/measurements/handoff';
import {
  availableActions, sortQueue, summarizeQueue, type ReviewQueueItem,
} from '@/lib/projects/measurements/review-queue';
import { STAGE, deriveStage } from '@/lib/contracts/measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';

// ═══════════════════════════════════════════════════════════════════════════
// 1) O VOCABULÁRIO DE ESTADO
// ═══════════════════════════════════════════════════════════════════════════

describe('estados da análise contratual', () => {
  it('nomeia os três estados que antes eram todos "submetida"', () => {
    expect(MEASUREMENT_STATUS_LABEL.SUBMITTED).toBe('Aguardando análise contratual');
    expect(MEASUREMENT_STATUS_LABEL.UNDER_REVIEW).toBe('Em análise contratual');
    expect(MEASUREMENT_STATUS_LABEL.APPROVED_FOR_CUSTOMER).toBe('Aprovada para envio ao cliente');
    expect(MEASUREMENT_STATUS_LABEL.AWAITING_CUSTOMER_ACCEPTANCE)
      .toBe('Aguardando aceite da contratante');
    expect(MEASUREMENT_STATUS_LABEL.CUSTOMER_CORRECTION_REQUESTED)
      .toBe('Correção solicitada pela contratante');
  });

  it('não chama nenhum estado intermediário de "aceito"', () => {
    for (const [status, label] of Object.entries(MEASUREMENT_STATUS_LABEL)) {
      if (status === 'ACCEPTED') continue;
      expect(label.toLowerCase()).not.toBe('aceita');
      expect(label.toLowerCase()).not.toContain('aceita em');
    }
  });

  it('a fila cobre exatamente os estados que esperam alguém de Contratos ou do Projeto', () => {
    expect([...REVIEW_QUEUE_STATUSES].sort()).toEqual([
      'APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE',
      'CUSTOMER_CORRECTION_REQUESTED', 'RETURNED_FOR_CORRECTION',
      'SUBMITTED', 'UNDER_REVIEW',
    ]);
  });

  it('todo estado da fila cai num balde, e nenhum estado terminal cai em balde', () => {
    for (const s of REVIEW_QUEUE_STATUSES) {
      const bucket = reviewBucketOf(s);
      expect(bucket).not.toBeNull();
      expect(REVIEW_BUCKET_ORDER).toContain(bucket!);
    }
    const terminais: MeasurementStatus[] =
      ['PLANNED', 'IN_PREPARATION', 'READY_FOR_SUBMISSION', 'ACCEPTED', 'REJECTED',
        'CANCELLED', 'SUPERSEDED'];
    for (const s of terminais) expect(reviewBucketOf(s)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) AS AÇÕES — aprovar para envio nunca aceita
// ═══════════════════════════════════════════════════════════════════════════

function queueItem(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    measurementId: 'm1', contractId: 'c1', projectId: 'p1', milestoneId: 'ms1',
    status: 'SUBMITTED', statusLabel: 'x', bucket: 'AWAITING_CONTRACT_REVIEW', revision: 1,
    contractNumber: 'JA10182283/2025', contractTitle: null, counterpartyName: null,
    projectCode: '2774.08/2025', projectName: null, projectClient: null,
    milestoneTitle: 'Evento 01', milestoneDueDate: null,
    timelineTitle: null, timelineWbsCode: null,
    timelinePlannedFinish: null, timelineActualFinish: null,
    canViewValues: true, milestoneAmount: 100, measuredValue: null, acceptedValue: null,
    currency: 'BRL',
    submittedAt: '2026-09-01T00:00:00Z', reviewStartedAt: null, approvedForCustomerAt: null,
    sentToCustomerAt: null, customerCorrectionAt: null, returnedAt: null,
    customerDueAt: null, returnReason: null, customerCorrectionReason: null,
    readinessOverall: 'INCOMPLETE', readinessReasons: [], readinessComputedAt: null,
    evidenceCount: 1, missingRequirementCount: 0, unknownRequirementCount: 0,
    openCorrectionCount: 0, dispatchCount: 0,
    preAnalysis: parsePreAnalysis(null, 'm1'),
    sla: parseSla(null),
    ...over,
  };
}

describe('ações disponíveis por estado', () => {
  it('aprovado para envio NÃO oferece registrar aceite: falta enviar ao cliente', () => {
    const actions = availableActions(queueItem({ status: 'APPROVED_FOR_CUSTOMER' }));
    expect(actions).toContain('send_to_customer');
    expect(actions).not.toContain('record_acceptance');
  });

  it('o aceite só é oferecido depois de o pacote ter SAÍDO', () => {
    expect(availableActions(queueItem({ status: 'SUBMITTED' })))
      .not.toContain('record_acceptance');
    expect(availableActions(queueItem({ status: 'UNDER_REVIEW' })))
      .not.toContain('record_acceptance');
    expect(availableActions(queueItem({ status: 'AWAITING_CUSTOMER_ACCEPTANCE' })))
      .toContain('record_acceptance');
  });

  it('quando a bola está com o Projeto, Contratos não tem ação', () => {
    expect(availableActions(queueItem({ status: 'RETURNED_FOR_CORRECTION' }))).toEqual([]);
    expect(availableActions(queueItem({ status: 'CUSTOMER_CORRECTION_REQUESTED' }))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) O SLA — prazo não declarado não é "no prazo"
// ═══════════════════════════════════════════════════════════════════════════

describe('SLA', () => {
  it('estado irreconhecível cai para NOT_ASSESSED, nunca para ON_TIME', () => {
    expect(parseSla({ state: 'QUALQUER_COISA' }).state).toBe('NOT_ASSESSED');
    expect(parseSla(null).state).toBe('NOT_ASSESSED');
    expect(parseSla(undefined).state).toBe('NOT_ASSESSED');
  });

  it('NOT_ASSESSED é dito como prazo não declarado, e não como conformidade', () => {
    expect(SLA_STATE_LABEL.NOT_ASSESSED).toBe('Prazo não declarado');
    // O ponto: NOT_ASSESSED nunca pode se apresentar como conformidade.
    expect(SLA_STATE_LABEL.NOT_ASSESSED).not.toBe(SLA_STATE_LABEL.ON_TIME);
    expect(SLA_STATE_LABEL.ON_TIME).toBe('No prazo');
  });

  it('preserva prazo, folga e escalonamento quando o banco os informa', () => {
    const sla = parseSla({
      stage: 'CUSTOMER_ACCEPTANCE', state: 'OVERDUE', due_at: '2026-09-10',
      since: '2026-08-01T00:00:00Z', days_remaining: -11, escalated: true,
      escalation_target_user_id: 'u9',
    });
    expect(sla.stage).toBe('CUSTOMER_ACCEPTANCE');
    expect(sla.state).toBe('OVERDUE');
    expect(sla.dueAt).toBe('2026-09-10');
    expect(sla.daysRemaining).toBe(-11);
    expect(sla.escalated).toBe(true);
    expect(sla.escalationTargetUserId).toBe('u9');
  });

  it('a fila põe o vencido na frente, e o sem prazo no fim', () => {
    const sorted = sortQueue([
      queueItem({ measurementId: 'sem', sla: parseSla({ stage: 'CONTRACT_REVIEW', state: 'NOT_ASSESSED' }) }),
      queueItem({ measurementId: 'no-prazo', sla: parseSla({ stage: 'CONTRACT_REVIEW', state: 'ON_TIME', due_at: '2026-12-01' }) }),
      queueItem({ measurementId: 'vencido', sla: parseSla({ stage: 'CONTRACT_REVIEW', state: 'OVERDUE', due_at: '2026-09-01' }) }),
    ]);
    expect(sorted.map((i) => i.measurementId)).toEqual(['vencido', 'no-prazo', 'sem']);
  });

  it('o resumo conta separadamente o vencido e o sem prazo declarado', () => {
    const s = summarizeQueue([
      queueItem({ sla: parseSla({ stage: 'CONTRACT_REVIEW', state: 'OVERDUE', due_at: '2026-09-01' }) }),
      queueItem({ sla: parseSla({ stage: 'CONTRACT_REVIEW', state: 'NOT_ASSESSED' }) }),
    ]);
    expect(s.overdue).toBe(1);
    expect(s.termNotDeclared).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) A PRÉ-ANÁLISE — cinco desfechos, e o denominador honesto
// ═══════════════════════════════════════════════════════════════════════════

describe('pré-análise do Apex', () => {
  it('veredito irreconhecível vira REVISÃO HUMANA, nunca "atendido"', () => {
    const s = parsePreAnalysis({
      analyzed: true,
      findings: [{ requirement_kind: 'EVIDENCE', verdict: 'SIM_CLARO' }],
    }, 'm1');
    expect(s.findings[0].verdict).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('descarta achado sobre exigência que não existe no vocabulário', () => {
    const s = parsePreAnalysis({
      analyzed: true,
      findings: [{ requirement_kind: 'CARIMBO_DO_FISCAL', verdict: 'MET' }],
    }, 'm1');
    expect(s.findings).toHaveLength(0);
  });

  it('"informação não localizada" tem tom NEUTRO — silêncio não é negativa', () => {
    expect(VERDICT_TONE.NOT_FOUND).toBe('neutral');
    expect(VERDICT_TONE.NOT_MET).toBe('attention');
    expect(VERDICT_TONE.INCONSISTENT).toBe('critical');
  });

  it('a manchete não existe sem denominador — nunca "0/0 atendidos"', () => {
    expect(preAnalysisHeadline(parsePreAnalysis({ analyzed: false }, 'm1'))).toBeNull();
    const semVerificavel = parsePreAnalysis({ analyzed: true, verifiable: 0, met: 0 }, 'm1');
    expect(preAnalysisHeadline(semVerificavel))
      .toBe('Nenhum requisito verificável por documento neste marco');
  });

  it('a manchete diz "4/5 requisitos verificáveis atendidos"', () => {
    const s = parsePreAnalysis({ analyzed: true, verifiable: 5, met: 4 }, 'm1');
    expect(preAnalysisHeadline(s)).toBe('4/5 requisitos verificáveis atendidos');
  });

  it('inconsistência e revisão humana exigem decisão; falta conhecida, não', () => {
    const base = { analyzed: true, verifiable: 2, met: 1 };
    expect(requiresHumanDecision(parsePreAnalysis({ ...base, inconsistent: 1 }, 'm1'))).toBe(true);
    expect(requiresHumanDecision(parsePreAnalysis({ ...base, needs_human_review: 1 }, 'm1'))).toBe(true);
    expect(requiresHumanDecision(parsePreAnalysis({ ...base, not_met: 1 }, 'm1'))).toBe(false);
    expect(requiresHumanDecision(parsePreAnalysis({ ...base, not_found: 1 }, 'm1'))).toBe(false);
  });

  it('agrupa os achados na ordem de gravidade do plano', () => {
    const s = parsePreAnalysis({
      analyzed: true,
      findings: [
        { requirement_kind: 'DOCUMENT', verdict: 'NOT_FOUND' },
        { requirement_kind: 'EVIDENCE', verdict: 'INCONSISTENT' },
        { requirement_kind: 'TECHNICAL_REPORT', verdict: 'MET', quote: 'x' },
      ],
    }, 'm1');
    expect(groupFindings(s).map((g) => g.verdict)).toEqual(['INCONSISTENT', 'MET', 'NOT_FOUND']);
    expect(VERDICT_PRECEDENCE[0]).toBe('INCONSISTENT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) OS HANDOFFS — destinatário nomeado, e nada de departamento
// ═══════════════════════════════════════════════════════════════════════════

describe('handoffs', () => {
  it('todo handoff declara tipo de notificação e destino', () => {
    for (const def of Object.values(HANDOFFS)) {
      expect(def.notificationType).toMatch(/^[a-z]+\.[a-z_.]+$/);
      expect(['project', 'contracts', 'fiscal']).toContain(def.target);
    }
  });

  it('o lembrete de SLA vai para quem detém a etapa — nunca para todos', () => {
    expect(slaReminderRoles('SUBMITTED')).toEqual(['contract_manager']);
    expect(slaReminderRoles('AWAITING_CUSTOMER_ACCEPTANCE')).toEqual(['contract_manager']);
    expect(slaReminderRoles('RETURNED_FOR_CORRECTION'))
      .toEqual(['project_manager', 'measurement_responsible']);
    // Estado sem etapa de espera não gera lembrete para ninguém.
    expect(slaReminderRoles('ACCEPTED')).toEqual([]);
  });

  it('a correção pedida pela contratante avisa Projeto E Contratos', () => {
    const roles = HANDOFFS['measurement.customer_correction_requested'].roles;
    expect(roles).toContain('project_manager');
    expect(roles).toContain('contract_manager');
  });

  it('NF a emitir vai só para o responsável financeiro', () => {
    expect(HANDOFFS['measurement.invoice_due'].roles).toEqual(['finance_owner']);
  });

  it('a chave de deduplicação muda com a rodada — a 2ª correção volta a avisar', () => {
    expect(handoffKey('measurement.correction_requested', 1))
      .toBe('measurement.correction_requested:r1');
    expect(handoffKey('measurement.correction_requested', 1, 2))
      .not.toBe(handoffKey('measurement.correction_requested', 1, 1));
  });

  it('o link leva ao ITEM, e cada handoff ao módulo que resolve o assunto', () => {
    const subject = {
      measurementId: 'm1', projectId: 'p1', projectCode: '2774.08/2025',
      contractId: 'c1', contractNumber: 'JA10182283/2025',
      milestoneId: 'ms1', milestoneTitle: 'Evento 01',
      status: 'SUBMITTED' as MeasurementStatus, pending: [], reason: null, dueAt: null,
    };
    expect(handoffDeepLink('measurement.correction_requested', subject))
      .toContain('/projetos/p1');
    expect(handoffDeepLink('measurement.correction_requested', subject))
      .toContain('milestone=ms1');
    expect(handoffDeepLink('measurement.submitted_for_review', subject))
      .toContain('measurement=m1');
    expect(handoffDeepLink('measurement.invoice_due', subject)).toContain('/fiscal/notas');
  });

  it('o aviso não afirma aceite, e traz as pendências traduzidas', () => {
    const content = buildHandoffContent('measurement.approved_for_customer', {
      measurementId: 'm1', projectId: 'p1', projectCode: '2774.08/2025',
      contractId: 'c1', contractNumber: 'JA10182283/2025',
      milestoneId: 'ms1', milestoneTitle: 'Evento 01',
      status: 'APPROVED_FOR_CUSTOMER', pending: ['Falta documento contratual exigido'],
      reason: null, dueAt: null,
    });
    expect(content.headline).toBe('Pacote aprovado para envio à contratante');
    expect(content.bodyText).toContain('Aprovada para envio ao cliente');
    expect(content.bodyText).toContain('Falta documento contratual exigido');
    // A palavra "aceite" não aparece afirmando aceite nenhum.
    expect(content.bodyText.toLowerCase()).not.toContain('aceitou');
  });

  it('prazo ausente NÃO vira uma linha vazia de prazo', () => {
    const content = buildHandoffContent('measurement.sent_to_customer', {
      measurementId: 'm1', projectId: 'p1', projectCode: null,
      contractId: 'c1', contractNumber: 'JA10182283/2025',
      milestoneId: null, milestoneTitle: null,
      status: 'AWAITING_CUSTOMER_ACCEPTANCE', pending: [], reason: null, dueAt: null,
    });
    expect(content.bodyText).not.toContain('Prazo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) O ESTÁGIO DO MARCO — análise interna ≠ espera do cliente
// ═══════════════════════════════════════════════════════════════════════════

function workbenchRow(over: Partial<MilestoneWorkbenchRow> = {}): MilestoneWorkbenchRow {
  return {
    milestoneId: 'ms1', contractId: 'c1', organizationId: 'o1',
    title: 'Evento 01', status: 'pending', dueDate: null, completedAt: null,
    ownerUserId: 'u1', evidence: null, evidenceDocumentId: null,
    billingAmount: null, measuredAmount: null,
    requirementId: 'r1', evidenceRequired: true, customerAcceptanceRequired: true,
    governedMappingCount: 1, timelineItemId: 't1', timelineTitle: 'Etapa',
    timelineWbsCode: '1.1', timelineStatus: 'completed', timelineActualFinish: '2026-09-01',
    timelinePercentComplete: 100, timelineProjectId: 'p1', projectId: 'p1',
    measurementId: 'm1', measurementStatus: null, measurementReadiness: null,
    measurementReadinessReasons: [], measurementAcceptedAt: null, acceptedValue: null,
    entitlementRuleCount: 1, entitlementAmount: null, entitlementSourcePage: null,
    billingEventId: null, billingReleaseState: null, billingReceivableStatus: null,
    ...over,
  } as MilestoneWorkbenchRow;
}

describe('estágio do marco', () => {
  it('análise contratual tem estágio PRÓPRIO, distinto do aceite', () => {
    expect(deriveStage(workbenchRow({ measurementStatus: 'SUBMITTED' })).stage)
      .toBe('AWAITING_CONTRACT_REVIEW');
    expect(deriveStage(workbenchRow({ measurementStatus: 'UNDER_REVIEW' })).stage)
      .toBe('AWAITING_CONTRACT_REVIEW');
    expect(deriveStage(workbenchRow({ measurementStatus: 'AWAITING_CUSTOMER_ACCEPTANCE' })).stage)
      .toBe('AWAITING_ACCEPTANCE');
  });

  it('APROVADO PARA ENVIO continua sendo trabalho de casa, e não espera do cliente', () => {
    expect(deriveStage(workbenchRow({ measurementStatus: 'APPROVED_FOR_CUSTOMER' })).stage)
      .toBe('AWAITING_CONTRACT_REVIEW');
  });

  it('nenhum estado novo alcança READY_TO_BILL sem aceite registrado', () => {
    for (const st of ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED_FOR_CUSTOMER',
      'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_CORRECTION_REQUESTED',
      'RETURNED_FOR_CORRECTION'] as MeasurementStatus[]) {
      const stage = deriveStage(workbenchRow({ measurementStatus: st })).stage;
      expect(stage).not.toBe('READY_TO_BILL');
      expect(stage).not.toBe('BILLED');
    }
  });

  it('correção pedida volta a ser trabalho de evidência do projeto', () => {
    expect(deriveStage(workbenchRow({ measurementStatus: 'RETURNED_FOR_CORRECTION' })).stage)
      .toBe('AWAITING_EVIDENCE');
    expect(deriveStage(workbenchRow({ measurementStatus: 'CUSTOMER_CORRECTION_REQUESTED' })).stage)
      .toBe('AWAITING_EVIDENCE');
  });

  it('o estágio novo pertence ao grupo de evidência/aceite e já teve gatilho apurado', () => {
    expect(STAGE.AWAITING_CONTRACT_REVIEW.group).toBe('AWAITING_EVIDENCE_OR_ACCEPTANCE');
    expect(STAGE.AWAITING_CONTRACT_REVIEW.triggerAssessed).toBe(true);
    expect(STAGE.AWAITING_CONTRACT_REVIEW.dashed).toBe(false);
  });
});
