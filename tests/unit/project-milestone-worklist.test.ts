/**
 * A FILA DE MEDIÇÕES & EVIDÊNCIAS.
 *
 * O que estes testes protegem não é o layout da aba — é a REGRA que a
 * refatoração introduziu e as CONFUSÕES que ela proíbe:
 *
 *   · mapeamento ACEITO produz item de trabalho, mesmo sem linha em
 *     `project_measurements` (o defeito de JA10182283/2025);
 *   · item previsto nunca aparece como medição realizada;
 *   · evidência anexada não vira aceite, medição não vira elegibilidade,
 *     aceite não vira recebimento;
 *   · a ausência é dita pelo nome certo, e não por um texto único;
 *   · sem portão de valor a quantia é RESTRITA, nunca zero.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import type { BillingMonthPlanRow } from '@/lib/contracts/billing/planning/month-plan-types';
import type { EventLinkState, ProjectContractEvent } from '@/lib/projects/contract-events';
import {
  buildWorklist, describeEmptiness, groupByBucket, summarizeWorklist, toWorkItem,
} from '@/lib/projects/milestone-worklist';

// ───────────────────────────────────────────────────────────────────────────
// Fábricas — a linha de planejamento de um evento real do contrato
// ───────────────────────────────────────────────────────────────────────────

function plan(over: Partial<BillingMonthPlanRow> = {}): BillingMonthPlanRow {
  return {
    milestoneId: 'm2', organizationId: 'org', contractId: 'c1',
    contractNumber: 'JA10182283/2025', counterpartyName: 'ENEL',
    projectId: 'proj-1', title: 'Evento 02 · Transporte do equipamento',
    description: null, status: 'pending', milestoneDueDate: null, completedAt: null,
    milestoneOwnerUserId: null, contractOwnerUserId: null, timelineResponsibleUserId: null,
    plannedAmount: 1_606_467.95, plannedAmountBasis: 'milestone_billing_amount',
    entitlementAmount: null, billingAmount: 1_606_467.95, measuredAmount: null,
    acceptedValue: null, billingEligibleAmount: null, currency: 'BRL',
    plannedBillingDate: '2025-11-20', plannedBillingDateBasis: 'timeline_planned_finish',
    plannedBillingMonth: '2025-11',
    governedMappingCount: 1, timelineItemId: 't-413',
    timelineTitle: 'Transporte do equipamento para fábrica',
    timelineWbsCode: '4.1.3', timelineStatus: 'not_started',
    timelinePlannedFinish: '2025-11-20', timelineForecastFinish: null,
    timelineActualFinish: null, timelineIsActive: true, timelinePercentComplete: 0,
    reprogrammingCount: 0, lastPreviousPlannedFinish: null, lastNewPlannedFinish: null,
    lastReprogrammedAt: null,
    requirementId: 'r1', customerAcceptanceRequired: true, evidenceRequired: true,
    measurementId: null, measurementStatus: null, measurementReadiness: null,
    measurementExpectedAt: null, measurementAcceptedAt: null, measurementEvidenceCount: null,
    evidenceDocumentId: null, evidence: null,
    billingEventId: null, billingEligibilityState: null, billingReleaseState: null,
    billingAmountSource: null, billingFiscalDocumentStatus: null,
    billingReceivableStatus: null, billingFinanceLinkState: null,
    fiscalDocumentNumber: null, fiscalAuthorizedAt: null, receivableFirstDueDate: null,
    receivablePaidAmountCents: null, receivableOpenAmountCents: null,
    receivableLastPaymentDate: null, reconciledSettlementCount: null,
    paymentTermText: null,
    ...over,
  };
}

function event(
  linkState: EventLinkState,
  planOver: Partial<BillingMonthPlanRow> = {},
  over: Partial<ProjectContractEvent> = {},
): ProjectContractEvent {
  return {
    linkState,
    ruleId: 'r1',
    mappingId: linkState === 'UNMATCHED' ? null : 'map-1',
    mappingSource: linkState === 'UNMATCHED' ? null : 'system_proposed',
    reviewState: linkState === 'ACCEPTED' ? 'accepted'
      : linkState === 'UNMATCHED' ? null : 'proposed',
    confidence: null, note: null, mappedAt: null, reviewedAt: null,
    proposedTimelineItemId: null, proposedTimelineTitle: null,
    proposedTimelineWbsCode: null, proposedTimelineFinish: null,
    ambiguousAlternatives: [],
    mappedTimelineItemId: null, mappedTimelineTitle: null,
    mappedTimelineWbsCode: null, mappedTimelineIsActive: true,
    canViewValues: true,
    generatesBilling: true,
    contractTotalValue: 8_032_339.76, contractPercent: 20,
    plan: plan({
      // Vínculo não aceito não carrega etapa governada: a visão só preenche
      // `timeline_*` através da ponte aceita.
      ...(linkState === 'ACCEPTED'
        ? {}
        : {
          governedMappingCount: 0, timelineItemId: null, timelineTitle: null,
          timelineWbsCode: null, timelineStatus: null, timelinePlannedFinish: null,
          plannedBillingDate: null, plannedBillingDateBasis: 'undetermined',
          plannedBillingMonth: null,
        }),
      ...planOver,
    }),
    ...over,
  };
}

/** O recorte real: seis eventos contratuais, cinco aceitos, um ambíguo. */
function ja10182283(): ProjectContractEvent[] {
  const accepted = [1, 2, 3, 4, 6].map((n) => event('ACCEPTED', {
    milestoneId: `m${n}`, title: `Evento 0${n} · Etapa ${n}`,
  }));
  const ambiguous = event('AMBIGUOUS', { milestoneId: 'm5', title: 'Evento 05 · Montagem' });
  return [...accepted, ambiguous];
}

// ───────────────────────────────────────────────────────────────────────────
// O DEFEITO CORRIGIDO: ponte aceita é trabalho, mesmo sem linha de medição
// ───────────────────────────────────────────────────────────────────────────

describe('mapeamento aceito alimenta a fila sem inventar medição', () => {
  it('cria item acionável para marco aceito SEM instância de medição', () => {
    const item = toWorkItem(event('ACCEPTED'));
    expect(item.actionable).toBe(true);
    expect(item.measurementId).toBeNull();
  });

  it('não afirma medição existente: a faceta diz AGUARDANDO e fica tracejada', () => {
    const item = toWorkItem(event('ACCEPTED'));
    expect(item.measurement.label).toBe('Aguardando');
    // Tracejado é o vocabulário reservado de NÃO APURADO.
    expect(item.measurement.dashed).toBe(true);
  });

  it('JA10182283/2025: 5 itens sincronizados e 1 aguardando mapeamento', () => {
    const items = buildWorklist(ja10182283());
    const summary = summarizeWorklist(items);
    expect(summary.total).toBe(6);
    expect(summary.actionable).toBe(5);
    expect(summary.pendingMapping).toBe(1);
  });

  it('o marco ambíguo continua VISÍVEL — pendência de setup não some da tela', () => {
    const items = buildWorklist(ja10182283());
    const ambiguous = items.find((i) => i.milestoneId === 'm5');
    expect(ambiguous?.bucket).toBe('PENDING_MAPPING');
    expect(ambiguous?.actionable).toBe(false);
  });

  it('proposta e sem-vínculo nunca viram trabalho acionável', () => {
    for (const state of ['PROPOSED', 'AMBIGUOUS', 'UNMATCHED'] as const) {
      expect(toWorkItem(event(state)).actionable).toBe(false);
    }
  });

  it('âncora perdida pede REMAPEAMENTO, e não medição', () => {
    expect(toWorkItem(event('ANCHOR_LOST')).bucket).toBe('REMAP_REQUIRED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AS CONFUSÕES PROIBIDAS (§12 do pedido)
// ───────────────────────────────────────────────────────────────────────────

describe('cada estado vem da sua autoridade, e nenhum contamina o outro', () => {
  it('etapa concluída NÃO é medição concluída', () => {
    const item = toWorkItem(event('ACCEPTED', {
      timelineStatus: 'completed', timelineActualFinish: '2025-11-20',
    }));
    expect(item.execution.label).toBe('Concluída');
    expect(item.measurement.label).toBe('Aguardando');
    expect(item.acceptance.label).toBe('Pendente');
  });

  it('evidência anexada NÃO é aceite nem elegibilidade', () => {
    const item = toWorkItem(
      event('ACCEPTED', { measurementEvidenceCount: 3 }),
    );
    expect(item.evidence.label).toBe('3 anexos');
    expect(item.acceptance.label).toBe('Pendente');
    expect(item.billing.label).toBe('Não elegível');
  });

  it('medição própria NÃO libera faturamento onde o contrato exige aceite', () => {
    const item = toWorkItem(event('ACCEPTED', {
      measurementId: 'meas-1', measurementStatus: 'SUBMITTED',
      customerAcceptanceRequired: true,
    }));
    expect(item.bucket).toBe('AWAITING_ACCEPTANCE');
    expect(item.billing.label).toBe('Não elegível');
  });

  it('aceite NÃO é recebimento', () => {
    const item = toWorkItem(event('ACCEPTED', {
      measurementId: 'meas-1', measurementStatus: 'ACCEPTED',
      measurementAcceptedAt: '2025-11-25T10:00:00Z', measurementEvidenceCount: 2,
    }));
    expect(item.acceptance.label).toBe('Aceito');
    expect(item.billing.label).not.toBe('Recebido');
  });

  it('recebido só quando Finanças afirma pagamento', () => {
    const item = toWorkItem(event('ACCEPTED', { billingReceivableStatus: 'PAID' }));
    expect(item.billing.label).toBe('Recebido');
  });

  it('percentual de avanço 100% não conclui a execução', () => {
    const item = toWorkItem(event('ACCEPTED', {
      timelinePercentComplete: 100, timelineStatus: 'in_progress',
    }));
    expect(item.execution.label).toBe('Em andamento');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// EVIDÊNCIA: contagem sem duplicar o mesmo arquivo
// ───────────────────────────────────────────────────────────────────────────

describe('a contagem de evidência não conta o mesmo documento duas vezes', () => {
  it('toma o MÁXIMO entre medição e acervo, nunca a soma', () => {
    const item = toWorkItem(
      event('ACCEPTED', { measurementEvidenceCount: 2 }),
      new Map([['m2', 2]]),
    );
    expect(item.evidenceCount).toBe(2);
  });

  it('documento anexado ao marco aparece antes de existir medição', () => {
    const item = toWorkItem(event('ACCEPTED'), new Map([['m2', 1]]));
    expect(item.evidenceCount).toBe(1);
    expect(item.evidence.label).toBe('1 anexo');
  });

  it('exigência NÃO REGISTRADA fica tracejada — lacuna contratual, não trabalho', () => {
    const item = toWorkItem(event('ACCEPTED', { evidenceRequired: null }));
    expect(item.evidence.dashed).toBe(true);
  });

  it('exigência REGISTRADA e não cumprida é trabalho, e não fica tracejada', () => {
    const item = toWorkItem(event('ACCEPTED', { evidenceRequired: true }));
    expect(item.evidence.dashed).toBe(false);
    expect(item.evidence.tone).toBe('attention');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A AUSÊNCIA, DITA PELO NOME CERTO (§15)
// ───────────────────────────────────────────────────────────────────────────

describe('as três ausências são distinguidas', () => {
  it('sem contrato ligado', () => {
    expect(describeEmptiness(false, [])).toBe('NO_CONTRACT_LINK');
  });

  it('contrato ligado e sem marco cadastrado', () => {
    expect(describeEmptiness(true, [])).toBe('NO_CONTRACTUAL_RULES');
  });

  it('marcos existem, nenhum aceito no cronograma', () => {
    const items = buildWorklist([event('PROPOSED'), event('UNMATCHED')]);
    expect(describeEmptiness(true, items)).toBe('NO_ACCEPTED_MAPPING');
  });

  it('um único aceito já é trabalho — a tela não diz "nenhuma medição"', () => {
    const items = buildWorklist([event('ACCEPTED'), event('UNMATCHED')]);
    expect(describeEmptiness(true, items)).toBe('HAS_WORK');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// VALOR: restrito ≠ não apurado
// ───────────────────────────────────────────────────────────────────────────

describe('o portão de valor atravessa a fila intacto', () => {
  it('o item preserva canViewValues vindo do banco', () => {
    const item = toWorkItem(event('ACCEPTED', { plannedAmount: null }, { canViewValues: false }));
    expect(item.event.canViewValues).toBe(false);
  });

  it('marco continua GERANDO faturamento mesmo com valor restrito', () => {
    const item = toWorkItem(
      event('ACCEPTED', { plannedAmount: null }, { canViewValues: false, generatesBilling: true }),
    );
    expect(item.event.generatesBilling).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ORDEM: o que exige decisão primeiro
// ───────────────────────────────────────────────────────────────────────────

describe('a fila agrupa por o que BLOQUEIA', () => {
  it('não devolve grupo vazio', () => {
    const groups = groupByBucket(buildWorklist(ja10182283()));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it('remapeamento vem antes de pendência de mapeamento e de concluído', () => {
    const items = buildWorklist([
      event('ACCEPTED', { billingEventId: 'b1' }),
      event('UNMATCHED'),
      event('ANCHOR_LOST'),
    ]);
    expect(items[0].bucket).toBe('REMAP_REQUIRED');
    expect(items[items.length - 1].bucket).toBe('SETTLED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// O TETO ARQUITETURAL — provado sobre o código-fonte
// ───────────────────────────────────────────────────────────────────────────

describe('a fila não é uma segunda máquina de estados', () => {
  const source = fs.readFileSync('src/lib/projects/milestone-worklist.ts', 'utf8');

  it('deriva estágio pela máquina canônica, e não com CASE próprio', () => {
    expect(source).toContain('deriveBillingPlanState');
  });

  it('não chama transição de medição nem cria registro', () => {
    for (const forbidden of [
      'project_measurement_prepare', 'project_measurement_submit',
      'project_measurement_accept', 'insert(', 'rpc(',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe('a bancada de evidência não pratica atos que não são dela', () => {
  const source = fs.readFileSync(
    'src/lib/projects/measurements/evidence-workspace.ts', 'utf8',
  );

  it('anexar evidência não dispara transição de medição', () => {
    for (const forbidden of [
      'prepareMeasurement', 'markMeasurementReady', 'submitMeasurement',
      'acceptMeasurement', 'supersedeMeasurement',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /*
    A classe e a procedência do vínculo DEIXARAM de viajar do cliente.

    Desde a 191 elas são literais dentro de `project_measurement_attach_document`,
    e o navegador não as escolhe — nem por engano, nem de propósito. O que se
    prova aqui, portanto, é a AUSÊNCIA: o cliente não tem como pedir evidência
    validada nem vínculo determinístico.
  */
  it('o cliente não escolhe classe nem procedência do vínculo', () => {
    expect(source).toContain('attachDocumentToMeasurement');
    for (const forbidden of [
      "'VALIDATED_EVIDENCE'", "'ACCEPTANCE_EVIDENCE'", "'deterministic'",
      'evidenceClass:', 'linkSource:',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('a classe BRUTA e o vínculo manual são literais do banco (191)', () => {
    const sql = fs.readFileSync('supabase/migrations/191_measurement_attach_document.sql', 'utf8');
    expect(sql).toContain("'RAW_EVIDENCE'");
    expect(sql).toContain("'manual'");
    expect(sql).not.toContain('p_evidence_class');
    expect(sql).not.toContain('p_link_source');
  });

  it('o arquivo sobe UMA vez: um upload, um documento canônico', () => {
    expect(source.match(/uploadProjectFile\(/g) ?? []).toHaveLength(1);
  });
});
