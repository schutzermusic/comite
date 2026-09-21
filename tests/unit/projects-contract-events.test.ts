/**
 * EVENTOS DE MEDIÇÃO no cronograma do projeto.
 *
 * O que estes testes protegem não é a aparência da linha derivada — é o TETO
 * dela: só vínculo aceito vira sobreposição, ausência nunca vira zero, moedas
 * diferentes nunca viram uma soma, e o estágio nunca é reescrito fora da
 * máquina canônica.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import type { BillingMonthPlanRow } from '@/lib/contracts/billing/planning/month-plan-types';
import {
  eventNumberLabel, governedEventsByTimelineItem, isGoverned, previousDate,
  sortForReview, summarizeContractEvents, wasReprogrammed, generatesBilling,
  LINK_STATE_LABEL,
  type EventLinkState, type ProjectContractEvent,
} from '@/lib/projects/contract-events';
import {
  RESTRICTED, amountText, billingConsequence, markerTooltip, rowLabel, stageChip,
} from '@/components/projects/timeline/contract/contract-event-view';

// ───────────────────────────────────────────────────────────────────────────
// Fábricas
// ───────────────────────────────────────────────────────────────────────────

function plan(over: Partial<BillingMonthPlanRow> = {}): BillingMonthPlanRow {
  return {
    milestoneId: 'm1', organizationId: 'org', contractId: 'c1',
    contractNumber: 'JA10182283/2025', counterpartyName: 'ENEL',
    projectId: 'proj-1', title: 'Evento 02 · No transporte do equipamento',
    description: null, status: 'pending', milestoneDueDate: null, completedAt: null,
    milestoneOwnerUserId: null, contractOwnerUserId: null, timelineResponsibleUserId: null,
    plannedAmount: 1_606_467.95, plannedAmountBasis: 'milestone_billing_amount',
    entitlementAmount: null, billingAmount: 1_606_467.95, measuredAmount: null,
    acceptedValue: null, billingEligibleAmount: null, currency: 'BRL',
    plannedBillingDate: '2025-11-28', plannedBillingDateBasis: 'timeline_planned_finish',
    plannedBillingMonth: '2025-11',
    governedMappingCount: 1, timelineItemId: 't-112', timelineTitle: 'Transporte do equipamento para fábrica',
    timelineWbsCode: '1.1.2', timelineStatus: 'not_started',
    timelinePlannedFinish: '2025-11-28', timelineForecastFinish: null,
    timelineActualFinish: null, timelineIsActive: true, timelinePercentComplete: 100,
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
    paymentTermText: '30 dias após aceite',
    ...over,
  };
}

function event(
  linkState: EventLinkState,
  over: Partial<ProjectContractEvent> = {},
  planOver: Partial<BillingMonthPlanRow> = {},
): ProjectContractEvent {
  return {
    linkState,
    ruleId: 'r1',
    mappingId: linkState === 'UNMATCHED' ? null : 'map-1',
    mappingSource: linkState === 'UNMATCHED' ? null : 'system_proposed',
    reviewState: linkState === 'ACCEPTED' ? 'accepted'
      : linkState === 'UNMATCHED' ? null : 'proposed',
    confidence: linkState === 'ACCEPTED' || linkState === 'UNMATCHED' ? null : 0.77,
    note: null, mappedAt: null, reviewedAt: null,
    proposedTimelineItemId: null, proposedTimelineTitle: null,
    proposedTimelineWbsCode: null, proposedTimelineFinish: null,
    ambiguousAlternatives: [],
    mappedTimelineItemId: null, mappedTimelineTitle: null,
    mappedTimelineWbsCode: null, mappedTimelineIsActive: true,
    canViewValues: true,
    generatesBilling: true,
    contractTotalValue: 8_032_339.76, contractPercent: 20,
    plan: plan({
      // Vínculo não aceito NÃO carrega etapa governada: a visão 179 só
      // preenche `timeline_*` através da ponte aceita.
      ...(linkState === 'ACCEPTED'
        ? {}
        : { governedMappingCount: 0, timelineItemId: null, plannedBillingDate: null,
            plannedBillingDateBasis: 'undetermined', plannedBillingMonth: null }),
      ...planOver,
    }),
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// O TETO: só aceito vira sobreposição
// ───────────────────────────────────────────────────────────────────────────

describe('a linha derivada só nasce de vínculo ACEITO', () => {
  it('indexa o evento aceito pela etapa que o sustenta', () => {
    const index = governedEventsByTimelineItem([event('ACCEPTED')]);
    expect(index.get('t-112')).toHaveLength(1);
  });

  it.each<EventLinkState>(['PROPOSED', 'AMBIGUOUS', 'UNMATCHED'])(
    'não indexa %s — proposta não é vínculo', (state) => {
      const index = governedEventsByTimelineItem([
        event(state, {}, { governedMappingCount: 1, timelineItemId: 't-112' }),
      ]);
      expect(index.size).toBe(0);
    },
  );

  it('só ACCEPTED é governado', () => {
    expect(isGoverned('ACCEPTED')).toBe(true);
    expect(isGoverned('PROPOSED')).toBe(false);
    expect(isGoverned('AMBIGUOUS')).toBe(false);
    expect(isGoverned('UNMATCHED')).toBe(false);
  });

  it('uma etapa que sustenta dois marcos devolve os dois', () => {
    const index = governedEventsByTimelineItem([
      event('ACCEPTED', {}, { milestoneId: 'm1' }),
      event('ACCEPTED', {}, { milestoneId: 'm2' }),
    ]);
    expect(index.get('t-112')).toHaveLength(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// O RESUMO: ausência não é zero
// ───────────────────────────────────────────────────────────────────────────

describe('resumo do cabeçalho', () => {
  const asOf = new Date('2025-11-10T12:00:00');

  it('conta os quatro estados separadamente', () => {
    const s = summarizeContractEvents([
      event('ACCEPTED'), event('ACCEPTED'),
      event('PROPOSED'), event('AMBIGUOUS'), event('UNMATCHED'),
    ], asOf);
    expect(s).toMatchObject({ total: 5, linked: 2, suggested: 1, ambiguous: 1, unmatched: 1 });
  });

  it('soma como VINCULADO apenas o valor dos marcos com ponte aceita', () => {
    const s = summarizeContractEvents([
      event('ACCEPTED', {}, { plannedAmount: 100 }),
      event('PROPOSED', {}, { plannedAmount: 900 }),
    ], asOf);
    expect(s.linkedAmount).toBe(100);
  });

  it('devolve null — e não 0 — quando nada sustenta a quantia', () => {
    const s = summarizeContractEvents([event('UNMATCHED', {}, { plannedAmount: null })], asOf);
    expect(s.linkedAmount).toBeNull();
    expect(s.eligibleAmount).toBeNull();
    expect(s.next30Amount).toBeNull();
  });

  it('não soma moedas diferentes', () => {
    const s = summarizeContractEvents([
      event('ACCEPTED', {}, { plannedAmount: 100, currency: 'BRL' }),
      event('ACCEPTED', {}, { plannedAmount: 100, currency: 'USD' }),
    ], asOf);
    expect(s.currency).toBeNull();
    expect(s.linkedAmount).toBeNull();
  });

  it('elegível vem do APURADO a jusante, nunca do previsto', () => {
    // Marco elegível (aceite registrado, evidência satisfeita) mas sem evento
    // de faturamento: não há valor apurado, e o resumo diz "não apurado".
    const eligible = event('ACCEPTED', {}, {
      measurementAcceptedAt: '2025-11-01T00:00:00Z',
      measurementEvidenceCount: 1,
      plannedAmount: 500,
      billingEligibleAmount: null,
    });
    const s = summarizeContractEvents([eligible], asOf);
    expect(s.eligibleCount).toBe(1);
    expect(s.eligibleAmount).toBeNull();
  });

  it('a janela de 30 dias só olha vínculo aceito e data dentro do horizonte', () => {
    const s = summarizeContractEvents([
      event('ACCEPTED', {}, { plannedAmount: 10, plannedBillingDate: '2025-11-28' }),
      event('ACCEPTED', {}, { plannedAmount: 20, plannedBillingDate: '2026-06-01' }),
      event('ACCEPTED', {}, { plannedAmount: 40, plannedBillingDate: '2025-01-01' }),
    ], asOf);
    expect(s.next30Count).toBe(1);
    expect(s.next30Amount).toBe(10);
  });

  it('projeto sem evento contratual devolve zeros e nenhuma quantia', () => {
    const s = summarizeContractEvents([], asOf);
    expect(s.total).toBe(0);
    expect(s.linkedAmount).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Rótulos e reprogramação
// ───────────────────────────────────────────────────────────────────────────

describe('rótulos', () => {
  it('lê o número do marco do próprio título', () => {
    expect(eventNumberLabel(event('ACCEPTED'))).toBe('MARCO 02');
    expect(rowLabel(event('ACCEPTED'))).toBe('EVENTO DE MEDIÇÃO · MARCO 02');
  });

  it('não inventa número quando o título não traz um', () => {
    const e = event('ACCEPTED', {}, { title: 'Entrega do relatório final' });
    expect(eventNumberLabel(e)).toBe('EVENTO CONTRATUAL');
  });

  it('sem vínculo tem frase própria, e não uma data vazia', () => {
    expect(LINK_STATE_LABEL.UNMATCHED).toBe('Sem vínculo no cronograma');
  });
});

describe('reprogramação', () => {
  const reprogrammed = event('ACCEPTED', {}, {
    reprogrammingCount: 1,
    lastPreviousPlannedFinish: '2025-11-20',
    lastNewPlannedFinish: '2025-11-28',
    plannedBillingDate: '2025-11-28',
  });

  it('preserva a data anterior ao lado da vigente', () => {
    expect(previousDate(reprogrammed)).toBe('2025-11-20');
    expect(reprogrammed.plan.plannedBillingDate).toBe('2025-11-28');
    expect(wasReprogrammed(reprogrammed)).toBe(true);
  });

  it('sem reprogramação não devolve data anterior nenhuma', () => {
    expect(previousDate(event('ACCEPTED'))).toBeNull();
    expect(wasReprogrammed(event('ACCEPTED'))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Vocabulário: o que a tela pode e não pode afirmar
// ───────────────────────────────────────────────────────────────────────────

describe('vocabulário de faturamento', () => {
  it('diz que o marco GERA faturamento — nunca que vai faturar', () => {
    const text = billingConsequence(event('ACCEPTED'));
    expect(text).toBe('Gera faturamento');
    expect(text).not.toMatch(/vai|será|previsto para/i);
  });

  it('marco sem valor não promete faturamento', () => {
    // `generates_billing` vem do banco: sem valor previsto, ele é falso lá.
    const e = event('ACCEPTED', { generatesBilling: false }, { plannedAmount: null });
    expect(generatesBilling(e)).toBe(false);
    expect(billingConsequence(e)).toBe('Sem valor de faturamento registrado');
  });

  it('só afirma evento de faturamento quando ele existe', () => {
    const e = event('ACCEPTED', {}, { billingEventId: 'be-1' });
    expect(billingConsequence(e)).toBe('Evento de faturamento gerado');
  });

  it('percentual de avanço não muda o estágio', () => {
    const a = stageChip(event('ACCEPTED', {}, { timelinePercentComplete: 0 }));
    const b = stageChip(event('ACCEPTED', {}, { timelinePercentComplete: 100 }));
    expect(a.label).toBe(b.label);
  });

  it('etapa 100% concluída não vira elegível para faturar', () => {
    const e = event('ACCEPTED', {}, {
      timelinePercentComplete: 100,
      timelineStatus: 'completed',
      timelineActualFinish: '2025-11-28',
    });
    // O contrato exige aceite da contratante, e ele não foi registrado.
    expect(stageChip(e).label).not.toBe('Elegível para faturar');
  });
});

describe('tooltip do marcador', () => {
  const text = markerTooltip(event('ACCEPTED', {}, {
    reprogrammingCount: 1,
    lastPreviousPlannedFinish: '2025-11-20',
    lastNewPlannedFinish: '2025-11-28',
  }));

  it('traz contrato, data, valor, estágio e consequência', () => {
    expect(text).toContain('Evento de medição');
    expect(text).toContain('JA10182283/2025');
    expect(text).toContain('28/11/2025');
    expect(text).toContain('Gera faturamento');
  });

  it('mostra a data anterior quando houve reprogramação', () => {
    expect(text).toContain('Reprogramado de 20/11/2025');
  });

  it('escreve "Não apurado" em vez de um valor inventado', () => {
    const t = markerTooltip(event('UNMATCHED', {}, { plannedAmount: null }));
    expect(t).toContain('Não apurado');
    expect(t).not.toContain('R$ 0,00');
  });
});

describe('ordem da fila de revisão', () => {
  it('coloca o que exige decisão antes do que já está resolvido', () => {
    const ordered = sortForReview([
      event('ACCEPTED', {}, { milestoneId: 'a' }),
      event('UNMATCHED', {}, { milestoneId: 'u' }),
      event('AMBIGUOUS', {}, { milestoneId: 'x' }),
      event('PROPOSED', {}, { milestoneId: 'p' }),
    ]);
    expect(ordered.map((e) => e.linkState))
      .toEqual(['AMBIGUOUS', 'PROPOSED', 'UNMATCHED', 'ACCEPTED']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// O PORTÃO DE VALOR (migration 182)
//
// Visibilidade OPERACIONAL e visibilidade FINANCEIRA são coisas diferentes, e
// o que estes testes protegem é que a segunda possa ser fechada sem levar a
// primeira junto — e que "restrito" nunca se disfarce de "não apurado".
// ═══════════════════════════════════════════════════════════════════════════

/** Como a visão 182 entrega a linha para quem não passa no portão de valor. */
const restricted = (
  state: EventLinkState = 'ACCEPTED',
  planOver: Partial<BillingMonthPlanRow> = {},
): ProjectContractEvent => event(state, {
  canViewValues: false,
  generatesBilling: true,
  contractTotalValue: null,
  contractPercent: null,
}, {
  // Tudo que é quantia chega nulo do banco — não mascarado no cliente.
  plannedAmount: null, plannedAmountBasis: null, entitlementAmount: null,
  billingAmount: null, measuredAmount: null, acceptedValue: null,
  billingEligibleAmount: null, currency: null,
  billingReceivableStatus: null, fiscalDocumentNumber: null, paymentTermText: null,
  billingEligibilityState: null,
  ...planOver,
});

describe('visibilidade operacional sobrevive ao portão de valor', () => {
  it('o evento continua existindo, com marco, data e estágio', () => {
    const e = restricted();
    expect(rowLabel(e)).toBe('EVENTO DE MEDIÇÃO · MARCO 02');
    expect(e.plan.title).toContain('Evento 02');
    expect(e.plan.plannedBillingDate).toBe('2025-11-28');
    expect(stageChip(e).label).toBeTruthy();
  });

  it('a relevância de faturamento atravessa o portão', () => {
    // `generates_billing` é calculado no banco ANTES da máscara. Derivá-lo de
    // `plannedAmount` aqui diria "não gera faturamento" sobre um marco que gera.
    const e = restricted();
    expect(generatesBilling(e)).toBe(true);
    expect(billingConsequence(e)).toBe('Gera faturamento');
  });

  it('o estágio derivado é o MESMO com e sem permissão de valor', () => {
    // A máquina canônica não lê quantia. Se lesse, o mesmo marco teria dois
    // estágios diferentes conforme quem olha — e as duas telas discordariam.
    expect(stageChip(restricted()).label).toBe(stageChip(event('ACCEPTED')).label);
  });

  it('a existência do evento de faturamento continua legível', () => {
    expect(billingConsequence(restricted('ACCEPTED', { billingEventId: 'be-1' })))
      .toBe('Evento de faturamento gerado');
  });

  it('o vínculo pendente continua sinalizado', () => {
    expect(restricted('AMBIGUOUS').linkState).toBe('AMBIGUOUS');
    expect(LINK_STATE_LABEL[restricted('PROPOSED').linkState]).toBe('Mapeamento sugerido');
  });
});

describe('o valor fica do outro lado do portão', () => {
  it('escreve RESTRITO — nunca um número, nunca "Não apurado"', () => {
    const text = amountText(restricted());
    expect(text).toBe(RESTRICTED);
    expect(text).not.toContain('R$');
    expect(text).not.toBe('Não apurado');
  });

  it('distingue restrito de não apurado', () => {
    // Mesma célula vazia, ações opostas: uma é permissão, a outra é cadastro.
    expect(amountText(restricted())).toBe('Restrito');
    expect(amountText(event('ACCEPTED', {}, { plannedAmount: null }))).toBe('Não apurado');
  });

  it('o tooltip do marcador não vaza quantia', () => {
    const t = markerTooltip(restricted());
    expect(t).toContain('Valor previsto: Restrito');
    expect(t).not.toMatch(/R\$\s?\d/);
  });

  it('não expõe percentual do contrato', () => {
    expect(restricted().contractPercent).toBeNull();
    expect(restricted().contractTotalValue).toBeNull();
  });

  it('o resumo marca a restrição e recusa somar', () => {
    const s = summarizeContractEvents([restricted(), restricted()], new Date('2025-11-10T12:00:00'));
    expect(s.valuesRestricted).toBe(true);
    expect(s.linkedAmount).toBeNull();
    expect(s.eligibleAmount).toBeNull();
    expect(s.next30Amount).toBeNull();
    // As CONTAGENS continuam: é o que o gestor de projeto precisa.
    expect(s.total).toBe(2);
    expect(s.linked).toBe(2);
  });

  it('uma única linha restrita já bloqueia o total da carteira', () => {
    // Somar só as visíveis produziria um número que parece completo e não é.
    const s = summarizeContractEvents([
      event('ACCEPTED', {}, { plannedAmount: 100 }),
      restricted(),
    ], new Date('2025-11-10T12:00:00'));
    expect(s.valuesRestricted).toBe(true);
    expect(s.linkedAmount).toBeNull();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// O VÍNCULO MANUAL (migration 185)
//
// O caminho humano até `accepted` para o marco que o robô não soube casar.
// Estes testes travam o TETO dele contra o texto da própria migration: se
// alguém afrouxar a permissão, remover a exigência de usuário ou transformá-lo
// num segundo sistema de mapeamento, um deles quebra.
// ═══════════════════════════════════════════════════════════════════════════

describe('governança do vínculo manual', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/185_measurement_event_manual_link.sql', 'utf8');
  const link = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.contract_measurement_rule_timeline_link'),
    sql.indexOf('REVOKE ALL ON FUNCTION public.contract_measurement_rule_timeline_link'),
  );

  it('exige usuário autenticado — service role não vincula', () => {
    expect(link).toMatch(/uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(link).toContain('Vincular etapa a marco exige usuário autenticado.');
  });

  it('exige a MESMA permissão do fluxo de revisão', () => {
    expect(link).toContain("current_user_has_permission('contracts.edit')");
    expect(link).toContain('current_user_is_admin()');
  });

  it('escreve na tabela da 131 — não cria um segundo sistema', () => {
    expect(link).toContain('public.contract_measurement_rule_timeline_mappings');
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  it('fonte explícita não carrega confiança', () => {
    // A 131 proíbe confiança fora de `system_proposed`: ninguém tem "85% de
    // certeza" sobre a própria decisão.
    expect(link).toContain("mapping_source = 'explicit'");
    expect(link).toMatch(/confidence\s+=\s+NULL/);
  });

  it('a etapa precisa estar viva', () => {
    expect(link).toContain('t.is_active');
    expect(link).toContain('t.deleted_at IS NULL');
  });

  it('o projeto precisa estar ligado ao contrato', () => {
    expect(link).toContain('public.contract_project_links');
  });

  it('um marco tem UM vínculo aceito por projeto', () => {
    expect(link).toContain("m.review_state = 'accepted'");
    expect(link).toMatch(/já está vinculado à etapa/);
  });

  it('escolher uma etapa descarta as propostas concorrentes', () => {
    expect(link).toContain("SET review_state = 'rejected'");
    expect(link).toContain('outra etapa foi vinculada manualmente');
  });

  it('o caminho de revisão ganhou a mesma invariante', () => {
    const review = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.contract_measurement_rule_timeline_review'));
    expect(review).toContain('Um marco tem um vínculo por projeto');
    expect(review).toContain('outra etapa foi aceita para este marco');
  });

  it('não cria evento de faturamento nem toca no cronograma', () => {
    expect(sql).not.toMatch(/INSERT INTO public\.contract_billing_events/i);
    expect(sql).not.toMatch(/UPDATE public\.project_timeline_items/i);
    expect(sql).not.toMatch(/INSERT INTO public\.project_timeline_items/i);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// ÂNCORA PERDIDA (migration 186)
//
// A importação DESATIVA a etapa que sumiu do arquivo novo; o mapeamento
// aceito continua apontando para ela. O erro que estes testes impedem é a
// tela seguir dizendo "Sincronizado" sobre um marco cuja âncora evaporou —
// enquanto a previsão de faturamento já mudou por baixo.
// ═══════════════════════════════════════════════════════════════════════════

describe('âncora perdida', () => {
  const lost = event('ANCHOR_LOST', {
    mappedTimelineItemId: 't-112',
    mappedTimelineTitle: 'Transporte do equipamento para fábrica',
    mappedTimelineWbsCode: '1.1.2',
    mappedTimelineIsActive: false,
  });

  it('não é tratado como vínculo governado', () => {
    // Nada de linha derivada sob uma atividade que não está mais no cronograma.
    expect(isGoverned('ANCHOR_LOST')).toBe(false);
    expect(governedEventsByTimelineItem([lost]).size).toBe(0);
  });

  it('diz o que aconteceu, e não "sem vínculo"', () => {
    expect(LINK_STATE_LABEL.ANCHOR_LOST)
      .toBe('Atividade removida do cronograma — requer remapeamento');
    expect(LINK_STATE_LABEL.ANCHOR_LOST).not.toBe(LINK_STATE_LABEL.UNMATCHED);
  });

  it('preserva a identidade da atividade que sumiu', () => {
    // É o que permite à tela dizer QUAL etapa saiu, em vez de só "requer atenção".
    expect(lost.mappedTimelineWbsCode).toBe('1.1.2');
    expect(lost.mappedTimelineIsActive).toBe(false);
  });

  it('entra no resumo em contador próprio', () => {
    const s = summarizeContractEvents([lost, event('ACCEPTED')], new Date());
    expect(s.anchorLost).toBe(1);
    expect(s.linked).toBe(1);
  });

  it('encabeça a fila de revisão — algo que funcionava parou', () => {
    const ordered = sortForReview([
      event('ACCEPTED', {}, { milestoneId: 'a' }),
      event('UNMATCHED', {}, { milestoneId: 'u' }),
      lost,
      event('AMBIGUOUS', {}, { milestoneId: 'x' }),
    ]);
    expect(ordered[0].linkState).toBe('ANCHOR_LOST');
  });
});

describe('a integração contratual não escreve no cronograma', () => {
  const server = fs.readFileSync(
    'src/lib/contracts/billing/planning/propose-mappings-server.ts', 'utf8');

  it('a reconciliação só LÊ project_timeline_items', () => {
    const calls = [...server.matchAll(/from\('project_timeline_items'\)([\s\S]{0,120})/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, tail] of calls) {
      expect(tail).toContain('.select(');
      expect(tail).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });

  it.each([
    '181_project_schedule_contract_events.sql',
    '182_project_schedule_contract_events_value_gate.sql',
    '183_project_financial_visibility.sql',
    '185_measurement_event_manual_link.sql',
    '186_measurement_event_anchor_lost.sql',
  ])('%s não cria nem altera atividade de cronograma', (file) => {
    const sql = fs.readFileSync(`supabase/migrations/${file}`, 'utf8');
    expect(sql).not.toMatch(/INSERT INTO public\.project_timeline_items/i);
    expect(sql).not.toMatch(/UPDATE public\.project_timeline_items/i);
    expect(sql).not.toMatch(/DELETE FROM public\.project_timeline_items/i);
  });
});
