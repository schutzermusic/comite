import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_CATEGORIES, accessNote, amountText, badgeText, byCategory, categoryOptions, chainView, confirmState, contextParts,
  decisionsBadgeTitle, fullDateTime, headerLinkLabel, interpretActResponse, mineSummary, mineView, newIntentId, normalizeFilter,
  normalizeTab, orderedActions, outcomeLine, ownersText, parseBadgeCount, requesterText, rowContext, signalCounts, sortBottlenecks, sourceFacts,
  sortOptions, statusLabelFor, summaryFacts, tabsFor, teamAmountText, verdictTone, waitingText, REASON_MIN,
} from '@/components/decisions/view';
import type { Bottleneck, DecisionDetail, DecisionItem, DecisionsWorkspace, QuoteOption } from '@/lib/decisions/types';

/** Espaço fino do Intl (pt-BR) → espaço comum, para comparar texto. */
const plain = (s: string) => s.replace(/ | /g, ' ');
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const PO = 'purchase_order:3f1c2a9e-4b7d-4c1e-9a2b-1c2d3e4f5a6b:s1';

function item(over: Partial<DecisionItem> = {}): DecisionItem {
  return {
    key: PO, source: 'PROCUREMENT_AUTHORITY', category: 'compras', subjectType: 'purchase_order', subjectId: '3f1c2a9e-4b7d-4c1e-9a2b-1c2d3e4f5a6b',
    actionType: 'approve', requestId: null, stepId: null, stageNo: null, submission: 1, kindLabel: 'Compra', title: 'Pedido de compra OC-1',
    amount: 486_200, currency: 'BRL', projectId: 'p1', projectName: 'Obra Norte', requestedBy: { id: 'u1', name: 'Ana Souza' },
    requestedAt: '2026-09-20T13:00:00Z', dueAt: null, needBy: '2026-10-10', decideBy: '2026-09-26', overdue: false, critical: false,
    criticalReason: null, assignment: 'PRIMARY', state: 'PENDENTE', status: 'PENDENTE', actions: ['APPROVE', 'REQUEST_ADJUSTMENT'],
    reasonRequired: ['REQUEST_ADJUSTMENT'], fingerprint: 'fp1',
    authority: {
      kind: 'PROCUREMENT_AUTHORITY', authorityId: 'a1', ceiling: 500_000, currency: 'BRL', tier: 'PRIMARY', granteeKind: 'ROLE',
      granteeLabel: 'Financeiro', scopeProjectId: null, scopeCategory: null, sourceKind: 'BOARD_RESOLUTION', sourceKindLabel: 'Ata',
      sourceReference: 'ATA-1', sourceDocumentId: null, justification: null, effectiveFrom: null, effectiveUntil: null, declaredBy: null, leadDays: null,
    },
    context: [{ label: 'Fornecedor recomendado', value: 'Fornecedor B', emphasis: true }],
    priority: { code: 'DEADLINE', label: 'Decidir em 2 dias', tone: 'warning' },
    sourceHref: '/supply/compras?stage=aprovacao&po=x', sourceLabel: 'Ver em Compras',
    ...over,
  };
}

function workspace(over: Partial<DecisionsWorkspace> = {}): DecisionsWorkspace {
  const mine = [
    item({ key: 'a', overdue: true, priority: { code: 'OVERDUE', label: 'Vencida', tone: 'danger' } }),
    item({ key: 'b', assignment: 'ESCALATED', status: 'ESCALADA', state: 'ESCALADA', category: 'financeiro', amount: 12_500.5 }),
    item({ key: 'c', projectId: 'p2', requestedAt: '2026-09-10T10:00:00Z', decideBy: null, needBy: null }),
  ];
  return {
    generatedAt: '2026-09-24T12:00:00Z', today: '2026-09-24', viewerId: 'me', tab: 'minhas', mine,
    alsoEligible: [item({ key: 'e', assignment: 'ELIGIBLE' })], team: null, completed: null,
    counts: { mine: 3, overdue: 1, alsoEligible: 1 },
    categories: [{ id: 'compras', label: 'Compras', count: 3 }, { id: 'financeiro', label: 'Financeiro', count: 1 }],
    teamScope: 'ORGANIZATION', ...over,
  };
}

describe('Decisões · endereço (abas e atalhos)', () => {
  it('aba desconhecida cai em Minhas; Equipe sem visão de equipe também', () => {
    expect(normalizeTab('equipe')).toBe('equipe');
    expect(normalizeTab('xpto')).toBe('minhas');
    expect(normalizeTab(null)).toBe('minhas');
    expect(normalizeTab('equipe', 'NONE')).toBe('minhas');
    expect(normalizeTab('concluidas', 'NONE')).toBe('concluidas');
    expect(normalizeFilter('vencidas')).toBe('vencidas');
    expect(normalizeFilter('<script>')).toBe('todos');
  });

  it('a aba Equipe só existe com visão de equipe; Minhas carrega a contagem com o tom da urgência', () => {
    const ws = workspace();
    expect(tabsFor(ws).map((t) => t.id)).toEqual(['minhas', 'equipe', 'concluidas']);
    expect(tabsFor(ws)[0]).toMatchObject({ label: 'Minhas', count: 3, tone: 'danger' });
    expect(tabsFor({ ...ws, teamScope: 'NONE' }).map((t) => t.id)).toEqual(['minhas', 'concluidas']);
    expect(tabsFor({ ...ws, counts: { mine: 2, overdue: 0, alsoEligible: 0 } })[0].tone).toBe('warning');
  });
});

describe('Decisões · números', () => {
  it('valor em reais sem centavos quando inteiro, com centavos quando não', () => {
    expect(plain(amountText(500_000, 'BRL'))).toBe('R$ 500.000');
    expect(plain(amountText(12_500.5, 'BRL'))).toBe('R$ 12.500,50');
    expect(amountText(null, 'BRL')).toBe('—');
    expect(plain(amountText(1000, null))).toBe('R$ 1.000');
  });

  it('valor restrito na equipe é "Restrito", nunca zero', () => {
    expect(teamAmountText({ amount: null, amountRestricted: true, currency: 'BRL' })).toBe('Restrito');
    expect(teamAmountText({ amount: 0, amountRestricted: true, currency: 'BRL' })).toBe('Restrito');
    expect(teamAmountText({ amount: null, amountRestricted: false, currency: 'BRL' })).toBe('Sem valor');
  });
});

describe('Decisões · selo (sidebar e cabeçalho)', () => {
  it('só um inteiro ≥ 0 conta como número do selo', () => {
    expect(parseBadgeCount({ count: 3 })).toBe(3);
    expect(parseBadgeCount({ ok: true, count: 0 })).toBe(0);
    expect(parseBadgeCount({ count: '7' })).toBe(7);
    expect(parseBadgeCount({ count: -1 })).toBeNull();
    expect(parseBadgeCount({ count: 1.5 })).toBeNull();
    expect(parseBadgeCount({ error: 'x' })).toBeNull();
    expect(parseBadgeCount(null)).toBeNull();
  });

  it('texto do selo, título e nome acessível', () => {
    expect(badgeText(5)).toBe('5');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(120)).toBe('99+');
    expect(decisionsBadgeTitle(1)).toBe('1 decisão aguardando você');
    expect(decisionsBadgeTitle(4)).toBe('4 decisões aguardando você');
    expect(headerLinkLabel(0)).toBe('Decisões: nenhuma pendente');
    expect(headerLinkLabel(1)).toBe('Decisões: 1 pendente');
    expect(headerLinkLabel(3)).toBe('Decisões: 3 pendentes');
  });
});

describe('Decisões · cabeçalho, sinais e filtros', () => {
  it('linha de contexto: "3 aguardando você · 1 vencida"', () => {
    expect(contextParts({ mine: 3, overdue: 1, alsoEligible: 0 })).toEqual([{ text: '3 aguardando você' }, { text: '1 vencida', tone: 'danger' }]);
    expect(contextParts({ mine: 2, overdue: 0, alsoEligible: 4 })).toEqual([{ text: '2 aguardando você' }]);
    expect(contextParts({ mine: 0, overdue: 0, alsoEligible: 0 })).toEqual([{ text: 'Nada aguardando você' }]);
  });

  it('faixa de sinais: aguardando, vencidas, escaladas e sob sua alçada', () => {
    expect(signalCounts(workspace())).toEqual({ waiting: 3, overdue: 1, escalated: 1, eligible: 1 });
  });

  it('cada atalho filtra a fila sem reordenar (a ordem é a do servidor)', () => {
    const ws = workspace();
    expect(mineView(ws, 'todos', ALL_CATEGORIES).items.map((i) => i.key)).toEqual(['a', 'b', 'c']);
    expect(mineView(ws, 'todos', ALL_CATEGORIES).eligible.map((i) => i.key)).toEqual(['e']);
    expect(mineView(ws, 'vencidas', ALL_CATEGORIES).items.map((i) => i.key)).toEqual(['a']);
    expect(mineView(ws, 'escaladas', ALL_CATEGORIES).items.map((i) => i.key)).toEqual(['b']);
    const alcada = mineView(ws, 'alcada', ALL_CATEGORIES);
    expect(alcada.items.map((i) => i.key)).toEqual(['e']);
    expect(alcada.subtitle).toBe('Você tem alçada para decidir, mas a decisão é de outra faixa.');
    expect(mineView(ws, 'todos', 'financeiro').items.map((i) => i.key)).toEqual(['b']);
  });

  it('o vazio da fila é EXATAMENTE o combinado — sem exemplo inventado', () => {
    const v = mineView(workspace({ mine: [], alsoEligible: [] }), 'todos', ALL_CATEGORIES);
    expect(v.items).toEqual([]);
    expect(v.emptyTitle).toBe('Nenhuma decisão pendente.');
    expect(v.emptyText).toBe('O Apex mostrará aqui situações que exigem sua autoridade ou julgamento.');
    const src = read('src/components/decisions/DecisionsWorkspace.tsx');
    expect(src).toContain('title="Nenhuma decisão pendente."');
    expect(src).toContain('O Apex mostrará aqui situações que exigem sua autoridade ou julgamento.');
  });

  it('categorias: "Todas" + só as presentes, com a contagem da lista corrente', () => {
    const ws = workspace();
    expect(categoryOptions(ws.categories, ws.mine)).toEqual([
      { id: 'todas', label: 'Todas', count: 3 }, { id: 'compras', label: 'Compras', count: 2 }, { id: 'financeiro', label: 'Financeiro', count: 1 },
    ]);
    // Categoria do servidor sem item na lista corrente some; a escolhida fica (senão não se desmarca).
    const onlyCompras = ws.mine.filter((i) => i.category === 'compras');
    expect(categoryOptions(ws.categories, onlyCompras).map((o) => o.id)).toEqual(['todas', 'compras']);
    expect(categoryOptions(ws.categories, onlyCompras, 'financeiro').map((o) => o.id)).toEqual(['todas', 'compras', 'financeiro']);
    // Categoria que o servidor não listou ganha o rótulo canônico.
    expect(categoryOptions([], [{ category: 'contratos' }])[1]).toEqual({ id: 'contratos', label: 'Contratos', count: 1 });
    expect(byCategory(ws.mine, ALL_CATEGORIES)).toHaveLength(3);
  });
});

describe('Decisões · linhas', () => {
  it('o projeto entra no contexto quando o servidor não o trouxe; não duplica', () => {
    expect(rowContext(item()).map((c) => c.label)).toEqual(['Projeto', 'Fornecedor recomendado']);
    expect(rowContext(item({ context: [{ label: 'Projeto', value: 'X' }] })).map((c) => c.label)).toEqual(['Projeto']);
    expect(rowContext(item({ projectName: null })).map((c) => c.label)).toEqual(['Fornecedor recomendado']);
  });

  it('quem pediu e há quanto tempo; espera da equipe', () => {
    expect(requesterText({ id: 'u', name: 'Ana' }, '2026-09-21T10:00:00Z', '2026-09-24')).toBe('Solicitado por Ana · há 3 dias');
    // 22:30 em Brasília já é o dia seguinte em UTC: continua sendo "hoje" para quem lê em São Paulo.
    expect(requesterText({ id: 'u', name: 'Ana' }, '2026-09-25T01:30:00Z', '2026-09-24')).toBe('Solicitado por Ana · hoje');
    expect(requesterText(null, null, '2026-09-24')).toBeNull();
    expect(waitingText(0)).toBe('desde hoje');
    expect(waitingText(1)).toBe('há 1 dia');
    expect(waitingText(12)).toBe('há 12 dias');
    expect(waitingText(null)).toBeNull();
  });

  it('"Aguardando sua decisão" só para quem decide', () => {
    expect(statusLabelFor('PENDENTE', true)).toBe('Aguardando sua decisão');
    expect(statusLabelFor('PENDENTE', false)).toBe('Aguardando decisão');
    expect(statusLabelFor('ESCALADA', true)).toBe('Escalada');
    expect(statusLabelFor('EM_ANALISE', false)).toBe('Em análise');
  });

  it('donos da decisão na equipe; ninguém elegível é dito', () => {
    expect(ownersText([])).toEqual({ text: 'Sem decisor elegível', none: true });
    expect(ownersText([{ id: '1', name: 'Ana', assignment: 'PRIMARY' }, { id: '2', name: 'Bia', assignment: 'ESCALATED' }]).text)
      .toBe('Ana · Bia (escalada)');
  });

  it('gargalos: sem decisor primeiro, depois vencidas e espera', () => {
    const b = (name: string | null, open: number, overdue: number, wait: number | null): Bottleneck =>
      ({ owner: name ? { id: name, name } : null, open, overdue, oldestWaitingDays: wait, amount: null });
    const sorted = sortBottlenecks([b('Ana', 5, 0, 2), b('Bia', 1, 1, 9), b(null, 1, 0, 1), b('Caio', 3, 1, 20)]);
    expect(sorted.map((x) => x.owner?.name ?? 'SEM')).toEqual(['SEM', 'Caio', 'Bia', 'Ana']);
  });

  it('desfecho legível: quem, o quê, quando', () => {
    expect(outcomeLine('APROVADA', { id: 'u', name: 'Ana Souza' }, '2026-09-12T15:00:00Z')).toBe('Aprovada por Ana Souza em 12/09/2026');
    expect(outcomeLine('CANCELADA', null, null)).toBe('Cancelada');
    expect(fullDateTime('2026-09-12T15:32:00Z')).toMatch(/12\/09\/2026.*12:32/);
    expect(fullDateTime(null)).toBe('—');
  });

  it('resumo da fila: soma por moeda, próximo prazo, mais antiga, projetos', () => {
    const s = mineSummary(workspace().mine);
    expect(s.totals).toEqual([{ currency: 'BRL', amount: 486_200 + 12_500.5 + 486_200 }]);
    expect(s.nextDeadline).toBe('2026-09-26');
    expect(s.oldestRequest).toBe('2026-09-10');
    expect(s.projects).toBe(2);
  });
});

describe('Decisões · detalhe', () => {
  const detail = (over: Partial<DecisionDetail> = {}): DecisionDetail => ({
    key: PO, access: 'DECIDER', item: item(), canAct: true, actions: ['APPROVE', 'REQUEST_ADJUSTMENT'], reasonRequired: ['REQUEST_ADJUSTMENT'],
    resolved: {
      key: PO, source: 'PROCUREMENT_AUTHORITY', category: 'compras', subjectType: 'purchase_order', subjectId: 'x', title: 'Pedido OC-1',
      amount: 486_200, currency: 'BRL', projectId: 'p1', open: true, outcome: null, status: 'PENDENTE', closedBy: null, closedAt: null,
      reason: null, requestedBy: { id: 'u1', name: 'Ana Souza' }, requestedAt: '2026-09-20T13:00:00Z', requestNote: 'Urgente', fingerprint: 'fp1',
      submission: 1, requestId: null, stageNo: null,
    },
    why: [], facts: [{ label: 'Fornecedor recomendado', value: 'Outro (servidor)' }, { label: 'Condição de pagamento', value: '30 dias' }],
    lines: [], comparison: null, impact: [], chain: [], otherDeciders: { count: 0, people: [] }, history: [], notifications: [],
    sourceHref: '/supply/compras', sourceLabel: 'Ver em Compras', today: '2026-09-24', ...over,
  });

  it('RESUMO: só o que se decide, uma vez; prazo e solicitante ficam no topo, não se repetem', () => {
    const facts = summaryFacts(detail());
    expect(facts.map((f) => f.label)).toEqual(['Projeto', 'Fornecedor recomendado', 'Necessário até']);
    expect(facts.find((f) => f.label === 'Fornecedor recomendado')?.value).toBe('Fornecedor B');
  });

  it('DADOS DA ORIGEM: o registro completo, sem repetir o resumo nem a nota', () => {
    const facts = sourceFacts(detail({ facts: [{ label: 'Fornecedor recomendado', value: 'Outro (servidor)' },
      { label: 'Condição de pagamento', value: '30 dias' }, { label: 'Nota da submissão', value: 'Urgente' }] }));
    expect(facts.map((f) => f.label)).toEqual(['Condição de pagamento', 'Solicitado por']);
    expect(facts.find((f) => f.label === 'Solicitado por')?.value).toMatch(/^Ana Souza · /);
  });

  it('sem ato para a pessoa, a tela diz por quê', () => {
    expect(accessNote(detail())).toBeNull();
    expect(accessNote(detail({ access: 'TEAM', canAct: false }))).toMatch(/visão de equipe/);
    expect(accessNote(detail({ access: 'SOURCE_READER', canAct: false }))).toMatch(/registro de origem/);
    const closed = detail({ canAct: false });
    expect(accessNote({ ...closed, resolved: { ...closed.resolved, open: false } })).toBeNull();
  });

  it('cadeia: nó sem vínculo aparece como tal, sem link', () => {
    expect(chainView([
      { label: 'Fornecedor', detail: 'Fornecedor B', href: '/supply/fornecedores/1' },
      { label: 'Marco', missing: true, href: '/x' },
    ])).toEqual([
      { label: 'Fornecedor', detail: 'Fornecedor B', href: '/supply/fornecedores/1', missing: false },
      { label: 'Marco', detail: 'sem vínculo registrado', href: null, missing: true },
    ]);
  });

  it('comparação: escolhido, recomendado, menor custo; veredito com tom', () => {
    const o = (id: string, over: Partial<QuoteOption>): QuoteOption => ({
      quoteId: id, supplier: id, landed: 100, currency: 'BRL', leadDays: 10, eta: '2026-10-05', lateDays: 0, chosen: false, recommended: false,
      cheapest: false, compliant: true, supplierOk: true, reliability: null, verdict: 'Atende o cronograma', ...over,
    });
    const sorted = sortOptions([o('A', { landed: 90, cheapest: true }), o('B', { chosen: true, landed: 120 }), o('C', { recommended: true, landed: 110 })]);
    expect(sorted.map((x) => x.quoteId)).toEqual(['B', 'C', 'A']);
    expect(verdictTone({ lateDays: 9 })).toBe('danger');
    expect(verdictTone({ lateDays: 0 })).toBe('success');
    expect(verdictTone({ lateDays: null })).toBe('neutral');
  });
});

describe('Decisões · atos governados', () => {
  it('só os atos que a fonte oferece, em ordem: Aprovar, Solicitar ajuste, Rejeitar', () => {
    expect(orderedActions(['REJECT', 'APPROVE', 'REQUEST_ADJUSTMENT'])).toEqual(['APPROVE', 'REQUEST_ADJUSTMENT', 'REJECT']);
    expect(orderedActions(['REQUEST_ADJUSTMENT', 'APPROVE'])).toEqual(['APPROVE', 'REQUEST_ADJUSTMENT']);
    expect(orderedActions([])).toEqual([]);
  });

  it('justificativa obrigatória trava a confirmação, com o motivo dito', () => {
    const empty = confirmState('REQUEST_ADJUSTMENT', ['REQUEST_ADJUSTMENT', 'REJECT'], '   ');
    expect(empty).toMatchObject({ required: true, canConfirm: false });
    expect(empty.hint).toMatch(/obrigatória para solicitar ajuste/);
    expect(confirmState('REJECT', ['REJECT'], 'ok')).toMatchObject({ canConfirm: false, hint: `Escreva pelo menos ${REASON_MIN} caracteres.` });
    expect(confirmState('REJECT', ['REJECT'], 'Preço acima do orçado')).toMatchObject({ canConfirm: true });
  });

  it('justificativa opcional nunca trava (e REQUIRED_ALWAYS vale para aprovar também)', () => {
    expect(confirmState('APPROVE', ['REJECT'], '')).toMatchObject({ required: false, canConfirm: true });
    expect(confirmState('APPROVE', ['APPROVE', 'REJECT'], '')).toMatchObject({ required: true, canConfirm: false });
  });

  it('resposta do ato: registrado, repetido, tela velha, sem alçada, recusado, incerto', () => {
    expect(interpretActResponse(200, { outcome: 'RECORDED', message: 'Aprovação registrada.', resolved: null, downstream: { applied: false, status: null } }))
      .toEqual({ kind: 'done', replay: false, message: 'Aprovação registrada.', downstreamPending: true });
    expect(interpretActResponse(200, { outcome: 'IDEMPOTENT_REPLAY', message: '' }))
      .toMatchObject({ kind: 'done', replay: true, message: 'Já estava registrado — nada foi duplicado.', downstreamPending: false });
    expect(interpretActResponse(409, { code: 'STALE', message: 'Esta decisão já foi aprovada por Bia. Nada foi alterado.' }))
      .toEqual({ kind: 'stale', message: 'Esta decisão já foi aprovada por Bia. Nada foi alterado.' });
    // 409 sem mensagem: a frase vem do desfecho canônico.
    expect(interpretActResponse(409, { code: 'STALE', resolved: { status: 'APROVADA', closedBy: { id: 'b', name: 'Bia' } } }))
      .toEqual({ kind: 'stale', message: 'Esta decisão já foi aprovada por Bia. Nada foi alterado.' });
    expect(interpretActResponse(200, { outcome: 'STALE', message: 'mudou' }).kind).toBe('stale');
    expect(interpretActResponse(403, { code: 'FORBIDDEN', message: 'Sem alçada.' })).toEqual({ kind: 'forbidden', message: 'Sem alçada.' });
    expect(interpretActResponse(422, { error: 'Justificativa obrigatória.' })).toEqual({ kind: 'invalid', message: 'Justificativa obrigatória.' });
    expect(interpretActResponse(500, null).kind).toBe('error');
    expect(interpretActResponse(502, 'x').kind).toBe('error');
  });

  it('uma intenção por abertura da confirmação: UUID v4, sempre novo', () => {
    const a = newIntentId();
    const b = newIntentId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('a intenção nasce ao ABRIR a confirmação e é reusada na repetição; STALE não é erro', () => {
    const panel = read('src/components/decisions/DecisionPanel.tsx');
    // Gerada no ato de abrir, nunca no clique de confirmar.
    expect(panel).toMatch(/const openConfirm = [\s\S]*?newIntentId\(\)/);
    expect(panel).toMatch(/intentId: confirm\.intentId/);
    expect(panel).not.toMatch(/const submit = [\s\S]*?newIntentId\(\)[\s\S]*?const footer/);
    // Justificativa normalizada como o motor grava.
    expect(panel).toContain('reason: normalizeReason(reason)');
    // Os atos só aparecem com canAct e vêm de detail.actions.
    expect(panel).toMatch(/d\.canAct && r\.open && settledOn !== d \? orderedActions\(d\.actions\)/);
  });
});

describe('Decisões · navegação global', () => {
  it('um item "Decisões" plano, logo abaixo do Dashboard, visível a toda pessoa autenticada', () => {
    const sidebar = read('src/components/layout/app-sidebar.tsx');
    const items = sidebar.slice(sidebar.indexOf('const navigationItems'), sidebar.indexOf('const isRouteActive'));
    const hrefs = Array.from(items.matchAll(/^\s{2}\{\s*href: "([^"]+)"|^\s{4}href: "([^"]+)"/gm)).map((m) => m[1] ?? m[2]);
    expect(hrefs.slice(0, 2)).toEqual(['/dashboard', '/decisoes']);
    expect(items).toMatch(/\{ href: "\/decisoes", labelKey: "decisions", icon: Stamp, section: "main", alwaysVisibleWhenAuthenticated: true \}/);
    expect(sidebar).toContain('hud-nav-badge--pending');
    expect(JSON.parse(read('src/locales/pt-BR/common.json')).decisions).toBe('Decisões');
  });

  it('/decisoes exige só sessão (a alçada é filtrada no servidor)', () => {
    expect(read('src/utils/supabase/middleware.ts')).toContain("{ prefix: '/decisoes', permission: null }");
  });

  it('o selo tem tom próprio e o ponto da sidebar recolhida acompanha', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/\.hud-nav-badge--pending\s*\{[^}]*var\(--ig-warning\)/);
    expect(css).toMatch(/\.hud-nav-item:has\(\.hud-nav-badge--pending\) \.hud-nav-dot/);
  });
});
