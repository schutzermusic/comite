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
vi.mock('@/components/hud', () => ({ useHudToast: () => ({ success: () => undefined, error: () => undefined }) }));
vi.mock('@/components/ax', async () => {
  const format = await import('@/components/ax/format');
  return {
    ...format,
    useResource: (url: string) => ({ ...(resources.get(url) ?? { data: null, state: 'loading', message: null }), refresh: () => undefined }),
    notifyChanged: () => undefined,
  };
});

import {
  EVENT_TONE, balanceRows, billingRef, coverageSegments, dayMonth, dayNumber, eventContext, eventTone, flagSides, focusActivity,
  frameView, gapSpan, ganttLinkPaths, ganttRows, ganttScale, needTone, orderTiming, percentOf, pillSide, spanLabel, stepState,
  supplyMapLayer, weekday,
} from '@/components/dashboard-globe/modules/model';
import { BillingModule, PlanModule, SupplyModule } from '@/components/dashboard-globe/modules';
import { decisionActBody, postDecisionAct } from '@/components/decisions/useDecisionAct';
import type { ModuleProps } from '@/components/dashboard-globe/contract';
import type {
  GanttActivity, InboundOrder, MaterialBalance, SiteBillingResponse, SitePlanData, SitePlanResponse, SiteSupplyData, SiteSupplyResponse,
  StockNode,
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

const SUPPLY: SiteSupplyData = {
  focus: BALANCE, materials: [BALANCE],
  stock: { state: 'ok', data: STOCK },
  orders: { state: 'ok', data: [] },
  apex: { state: 'ok', data: [] },
  decisions: { state: 'ok', data: [] },
  site: { lat: -3.7662, lng: -49.6725 },
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

describe('Tela · Supply Chain', () => {
  it('balanço, plano do Apex e pedidos; a decisão sem ato fica dita', () => {
    const data: SiteSupplyData = {
      ...SUPPLY,
      apex: { state: 'ok', data: [{ signalId: 's1', kind: 'DECISION_PENDING', severity: 'critical', lead: 'Apex identificou uma compra parada',
        title: 'Requisição RC-260924-C451E em cotação há 1 dia(s)', rationale: 'A necessidade é 30/09/2026.', evidence: [{ label: 'Necessidade', value: '30/09/2026' }],
        ranAt: '2026-09-25T12:30:46Z', engineVersion: 'supply-signals.v1', stale: false }] },
      orders: { state: 'ok', data: [{ poId: 'po1', number: 'OC-260924-CA44B', supplier: { id: 'sup', name: '[QA] Siemens Energy Brasil Ltda' }, status: 'APPROVAL_REQUIRED',
        statusLabel: 'Em aprovação', expected: '2026-10-14', late: true, lateDays: 10, qty: 4, amountText: 'R$ 478.500', href: '/supply/compras?po=po1' }] },
    };
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'ok', data } } satisfies SiteSupplyResponse));
    const html = render(SupplyModule);
    expect(html).toContain('data-testid="dg-supply"');
    expect(html).toContain('Material · Lançamento de cabos de potência');
    expect(html).toContain('Necessário até <b class="num">30 SET</b>');
    expect(html).toContain('Falta');
    expect(html).toContain('500 m');
    expect(html).toContain('Apex identificou uma compra parada');
    expect(html).toContain('[QA] Siemens Energy Brasil Ltda');
    expect(html).toContain('chega 10 dias depois da necessidade');
    expect(html).toContain('Nenhuma decisão sua aguardando para este material.');
    expect(html).not.toMatch(/atrasa|NaN/);
  });

  it('decisão da caixa: o detalhe com canAct mostra "Aprovar compra"; sem canAct, a nota de alçada', () => {
    const key = 'purchase_order:e4a2beae-9aa0-408f-81d1-df8bae481035:s1';
    const decision = { key, href: `/decisoes?d=${encodeURIComponent(key)}`, kindLabel: 'Compra', title: 'Pedido de compra OC-260924-CA44B',
      amountText: 'R$ 478.500', amountRestricted: false, due: '2026-09-14', overdue: true, poId: 'e4a2beae' };
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'ok', data: { ...SUPPLY, decisions: { state: 'ok', data: [decision] } } } }));
    const detail = {
      ok: true, key, access: 'DECIDER', canAct: true, actions: ['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT'], reasonRequired: ['REJECT'],
      resolved: { key, subjectType: 'purchase_order', title: 'Pedido de compra OC-260924-CA44B', amount: 478500, currency: 'BRL', open: true, status: 'PENDENTE', fingerprint: 'fp' },
      item: null, why: [{ label: 'Alçada', value: 'Compras acima de R$ 250 mil' }], facts: [], lines: [], comparison: null, impact: [], chain: [],
      otherDeciders: { count: 0, people: [] }, history: [], notifications: [], sourceHref: '/supply/compras', sourceLabel: 'Compras', today: TODAY,
    };
    resources.set(`/api/decisions/${encodeURIComponent(key)}`, ready(detail));
    const html = render(SupplyModule);
    expect(html).toContain('Aprovar compra');
    expect(html).toContain('data-testid="dg-decision-act-approve"');
    expect(html).toContain('Solicitar ajuste');
    expect(html).toContain('Rejeitar');
    expect(html).toContain('Alçada · <b>Compras acima de R$ 250 mil</b>');
    expect(html).toContain('Decidir até 14 SET · vencida');
    expect(html.indexOf('Aprovar compra')).toBeLessThan(html.indexOf('Solicitar ajuste'));
    resources.set(`/api/decisions/${encodeURIComponent(key)}`, ready({ ...detail, canAct: false, access: 'TEAM' }));
    const readOnly = render(SupplyModule);
    expect(readOnly).not.toContain('Aprovar compra');
    expect(readOnly).toContain('Decidir cabe a quem tem a alçada');
  });

  it('Restrito / não carregou em cada parte; nenhuma vira zero nem "nada aqui"', () => {
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'restricted' } }));
    expect(render(SupplyModule)).toContain('Restrito');
    resources.set(api('supply'), ready({ ok: true, today: TODAY, project: PROJECT, supply: { state: 'ok', data: {
      ...SUPPLY, apex: { state: 'restricted' }, orders: { state: 'error', message: 'Falhou.' }, decisions: { state: 'error', message: 'Não foi possível ler a sua caixa de decisões.' },
    } } }));
    const html = render(SupplyModule);
    expect(html).toContain('Seu perfil não lê os achados da Apex.');
    expect(html).toContain('Os pedidos não carregaram');
    expect(html).toContain('As decisões não carregaram');
    expect(html).not.toContain('Nenhum pedido aberto');
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
