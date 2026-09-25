/**
 * DECISÕES — as regras puras de leitura (src/lib/decisions/model.ts):
 *  • a chave é a gramática do CHECK do livro de entrega — nada além dela;
 *  • a ordem da fila é explicável (vencida > crítica > prazo > valor > normal);
 *  • "por que chegou até mim" vem da autoridade gravada, sem inventar alçada;
 *  • a inteligência de compra só fala com evidência da comparação;
 *  • idempotência do motor é por ATOR — nunca a mesma chave entre pessoas.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_LABEL, AUTHORITY_DECISION, ENGINE_DECISION, MATERIALITY_THRESHOLD, OUTCOME_STATUS, actionConsequence, authorityFromRow,
  categoryLabel, decisionHref, effectiveDeadline, engineIdempotencyKey, isSource, isStaleEngineMessage, kindLabel, normalizeReason,
  parseDecisionKey, prioritize, priorityReason, procurementImpact, roleLabel, sourceLink, staleMessage, statusOf, toDecisionItem, whyFacts,
} from '@/lib/decisions/model';
import type { DecisionInboxRow, DecisionItem, PersonRef, QuoteOption } from '@/lib/decisions/types';

const PO = '11111111-1111-4111-8111-111111111111';
const RQ = '22222222-2222-4222-8222-222222222222';
const today = '2026-09-24';
const fmt = { money: (v: number | null, c?: string | null) => `${c ?? 'BRL'} ${v}`, date: (v: string | null) => v ?? '—' };
const person = (id: string | null): PersonRef | null => (id ? { id, name: `Pessoa ${id.slice(0, 4)}` } : null);

const authorityRaw = (over: Record<string, unknown> = {}) => ({
  kind: 'PROCUREMENT_AUTHORITY', authority_id: 'auth-1', ceiling: 500000, currency: 'BRL', tier: 'PRIMARY', grantee_kind: 'ROLE',
  grantee_role_id: 'role-fin', grantee_user_id: null, scope_project_id: null, scope_category: null, source_kind: 'BOARD_RESOLUTION',
  source_reference: 'ATA-QA-001', source_document_id: null, justification: 'Alçada do Financeiro', effective_from: '2026-01-01',
  effective_until: null, declared_by: 'owner-1', lead_days: 3, ...over,
});
const policyRaw = (over: Record<string, unknown> = {}) => ({
  kind: 'APPROVAL_POLICY', policy_key: 'procurement.po', policy_version_no: 2, stage_no: 1, stage_name: 'Financeiro', stage_count: 2,
  quorum_required: 1, step_key: 'fin', step_name: 'Financeiro', eligibility_mode: 'ROLE', role_key: 'financeiro', permission_key: null,
  authority_source: 'ROLE', authority_basis: 'role:financeiro', authority_limit: null, authority_currency: null, ...over,
});

const row = (over: Partial<DecisionInboxRow> = {}): DecisionInboxRow => ({
  decision_key: `purchase_order:${PO}:s1`, source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order',
  subject_id: PO, action_type: 'approve', request_id: null, step_id: null, stage_no: null, submission: 1, title: 'Pedido de compra OC-1',
  amount: '1000.00', currency: 'BRL', project_id: 'proj-1', requested_by: 'buyer-1', requested_at: '2026-09-20T12:00:00Z', due_at: null,
  need_by: null, decide_by: null, overdue: false, assignment: 'PRIMARY', state: 'PENDENTE', actions: ['APPROVE', 'REQUEST_ADJUSTMENT'],
  reason_required: ['REQUEST_ADJUSTMENT'], fingerprint: 'fp-1', authority: authorityRaw(), ...over,
});
const item = (over: Partial<DecisionInboxRow> = {}, critical: { reason: string } | null = null): DecisionItem =>
  toDecisionItem({ row: row(over), today, person, critical });

describe('chave de decisão', () => {
  it('lê as duas fontes e devolve identidade + submissão/estágio', () => {
    expect(parseDecisionKey(`purchase_order:${PO}:s1`)).toEqual({ kind: 'purchase_order', subjectId: PO, submission: 1 });
    expect(parseDecisionKey(`purchase_order:${PO}:s999999`)).toEqual({ kind: 'purchase_order', subjectId: PO, submission: 999999 });
    expect(parseDecisionKey(`approval_request:${RQ}:e2`)).toEqual({ kind: 'approval_request', requestId: RQ, stageNo: 2 });
  });
  it.each([
    ['vazia', ''], ['nula', null], ['indefinida', undefined],
    ['submissão zero', `purchase_order:${PO}:s0`], ['zero à esquerda', `purchase_order:${PO}:s01`],
    ['submissão com 7 dígitos', `purchase_order:${PO}:s1000000`], ['estágio com 5 dígitos', `approval_request:${RQ}:e10000`],
    ['estágio zero', `approval_request:${RQ}:e0`], ['sufixo trocado', `purchase_order:${PO}:e1`], ['motor com s', `approval_request:${RQ}:s1`],
    ['UUID maiúsculo', 'purchase_order:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE:s1'], ['UUID curto', 'purchase_order:1111:s1'],
    ['prefixo desconhecido', `contract:${PO}:s1`], ['lixo depois', `purchase_order:${PO}:s1;drop`], ['espaço', ` purchase_order:${PO}:s1`],
    ['quebra de linha', `purchase_order:${PO}:s1\n`], ['injeção de caminho', `purchase_order:../../${PO}:s1`],
    ['longa demais', `purchase_order:${PO}:s1${'x'.repeat(130)}`],
  ])('recusa chave malformada (%s)', (_label, key) => {
    expect(parseDecisionKey(key as string | null | undefined)).toBeNull();
  });
  it('chave acima de 120 caracteres é recusada antes da regex', () => {
    expect(parseDecisionKey('a'.repeat(121))).toBeNull();
  });
  it('o link de notificação é RELATIVO ao Apex e codifica a chave', () => {
    const href = decisionHref(`purchase_order:${PO}:s1`);
    expect(href).toBe(`/decisoes?d=purchase_order%3A${PO}%3As1`);
    expect(href.startsWith('/') && !href.startsWith('//')).toBe(true);
  });
});

describe('vocabulário e estado', () => {
  it('statusOf: desfecho canônico vence o estado aberto; sem nada, pendente', () => {
    expect(statusOf('PENDENTE', null)).toBe('PENDENTE');
    expect(statusOf('ESCALADA', null)).toBe('ESCALADA');
    expect(statusOf('SEM_DECISOR', null)).toBe('SEM_DECISOR');
    expect(statusOf(null, null)).toBe('PENDENTE');
    expect(statusOf('PENDENTE', 'APPROVED')).toBe('APROVADA');
    expect(statusOf('EM_ANALISE', 'REJECTED')).toBe('REJEITADA');
    expect(statusOf(null, 'ADJUSTMENT_REQUESTED')).toBe('AJUSTE_SOLICITADO');
    expect(statusOf(null, 'CANCELLED')).toBe('CANCELADA');
    expect(statusOf(null, 'EXPIRED')).toBe('EXPIRADA');
    expect(Object.keys(OUTCOME_STATUS).sort()).toEqual(['ADJUSTMENT_REQUESTED', 'APPROVED', 'CANCELLED', 'EXPIRED', 'REJECTED']);
  });
  it('rótulos: tipo, categoria desconhecida capitalizada, papel sem rótulo devolve a chave', () => {
    expect(kindLabel('purchase_order')).toBe('Compra');
    expect(kindLabel('contract_billing_event')).toBe('Liberação de faturamento');
    expect(kindLabel('qualquer')).toBe('Aprovação');
    expect(categoryLabel('compras')).toBe('Compras');
    expect(categoryLabel('logistica')).toBe('Logistica');
    expect(roleLabel('financeiro')).toBe('Financeiro');
    expect(roleLabel('papel_novo')).toBe('papel_novo');
    expect(roleLabel(null)).toBeNull();
    expect(ACTION_LABEL.REQUEST_ADJUSTMENT).toBe('Solicitar ajuste');
    expect(isSource('APPROVAL_ENGINE')).toBe(true);
    expect(isSource('OUTRA')).toBe(false);
  });
  it('a consequência é dita pelo domínio de origem — compra não tem rejeição terminal', () => {
    expect(actionConsequence('APPROVE', 'purchase_order')).toMatch(/Compras pode emiti-lo/);
    expect(actionConsequence('REQUEST_ADJUSTMENT', 'purchase_order')).toMatch(/volta ao rascunho/);
    expect(actionConsequence('REJECT', 'purchase_order')).toMatch(/só Compras pode cancelá-lo/);
    expect(actionConsequence('APPROVE', 'contract_billing_event')).toMatch(/faturamento fica liberado/);
  });
  it('os atos mapeiam para o vocabulário EXATO de cada fonte', () => {
    expect(ENGINE_DECISION).toEqual({ APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_ADJUSTMENT: 'RETURNED_FOR_CORRECTION' });
    // Alçada declarada: só APPROVE/REJECT existem em purchase_order_decide; "ajuste" é a devolução canônica.
    expect(AUTHORITY_DECISION).toEqual({ APPROVE: 'APPROVE', REQUEST_ADJUSTMENT: 'REJECT' });
    expect(AUTHORITY_DECISION.REJECT).toBeUndefined();
  });
});

describe('item de decisão', () => {
  it('normaliza a linha crua: valor numérico, datas curtas, atos copiados, autoridade com nomes', () => {
    const r = row({ amount: '182400.50', need_by: '2026-10-04', decide_by: '2026-09-30T00:00:00' });
    const i = toDecisionItem({ row: r, today, person, role: (id) => (id === 'role-fin' ? 'Financeiro' : null), projectName: () => 'SE Tucuruí' });
    expect(i.amount).toBe(182400.5);
    expect(i.needBy).toBe('2026-10-04');
    expect(i.decideBy).toBe('2026-09-30');
    expect(i.kindLabel).toBe('Compra');
    expect(i.projectName).toBe('SE Tucuruí');
    expect(i.requestedBy).toEqual({ id: 'buyer-1', name: 'Pessoa buye' });
    expect(i.status).toBe('PENDENTE');
    expect(i.sourceHref).toBe(`/supply/compras?stage=aprovacao&po=${PO}`);
    expect(i.actions).not.toBe(r.actions);
    expect(i.authority).toMatchObject({ kind: 'PROCUREMENT_AUTHORITY', granteeLabel: 'Financeiro', ceiling: 500000,
      sourceKindLabel: 'Ata de diretoria/conselho', sourceReference: 'ATA-QA-001', declaredBy: { id: 'owner-1' } });
    expect(i.critical).toBe(false);
  });
  it('autoridade de política: papel com rótulo, limite nulo, versão numérica', () => {
    const a = authorityFromRow(policyRaw());
    expect(a).toMatchObject({ kind: 'APPROVAL_POLICY', policyKey: 'procurement.po', policyVersionNo: 2, roleLabel: 'Financeiro',
      authorityLimit: null, stageCount: 2 });
  });
  it('sem teto declarado é NULL — nunca zero', () => {
    const a = authorityFromRow(authorityRaw({ ceiling: null }));
    expect(a.kind === 'PROCUREMENT_AUTHORITY' && a.ceiling).toBeNull();
  });
  it('crítico só com evidência: a razão vem de quem chamou', () => {
    const i = item({}, { reason: 'Requisito crítico: Cabo 35 mm' });
    expect(i.critical).toBe(true);
    expect(i.criticalReason).toBe('Requisito crítico: Cabo 35 mm');
    expect(i.priority).toEqual({ code: 'CRITICAL', label: 'Requisito crítico: Cabo 35 mm', tone: 'danger' });
  });
});

describe('ordem da fila', () => {
  it('prazo que manda: o mais cedo entre a expiração do motor e o decidir-até', () => {
    expect(effectiveDeadline({ dueAt: '2026-10-01T10:00:00Z', decideBy: '2026-09-28' })).toBe('2026-09-28');
    expect(effectiveDeadline({ dueAt: '2026-09-25T10:00:00Z', decideBy: '2026-09-28' })).toBe('2026-09-25');
    expect(effectiveDeadline({ dueAt: null, decideBy: null })).toBeNull();
  });
  it('razão da posição: vencida, crítica, prazo (hoje/amanhã/N dias), valor, normal', () => {
    expect(priorityReason({ overdue: true, critical: true, criticalReason: 'x', dueAt: null, decideBy: null, amount: 1 }, today).code).toBe('OVERDUE');
    expect(priorityReason({ overdue: false, critical: false, criticalReason: null, dueAt: null, decideBy: '2026-09-24', amount: 1 }, today).label).toBe('Decidir hoje');
    expect(priorityReason({ overdue: false, critical: false, criticalReason: null, dueAt: null, decideBy: '2026-09-25', amount: 1 }, today).label).toBe('Decidir até amanhã');
    expect(priorityReason({ overdue: false, critical: false, criticalReason: null, dueAt: null, decideBy: '2026-10-01', amount: 1 }, today))
      .toEqual({ code: 'DEADLINE', label: 'Decidir em 7 dias', tone: 'warning' });
    expect(priorityReason({ overdue: false, critical: false, criticalReason: null, dueAt: null, decideBy: '2026-10-02', amount: MATERIALITY_THRESHOLD }, today))
      .toEqual({ code: 'MATERIAL', label: 'Alto valor', tone: 'info' });
    expect(priorityReason({ overdue: false, critical: false, criticalReason: null, dueAt: null, decideBy: '2026-10-02', amount: 10 }, today))
      .toEqual({ code: 'NORMAL', label: 'Decidir em 8 dias', tone: 'neutral' });
    expect(priorityReason({ overdue: false, critical: false, criticalReason: null, dueAt: null, decideBy: null, amount: null }, today))
      .toEqual({ code: 'NORMAL', label: 'Pendente', tone: 'neutral' });
  });
  it('vencida > crítica > prazo > valor > normal, qualquer que seja a ordem de entrada', () => {
    const overdue = item({ decision_key: 'k-overdue', overdue: true, amount: 10 });
    const critical = item({ decision_key: 'k-critical', amount: 10 }, { reason: 'Sinal crítico da Apex: falta' });
    const deadline = item({ decision_key: 'k-deadline', decide_by: '2026-09-27', amount: 10 });
    const material = item({ decision_key: 'k-material', amount: 250000 });
    const normal = item({ decision_key: 'k-normal', amount: 10 });
    const order = prioritize([normal, material, deadline, critical, overdue]).map((i) => i.key);
    expect(order).toEqual(['k-overdue', 'k-critical', 'k-deadline', 'k-material', 'k-normal']);
    expect(prioritize([overdue, critical, deadline, material, normal]).map((i) => i.key)).toEqual(order);
  });
  it('empates: prazo mais cedo, depois maior valor, depois mais antiga, depois a chave', () => {
    const d1 = item({ decision_key: 'd-late', decide_by: '2026-09-29', amount: 10 });
    const d2 = item({ decision_key: 'd-early', decide_by: '2026-09-26', amount: 10 });
    expect(prioritize([d1, d2]).map((i) => i.key)).toEqual(['d-early', 'd-late']);
    const m1 = item({ decision_key: 'm-small', amount: 150000 });
    const m2 = item({ decision_key: 'm-big', amount: 900000 });
    expect(prioritize([m1, m2]).map((i) => i.key)).toEqual(['m-big', 'm-small']);
    const n1 = item({ decision_key: 'n-new', amount: 10, requested_at: '2026-09-23T10:00:00Z' });
    const n2 = item({ decision_key: 'n-old', amount: 10, requested_at: '2026-09-01T10:00:00Z' });
    expect(prioritize([n1, n2]).map((i) => i.key)).toEqual(['n-old', 'n-new']);
    const t1 = item({ decision_key: 'b', amount: 10 });
    const t2 = item({ decision_key: 'a', amount: 10 });
    expect(prioritize([t1, t2]).map((i) => i.key)).toEqual(['a', 'b']);
    // Normal COM prazo (> 7 dias) vem antes de normal sem prazo.
    const withDate = item({ decision_key: 'z-date', amount: 10, decide_by: '2026-11-30' });
    const noDate = item({ decision_key: 'a-nodate', amount: 10 });
    expect(prioritize([noDate, withDate]).map((i) => i.key)).toEqual(['z-date', 'a-nodate']);
  });
  it('não muta a lista de entrada', () => {
    const a = [item({ decision_key: 'x', amount: 10 }), item({ decision_key: 'w', overdue: true })];
    const copy = a.map((i) => i.key);
    prioritize(a);
    expect(a.map((i) => i.key)).toEqual(copy);
  });
});

describe('"por que chegou até mim?"', () => {
  it('alçada declarada: nomeia as alçadas menores que NÃO cobrem o valor, com o teto de cada uma', () => {
    const i = item({ amount: 182400 }, null);
    const why = whyFacts(i, fmt, [
      { label: 'Compras', ceiling: 50000, currency: 'BRL' },
      { label: 'Gestor', ceiling: 100000, currency: 'BRL' },
      { label: 'Sem teto', ceiling: null, currency: 'BRL' },
      { label: 'Diretoria', ceiling: 1000000, currency: 'BRL' },
    ]);
    expect(why.find((f) => f.label === 'Motivo')?.value).toBe('Valor acima da alçada de Compras (até BRL 50000), Gestor (até BRL 100000).');
    expect(why.find((f) => f.label === 'Origem')).toEqual({ label: 'Origem', value: 'Ata de diretoria/conselho — ATA-QA-001', source: 'procurement_approval_authorities' });
    expect(why.find((f) => f.label === 'Limite')?.value).toBe('Até BRL 500000');
    expect(why.find((f) => f.label === 'Sua autoridade')?.value).toBe('Alçada declarada');
  });
  it('sem alçada menor insuficiente: diz que o valor está dentro da sua — sem inventar outra', () => {
    const why = whyFacts(item({ amount: 1000 }), fmt, []);
    expect(why.find((f) => f.label === 'Motivo')?.value).toBe('A compra exige aprovação por alçada declarada, e o valor está dentro da sua.');
    expect(why.some((f) => f.label === 'Escalonamento' || f.label === 'Faixa')).toBe(false);
  });
  it('papel nomeado, sem teto e escopo aparecem como estão gravados', () => {
    const i = toDecisionItem({ row: row({ authority: authorityRaw({ ceiling: null, scope_category: 'Cabos', scope_project_id: 'proj-9' }) }),
      today, person, role: () => 'Financeiro' });
    const why = whyFacts(i, fmt);
    expect(why.find((f) => f.label === 'Sua autoridade')?.value).toBe('Papel: Financeiro');
    expect(why.find((f) => f.label === 'Limite')?.value).toBe('Sem teto declarado');
    expect(why.find((f) => f.label === 'Escopo')?.value).toBe('categoria Cabos · projeto proj-9');
  });
  it('escalada: venceu na faixa primária — com a data em que venceu', () => {
    const why = whyFacts(item({ assignment: 'ESCALATED', decide_by: '2026-09-14', overdue: true }), fmt);
    expect(why.find((f) => f.label === 'Escalonamento')?.value)
      .toBe('Venceu na faixa de alçada primária (decidir até 2026-09-14) e chegou à sua faixa.');
  });
  it('elegível: a decisão é de faixa menor, e você também pode decidir', () => {
    const why = whyFacts(item({ assignment: 'ELIGIBLE' }), fmt);
    expect(why.find((f) => f.label === 'Faixa')?.value).toBe('A decisão é de uma faixa de alçada menor; você também pode decidir.');
  });
  it('motor: política, versão, estágio (n de m) e a base da elegibilidade', () => {
    const i = item({ source_kind: 'APPROVAL_ENGINE', decision_key: `approval_request:${RQ}:e1`, authority: policyRaw() });
    const why = whyFacts(i, fmt, [{ label: 'Compras', ceiling: 1, currency: 'BRL' }]);
    expect(why.find((f) => f.label === 'Motivo')?.value).toBe('A política procurement.po v2 exige aprovação no estágio “Financeiro” (1 de 2).');
    expect(why.find((f) => f.label === 'Sua autoridade')?.value).toBe('Papel: Financeiro — etapa “Financeiro”');
    expect(why.find((f) => f.label === 'Limite')?.value).toBe('Sem teto na etapa');
    expect(why.find((f) => f.label === 'Origem')?.source).toBe('approval_request_steps');
    const named = whyFacts(item({ source_kind: 'APPROVAL_ENGINE', authority: policyRaw({ eligibility_mode: 'NAMED', stage_count: 1 }) }), fmt);
    expect(named.find((f) => f.label === 'Sua autoridade')?.value).toMatch(/^Aprovador nomeado na política/);
    expect(named.find((f) => f.label === 'Motivo')?.value).not.toMatch(/de 1\)/);
  });
});

const opt = (over: Partial<QuoteOption>): QuoteOption => ({
  quoteId: 'q', supplier: 'Fornecedor', landed: 100, currency: 'BRL', leadDays: 5, eta: '2026-09-29', lateDays: 0, chosen: false,
  recommended: false, cheapest: false, compliant: true, supplierOk: true, reliability: null, verdict: '', ...over,
});

describe('inteligência de compra — só com evidência', () => {
  it('a mais barata chega atrasada e a escolhida atende: custo a mais, com as duas propostas e a necessidade como evidência', () => {
    const facts = procurementImpact([
      opt({ quoteId: 'b', supplier: 'Elétrica Rápida', landed: 182400, chosen: true, lateDays: 0, leadDays: 3, eta: '2026-09-27' }),
      opt({ quoteId: 'a', supplier: 'Cabos Amazônia', landed: 171000, cheapest: true, lateDays: 6, leadDays: 12, eta: '2026-10-06' }),
    ], '2026-09-30', fmt);
    expect(facts).toHaveLength(1);
    expect(facts[0].tone).toBe('info');
    expect(facts[0].statement).toBe('Esta opção custa BRL 11400 a mais, mas atende o cronograma. O fornecedor mais barato entregaria 6 dias após a necessidade.');
    expect(facts[0].evidence.map((e) => e.label)).toEqual(['Elétrica Rápida (escolhido)', 'Cabos Amazônia (menor custo)', 'Necessário até']);
    expect(facts[0].evidence[2]).toEqual({ label: 'Necessário até', value: '2026-09-30', source: 'project_requirements' });
  });
  it('um dia de atraso no singular', () => {
    const [f] = procurementImpact([opt({ quoteId: 'b', landed: 200, chosen: true }), opt({ quoteId: 'a', landed: 100, lateDays: 1 })], '2026-09-30', fmt);
    expect(f.statement).toMatch(/entregaria 1 dia após/);
  });
  it('a escolhida chega atrasada: diz o atraso mesmo aprovando hoje, com a chegada estimada', () => {
    const facts = procurementImpact([opt({ quoteId: 'b', landed: 100, chosen: true, lateDays: 4, eta: '2026-10-04' }),
      opt({ quoteId: 'c', landed: 300, lateDays: 0 })], '2026-09-30', fmt);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ tone: 'danger', statement: 'Mesmo aprovado hoje, o fornecedor escolhido chega 4 dias após a necessidade.' });
    expect(facts[0].evidence).toEqual([
      { label: 'Chegada estimada', value: '2026-10-04', source: 'supplier_quotes.lead_time_days' },
      { label: 'Necessário até', value: '2026-09-30', source: 'project_requirements' },
    ]);
  });
  it('mais cara que outra que também atende: alerta de custo, sem dizer que a outra atrasa', () => {
    const facts = procurementImpact([opt({ quoteId: 'b', landed: 300, chosen: true }), opt({ quoteId: 'a', landed: 100, lateDays: 0 })], '2026-09-30', fmt);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ tone: 'warning', statement: 'Esta opção custa BRL 200 a mais que a de menor custo, que também atende o cronograma.' });
  });
  it('proposta única: diz que não há comparação — e nada mais', () => {
    expect(procurementImpact([opt({ quoteId: 'b', chosen: true })], '2026-09-30', fmt))
      .toEqual([{ tone: 'neutral', statement: 'A decisão de compra teve uma única proposta; não há comparação de fornecedores.', evidence: [] }]);
  });
  it('sem escolhida, nenhuma frase', () => {
    expect(procurementImpact([opt({ quoteId: 'a' }), opt({ quoteId: 'b', landed: 50 })], '2026-09-30', fmt)).toEqual([]);
  });
  it('sem necessidade registrada: nenhuma frase de prazo e nenhuma evidência de necessidade', () => {
    const facts = procurementImpact([opt({ quoteId: 'b', landed: 300, chosen: true, lateDays: null }), opt({ quoteId: 'a', landed: 100, lateDays: null })], null, fmt);
    expect(facts.map((f) => f.statement).join(' ')).not.toMatch(/cronograma|necessidade/);
    expect(facts.flatMap((f) => f.evidence).some((e) => e.label === 'Necessário até')).toBe(false);
    expect(facts[0].statement).toBe('Esta opção custa BRL 200 a mais que a de menor custo, que também foi avaliada.');
  });
  it('moedas diferentes não se comparam (sem conversão inventada)', () => {
    expect(procurementImpact([opt({ quoteId: 'b', landed: 300, chosen: true }), opt({ quoteId: 'a', landed: 100, currency: 'USD', lateDays: 9 })], '2026-09-30', fmt)).toEqual([]);
  });
  it('escolhida é a mais barata e atende: nada a explicar', () => {
    expect(procurementImpact([opt({ quoteId: 'b', landed: 100, chosen: true }), opt({ quoteId: 'a', landed: 300 })], '2026-09-30', fmt)).toEqual([]);
  });
  // Atraso DESCONHECIDO da escolhida (sem prazo informado) não vira "atende o cronograma".
  it('escolhida sem prazo informado NÃO é dita "atende o cronograma"', () => {
    const facts = procurementImpact([opt({ quoteId: 'b', landed: 300, chosen: true, eta: null, lateDays: null }),
      opt({ quoteId: 'a', landed: 100, lateDays: 5 })], '2026-09-30', fmt);
    expect(facts.map((f) => f.statement).join(' ')).not.toMatch(/atende o cronograma/);
  });
});

describe('recusas do motor, justificativa e idempotência', () => {
  it.each([
    'Pedido já está em APPROVED; não aceita nova decisão.',
    'A etapa "fin" já está em APPROVED e não decide de novo.',
    'Pedido expirado em 2026-09-20 10:00:00+00; não aceita decisão.',
    'SUBJECT_CHANGED: a tela decidia outro conteúdo.',
    'Ordem de aprovação: a etapa "dir" está no estágio 2 e o pedido está no estágio 1.',
    'Etapa inexistente.',
    'O objeto do pedido não existe mais; a decisão fica sem sujeito.',
  ])('tela velha: %s', (message) => {
    expect(isStaleEngineMessage(message)).toBe(true);
  });
  it.each([
    'SOD_REQUESTER: Você solicitou esta aprovação.',
    'Rejeitar ou devolver a etapa "fin" exige justificativa.',
    'Decisão exige identidade autenticada. Sistema e IA não decidem.',
    '', null, undefined,
  ])('não é tela velha: %s', (message) => {
    expect(isStaleEngineMessage(message as string | null | undefined)).toBe(false);
  });
  it('mensagem de tela velha diz o que valeu, e quem', () => {
    expect(staleMessage(null)).toMatch(/mudou desde que a tela foi aberta/);
    expect(staleMessage({ status: 'APROVADA', closedBy: { id: 'u', name: 'Fernanda' } })).toBe('Esta decisão já foi aprovada por Fernanda. Nada foi alterado.');
    expect(staleMessage({ status: 'APROVADA', closedBy: { id: 'u', name: null } })).toBe('Esta decisão já foi aprovada. Nada foi alterado.');
    expect(staleMessage({ status: 'REJEITADA', closedBy: null })).toBe('Esta decisão já foi rejeitada. Nada foi alterado.');
    expect(staleMessage({ status: 'AJUSTE_SOLICITADO', closedBy: { id: 'u', name: 'Ana' } })).toBe('Um ajuste já foi solicitado por Ana. Nada foi alterado.');
    expect(staleMessage({ status: 'CANCELADA', closedBy: null })).toMatch(/cancelada na origem/);
    expect(staleMessage({ status: 'EXPIRADA', closedBy: null })).toMatch(/prazo desta decisão expirou/);
    expect(staleMessage({ status: 'PENDENTE', closedBy: null })).toMatch(/nova submissão ou valor diferente/);
  });
  it('justificativa normalizada como o motor grava (trim; vazio → nulo)', () => {
    expect(normalizeReason('  Frete acima do contratado  ')).toBe('Frete acima do contratado');
    expect(normalizeReason('   ')).toBeNull();
    expect(normalizeReason('')).toBeNull();
    expect(normalizeReason(null)).toBeNull();
    expect(normalizeReason(undefined)).toBeNull();
    expect(normalizeReason('\n\tok\n')).toBe('ok');
  });
  it('chave de idempotência do motor: por ator, etapa, ato e intenção — nunca a mesma entre pessoas', () => {
    const a = engineIdempotencyKey('req-1', 1, 'user-a', 'APPROVE', 'intent-12345');
    const b = engineIdempotencyKey('req-1', 1, 'user-b', 'APPROVE', 'intent-12345');
    expect(a).not.toBe(b);
    expect(engineIdempotencyKey('req-1', 1, 'user-a', 'REJECT', 'intent-12345')).not.toBe(a);
    expect(engineIdempotencyKey('req-1', 1, 'user-a', 'APPROVE', 'intent-99999')).not.toBe(a);
    expect(engineIdempotencyKey('req-1', 1, 'user-a', 'APPROVE', 'intent-12345')).toBe(a);
    // Presa à DECISÃO (pedido + estágio), não à etapa: a retentativa que enxergar a etapa irmã usa a MESMA chave.
    expect(a).toBe('dec:req-1:e1:user-a:APPROVE:intent-12345');
    expect(engineIdempotencyKey('req-1', 2, 'user-a', 'APPROVE', 'intent-12345')).not.toBe(a);
    expect(engineIdempotencyKey('r'.repeat(150), 1, 'u'.repeat(150), 'APPROVE', 'i'.repeat(80)).length).toBe(200);
  });
});

describe('link de origem', () => {
  it('compra aberta cai na aprovação; encerrada, no pedido — com o id codificado', () => {
    expect(sourceLink('purchase_order', PO, true)).toEqual({ href: `/supply/compras?stage=aprovacao&po=${PO}`, label: 'Ver em Compras' });
    expect(sourceLink('purchase_order', PO, false)).toEqual({ href: `/supply/compras?stage=pedidos&po=${PO}`, label: 'Ver em Compras' });
    expect(sourceLink('purchase_order', 'a&b', true).href).toBe('/supply/compras?stage=aprovacao&po=a%26b');
  });
  it('faturamento cai em Contratos; o resto, em Decisões', () => {
    expect(sourceLink('contract_billing_event', 'ev-1', true)).toEqual({ href: '/contratos?aba=faturamento&evento=ev-1', label: 'Ver em Contratos' });
    expect(sourceLink('outro', 'x', true)).toEqual({ href: '/decisoes', label: 'Ver origem' });
  });
});
