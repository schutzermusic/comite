/**
 * DECISÕES — o servidor (read.ts, detail-procurement.ts, act.ts):
 *  • cartão: contexto só com dado que existe; "crítico" só com evidência;
 *  • Equipe: gargalo por dono, sem decisor agrupado, valor sem somar moedas;
 *  • comparação: a de Compras, com "menor custo" na mesma moeda; cadeia sem elo inventado;
 *  • ato: o MESMO canônico da origem — alçada pelo invólucro (service role, ator =
 *    sessão), motor pela SESSÃO; tela velha é 409; eco do próprio ato é idempotente;
 *    desfecho final do motor reflete a jusante na hora, e falha a jusante não vira erro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  viewerInboxRow: vi.fn(),
  readResolved: vi.fn(),
  governedRpc: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  subjectStatus: 'APPROVED' as string | null,
}));

vi.mock('@/lib/decisions/read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/decisions/read')>()),
  viewerInboxRow: m.viewerInboxRow,
  readResolved: m.readResolved,
}));
vi.mock('@/lib/platform/governed-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/governed-rpc')>()),
  governedRpc: m.governedRpc,
}));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: m.audit }));
vi.mock('@/lib/decisions/notify', () => ({ scheduleDecisionNotify: m.notify, scheduleSubjectNotify: vi.fn() }));
vi.mock('@/lib/platform/server-client', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['from', 'select', 'eq', 'in', 'is']) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: m.subjectStatus === null ? null : { status: m.subjectStatus, release_state: m.subjectStatus }, error: null });
  return { platformServiceClient: () => chain };
});

import {
  accessWhy, aggregateBottlenecks, categoryCounts, channelStatusList, criticalEvidence, deliverySummary, engineHistory, isDecisionsTab,
  needSummary, policyAuthoritySummary, procurementAuthoritySummary, purchaseOrderContext, sortTeamItems, toCompletedItem, toResolved,
  toTeamItem, waitingDays, type DecisionHistoryRow, type DecisionTeamRow,
} from '@/lib/decisions/read';
import {
  purchaseChain, purchaseOrderHistoryEntry, quoteLeadDays, quoteOptions, quoteVerdict, requirementNeed,
} from '@/lib/decisions/detail-procurement';
import {
  actMessage, actOnDecision, auditActionFor, decisionActSchema, engineFailure, noticeFor, replayOf,
} from '@/lib/decisions/act';
import { GovernedRpcError } from '@/lib/platform/governed-rpc';
import type { DecisionInboxRow, PersonRef, ResolvedDecision, TeamItem } from '@/lib/decisions/types';
import type { QuoteEvaluation } from '@/lib/supply/procurement';

const PO = '11111111-1111-4111-8111-111111111111';
const RQ = '22222222-2222-4222-8222-222222222222';
const STEP = '33333333-3333-4333-8333-333333333333';
const ME = 'user-me';
const today = '2026-09-24';
const person = (id: string | null): PersonRef | null => (id ? { id, name: `Nome ${id}` } : null);
const project = (id: string | null) => (id ? `Projeto ${id}` : null);

// ---------------------------------------------------------------------------
// Cartão
// ---------------------------------------------------------------------------

describe('cartão de compra', () => {
  it('necessidade: a linha de maior valor, com unidade, e quantas mais existem', () => {
    expect(needSummary([{ quantity: 400, unit: 'm', code: 'CB-35', description: 'Cabo 35 mm', value: 182400 }])).toBe('400 m · Cabo 35 mm');
    expect(needSummary([
      { quantity: 10, unit: 'un', code: 'CX', description: 'Caixa', value: 100 },
      { quantity: 1200.5, unit: 'm', code: 'CB', description: 'Cabo 35 mm', value: 50000 },
      { quantity: 3, unit: null, code: 'TR', description: null, value: 900 },
    ])).toBe('1.200,5 m · Cabo 35 mm +2 itens');
    expect(needSummary([{ quantity: 2, unit: null, code: 'TR', description: null, value: 1 }, { quantity: 1, unit: 'un', code: 'X', description: 'Y', value: 0 }]))
      .toBe('2 · TR +1 item');
    expect(needSummary([])).toBeNull();
  });
  it('contexto na ordem do produto; "recomendado" só quando a escolha seguiu a recomendação', () => {
    const lines = purchaseOrderContext({ project: 'SE Tucuruí', supplier: 'Elétrica Rápida Norte', followsRecommendation: true,
      need: '400 m · Cabo 35 mm', needBy: '2026-10-04', decideBy: '2026-09-30', requestedBy: 'Carla Compras' });
    expect(lines.map((l) => l.label)).toEqual(['Projeto', 'Fornecedor recomendado', 'Necessidade', 'Necessário até', 'Decidir até', 'Solicitado por']);
    expect(lines[1]).toEqual({ label: 'Fornecedor recomendado', value: 'Elétrica Rápida Norte', emphasis: true });
    expect(lines[3].value).toBe('04/10/2026');
    const other = purchaseOrderContext({ project: null, supplier: 'B', followsRecommendation: false, need: null, needBy: '2026-10-04',
      decideBy: '2026-10-04', requestedBy: null });
    expect(other.map((l) => l.label)).toEqual(['Fornecedor escolhido', 'Necessário até']);
    expect(purchaseOrderContext({ project: null, supplier: 'B', followsRecommendation: null, need: null, needBy: null, decideBy: null, requestedBy: null })[0].label)
      .toBe('Fornecedor escolhido');
  });
  it('crítico só com evidência gravada, nomeando a evidência', () => {
    expect(criticalEvidence([{ title: 'Cabo da SE', priority: 'critical', status: 'CONFIRMED' }], [])).toEqual({ reason: 'Requisito crítico: Cabo da SE' });
    expect(criticalEvidence([{ title: 'Cancelado', priority: 'critical', status: 'CANCELLED' }, { title: 'Normal', priority: 'high', status: 'CONFIRMED' }], []))
      .toBeNull();
    expect(criticalEvidence([], [{ title: 'Falta de cabo', severity: 'critical', status: 'OPEN' }])).toEqual({ reason: 'Sinal crítico da Apex: Falta de cabo' });
    expect(criticalEvidence([], [{ title: 'x', severity: 'critical', status: 'DISMISSED' }, { title: 'y', severity: 'high', status: 'OPEN' }])).toBeNull();
    expect(criticalEvidence([{ title: 'Req', priority: 'critical' }], [{ title: 'Sinal', severity: 'critical', status: 'OPEN' }])?.reason).toMatch(/^Requisito/);
  });
});

// ---------------------------------------------------------------------------
// Equipe e Concluídas
// ---------------------------------------------------------------------------

const teamRow = (over: Partial<DecisionTeamRow> = {}): DecisionTeamRow => ({
  decision_key: `purchase_order:${PO}:s1`, source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order',
  subject_id: PO, title: 'Pedido OC-1', amount: '1000', currency: 'BRL', amount_restricted: false, project_id: 'p1', requested_by: 'buyer',
  requested_at: '2026-09-20T12:00:00Z', due_at: null, need_by: null, decide_by: null, overdue: false, state: 'PENDENTE',
  assignees: [{ user_id: 'fin', assignment: 'PRIMARY' }], ...over,
});
const team = (over: Partial<DecisionTeamRow> = {}): TeamItem => toTeamItem(teamRow(over), { person, project }, today);

describe('Equipe', () => {
  it('espera em dias de calendário de São Paulo', () => {
    expect(waitingDays('2026-09-20T12:00:00Z', today)).toBe(4);
    // 02:00 UTC do dia 24 ainda é dia 23 em São Paulo.
    expect(waitingDays('2026-09-24T02:00:00Z', today)).toBe(1);
    expect(waitingDays(null, today)).toBeNull();
    expect(waitingDays('não é data', today)).toBeNull();
  });
  it('valor restrito é nulo e marcado — nunca zero', () => {
    const t = team({ amount: null, amount_restricted: true });
    expect(t.amount).toBeNull();
    expect(t.amountRestricted).toBe(true);
    expect(t.owners).toEqual([{ id: 'fin', name: 'Nome fin', assignment: 'PRIMARY' }]);
    expect(t.status).toBe('PENDENTE');
    expect(t.kindLabel).toBe('Compra');
    expect(t.waitingDays).toBe(4);
  });
  it('gargalos por dono; elegível não é gargalo; sem dono vira "sem decisor"; ordem: vencidas, abertas, espera', () => {
    const items = [
      team({ decision_key: 'a', overdue: true, amount: '100', assignees: [{ user_id: 'fin', assignment: 'PRIMARY' }, { user_id: 'dir', assignment: 'ELIGIBLE' }] }),
      team({ decision_key: 'b', amount: '50', requested_at: '2026-09-01T12:00:00Z', assignees: [{ user_id: 'fin', assignment: 'PRIMARY' }] }),
      team({ decision_key: 'c', state: 'SEM_DECISOR', amount: '999', assignees: [] }),
      team({ decision_key: 'd', amount: null, amount_restricted: true, assignees: [{ user_id: 'dir', assignment: 'ESCALATED' }] }),
      team({ decision_key: 'e', assignees: [{ user_id: 'dir', assignment: 'ESCALATED' }], requested_at: '2026-08-01T12:00:00Z', amount: '10' }),
    ];
    const b = aggregateBottlenecks(items);
    expect(b.map((x) => x.owner?.id ?? null)).toEqual(['fin', 'dir', null]);
    expect(b[0]).toEqual({ owner: { id: 'fin', name: 'Nome fin' }, open: 2, overdue: 1, oldestWaitingDays: 23, amount: 150 });
    // O restrito não entra na soma — mas conta como aberto.
    expect(b[1]).toMatchObject({ open: 2, overdue: 0, amount: 10, oldestWaitingDays: 54 });
    expect(b[2]).toEqual({ owner: null, open: 1, overdue: 0, oldestWaitingDays: 4, amount: 999 });
  });
  it('valores em moedas diferentes não se somam', () => {
    const b = aggregateBottlenecks([team({ decision_key: 'x', amount: '10' }), team({ decision_key: 'y', amount: '20', currency: 'USD' })]);
    expect(b[0].amount).toBeNull();
    expect(b[0].open).toBe(2);
  });
  it('dono repetido na mesma decisão conta uma vez', () => {
    const b = aggregateBottlenecks([team({ assignees: [{ user_id: 'fin', assignment: 'PRIMARY' }, { user_id: 'fin', assignment: 'ESCALATED' }] })]);
    expect(b).toHaveLength(1);
    expect(b[0].open).toBe(1);
  });
  it('fila da equipe: vencidas, sem decisor, espera mais longa', () => {
    const order = sortTeamItems([
      team({ decision_key: 'new', requested_at: '2026-09-23T12:00:00Z' }),
      team({ decision_key: 'orphan', state: 'SEM_DECISOR', assignees: [] }),
      team({ decision_key: 'late', overdue: true }),
      team({ decision_key: 'old', requested_at: '2026-08-01T12:00:00Z' }),
    ]).map((t) => t.key);
    expect(order).toEqual(['late', 'orphan', 'old', 'new']);
  });
});

const historyRow = (over: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow => ({
  decision_key: `purchase_order:${PO}:s1`, source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order',
  subject_id: PO, title: 'Pedido OC-1', amount: '478500', currency: 'BRL', project_id: 'p1', viewer_role: 'DECIDER', outcome: 'APPROVED',
  decided_by: ME, decided_at: '2026-09-24T20:00:00Z', requested_by: 'buyer', requested_at: '2026-09-24T18:00:00Z', reason: 'Dentro da alçada',
  authority: { kind: 'PROCUREMENT_AUTHORITY', authority_id: 'auth-1' }, record_id: 'hist-1', ...over,
});

describe('Concluídas', () => {
  it('alçada declarada: a evidência que autorizou, com teto (ou sem teto)', () => {
    expect(procurementAuthoritySummary({ source_kind: 'BOARD_RESOLUTION', source_reference: 'ATA-QA-001', max_amount: '500000', currency: 'BRL' }))
      .toMatch(/^Alçada declarada — Ata de diretoria\/conselho ATA-QA-001 \(até R\$\s500\.000,00\)$/);
    expect(procurementAuthoritySummary({ source_kind: 'POWER_OF_ATTORNEY', source_reference: 'PROC-7', max_amount: null, currency: 'BRL' }))
      .toBe('Alçada declarada — Procuração PROC-7 (sem teto)');
  });
  it('motor: política, versão e base', () => {
    expect(policyAuthoritySummary({ policy_key: 'procurement.po', policy_version_no: 3, authority_basis: 'role:financeiro' }))
      .toBe('Política procurement.po v3 — role:financeiro');
    expect(policyAuthoritySummary({ policy_key: 'procurement.po', policy_version_no: 1 })).toBe('Política procurement.po v1');
    expect(policyAuthoritySummary(null)).toBeNull();
  });
  it('item concluído: desfecho, quem decidiu, autoridade e link para o registro encerrado', () => {
    const auth = new Map([['auth-1', { source_kind: 'BOARD_RESOLUTION', source_reference: 'ATA-QA-001', max_amount: 500000, currency: 'BRL' }]]);
    const c = toCompletedItem(historyRow(), { person, project }, auth);
    expect(c).toMatchObject({ status: 'APROVADA', outcome: 'APPROVED', viewerRole: 'DECIDER', amount: 478500, decidedBy: { id: ME },
      projectName: 'Projeto p1', recordId: 'hist-1', sourceHref: `/supply/compras?stage=pedidos&po=${PO}` });
    expect(c.authoritySummary).toMatch(/ATA-QA-001/);
    // Devolução por alçada não consome alçada: sem registro, sem frase inventada.
    expect(toCompletedItem(historyRow({ outcome: 'ADJUSTMENT_REQUESTED', authority: { kind: 'PROCUREMENT_AUTHORITY', authority_id: null } }),
      { person, project }, auth)).toMatchObject({ status: 'AJUSTE_SOLICITADO', authoritySummary: null });
    const engine = toCompletedItem(historyRow({ source_kind: 'APPROVAL_ENGINE', outcome: 'REJECTED',
      authority: { kind: 'APPROVAL_POLICY', policy_key: 'procurement.po', policy_version_no: 1, authority_basis: 'role:financeiro' } }), { person, project }, auth);
    expect(engine).toMatchObject({ status: 'REJEITADA', authoritySummary: 'Política procurement.po v1 — role:financeiro' });
  });
  it('categorias com rótulo, mais numerosa primeiro', () => {
    expect(categoryCounts([{ category: 'financeiro' }, { category: 'compras' }, { category: 'compras' }]))
      .toEqual([{ id: 'compras', label: 'Compras', count: 2 }, { id: 'financeiro', label: 'Financeiro', count: 1 }]);
    expect(isDecisionsTab('equipe')).toBe(true);
    expect(isDecisionsTab('todas')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

describe('decisão resolvida', () => {
  it('aberta: o estado vem da caixa; encerrada: do desfecho, com quem encerrou', () => {
    const raw = { decision_key: `purchase_order:${PO}:s1`, source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order',
      subject_id: PO, title: 'Pedido', amount: 478500.0, currency: 'BRL', project_id: 'p1', open: true, outcome: null, closed_by: null,
      requested_by: 'buyer', requested_at: '2026-09-24T18:45:17+00:00', request_note: 'Emissão conforme cotação', fingerprint: 'fp', submission: 1 };
    expect(toResolved(raw, person, 'ESCALADA')).toMatchObject({ open: true, status: 'ESCALADA', submission: 1, requestNote: 'Emissão conforme cotação',
      requestedBy: { id: 'buyer' }, closedBy: null, requestId: null });
    expect(toResolved(raw, person).status).toBe('PENDENTE');
    const closed = toResolved({ ...raw, open: false, outcome: 'ADJUSTMENT_REQUESTED', closed_by: 'fin', closed_at: '2026-09-24T20:00:00Z', reason: 'Frete' },
      person, 'PENDENTE');
    expect(closed).toMatchObject({ open: false, status: 'AJUSTE_SOLICITADO', closedBy: { id: 'fin', name: 'Nome fin' }, reason: 'Frete' });
  });
  it('livro de entrega da pessoa em português, com o motivo do "não enviado"', () => {
    expect(deliverySummary({ channel: 'in_app', notice_kind: 'NEW', state: 'DELIVERED', delivered_at: '2026-09-24T20:00:01Z', sent_at: '2026-09-24T20:00:00Z' }))
      .toEqual({ channel: 'in_app', noticeKind: 'NEW', state: 'DELIVERED', stateLabel: 'Entregue', at: '2026-09-24T20:00:01Z', detail: null });
    expect(deliverySummary({ channel: 'whatsapp', notice_kind: 'NEW', state: 'NOT_CONFIGURED', failure_code: 'CHANNEL_NOT_CONFIGURED', created_at: 't' }))
      .toMatchObject({ stateLabel: 'WhatsApp não configurado', detail: 'Canal não configurado pela organização.', at: 't' });
    expect(deliverySummary({ channel: 'email', notice_kind: 'NEW', state: 'SKIPPED', failure_code: 'USER_OPTED_OUT' }).detail)
      .toBe('Você optou por não receber por este canal.');
    expect(deliverySummary({ channel: 'email', notice_kind: 'NEW', state: 'SIMULATED' }).stateLabel).toBe('Simulado (sem provedor de e-mail)');
    expect(deliverySummary({ channel: 'email', notice_kind: 'NEW', state: 'FAILED', failure_reason: 'timeout' })).toMatchObject({
      stateLabel: 'Falhou — nova tentativa agendada', detail: 'timeout' });
    for (const [state, label] of [['SENT', 'Enviado'], ['DEAD', 'Falhou definitivamente'], ['CANCELLED', 'Cancelado (decisão encerrada)'],
      ['PENDING', 'Na fila'], ['SKIPPED', 'Não enviado (preferência/canal)']]) {
      expect(deliverySummary({ channel: 'email', notice_kind: 'NEW', state }).stateLabel).toBe(label);
    }
  });
  it('quem só lê: por que pode ver, e que ver não é decidir', () => {
    expect(accessWhy('SOURCE_READER', true)[0].value).toMatch(/não está sob a sua alçada/);
    expect(accessWhy('TEAM', true)[0].value).toMatch(/Ver não dá direito de decidir/);
  });
  it('histórico do motor: decisões de etapa com ator; pedido aberto só quando o objeto não tem histórico próprio', () => {
    const decisions = [{ decided_at: '2026-09-24T20:00:00Z', decision: 'RETURNED_FOR_CORRECTION', stage_no: 1, step_key: 'fin', actor_user_id: 'fin', reason: 'Frete' }];
    const po = engineHistory({ subject_type: 'purchase_order', requested_at: 'x' }, decisions, person);
    expect(po).toEqual([{ at: '2026-09-24T20:00:00Z', label: 'Ajuste solicitado — estágio 1 (fin)', actor: { id: 'fin', name: 'Nome fin' }, detail: 'Frete' }]);
    const billing = engineHistory({ subject_type: 'contract_billing_event', requested_at: '2026-09-20T10:00:00Z', requested_by: 'fin2', request_note: null }, [], person);
    expect(billing[0]).toMatchObject({ label: 'Aprovação solicitada ao motor', actor: { id: 'fin2' } });
  });
});

describe('canais', () => {
  const none = { state: 'NOT_CONFIGURED', provider: null };
  it('in-app sempre ativo; e-mail pelo transporte da plataforma; WhatsApp sem linha = não configurado', () => {
    const [inApp, email, wa] = channelStatusList({ emailIntegration: null, emailTransport: 'none', whatsapp: none, prefs: [] });
    expect(inApp).toMatchObject({ channel: 'in_app', status: 'ACTIVE', viewerOptIn: null });
    expect(email).toMatchObject({ channel: 'email', status: 'SIMULATED', viewerOptIn: true });
    expect(wa).toMatchObject({ channel: 'whatsapp', status: 'NOT_CONFIGURED', viewerOptIn: false });
    expect(channelStatusList({ emailIntegration: null, emailTransport: 'resend', whatsapp: none, prefs: [] })[1]).toMatchObject({ status: 'ACTIVE', provider: 'resend' });
    expect(channelStatusList({ emailIntegration: null, emailTransport: 'capture', whatsapp: none, prefs: [] })[1]).toMatchObject({ status: 'ACTIVE', provider: 'capture' });
  });
  it('organização desliga o e-mail; a pessoa opta por não receber; WhatsApp exige opt-in COM número', () => {
    const list = channelStatusList({ emailIntegration: { status: 'DISABLED', provider: 'resend' }, emailTransport: 'resend',
      whatsapp: { state: 'READY', provider: 'fake' },
      prefs: [{ channel: 'email', enabled: false, destination: null }, { channel: 'whatsapp', enabled: true, destination: '+5591999990000' }] });
    expect(list[1]).toMatchObject({ status: 'DISABLED', viewerOptIn: false });
    expect(list[2]).toMatchObject({ status: 'ACTIVE', provider: 'fake', viewerOptIn: true });
    const noNumber = channelStatusList({ emailIntegration: null, emailTransport: 'none', whatsapp: { state: 'READY', provider: 'fake' },
      prefs: [{ channel: 'whatsapp', enabled: true, destination: null }] });
    expect(noNumber[2].viewerOptIn).toBe(false);
  });
  it('linha ligada sem provedor pronto NÃO é canal ativo', () => {
    for (const state of ['PROVIDER_NOT_IMPLEMENTED', 'PROVIDER_UNAVAILABLE', 'CREDENTIALS_MISSING']) {
      const wa = channelStatusList({ emailIntegration: null, emailTransport: 'none', whatsapp: { state, provider: 'twilio' }, prefs: [] })[2];
      expect(wa.status).toBe('NOT_CONFIGURED');
      expect(wa.detail).toMatch(/nenhuma mensagem sai/);
    }
    expect(channelStatusList({ emailIntegration: null, emailTransport: 'none', whatsapp: { state: 'DISABLED', provider: 'fake' }, prefs: [] })[2].status)
      .toBe('DISABLED');
  });
});

// ---------------------------------------------------------------------------
// Comparação e cadeia
// ---------------------------------------------------------------------------

const evaluation = (over: Partial<QuoteEvaluation>): QuoteEvaluation => ({
  quoteId: 'q', supplier: 'F', goods: 100, landed: 100, currency: 'BRL', eta: '2026-09-27', lateDays: 0, complete: true, compliant: true,
  expired: false, supplierOk: true, eligible: true, reliability: null, flags: [], ...over,
});

describe('comparação de propostas', () => {
  it('prazo da proposta: o maior entre cabeçalho e linhas; sem nenhum, desconhecido', () => {
    expect(quoteLeadDays({ leadTimeDays: 5, lines: [{ rfqLineId: 'l', unitPrice: 1, quantity: 1, leadTimeDays: 9, compliant: true }] })).toBe(9);
    expect(quoteLeadDays({ leadTimeDays: null, lines: [{ rfqLineId: 'l', unitPrice: 1, quantity: 1, leadTimeDays: null, compliant: true }] })).toBeNull();
    expect(quoteLeadDays({ leadTimeDays: 0, lines: [] })).toBe(0);
  });
  it('veredito: atende, atraso (singular/plural), sem prazo, sem necessidade — frases diferentes', () => {
    expect(quoteVerdict('2026-09-27', 0)).toBe('Atende o cronograma');
    expect(quoteVerdict('2026-10-06', 9)).toBe('Chega 9 dias após a necessidade');
    expect(quoteVerdict('2026-10-01', 1)).toBe('Chega 1 dia após a necessidade');
    expect(quoteVerdict(null, null)).toBe('Sem prazo informado');
    expect(quoteVerdict('2026-10-01', null)).toBe('Sem data de necessidade para comparar');
  });
  it('escolhida primeiro; recomendada e menor custo marcadas; menor custo só na moeda da escolhida', () => {
    const options = quoteOptions([
      evaluation({ quoteId: 'a', supplier: 'Cabos Amazônia', landed: 171000, lateDays: 6, eta: '2026-10-06' }),
      evaluation({ quoteId: 'b', supplier: 'Elétrica Rápida', landed: 182400 }),
      evaluation({ quoteId: 'u', supplier: 'Importado', landed: 90000, currency: 'USD' }),
    ], [{ id: 'a', leadTimeDays: 12, lines: [] }, { id: 'b', leadTimeDays: 3, lines: [] }], { chosenId: 'b', recommendedId: 'b' });
    expect(options.map((o) => o.quoteId)).toEqual(['b', 'u', 'a']);
    expect(options[0]).toMatchObject({ chosen: true, recommended: true, cheapest: false, leadDays: 3, verdict: 'Atende o cronograma' });
    expect(options.find((o) => o.quoteId === 'a')).toMatchObject({ cheapest: true, chosen: false, lateDays: 6, verdict: 'Chega 6 dias após a necessidade' });
    expect(options.find((o) => o.quoteId === 'u')).toMatchObject({ cheapest: false, leadDays: null });
  });
  it('necessidade de um requisito: o que vier antes entre a data e o início da atividade', () => {
    expect(requirementNeed('2026-10-10', '2026-10-04')).toBe('2026-10-04');
    expect(requirementNeed('2026-10-01', '2026-10-04')).toBe('2026-10-01');
    expect(requirementNeed(null, '2026-10-04T00:00:00')).toBe('2026-10-04');
    expect(requirementNeed(null, null)).toBeNull();
  });
  it('histórico do pedido: o ato da alçada é "ajuste solicitado"; o do motor diz que é do motor', () => {
    const human = purchaseOrderHistoryEntry({ transition: 'rejected', reason: 'Frete', detail: {}, actor_user_id: 'fin', actor_source: 'human', occurred_at: 't' }, person);
    expect(human).toEqual({ at: 't', label: 'Ajuste solicitado — devolvido ao rascunho', actor: { id: 'fin', name: 'Nome fin' }, detail: 'Frete' });
    const system = purchaseOrderHistoryEntry({ transition: 'rejected', reason: null, detail: { outcome: 'REJECTED' }, actor_user_id: 'fin',
      actor_source: 'system', occurred_at: 't' }, person);
    expect(system).toEqual({ at: 't', label: 'Devolvido ao rascunho pelo motor de aprovação (rejeição)', actor: null, detail: 'Aplicado pelo motor de aprovação' });
    expect(purchaseOrderHistoryEntry({ transition: 'submitted', reason: 'Nota', detail: null, actor_user_id: 'buyer', actor_source: 'human',
      occurred_at: 't' }, person).label).toBe('Submetido à aprovação');
  });
  it('cadeia: seis elos na ordem, e o que não tem registro é AUSENTE — nunca inventado', () => {
    const empty = purchaseChain({ supplier: null, material: null, activity: null, milestone: null, measurement: null, billing: null });
    expect(empty.map((n) => n.label)).toEqual(['Fornecedor', 'Material', 'Atividade', 'Marco', 'Medição', 'Faturamento']);
    expect(empty.every((n) => n.missing === true && n.detail === 'sem vínculo registrado' && !n.href)).toBe(true);
    const full = purchaseChain({
      supplier: { id: 'sup', name: 'Elétrica Rápida' }, material: { itemId: 'it', code: 'CB-35', description: 'Cabo 35 mm' },
      activity: { id: 'act', projectId: 'p 1', title: 'Lançamento de cabos', plannedStart: '2026-10-04' },
      milestone: { id: 'ms', projectId: 'p 1', title: 'Energização', plannedFinish: '2026-11-01' },
      measurement: { id: 'me', expectedAt: '2026-11-05', status: 'PLANNED' },
      billing: { id: 'ev', title: 'Parcela 3', dueDate: '2026-11-30', amount: 1000, currency: 'BRL', releaseState: 'ELIGIBLE' },
    });
    expect(full.some((n) => n.missing)).toBe(false);
    expect(full[0]).toEqual({ label: 'Fornecedor', detail: 'Elétrica Rápida', href: '/supply/fornecedores?supplier=sup' });
    expect(full[1].detail).toBe('CB-35 · Cabo 35 mm');
    expect(full[2]).toEqual({ label: 'Atividade', detail: 'Lançamento de cabos · início 04/10/2026', href: '/projetos/p%201?tab=timeline' });
    expect(full[4].detail).toBe('prevista para 05/11/2026 · Planejada');
    expect(full[5].href).toBe('/contratos?aba=faturamento&evento=ev');
    expect(full[5].detail).toMatch(/Parcela 3 · R\$\s1\.000,00 · vence 30\/11\/2026 · Aguardando liberação/);
    const partial = purchaseChain({ supplier: { id: 'sup', name: null }, material: null, activity: null, milestone: null, measurement: null, billing: null });
    expect(partial[0]).toMatchObject({ detail: 'Fornecedor sem nome' });
    expect(partial.slice(1).every((n) => n.missing)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ato — regras puras
// ---------------------------------------------------------------------------

const resolved = (over: Partial<ResolvedDecision> = {}): ResolvedDecision => ({
  key: `purchase_order:${PO}:s1`, source: 'PROCUREMENT_AUTHORITY', category: 'compras', subjectType: 'purchase_order', subjectId: PO,
  title: 'Pedido', amount: 1000, currency: 'BRL', projectId: 'p1', open: false, outcome: 'APPROVED', status: 'APROVADA',
  closedBy: { id: ME, name: 'Eu' }, closedAt: '2026-09-24T20:00:00Z', reason: null, requestedBy: null, requestedAt: null, requestNote: null,
  fingerprint: 'fp', submission: 1, requestId: null, stageNo: null, ...over,
});

describe('ato — regras', () => {
  it('eco do próprio ato só com mesmo ator E mesmo desfecho, e só encerrada', () => {
    expect(replayOf(resolved(), ME, 'APPROVE')).toBe(true);
    expect(replayOf(resolved(), ME, 'REQUEST_ADJUSTMENT')).toBe(false);
    expect(replayOf(resolved({ closedBy: { id: 'outro', name: 'Outro' } }), ME, 'APPROVE')).toBe(false);
    expect(replayOf(resolved({ open: true }), ME, 'APPROVE')).toBe(false);
    expect(replayOf(resolved({ outcome: 'ADJUSTMENT_REQUESTED' }), ME, 'REQUEST_ADJUSTMENT')).toBe(true);
    expect(replayOf(resolved({ outcome: 'REJECTED' }), ME, 'REJECT')).toBe(true);
    expect(replayOf(null, ME, 'APPROVE')).toBe(false);
  });
  it('erros do motor: tela velha → 409; elegibilidade → 403 em português; chave reusada; justificativa; o resto neutro', () => {
    expect(engineFailure('Pedido já está em APPROVED; não aceita nova decisão.', '23514')).toMatchObject({ status: 409, code: 'STALE' });
    expect(engineFailure('A etapa "fin" expirou em 2026-09-20.', '23514')).toMatchObject({ status: 409, code: 'STALE' });
    expect(engineFailure('SUBJECT_CHANGED: a tela decidia outro conteúdo.', '23514').code).toBe('STALE');
    expect(engineFailure('SOD_REQUESTER: Você pediu.', '42501')).toEqual({ status: 403, code: 'FORBIDDEN',
      message: 'Você solicitou esta aprovação e por isso não pode decidi-la.' });
    expect(engineFailure('MISSING_ROLE: falta papel', '42501').message).toBe('Você não tem o papel que esta etapa exige.');
    expect(engineFailure('Decisão exige identidade autenticada.', '42501').message).toBe('Você não é elegível para esta etapa.');
    // A intenção vem da tela: mesmo contendo "expirado", chave reusada não é lida como estado.
    expect(engineFailure('Chave de idempotência dec:s:u:APPROVE:expirado-123 já foi usada com outra decisão neste inquilino.', '23505'))
      .toMatchObject({ status: 422, code: 'INTENT_REUSED' });
    expect(engineFailure('Rejeitar ou devolver a etapa "fin" exige justificativa.', '23514').message).toBe('Justificativa obrigatória.');
    expect(engineFailure('relation "x" does not exist', '42P01')).toEqual({ status: 422, code: 'REFUSED', message: 'O motor de aprovação recusou o ato.' });
  });
  it('auditoria com a MESMA ação da origem; aviso só do desfecho; mensagens', () => {
    expect(auditActionFor('PROCUREMENT_AUTHORITY', 'APPROVE')).toBe('supply.purchase_order.approve');
    expect(auditActionFor('PROCUREMENT_AUTHORITY', 'REQUEST_ADJUSTMENT')).toBe('supply.purchase_order.reject');
    expect(auditActionFor('APPROVAL_ENGINE', 'REQUEST_ADJUSTMENT')).toBe('approval.decision.returned_for_correction');
    expect(auditActionFor('APPROVAL_ENGINE', 'REJECT')).toBe('approval.decision.rejected');
    expect(noticeFor('k', 'APPROVE')).toEqual({ key: 'k', kind: 'RESOLVED', outcome: 'APPROVED' });
    expect(noticeFor('k', 'REJECT')).toEqual({ key: 'k', kind: 'RESOLVED', outcome: 'REJECTED' });
    expect(noticeFor('k', 'REQUEST_ADJUSTMENT')).toEqual({ key: 'k', kind: 'ADJUSTMENT_REQUESTED' });
    expect(actMessage('purchase_order', 'APPROVE', 'RECORDED', true)).toBe('Compra aprovada.');
    expect(actMessage('purchase_order', 'REQUEST_ADJUSTMENT', 'RECORDED', true)).toBe('Ajuste solicitado a Compras.');
    expect(actMessage('purchase_order', 'REJECT', 'RECORDED', true)).toBe('Rejeição registrada.');
    expect(actMessage('purchase_order', 'APPROVE', 'RECORDED', false)).toMatch(/próximo estágio/);
    expect(actMessage('contract_billing_event', 'APPROVE', 'RECORDED', true)).toBe('Liberação de faturamento aprovada.');
    expect(actMessage('purchase_order', 'APPROVE', 'IDEMPOTENT_REPLAY', true)).toMatch(/nada foi duplicado/);
  });
  it('corpo do ato: ato conhecido, intenção 8–80 [A-Za-z0-9_-], justificativa até 1.000', () => {
    const base = { action: 'APPROVE', expectedFingerprint: null, intentId: 'abc12345' };
    expect(decisionActSchema.safeParse(base).success).toBe(true);
    expect(decisionActSchema.safeParse({ ...base, action: 'CANCEL' }).success).toBe(false);
    expect(decisionActSchema.safeParse({ ...base, intentId: 'curta' }).success).toBe(false);
    expect(decisionActSchema.safeParse({ ...base, intentId: 'com espaço 123' }).success).toBe(false);
    expect(decisionActSchema.safeParse({ ...base, intentId: 'x'.repeat(81) }).success).toBe(false);
    expect(decisionActSchema.safeParse({ ...base, reason: 'r'.repeat(1001) }).success).toBe(false);
    expect(decisionActSchema.safeParse({ action: 'APPROVE', intentId: 'abc12345' }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ato — despacho (fronteira do servidor, dependências simuladas)
// ---------------------------------------------------------------------------

const inboxRow = (over: Partial<DecisionInboxRow> = {}): DecisionInboxRow => ({
  decision_key: `purchase_order:${PO}:s1`, source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order',
  subject_id: PO, action_type: 'approve', request_id: null, step_id: null, stage_no: null, submission: 1, title: 'Pedido OC-1',
  amount: 1000, currency: 'BRL', project_id: 'p1', requested_by: 'buyer', requested_at: null, due_at: null, need_by: null, decide_by: null,
  overdue: false, assignment: 'PRIMARY', state: 'PENDENTE', actions: ['APPROVE', 'REQUEST_ADJUSTMENT'], reason_required: ['REQUEST_ADJUSTMENT'],
  fingerprint: 'fp-live', authority: {}, ...over,
});
const engineRow = (over: Partial<DecisionInboxRow> = {}) => inboxRow({
  decision_key: `approval_request:${RQ}:e1`, source_kind: 'APPROVAL_ENGINE', request_id: RQ, step_id: STEP, stage_no: 1, submission: null,
  actions: ['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT'], reason_required: ['REJECT', 'REQUEST_ADJUSTMENT'], fingerprint: 'engine-fp', ...over,
});
const userRpc = vi.fn();
const session = { supabase: { rpc: userRpc } as never, user: { id: ME }, organizationId: 'org-1' };
const KEY = `purchase_order:${PO}:s1`;
const EKEY = `approval_request:${RQ}:e1`;
const act = (key: string, body: Record<string, unknown>) => actOnDecision(session, key, { expectedFingerprint: null, intentId: 'intent-001', ...body },
  new Headers());
const after = (r: ResolvedDecision) => ({ raw: { request_status: r.source === 'APPROVAL_ENGINE' ? 'APPROVED' : undefined }, resolved: r });

beforeEach(() => {
  m.viewerInboxRow.mockReset(); m.readResolved.mockReset(); m.governedRpc.mockReset(); m.notify.mockReset();
  m.audit.mockReset(); m.audit.mockResolvedValue({ ok: true });
  userRpc.mockReset();
  m.subjectStatus = 'APPROVED';
});

describe('ato — portão da caixa', () => {
  it('chave e corpo inválidos: 400 antes de qualquer leitura', async () => {
    expect((await act('purchase_order:nao-e-uuid:s1', { action: 'APPROVE' })).status).toBe(400);
    expect((await act(KEY, { action: 'APPROVE', intentId: 'x' })).status).toBe(400);
    expect(m.viewerInboxRow).not.toHaveBeenCalled();
  });
  it('fora da caixa e inexistente (ou de outro inquilino): 404', async () => {
    m.viewerInboxRow.mockResolvedValue(null); m.readResolved.mockResolvedValue(null);
    const res = await act(KEY, { action: 'APPROVE' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Decisão não encontrada.');
  });
  it('fora da caixa e aberta: 403 — não está sob a sua alçada; nada é chamado', async () => {
    m.viewerInboxRow.mockResolvedValue(null); m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved({ open: true, outcome: null, closedBy: null }) });
    const res = await act(KEY, { action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN', message: 'Esta decisão não está sob a sua alçada.' });
    expect(m.governedRpc).not.toHaveBeenCalled();
    expect(userRpc).not.toHaveBeenCalled();
  });
  it('fora da caixa e encerrada por outra pessoa: 409 STALE com o que valeu', async () => {
    m.viewerInboxRow.mockResolvedValue(null);
    m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved({ closedBy: { id: 'dir', name: 'Diretora' } }) });
    const res = await act(KEY, { action: 'APPROVE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'STALE', outcome: 'STALE', message: 'Esta decisão já foi aprovada por Diretora. Nada foi alterado.' });
  });
  it('fora da caixa, encerrada por MIM com o mesmo desfecho: idempotente, sem chamar o ato de novo', async () => {
    m.viewerInboxRow.mockResolvedValue(null); m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved() });
    const res = await act(KEY, { action: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'IDEMPOTENT_REPLAY', downstream: null });
    expect(m.governedRpc).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
  it('ato que a fonte não oferece: 422; justificativa exigida ausente: 422', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    const rej = await act(KEY, { action: 'REJECT', reason: 'Não' });
    expect(rej.status).toBe(422);
    expect((await rej.json()).error).toBe('Ato não disponível para esta decisão.');
    const noReason = await act(KEY, { action: 'REQUEST_ADJUSTMENT', reason: '   ' });
    expect(noReason.status).toBe(422);
    expect((await noReason.json()).error).toBe('Justificativa obrigatória.');
    expect(m.governedRpc).not.toHaveBeenCalled();
  });
});

describe('ato — alçada declarada (invólucro canônico pelo service role)', () => {
  it('aprovar: decision_purchase_order_act com o ATOR da sessão, a submissão da caixa e a impressão da tela', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    m.governedRpc.mockResolvedValue({ outcome: 'RECORDED', result: { status: 'APPROVED' } });
    m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved() });
    const res = await act(KEY, { action: 'APPROVE', reason: '  Aprovado  ', expectedFingerprint: 'fp-screen' });
    expect(res.status).toBe(200);
    expect(m.governedRpc).toHaveBeenCalledWith('decision_purchase_order_act', {
      p_organization_id: 'org-1', p_actor: ME, p_po_id: PO, p_submission: 1, p_expected_fingerprint: 'fp-screen', p_decision: 'APPROVE', p_note: 'Aprovado',
    });
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'RECORDED', message: 'Compra aprovada.', downstream: null, resolved: { status: 'APROVADA' } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', action: 'supply.purchase_order.approve', entityType: 'purchase_order',
      entityId: PO, metadata: { via: 'decisoes', decision_key: KEY, outcome: 'RECORDED', action: 'APPROVE' } }), expect.any(Headers));
    expect(m.notify).toHaveBeenCalledWith('org-1', [{ key: KEY, kind: 'RESOLVED', outcome: 'APPROVED' }]);
    expect(userRpc).not.toHaveBeenCalled();
  });
  it('solicitar ajuste = a devolução canônica (REJECT), com a justificativa normalizada', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    m.governedRpc.mockResolvedValue({ outcome: 'RECORDED' });
    m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved({ outcome: 'ADJUSTMENT_REQUESTED', status: 'AJUSTE_SOLICITADO' }) });
    const res = await act(KEY, { action: 'REQUEST_ADJUSTMENT', reason: ' Frete acima do contratado ' });
    expect(res.status).toBe(200);
    expect(m.governedRpc.mock.calls[0][1]).toMatchObject({ p_decision: 'REJECT', p_note: 'Frete acima do contratado' });
    expect((await res.json()).message).toBe('Ajuste solicitado a Compras.');
    expect(m.audit.mock.calls[0][0].action).toBe('supply.purchase_order.reject');
    expect(m.notify).toHaveBeenCalledWith('org-1', [{ key: KEY, kind: 'ADJUSTMENT_REQUESTED' }]);
  });
  it('justificativa de devolução com menos de 3 caracteres: a mesma régua de Compras', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    expect((await act(KEY, { action: 'REQUEST_ADJUSTMENT', reason: 'ok' })).status).toBe(422);
    expect(m.governedRpc).not.toHaveBeenCalled();
  });
  it('invólucro diz STALE: 409, nada auditado, nenhum aviso', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    m.governedRpc.mockResolvedValue({ outcome: 'STALE', current_submission: 2 });
    m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved({ open: false, outcome: null, status: 'PENDENTE', closedBy: null }) });
    const res = await act(KEY, { action: 'APPROVE', expectedFingerprint: 'velha' });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/nova submissão/);
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
  it('replay do invólucro: 200 idempotente, sem novo aviso', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    m.governedRpc.mockResolvedValue({ outcome: 'IDEMPOTENT_REPLAY' });
    m.readResolved.mockResolvedValue({ raw: {}, resolved: resolved() });
    const res = await act(KEY, { action: 'APPROVE' });
    expect(await res.json()).toMatchObject({ outcome: 'IDEMPOTENT_REPLAY', message: expect.stringMatching(/nada foi duplicado/) });
    expect(m.notify).not.toHaveBeenCalled();
  });
  it('recusa do banco (SoD, 42501): 403 com a frase de Compras', async () => {
    m.viewerInboxRow.mockResolvedValue(inboxRow());
    m.governedRpc.mockRejectedValue(new GovernedRpcError('Purchase approval requires segregation of duties: the creator or submitter does not decide.', '42501'));
    const res = await act(KEY, { action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN', error: 'Segregação de funções: quem criou ou submeteu o pedido não o aprova.' });
  });
});

describe('ato — motor de aprovação (sessão da pessoa)', () => {
  it('approval_decide pela SESSÃO: chave por ator, justificativa normalizada, impressão da caixa quando a tela não manda', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow());
    userRpc.mockResolvedValue({ data: { status: 'RECORDED', decision_id: 'd1', request_status: 'APPROVED' }, error: null });
    m.governedRpc.mockResolvedValue({ applied: true, status: 'APPROVED' });
    m.readResolved.mockResolvedValue(after(resolved({ key: EKEY, source: 'APPROVAL_ENGINE', requestId: RQ })));
    const res = await act(EKEY, { action: 'APPROVE', reason: '  ' });
    expect(userRpc).toHaveBeenCalledWith('approval_decide', {
      p_request_step_id: STEP, p_decision: 'APPROVED', p_idempotency_key: `dec:${STEP}:${ME}:APPROVE:intent-001`, p_reason: null,
      p_delegation_id: null, p_expected_fingerprint: 'engine-fp',
    });
    // O motor nunca é chamado pelo service role; o service role só aplica o desfecho a jusante.
    expect(m.governedRpc).toHaveBeenCalledTimes(1);
    expect(m.governedRpc).toHaveBeenCalledWith('purchase_order_apply_approval', { p_approval_request_id: RQ });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ outcome: 'RECORDED', message: 'Compra aprovada.', downstream: { applied: true, status: 'APPROVED' } });
    expect(m.audit.mock.calls[0][0]).toMatchObject({ action: 'approval.decision.approved', entityType: 'purchase_order', entityId: PO });
    expect(m.notify).toHaveBeenCalledWith('org-1', [{ key: EKEY, kind: 'RESOLVED', outcome: 'APPROVED' }]);
  });
  it('impressão digital da tela vence a da caixa', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow());
    userRpc.mockResolvedValue({ data: { status: 'RECORDED', request_status: 'PENDING' }, error: null });
    m.readResolved.mockResolvedValue(null);
    await act(EKEY, { action: 'APPROVE', expectedFingerprint: 'screen-fp' });
    expect(userRpc.mock.calls[0][1].p_expected_fingerprint).toBe('screen-fp');
  });
  it('estágio intermediário: nada a jusante, nenhum aviso de desfecho', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow());
    userRpc.mockResolvedValue({ data: { status: 'RECORDED', request_status: 'PENDING' }, error: null });
    m.readResolved.mockResolvedValue(null);
    const res = await act(EKEY, { action: 'APPROVE' });
    expect(await res.json()).toMatchObject({ outcome: 'RECORDED', downstream: null, message: expect.stringMatching(/próximo estágio/) });
    expect(m.governedRpc).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
  it('faturamento: desfecho final aplicado por contract_billing_apply_approval', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow({ subject_type: 'contract_billing_event', subject_id: 'ev-1', actions: ['APPROVE', 'REJECT'] }));
    userRpc.mockResolvedValue({ data: { status: 'RECORDED', request_status: 'REJECTED' }, error: null });
    m.governedRpc.mockResolvedValue({ applied: true, release_state: 'RELEASE_REJECTED' });
    m.subjectStatus = 'RELEASE_REJECTED';
    m.readResolved.mockResolvedValue(null);
    const res = await act(EKEY, { action: 'REJECT', reason: 'Medição divergente' });
    expect(m.governedRpc).toHaveBeenCalledWith('contract_billing_apply_approval', { p_approval_request_id: RQ });
    expect(await res.json()).toMatchObject({ message: 'Rejeição registrada.', downstream: { applied: true, status: 'RELEASE_REJECTED' } });
    expect(m.notify).toHaveBeenCalledWith('org-1', [{ key: EKEY, kind: 'RESOLVED', outcome: 'REJECTED' }]);
  });
  it('falha a jusante NÃO vira erro: a decisão está gravada; a rota de evento aplica depois', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow());
    userRpc.mockResolvedValue({ data: { status: 'RECORDED', request_status: 'APPROVED' }, error: null });
    m.governedRpc.mockRejectedValue(new GovernedRpcError('boom', 'XX000'));
    m.subjectStatus = 'APPROVAL_REQUIRED';
    m.readResolved.mockResolvedValue(null);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await act(EKEY, { action: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'RECORDED', downstream: { applied: false, status: 'APPROVAL_REQUIRED' } });
    spy.mockRestore();
  });
  it('recusa de estado do motor: 409 STALE — ou idempotente, quando o que valeu foi o MEU mesmo ato', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow());
    userRpc.mockResolvedValue({ data: null, error: { message: 'Pedido já está em APPROVED; não aceita nova decisão.', code: '23514' } });
    m.readResolved.mockResolvedValue(after(resolved({ key: EKEY, source: 'APPROVAL_ENGINE', requestId: RQ, closedBy: { id: 'dir', name: 'Diretora' } })));
    const stale = await act(EKEY, { action: 'APPROVE' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).message).toBe('Esta decisão já foi aprovada por Diretora. Nada foi alterado.');
    m.readResolved.mockResolvedValue(after(resolved({ key: EKEY, source: 'APPROVAL_ENGINE', requestId: RQ })));
    m.governedRpc.mockResolvedValue({ applied: false, idempotent: true, status: 'APPROVED' });
    const mine = await act(EKEY, { action: 'APPROVE', intentId: 'outra-intencao' });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ outcome: 'IDEMPOTENT_REPLAY', downstream: { applied: true, status: 'APPROVED' } });
  });
  it('inelegível no instante do ato (42501): 403 com o motivo do motor', async () => {
    m.viewerInboxRow.mockResolvedValue(engineRow());
    userRpc.mockResolvedValue({ data: null, error: { message: 'SOD_REQUESTER: Você solicitou.', code: '42501' } });
    const res = await act(EKEY, { action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN', error: 'Você solicitou esta aprovação e por isso não pode decidi-la.' });
    expect(m.audit).not.toHaveBeenCalled();
  });
});
