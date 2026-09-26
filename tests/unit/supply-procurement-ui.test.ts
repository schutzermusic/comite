/**
 * COMPRAS · a quantidade EM ABERTO e o cancelamento do pedido (248):
 *
 *   Solicitações  a linha mostra o em aberto (requisitado − liberado); só ela
 *                 é cotada, conta como "aguardando cotação" e ganha "sem
 *                 cotação"; a linha liberada diz quanto, onde e por quê
 *                 ("não pedida no OC-…" / "liberada no cancelamento do OC-…");
 *                 a cotação pede o em aberto, nunca o requisitado original;
 *   Pedido        o aviso de "Cancelar pedido" sai do que o BANCO devolveu —
 *                 por requisito com a unidade (sem somar itens), a requisição
 *                 de → para, e a repetição que nada duplica; o texto de ajuda
 *                 diz o que acontece com a requisição.
 *   Exatas (249)  toda quantidade da 248 sem arredondar: "59,99997 m" em
 *                 aberto e "0,00003 m" liberados, nunca "60 m" e "0 m"; o
 *                 requisito liberado por inteiro fica só como histórico.
 *   Decidir (249) a linha FORA DO PEDIDO (requisição cancelada) segue à vista
 *                 na comparação, marcada, sem faltar nem somar; o aviso de
 *                 "Decidir compra" sai de `not_ordered` do banco.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Props = Record<string, unknown> & { children?: React.ReactNode };
const h = React.createElement;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const resource = vi.hoisted(() => ({ data: null as unknown }));
const nav = vi.hoisted(() => ({ search: '' }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: Props & { href: string }) => h('a', { href, ...rest }, children),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => '/supply/compras',
}));
vi.mock('@/hooks/use-current-user', () => ({ useCurrentUser: () => ({ permissions: [] }) }));
vi.mock('@/lib/platform/approvals/approval-service', () => ({
  decideApprovalStep: vi.fn(), getViewerEligibility: vi.fn(), listApprovalRequestsForSubject: vi.fn(async () => []),
}));
vi.mock('@/components/hud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/hud')>()),
  useHudToast: () => toast,
}));
vi.mock('@/components/ax', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ax')>()),
  // O painel do Radix vai para um portal (nada no HTML do servidor): aqui, só o conteúdo.
  SidePanel: ({ children, testId, meta }: Props & { testId?: string; meta?: React.ReactNode }) => h('div', { 'data-testid': testId },
    meta ? h('p', { 'data-testid': `${testId}-meta` }, meta) : null, children),
  useResource: () => ({ data: resource.data, state: 'ready', message: null, refresh: () => undefined }),
}));

import { useGovernedAction } from '@/components/ax';
import { evaluateOrderableQuotes, recommendQuote } from '@/lib/supply/procurement';
import { ProcurementWorkspace } from '@/components/supply/procurement/ProcurementWorkspace';
import { RfqPanel } from '@/components/supply/procurement/RequisitionsStage';
import { ActPanel, cancelNotice, cancelOutcomeNotice } from '@/components/supply/procurement/OrderPanel';
import { DecidePanel, QuotePanel, decideNotice, decideOutcomeNotice, outOfOrder } from '@/components/supply/procurement/QuotationsStage';
import { exactQty, notOrderedNotes, releaseNotes, type ProcurementModel } from '@/components/supply/procurement/shared';

/* ── Fixtures: o caso do 248 (requisito 100 m, pedido de 60 emitido, 40 não pedidos, pedido cancelado) ── */

const TODAY = '2026-09-26';
type Req = ProcurementModel['requisitions'][number];
type Line = Req['lines'][number];
type Order = ProcurementModel['purchaseOrders'][number];

const CABO = { itemId: 'c502', itemCode: 'CABO-35-XLPE', itemDescription: 'Cabo de potência 35 mm² XLPE 15 kV', unit: 'm' };
const TERM = { itemId: 't35', itemCode: 'TERM-35', itemDescription: 'Terminal de compressão 35 mm²', unit: 'un' };
const line = (p: Partial<Line> & { id: string }): Line => ({
  ...CABO, quantity: 100, openQuantity: 100, requiredBy: '2026-10-10', inRfq: false, releases: [], requirements: [], ...p,
});
const requisition = (p: Partial<Req> & { id: string; number: string }): Req => ({
  status: 'SUBMITTED', source: 'SHORTAGE', priority: 'high', requiredBy: '2026-10-10', projectId: 'qa-rpx248', project: '[QA] RPX 248',
  deliveryLocation: null, justification: null, requestedBy: 'Compras QA', requestedAt: '2026-09-26T12:00:00Z', closeReason: null, lines: [], ...p,
});

/* RC-A: 100 m requisitados, OC-…A1B2C emitido com 60 (40 não pedidos), cancelado → volta com 60 em aberto. */
const RC_A = requisition({ id: 'rq-a', number: 'RC-260926-A0001', lines: [line({
  id: 'l-a', openQuantity: 60,
  releases: [{ stage: 'PO_ISSUED', cause: 'NOT_ORDERED', quantity: 40, orderNumber: 'OC-260926-A1B2C' }],
  requirements: [{ requirementId: 'r1', title: 'Cabo 35 mm² do lançamento', quantity: 100, openQuantity: 60 }],
})] });
/* RC-M: duas linhas — o cabo liberado inteiro no cancelamento (o requisito já coberto), os terminais em aberto. */
const RC_M = requisition({ id: 'rq-m', number: 'RC-260926-M0001', lines: [
  line({ id: 'l-m1', quantity: 50, openQuantity: 0,
    releases: [{ stage: 'PO_CANCELLED', cause: 'COVERED', quantity: 50, orderNumber: 'OC-260926-D4E5F' }],
    requirements: [{ requirementId: 'r2', title: 'Cabo de reserva', quantity: 50, openQuantity: 0 }] }),
  line({ id: 'l-m2', ...TERM, quantity: 30, openQuantity: 30 }),
] });
const RC_S = requisition({ id: 'rq-s', number: 'RC-260926-S0001', status: 'SOURCING', lines: [line({ id: 'l-s', inRfq: true })] });
const RC_K = requisition({ id: 'rq-k', number: 'RC-260926-K0001', status: 'CLOSED', closeReason: 'Tudo liberado', lines: [line({
  id: 'l-k', quantity: 80, openQuantity: 0,
  releases: [{ stage: 'PO_CANCELLED', cause: 'REQUIREMENT_INACTIVE', quantity: 80, orderNumber: 'OC-260926-7G8H9' }],
})] });

const ORDER: Order = {
  id: 'po-1', number: 'OC-260926-A1B2C', status: 'ISSUED', supplierId: 'sa', decisionId: null, supplier: '[QA] Prysmian Cabos',
  projectId: 'qa-rpx248', project: '[QA] RPX 248', currency: 'BRL', goods: 2022, freight: 0, tax: 0, total: 2022, paymentTerms: null,
  deliveryLocationId: null, deliveryLocation: null, expectedDelivery: '2026-10-05', governance: 'AUTHORITY', approvalRequest: null,
  approvedBy: 'Financeiro QA', approvedAt: '2026-09-26T12:40:00Z', createdById: 'u-compras', submittedById: 'u-compras', createdBy: 'Compras QA',
  issuedAt: '2026-09-26T13:00:00Z', createdAt: '2026-09-26T12:30:00Z', closeReason: null, history: [],
  lines: [
    { id: 'pol-1', ...CABO, quantity: 60, unitPrice: 33.7, expectedDate: null, received: 0, requirements: [{ requirementId: 'r1',
      title: 'Cabo 35 mm² do lançamento', projectId: 'qa-rpx248', project: '[QA] RPX 248', requiredBy: '2026-10-10', quantity: 60, received: 0 }] },
    { id: 'pol-2', ...TERM, quantity: 12, unitPrice: 0, expectedDate: null, received: 0, requirements: [{ requirementId: 'r3',
      title: 'Terminais 35 mm²', projectId: 'qa-rpx248', project: '[QA] RPX 248', requiredBy: '2026-10-10', quantity: 12, received: 0 }] },
  ],
};

const MODEL: ProcurementModel = {
  today: TODAY, requisitions: [RC_A, RC_M, RC_S, RC_K], rfqs: [], purchaseOrders: [ORDER], suppliers: [], authorities: [], locations: [],
  viewerId: 'u-compras', capabilities: { request: true, source: true, approve: false, issue: true, authorities: false, suppliers: false },
};

/** O que o banco devolve no caso a: 60 m reabertos, RC-A de "Pedido emitido" para "Aguardando cotação". */
const CASE_A = {
  purchase_order_id: 'po-1', status: 'CANCELLED', replayed: false, approval_request_status: null,
  requirements: [{ requirement_id: 'r1', item_id: 'c502', unit: 'm', reopened_qty: 60, released_qty: 0, cause: null }],
  requisitions: [{ requisition_id: 'rq-a', requisition_number: 'RC-260926-A0001', status_from: 'ORDERED', status_to: 'SUBMITTED' }],
};
const CASE_A_DETAIL = 'Cabo 35 mm² do lançamento: 60 m reabertos para cotação. Requisição RC-260926-A0001: Pedido emitido → Aguardando cotação.';

beforeEach(() => { resource.data = MODEL; nav.search = ''; });

/* ══════════════════════════════════════════════════════════════════════════ */

describe('Compras · solicitações pelo EM ABERTO (248)', () => {
  const html = () => renderToStaticMarkup(h(ProcurementWorkspace));

  it('cabeçalho e etapa: só a linha com algo em aberto, fora de cotação, espera cotação', () => {
    const out = html();
    // RC-A (60 em aberto) e os terminais de RC-M — nem o cabo liberado inteiro, nem a linha já em cotação
    expect(out).toContain('<strong>2</strong> linhas aguardando cotação');
    expect(out).toContain('2 linhas sem cotação');
  });

  it('a linha mostra o em aberto, o requisitado original, o que foi liberado e onde', () => {
    const out = html();
    expect(out).toContain('data-testid="requisition-open-qty">60 m</strong>');
    expect(out).toContain(' em aberto de 100 m requisitados');
    expect(out).toContain('>Cabo 35 mm² do lançamento</a> (60 de 100)');
    expect(out).toContain('data-testid="requisition-release-note">40 m — não pedida no OC-260926-A1B2C</small>');
    expect(out).toContain('data-testid="requisition-release-note">50 m — liberada no cancelamento do OC-260926-D4E5F (o requisito já está coberto)</small>');
    // o requisito liberado por inteiro não é demanda: fica só como histórico, nunca "(0 de 50)"
    expect(out).toContain('data-testid="requisition-released-requirement">liberado de <span>'
      + '<a href="/supply/planejamento-materiais?req=r2" class="ax-link">Cabo de reserva</a> (50)</span></small>');
    expect(out).not.toContain('(0 de 50)');
    // sem liberação, nada de "em aberto de": a quantidade é uma só
    expect(out).toContain('data-testid="requisition-open-qty">30 un</strong>');
    expect(out).not.toContain('em aberto de 30 un');
    // a encerrada fica em "Todas": o recorte "Aguardando compra" não a mostra
    expect(out).not.toContain('RC-260926-K0001');
    expect(out).not.toMatch(/NaN|undefined/);
  });

  it('cotável e "sem cotação" só com algo em aberto; a linha toda liberada diz "liberada" e não tem caixa', () => {
    const out = html();
    expect(out).toContain('aria-label="Cotar CABO-35-XLPE de RC-260926-A0001"');
    expect(out).toContain('aria-label="Cotar TERM-35 de RC-260926-M0001"');
    expect(out).not.toContain('aria-label="Cotar CABO-35-XLPE de RC-260926-M0001"');
    expect(out).not.toContain('aria-label="Cotar CABO-35-XLPE de RC-260926-S0001"');
    expect(out.match(/<\/i>sem cotação<\/span>/g)).toHaveLength(2);
    expect(out.match(/<\/i>liberada<\/span>/g)).toHaveLength(1);
    expect(out.match(/<\/i>em cotação<\/span>/g)).toHaveLength(1);
  });

  it('abrir cotação: a linha pede o EM ABERTO, nunca o requisitado original', () => {
    const out = renderToStaticMarkup(h(RfqPanel, { data: MODEL, lineIds: ['l-a', 'l-m2'], onClose: () => undefined, onDone: () => undefined }));
    expect(out).toContain('data-testid="rfq-form"');
    expect(out).toContain('<em>RC-260926-A0001</em><strong>60 m</strong>');
    expect(out).toContain('<em>RC-260926-M0001</em><strong>30 un</strong>');
    expect(out).not.toContain('100 m');
  });

  it('notas de liberação: somam por pedido, etapa e causa (mesma linha, mesma unidade); o que não é quantidade fica de fora', () => {
    expect(releaseNotes([
      { stage: 'PO_ISSUED', cause: 'NOT_ORDERED', quantity: 40, orderNumber: 'OC-1' },
      { stage: 'PO_ISSUED', cause: 'NOT_ORDERED', quantity: 50, orderNumber: 'OC-1' },
      { stage: 'PO_CANCELLED', cause: 'REQUIREMENT_INACTIVE', quantity: 10, orderNumber: 'OC-2' },
      { stage: 'PO_CANCELLED', cause: 'COVERED', quantity: 0, orderNumber: 'OC-2' },
      { stage: 'PO_CANCELLED', cause: 'COVERED', quantity: Number.NaN, orderNumber: 'OC-2' },
      { stage: 'PO_CANCELLED', cause: 'COVERED', quantity: 5, orderNumber: null },
    ], 'm').map((n) => n.text)).toEqual([
      '90 m — não pedida no OC-1',
      '10 m — liberada no cancelamento do OC-2 (o requisito não está mais ativo)',
      '5 m — liberada no cancelamento do pedido de compra (o requisito já está coberto)',
    ]);
    expect(releaseNotes(undefined, 'm')).toEqual([]);
  });
});

describe('Compras · cancelar o pedido: o aviso é o que o BANCO fez (248)', () => {
  it('caso a: por requisito, com a unidade; a requisição de → para', () => {
    expect(cancelOutcomeNotice(CASE_A, ORDER)).toEqual({ title: 'Pedido OC-260926-A1B2C cancelado', detail: CASE_A_DETAIL });
  });

  it('reaberto e liberado com o porquê; dois itens em unidades diferentes nunca somam; numeric como texto', () => {
    const out = cancelOutcomeNotice({
      status: 'CANCELLED', replayed: false,
      requirements: [
        { requirement_id: 'r1', item_id: 'c502', unit: 'm', reopened_qty: '20.0000', released_qty: '40.0000', cause: 'COVERED' },
        { requirement_id: 'r3', item_id: 't35', unit: 'un', reopened_qty: 0, released_qty: 12, cause: 'REQUIREMENT_INACTIVE' },
      ],
      requisitions: [
        { requisition_number: 'RC-260926-A0001', status_from: 'ORDERED', status_to: 'SUBMITTED' },
        { requisition_number: 'RC-260926-T0001', status_from: 'ORDERED', status_to: 'CLOSED' },
      ],
    }, ORDER);
    expect(out.detail).toBe('Cabo 35 mm² do lançamento: 20 m reabertos para cotação e 40 m liberados (o requisito já está coberto); '
      + 'Terminais 35 mm²: 12 un liberados (o requisito não está mais ativo). '
      + 'Requisições RC-260926-A0001: Pedido emitido → Aguardando cotação; RC-260926-T0001: Pedido emitido → Encerrada.');
    expect(out.detail).not.toMatch(/\b(32|72)\b/);
  });

  it('antes da emissão: nada reabre (já contava como requisitado); a aprovação pendente também sai do motor', () => {
    const out = cancelOutcomeNotice({
      status: 'CANCELLED', replayed: false, approval_request_status: 'CANCELLED',
      requirements: [{ requirement_id: 'r1', item_id: 'c502', unit: 'm', reopened_qty: 0, released_qty: 0, cause: null }],
      requisitions: [{ requisition_number: 'RC-260926-A0001', status_from: 'SOURCING', status_to: 'SUBMITTED' }],
    }, ORDER);
    expect(out.detail).toBe('Cabo 35 mm² do lançamento: segue requisitado — nada foi liberado. '
      + 'Requisição RC-260926-A0001: Em cotação → Aguardando cotação. O pedido de aprovação no motor também foi cancelado.');
  });

  it('repetição: o desfecho gravado, sem duplicar; o cancelamento anterior a 248 não tem detalhe', () => {
    expect(cancelOutcomeNotice({ ...CASE_A, replayed: true }, ORDER).detail).toBe(`Já estava cancelado — nada foi duplicado. ${CASE_A_DETAIL}`);
    expect(cancelOutcomeNotice({ status: 'CANCELLED', replayed: true, requirements: [], requisitions: [] }, ORDER))
      .toEqual({ title: 'Pedido OC-260926-A1B2C cancelado', detail: 'Já estava cancelado — nada foi duplicado.' });
  });

  it('sem título conhecido: o código do item, senão "Requisito"; status igual é dito como "segue"; resposta vazia não inventa', () => {
    const out = cancelOutcomeNotice({
      requirements: [
        { requirement_id: 'r-x', item_id: 'c502', unit: 'm', reopened_qty: 5, released_qty: 0 },
        { requirement_id: 'r-y', item_id: 'zzz', unit: null, reopened_qty: 0, released_qty: 7, cause: 'COVERED' },
        null, 'lixo',
      ],
      requisitions: [{ requisition_number: 'RC-260926-O0001', status_from: 'ORDERED', status_to: 'ORDERED' }],
    }, ORDER);
    expect(out.detail).toBe('CABO-35-XLPE: 5 m reabertos para cotação; Requisito: 7 liberados (o requisito já está coberto). '
      + 'Requisição RC-260926-O0001 segue pedido emitido.');
    expect(cancelOutcomeNotice({}, ORDER).detail).toBe('Nenhuma requisição ligada a este pedido mudou.');
    expect(cancelOutcomeNotice(null, ORDER).detail).not.toMatch(/NaN|undefined/);
  });

  it('o texto de ajuda do cancelamento diz o que acontece com a requisição', () => {
    const panel = (mode: 'cancel' | 'close') => renderToStaticMarkup(h(ActPanel, {
      order: ORDER, mode, data: MODEL, busy: false, onClose: () => undefined, onConfirm: () => undefined,
    }));
    const out = panel('cancel');
    expect(out).toContain('data-testid="po-cancel-effect"');
    expect(out).toContain('A requisição volta para cotação só com o que ainda está sem cobertura');
    expect(out).toContain('o resto é liberado e fica registrado na requisição — sem nada em aberto, ela é encerrada.');
    expect(out).toContain('Uma exceção de cobertura não passa adiante: comprar de novo a parte pendente pede outra exceção.');
    expect(out).toContain('nenhuma decisão fica órfã');
    expect(panel('close')).not.toContain('po-cancel-effect');
  });
});

describe('Compras · cancelar o pedido pela rota governada (fetch simulado)', () => {
  let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const respond = (status: number, payload: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(payload), { status });
  }));
  type Act = ReturnType<typeof useGovernedAction>['run'];
  function Probe({ onRun }: { onRun: (run: Act) => void }) { onRun(useGovernedAction().run); return null; }
  /** O ato do painel do pedido (o hook governado + o aviso do BANCO), capturado num render de servidor. */
  const cancel = async (reason: string) => {
    const got: Act[] = [];
    renderToStaticMarkup(h(Probe, { onRun: (run: Act) => { got.push(run); } }));
    return (await got[0](`po:cancel:${ORDER.id}`, `/api/supply/procurement/purchase-orders/${ORDER.id}`, { action: 'cancel', reason },
      cancelNotice(ORDER), { idempotent: false })).ok;
  };

  beforeEach(() => { calls = []; toast.success.mockReset(); toast.error.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sucesso: o aviso vem do resultado (por requisito, com unidade, e a requisição)', async () => {
    respond(200, { ok: true, result: CASE_A });
    expect(await cancel('Fornecedor desistiu da entrega')).toBe(true);
    expect(calls[0]).toEqual({ url: '/api/supply/procurement/purchase-orders/po-1', body: { action: 'cancel', reason: 'Fornecedor desistiu da entrega' } });
    expect(toast.success).toHaveBeenCalledWith('Pedido OC-260926-A1B2C cancelado', CASE_A_DETAIL);
  });

  it('recusa: o nome do ato e a mensagem do servidor, sem aviso de sucesso', async () => {
    respond(409, { ok: false, error: 'O pedido já tem recebimento: encerre-o em vez de cancelar.' });
    expect(await cancel('Fornecedor desistiu da entrega')).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Cancelar pedido: recusado', 'O pedido já tem recebimento: encerre-o em vez de cancelar.');
    expect(toast.success).not.toHaveBeenCalled();
  });
});

/* ══ 249 · quantidades exatas ══════════════════════════════════════════════ */

/* O caso RQ3 da prova da 248: o cancelamento reabriu 59,99997 m e liberou 0,00003 m (COVERED), gravados exatos. */
const RC_E = requisition({ id: 'rq-e', number: 'RC-260926-E0001', lines: [line({
  id: 'l-e', quantity: 60, openQuantity: 59.99997,
  releases: [{ stage: 'PO_CANCELLED', cause: 'COVERED', quantity: 0.00003, orderNumber: 'OC-260926-RQ3AA' }],
  requirements: [{ requirementId: 'r-e', title: 'Cabo do RQ3', quantity: 60, openQuantity: 59.99997 }],
})] });

describe('Compras · toda quantidade da 248 é exata (249)', () => {
  it('o formatador exato: nada de 3 casas; só o ruído do ponto flutuante some; sem número, "—"', () => {
    expect(exactQty(59.99997, 'm')).toBe('59,99997 m');
    expect(exactQty('0.00003', 'm')).toBe('0,00003 m');
    expect(exactQty(0.1 + 0.2)).toBe('0,3');
    expect(exactQty(1200.5, 'm')).toBe('1.200,5 m');
    for (const v of [null, undefined, '', Number.NaN, 'lixo', Number.POSITIVE_INFINITY]) expect(exactQty(v, 'm')).toBe('—');
  });

  it('solicitações: 59,99997 m em aberto de 60 m, o requisito "59,99997 de 60" e a nota "0,00003 m" — nunca "60 m" e "0 m"', () => {
    resource.data = { ...MODEL, requisitions: [RC_E] };
    const out = renderToStaticMarkup(h(ProcurementWorkspace));
    expect(out).toContain('data-testid="requisition-open-qty">59,99997 m</strong>');
    expect(out).toContain(' em aberto de 60 m requisitados');
    expect(out).toContain('>Cabo do RQ3</a> (59,99997 de 60)');
    expect(out).toContain('data-testid="requisition-release-note">0,00003 m — liberada no cancelamento do OC-260926-RQ3AA (o requisito já está coberto)</small>');
    expect(out).not.toMatch(/>0 m —|>60 m<\/strong>/);
  });

  it('abrir cotação: a linha pede exatamente 59,99997 m — o que o banco vai criar', () => {
    const data = { ...MODEL, requisitions: [RC_E] };
    const out = renderToStaticMarkup(h(RfqPanel, { data, lineIds: ['l-e'], onClose: () => undefined, onDone: () => undefined }));
    expect(out).toContain('<em>RC-260926-E0001</em><strong>59,99997 m</strong>');
  });

  it('cancelar o pedido: o aviso diz 59,99997 m reabertos e 0,00003 m liberados', () => {
    const out = cancelOutcomeNotice({
      status: 'CANCELLED', replayed: false,
      requirements: [{ requirement_id: 'r1', item_id: 'c502', unit: 'm', reopened_qty: '59.99997', released_qty: '0.00003', cause: 'COVERED' }],
      requisitions: [{ requisition_number: 'RC-260926-A0001', status_from: 'ORDERED', status_to: 'SUBMITTED' }],
    }, ORDER);
    expect(out.detail).toBe('Cabo 35 mm² do lançamento: 59,99997 m reabertos para cotação e 0,00003 m liberados (o requisito já está coberto). '
      + 'Requisição RC-260926-A0001: Pedido emitido → Aguardando cotação.');
  });
});

/* ══ 249 · decidir: a linha fora do pedido ═════════════════════════════════ */

type Rfq = ProcurementModel['rfqs'][number];
type Quote = Rfq['quotes'][number];

/* COT-…X1Y2Z: a linha X (RC-A, em busca, 59,99997 m) e a linha Y (RC-B, CANCELADA — a cotação segue aberta porque RC-A vive). */
const RFQ_LINES: Rfq['lines'] = [
  { id: 'rl-x', ...CABO, quantity: 59.99997, requiredBy: '2026-10-10', requisitionLineId: 'l-a', orderable: true },
  { id: 'rl-y', ...TERM, quantity: 12, requiredBy: '2026-10-01', requisitionLineId: 'l-b', orderable: false },
];
const quoteOf = (p: Partial<Quote> & { id: string; supplier: string; lines: Quote['lines'] }): Quote => ({
  supplierId: `s-${p.id}`, supplierStatus: 'HOMOLOGATED', version: 1, status: 'RECEIVED', currency: 'BRL', freight: 0, tax: 0, leadTimeDays: 4,
  validityDate: null, deviations: null, paymentTerms: '28 dias', ...p,
});
/* Q1 cota as duas linhas; Q2 só a X — com Y fora do pedido, Q2 cota tudo o que a decisão vai pedir. */
const Q1 = quoteOf({ id: 'q1', supplier: '[QA] Prysmian Cabos', lines: [
  { rfqLineId: 'rl-x', unitPrice: 33.7, quantity: 59.99997, leadTimeDays: null, compliant: true },
  { rfqLineId: 'rl-y', unitPrice: 9, quantity: 12, leadTimeDays: null, compliant: true },
] });
const Q2 = quoteOf({ id: 'q2', supplier: '[QA] Cabos Norte Ltda', lines: [
  { rfqLineId: 'rl-x', unitPrice: 34, quantity: 59.99997, leadTimeDays: null, compliant: true },
] });
const EVALUATIONS = evaluateOrderableQuotes('OPEN', RFQ_LINES, [Q1, Q2], TODAY);
const RFQ: Rfq = {
  id: 'rfq-1', number: 'COT-260926-X1Y2Z', status: 'OPEN', responseDue: '2026-10-01', note: null, createdAt: '2026-09-26T12:00:00Z', closeReason: null,
  lines: RFQ_LINES, invited: [{ supplierId: 's-q1', supplier: Q1.supplier }, { supplierId: 's-q2', supplier: Q2.supplier }],
  quotes: [Q1, Q2], evaluations: EVALUATIONS, recommendation: recommendQuote(EVALUATIONS), decision: null,
};
/* O que o banco devolve ao decidir Q1: Y não entrou no pedido (RC-B cancelada). */
const NOT_ORDERED_Y = [{ quote_line_id: 'ql-y', requisition_line_id: 'l-b', requisition_id: 'rq-b', requisition_number: 'RC-260926-B0001',
  requisition_status: 'CANCELLED', open_qty: 12 }];

describe('Compras · decidir: a linha FORA DO PEDIDO (249)', () => {
  it('só na cotação aberta: a decidida já tem o pedido', () => {
    expect(outOfOrder(RFQ, RFQ_LINES[1])).toBe(true);
    expect(outOfOrder(RFQ, RFQ_LINES[0])).toBe(false);
    expect(outOfOrder({ status: 'DECIDED' }, RFQ_LINES[1])).toBe(false);
  });

  it('a comparação marca "fora do pedido": não falta na proposta que não a cotou, não soma, e a necessidade é a das que viram pedido', () => {
    resource.data = { ...MODEL, rfqs: [RFQ] };
    nav.search = 'stage=cotacoes&rfq=rfq-1';
    const out = renderToStaticMarkup(h(ProcurementWorkspace));
    expect(out).toContain('data-testid="rfq-drawer"');
    // na fila e no cabeçalho da cotação: a quantidade exata e a marca
    expect(out).toContain('CABO-35-XLPE 59,99997 m · TERM-35 12 un (fora do pedido)');
    // a linha da comparação: o preço de Q1 à vista, sem total; Q2 "fora do pedido", nunca "não cotado"
    expect(out.match(/data-testid="rfq-line-out-of-order"><span class="ax-chip quiet" data-tone="neutral"><i aria-hidden="true"><\/i>fora do pedido<\/span>/g))
      .toHaveLength(1);
    expect(out).toContain('CABO-35-XLPE · 59,99997 m');
    expect(out).not.toContain('não cotado');
    expect(out).not.toContain('R$ 108,00');
    // Q2 cota tudo o que vira pedido: nenhuma falta, e a necessidade é 10/out (a de Y, 01/out, não conta)
    expect(out).not.toContain('não cota tudo o que foi pedido');
    expect(out).toContain('<span>necessidade 10 de out</span>');
    expect(out).not.toContain('necessidade 01 de out');
    expect(out).not.toMatch(/NaN|undefined/);
  });

  it('registrar proposta: a quantidade exata; a linha fora do pedido é opcional (o banco aceita proposta parcial)', () => {
    const out = renderToStaticMarkup(h(QuotePanel, { rfq: RFQ, onClose: () => undefined, onDone: () => undefined }));
    expect(out).toContain('Preço unitário — CABO-35-XLPE (59,99997 m)</span>');
    expect(out).toContain('Preço unitário — TERM-35 (12 un) · fora do pedido, opcional</span>');
  });

  it('decidir: o painel diz antes o que fica fora do pedido', () => {
    const evals = new Map(RFQ.evaluations.map((e) => [e.quoteId, e]));
    const out = renderToStaticMarkup(h(DecidePanel, { rfq: RFQ, live: RFQ.quotes, evaluations: evals, onClose: () => undefined, onDone: () => undefined }));
    expect(out).toContain('data-testid="decide-out-of-order"><strong>Fora do pedido:</strong> TERM-35 12 un —');
    const none = renderToStaticMarkup(h(DecidePanel, { rfq: { ...RFQ, lines: [RFQ_LINES[0]] }, live: RFQ.quotes, evaluations: evals,
      onClose: () => undefined, onDone: () => undefined }));
    expect(none).not.toContain('decide-out-of-order');
  });

  it('o aviso sai de `not_ordered`: por requisição, o porquê e a linha com a quantidade cotada exata', () => {
    expect(decideOutcomeNotice({ decision_id: 'd1', purchase_order_id: 'po-9', order_number: 'OC-260926-D1E2F', replayed: false,
      not_ordered: NOT_ORDERED_Y }, RFQ)).toEqual({ title: 'Compra decidida',
      detail: 'O pedido OC-260926-D1E2F nasceu em rascunho — confira a entrega e submeta. '
        + 'RC-260926-B0001 cancelada: a linha TERM-35 (12 un) não entrou no pedido.' });
    expect(decideOutcomeNotice({ order_number: 'OC-260926-D1E2F', not_ordered: [] }, RFQ).detail)
      .toBe('O pedido OC-260926-D1E2F nasceu em rascunho — confira a entrega e submeta.');
    expect(decideOutcomeNotice({ order_number: 'OC-260926-D1E2F', replayed: true }, RFQ).detail)
      .toBe('Já estava decidida — nada foi duplicado. O pedido é o OC-260926-D1E2F.');
    expect(decideOutcomeNotice(null, RFQ).detail).toBe('O pedido nasceu em rascunho — confira a entrega e submeta.');
  });

  it('`not_ordered`: uma frase por requisição; encerrada, já pedida, sem nada em aberto; linha desconhecida só pelo número', () => {
    const label = (id: string) => (id === 'l-a' ? 'CABO-35-XLPE (59,99997 m)' : id === 'l-b' ? 'TERM-35 (12 un)' : null);
    expect(notOrderedNotes([
      { requisition_line_id: 'l-a', requisition_number: 'RC-1', requisition_status: 'SOURCING', open_qty: 0 },
      { requisition_line_id: 'l-b', requisition_number: 'RC-2', requisition_status: 'CLOSED', open_qty: 0 },
      { requisition_line_id: 'l-a', requisition_number: 'RC-3', requisition_status: 'ORDERED', open_qty: 60 },
      { requisition_line_id: 'l-b', requisition_number: 'RC-3', requisition_status: 'ORDERED', open_qty: 12 },
      { requisition_line_id: 'l-z', requisition_number: 'RC-4', requisition_status: 'CANCELLED', open_qty: 5 },
      { requisition_line_id: 'l-a', requisition_number: 'RC-5', requisition_status: 'CANCELLED' },
      { requisition_line_id: 'l-z', requisition_number: 'RC-5', requisition_status: 'CANCELLED' },
      null, 'lixo',
    ], label)).toEqual([
      'RC-1 sem nada em aberto: a linha CABO-35-XLPE (59,99997 m) não entrou no pedido',
      'RC-2 encerrada: a linha TERM-35 (12 un) não entrou no pedido',
      'RC-3 já com pedido emitido: as linhas CABO-35-XLPE (59,99997 m) e TERM-35 (12 un) não entraram no pedido',
      'RC-4 cancelada: a linha não entrou no pedido',
      'RC-5 cancelada: as 2 linhas não entraram no pedido',
    ]);
    expect(notOrderedNotes(undefined)).toEqual([]);
    expect(notOrderedNotes([{ requisition_number: 'RC-9', requisition_status: 'CANCELLED' }])).toEqual(['RC-9 cancelada: a linha não entrou no pedido']);
  });
});

describe('Compras · decidir pela rota governada: o aviso com e sem `not_ordered` (fetch simulado)', () => {
  let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const respond = (status: number, payload: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(payload), { status });
  }));
  type Act = ReturnType<typeof useGovernedAction>['run'];
  function Probe({ onRun }: { onRun: (run: Act) => void }) { onRun(useGovernedAction().run); return null; }
  /** O ato do painel de decisão (o hook governado + o aviso do BANCO), capturado num render de servidor. */
  const decide = async () => {
    const got: Act[] = [];
    renderToStaticMarkup(h(Probe, { onRun: (run: Act) => { got.push(run); } }));
    return (await got[0](`decide:${RFQ.id}`, `/api/supply/procurement/rfqs/${RFQ.id}`, { action: 'decide', quoteId: 'q1', rationale: 'Menor custo posto' },
      decideNotice(RFQ), { idempotent: false })).ok;
  };

  beforeEach(() => { calls = []; toast.success.mockReset(); toast.error.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('com linha fora do pedido: o aviso diz qual requisição, por quê e qual linha', async () => {
    respond(200, { ok: true, result: { decision_id: 'd1', purchase_order_id: 'po-9', order_number: 'OC-260926-D1E2F', replayed: false,
      not_ordered: NOT_ORDERED_Y } });
    expect(await decide()).toBe(true);
    expect(calls[0].url).toBe('/api/supply/procurement/rfqs/rfq-1');
    expect(toast.success).toHaveBeenCalledWith('Compra decidida', 'O pedido OC-260926-D1E2F nasceu em rascunho — confira a entrega e submeta. '
      + 'RC-260926-B0001 cancelada: a linha TERM-35 (12 un) não entrou no pedido.');
  });

  it('tudo no pedido: só o pedido em rascunho — nenhuma frase de "fora do pedido"', async () => {
    respond(200, { ok: true, result: { decision_id: 'd1', purchase_order_id: 'po-9', order_number: 'OC-260926-D1E2F', replayed: false, not_ordered: [] } });
    expect(await decide()).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('Compra decidida', 'O pedido OC-260926-D1E2F nasceu em rascunho — confira a entrega e submeta.');
  });

  it('recusa: o nome do ato e a mensagem do servidor', async () => {
    respond(409, { ok: false, error: 'Nenhuma linha desta proposta vira pedido: as requisições dela foram canceladas ou encerradas.' });
    expect(await decide()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Decidir compra: recusado',
      'Nenhuma linha desta proposta vira pedido: as requisições dela foram canceladas ou encerradas.');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
