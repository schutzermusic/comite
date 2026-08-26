/**
 * P2F.1 — aditivos contratuais e estado vigente.
 *
 * O que estes testes protegem: um contrato com aditivos tem várias respostas
 * possíveis para "quanto vale?", e o produto precisa exibir a certa — ou
 * admitir que não sabe. Nenhum número aqui pode ser plausível: ou é derivado de
 * efeito explicitamente registrado, ou é ausência.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  effectiveContractState, orderAmendments, contractInstruments,
  isAmendmentInForce, declaresValueEffect, declaresTermEffect, clauseLineages,
} from '@/lib/contracts/trust/amendments';
import { live, missing, failed, hasOfficialValue, isError } from '@/lib/contracts/trust/trusted';
import type { ContractAmendmentRow } from '@/lib/contracts/contract-service';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ORIGINAL_VALUE = 1_000_000;
const ORIGINAL_END = new Date('2027-08-31T00:00:00');

const value = live(ORIGINAL_VALUE, 'contracts');
const endDate = live(ORIGINAL_END, 'contracts');

let seq = 0;
const amend = (over: Partial<ContractAmendmentRow> = {}): ContractAmendmentRow => {
  seq += 1;
  return {
    id: `am-${seq}`, organization_id: 'org-1', contract_id: 'c-1',
    amendment_number: `TA-0${seq}`, title: null, document_id: null,
    status: 'active', signed_date: null, effective_date: '2027-01-01',
    value_delta: null, value_absolute: null,
    new_end_date: null, term_extension_days: null,
    scope_change: null, notes: null,
    created_by: 'u', updated_by: 'u',
    created_at: `2026-1${seq}-01T00:00:00Z`, updated_at: '2026-12-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
};

const state = (rows: ContractAmendmentRow[]) =>
  effectiveContractState(value, endDate, live(rows, 'contracts'));

// ═══════════════════════════════════════════════════════════════════
// 1 · O mestre nunca é sobrescrito
// ═══════════════════════════════════════════════════════════════════

describe('o contrato original permanece intacto', () => {
  it('o valor original continua disponível depois de qualquer aditivo', () => {
    const s = state([amend({ value_delta: 250_000 })]);
    expect(hasOfficialValue(s.originalValue) && s.originalValue.value).toBe(ORIGINAL_VALUE);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(1_250_000);
  });

  it('a vigência original continua disponível depois de prorrogação', () => {
    const s = state([amend({ term_extension_days: 365 })]);
    expect(hasOfficialValue(s.originalEndDate) && s.originalEndDate.value).toEqual(ORIGINAL_END);
    expect(hasOfficialValue(s.currentEndDate) && s.currentEndDate.value)
      .toEqual(new Date('2028-08-30T00:00:00'));
  });

  it('nada no modelo escreve em contracts', () => {
    // A derivação é de LEITURA. Se um dia gravasse o valor vigente por cima do
    // mestre, a pergunta "de quanto foi o reajuste acumulado?" perderia
    // resposta no dia em que uma auditoria precisasse dela.
    const src = code('src/lib/contracts/trust/amendments.ts');
    expect(src).not.toMatch(/\.update\(|\.insert\(|supabase/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2 · As duas formas de declarar valor
// ═══════════════════════════════════════════════════════════════════

describe('efeito sobre o valor', () => {
  it('acréscimo soma sobre o valor corrente', () => {
    const s = state([
      amend({ amendment_number: 'TA-01', effective_date: '2027-01-01', value_delta: 100_000 }),
      amend({ amendment_number: 'TA-02', effective_date: '2027-06-01', value_delta: 50_000 }),
    ]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(1_150_000);
  });

  it('valor absoluto REDEFINE, não soma', () => {
    /*
      "O valor passa a ser R$ 900.000" substitui o total. Somar produziria
      R$ 1.900.000 sobre um contrato que o papel diz valer 900 mil.
    */
    const s = state([
      amend({ amendment_number: 'TA-01', effective_date: '2027-01-01', value_delta: 100_000 }),
      amend({ amendment_number: 'TA-02', effective_date: '2027-06-01', value_absolute: 900_000 }),
    ]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(900_000);
  });

  it('acréscimo DEPOIS de redefinição parte do valor redefinido', () => {
    const s = state([
      amend({ amendment_number: 'TA-01', effective_date: '2027-01-01', value_absolute: 900_000 }),
      amend({ amendment_number: 'TA-02', effective_date: '2027-06-01', value_delta: 100_000 }),
    ]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(1_000_000);
  });

  it('acréscimo sobre base desconhecida NÃO vira o próprio acréscimo', () => {
    // Assumir que a base era zero seria inventar o valor do contrato.
    const s = effectiveContractState(
      missing<number>('null-in-source'),
      endDate,
      live([amend({ value_delta: 200_000 })], 'contracts'),
    );
    expect(hasOfficialValue(s.currentValue)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3 · Ordem determinística
// ═══════════════════════════════════════════════════════════════════

describe('ordem dos aditivos', () => {
  it('ordena por data de efeito', () => {
    const a = amend({ amendment_number: 'TA-09', effective_date: '2027-01-01' });
    const b = amend({ amendment_number: 'TA-01', effective_date: '2026-01-01' });
    expect(orderAmendments([a, b]).map((x) => x.amendment_number)).toEqual(['TA-01', 'TA-09']);
  });

  it('empate no mesmo dia desempata por número, não pela ordem do banco', () => {
    /*
      Caso real em pacote de repactuação. Sem desempate, o total vigente
      dependeria de qual linha o Postgres devolvesse primeiro — e mudaria entre
      execuções sem nada ter mudado no contrato.
    */
    const a = amend({ amendment_number: 'TA-10', effective_date: '2027-01-01', value_absolute: 10 });
    const b = amend({ amendment_number: 'TA-02', effective_date: '2027-01-01', value_absolute: 20 });
    expect(orderAmendments([a, b]).map((x) => x.amendment_number)).toEqual(['TA-02', 'TA-10']);
    // E o resultado é estável nas duas ordens de entrada.
    expect(orderAmendments([b, a]).map((x) => x.amendment_number)).toEqual(['TA-02', 'TA-10']);
  });

  it('número desempata numericamente, não alfabeticamente', () => {
    const a = amend({ amendment_number: 'TA-10', effective_date: '2027-01-01' });
    const b = amend({ amendment_number: 'TA-9', effective_date: '2027-01-01' });
    expect(orderAmendments([a, b]).map((x) => x.amendment_number)).toEqual(['TA-9', 'TA-10']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4 · O que NÃO produz efeito
// ═══════════════════════════════════════════════════════════════════

describe('aditivo registrado que não produz efeito', () => {
  it('rascunho não altera nada, mas aparece na linha do tempo', () => {
    const s = state([amend({ status: 'draft', value_delta: 500_000 })]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(ORIGINAL_VALUE);
    expect(s.timeline).toHaveLength(1);
    expect(s.timeline[0].skipReason).toBe('not-in-force');
    expect(s.unapplied).toHaveLength(1);
  });

  it('cancelado nunca produz efeito', () => {
    const s = state([amend({ status: 'cancelled', value_absolute: 5 })]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(ORIGINAL_VALUE);
    expect(s.timeline[0].skipReason).toBe('not-in-force');
  });

  it('aditivo só de escopo não altera valor nem prazo', () => {
    const s = state([amend({ scope_change: 'Inclusão da subestação 3' })]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(ORIGINAL_VALUE);
    expect(s.timeline[0].skipReason).toBe('no-declared-effect');
    expect(s.hasEffects).toBe(false);
  });

  it('excluído logicamente sai da conta', () => {
    const s = state([amend({ value_delta: 999, deleted_at: '2026-12-20T00:00:00Z' })]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(ORIGINAL_VALUE);
    expect(s.timeline).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5 · Sem data de efeito, não há total — e isso é o certo
// ═══════════════════════════════════════════════════════════════════

describe('aditivo em vigor sem data de efeito', () => {
  it('torna o valor vigente DESCONHECIDO, não o original', () => {
    /*
      Sabemos que o valor mudou e não sabemos em que ordem. Exibir o original
      afirmaria que nada mudou; aplicar em ordem arbitrária produziria um
      número que parece confiável e não é.
    */
    const s = state([amend({ effective_date: null, value_delta: 100_000 })]);
    expect(hasOfficialValue(s.currentValue)).toBe(false);
    expect(s.currentValue.trust).toBe('missing');
    if (s.currentValue.trust === 'missing') {
      expect(s.currentValue.note).toContain('sem data de efeito');
    }
    // Mas o original segue conhecido.
    expect(hasOfficialValue(s.originalValue) && s.originalValue.value).toBe(ORIGINAL_VALUE);
  });

  it('envenena só a dimensão afetada', () => {
    // Aditivo sem data que altera SÓ valor não invalida o prazo vigente.
    const s = state([
      amend({ amendment_number: 'TA-01', effective_date: null, value_delta: 1 }),
      amend({ amendment_number: 'TA-02', effective_date: '2027-02-01', term_extension_days: 30 }),
    ]);
    expect(hasOfficialValue(s.currentValue)).toBe(false);
    expect(hasOfficialValue(s.currentEndDate)).toBe(true);
  });

  it('sem data e sem efeito declarado é apenas "não altera nada"', () => {
    const s = state([amend({ effective_date: null, scope_change: 'ajuste redacional' })]);
    expect(s.timeline[0].skipReason).toBe('no-declared-effect');
    expect(hasOfficialValue(s.currentValue)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6 · Aditivos não lidos ≠ nenhum aditivo
// ═══════════════════════════════════════════════════════════════════

describe('procedência da leitura', () => {
  it('aditivos não apurados tornam o vigente desconhecido', () => {
    /*
      Um contrato cujos aditivos não foram lidos não tem "nenhum aditivo" —
      tem aditivos desconhecidos. Afirmar que o vigente é o original seria
      afirmar que não há aditivo, que ninguém verificou.
    */
    const s = effectiveContractState(value, endDate, missing<readonly ContractAmendmentRow[]>('no-rows'));
    expect(hasOfficialValue(s.currentValue)).toBe(false);
    expect(hasOfficialValue(s.originalValue)).toBe(true);
  });

  it('falha de leitura propaga como erro, não como vazio', () => {
    const s = effectiveContractState(
      value, endDate,
      failed<readonly ContractAmendmentRow[]>('timeout', 'contracts'),
    );
    expect(isError(s.currentValue)).toBe(true);
  });

  it('lista lida e VAZIA mantém o vigente igual ao original', () => {
    const s = state([]);
    expect(hasOfficialValue(s.currentValue) && s.currentValue.value).toBe(ORIGINAL_VALUE);
    expect(s.hasEffects).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7 · Prazo
// ═══════════════════════════════════════════════════════════════════

describe('efeito sobre o prazo', () => {
  it('nova data de término redefine a vigência', () => {
    const s = state([amend({ new_end_date: '2029-12-31' })]);
    expect(hasOfficialValue(s.currentEndDate) && s.currentEndDate.value)
      .toEqual(new Date('2029-12-31T00:00:00'));
  });

  it('prorrogações sucessivas acumulam', () => {
    const s = state([
      amend({ amendment_number: 'TA-01', effective_date: '2027-01-01', term_extension_days: 30 }),
      amend({ amendment_number: 'TA-02', effective_date: '2027-06-01', term_extension_days: 60 }),
    ]);
    expect(hasOfficialValue(s.currentEndDate) && s.currentEndDate.value)
      .toEqual(new Date('2027-11-29T00:00:00'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8 · Instrumentos contratuais
// ═══════════════════════════════════════════════════════════════════

describe('instrumentos', () => {
  it('o mestre vem primeiro, aditivos na ordem de efeito', () => {
    const s = state([
      amend({ amendment_number: 'TA-02', effective_date: '2027-06-01' }),
      amend({ amendment_number: 'TA-01', effective_date: '2027-01-01' }),
    ]);
    const items = contractInstruments('Contrato mestre', 'doc-1', s);
    expect(items[0].kind).toBe('master');
    expect(items.slice(1).map((i) => i.kind === 'amendment' ? i.step.amendment.amendment_number : ''))
      .toEqual(['TA-01', 'TA-02']);
  });

  it('aditivo sem efeito continua listado — existe como instrumento', () => {
    const s = state([amend({ scope_change: 'ajuste' })]);
    expect(contractInstruments('Mestre', null, s)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9 · Predicados
// ═══════════════════════════════════════════════════════════════════

describe('predicados', () => {
  it('só signed e active estão em vigor', () => {
    expect(isAmendmentInForce(amend({ status: 'signed' }))).toBe(true);
    expect(isAmendmentInForce(amend({ status: 'active' }))).toBe(true);
    expect(isAmendmentInForce(amend({ status: 'draft' }))).toBe(false);
    expect(isAmendmentInForce(amend({ status: 'cancelled' }))).toBe(false);
  });

  it('declaração de efeito não confunde valor com prazo', () => {
    expect(declaresValueEffect(amend({ value_delta: 1 }))).toBe(true);
    expect(declaresValueEffect(amend({ new_end_date: '2028-01-01' }))).toBe(false);
    expect(declaresTermEffect(amend({ term_extension_days: 1 }))).toBe(true);
    expect(declaresTermEffect(amend({ value_absolute: 1 }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10 · A migration protege o que o modelo assume
// ═══════════════════════════════════════════════════════════════════

describe('migration 098', () => {
  const sql = read('supabase/migrations/098_contract_amendments.sql');

  it('impede declarar valor das duas formas ao mesmo tempo', () => {
    // Sem o CHECK, a derivação teria de escolher entre duas verdades sobre a
    // mesma cláusula, sem base para escolher.
    expect(sql).toContain('contract_amendments_value_effect_check');
    expect(sql).toContain('contract_amendments_term_effect_check');
  });

  it('fecha o vocabulário de status', () => {
    expect(sql).toContain("CHECK (status IN ('draft', 'signed', 'active', 'cancelled'))");
  });

  it('é aditiva — não altera tabela existente', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.contracts\b/);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('exige alvo para alterar ou suprimir cláusula', () => {
    expect(sql).toContain('contract_amendment_clauses_target_check');
  });

  it('tem RLS nas duas tabelas', () => {
    expect(sql).toContain('ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.contract_amendment_clauses ENABLE ROW LEVEL SECURITY');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11 · Linhagem de cláusula
// ═══════════════════════════════════════════════════════════════════

describe('linhagem de cláusula', () => {
  const link = (over: Partial<{
    amendment_id: string; clause_id: string | null; replacement_clause_id: string | null;
    effect: string; note: string | null;
  }> = {}) => ({
    amendment_id: 'am-x', clause_id: 'cl-original', replacement_clause_id: null,
    effect: 'altered', note: null, ...over,
  });

  it('a cláusula ORIGINAL nunca é substituída no registro', () => {
    /*
      Sobrescrever o texto anterior pareceria mais limpo e destruiria a
      resposta para "o que essa cláusula dizia quando assinamos?" — que é
      exatamente a pergunta que uma disputa contratual faz.
    */
    const a = amend({ id: 'am-1', amendment_number: 'TA-01', status: 'active' });
    const map = clauseLineages([a], [link({
      amendment_id: 'am-1', clause_id: 'cl-original', replacement_clause_id: 'cl-nova',
    })]);
    const lin = map.get('cl-original')!;
    expect(lin.clauseId).toBe('cl-original');           // o original permanece
    expect(lin.currentClauseId).toBe('cl-nova');        // e a nova é a vigente
    expect(lin.entries[0].amendmentNumber).toBe('TA-01');
  });

  it('rascunho registra a proposta mas NÃO muda a cláusula vigente', () => {
    const a = amend({ id: 'am-1', status: 'draft' });
    const map = clauseLineages([a], [link({
      amendment_id: 'am-1', clause_id: 'cl-original', replacement_clause_id: 'cl-nova',
    })]);
    const lin = map.get('cl-original')!;
    expect(lin.entries).toHaveLength(1);
    expect(lin.entries[0].inForce).toBe(false);
    // Um rascunho não altera o contrato.
    expect(lin.currentClauseId).toBe('cl-original');
  });

  it('supressão por aditivo em vigor marca a cláusula como removida', () => {
    const a = amend({ id: 'am-1', status: 'active' });
    const map = clauseLineages([a], [link({ amendment_id: 'am-1', effect: 'removed' })]);
    expect(map.get('cl-original')!.removed).toBe(true);
  });

  it('alterações sucessivas encadeiam até a última em vigor', () => {
    const a1 = amend({ id: 'am-1', amendment_number: 'TA-01', effective_date: '2027-01-01', status: 'active' });
    const a2 = amend({ id: 'am-2', amendment_number: 'TA-02', effective_date: '2027-06-01', status: 'active' });
    const map = clauseLineages([a2, a1], [
      link({ amendment_id: 'am-2', replacement_clause_id: 'cl-v3' }),
      link({ amendment_id: 'am-1', replacement_clause_id: 'cl-v2' }),
    ]);
    const lin = map.get('cl-original')!;
    // Em ordem de EFEITO, não de inserção.
    expect(lin.entries.map((e) => e.amendmentNumber)).toEqual(['TA-01', 'TA-02']);
    expect(lin.currentClauseId).toBe('cl-v3');
  });

  it('cláusula nunca tocada não aparece no mapa', () => {
    // Entrada vazia confundiria "não foi tocada" com "foi analisada, nada mudou".
    const map = clauseLineages([amend({ id: 'am-1' })], []);
    expect(map.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12 · Falha de leitura nunca se disfarça de "nenhum aditivo"
// ═══════════════════════════════════════════════════════════════════

describe('ausência tem três formas, e elas não se confundem', () => {
  it('leitura que falhou marca readFailed', () => {
    /*
      Sem esta bandeira, tela e PDF diriam "nenhum aditivo registrado" sobre um
      contrato cujos aditivos não puderam ser lidos — a afirmação oposta, que
      leva a decisão oposta.
    */
    const s = effectiveContractState(
      value, endDate, failed<readonly ContractAmendmentRow[]>('relation does not exist', 'contracts'),
    );
    expect(s.readFailed).toBe(true);
    expect(s.notMeasured).toBe(false);
    expect(s.timeline).toHaveLength(0);
  });

  it('não consultado marca notMeasured', () => {
    const s = effectiveContractState(value, endDate, missing<readonly ContractAmendmentRow[]>('no-rows'));
    expect(s.notMeasured).toBe(true);
    expect(s.readFailed).toBe(false);
  });

  it('lido e vazio não é nem um nem outro', () => {
    const s = state([]);
    expect(s.readFailed).toBe(false);
    expect(s.notMeasured).toBe(false);
  });

  it('o dossiê carrega o erro em vez de gravar lista vazia', () => {
    // Um deploy em que o código chegue antes da migration 098 não pode
    // derrubar o dossiê nem afirmar que o contrato é o original.
    const page = code('src/app/(main)/contratos/[id]/page.tsx');
    expect(page).toContain('detail?.amendmentsError');
    expect(page).toContain('failed<readonly ContractAmendmentRow[]>');
    // Tela e PDF leem o MESMO valor.
    expect(page).toContain('amendments: amendmentsOfficial');
  });

  it('a leitura dos aditivos é tolerante a falha no serviço', () => {
    const service = code('src/lib/contracts/contract-service.ts');
    expect(service).toContain('amendmentsError');
    expect(service).toContain('let amendmentsError: string | null = null;');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13 · Data de calendário não desliza um dia
// ═══════════════════════════════════════════════════════════════════

describe('coluna date do Postgres', () => {
  it('vigência de 31/08 não vira 30/08 em fuso brasileiro', async () => {
    /*
      `new Date('2027-08-31')` é meia-noite UTC. Renderizado em GMT-3 — o
      Brasil inteiro — sai como 30/08. O contrato aparecia vencendo um dia
      antes, e `daysUntilExpiration` contava um dia a menos.

      Encontrado ao olhar o painel de instrumentos no app real: o dossiê
      mostrava "vigência original 30/08/2027" para um contrato que termina em
      31/08/2027.
    */
    const { buildTrustedContract, relationsBatchFromDetail } =
      await import('@/lib/contracts/trust/read-model');

    const row = {
      id: 'c-1', organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
      title: 'x', contract_number: 'x', counterparty_name: 'x', contract_type: 'x',
      status: 'active', lifecycle_stage: null,
      start_date: null, end_date: '2027-08-31', signed_date: null, renewal_date: null,
      currency: 'BRL', total_value: 1, monthly_value: null, payment_terms: null,
      scope_summary: null, risk_level: 'medium', health_score: null, owner_user_id: null,
      created_by: null, updated_by: null, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z', deleted_at: null, data_class: 'live',
    } as never;

    const detail = {
      contract: row, clauses: [], penalties: [], milestones: [], risks: [], files: [],
      aiAnalyses: [], billingEvents: [], obligations: [], approvals: [],
      projectLinks: [], riskLinks: [], documents: [],
      amendments: [], amendmentClauses: [], amendmentsError: null,
    } as never;

    const t = buildTrustedContract(row, relationsBatchFromDetail(detail), [], new Date('2027-01-01'));
    expect(hasOfficialValue(t.endDate)).toBe(true);
    if (hasOfficialValue(t.endDate)) {
      // O dia do calendário sobrevive à renderização local.
      expect(t.endDate.value.getDate()).toBe(31);
      expect(t.endDate.value.getMonth()).toBe(7); // agosto
      expect(t.endDate.value.toLocaleDateString('pt-BR')).toBe('31/08/2027');
    }
  });
});
