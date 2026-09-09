/**
 * As provas do refactor de operacionalização de contratos.
 *
 * Cada bloco aqui corresponde a uma afirmação que o produto passou a fazer, e
 * existe para que essa afirmação não possa ser desfeita em silêncio por uma
 * mudança futura. Elas são deliberadamente sobre COMPORTAMENTO, não sobre
 * redação: renomear um rótulo não faz nenhuma delas passar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ATTENTION_POLICY_VERSION, MATERIAL_AMOUNT_BRL, MIN_STRUCTURING_CONFIDENCE,
  attentionReasons, interpretationState, interpretationDisclosure,
} from '@/lib/contracts/intelligence/attention-policy';
import {
  resolveAnchoredDeadline, shiftBusinessDays, scheduleAnchorNotice,
  type BusinessCalendar,
} from '@/lib/contracts/obligations/schedule-anchor';
import { urgencyOf } from '@/lib/contracts/obligations/resolve';
import {
  isValidTransition, nudgeDecision, shouldEscalate, verifyEvidence, followupNarrative,
} from '@/lib/platform/followups/state';
import type { ApexFollowupRow } from '@/lib/platform/followups/types';
import {
  assertOperationalEvidence, normalizeObligation,
} from '@/lib/ai/contract-operationalization';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const clause = (over: Record<string, unknown> = {}) => ({
  aiFlagged: true,
  confidence: 0.95,
  riskLevel: 'low' as const,
  amount: null,
  clauseType: 'pagamento',
  sourceExcerpt: 'trecho literal suficientemente longo do contrato',
  sourcePage: 12,
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · O PDF original continua sendo a verdade contratual
// ═══════════════════════════════════════════════════════════════════════════

describe('1 · o documento original permanece a fonte da verdade', () => {
  it('nenhum caminho de leitura reescreve o documento original', () => {
    const extractor = read('src/lib/ai/contract-clause-extractor.ts');
    const operationalizer = read('src/lib/ai/contract-operationalization.ts');
    for (const [name, source] of [['extrator', extractor], ['operacionalizador', operationalizer]] as const) {
      // Ler é `download`; escrever seria `upload` ou `remove`.
      expect(source, `${name} escreve no bucket do documento`).not.toMatch(/storage\s*\n?\s*\.from\([^)]*\)\s*\n?\s*\.upload/);
      expect(source, `${name} apaga o documento`).not.toMatch(/\.remove\(/);
      expect(source).toContain('.download(');
    }
  });

  it('toda interpretação aponta para a página e o trecho do documento', () => {
    const { accepted, rejected } = assertOperationalEvidence({
      obligations: [{
        title: 'Entregar CND', requirement_text: 'Entregar a CND mensalmente',
        responsible_side: 'contracting_organization',
        activation_kind: 'contract_start', due_kind: 'recurring',
        calendar_basis: 'calendar_days', recurrence_kind: 'monthly',
        blocks_billing: true,
        source_page: 4, source_excerpt: 'a CONTRATADA deverá apresentar mensalmente a CND vigente',
        confidence: 0.92,
      }],
    }, 100);
    expect(rejected).toHaveLength(0);
    expect(accepted.obligations[0].source_page).toBe(4);
    expect(accepted.obligations[0].source_excerpt).toMatch(/CND/);
  });

  it('leitura sem trecho literal é descartada antes do banco', () => {
    const { accepted, rejected } = assertOperationalEvidence({
      obligations: [{
        title: 'Obrigação sem lastro', requirement_text: 'algo',
        responsible_side: 'unknown', activation_kind: 'unspecified', due_kind: 'unspecified',
        calendar_basis: 'unspecified', recurrence_kind: 'one_time', blocks_billing: null,
        source_page: 4, source_excerpt: '', confidence: 0.99,
      }],
    }, 100);
    expect(accepted.obligations).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/sem trecho/);
  });

  it('página além do documento é leitura fabricada e não entra', () => {
    const { accepted, rejected } = assertOperationalEvidence({
      guarantees: [{
        title: 'Garantia', guarantee_type: 'fianca', required_amount: 1000,
        required_percentage: null, renewal_required: true,
        source_page: 900, source_excerpt: 'a CONTRATADA prestará garantia de execução contratual',
        confidence: 0.9,
      }],
    }, 100);
    expect(accepted.guarantees).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/além do documento/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · A interpretação não se apresenta como autoria do contrato
// ═══════════════════════════════════════════════════════════════════════════

describe('2 · o Apex não finge ter escrito o contrato', () => {
  it('a frase que o produto usa fala de INTERPRETAÇÃO, não de proposta', () => {
    expect(interpretationDisclosure('structured'))
      .toBe('Esta é uma interpretação estruturada do Apex baseada no documento original.');
    expect(interpretationDisclosure('requires_attention'))
      .toBe('Esta interpretação requer análise humana antes de produzir uma decisão governada.');
    // O texto que dizia "Proposta não vale como cláusula até ser validada" saiu.
    for (const state of ['structured', 'requires_attention', 'human_confirmed', 'dismissed'] as const) {
      expect(interpretationDisclosure(state)).not.toMatch(/proposta/i);
    }
  });

  it('o painel de propostas de IA deixou de existir', () => {
    expect(() => read('src/components/contracts/intelligence/ClauseProposalsPanel.tsx')).toThrow();
  });

  it('nenhuma superfície de Contratos ainda diz "proposta não vale como cláusula"', () => {
    for (const file of [
      'src/lib/contracts/trust/clause-risk-intelligence.ts',
      'src/lib/contracts/trust/attention.ts',
      'src/lib/contracts/trust/onboarding.ts',
      'src/components/contracts/intelligence/ContractInterpretationPanel.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/proposta não (é|vale)/i);
    }
  });

  it('o prompt de operacionalização declara que o contrato já existe e já vale', () => {
    const source = read('src/lib/ai/contract-operationalization.ts');
    expect(source).toMatch(/O contrato foi escrito e assinado pela contraparte/);
    expect(source).toMatch(/Você não redige, não propõe/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Revisão humana por cláusula deixou de ser obrigatória
// ═══════════════════════════════════════════════════════════════════════════

describe('3 · governança por exceção', () => {
  it('leitura clara, imaterial e de baixo risco NÃO exige atenção', () => {
    expect(attentionReasons(clause())).toEqual([]);
    expect(interpretationState(clause())).toBe('structured');
  });

  it('quarenta e três leituras boas produzem ZERO itens de fila', () => {
    const many = Array.from({ length: 43 }, () => clause());
    const queue = many.filter((c) => interpretationState(c) === 'requires_attention');
    expect(queue).toHaveLength(0);
  });

  it('a política tem versão gravável, para que a classificação seja auditável', () => {
    expect(ATTENTION_POLICY_VERSION).toMatch(/^contract-attention-policy\/\d+\.\d+\.\d+$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · A exceção continua exigindo uma pessoa
// ═══════════════════════════════════════════════════════════════════════════

describe('4 · a exceção material continua parando numa pessoa', () => {
  it('confiança abaixo do limiar exige atenção', () => {
    expect(attentionReasons(clause({ confidence: MIN_STRUCTURING_CONFIDENCE - 0.01 })))
      .toContain('low_confidence');
  });

  it('confiança AUSENTE numa leitura de máquina é desconhecida, nunca alta', () => {
    expect(attentionReasons(clause({ confidence: null }))).toContain('low_confidence');
  });

  it('exposição material exige atenção; abaixo do limiar, não', () => {
    expect(attentionReasons(clause({ amount: MATERIAL_AMOUNT_BRL })))
      .toContain('material_financial_exposure');
    expect(attentionReasons(clause({ amount: MATERIAL_AMOUNT_BRL - 1 })))
      .not.toContain('material_financial_exposure');
  });

  it('exposição NEGATIVA material também conta — o sinal não é o que importa', () => {
    expect(attentionReasons(clause({ amount: -MATERIAL_AMOUNT_BRL })))
      .toContain('material_financial_exposure');
  });

  it('risco alto, compromisso jurídico e garantia sobem para decisão humana', () => {
    expect(attentionReasons(clause({ riskLevel: 'high' }))).toContain('material_contractual_risk');
    expect(attentionReasons(clause({ clauseType: 'penalidade' }))).toContain('possible_legal_commitment');
    expect(attentionReasons(clause({ clauseType: 'rescisao' }))).toContain('possible_legal_commitment');
    expect(attentionReasons(clause({ clauseType: 'garantia' }))).toContain('authority_required');
  });

  it('leitura de máquina sem evidência conferível nunca é estruturada em silêncio', () => {
    expect(attentionReasons(clause({ sourcePage: null, sourceExcerpt: null })))
      .toContain('legal_ambiguity');
  });

  it('decisão humana registrada não volta sozinha para a fila', () => {
    const material = clause({ amount: 500_000 });
    expect(interpretationState(material)).toBe('requires_attention');
    expect(interpretationState(material, { attentionResolvedAt: '2026-09-01T00:00:00Z' }))
      .toBe('structured');
    expect(interpretationState(material, { humanState: 'human_confirmed' })).toBe('human_confirmed');
    expect(interpretationState(material, { humanState: 'dismissed' })).toBe('dismissed');
  });

  it('a política da aplicação e a do banco são a MESMA política', () => {
    const migration = read('supabase/migrations/154_contract_interpretation_governance.sql');
    // Os limiares vivem nos dois lados e precisam continuar iguais.
    expect(migration).toContain(`SELECT ${MATERIAL_AMOUNT_BRL}::numeric`);
    expect(migration).toContain(`p_confidence < ${MIN_STRUCTURING_CONFIDENCE}`);
    expect(migration).toContain(ATTENTION_POLICY_VERSION);
    for (const category of ['penalidade', 'rescisao', 'responsabilidade', 'garantia']) {
      expect(migration, category).toContain(`'${category}'`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Nem IA nem service role fabricam autoridade humana
// ═══════════════════════════════════════════════════════════════════════════

describe('5 · autoridade humana não é falsificável', () => {
  it('a guarda de personificação cobre os quatro carimbos de autoridade', () => {
    const migration = read('supabase/migrations/154_contract_interpretation_governance.sql');
    for (const field of ['review_status', 'reviewed_by', 'interpretation_state', 'attention_resolved_by']) {
      expect(migration, field).toContain(field);
    }
    expect((migration.match(/GOVERNANCE VIOLATION/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(migration).toContain('auth.uid() is NULL');
  });

  it('o acompanhamento recusa designação e verificação sem sessão', () => {
    const migration = read('supabase/migrations/156_apex_followup_foundation.sql');
    expect(migration).toMatch(/assigned_by requires an authenticated user session/);
    expect(migration).toMatch(/verified_by requires an authenticated user session/);
    expect(migration).toMatch(/closure_basis "human_confirmation" requires an authenticated/);
  });

  it('as funções de autoridade NÃO aceitam de quem é a decisão como parâmetro', () => {
    const migration = read('supabase/migrations/157_apex_followup_human_authority.sql');
    // O carimbo sai de auth.uid() dentro da função; não existe argumento para ele.
    expect(migration).not.toMatch(/p_assigned_by|p_verified_by|p_resolved_by|p_actor_user_id/);
    expect((migration.match(/auth\.uid\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // E o inquilino também não é parâmetro.
    expect(migration).not.toMatch(/p_organization_id/);
    expect(migration).toContain('public.current_user_organization_id()');
  });

  it('os atos humanos usam o cliente da SESSÃO, nunca o service role', () => {
    const session = read('src/lib/platform/followups/session.ts');
    expect(session).toContain("from '@/utils/supabase/server'");
    expect(session).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(session).toContain('apex_followup_assign');
    expect(session).toContain('apex_followup_confirm_completion');

    const clauseSession = read('src/lib/contracts/intelligence/session.ts');
    expect(clauseSession).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(clauseSession).toContain('contract_clause_resolve_attention');
  });

  it('o store de serviço não tenta carimbar autoridade humana', () => {
    const store = read('src/lib/platform/followups/server/store.ts');
    expect(store).not.toMatch(/assigned_by\s*:/);
    expect(store).not.toMatch(/verified_by\s*:/);
    expect(store).not.toMatch(/closure_basis:\s*'human_confirmation'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Regra relativa não inventa data
// ═══════════════════════════════════════════════════════════════════════════

describe('6 · regra conhecida, data desconhecida', () => {
  const anchoredRule = {
    anchor: 'measurement' as const,
    dueKind: 'days_before_schedule_anchor' as const,
    offsetDays: 5,
    calendarBasis: 'business_days' as const,
  };

  it('sem agenda publicada, nenhuma data é produzida', () => {
    const result = resolveAnchoredDeadline(anchoredRule, null, null);
    expect(result.dueDate).toBeNull();
    expect(result.dateState).toBe('AWAITING_SCHEDULE_ANCHOR');
    expect(result.dueConfidence).toBe('unknown');
  });

  it('aguardar a agenda é estado distinto de prazo desconhecido', () => {
    expect(urgencyOf({
      state: 'NOT_ACTIVATED', dueDate: null, dueConfidence: 'unknown',
      activationState: 'unknown', dateState: 'AWAITING_SCHEDULE_ANCHOR',
    }, '2026-09-01')).toBe('AWAITING_SCHEDULE_ANCHOR');

    expect(urgencyOf({
      state: 'NOT_ACTIVATED', dueDate: null, dueConfidence: 'unknown',
      activationState: 'unknown', dateState: 'UNKNOWN',
    }, '2026-09-01')).toBe('UNKNOWN');
  });

  it('a tela explica de quem se está esperando, sem pedir trabalho a ninguém', () => {
    const notice = scheduleAnchorNotice('measurement', 'AWAITING_SCHEDULE_ANCHOR');
    expect(notice).toMatch(/O Apex já entendeu esta exigência/);
    expect(notice).toMatch(/medição for agendada/);
    // Prazo resolvido não produz aviso nenhum.
    expect(scheduleAnchorNotice('measurement', 'RESOLVED')).toBeNull();
  });

  it('dia útil sem calendário DECLARADO continua sem resposta', () => {
    expect(shiftBusinessDays('2026-09-30', -5, null)).toBeNull();
    const result = resolveAnchoredDeadline(anchoredRule, '2026-09-30', null);
    expect(result.dueDate).toBeNull();
    expect(result.dateState).toBe('UNKNOWN');
    expect(result.basis).toMatch(/sem calendário declarado/);
  });

  it('a leitura recusa regra ancorada sem deslocamento — meia regra não é regra', () => {
    expect(normalizeObligation({
      title: 'Documentos antes da medição', requirement_text: 'entregar',
      responsible_side: 'contracting_organization',
      activation_kind: 'schedule_anchor', due_kind: 'days_before_schedule_anchor',
      schedule_anchor: 'measurement', schedule_anchor_offset_days: null,
      calendar_basis: 'business_days', recurrence_kind: 'one_time',
      source_page: 3, source_excerpt: 'x'.repeat(30), confidence: 0.9,
    })).toBeNull();
  });

  it('a leitura recusa data fixa sem a data, e regra por deslocamento sem deslocamento', () => {
    const base = {
      title: 'X', requirement_text: 'y', responsible_side: 'unknown',
      calendar_basis: 'calendar_days', recurrence_kind: 'one_time',
      source_page: 3, source_excerpt: 'x'.repeat(30), confidence: 0.9,
    };
    expect(normalizeObligation({
      ...base, activation_kind: 'unspecified', due_kind: 'fixed_date', due_fixed_date: null,
    })).toBeNull();
    expect(normalizeObligation({
      ...base, activation_kind: 'days_after_contract_start', activation_offset_days: null,
      due_kind: 'unspecified',
    })).toBeNull();
  });

  it('série recorrente com data fixa única é incoerente e é recusada', () => {
    expect(normalizeObligation({
      title: 'X', requirement_text: 'y', responsible_side: 'unknown',
      activation_kind: 'contract_start', due_kind: 'fixed_date', due_fixed_date: '2026-10-15',
      calendar_basis: 'calendar_days', recurrence_kind: 'monthly',
      source_page: 3, source_excerpt: 'x'.repeat(30), confidence: 0.9,
    })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Quando a agenda chega, o prazo real aparece
// ═══════════════════════════════════════════════════════════════════════════

describe('7 · a âncora de agenda produz o prazo operacional certo', () => {
  // Segunda a sexta, sem feriado.
  const calendar: BusinessCalendar = {
    businessWeekdays: [1, 2, 3, 4, 5],
    nonBusinessDays: new Set<string>(),
  };
  const rule = {
    anchor: 'measurement' as const,
    dueKind: 'days_before_schedule_anchor' as const,
    offsetDays: 5,
    calendarBasis: 'business_days' as const,
  };

  it('5 dias úteis antes de 30/09/2026 (quarta) é 23/09/2026', () => {
    const result = resolveAnchoredDeadline(rule, '2026-09-30', calendar);
    expect(result.dueDate).toBe('2026-09-23');
    expect(result.dateState).toBe('RESOLVED');
    expect(result.dueConfidence).toBe('known');
  });

  it('um feriado no caminho empurra o prazo mais um dia para trás', () => {
    const withHoliday: BusinessCalendar = {
      businessWeekdays: [1, 2, 3, 4, 5],
      nonBusinessDays: new Set(['2026-09-24']),
    };
    expect(resolveAnchoredDeadline(rule, '2026-09-30', withHoliday).dueDate).toBe('2026-09-22');
  });

  it('a conta pula o fim de semana em vez de contar dia corrido', () => {
    // 5 dias CORRIDOS antes de 30/09 seria 25/09; em dias úteis é 23/09.
    expect(shiftBusinessDays('2026-09-30', -5, calendar)).toBe('2026-09-23');
    expect(shiftBusinessDays('2026-09-30', 5, calendar)).toBe('2026-10-07');
  });

  it('dias corridos não dependem de calendário nenhum', () => {
    const calendarDays = { ...rule, calendarBasis: 'calendar_days' as const };
    expect(resolveAnchoredDeadline(calendarDays, '2026-09-30', null).dueDate).toBe('2026-09-25');
  });

  it('a aplicação e o banco resolvem a âncora da MESMA forma', () => {
    const migration = read('supabase/migrations/155_contract_schedule_anchored_rules.sql');
    expect(migration).toContain('contract_obligations_apply_schedule_anchor');
    expect(migration).toContain('AWAITING_SCHEDULE_ANCHOR');
    expect(migration).toContain('days_before_schedule_anchor');
    // A data vem de Projetos e Contratos nunca escreve lá.
    expect(migration).toContain('m.expected_at');
    expect(migration).not.toMatch(/UPDATE\s+public\.project_measurements/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.project_measurements/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Condição de faturamento bloqueia a prontidão
// ═══════════════════════════════════════════════════════════════════════════

describe('8 · condição contratual trava o faturamento', () => {
  it('a leitura estrutura a condição com o tipo contratual certo', () => {
    const { accepted } = assertOperationalEvidence({
      billing_conditions: [{
        title: 'Aceite do cliente', condition_type: 'customer_approval_required',
        requirement_text: 'O faturamento depende do aceite formal da CONTRATANTE.',
        required_document_type: 'termo_aceite', elapsed_period_days: null,
        source_page: 22,
        source_excerpt: 'O faturamento somente poderá ocorrer após o aceite formal da CONTRATANTE',
        confidence: 0.93,
      }],
    }, 100);
    expect(accepted.billing_conditions[0].condition_type).toBe('customer_approval_required');
  });

  it('`blocks_billing` NULL é desconhecido, e nunca "não bloqueia"', () => {
    const normalized = normalizeObligation({
      title: 'Relatório técnico', requirement_text: 'entregar relatório',
      responsible_side: 'contracting_organization',
      activation_kind: 'contract_start', due_kind: 'recurring',
      calendar_basis: 'calendar_days', recurrence_kind: 'monthly',
      blocks_billing: null,
      source_page: 8, source_excerpt: 'x'.repeat(30), confidence: 0.9,
    });
    expect(normalized?.blocks_billing).toBeNull();
    expect(normalized?.blocks_billing).not.toBe(false);
  });

  it('o banco mantém `blocks_billing` anulável — omissão não vira negativa', () => {
    const migration = read('supabase/migrations/114_contract_obligation_definitions.sql');
    expect(migration).toMatch(/blocks_billing\s+boolean,/);
    expect(migration).not.toMatch(/blocks_billing\s+boolean NOT NULL/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · O acompanhamento não vira spam
// ═══════════════════════════════════════════════════════════════════════════

const followup = (over: Partial<ApexFollowupRow> = {}): ApexFollowupRow => ({
  id: 'f1', organization_id: 'org-1', source_kind: 'contract', source_id: 'ct-1',
  contract_id: 'ct-1', goal: 'Renovar CND', expected_evidence: 'CND vigente',
  responsible_user_id: null, responsible_party_id: null, responsible_text: 'Fulano',
  assigned_by: null, assigned_at: null,
  due_date: '2026-09-10', next_expected_event: null, next_expected_event_at: null,
  cadence_days: 7, last_nudge_at: null, nudge_count: 0,
  escalate_after_days: null, escalation_target_user_id: null, escalated_at: null,
  verification_mode: 'human_confirmation', verification_rule: null,
  verified_at: null, verified_by: null, verification_evidence_id: null,
  state: 'ACTIVE', state_note: null, closure_basis: null, closed_at: null,
  created_by: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

describe('9 · acompanhar não é importunar', () => {
  it('aguardando a contraparte, o Apex fica calado até a data esperada', () => {
    const waiting = followup({
      state: 'WAITING_EXTERNAL_PARTY',
      next_expected_event: 'Resposta do cliente sobre o aditivo',
      next_expected_event_at: '2026-09-15',
    });
    const before = nudgeDecision(waiting, '2026-09-11');
    expect(before.shouldNudge).toBe(false);
    expect(before.silenceReason).toMatch(/2026-09-15/);
    // Nem no dia anterior.
    expect(nudgeDecision(waiting, '2026-09-14').shouldNudge).toBe(false);
  });

  it('na data esperada, ele volta — e só então', () => {
    const waiting = followup({
      state: 'WAITING_EXTERNAL_PARTY',
      next_expected_event: 'Resposta do cliente',
      next_expected_event_at: '2026-09-15',
    });
    const onDate = nudgeDecision(waiting, '2026-09-15');
    expect(onDate.shouldNudge).toBe(true);
    expect(onDate.reason).toBe('expected_event_reached');
    expect(nudgeDecision(waiting, '2026-09-20').shouldNudge).toBe(true);
  });

  it('a cadência combinada é respeitada — cobrado ontem não é cobrado hoje', () => {
    const nudgedYesterday = followup({ cadence_days: 7, last_nudge_at: '2026-09-10T09:00:00Z' });
    expect(nudgeDecision(nudgedYesterday, '2026-09-11').shouldNudge).toBe(false);
    expect(nudgeDecision(nudgedYesterday, '2026-09-17').shouldNudge).toBe(true);
  });

  it('prazo vencido é motivo próprio, distinto de cadência', () => {
    expect(nudgeDecision(followup(), '2026-09-20').reason).toBe('overdue');
  });

  it('acompanhamento encerrado nunca é cobrado', () => {
    for (const state of ['COMPLETED', 'CANCELLED'] as const) {
      const closed = followup({
        state, closure_basis: 'human_confirmation', closed_at: '2026-09-12T00:00:00Z',
      });
      expect(nudgeDecision(closed, '2026-12-01').shouldNudge).toBe(false);
    }
  });

  it('escalonamento é por política, não por impaciência', () => {
    const withPolicy = followup({ escalate_after_days: 5 });
    expect(shouldEscalate(withPolicy, '2026-09-14')).toBe(false);
    expect(shouldEscalate(withPolicy, '2026-09-15')).toBe(true);
    // Sem política, nunca escala sozinho.
    expect(shouldEscalate(followup(), '2027-01-01')).toBe(false);
    // Já escalado não escala de novo.
    expect(shouldEscalate(
      followup({ escalate_after_days: 5, escalated_at: '2026-09-15T00:00:00Z' }), '2026-10-01')).toBe(false);
  });

  it('terminal é terminal: um acompanhamento fechado não reabre', () => {
    expect(isValidTransition('COMPLETED', 'ACTIVE')).toBe(false);
    expect(isValidTransition('CANCELLED', 'ACTIVE')).toBe(false);
    expect(isValidTransition('ACTIVE', 'WAITING_EXTERNAL_PARTY')).toBe(true);
    expect(isValidTransition('WAITING_EXTERNAL_PARTY', 'ACTIVE')).toBe(true);
  });

  it('a narrativa conta o que o Apex está fazendo, não o que o usuário deve fazer', () => {
    const waiting = followup({
      state: 'WAITING_EXTERNAL_PARTY',
      next_expected_event: 'aceite do aditivo', next_expected_event_at: '2026-09-15',
    });
    expect(followupNarrative(waiting, '2026-09-11'))
      .toBe('Aguardando aceite do aditivo. Retomada prevista para 2026-09-15.');
    expect(followupNarrative(followup(), '2026-09-20'))
      .toMatch(/o Apex está cobrando o responsável/);
  });

  it('a regra do banco e a da aplicação silenciam pelo MESMO motivo', () => {
    const migration = read('supabase/migrations/156_apex_followup_foundation.sql');
    expect(migration).toContain('apex_followup_due_nudges');
    expect(migration).toContain("f.state <> 'WAITING_EXTERNAL_PARTY'");
    expect(migration).toContain('f.next_expected_event_at <= p_as_of');
    expect(migration).toContain('f.cadence_days');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Verificação vence "marcar como feito"
// ═══════════════════════════════════════════════════════════════════════════

describe('10 · evidência verificada satisfaz a exigência', () => {
  const requirement = { expectedTaxId: '12345678000199', mustCoverDate: '2026-10-31' };

  it('documento da empresa certa e com validade suficiente é verificado', () => {
    const outcome = verifyEvidence(requirement, {
      documentTaxId: '12345678000199', validUntil: '2026-12-31',
    });
    expect(outcome.verified).toBe(true);
  });

  it('documento de outra empresa é REPROVADO, não "não sei"', () => {
    const outcome = verifyEvidence(requirement, {
      documentTaxId: '99999999000100', validUntil: '2026-12-31',
    });
    expect(outcome.verified).toBe(false);
  });

  it('validade que não cobre a data exigida é reprovada', () => {
    const outcome = verifyEvidence(requirement, {
      documentTaxId: '12345678000199', validUntil: '2026-10-30',
    });
    expect(outcome.verified).toBe(false);
  });

  it('sem regra conferível, "não dá para conferir" NUNCA vira "conferido"', () => {
    const outcome = verifyEvidence(
      { expectedTaxId: null, mustCoverDate: null },
      { documentTaxId: '12345678000199', validUntil: '2026-12-31' },
    );
    expect(outcome.verified).toBeNull();
  });

  it('dado ausente no documento é indeterminado, não aprovação', () => {
    expect(verifyEvidence(requirement, { documentTaxId: null, validUntil: '2026-12-31' }).verified)
      .toBeNull();
    expect(verifyEvidence(requirement, { documentTaxId: '12345678000199', validUntil: null }).verified)
      .toBeNull();
  });

  it('fechar por evidência exige regra determinística E a evidência', () => {
    const migration = read('supabase/migrations/156_apex_followup_foundation.sql');
    expect(migration).toContain('requires verification_mode');
    expect(migration).toContain('deterministic_evidence');
    expect(migration).toContain('requires the evidence that was verified');

    const store = read('src/lib/platform/followups/server/store.ts');
    expect(store).toMatch(/verification_mode !== 'deterministic_evidence'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · Contratos não escreve verdade de Finanças nem do Fiscal
// ═══════════════════════════════════════════════════════════════════════════

describe('11 · a fronteira de domínio não se move', () => {
  const FINANCE_TABLES = [
    'finance_receivables', 'finance_settlements', 'finance_entries',
    'fiscal_documents', 'fiscal_service_invoices',
  ];

  it('nenhum módulo novo escreve em Finanças ou Fiscal', () => {
    for (const file of [
      'src/lib/ai/contract-operationalization.ts',
      'src/lib/platform/followups/server/store.ts',
      'src/lib/platform/followups/session.ts',
      'src/lib/contracts/intelligence/session.ts',
    ]) {
      const source = read(file);
      for (const table of FINANCE_TABLES) {
        expect(source, `${file} toca ${table}`).not.toContain(table);
      }
    }
  });

  it('as migrations novas não escrevem em Projetos, Finanças nem Fiscal', () => {
    for (const version of [
      '154_contract_interpretation_governance',
      '155_contract_schedule_anchored_rules',
      '156_apex_followup_foundation',
      '157_apex_followup_human_authority',
      '158_definer_trigger_surface_hardening',
    ]) {
      const migration = read(`supabase/migrations/${version}.sql`);
      expect(migration, version).not.toMatch(/(INSERT INTO|UPDATE)\s+public\.(finance|fiscal)_/i);
      expect(migration, version).not.toMatch(/(INSERT INTO|UPDATE)\s+public\.project_measurements/i);
    }
  });

  it('o Apex identifica a evidência exigida — ele não a produz', () => {
    const operationalizer = read('src/lib/ai/contract-operationalization.ts');
    /*
      Ele grava a EXIGÊNCIA — a obrigação, a condição de faturamento, a
      garantia — e nunca o cumprimento dela. Um relatório técnico de medição é
      trabalho de engenharia; o Apex sabe que ele é exigido e acompanha se
      chegou.
    */
    expect(operationalizer).toContain('contract_obligation_definitions');
    expect(operationalizer).toContain('contract_billing_conditions');
    // Instância de medição pertence a Projetos, e ele não a cria.
    expect(operationalizer).not.toContain('project_measurements');
    expect(operationalizer).not.toContain('project_measurement_evidence');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · Isolamento entre inquilinos
// ═══════════════════════════════════════════════════════════════════════════

describe('12 · nada atravessa a fronteira do inquilino', () => {
  it('as tabelas novas nascem com RLS e sem escrita para o navegador', () => {
    for (const [version, tables] of [
      ['155_contract_schedule_anchored_rules',
        ['organization_business_calendars', 'organization_non_business_days']],
      ['156_apex_followup_foundation', ['apex_followups', 'apex_followup_events']],
    ] as const) {
      const migration = read(`supabase/migrations/${version}.sql`);
      for (const table of tables) {
        expect(migration, `${table} sem RLS`).toContain(`'${table}'`);
      }
      expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
      expect(migration).toContain('organization_id = public.current_user_organization_id()');
      expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE/);
    }
  });

  it('a organização vem do perfil do chamador, nunca do corpo do pedido', () => {
    const actor = read('src/lib/platform/followups/server/actor.ts');
    expect(actor).toContain('getActiveOrganizationRow');
    expect(actor).toMatch(/nunca do corpo do pedido/i);

    // Nenhuma rota aceita organizationId do cliente.
    for (const route of [
      'src/app/api/platform/followups/route.ts',
      'src/app/api/platform/followups/[id]/transition/route.ts',
      'src/app/api/platform/followups/[id]/assign/route.ts',
      'src/app/api/platform/followups/[id]/complete/route.ts',
      'src/app/api/contracts/[id]/interpretations/[clauseId]/attention/route.ts',
    ]) {
      expect(read(route), route).not.toMatch(/organizationId:\s*z\./);
    }
  });

  it('toda consulta do service role escopa o inquilino explicitamente', () => {
    const store = read('src/lib/platform/followups/server/store.ts');
    // O service role ignora RLS: o escopo precisa estar em cada WHERE.
    const selects = store.match(/\.from\('apex_followups?'\)/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    expect((store.match(/organization_id/g) ?? []).length).toBeGreaterThanOrEqual(selects.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13 · Produção vazia continua vazia
// ═══════════════════════════════════════════════════════════════════════════

describe('13 · nenhuma demonstração se disfarça de produção', () => {
  it('nada nos módulos novos semeia dado de exemplo', () => {
    for (const file of [
      'src/lib/ai/contract-operationalization.ts',
      'src/lib/platform/followups/server/store.ts',
      'src/lib/platform/followups/state.ts',
      'src/lib/contracts/intelligence/attention-policy.ts',
      'src/lib/contracts/obligations/schedule-anchor.ts',
      'src/components/contracts/intelligence/ApexFollowupPanel.tsx',
      'src/components/contracts/intelligence/ContractInterpretationPanel.tsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bMOCK_|\bDEMO_|mockData|sampleData|fakeRows/);
    }
  });

  it('o contrato nasce NÃO CLASSIFICADO — cadastrar não é afirmar procedência', () => {
    const page = read('src/app/(main)/contratos/page.tsx');
    expect(page).toContain("dataClass: 'unclassified'");
    expect(page).not.toContain("dataClass: 'live'");
  });

  it('as migrations novas não semeiam contrato, cláusula nem exigência', () => {
    /*
      Os INSERT que sobrevivem estão DENTRO de função — a materialização de
      ocorrência e o histórico de acompanhamento — e só rodam quando alguém os
      chama com dado real. O que nenhuma delas pode fazer é criar verdade de
      negócio no momento em que é aplicada.
    */
    const SEEDABLE = [
      'contracts', 'contract_clauses', 'contract_documents',
      'contract_obligation_definitions', 'contract_billing_conditions',
      'contract_guarantees', 'contract_insurance_requirements',
      'organizations', 'apex_followups',
    ];
    for (const version of [
      '154_contract_interpretation_governance',
      '155_contract_schedule_anchored_rules',
      '156_apex_followup_foundation',
      '157_apex_followup_human_authority',
      '158_definer_trigger_surface_hardening',
    ]) {
      const migration = read(`supabase/migrations/${version}.sql`);
      for (const table of SEEDABLE) {
        expect(migration, `${version} semeia ${table}`)
          .not.toMatch(new RegExp(`INSERT INTO public\\.${table}\\b`));
      }
    }
  });

  it('a lista vazia é resposta legítima da leitura, e o prompt diz isso', () => {
    const operationalizer = read('src/lib/ai/contract-operationalization.ts');
    expect(operationalizer).toMatch(/Lista vazia é resposta correta/);
    const { accepted } = assertOperationalEvidence({}, 100);
    expect(accepted.obligations).toHaveLength(0);
    expect(accepted.billing_conditions).toHaveLength(0);
    expect(accepted.guarantees).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Navegação: global e local deixam de repetir os mesmos nomes
// ═══════════════════════════════════════════════════════════════════════════

describe('navegação global e local', () => {
  it('a sidebar da carteira continua com exatamente oito áreas', () => {
    const sections = read('src/lib/contracts/portfolio-sections.ts');
    const order = sections.match(/export const SECTION_ORDER: SectionId\[\] = \[([\s\S]*?)\];/);
    expect(order).not.toBeNull();
    const ids = (order![1].match(/'/g) ?? []).length / 2;
    expect(ids).toBe(8);
    for (const label of [
      'Visão Geral', 'Contratos', 'Renovações', 'Obrigações',
      'Faturamentos', 'Aprovações', 'Riscos & Cláusulas', 'Documentos',
    ]) {
      expect(sections, label).toContain(label);
    }
  });

  it('o dossiê tem seis destinos, e nenhum repete o nome de uma área global', () => {
    const page = read('src/app/(main)/contratos/[id]/page.tsx');
    const expected = [
      "label: 'Resumo'",
      "label: 'Operação'",
      "label: 'Medição & Faturamento'",
      "label: 'Inteligência Contratual'",
      "label: 'Documentos'",
      "label: 'Governança'",
    ];
    for (const label of expected) expect(page, label).toContain(label);

    // Os nomes que ecoavam a sidebar saíram da navegação local.
    for (const retired of [
      "label: 'Visão geral'", "label: 'Financeiro'", "label: 'Obrigações'",
      "label: 'Riscos & Cláusulas'", "label: 'Aprovações'",
    ]) {
      expect(page, retired).not.toContain(retired);
    }
  });

  it('nenhum link antigo cai numa tela vazia', () => {
    const page = read('src/app/(main)/contratos/[id]/page.tsx');
    for (const [from, to] of [
      ['clauses', 'intelligence'], ['audit', 'summary'], ['risks', 'intelligence'],
      ['finance', 'billing'], ['obligations', 'operation'], ['approvals', 'governance'],
    ]) {
      expect(page, `${from} -> ${to}`).toMatch(new RegExp(`${from}:\\s*'${to}'`));
    }
  });

  it('com o dossiê aberto, a sidebar recua sem sumir', () => {
    const sidebar = read('src/components/layout/app-sidebar.tsx');
    expect(sidebar).toContain('isContractDossierRoute');
    expect(sidebar).toContain('hud-nav-submenu-receded');

    const css = read('src/app/globals.css');
    expect(css).toContain('.hud-nav-submenu-receded');
    // Recuo por opacidade: nada sai da árvore de acessibilidade.
    expect(css).toMatch(/\.hud-nav-submenu-receded\s*\{[^}]*opacity:/);
    expect(css).not.toMatch(/\.hud-nav-submenu-receded\s*\{[^}]*display:\s*none/);
  });

  it('a entrada do contrato fala em ADICIONAR, não em cadastrar um contrato novo', () => {
    expect(read('src/app/(main)/contratos/page.tsx')).toContain('Adicionar contrato');
    expect(read('src/components/contracts/contract-upload.tsx')).toContain('title="Adicionar contrato"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A superfície SECURITY DEFINER dos gatilhos permanece fechada
// ═══════════════════════════════════════════════════════════════════════════

describe('gatilhos de governança não são chamáveis de fora', () => {
  /*
    Função criada em `public` nasce com EXECUTE para PUBLIC. Numa função de
    GATILHO isso é inútil (o gatilho a executa sem consultar ACL) e perigoso
    (é uma superfície SECURITY DEFINER exposta). A auditoria permanente da Fase
    7.5 pegou três funções nesse estado; a 158 fechou todas.
  */
  it('as migrations revogam EXECUTE de toda função de gatilho que criam', () => {
    const m158 = read('supabase/migrations/158_definer_trigger_surface_hardening.sql');
    for (const fn of [
      'contracts_guard_review_impersonation',
      'contracts_classify_interpretation',
      'apex_followups_guard_authority',
      'apex_followups_record_event',
      'apex_followups_reject_history_rewrite',
    ]) {
      expect(m158, fn).toContain(fn);
    }
    expect(m158).toContain('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated');
  });

  it('a guarda de personificação passa a ter search_path fixo', () => {
    const m158 = read('supabase/migrations/158_definer_trigger_surface_hardening.sql');
    expect(m158).toMatch(
      /ALTER FUNCTION public\.contracts_guard_review_impersonation\(\)\s*\n?\s*SET search_path = public, pg_temp/);
  });

  it('toda função DEFINER das migrations novas declara search_path', () => {
    /*
      Sem os comentários. Estas migrations EXPLICAM por que usam
      `SECURITY DEFINER`, e contar as explicações junto faria a documentação da
      regra reprovar a regra — o mesmo cuidado que o contrato de segurança da
      Fase 7 já toma.
    */
    const stripSql = (sql: string) => sql
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');

    for (const version of [
      '155_contract_schedule_anchored_rules',
      '156_apex_followup_foundation',
      '157_apex_followup_human_authority',
    ]) {
      const migration = stripSql(read(`supabase/migrations/${version}.sql`));
      const definers = (migration.match(/SECURITY DEFINER/g) ?? []).length;
      const scoped = (migration.match(/SECURITY DEFINER SET search_path/g) ?? []).length;
      expect(definers, `${version} sem função DEFINER`).toBeGreaterThan(0);
      expect(scoped, `${version}: ${scoped}/${definers} com search_path`).toBe(definers);
    }
  });
});
