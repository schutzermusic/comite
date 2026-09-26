/**
 * DASHBOARD · MÓDULOS DO LOCAL (Planejar, Supply Chain, Faturamento).
 *
 *   Gantt       escala dia → fração com guarda de NaN; janela inválida,
 *               sem datas, hoje fora da janela; marcas nas segundas; tons do
 *               protótipo; pílula (vencida > bloqueada > crítica); caminhos
 *               das dependências sem "NaN"; hachura hoje → necessidade;
 *               bandeiras que não se encostam
 *   Supply      balanço da cobertura viva (Falta zero é dita); chegada
 *               COMPARADA à necessidade — nunca "atrasa"; camada do mapa:
 *               canteiro fora, almoxarifado no canteiro sem arco, saldo →
 *               arco cheio, sem saldo → tracejado; enquadramento
 *   Faturamento tom de cada estado do eventograma; cadeia pelo ESTADO do elo;
 *               referência "Entender" dos outros eventos
 *   Decisão     o ato do Dashboard manda o MESMO corpo do DecisionPanel
 *   Tela        render (react-dom/server) dos três módulos: Restrito nunca 0,
 *               "não carregou" nunca calmo, e nenhum "NaN" no HTML
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Props = Record<string, unknown> & { children?: React.ReactNode };
const h = React.createElement;

const resources = new Map<string, { data: unknown; state: string; message: string | null }>();

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: Props & { href: string }) => h('a', { href, ...rest }, children),
}));
vi.mock('@/components/hud', () => ({
  useHudToast: () => ({ success: () => undefined, error: () => undefined }),
  // O Signal do produto, reduzido ao que a tela precisa provar: o tom e o texto.
  HudSignal: ({ label, value, tone }: { label: React.ReactNode; value?: React.ReactNode; tone?: string }) =>
    h('span', { 'data-signal': tone ?? 'accent' }, label, value !== undefined && value !== null ? ` · ${String(value)}` : null),
}));
vi.mock('@/components/ax', async () => {
  const format = await import('@/components/ax/format');
  return {
    ...format,
    useResource: (url: string) => ({ ...(resources.get(url) ?? { data: null, state: 'loading', message: null }), refresh: () => undefined }),
    notifyChanged: () => undefined,
  };
});

import {
  CORRIDOR_PAD, CORRIDOR_TURN, EVENT_TONE, PLAN_STAGGER_MS, REVEAL_FRAME, SCAN_DRIFT, SCAN_MIN_KM, SCAN_STATUS_TEXT, SEND_OUTCOME, SITE_BOX, abPair, activeRfq,
  arrivalText, balanceRows, billingRef, canCreateRequisition, cnpjText, companyKey, corridorView, coverageSegments, currentPurchaseStep, dayMonth,
  dayNumber, decideBody, defaultRationale, defaultResponseDue, eventContext, eventTone, flagSides, flowReadable, flowStates, focusActivity,
  frameView, gapSpan, ganttLinkPaths, ganttRows, ganttScale, govStep, handledBySend, haversineKm, lowReliability, missingDeliveryLocation,
  moneyLike, needTone, networkSummary, nodeCardBox, normalizeSupply, orderTiming, panelScrollTarget, parseMoneyText, pendingForViewer,
  percentOf, pillSide, planActionBody, planSteps, planToRequisition, preselectSuppliers, projectToScreen, prospectBody, rationaleState,
  recommendationLine, registryList, registryMatch, remainingToBuy, requisitionBody, requisitionPreview, requisitionQty, rfqCreateBody,
  rfqSendBody, safeHttpUrl, scanRadiusKm, scanResults, scanView, sendResults, siteCloseView, siteLocationId, spanLabel, stepState,
  supplierStatusText, supplyFlowLayer, supplyMapLayer, unprojectFromScreen, unsentInvited, unsentPending, usableCorridor, weekday, type Corridor,
} from '@/components/dashboard-globe/modules/model';
import { BillingModule, PlanModule, SupplyModule } from '@/components/dashboard-globe/modules';
import { SupplyFlowPanel } from '@/components/dashboard-globe/modules/supply/FlowPanel';
import { NeedPanel } from '@/components/dashboard-globe/modules/supply/NeedPanel';
import { RequisitionStep } from '@/components/dashboard-globe/modules/supply/Requisition';
import { SuppliersStep } from '@/components/dashboard-globe/modules/supply/Suppliers';
import { NETWORK_TEXT, NETWORK_TEXT_UNKEYED, postDiscovery, postGoverned } from '@/components/dashboard-globe/modules/supply/act';
import type { FlowCtx } from '@/components/dashboard-globe/modules/supply/types';
import { decisionActBody, postDecisionAct } from '@/components/decisions/useDecisionAct';
import type { ModuleProps } from '@/components/dashboard-globe/contract';
import type {
  ExternalSupplierCandidate, GanttActivity, InboundOrder, MaterialBalance, QuoteOption, RfqView, SiteBillingResponse, SitePlanData,
  SitePlanResponse, SiteSupplyData, SiteSupplyResponse, StockNode, SupplierCandidate, SupplyPlan,
} from '@/lib/dashboard/types';
import type { DecisionDetail } from '@/lib/decisions/types';

/* ── Fixtures (formato real do QA: qa-scn-tucurui, 25/09/2026) ─────────── */

const TODAY = '2026-09-25';

function act(p: Partial<GanttActivity> & { id: string }): GanttActivity {
  return {
    parentId: null, wbs: null, title: p.id, level: 0, start: null, finish: null, percent: 0, status: 'not_started', statusLabel: 'Não iniciada',
    isSummary: false, isMilestone: false, critical: false, overdue: false, blocked: false, needBy: null, atRisk: false,
    href: '/projetos/qa-scn-tucurui?tab=timeline', ...p,
  };
}

const ACTIVITIES: GanttActivity[] = [
  act({ id: 'mob', title: 'Mobilização do canteiro', start: '2026-08-25', finish: '2026-08-31', percent: 100, status: 'completed', statusLabel: 'Concluída' }),
  act({ id: 'insp', title: 'Inspeção das fundações dos bays', start: '2026-09-12', finish: '2026-09-21', percent: 70, status: 'in_progress', overdue: true }),
  act({ id: 'mont', title: 'Montagem das estruturas metálicas', start: '2026-09-16', finish: '2026-10-06', percent: 35, status: 'in_progress', needBy: '2026-09-22' }),
  act({ id: 'cabo', title: 'Lançamento de cabos de potência', start: '2026-09-30', finish: '2026-10-14', critical: true, needBy: '2026-09-30', atRisk: true }),
  act({ id: 'disj', title: 'Instalação dos disjuntores 145 kV', start: '2026-10-12', finish: '2026-10-20', critical: true, needBy: '2026-10-08' }),
  act({ id: 'energ', title: 'Energização dos novos bays', start: '2026-10-22', finish: '2026-10-22', critical: true, isMilestone: true }),
];

const PLAN: SitePlanData = {
  window: { start: '2026-08-22', end: '2026-10-29' },
  activities: ACTIVITIES,
  links: [{ from: 'mont', to: 'cabo', type: 'FS', lagDays: 0 }, { from: 'cabo', to: 'energ', type: 'FS', lagDays: 0 }],
  focus: 'cabo',
  needsByActivity: {
    cabo: { state: 'ok', data: [
      { id: 'r1', title: 'Cabo 35 mm² para o lançamento dos bays', type: 'MATERIAL', typeLabel: 'Material', qty: 1200, unit: 'm', requiredBy: '2026-09-30',
        status: 'short', statusLabel: 'Falta 500 m', coverage: { required: 1200, covered: 300, shortage: 500 }, href: '/supply/planejamento-materiais?req=r1' },
      { id: 'r2', title: 'Equipe de lançamento — 8 eletricistas', type: 'WORKFORCE', typeLabel: 'Mão de obra', qty: 8, unit: 'pessoas', requiredBy: '2026-09-29',
        status: 'covered', statusLabel: 'Atendido', coverage: null, href: '/projetos/x' },
    ] },
    mont: { state: 'restricted' },
    insp: { state: 'error', message: 'A leitura das necessidades falhou.' },
  },
  truncated: false,
};

const BALANCE: MaterialBalance = {
  requirementId: 'ca276394', title: 'Cabo 35 mm² para o lançamento dos bays',
  origin: {
    source: 'ACTIVITY', label: 'Do cronograma: Lançamento de cabos de potência (início 30/09)',
    serviceOrder: { id: 'os-301', number: 'OS-QA-2026-0301', href: '/operacoes/os/os-301' },
    activity: { id: 'cabo', title: 'Lançamento de cabos de potência', start: '2026-09-30' }, readByAi: false,
  },
  item: { id: 'c502', code: 'CABO-35-XLPE', description: 'Cabo de potência 35 mm² XLPE 15 kV', unit: 'm' },
  activity: { id: 'cabo', title: 'Lançamento de cabos de potência', start: '2026-09-30' },
  needBy: '2026-09-30', required: 1200, reserved: 300, consumed: 0, inTransit: 400, onOrder: 0, requested: 500, covered: 300,
  inbound: 400, inspection: 0, shortage: 500, risk: 'critical', href: '/supply/planejamento-materiais?req=ca276394',
};

function node(p: Partial<StockNode> & { locationId: string }): StockNode {
  return { code: null, name: p.locationId, kind: 'WAREHOUSE', kindLabel: 'Almoxarifado', lat: null, lng: null, onHand: 0, reserved: 0, available: 0, isSite: false, ...p };
}

const STOCK: StockNode[] = [
  node({ locationId: 'cant-tuc', name: 'Canteiro SE Tucuruí', kind: 'PROJECT_SITE', lat: -3.7662, lng: -49.6725, isSite: true }),
  node({ locationId: 'cant-mar', name: 'Canteiro LT Marabá', kind: 'PROJECT_SITE', lat: -5.3686, lng: -49.1178, onHand: 250, available: 250 }),
  node({ locationId: 'belem', name: 'Almoxarifado Central — Belém', lat: -1.4558, lng: -48.4902, onHand: 300, reserved: 300, available: 0 }),
  node({ locationId: 'norte', name: 'Almoxarifado Norte — Tucuruí', lat: -3.7662, lng: -49.6725, available: 0 }),
  node({ locationId: 'sem-coord', name: 'Almoxarifado sem coordenada', available: 90 }),
  node({ locationId: 'nan', name: 'Coordenada quebrada', lat: Number.NaN, lng: -48, available: 5 }),
];

/* O caso de demonstração do QA: RC-260924-C451E (500 m) em cotação COT-260924-98CDA — A chega a tempo, B é mais barata e chega 7 dias depois. */
const PLAN_OK: SupplyPlan = {
  steps: [
    { kind: 'reserve', qty: 300, unit: 'm', from: { locationId: 'cant-tuc', name: 'Canteiro SE Tucuruí', lat: -3.7662, lng: -49.6725 },
      label: 'Reservar 300 m no Canteiro SE Tucuruí', status: 'done', reason: 'já reservado (300 m)', action: null },
    { kind: 'transfer', qty: 250, unit: 'm', from: { locationId: 'cant-mar', name: 'Canteiro LT Marabá', lat: -5.3686, lng: -49.1178 },
      label: 'Transferir 250 m do Canteiro LT Marabá', status: 'suggested', reason: null,
      action: { method: 'POST', href: '/api/supply/inventory/transfers', permission: 'inventory.transfer',
        body: { fromLocationId: 'cant-mar', toLocationId: 'cant-tuc', lines: [{ itemId: 'c502', quantity: 250, requirementId: 'ca276394' }] },
        confirm: 'Pedir a transferência de 250 m do Canteiro LT Marabá para o Canteiro SE Tucuruí? Ela segue para aprovação do estoque.' } },
    { kind: 'buy', qty: 250, unit: 'm', from: null, label: 'Comprar 250 m', status: 'done', reason: 'já requisitado (500 m) — RC-260924-C451E', action: null },
  ],
  remainingShortage: 250,
  basis: 'Cobertura viva + estoque em 3 locais',
};

function quote(p: Partial<QuoteOption> & { quoteId: string; name: string }): QuoteOption {
  const { name, ...rest } = p;
  return {
    supplier: { id: `s-${p.quoteId}`, name, homologated: true, onTimeRate: null }, totalText: null, unitPriceText: null, leadDays: null, eta: null,
    onTime: null, lateDays: null, paymentTerms: null, validity: null, recommended: false, cheapest: false, verdict: '', ...rest,
  };
}
const QA = quote({ quoteId: 'qa', name: '[QA] Prysmian Cabos', totalText: 'R$ 16.850', unitPriceText: 'R$ 33,70', leadDays: 4, eta: '2026-09-29',
  onTime: true, lateDays: 0, recommended: true, verdict: 'Chega até a necessidade', supplier: { id: 'sa', name: '[QA] Prysmian Cabos', homologated: true, onTimeRate: 0.96 } });
const QB = quote({ quoteId: 'qb', name: '[QA] Cabos Norte Ltda', totalText: 'R$ 16.000', unitPriceText: 'R$ 32', leadDays: 12, eta: '2026-10-07',
  onTime: false, lateDays: 7, cheapest: true, verdict: 'Chega 7 dias depois da necessidade', supplier: { id: 'sb', name: '[QA] Cabos Norte Ltda', homologated: true, onTimeRate: 0.82 } });
const RFQ: RfqView = {
  id: 'rfq-1', number: 'COT-260924-98CDA', status: 'OPEN', statusLabel: 'Aberta', responseDue: '2026-09-28',
  invited: [
    { supplierId: 'sa', name: '[QA] Prysmian Cabos', hasContact: true, sentAt: '2026-09-24T17:02:00Z' },
    { supplierId: 'sb', name: '[QA] Cabos Norte Ltda', hasContact: true, sentAt: null },
    { supplierId: 'sc', name: '[QA] Eletro Sem Email', hasContact: false, sentAt: null },
    { supplierId: 'sd', name: '[QA] Fios Pará', hasContact: true, sentAt: null },
  ],
  quotes: [QB, QA],
  recommendation: { quoteId: 'qa', text: '[QA] Prysmian Cabos: menor custo total posto (R$ 16.850,00) entre as que chegam a tempo; a mais barata ([QA] Cabos Norte Ltda, R$ 16.000,00) atrasa 7 dia(s).' },
  decision: null,
  href: '/supply/compras?stage=cotacoes&rfq=rfq-1',
};
const REQ = {
  id: 'rq-1', number: 'RC-260924-C451E', status: 'SOURCING', statusLabel: 'Em cotação', qty: 500, unit: 'm', requiredBy: '2026-09-30',
  lineId: '7d3c2b8e-1b0e-4a8c-9a55-1b0f6f7d0c11', href: '/supply/compras?stage=solicitacoes&rq=rq-1', rfqs: [RFQ],
};
const CANDIDATES: SupplierCandidate[] = [
  { supplierId: 'sc', name: '[QA] Eletro Sem Email', status: 'HOMOLOGATED', categories: ['Cabos'], contactName: null, hasEmail: false, hasPhone: true, onTimeRate: 0.99, leadDays: 2, basis: 'category' },
  { supplierId: 'sb', name: '[QA] Cabos Norte Ltda', status: 'HOMOLOGATED', categories: ['Cabos'], contactName: 'Rui', hasEmail: true, hasPhone: true, onTimeRate: 0.82, leadDays: 12, basis: 'history' },
  { supplierId: 'sa', name: '[QA] Prysmian Cabos', status: 'HOMOLOGATED', categories: ['Cabos'], contactName: 'Ana', hasEmail: true, hasPhone: false, onTimeRate: 0.96, leadDays: 4, basis: 'both' },
  { supplierId: 'sp', name: '[QA] Prospect Fios', status: 'PROSPECT', categories: ['Cabos'], contactName: null, hasEmail: true, hasPhone: false, onTimeRate: null, leadDays: null, basis: 'category' },
];
const CAPS = { request: true, source: true, approve: false, suppliersManage: true, reserve: true, transfer: true,
  aiSearch: { available: false, reason: 'Busca externa desligada nesta instalação' } };

const SUPPLY: SiteSupplyData = {
  focus: BALANCE, materials: [BALANCE],
  stock: { state: 'ok', data: STOCK },
  orders: { state: 'ok', data: [] },
  apex: { state: 'ok', data: [] },
  decisions: { state: 'ok', data: [] },
  site: { lat: -3.7662, lng: -49.6725 },
  plan: { state: 'ok', data: PLAN_OK },
  procurement: { state: 'ok', data: { requisitions: [REQ] } },
  suppliers: { state: 'ok', data: CANDIDATES },
  capabilities: CAPS,
  truncated: false,
};

const PROPS: ModuleProps = {
  projectId: 'qa-scn-tucurui', siteName: 'SE Tucuruí 138 kV — Ampliação do pátio', today: TODAY, enter: 1,
  onMapLayer: () => undefined, onNavigate: () => undefined, onExplain: () => undefined, onChanged: () => undefined,
};
const PROJECT = { id: 'qa-scn-tucurui', name: 'SE Tucuruí 138 kV — Ampliação do pátio' };
const api = (part: string) => `/api/dashboard/site/qa-scn-tucurui/${part}`;
const ready = (data: unknown) => ({ data, state: 'ready', message: null });
const render = (C: (p: ModuleProps) => React.ReactNode, props: Partial<ModuleProps> = {}) =>
  renderToStaticMarkup(h(C as React.FC<ModuleProps>, { ...PROPS, ...props }));

beforeEach(() => resources.clear());

/* ══════════════════════════════════════════════════════════════════════════ */

describe('datas do protótipo', () => {
  it('dia de calendário sem fuso; data inválida é null, nunca NaN', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-10-18T23:30:00Z')).toBe(dayNumber('2026-10-18'));
    expect(dayNumber('2026-02-31')).toBeNull();
    expect(dayNumber('2026-13-01')).toBeNull();
    expect(dayNumber('ontem')).toBeNull();
    expect(dayNumber(null)).toBeNull();
    expect(dayNumber(undefined)).toBeNull();
  });

  it('"18 OUT" em pt-BR, "—" sem data; janela da atividade', () => {
    expect(dayMonth('2026-10-18')).toBe('18 OUT');
    expect(dayMonth('2026-09-05')).toBe('05 SET');
    expect(dayMonth('2027-02-01')).toBe('01 FEV');
    expect(dayMonth(null)).toBe('—');
    expect(spanLabel('2026-10-18', '2026-10-31')).toBe('18 OUT — 31 OUT');
    expect(spanLabel('2026-10-31', '2026-10-18')).toBe('18 OUT — 31 OUT');
    expect(spanLabel('2026-10-22', '2026-10-22')).toBe('22 OUT');
    expect(spanLabel(null, null)).toBe('sem datas no cronograma');
    expect(weekday(dayNumber('2026-09-28') as number)).toBe(1); // segunda-feira
  });
});

describe('Gantt · escala', () => {
  it('janela do servidor (fim inclusivo) com meses SET/OUT nas frações certas', () => {
    const s = ganttScale({ window: PLAN.window, activities: ACTIVITIES, today: TODAY });
    expect(s.d1 - s.d0).toBe(69);
    expect(s.months.map((m) => m.label)).toEqual(['SET', 'OUT']);
    expect(s.months[0].x).toBeCloseTo(10 / 69, 6);
    expect(s.at(dayNumber('2026-08-22'))).toBe(0);
    expect(s.at(dayNumber('2026-10-30'))).toBe(1);
    expect(s.at(dayNumber('2026-12-01'))).toBeNull();
    expect(s.clampAt(dayNumber('2026-12-01'))).toBe(1);
    expect(s.clampAt(null)).toBeNull();
    expect(s.at(Number.NaN)).toBeNull();
    // marcas nas segundas, nunca coladas no rótulo do mês
    for (const t of s.ticks) {
      expect(Number.isFinite(t.x)).toBe(true);
      expect(Number(t.label)).toBeGreaterThanOrEqual(6);
    }
    expect(s.ticks.map((t) => t.label)).toContain('28');
  });

  it('janela inválida ou invertida cai para as datas das atividades; sem nenhuma data, em torno de hoje', () => {
    const inverted = ganttScale({ window: { start: '2026-10-29', end: '2026-08-22' }, activities: ACTIVITIES, today: null });
    expect(inverted.d0).toBe(dayNumber('2026-08-25'));
    expect(inverted.d1).toBe((dayNumber('2026-10-22') as number) + 1);
    const empty = ganttScale({ window: { start: 'x', end: null }, activities: [act({ id: 'a' })], today: TODAY });
    expect(empty.at(dayNumber(TODAY))).not.toBeNull();
    expect(empty.d1 - empty.d0).toBeGreaterThanOrEqual(14);
    const nothing = ganttScale({ window: null, activities: [], today: null });
    expect(Number.isFinite(nothing.d0) && Number.isFinite(nothing.d1)).toBe(true);
  });

  it('hoje e a necessidade perto da janela esticam o eixo; longe, não são desenhados', () => {
    const near = ganttScale({ window: { start: '2026-10-01', end: '2026-10-31' }, activities: [], today: TODAY, include: ['2026-11-10'] });
    expect(near.at(dayNumber(TODAY))).not.toBeNull();
    expect(near.at(dayNumber('2026-11-10'))).not.toBeNull();
    const far = ganttScale({ window: { start: '2026-10-01', end: '2026-10-31' }, activities: [], today: '2025-01-01' });
    expect(far.at(dayNumber('2025-01-01'))).toBeNull();
    expect(far.d0).toBe(dayNumber('2026-10-01'));
  });

  it('janela longa: sem marcas de dia, meses espaçados e com ano', () => {
    const s = ganttScale({ window: { start: '2026-01-01', end: '2027-12-31' }, activities: [], today: null });
    expect(s.ticks).toEqual([]);
    expect(s.months.length).toBeLessThanOrEqual(13);
    expect(s.months[0].label).toBe('JAN 26');
  });
});

describe('Gantt · linhas, dependências, hachura, bandeiras', () => {
  const scale = ganttScale({ window: PLAN.window, activities: ACTIVITIES, today: TODAY, include: ['2026-09-30'] });
  const rows = ganttRows(ACTIVITIES, scale);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  it('tons do protótipo: concluída verde, em andamento teal, em risco âmbar tracejado, planejada cinza', () => {
    expect(byId.mob.tone).toBe('done');
    expect(byId.insp.tone).toBe('run');
    expect(byId.cabo.tone).toBe('warn');
    expect(byId.disj.tone).toBe('plan');
    expect(byId.mob.pctText).toBe('100%');
    expect(percentOf(Number.NaN)).toBeNull();
    expect(percentOf(140)).toBe(100);
    expect(ganttRows([act({ id: 'x', percent: null })], scale)[0].pctText).toBe('—');
  });

  it('pílula: vencida > bloqueada > crítica; marco é losango sem barra', () => {
    expect(byId.insp.pill).toEqual({ kind: 'overdue', label: 'Vencida' });
    expect(byId.cabo.pill).toEqual({ kind: 'critical', label: 'Crítica' });
    expect(ganttRows([act({ id: 'b', blocked: true, critical: true })], scale)[0].pill?.kind).toBe('blocked');
    expect(byId.energ.bar).toBeNull();
    expect(byId.energ.diamond).toBeCloseTo((dayNumber('2026-10-22')! - scale.d0) / (scale.d1 - scale.d0), 6);
    expect(byId.mob.pill).toBeNull();
  });

  it('barra: fim inclusivo, datas invertidas trocadas, uma data só vira um dia, fora da janela some', () => {
    const [swapped, single, outside, none] = ganttRows([
      act({ id: 's', start: '2026-10-06', finish: '2026-09-16' }),
      act({ id: 'o', start: '2026-10-01' }),
      act({ id: 'f', start: '2027-06-01', finish: '2027-06-10' }),
      act({ id: 'n' }),
    ], scale);
    expect(swapped.bar).toEqual({ x0: scale.at(dayNumber('2026-09-16')), x1: scale.at(dayNumber('2026-10-07')) });
    expect(single.bar!.x1).toBeGreaterThan(single.bar!.x0);
    expect(outside.bar).toBeNull();
    expect(none.bar).toBeNull();
    expect(none.diamond).toBeNull();
  });

  it('dependências: caminho FS sem NaN, seta para o foco; elo sem linha/sem data ou eixo sem medida some', () => {
    const paths = ganttLinkPaths(PLAN.links, rows, { w: 620, rowH: 43 }, 'cabo');
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(p.d).toMatch(/^M[\d.]+,[\d.]+ /);
      expect(p.d).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(paths.find((p) => p.key.startsWith('mont>cabo'))?.toFocus).toBe(true);
    expect(paths.find((p) => p.key.startsWith('cabo>energ'))?.toFocus).toBe(false);
    expect(ganttLinkPaths(PLAN.links, rows, { w: 0, rowH: 43 }, null)).toEqual([]);
    expect(ganttLinkPaths(PLAN.links, rows, { w: Number.NaN, rowH: 43 }, null)).toEqual([]);
    const noDates = ganttRows([act({ id: 'a' }), act({ id: 'b', start: '2026-09-20', finish: '2026-09-22' })], scale);
    expect(ganttLinkPaths([{ from: 'a', to: 'b', type: 'FS', lagDays: 0 }, { from: 'b', to: 'zz', type: 'SS', lagDays: 0 }], noDates, { w: 600, rowH: 40 }, null)).toEqual([]);
    // sucessor ACIMA do predecessor também desenha, sem NaN
    const up = ganttLinkPaths([{ from: 'disj', to: 'mob', type: 'FF', lagDays: 0 }], rows, { w: 600, rowH: 40 }, null);
    expect(up).toHaveLength(1);
    expect(up[0].d).not.toMatch(/NaN/);
  });

  it('hachura entre hoje e a necessidade, em qualquer ordem; sem uma das datas, nada', () => {
    const g = gapSpan(scale, TODAY, '2026-09-30')!;
    expect(g.x1).toBeGreaterThan(g.x0);
    expect(gapSpan(scale, '2026-09-30', TODAY)).toEqual(g);
    expect(gapSpan(scale, TODAY, null)).toBeNull();
    expect(gapSpan(scale, TODAY, TODAY)).toBeNull();
    expect(gapSpan(scale, '2030-01-01', '2030-02-01')).toBeNull();
  });

  it('foco: o escolhido → o do servidor → a primeira folha', () => {
    expect(focusActivity(PLAN, 'disj')?.id).toBe('disj');
    expect(focusActivity(PLAN, 'sumiu')?.id).toBe('cabo');
    expect(focusActivity({ ...PLAN, focus: null }, null)?.id).toBe('mob');
    expect(focusActivity({ activities: [], focus: 'x' }, null)).toBeNull();
  });

  it('pílula perto da borda vai para antes da barra; bandeiras "Hoje" e "Necessário até" não se encostam', () => {
    expect(pillSide(0.3, 0.5, 600, 'Crítica')).toBe('after');
    expect(pillSide(0.6, 0.97, 600, 'Crítica')).toBe('before');
    expect(pillSide(0.05, 0.97, 600, 'Crítica')).toBe('inside');
    const close = flagSides({ todayX: 0.45, needX: 0.52, w: 620, todayLabel: 'Hoje · 25 SET', needLabel: 'Necessário até 30 SET' });
    expect(close).toEqual({ today: 'left', need: 'right' });
    const apart = flagSides({ todayX: 0.1, needX: 0.6, w: 620, todayLabel: 'Hoje · 25 SET', needLabel: 'Necessário até 30 SET' });
    expect(apart).toEqual({ today: 'right', need: 'right' });
    const edge = flagSides({ todayX: 0.95, needX: null, w: 620, todayLabel: 'Hoje · 25 SET', needLabel: '' });
    expect(edge.today).toBe('left');
  });

  it('necessidade: falta = linha âmbar; sem cobertura, só a data passada acende âmbar', () => {
    expect(needTone({ status: 'short', requiredBy: null }, TODAY)).toBe('warn');
    expect(needTone({ status: 'covered', requiredBy: null }, TODAY)).toBe('ok');
    expect(needTone({ status: 'partial', requiredBy: null }, TODAY)).toBe('partial');
    expect(needTone({ status: 'unknown', requiredBy: '2026-09-22' }, TODAY)).toBe('late');
    expect(needTone({ status: 'unknown', requiredBy: '2026-10-08' }, TODAY)).toBe('unknown');
  });
});

describe('Supply · balanço, pedidos e mapa', () => {
  it('as linhas do protótipo, com a cobertura viva e a unidade do requisito', () => {
    const rows = balanceRows(BALANCE);
    expect(rows.map((r) => r.label)).toEqual(['Necessário', 'Reservado', 'Consumido', 'Em trânsito', 'Pedido', 'Em requisição', 'Coberto', 'Falta']);
    expect(rows.find((r) => r.key === 'required')?.text).toBe('1.200 m');
    expect(rows.find((r) => r.key === 'covered')).toMatchObject({ text: '300 m', tone: 'ok' });
    expect(rows.find((r) => r.key === 'shortage')).toMatchObject({ text: '500 m', tone: 'danger' });
    const covered = balanceRows({ ...BALANCE, shortage: 0, requested: 0 });
    expect(covered.find((r) => r.key === 'shortage')).toMatchObject({ text: '0 m · coberto', tone: 'good' });
    expect(covered.some((r) => r.key === 'requested')).toBe(false);
    expect(balanceRows({ ...BALANCE, shortage: Number.NaN }).find((r) => r.key === 'shortage')?.text).toBe('—');
  });

  it('barra de cobertura proporcional, sem segmento vazio', () => {
    expect(coverageSegments(BALANCE).map((s) => [s.key, s.qty, s.text])).toEqual([
      ['covered', 300, 'Coberto · 300 m'], ['inbound', 400, 'A caminho · 400 m'], ['shortage', 500, 'Falta · 500 m'],
    ]);
    expect(coverageSegments({ ...BALANCE, covered: 0, inbound: 0, shortage: 0 })).toEqual([]);
  });

  it('chegada COMPARADA à necessidade — nunca "atrasa"', () => {
    const o = (p: Partial<InboundOrder>) => ({ expected: '2026-10-14', late: false, lateDays: null, ...p });
    expect(orderTiming(o({ late: true, lateDays: 10 }), '2026-10-04')).toEqual({ tone: 'late', text: 'chega 10 dias depois da necessidade' });
    expect(orderTiming(o({ late: true, lateDays: 1 }), '2026-10-13').text).toBe('chega 1 dia depois da necessidade');
    expect(orderTiming(o({ late: true, lateDays: null }), '2026-10-04').text).toBe('chega depois da necessidade');
    expect(orderTiming(o({}), '2026-10-20')).toEqual({ tone: 'ok', text: 'chega até a necessidade' });
    expect(orderTiming(o({ expected: null }), '2026-10-20').tone).toBe('none');
    for (const t of [orderTiming(o({ late: true, lateDays: 3 }), null), orderTiming(o({}), null)]) expect(t.text).not.toMatch(/atras/i);
  });

  it('camada do mapa: canteiro fora; almoxarifado no canteiro com cartão e sem arco; saldo → arco cheio; sem saldo → tracejado', () => {
    const layer = supplyMapLayer(SUPPLY);
    expect(layer.nodes!.map((n) => n.id)).toEqual(['stock:cant-mar', 'stock:belem', 'stock:norte']);
    expect(layer.nodes!.find((n) => n.id === 'stock:cant-mar')).toMatchObject({ tone: 'hit', value: '250 m disponíveis', title: 'Canteiro LT Marabá' });
    expect(layer.nodes!.find((n) => n.id === 'stock:belem')).toMatchObject({ tone: 'none', value: 'sem saldo disponível' });
    expect(layer.arcs!.map((a) => a.id)).toEqual(['stock:cant-mar', 'stock:belem']);
    const hit = layer.arcs![0];
    expect(hit).toMatchObject({ tone: 'completed', dash: null, to: { lat: -3.7662, lng: -49.6725 } });
    expect(hit.flow).toBeGreaterThan(0);
    const dim = layer.arcs![1];
    expect(dim).toMatchObject({ tone: 'healthy', dash: [6, 8], flow: 0 });
    expect(dim.alpha).toBeLessThan(hit.alpha!);
    expect(JSON.stringify(layer)).not.toMatch(/NaN|null,"lng"/);
  });

  it('enquadramento: cabe canteiro + almoxarifados; só o canteiro → sem enquadramento próprio', () => {
    const v = supplyMapLayer(SUPPLY).view!;
    expect(v).toMatchObject({ pitch: 64, heading: -6, ox: -60, oy: -30 });
    expect(v.lat).toBeCloseTo((-5.3686 + -1.4558) / 2, 4);
    // norte–sul ≈ 434 km → ~977 km de distância (Marabá e Belém no vão entre os painéis)
    expect(v.dist).toBeGreaterThan(900);
    expect(v.dist).toBeLessThan(1100);
    expect(supplyMapLayer({ ...SUPPLY, stock: { state: 'ok', data: [STOCK[0]] } }).view).toBeNull();
    expect(supplyMapLayer({ ...SUPPLY, stock: { state: 'restricted' } })).toEqual({ arcs: [], nodes: [], view: null });
    expect(frameView([{ lat: -3.7662, lng: -49.6725 }])!.dist).toBe(60);
    expect(frameView([{ lat: 5, lng: -70 }, { lat: -33, lng: -35 }])!.dist).toBe(2400);
    expect(frameView([{ lat: Number.NaN, lng: 1 }])).toBeNull();
  });

  it('sem canteiro localizado: cartões sim, arco nenhum (o destino não tem ponto)', () => {
    const layer = supplyMapLayer({ ...SUPPLY, site: null });
    expect(layer.arcs).toEqual([]);
    expect(layer.nodes!.length).toBe(3);
  });
});

describe('Faturamento · eventograma e cadeia', () => {
  it('cores do protótipo por estado; estado desconhecido é apagado', () => {
    expect(EVENT_TONE.awaiting).toBe('muted');
    expect(eventTone('eligible')).toBe('accent');
    expect(eventTone('pending_release')).toBe('accent');
    expect(eventTone('invoiced')).toBe('ok');
    expect(eventTone('paid')).toBe('ok');
    expect(eventTone('blocked')).toBe('danger');
    expect(eventTone('cancelled')).toBe('cancelled');
    expect(eventTone('QUALQUER')).toBe('muted');
  });

  it('contexto: medição · NF · recebível — só o que existe', () => {
    expect(eventContext({ measurement: { id: 'm', status: 'ACCEPTED', statusLabel: 'Aceita' }, fiscal: null, receivable: null })).toBe('Medição aceita');
    expect(eventContext({ measurement: null, fiscal: { number: '2026/1187', status: 'authorized', statusLabel: 'Autorizada' },
      receivable: { due: '2026-12-05', state: 'OPEN', stateLabel: 'Em aberto' } })).toBe('NF 2026/1187 · autorizada · em aberto · vence 05 DEZ');
    expect(eventContext({ measurement: null, fiscal: null, receivable: null })).toBe('');
    // O estado da NF que já é o estado da linha não se repete no contexto.
    expect(eventContext({ measurement: { id: 'm', status: 'ACCEPTED', statusLabel: 'Aceita' },
      fiscal: { number: null, status: null, statusLabel: 'Fiscal bloqueado por configuração' }, receivable: null,
      stateLabel: 'Fiscal bloqueado por configuração' })).toBe('Medição aceita');
  });

  it('"Entender" dos outros eventos no formato documentado, só quando a do foco existe', () => {
    expect(billingRef({ focus: 'e1', focusExplainRef: 'bill:e1' }, 'e1')).toBe('bill:e1');
    expect(billingRef({ focus: 'e1', focusExplainRef: 'bill:e1' }, 'e2')).toBe('bill:e2');
    expect(billingRef({ focus: 'e1', focusExplainRef: null }, 'e2')).toBeNull();
    expect(billingRef({ focus: 'e1', focusExplainRef: 'bill:e1' }, null)).toBeNull();
  });

  it('passo do stepper pelo ESTADO do elo (nunca pelo texto)', () => {
    expect(stepState({ state: 'found', tone: 'success' })).toBe('done');
    expect(stepState({ state: 'found' })).toBe('done');
    expect(stepState({ state: 'found', tone: 'warning' })).toBe('wait');
    expect(stepState({ state: 'found', tone: 'danger' })).toBe('danger');
    expect(stepState({ state: 'pending' })).toBe('pending');
    expect(stepState({ state: 'restricted' })).toBe('restricted');
    expect(stepState({ state: 'unconfirmed' })).toBe('attention');
    expect(stepState({ state: 'none', tone: 'warning' })).toBe('attention');
    expect(stepState({ state: 'none' })).toBe('none');
  });
});

describe('Decisão · o mesmo ato do DecisionPanel', () => {
  const detail = { key: 'purchase_order:po-1:s1', item: { fingerprint: 'fp-item' }, resolved: { fingerprint: 'fp-resolved' } } as unknown as DecisionDetail;

  it('corpo: ação, justificativa normalizada, a impressão digital da tela, a intenção', () => {
    expect(decisionActBody(detail, 'APPROVE', '  ok, dentro da política  ', 'intent-1'))
      .toEqual({ action: 'APPROVE', reason: 'ok, dentro da política', expectedFingerprint: 'fp-item', intentId: 'intent-1' });
    expect(decisionActBody({ ...detail, item: null } as unknown as DecisionDetail, 'REJECT', '   ', 'i2'))
      .toEqual({ action: 'REJECT', reason: null, expectedFingerprint: 'fp-resolved', intentId: 'i2' });
  });

  it('POST /api/decisions/[chave]/act e a leitura da resposta; rede caída é "incerto", nunca "feito"', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ outcome: 'RECORDED', message: 'Aprovação registrada.', resolved: null, downstream: { applied: true, status: 'APPROVED' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const body = decisionActBody(detail, 'APPROVE', '', 'intent-1');
    expect(await postDecisionAct(detail.key, body, ok)).toEqual({ kind: 'done', replay: false, message: 'Aprovação registrada.', downstreamPending: false });
    expect(calls[0].url).toBe('/api/decisions/purchase_order%3Apo-1%3As1/act');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
    const stale = (async () => new Response(JSON.stringify({ code: 'STALE', message: 'A decisão mudou.' }), { status: 409 })) as unknown as typeof fetch;
    expect((await postDecisionAct(detail.key, body, stale)).kind).toBe('stale');
    const down = (async () => { throw new TypeError('rede'); }) as unknown as typeof fetch;
    expect((await postDecisionAct(detail.key, body, down)).kind).toBe('error');
  });
});

/* ── Tela (react-dom/server) ──────────────────────────────────────────── */

describe('Tela · Planejar', () => {
  it('o Gantt e a atividade em foco na gramática do protótipo, com dado real e sem NaN', () => {
    resources.set(api('plan'), ready({ ok: true, today: TODAY, project: PROJECT, plan: { state: 'ok', data: PLAN } } satisfies SitePlanResponse));
    const html = render(PlanModule);
    expect(html).toContain('data-testid="dg-plan"');
    expect(html).toContain('Necessário até 30 SET');
    expect(html).toContain('Hoje · 25 SET');
    expect(html).toContain('Crítica');
    expect(html).toContain('Vencida');
    expect(html).toContain('dgm-gantt-gap');
    expect(html).toContain('Atividade crítica');
    expect(html).toContain('Lançamento de cabos de potência');
    expect(html).toContain('30 SET — 14 OUT · 0% concluído');
    expect(html).toContain('1.200 m');
    expect(html).toContain('Falta 500 m');
    expect(html).toContain('Resolver no Supply Chain');
    expect((html.match(/data-testid="dg-gantt-row"/g) ?? []).length).toBe(6);
    expect(html).toMatch(/data-dim="true"/);
    expect(html).not.toMatch(/NaN|Infinity|undefined%/);
  });

  it('Restrito nunca é 0; leitura que falhou nunca é calma; sem cronograma é dito', () => {
    resources.set(api('plan'), ready({ ok: true, today: TODAY, project: PROJECT, plan: { state: 'restricted' } }));
    expect(render(PlanModule)).toContain('Restrito');
    resources.set(api('plan'), ready({ ok: true, today: TODAY, project: PROJECT, plan: { state: 'error', message: 'A leitura do cronograma falhou.' } }));
    const failed = render(PlanModule);
    expect(failed).toContain('O cronograma não carregou');
    expect(failed).toContain('A leitura do cronograma falhou.');
    resources.set(api('plan'), { data: null, state: 'error', message: 'Seu perfil não lê este projeto.' });
    expect(render(PlanModule)).toContain('Seu perfil não lê este projeto.');
    resources.set(api('plan'), ready({ ok: true, today: TODAY, project: PROJECT, plan: { state: 'ok', data: { ...PLAN, activities: [], focus: null } } }));
    expect(render(PlanModule)).toContain('Projeto sem cronograma registrado');
  });

  it('necessidades Restritas / que não carregaram aparecem assim na atividade', () => {
    resources.set(api('plan'), ready({ ok: true, today: TODAY, project: PROJECT, plan: { state: 'ok', data: { ...PLAN, focus: 'mont' } } }));
    expect(render(PlanModule)).toContain('Seu perfil não lê as necessidades desta atividade.');
    resources.set(api('plan'), ready({ ok: true, today: TODAY, project: PROJECT, plan: { state: 'ok', data: { ...PLAN, focus: 'insp' } } }));
    expect(render(PlanModule)).toContain('As necessidades não carregaram');
  });
});

describe('Supply · fluxo guiado: a varredura da rede (cena 3)', () => {
  const SITE = { lat: -3.7662, lng: -49.6725 };
  const located = STOCK.filter((n) => !n.isSite && Number.isFinite(n.lat) && n.lat !== null);

  it('alcance dos anéis: o nó mais longe × 1,15, nunca abaixo de 30 km; coordenada quebrada não conta', () => {
    const far = haversineKm(SITE, { lat: -1.4558, lng: -48.4902 }); // Belém, ~288 km
    expect(scanRadiusKm(SITE, located)).toBeCloseTo(far * 1.15, 0);
    expect(scanRadiusKm(SITE, [STOCK[3]])).toBe(SCAN_MIN_KM); // almoxarifado no próprio canteiro
    expect(scanRadiusKm(SITE, [])).toBe(SCAN_MIN_KM);
    expect(Number.isFinite(scanRadiusKm(SITE, [STOCK[5], STOCK[4]]))).toBe(true);
  });

  it('respostas por nó com os MESMOS ids dos cartões: saldo → hit "250 m disponíveis"; sem saldo → none', () => {
    const res = scanResults(STOCK.filter((n) => ['cant-mar', 'belem'].includes(n.locationId)), 'm');
    expect(res).toEqual({
      'stock:cant-mar': { tone: 'hit', value: '250 m disponíveis' },
      'stock:belem': { tone: 'none', value: 'sem saldo disponível' },
    });
  });

  it('antes do clique: perto do canteiro, SEM nós nem arcos (o filme antes da varredura)', () => {
    const idle = supplyFlowLayer(SUPPLY, { stage: 'idle', scanId: null, fresh: false });
    expect(idle).toMatchObject({ arcs: [], nodes: [], scan: null, drift: null });
    expect(idle.view).toEqual(siteCloseView(SITE));
    expect(idle.view!.dist).toBeLessThan(3);
    expect(supplyFlowLayer({ ...SUPPLY, site: null }, { stage: 'idle', scanId: null, fresh: false }).view).toBeNull();
  });

  it('varrendo, antes da releitura voltar: "consultando" (resultados null), nenhum arco adianta a resposta; deriva e status', () => {
    const l = supplyFlowLayer(SUPPLY, { stage: 'scanning', scanId: 'scan:1', fresh: false });
    expect(l.nodes!.map((n) => n.id)).toEqual(['stock:cant-mar', 'stock:belem', 'stock:norte']);
    expect(l.nodes!.every((n) => n.value === null && n.tone === 'default')).toBe(true);
    expect(l.arcs).toEqual([]);
    expect(l.scan).toMatchObject({ id: 'scan:1', origin: SITE, statusText: SCAN_STATUS_TEXT });
    expect(Object.values(l.scan!.results)).toEqual([null, null, null]);
    expect(Object.keys(l.scan!.results)).toEqual(l.nodes!.map((n) => n.id));
    expect(l.drift).toEqual({ ...SCAN_DRIFT });
    expect(l.drift).toEqual({ headingDeg: -4, distK: 0.95, seconds: 4.6 });
  });

  it('releitura de volta: respostas, arcos (saldo cheio com fluxo, sem saldo tracejado) — a MESMA varredura (id) até o fim', () => {
    const l = supplyFlowLayer(SUPPLY, { stage: 'scanning', scanId: 'scan:1', fresh: true });
    expect(l.scan!.results['stock:cant-mar']).toEqual({ tone: 'hit', value: '250 m disponíveis' });
    expect(l.scan!.results['stock:belem']).toEqual({ tone: 'none', value: 'sem saldo disponível' });
    expect(l.arcs!.map((a) => [a.id, a.flow! > 0, a.dash])).toEqual([['stock:cant-mar', true, null], ['stock:belem', false, [6, 8]]]);
    expect(l.nodes!.find((n) => n.id === 'stock:cant-mar')).toMatchObject({ tone: 'hit', value: '250 m disponíveis' });
    const revealed = supplyFlowLayer(SUPPLY, { stage: 'revealed', scanId: 'scan:1', fresh: true });
    expect(revealed.scan!.id).toBe('scan:1');
    expect(revealed.arcs).toEqual(l.arcs);
    expect(JSON.stringify(revealed)).not.toMatch(/NaN|Infinity/);
  });

  it('enquadramento da varredura: centro no canteiro, cabe o anel (canteiro ± alcance) e os nós; atalho direto sem varredura', () => {
    const l = supplyFlowLayer(SUPPLY, { stage: 'scanning', scanId: 'scan:1', fresh: false });
    const R = l.scan!.radiusKm;
    expect(l.view!.lat).toBeCloseTo(SITE.lat, 3);
    expect(l.view!.lng).toBeCloseTo(SITE.lng, 3);
    expect(l.view!.dist).toBeGreaterThan(R * 3);
    expect(l.view!.dist).toBeLessThanOrEqual(2400);
    expect(l.view!).toMatchObject({ pitch: 62, heading: -6 });
    expect(scanView(SITE, 5000, located)!.dist).toBe(2400);
    // plano revelado: a câmera assenta no enquadramento do Supply (nós no vão entre os DOIS painéis)
    const revealed = supplyFlowLayer(SUPPLY, { stage: 'revealed', scanId: 'scan:1', fresh: true });
    const classic = supplyMapLayer(SUPPLY).view!;
    expect(revealed.view).toMatchObject({ lat: classic.lat, lng: classic.lng, pitch: 64, heading: -6, ox: -120, oy: -30 });
    expect(revealed.view!.dist).toBeGreaterThan(classic.dist);
    expect(revealed.view!.dist).toBeLessThan(classic.dist * 1.5);
    const direct = supplyFlowLayer(SUPPLY, { stage: 'direct', scanId: null, fresh: false });
    expect(direct.view).toEqual(revealed.view);
    expect(direct.scan).toBeNull();
    expect(direct.drift).toBeNull();
    expect(direct.arcs!.length).toBe(2);
    expect(direct.nodes!.every((n) => n.value !== null)).toBe(true);
  });

  it('sem canteiro localizado: sem origem → sem anéis e sem arcos; os nós são enquadrados', () => {
    const l = supplyFlowLayer({ ...SUPPLY, site: null }, { stage: 'scanning', scanId: 'scan:1', fresh: true });
    expect(l.scan).toBeNull();
    expect(l.arcs).toEqual([]);
    expect(l.nodes!.length).toBe(3);
    expect(l.view).not.toBeNull();
  });

  it('o livro-razão da rede: onde há saldo, quantos sem saldo, os sem coordenada; Restrito não vira "sem saldo"', () => {
    const net = networkSummary(SUPPLY);
    expect(net.hits).toEqual([
      { id: 'sem-coord', name: 'Almoxarifado sem coordenada', text: '+ 90 m' },
      { id: 'cant-mar', name: 'Canteiro LT Marabá', text: '+ 250 m' },
      { id: 'nan', name: 'Coordenada quebrada', text: '+ 5 m' },
    ].sort((a, b) => Number(b.text.replace(/\D/g, '')) - Number(a.text.replace(/\D/g, ''))));
    expect(net.empty).toBe(2);
    expect(net.unlocated).toBe(2);
    expect(networkSummary({ ...SUPPLY, stock: { state: 'restricted' } })).toEqual({ state: 'restricted', hits: [], empty: 0, unlocated: 0 });
  });
});

describe('Supply · fluxo guiado: plano, solicitação, fornecedores', () => {
  it('plano na ordem do filme (reservar → transferir → comprar), 0,32 s entre passos; a ordem do servidor dentro do tipo', () => {
    const steps = [PLAN_OK.steps[2], { ...PLAN_OK.steps[1], from: { ...PLAN_OK.steps[1].from!, locationId: 'belem', name: 'Belém' } }, PLAN_OK.steps[0], PLAN_OK.steps[1]];
    const out = planSteps({ steps });
    expect(out.map((s) => `${s.kind}:${s.from?.locationId ?? '-'}`)).toEqual(['reserve:cant-tuc', 'transfer:belem', 'transfer:cant-mar', 'buy:-']);
    expect(out.map((s) => s.delayMs)).toEqual([0, PLAN_STAGGER_MS, 2 * PLAN_STAGGER_MS, 3 * PLAN_STAGGER_MS]);
    expect(PLAN_STAGGER_MS).toBe(320);
    expect(new Set(out.map((s) => s.key)).size).toBe(4);
  });

  it('corpo da ação do passo: o do servidor + a chave da intenção (sem sobrescrever a do servidor)', () => {
    const t = PLAN_OK.steps[1];
    expect(planActionBody(t, 'intent-123')).toEqual({ ...t.action!.body, idempotencyKey: 'intent-123' });
    const withKey = { ...t, action: { ...t.action!, body: { ...t.action!.body, idempotencyKey: 'server-key' } } };
    expect(planActionBody(withKey, 'intent-123')!.idempotencyKey).toBe('server-key');
    expect(planActionBody(PLAN_OK.steps[0], 'x')).toBeNull();
  });

  it('solicitação de compra: o corpo exato da rota (falta → requisição, canteiro como entrega, prioridade pelo risco)', () => {
    expect(siteLocationId(SUPPLY)).toBe('cant-tuc');
    expect(siteLocationId({ stock: { state: 'restricted' } })).toBeNull();
    expect(requisitionBody(BALANCE, 'cant-tuc', 'intent-abc-123')).toEqual({
      source: 'SHORTAGE', requirementIds: ['ca276394'], deliveryLocationId: 'cant-tuc', priority: 'critical', idempotencyKey: 'intent-abc-123',
    });
    expect(requisitionBody({ ...BALANCE, risk: 'ok' }, null, 'k-12345678').priority).toBe('low');
    // a falta toda já requisitada (500 de 500) → nada a criar; sem solicitação e com falta → cria; sem permissão ou sem leitura → não
    expect(canCreateRequisition(SUPPLY)).toBe(false);
    const none = { ...SUPPLY, focus: { ...BALANCE, requested: 0 }, procurement: { state: 'ok' as const, data: { requisitions: [] } } };
    expect(canCreateRequisition(none)).toBe(true);
    expect(canCreateRequisition({ ...none, capabilities: { ...CAPS, request: false } })).toBe(false);
    expect(canCreateRequisition({ ...none, procurement: { state: 'restricted' } })).toBe(false);
    expect(canCreateRequisition({ ...none, plan: { state: 'ok', data: { ...PLAN_OK, remainingShortage: 0 } } })).toBe(false);
    expect(remainingToBuy({ plan: { state: 'error', message: 'x' }, focus: BALANCE })).toBe(0); // falta 500, já requisitados 500
  });

  it('a quantidade da confirmação é a do BANCO (falta − requisitado em aberto), com o aviso quando o plano ainda sugere reservar/transferir', () => {
    // falta 500, nada requisitado, o plano sugere transferir 250 de Marabá → o banco requisitaria 500; o plano, 250
    const data = { plan: { state: 'ok' as const, data: { ...PLAN_OK, steps: PLAN_OK.steps.slice(0, 2), remainingShortage: 250 } }, focus: { ...BALANCE, requested: 0 } };
    expect(requisitionQty(data.focus)).toBe(500);
    expect(planToRequisition(data)).toBe(250);
    expect(requisitionPreview(data)).toMatchObject({ qty: 500, planQty: 250, extra: 250, openSteps: [{ kind: 'transfer', qty: 250 }] });
    // transferência feita (o plano não sugere mais nada): sem diferença
    const after = { plan: { state: 'ok' as const, data: { ...PLAN_OK, steps: [], remainingShortage: 250 } }, focus: { ...BALANCE, shortage: 250, requested: 0 } };
    expect(requisitionPreview(after)).toMatchObject({ qty: 250, planQty: 250, extra: 0 });
    expect(requisitionQty(null)).toBeNull();
    expect(requisitionQty({ shortage: Number.NaN, requested: 0 })).toBeNull();
  });

  it('solicitação antiga não esconde a falta que cresceu: a pedida (já com pedido) fica listada E "Criar solicitação" volta', () => {
    const ordered = { ...REQ, status: 'ORDERED', statusLabel: 'Pedido emitido', rfqs: [] };
    const grown: SiteSupplyData = {
      ...SUPPLY, focus: { ...BALANCE, shortage: 300, requested: 0 }, procurement: { state: 'ok', data: { requisitions: [ordered] } },
      plan: { state: 'ok', data: { ...PLAN_OK, steps: [{ ...PLAN_OK.steps[2], qty: 300, status: 'suggested', reason: null }], remainingShortage: 300 } },
    };
    expect(canCreateRequisition(grown)).toBe(true);
    expect(flowStates(grown)).toMatchObject({ plan: 'current', requisition: 'current' });
    const html = renderToStaticMarkup(h(RequisitionStep, { ctx: { data: grown, today: TODAY, projectId: 'p', siteName: 's', afterAct: () => undefined }, onCreate: () => undefined }));
    expect(html).toContain('RC-260924-C451E');
    expect(html).toContain('A necessidade cresceu: Falta requisitar <b class="num">300 m</b>');
    expect(html).toContain('data-testid="dg-supply-requisition-create"');
  });

  it('cotação: prazo de resposta sugerido, corpo de abrir e de enviar; os convidados sem envio', () => {
    expect(defaultResponseDue(TODAY, '2026-09-30')).toBe('2026-09-29');
    expect(defaultResponseDue(TODAY, null)).toBe('2026-09-30');
    expect(defaultResponseDue(TODAY, '2026-09-26')).toBe('2026-09-26');
    expect(defaultResponseDue('lixo', null)).toBeNull();
    expect(rfqCreateBody('line-1', ['sa', 'sb', 'sa'], '2026-09-29')).toEqual({ requisitionLineIds: ['line-1'], supplierIds: ['sa', 'sb'], responseDue: '2026-09-29' });
    expect(rfqSendBody(['sb', 'sb'])).toEqual({ supplierIds: ['sb'] });
    // sb não recebeu o e-mail, mas JÁ mandou proposta: não recebe pedido de novo; sc não tem contato
    expect(unsentInvited(RFQ)).toEqual(['sd']);
    expect(unsentInvited({ ...RFQ, quotes: [] })).toEqual(['sb', 'sd']);
    expect(activeRfq(REQ)?.number).toBe('COT-260924-98CDA');
    expect(activeRfq({ rfqs: [{ ...RFQ, status: 'CANCELLED' }] })).toBeNull();
  });

  it('desfecho do envio em português; resposta sem forma é descartada', () => {
    const r = sendResults({ ok: true, results: [
      { supplierId: 'sa', name: 'A', outcome: 'SIMULATED', message: 'capturado' },
      { supplierId: 'sc', name: 'C', outcome: 'NO_CONTACT', message: '' },
      { supplierId: 'x', outcome: 'WHATEVER' },
      null,
    ] });
    expect(r.map((x) => x.outcome)).toEqual(['SIMULATED', 'NO_CONTACT']);
    expect(SEND_OUTCOME.SIMULATED.label).toBe('Registrado — ambiente de teste');
    expect(SEND_OUTCOME.NO_CONTACT.label).toBe('Sem e-mail cadastrado');
    expect(sendResults(null)).toEqual([]);
  });

  it('homologados sugeridos para o convite: com e-mail, mais pontuais primeiro; prospecto e sem e-mail ficam de fora', () => {
    expect(preselectSuppliers(CANDIDATES)).toEqual(['sa', 'sb']);
    expect(preselectSuppliers(CANDIDATES, 1)).toEqual(['sa']);
  });

  it('prospecto da internet: CNPJ só dígitos, origem e fontes nas notas, link perigoso fora, e-mail inválido fora', () => {
    const c: ExternalSupplierCandidate = {
      name: ' Fios do Norte Ltda ', cnpj: '12.345.678/0001-90', site: 'fiosdonorte.com.br', email: 'vendas@fiosdonorte.com.br', phone: '(91) 3333-4444',
      city: 'Belém', uf: 'PA', country: 'Brasil', evidenceUrls: ['https://fiosdonorte.com.br/cabos', 'javascript:alert(1)'], confidence: 'medium', note: null,
    };
    const body = prospectBody(c, TODAY);
    expect(body).toMatchObject({ legalName: 'Fios do Norte Ltda', documentType: 'cnpj', documentNumber: '12345678000190', contactEmail: 'vendas@fiosdonorte.com.br', kind: 'organization' });
    expect(body.notes).toContain('NÃO homologado');
    expect(body.notes).toContain('https://fiosdonorte.com.br/cabos');
    expect(body.notes).not.toContain('javascript');
    expect(prospectBody({ ...c, cnpj: '123', email: 'não é email', country: 'Germany' }, TODAY)).toMatchObject({ documentType: 'foreign', documentNumber: null, contactEmail: null });
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('ftp://x.com')).toBeNull();
    expect(safeHttpUrl('fiosdonorte.com.br')).toBe('https://fiosdonorte.com.br/');
    expect(safeHttpUrl('http://a.com/x?y=1')).toBe('http://a.com/x?y=1');
    expect(safeHttpUrl('not a url')).toBeNull();
  });

  it('CNPJ alfanumérico (2026): mostrado formatado e guardado nas NOTAS (o cadastro ainda o reduziria a dígitos) — nunca vira "estrangeiro"', () => {
    expect(cnpjText('12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35');
    expect(cnpjText('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(cnpjText('12345678000190')).toBe('12.345.678/0001-90');
    expect(cnpjText('12.ABC.345/01DE-3X')).toBeNull(); // verificadores são dígitos
    expect(cnpjText('123')).toBeNull();
    const c: ExternalSupplierCandidate = {
      name: 'Cabos Novos Ltda', cnpj: '12.ABC.345/01DE-35', site: null, email: null, phone: null, city: 'Belém', uf: 'PA', country: 'Brasil',
      evidenceUrls: [], confidence: 'high', note: null,
    };
    const body = prospectBody(c, TODAY);
    expect(body).toMatchObject({ documentType: null, documentNumber: null });
    expect(body.notes).toContain('CNPJ informado (alfanumérico): 12.ABC.345/01DE-35.');
    expect(prospectBody({ ...c, country: 'Germany' }, TODAY).documentType).toBeNull();
  });

  it('antes de "Cadastrar como prospecto": o cadastro interno é conferido por CNPJ, e-mail ou nome (sem sufixo societário)', () => {
    const registry = registryList({ ok: true, suppliers: [
      { id: 's1', name: '[QA] Elétrica Rápida Norte', legalName: '[QA] Elétrica Rápida Norte S.A.', document: '12345678000190', status: 'HOMOLOGATED', contactEmail: 'compras@erapida.com.br' },
      { id: 's2', name: 'Fios Pará', legalName: 'Fios Pará Comércio Ltda', document: null, status: 'BLOCKED', contactEmail: null },
      { id: 42 }, null,
    ] })!;
    expect(registry.map((s) => s.id)).toEqual(['s1', 's2']);
    const cand = (p: Partial<ExternalSupplierCandidate>): ExternalSupplierCandidate => ({
      name: 'Outra Empresa', cnpj: null, site: null, email: null, phone: null, city: null, uf: null, country: null, evidenceUrls: [], confidence: 'low', note: null, ...p,
    });
    expect(registryMatch(cand({ cnpj: '12.345.678/0001-90' }), registry)?.id).toBe('s1');
    expect(registryMatch(cand({ email: 'COMPRAS@erapida.com.br ' }), registry)?.id).toBe('s1');
    expect(registryMatch(cand({ name: 'Fios Para Comercio LTDA.' }), registry)?.id).toBe('s2');
    expect(registryMatch(cand({ name: '[QA] Elétrica Rápida Norte SA' }), registry)?.id).toBe('s1');
    expect(registryMatch(cand({ name: 'Fios' }), registry)).toBeNull();
    expect(companyKey('Prysmian Cabos e Sistemas do Brasil S/A')).toBe('prysmian cabos e sistemas do brasil');
    expect(supplierStatusText('BLOCKED')).toBe('Bloqueado');
    expect(supplierStatusText('WHATEVER')).toBe('no cadastro');
    // resposta sem a lista: "não carregou", nunca "ninguém no cadastro"
    expect(registryList({ ok: false })).toBeNull();
    expect(registryList(null)).toBeNull();
  });

  it('envio da cotação: quem FALHOU continua no botão (tentar de novo tem onde clicar); o resto sai até a releitura', () => {
    const results = sendResults({ results: [
      { supplierId: 'sb', name: 'B', outcome: 'FAILED', message: 'transporte' }, { supplierId: 'sd', name: 'D', outcome: 'SENT', message: '' },
    ] });
    expect(handledBySend(results)).toEqual(['sd']);
    expect(unsentPending(['sb', 'sd'], handledBySend(results))).toEqual(['sb']);
    // tudo falhou: o botão volta com os mesmos convidados
    expect(unsentPending(['sb'], handledBySend(sendResults({ results: [{ supplierId: 'sb', name: 'B', outcome: 'FAILED', message: '' }] })))).toEqual(['sb']);
  });
});

describe('Supply · A × B e a decisão governada', () => {
  it('A = a recomendada pela Apex, B = a mais barata que sobra', () => {
    const pair = abPair(RFQ)!;
    expect(pair.a.quoteId).toBe('qa');
    expect(pair.b!.quoteId).toBe('qb');
    expect(pair.more).toBe(0);
    expect(abPair({ quotes: [], recommendation: null })).toBeNull();
    expect(abPair({ quotes: [QB], recommendation: null })!.b).toBeNull();
  });

  it('dinheiro do texto do servidor: R$ com milhar e centavos; restrito/ausente → null (nunca 0)', () => {
    expect(parseMoneyText('R$ 16.850')).toEqual({ value: 16850, prefix: 'R$' });
    expect(parseMoneyText('R$ 16.850,50')).toEqual({ value: 16850.5, prefix: 'R$' });
    expect(parseMoneyText('-R$ 5,00')).toEqual({ value: -5, prefix: 'R$' });
    expect(parseMoneyText(null)).toBeNull();
    expect(parseMoneyText('Restrito')).toBeNull();
    expect(moneyLike('R$', 850)).toBe('R$ 850');
    expect(moneyLike('R$', 850.5)).toBe('R$ 850,50');
  });

  it('a recomendação do filme, calculada dos totais REAIS: "+ R$ 850 para chegar a tempo" e "− 7 dias de atraso"', () => {
    const rec = recommendationLine(abPair(RFQ)!, true);
    expect(rec.head).toBe('Apex recomenda A: + R$ 850 para chegar a tempo');
    expect(rec.detail).toBe('B custa R$ 850 a menos, mas chega 7 dias depois da necessidade.');
    expect(rec.plus).toBe('+ R$ 850');
    // o que A evita (o filme: "para evitar 4 dias de atraso") — nunca "− 7 dias além da necessidade" em verde
    expect(rec.minus).toBe('− 7 dias de atraso');
    expect(rec.caveat).toBeNull(); // A com 96% de pontualidade
    // total restrito: sem dinheiro inventado
    const masked = recommendationLine({ a: { ...QA, totalText: null }, b: { ...QB, totalText: null } }, true);
    expect(masked.head).toBe('Apex recomenda A: chega a tempo');
    expect(masked.plus).toBeNull();
    expect(masked.head + masked.detail).not.toMatch(/R\$/);
    // A também mais barata
    expect(recommendationLine({ a: { ...QA, totalText: 'R$ 15.000' }, b: QB }, true).head).toBe('Apex recomenda A: chega a tempo e custa R$ 1.000 a menos');
    // nenhuma chega a tempo
    expect(recommendationLine({ a: { ...QA, onTime: false, lateDays: 2 }, b: QB }, true).head).toBe('Nenhuma chega a tempo — Apex recomenda A, com o menor atraso (2 dias)');
    expect(recommendationLine(abPair(RFQ)!, false).head).toBe('A Apex não recomenda nenhuma proposta');
    for (const r of [rec, masked]) expect(`${r.head} ${r.detail}`).not.toMatch(/atrasa|NaN/);
  });

  it('chegada contra a necessidade: "Dentro do prazo" / "+7 dias depois da necessidade" / sem prazo', () => {
    expect(arrivalText(QA)).toEqual({ text: 'Dentro do prazo', tone: 'success' });
    expect(arrivalText(QB)).toEqual({ text: '+7 dias depois da necessidade', tone: 'warning' });
    expect(arrivalText({ onTime: null, lateDays: null }).text).toBe('Sem prazo informado');
    expect(arrivalText({ onTime: false, lateDays: 1 }).text).toBe('+1 dia depois da necessidade');
  });

  it('A chega a tempo só pelo prazo PROMETIDO e o histórico é de atraso (0%): alerta no cartão, ressalva na recomendação e na justificativa', () => {
    // o caso do QA: [QA] Elétrica Rápida Norte — 2 entregas prometidas, 0 no prazo
    const late = { ...QA, supplier: { ...QA.supplier, onTimeRate: 0 } };
    expect(lowReliability(0)).toBe('0%');
    expect(lowReliability(0.79)).toBe('79%');
    expect(lowReliability(0.8)).toBeNull(); // a régua de Compras (evaluateQuotes): abaixo de 80%
    expect(lowReliability(null)).toBeNull(); // sem histórico ≠ 0%
    expect(arrivalText(late)).toEqual({ text: 'Dentro do prazo prometido', tone: 'warning' });
    expect(arrivalText({ ...late, supplier: { ...late.supplier, onTimeRate: null } }).tone).toBe('success');
    const rfq = { ...RFQ, quotes: [QB, late] };
    const rec = recommendationLine(abPair(rfq)!, true);
    expect(rec.head).toBe('Apex recomenda A: + R$ 850 para chegar a tempo');
    expect(rec.caveat).toContain('pontualidade histórica deste fornecedor é de 0%');
    const why = defaultRationale(rfq, 'qa');
    expect(why.startsWith('Segue a recomendação da Apex: ')).toBe(true);
    expect(why).toContain('Pontualidade histórica do fornecedor: 0% — data de entrega a confirmar com ele.');
    expect(defaultRationale(RFQ, 'qa')).not.toContain('Pontualidade histórica');
  });

  it('decidir: justificativa escrita quando segue a recomendação; contra ela, em branco e obrigatória; o corpo da rota', () => {
    const follow = defaultRationale(RFQ, 'qa');
    expect(follow.startsWith('Segue a recomendação da Apex: ')).toBe(true);
    expect(rationaleState(RFQ, 'qa', follow)).toMatchObject({ against: false, ok: true });
    expect(defaultRationale(RFQ, 'qb')).toBe('');
    const against = rationaleState(RFQ, 'qb', 'curto');
    expect(against).toMatchObject({ against: true, ok: false });
    expect(against.hint).toContain('contra a recomendação');
    const body = decideBody(RFQ, 'qb', '  Prazo negociado com B por telefone  ');
    expect(body).toMatchObject({ action: 'decide', quoteId: 'qb', recommendedQuoteId: 'qa', rationale: 'Prazo negociado com B por telefone' });
    expect(body.comparison.quotes.map((q) => [q.quoteId, q.lateDays, q.total])).toEqual([['qb', 7, 'R$ 16.000'], ['qa', 0, 'R$ 16.850']]);
    expect(body.comparison.recommendation).toEqual(RFQ.recommendation);
  });

  it('o próximo ato PARA ESTA PESSOA: decidir (quem cota) → enviar para aprovação → aprovar (quem tem a alçada)', () => {
    expect(govStep(RFQ, { source: true })).toEqual({ kind: 'decide' });
    expect(govStep(RFQ, { source: false })).toEqual({ kind: 'wait-decision' });
    const dec = (p: Partial<NonNullable<RfqView['decision']>>) => ({ ...RFQ, status: 'DECIDED' as const, decision: {
      quoteId: 'qa', followsRecommendation: true, poId: 'po-1', poNumber: 'OC-260925-AAAA1', poStatus: 'DRAFT', poStatusLabel: 'Rascunho', decisionKey: null, ...p } });
    expect(govStep(dec({}), { source: true })).toEqual({ kind: 'submit', poId: 'po-1', poNumber: 'OC-260925-AAAA1' });
    expect(govStep(dec({}), { source: false }).kind).toBe('draft');
    expect(govStep(dec({ poStatus: 'APPROVAL_REQUIRED', decisionKey: 'purchase_order:po-1:s1' }), { source: false }))
      .toEqual({ kind: 'approve', decisionKey: 'purchase_order:po-1:s1', poNumber: 'OC-260925-AAAA1' });
    expect(govStep(dec({ poStatus: 'APPROVAL_REQUIRED' }), { source: true }).kind).toBe('awaiting');
    expect(govStep(dec({ poStatus: 'APPROVED', poStatusLabel: 'Aprovado' }), { source: true })).toMatchObject({ kind: 'settled', label: 'Aprovado' });
    expect(missingDeliveryLocation('Defina o local de entrega antes de submeter.')).toBe(true);
    expect(missingDeliveryLocation('Segregação de funções')).toBe(false);
  });

  it('trilho do fluxo pelo DADO: o caso do QA está na cotação; sem solicitação, o plano é o atual; rede cobre → etapas "não precisa"', () => {
    // a transferência de Marabá ainda SUGERIDA: o plano nunca diz "feito" ao lado dela — corre em paralelo à cotação
    expect(flowStates(SUPPLY)).toEqual({ plan: 'current', requisition: 'done', suppliers: 'done', quotes: 'current' });
    expect(currentPurchaseStep(flowStates(SUPPLY))).toBe('quotes');
    const allDone = { ...SUPPLY, plan: { state: 'ok' as const, data: { ...PLAN_OK, steps: PLAN_OK.steps.map((s) => ({ ...s, status: 'done' as const, action: null })) } } };
    expect(flowStates(allDone)).toEqual({ plan: 'done', requisition: 'done', suppliers: 'done', quotes: 'current' });
    // uma transferência já PEDIDA (aguardando o Estoque) e nada a sugerir: o plano aguarda — nem "feito", nem "agora"
    const waiting = { ...allDone, plan: { state: 'ok' as const, data: { ...allDone.plan.data,
      steps: allDone.plan.data.steps.map((s, i) => (i === 1 ? { ...s, status: 'pending' as const } : s)) } } };
    expect(flowStates(waiting)).toMatchObject({ plan: 'waiting', quotes: 'current' });
    const none ={ ...SUPPLY, focus: { ...BALANCE, requested: 0 }, procurement: { state: 'ok' as const, data: { requisitions: [] } } };
    expect(flowStates(none)).toEqual({ plan: 'current', requisition: 'pending', suppliers: 'pending', quotes: 'pending' });
    expect(currentPurchaseStep(flowStates(none))).toBe('plan');
    const covered = { ...none, plan: { state: 'ok' as const, data: { ...PLAN_OK, remainingShortage: 0 } } };
    expect(flowStates(covered)).toEqual({ plan: 'current', requisition: 'skip', suppliers: 'skip', quotes: 'skip' });
  });

  it('Restrito ≠ não carregou no trilho: cadeado neutro vs perigo; nunca "Sem leitura" para os dois', () => {
    const restricted = flowStates({ ...SUPPLY, plan: { state: 'restricted' }, procurement: { state: 'restricted' } });
    expect(restricted).toEqual({ plan: 'restricted', requisition: 'restricted', suppliers: 'restricted', quotes: 'restricted' });
    const failed = flowStates({ ...SUPPLY, plan: { state: 'error', message: 'x' }, procurement: { state: 'error', message: 'y' } });
    expect(failed).toEqual({ plan: 'error', requisition: 'error', suppliers: 'error', quotes: 'error' });
    expect(flowStates({ ...SUPPLY, plan: { state: 'restricted' }, procurement: { state: 'error', message: 'x' } }).plan).toBe('restricted');
    // nada legível no painel (plano, compras e fornecedores Restritos): "Ver o plano do Apex" não é oferecido
    expect(flowReadable({ plan: { state: 'restricted' }, procurement: { state: 'restricted' }, suppliers: { state: 'restricted' } })).toBe(false);
    expect(flowReadable({ plan: { state: 'restricted' }, procurement: { state: 'error', message: 'x' }, suppliers: { state: 'restricted' } })).toBe(true);
  });

  it('o atalho de quem veio decidir/aprovar; a leitura sem os campos novos vira "não carregou", nunca calma', () => {
    expect(pendingForViewer(SUPPLY)).toBe('A cotação COT-260924-98CDA tem 2 propostas para você decidir');
    expect(pendingForViewer({ ...SUPPLY, capabilities: { ...CAPS, source: false } })).toBeNull();
    const approving = { ...SUPPLY, capabilities: { ...CAPS, source: false }, procurement: { state: 'ok' as const, data: { requisitions: [{ ...REQ, rfqs: [{
      ...RFQ, status: 'DECIDED' as const, decision: { quoteId: 'qa', followsRecommendation: true, poId: 'po-1', poNumber: 'OC-260925-AAAA1',
        poStatus: 'APPROVAL_REQUIRED', poStatusLabel: 'Em aprovação', decisionKey: 'purchase_order:po-1:s1' } }] }] } } };
    expect(pendingForViewer(approving)).toBe('A compra OC-260925-AAAA1 aguarda a sua aprovação');
    const old = { ...SUPPLY } as Partial<SiteSupplyData>;
    delete old.plan; delete old.procurement; delete old.suppliers; delete old.capabilities;
    const n = normalizeSupply(old as SiteSupplyData);
    expect(n.plan.state).toBe('error');
    expect(n.procurement.state).toBe('error');
    expect(n.suppliers.state).toBe('error');
    expect(n.capabilities).toMatchObject({ request: false, source: false, approve: false, aiSearch: { available: false } });
  });
});

describe('Supply · atos pela rota governada (fetch simulado)', () => {
  const fetchOf = (status: number, payload: unknown, calls: Array<{ url: string; init: RequestInit }> = []) =>
    (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(payload), { status }); }) as unknown as typeof fetch;

  it('POST com o corpo exato; sucesso lê `result`; recusa em português; 403 = sem alçada; 5xx e rede = incerto', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const body = requisitionBody(BALANCE, 'cant-tuc', 'intent-abc-123');
    const ok = await postGoverned('/api/supply/procurement/requisitions', body, fetchOf(200, { ok: true, result: { requisition_id: 'r1', requisition_number: 'RC-1', replayed: false } }, calls));
    expect(ok).toEqual({ ok: true, result: { requisition_id: 'r1', requisition_number: 'RC-1', replayed: false }, replayed: false });
    expect(calls[0].url).toBe('/api/supply/procurement/requisitions');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
    // o envio da cotação responde sem `result`: o corpo inteiro vira o resultado (lido por `sendResults`)
    const sent = await postGoverned('/api/supply/procurement/rfqs/rfq-1/send', rfqSendBody(['sb']), fetchOf(200, { ok: true, results: [{ supplierId: 'sb', name: 'B', outcome: 'SENT', message: '' }] }));
    expect(sent.ok && sendResults(sent.result).map((r) => r.outcome)).toEqual(['SENT']);
    expect(await postGoverned('/x', {}, fetchOf(400, { ok: false, error: 'Essa falta já está requisitada (500).' })))
      .toEqual({ ok: false, status: 400, message: 'Essa falta já está requisitada (500).', uncertain: false });
    const denied = await postGoverned('/x', {}, fetchOf(403, { ok: false, error: 'Segregação de funções: quem criou ou submeteu o pedido não o aprova.' }));
    expect(denied).toMatchObject({ ok: false, status: 403, uncertain: false });
    expect(!denied.ok && denied.message).toBe('Sem alçada: Segregação de funções: quem criou ou submeteu o pedido não o aprova.');
    expect(await postGoverned('/x', {}, fetchOf(502, {}))).toMatchObject({ ok: false, uncertain: true });
    const down = (async () => { throw new TypeError('rede'); }) as unknown as typeof fetch;
    // só o ato COM a chave da intenção promete que repetir não duplica; os outros pedem para conferir antes
    expect(await postGoverned('/x', body, down)).toEqual({ ok: false, status: null, message: NETWORK_TEXT, uncertain: true });
    expect(NETWORK_TEXT).toContain('não duplica');
    const unkeyed = await postGoverned('/api/supply/suppliers', prospectBody({ name: 'X Ltda', cnpj: null, site: null, email: null, phone: null, city: null, uf: null,
      country: null, evidenceUrls: [], confidence: 'low', note: null }, TODAY), down);
    expect(unkeyed).toEqual({ ok: false, status: null, message: NETWORK_TEXT_UNKEYED, uncertain: true });
    expect(NETWORK_TEXT_UNKEYED).not.toContain('não duplica');
    expect(NETWORK_TEXT_UNKEYED).toContain('Confira em Compras antes de repetir');
    const fail5xx = await postGoverned('/x', decideBody(RFQ, 'qa', 'Segue a recomendação'), fetchOf(500, {}));
    expect(!fail5xx.ok && fail5xx.message).toContain('Confira em Compras');
  });

  it('busca externa: sempre 200; desligada = ai_unavailable com o motivo; rede caída = erro (nunca "nenhum fornecedor")', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const off = await postDiscovery('/api/dashboard/site/p/supply/discover', 'req-1',
      fetchOf(200, { ok: false, reason: 'ai_unavailable', message: 'Busca externa desligada nesta instalação', error: 'Busca externa desligada nesta instalação' }, calls));
    expect(off).toMatchObject({ ok: false, reason: 'ai_unavailable', message: 'Busca externa desligada nesta instalação' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ requirementId: 'req-1' });
    const found = await postDiscovery('/d', 'req-1', fetchOf(200, { ok: true, runAt: 'x', provider: 'anthropic', model: 'm', query: 'q', candidates: [] }));
    expect(found.ok).toBe(true);
    const down = (async () => { throw new TypeError('rede'); }) as unknown as typeof fetch;
    expect(await postDiscovery('/d', 'req-1', down)).toMatchObject({ ok: false, reason: 'error' });
    expect(await postDiscovery('/d', 'req-1', fetchOf(500, 'lixo'))).toMatchObject({ ok: false, reason: 'error' });
  });
});

describe('Tela · Supply Chain', () => {
  const ctxOf = (data: SiteSupplyData): FlowCtx => ({ data, today: TODAY, projectId: 'qa-scn-tucurui', siteName: PROJECT.name, afterAct: () => undefined });
  const renderFlow = (data: SiteSupplyData) => renderToStaticMarkup(h(SupplyFlowPanel, { ctx: ctxOf(data) }));
  const decisionKey = 'purchase_order:e4a2beae-9aa0-408f-81d1-df8bae481035:s1';
  const detail = {
    ok: true, key: decisionKey, access: 'DECIDER', canAct: true, actions: ['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT'], reasonRequired: ['REJECT'],
    resolved: { key: decisionKey, subjectType: 'purchase_order', title: 'Pedido de compra OC-260924-CA44B', amount: 16850, currency: 'BRL', open: true, status: 'PENDENTE', fingerprint: 'fp' },
    item: null, why: [{ label: 'Alçada', value: 'Compras acima de R$ 10 mil' }], facts: [], lines: [], comparison: null, impact: [], chain: [],
    otherDeciders: { count: 0, people: [] }, history: [], notifications: [], sourceHref: '/supply/compras', sourceLabel: 'Compras', today: TODAY,
  };

  it('etapa 1 (antes da varredura): a necessidade com a ORIGEM, o balanço vivo e "Analisar a rede de estoque"; nada à direita', () => {
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'ok', data: SUPPLY } } satisfies SiteSupplyResponse));
    const html = render(SupplyModule);
    expect(html).toContain('data-testid="dg-supply"');
    expect(html).toContain('data-stage="idle"');
    expect(html).toContain('Necessidade · Lançamento de cabos de potência');
    expect(html).toContain('Do cronograma: Lançamento de cabos de potência (início 30/09)');
    expect(html).toContain('Abrir a OS OS-QA-2026-0301');
    expect(html).not.toContain('Apex leu a OS');
    expect(html).toContain('Necessário até <b class="num">30 SET</b>');
    expect(html).toContain('500 m');
    expect(html).toContain('Analisar a rede de estoque');
    expect(html).toContain('3 locais da rede');
    // quem cota vê o atalho para a decisão (sem refazer a varredura)
    expect(html).toContain('A cotação COT-260924-98CDA tem 2 propostas para você decidir');
    expect(html).not.toContain('data-testid="dg-supply-plan"');
    expect(html).not.toMatch(/atrasa|NaN/);
  });

  it('"Apex leu a OS" só quando o item da OS foi lido pela Apex; origem ilegível é dita', () => {
    const read = { ...SUPPLY, focus: { ...BALANCE, origin: { ...BALANCE.origin!, source: 'AI_PROPOSAL' as const, label: 'Da OS OS-QA-2026-0301', readByAi: true } } };
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'ok', data: read } }));
    expect(render(SupplyModule)).toContain('Apex leu a OS');
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'ok', data: { ...SUPPLY, focus: { ...BALANCE, origin: null } } } }));
    expect(render(SupplyModule)).toContain('Origem da necessidade não pôde ser lida.');
  });

  it('etapas 3–6 (depois da varredura): trilho, plano com estado e ação, a solicitação e o A × B com a recomendação e "Decidir fornecedor"', () => {
    const html = renderFlow(SUPPLY);
    expect(html).toContain('Plano do Apex');
    expect(html).toContain('Cobertura viva + estoque em 3 locais');
    for (const t of ['Plano', 'Solicitação', 'Fornecedores', 'Cotação']) expect(html).toContain(t);
    expect(html).toContain('aria-current="step"');
    // plano: reservar feito, transferir sugerido com botão, comprar feito com o porquê
    expect(html).toContain('Reservar');
    expect(html).toContain('Transferir');
    expect(html).toContain('Comprar');
    expect(html).toContain('já requisitado (500 m) — RC-260924-C451E');
    expect(html).toContain('data-testid="dg-plan-act-transfer"');
    expect(html).not.toContain('data-testid="dg-plan-act-buy"');
    expect(html).toMatch(/--d:320ms/);
    // solicitação (fechada, com o resumo)
    expect(html).toContain('RC-260924-C451E · Em cotação');
    // A × B
    expect(html).toContain('data-testid="dg-supply-ab"');
    expect(html).toContain('[QA] Prysmian Cabos');
    expect(html).toContain('[QA] Cabos Norte Ltda');
    expect(html.indexOf('[QA] Prysmian Cabos')).toBeLessThan(html.indexOf('[QA] Cabos Norte Ltda', html.indexOf('data-testid="dg-supply-ab"')));
    expect(html).toContain('Recomendada pela Apex');
    expect(html).toContain('Dentro do prazo');
    expect(html).toContain('+7 dias depois da necessidade');
    expect(html).toContain('Apex recomenda A: + R$ 850 para chegar a tempo');
    expect(html).toContain('− 7 dias de atraso');
    expect(html).not.toContain('além da necessidade');
    expect(html).not.toContain('data-testid="dg-supply-rec-caveat"');
    expect(html).toContain('96%');
    expect(html).toContain('data-testid="dg-supply-decide"');
    expect(html).toContain('Decidir fornecedor');
    expect(html).not.toMatch(/atrasa a obra|NaN|undefined/);
    // pelo atalho de quem veio decidir: o plano (feito) fica fechado e a comparação aparece sem rolar
    const direct = renderToStaticMarkup(h(SupplyFlowPanel, { ctx: ctxOf(SUPPLY), entry: 'direct' }));
    expect(direct).toMatch(/data-testid="dg-supply-step-plan"><h4 class="dgs-sec-h"><button type="button" class="dgs-sec-btn" aria-expanded="false"/);
    expect(direct).not.toContain('data-testid="dg-plan-act-transfer"');
    expect(direct).toContain('data-testid="dg-supply-ab"');
  });

  it('quem tem a alçada: "Aprovar compra" pelo MESMO ato de Decisões; sem ato, a nota de alçada', () => {
    const approving: SiteSupplyData = { ...SUPPLY, capabilities: { ...CAPS, source: false, approve: true }, procurement: { state: 'ok', data: { requisitions: [{ ...REQ, rfqs: [{
      ...RFQ, status: 'DECIDED', decision: { quoteId: 'qa', followsRecommendation: true, poId: 'e4a2beae', poNumber: 'OC-260924-CA44B',
        poStatus: 'APPROVAL_REQUIRED', poStatusLabel: 'Em aprovação', decisionKey } }] }] } } };
    resources.set(`/api/decisions/${encodeURIComponent(decisionKey)}`, ready(detail));
    const html = renderFlow(approving);
    expect(html).toContain('Fornecedor decidido: <b>[QA] Prysmian Cabos</b> — segue a recomendação da Apex');
    expect(html).toContain('Aprovar compra');
    expect(html).toContain('data-testid="dg-decision-act-approve"');
    expect(html).toContain('Alçada · <b>Compras acima de R$ 10 mil</b>');
    expect(html.indexOf('Aprovar compra')).toBeLessThan(html.indexOf('Solicitar ajuste'));
    expect(html).not.toContain('Decidir fornecedor');
    resources.set(`/api/decisions/${encodeURIComponent(decisionKey)}`, ready({ ...detail, canAct: false, access: 'TEAM' }));
    const readOnly = renderFlow(approving);
    expect(readOnly).not.toContain('Aprovar compra');
    expect(readOnly).toContain('Decidir cabe a quem tem a alçada');
  });

  it('decisão da caixa fora da cotação: aparece no acompanhamento (aberto) com o ato de Decisões', () => {
    const decision = { key: decisionKey, href: `/decisoes?d=${encodeURIComponent(decisionKey)}`, kindLabel: 'Compra', title: 'Pedido de compra OC-260924-CA44B',
      amountText: 'R$ 16.850', amountRestricted: false, due: '2026-09-14', overdue: true, poId: 'e4a2beae' };
    resources.set(`/api/decisions/${encodeURIComponent(decisionKey)}`, ready(detail));
    const html = renderFlow({ ...SUPPLY, decisions: { state: 'ok', data: [decision] } });
    expect(html).toContain('1 para você');
    expect(html).toContain('Decidir até 14 SET · vencida');
    expect(html).toContain('data-testid="dg-decision-act-approve"');
  });

  it('fornecedores: homologados com pontualidade/prazo/contato e o convite; a busca externa desligada é dita com calma', () => {
    const noRfq: SiteSupplyData = { ...SUPPLY, procurement: { state: 'ok', data: { requisitions: [{ ...REQ, rfqs: [] }] } } };
    const html = renderToStaticMarkup(h(SuppliersStep, { ctx: ctxOf(noRfq) }));
    expect(html).toContain('Homologados');
    expect(html).toContain('[QA] Prysmian Cabos');
    expect(html).toContain('96% no prazo · prazo 4 dias');
    expect(html).toContain('categoria e histórico com o item');
    expect(html).toContain('Em avaliação');
    expect(html).toContain('Convidar e enviar cotação (2)');
    expect(html).toContain('Busca externa desligada nesta instalação. A lista interna acima segue valendo.');
    // com cotação aberta: convidados, enviados e "Enviar cotação" para quem falta
    const withRfq = renderToStaticMarkup(h(SuppliersStep, { ctx: ctxOf(SUPPLY) }));
    expect(withRfq).toContain('Cotação <b class="num">COT-260924-98CDA</b>');
    expect(withRfq).toContain('Proposta recebida');
    expect(withRfq).toContain('Sem e-mail cadastrado');
    expect(withRfq).toContain('Enviar cotação (1)');
    // o desfecho do envio (mora no painel: a releitura troca a lista, o desfecho fica)
    const sentHtml = renderToStaticMarkup(h(SuppliersStep, { ctx: ctxOf(SUPPLY), sent: { title: 'Envio da cotação COT-260924-98CDA', error: null,
      results: [{ supplierId: 'sd', name: '[QA] Fios Pará', outcome: 'SIMULATED', message: 'capturado' }, { supplierId: 'sc', name: '[QA] Eletro Sem Email', outcome: 'NO_CONTACT', message: '' }] } }));
    expect(sentHtml).toContain('data-testid="dg-supply-send-results"');
    expect(sentHtml).toContain('Registrado — ambiente de teste');
    expect(sentHtml).toContain('Sem e-mail cadastrado');
    // quem não cota não convida
    const viewer = renderToStaticMarkup(h(SuppliersStep, { ctx: ctxOf({ ...noRfq, capabilities: { ...CAPS, source: false } }) }));
    expect(viewer).not.toContain('Convidar e enviar cotação');
    expect(viewer).toContain('cabe a Compras');
    // busca ligada: o botão da Apex
    const on = renderToStaticMarkup(h(SuppliersStep, { ctx: ctxOf({ ...noRfq, capabilities: { ...CAPS, aiSearch: { available: true, reason: null } } }) }));
    expect(on).toContain('Buscar na internet (Apex)');
    // o que sai da empresa é dito ANTES do clique (nunca "nada é enviado a ninguém")
    expect(on).not.toContain('Nada é enviado a ninguém');
    expect(on).toContain('data-testid="dg-supply-discover-out"');
    expect(on).toContain('envia ao provedor de IA e à busca na web a descrição e o código do item (Cabo de potência 35 mm² XLPE 15 kV · CABO-35-XLPE), a categoria, a quantidade e a UF de entrega. Nenhum fornecedor é contatado.');
  });

  it('Restrito / não carregou em cada parte; nenhuma vira zero nem "nada aqui"', () => {
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'restricted' } }));
    expect(render(SupplyModule)).toContain('Restrito');
    resources.set(api('supply'), { data: null, state: 'error', message: 'Falha de rede.' });
    expect(render(SupplyModule)).toContain('O Supply Chain não carregou');
    const html = renderFlow({
      ...SUPPLY, apex: { state: 'restricted' }, orders: { state: 'error', message: 'Falhou.' },
      decisions: { state: 'error', message: 'Não foi possível ler a sua caixa de decisões.' },
      plan: { state: 'restricted' }, procurement: { state: 'error', message: 'A leitura de compras falhou.' },
    });
    expect(html).toContain('Seu perfil não lê o plano de cobertura deste material.');
    expect(html).toContain('As solicitações de compra não carregaram');
    expect(html).toContain('Seu perfil não lê os achados da Apex.');
    expect(html).toContain('Os pedidos não carregaram');
    expect(html).toContain('As decisões não carregaram');
    expect(html).toContain('Não carregou');
    expect(html).not.toContain('Nenhum pedido aberto');
    expect(html).not.toMatch(/>0 pedidos|NaN/);
  });

  it('compras Restrito (rh): a cotação diz "Restrito" (nunca "nenhuma cotação ainda") com cadeado neutro — e "não carregou" é perigo', () => {
    const rh: SiteSupplyData = { ...SUPPLY, stock: { state: 'restricted' }, plan: { state: 'restricted' }, procurement: { state: 'restricted' }, suppliers: { state: 'restricted' } };
    const html = renderFlow(rh);
    expect(html).not.toContain('nenhuma cotação ainda');
    expect(html).not.toContain('Sem leitura');
    expect(html).toMatch(/data-testid="dg-supply-step-quotes">.*?<small>Restrito<\/small>.*?data-signal="neutral">Restrito</);
    expect(html).not.toMatch(/data-state="restricted"[^>]*>.*?data-signal="danger"/);
    const failed = renderFlow({ ...SUPPLY, procurement: { state: 'error', message: 'A leitura de compras falhou.' } });
    expect(failed).toMatch(/data-testid="dg-supply-step-quotes">.*?<small>não carregou<\/small>.*?data-signal="danger">Não carregou</);
    // na Necessidade: sem nada legível no painel, "Ver o plano do Apex" não é oferecido — e a tela diz por quê
    const need = renderToStaticMarkup(h(NeedPanel, { data: rh, today: TODAY, stage: 'idle', onScan: () => undefined, onDirect: () => undefined, onExplain: () => undefined }));
    expect(need).not.toContain('Ver o plano do Apex');
    expect(need).toContain('o plano de cobertura nem as compras deste material');
    const partly = renderToStaticMarkup(h(NeedPanel, { data: { ...rh, procurement: { state: 'ok', data: { requisitions: [REQ] } } }, today: TODAY, stage: 'idle',
      onScan: () => undefined, onDirect: () => undefined, onExplain: () => undefined }));
    expect(partly).toContain('Ver o plano do Apex');
  });

  it('quem veio decidir vê o atalho ANTES do balanço (à vista sem rolar em 1440 × 900) e o balanço aperta', () => {
    const html = renderToStaticMarkup(h(NeedPanel, { data: SUPPLY, today: TODAY, stage: 'idle', onScan: () => undefined, onDirect: () => undefined, onExplain: () => undefined }));
    expect(html.indexOf('data-testid="dg-supply-pending"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="dg-supply-pending"')).toBeLessThan(html.indexOf('data-testid="dg-supply-balance"'));
    expect(html).toContain('data-testid="dg-supply-balance" data-compact="true"');
    expect(html.indexOf('data-testid="dg-supply-balance"')).toBeLessThan(html.indexOf('data-testid="dg-supply-scan"'));
    const none = renderToStaticMarkup(h(NeedPanel, { data: { ...SUPPLY, capabilities: { ...CAPS, source: false } }, today: TODAY, stage: 'idle',
      onScan: () => undefined, onDirect: () => undefined, onExplain: () => undefined }));
    expect(none).not.toContain('dg-supply-pending');
    expect(none).not.toContain('data-compact');
  });

  it('o trilho: número e rótulo em peças separadas (o rótulo encolhe com reticências, nunca cortado a seco)', () => {
    const html = renderFlow(SUPPLY);
    expect(html).toContain('<span class="dgs-rail-l"><em class="num">05</em><span class="dgs-rail-t">Fornecedores</span></span>');
  });
});

describe('Supply · enquadramento no vão entre os painéis e rolagem do painel', () => {
  // QA, 1440 × 900: palco 1368 × 858 (x 72, y 42); painel esquerdo até x 536, direito a partir de x 1016; topo 114, base 798.
  const STAGE = { x: 72, y: 42, w: 1368, h: 858 };
  const cx = STAGE.x + STAGE.w / 2;
  const cy = STAGE.y + STAGE.h / 2;
  const CORRIDOR: Corridor = { width: STAGE.w, height: STAGE.h, left: 556 - cx, right: 996 - cx, top: 114 - cy, bottom: 798 - cy };
  const SITE = { lat: -3.7662, lng: -49.6725 };

  it('canteiro (marcador) e cada nó com o cartão aberto à direita cabem INTEIROS no vão — com a deriva aplicada', () => {
    const l = supplyFlowLayer(SUPPLY, { stage: 'revealed', scanId: 'scan:1', fresh: true, corridor: CORRIDOR });
    const v = l.view!;
    expect(v.pitch).toBe(REVEAL_FRAME.pitch);
    // o rumo gira no máximo ±20° do rumo do filme para a rede caber mais perto no vão estreito
    expect(Math.abs(v.heading - REVEAL_FRAME.heading)).toBeLessThanOrEqual(CORRIDOR_TURN.maxDeg);
    // a câmera DEPOIS da deriva (a deriva aproxima 5 % e gira 4°)
    const settled = { dist: v.dist * SCAN_DRIFT.distK, pitch: v.pitch, heading: v.heading + SCAN_DRIFT.headingDeg };
    const at = (p: { lat: number; lng: number }) => {
      const s = projectToScreen(p, { lat: v.lat, lng: v.lng }, settled, STAGE.h)!;
      return { x: cx + v.ox + s.x, y: cy + v.oy + s.y };
    };
    const inside = (x0: number, x1: number, y0: number, y1: number) => {
      expect(x0).toBeGreaterThanOrEqual(556 + CORRIDOR_PAD - 1);
      expect(x1).toBeLessThanOrEqual(996 - CORRIDOR_PAD + 1);
      expect(y0).toBeGreaterThanOrEqual(114 + CORRIDOR_PAD - 1);
      expect(y1).toBeLessThanOrEqual(798 - CORRIDOR_PAD + 1);
    };
    const s = at(SITE);
    inside(s.x - SITE_BOX.l, s.x + SITE_BOX.r, s.y - SITE_BOX.u, s.y + SITE_BOX.d);
    for (const n of l.nodes!) {
      const p = at(n);
      const box = nodeCardBox(n.title ?? '', n.value ?? null);
      inside(p.x - box.l, p.x + box.r, p.y - box.u, p.y + box.d);
    }
    // o conjunto não fica minúsculo: a distância é a MENOR que cabe (Belém/Marabá a ~290 km do canteiro)
    expect(v.dist).toBeLessThan(1800);
    // uma rede que cabe no rumo do filme não gira à toa
    const northSouth = corridorView(SITE, [{ lat: SITE.lat - 1.5, lng: SITE.lng, box: nodeCardBox('Canteiro Sul', '10 m disponíveis') }], CORRIDOR);
    expect(northSouth!.heading).toBe(REVEAL_FRAME.heading);
    expect(JSON.stringify(l)).not.toMatch(/NaN|Infinity/);
  });

  it('celular (a página zera ox/oy): o ALVO anda até o conjunto ficar no centro do globo — cartões inteiros no bloco do globo', () => {
    // 390 × 844: o globo é um bloco de 390 × 371 no alto; a trilha de navegação cobre o topo (56 px) e os créditos o pé (26 px)
    const G = { w: 390, h: 371 };
    const MOBILE: Corridor = { width: G.w, height: G.h, left: -G.w / 2 + 6, right: G.w / 2 - 6, top: -G.h / 2 + 56, bottom: G.h / 2 - 26, centered: true };
    const l = supplyFlowLayer(SUPPLY, { stage: 'revealed', scanId: 'scan:1', fresh: true, corridor: MOBILE });
    const v = l.view!;
    expect(v).toMatchObject({ ox: 0, oy: 0 });
    const settled = { dist: v.dist * SCAN_DRIFT.distK, pitch: v.pitch, heading: v.heading + SCAN_DRIFT.headingDeg };
    const boxes = [{ ...SITE, box: SITE_BOX }, ...l.nodes!.map((n) => ({ lat: n.lat, lng: n.lng, box: nodeCardBox(n.title ?? '', n.value ?? null) }))];
    for (const { box, ...n } of boxes) {
      const s = projectToScreen(n, { lat: v.lat, lng: v.lng }, settled, G.h)!;
      expect(s.x - box.l).toBeGreaterThanOrEqual(MOBILE.left + CORRIDOR_PAD - 2);
      expect(s.x + box.r).toBeLessThanOrEqual(MOBILE.right - CORRIDOR_PAD + 2);
      expect(s.y - box.u).toBeGreaterThanOrEqual(MOBILE.top + CORRIDOR_PAD - 2);
      expect(s.y + box.d).toBeLessThanOrEqual(MOBILE.bottom - CORRIDOR_PAD + 2);
    }
    // o inverso da projeção devolve o ponto
    const cam = { dist: 900, pitch: 64, heading: 8 };
    const p = projectToScreen({ lat: -2.1, lng: -48.7 }, SITE, cam, 858)!;
    const back = unprojectFromScreen(p.x, p.y, SITE, cam, 858)!;
    expect(back.lat).toBeCloseTo(-2.1, 6);
    expect(back.lng).toBeCloseTo(-48.7, 6);
  });

  it('sem vão medido (celular, SSR, vão estreito) → o enquadramento fixo; a varredura em curso não usa o vão', () => {
    expect(usableCorridor(null)).toBe(false);
    expect(usableCorridor({ ...CORRIDOR, right: CORRIDOR.left + 120 })).toBe(false);
    expect(usableCorridor(CORRIDOR)).toBe(true);
    const fixed = supplyFlowLayer(SUPPLY, { stage: 'revealed', scanId: 'scan:1', fresh: true });
    expect(fixed.view).toMatchObject({ ox: REVEAL_FRAME.ox, oy: REVEAL_FRAME.oy });
    const scanning = supplyFlowLayer(SUPPLY, { stage: 'scanning', scanId: 'scan:1', fresh: false, corridor: CORRIDOR });
    expect(scanning.view).toEqual(supplyFlowLayer(SUPPLY, { stage: 'scanning', scanId: 'scan:1', fresh: false }).view);
    // atalho direto: sem deriva, o mesmo vão
    const direct = supplyFlowLayer(SUPPLY, { stage: 'direct', scanId: null, fresh: false, corridor: CORRIDOR });
    expect(direct.drift).toBeNull();
    expect(direct.view!.ox).not.toBe(REVEAL_FRAME.ox);
    // um ponto só (só o canteiro) → sem enquadramento próprio no vão
    expect(corridorView(null, [], CORRIDOR)).toBeNull();
  });

  it('rolagem do painel: a etapa inteira quando cabe; senão a decisão no pé do painel', () => {
    // cabe: o topo da etapa (menos a folga) no topo do painel
    expect(panelScrollTarget({ secTop: 300, secBottom: 800, focusBottom: 760, viewH: 684, scrollMax: 900 })).toBe(288);
    // não cabe: o bloco da decisão no pé
    expect(panelScrollTarget({ secTop: 300, secBottom: 1200, focusBottom: 1100, viewH: 684, scrollMax: 900 })).toBe(1100 + 12 - 684);
    // nunca além do fim nem antes do começo
    expect(panelScrollTarget({ secTop: 5, secBottom: 100, viewH: 684, scrollMax: 900 })).toBe(0);
    expect(panelScrollTarget({ secTop: 2000, secBottom: 2100, viewH: 684, scrollMax: 900 })).toBe(900);
  });
});

describe('Tela · Faturamento', () => {
  it('sem contrato vinculado: o eventograma nasce do contrato', () => {
    resources.set(api('billing'), ready({ ok: true, today: TODAY, project: PROJECT, billing: { state: 'ok', data: {
      contracts: [], total: null, rows: [], focus: null, focusExplainRef: null } } } satisfies SiteBillingResponse));
    const html = render(BillingModule);
    expect(html).toContain('Projeto sem contrato vinculado — o eventograma nasce do contrato');
    expect(html).not.toContain('dg-billing-chain');
  });

  it('eventograma com total, o evento em foco e a cadeia do Entender como stepper', () => {
    resources.set(api('billing'), ready({ ok: true, today: TODAY, project: PROJECT, billing: { state: 'ok', data: {
      contracts: [{ id: 'c1', label: '[QA] Contrato MUGHR0LOUNQ' }], total: 'R$ 86.500,00',
      rows: [
        { billingEventId: 'e1', contractId: 'c1', title: 'Medição qa-dec-mughr0lounq', amount: 'R$ 86.500,00', state: 'blocked', stateLabel: 'Fiscal bloqueado por configuração',
          measurement: { id: 'm1', status: 'ACCEPTED', statusLabel: 'Aceita' }, fiscal: null, receivable: null, href: '/contratos?view=faturamento' },
        { billingEventId: 'e2', contractId: 'c1', title: 'Evento 02', amount: null, state: 'awaiting', stateLabel: 'Aguardando', measurement: null, fiscal: null, receivable: null, href: '' },
      ],
      focus: 'e1', focusExplainRef: 'bill:e1' } } }));
    resources.set('/api/dashboard/explain?ref=bill%3Ae1', ready({ ok: true, ref: 'bill:e1', title: 'Medição', detected: {}, chain: [
      { stage: 'Medição', label: 'Aceita', detail: 'Medição qa-dec · 05/09', state: 'found', tone: 'success', href: '/projetos/x' },
      { stage: 'Faturamento', label: 'Faturamento restrito', detail: null, state: 'restricted', href: null },
      { stage: 'NF', label: 'ainda não nasceu', detail: null, state: 'pending', href: null },
    ], relation: null, evidence: [], apex: null, nextAction: null, rule: null, asOf: '2026-09-25T12:00:00Z' }));
    const html = render(BillingModule);
    expect(html).toContain('Eventograma · [QA] Contrato MUGHR0LOUNQ');
    expect(html).toContain('R$ 86.500,00');
    expect(html).toContain('Direito contratual · 2 eventos');
    expect(html).toContain('Fiscal bloqueado por configuração');
    expect(html).toMatch(/data-on="true"[^>]*data-tone="danger"/);
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="restricted"');
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('Abrir em Contratos');
    // Valor sem leitura financeira: "—" com o porquê, nunca R$ 0
    expect(html).toContain('title="Valor restrito ao seu perfil ou não informado"');
    expect(html).not.toContain('R$ 0');
  });

  it('Restrito e "não carregou" no eventograma', () => {
    resources.set(api('billing'), ready({ ok: true, today: TODAY, project: PROJECT, billing: { state: 'restricted' } }));
    expect(render(BillingModule)).toContain('Seu perfil não lê o faturamento dos contratos deste projeto.');
    resources.set(api('billing'), ready({ ok: true, today: TODAY, project: PROJECT, billing: { state: 'error', message: 'Falhou a leitura.' } }));
    expect(render(BillingModule)).toContain('O eventograma não carregou');
  });
});

describe('entrada dos painéis (enter)', () => {
  it('enter multiplica opacidade e deslocamento (−18 px); em 0 sai da renderização e não recebe clique', () => {
    resources.set(api('billing'), ready({ ok: true, today: TODAY, project: PROJECT, billing: { state: 'restricted' } }));
    const hidden = render(BillingModule, { enter: 0 });
    expect(hidden).toContain('opacity:0');
    expect(hidden).toContain('translate3d(-18.00px, 0, 0)');
    expect(hidden).toContain('visibility:hidden');
    expect(hidden).toContain('pointer-events:none');
    const half = render(BillingModule, { enter: 0.5 });
    expect(half).toContain('translate3d(-9.00px, 0, 0)');
    expect(render(BillingModule, { enter: Number.NaN })).toContain('opacity:0');
  });
});
