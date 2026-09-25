/**
 * DASHBOARD V2 — a TELA nunca afirma o que não leu.
 *
 *   fila       fonte que falhou → "Supply não carregou", nunca "Nada fora do
 *              lugar" / "Ainda não há operação" / "0 exceções"; total lido com
 *              corte é piso ("259+", "ao menos"); `hasOperation: null` → texto
 *              neutro; filtro de área que sumiu volta para "Tudo"; o "+N" da
 *              área filtrada bate com o chip
 *   fluxo      etapa `ok` sem número → "Restrito"/motivo, nunca 0; restrita,
 *              que falhou ou sem fonte não conta como "sem pendência"; `partial` → "≥"
 *   calendário faixa que falhou aparece ("não carregou"); "Nada previsto" só com
 *              todas as faixas lidas por inteiro; SVG `group`, não `img`
 *   Entender   a etapa E o rótulo do elo; "Responsável" só onde há dono; os
 *              tons chegam ao painel (portal fora de .dv2)
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Props = Record<string, unknown> & { children?: React.ReactNode };
const h = React.createElement;

const explainState: { data: unknown; state: string; message: string | null } = { data: null, state: 'loading', message: null };
const panelProps: { last: Props | null } = { last: null };

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: Props & { href: string }) => h('a', { href, ...rest }, children),
}));
vi.mock('@/hooks/use-decision-badge', () => ({ refreshDecisionBadge: () => undefined, useDecisionBadgeState: () => ({ known: false, count: 0 }) }));
vi.mock('@/hooks/use-current-user', () => ({ useCurrentUser: () => ({ organization: { name: 'Org' } }) }));
vi.mock('@/components/ax', async () => {
  const format = await import('@/components/ax/format');
  return {
    ...format,
    Plane: ({ title, count, subtitle, bar, children, testId }: Props) => h('section', { 'data-testid': testId },
      h('h3', null, title as React.ReactNode, count !== undefined ? h('span', { className: 'ax-count' }, count as number) : null),
      subtitle ? h('p', null, subtitle as React.ReactNode) : null, bar as React.ReactNode, children),
    EmptyState: ({ title, children, action }: Props) => h('div', { role: 'status' }, h('h4', null, title as string), children ? h('p', null, children) : null, action as React.ReactNode),
    Filters: ({ options, value }: Props) => h('div', { role: 'group' },
      (options as Array<{ id: string; label: string; count?: number }>).map((o) => h('button', { key: o.id, 'aria-pressed': o.id === value }, o.label, o.count))),
    Dot: ({ label }: Props) => h('span', { 'data-dot': label }),
    SidePanel: (props: Props) => { panelProps.last = props; return h('div', { 'data-testid': props.testId }, h('h2', null, props.title as string), props.children); },
    Section: ({ title, children }: Props) => h('section', null, h('h4', null, title as string), children),
    KV: ({ items }: Props) => h('dl', null, (items as Array<[string, string]>).map(([k, v]) => h(React.Fragment, { key: k }, h('dt', null, k), h('dd', null, v)))),
    useResource: () => ({ ...explainState, refresh: () => undefined }),
    useUrlParam: () => ['', () => undefined],
    AxPage: ({ children }: Props) => h('main', null, children),
    CommandHeader: () => null,
    ErrorState: () => null,
  };
});

import { AttentionFeed, failedAreasText, feedSlice } from '@/components/dashboard-v2/AttentionFeed';
import { BusinessFlow } from '@/components/dashboard-v2/BusinessFlow';
import { CompanyCalendar } from '@/components/dashboard-v2/CompanyCalendar';
import { HeaderContext } from '@/components/dashboard-v2/DashboardV2';
import { ExplainPanel } from '@/components/dashboard-v2/ExplainPanel';
import type {
  CalendarModel, ChainLink, DashboardOverview, Domain, ExplainResponse, FeedModel, FeedRow, FlowStage, SectionState, StageId,
} from '@/lib/dashboard/types';
import { COMERCIAL_STUCK_REASON, SCHEDULE_PARTIAL_REASON } from '@/lib/dashboard/rules';

const TODAY = '2026-09-25';
const ALL: Domain[] = ['comercial', 'operacao', 'supply', 'medicao', 'faturamento', 'recebivel'];

const row = (key: string, domain: Domain, over: Partial<FeedRow> = {}): FeedRow => ({
  key, domain, severity: 'high', kindLabel: 'OS', location: { kind: 'project', id: 'p1', label: 'UG-05' },
  object: `Objeto ${key}`, problem: 'Parada', consequence: null, due: null, owner: null, ownerApplicable: false, count: 1,
  nextAction: { label: 'Abrir', href: '/operacoes', focused: false }, explainRef: null, apex: null, rule: 'regra', ...over,
});
const feedOf = (over: Partial<FeedModel> = {}): FeedModel => ({
  rows: [], total: 0, critical: 0, byDomain: {}, failed: [], partial: false, ...over,
});
const renderFeed = (feed: FeedModel, hasOperation: boolean | null = true, readable: Domain[] = ALL) => renderToStaticMarkup(h(AttentionFeed, {
  section: { state: 'ok', data: feed } as SectionState<FeedModel>, today: TODAY, readable, hasOperation,
  apex: null, onExplain: () => undefined, onReload: () => undefined,
}));
const FALSE_ALL_CLEAR = /Nada fora do lugar|Ainda não há operação|0 exceções/;

describe('Atenção agora — fonte que falhou, piso, operação desconhecida', () => {
  it('fonte que falhou com a fila vazia: diz o que não carregou, nunca o "tudo certo" nem o "sem operação"', () => {
    for (const hasOperation of [true, false, null]) {
      const html = renderFeed(feedOf({ failed: [{ domain: 'supply', label: 'Supply' }] }), hasOperation);
      expect(html).toContain('Não carregou: Supply');
      expect(html).toContain('A fila pode estar incompleta');
      expect(html).not.toMatch(FALSE_ALL_CLEAR);
      expect(html).toContain('Recarregar');
    }
  });

  it('fonte que falhou com linhas: aviso antes da lista e o número como piso ("N+")', () => {
    const feed = feedOf({
      rows: [row('os:1', 'operacao')], total: 1, byDomain: { operacao: { total: 1, critical: 0 } },
      failed: [{ domain: 'supply', label: 'Achados da Apex' }, { domain: 'medicao', label: 'Medição' }, { domain: 'medicao', label: 'Medição' }],
    });
    const html = renderFeed(feed);
    expect(html).toContain('Não carregaram: Achados da Apex e Medição');
    expect(html).toContain('a fila pode estar incompleta');
    expect(html).toMatch(/>1\+</);
    expect(failedAreasText(feedOf())).toBeNull();
  });

  it('leitura com corte: o total é piso ("259+", "ou mais")', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`os:${i}`, 'operacao'));
    const html = renderFeed(feedOf({ rows, total: 259, byDomain: { operacao: { total: 259, critical: 0 } }, partial: true }));
    expect(html).toMatch(/>259\+</);
    expect(html).toContain('+219 ou mais além das 40 mais graves');
  });

  it('fila vazia: "Nada fora do lugar" só com operação sabida; sem operação sabida, o convite; desconhecida, neutro', () => {
    expect(renderFeed(feedOf(), true)).toContain('Nada fora do lugar');
    expect(renderFeed(feedOf(), false)).toContain('Ainda não há operação para acompanhar');
    const unknown = renderFeed(feedOf(), null);
    expect(unknown).not.toMatch(/Nada fora do lugar|Ainda não há operação/);
    expect(unknown).toContain('Sem exceção aberta nas áreas que você lê');
  });
});

describe('Atenção agora — filtro de área', () => {
  const feed = feedOf({
    rows: [...Array.from({ length: 15 }, (_, i) => row(`os:${i}`, 'operacao')), row('rcv:1', 'recebivel')],
    total: 30,
    byDomain: { operacao: { total: 20, critical: 0 }, recebivel: { total: 5, critical: 0 }, supply: { total: 5, critical: 0 } },
  });

  it('o "+N" da área filtrada bate com o chip (total da área − linhas listadas)', () => {
    expect(feedSlice(feed, ALL, 'operacao')).toMatchObject({ active: 'operacao', more: 5 });
    expect(feedSlice(feed, ALL, 'operacao').rows).toHaveLength(15);
    expect(feedSlice(feed, ALL, 'recebivel')).toMatchObject({ active: 'recebivel', more: 4 });
    // Área cujas linhas ficaram todas além do corte: lista vazia, mas o que falta é dito.
    const s = feedSlice(feed, ALL, 'supply');
    expect(s.rows).toHaveLength(0);
    expect(s.more).toBe(5);
    expect(feedSlice(feed, ALL, 'all')).toMatchObject({ active: 'all', more: 14 });
  });

  it('filtro de uma área que sumiu na releitura volta para "Tudo" — nunca lista vazia sem saída', () => {
    expect(feedSlice(feed, ALL, 'medicao').active).toBe('all');
    // Uma área só (a barra de filtros some): o filtro antigo não prende a lista.
    const one = feedOf({ rows: [row('os:1', 'operacao')], total: 1, byDomain: { operacao: { total: 1, critical: 0 } } });
    expect(feedSlice(one, ALL, 'operacao').active).toBe('all');
    // Área que o perfil não lê não vira filtro.
    expect(feedSlice(feed, ['operacao', 'supply'], 'recebivel').active).toBe('all');
  });
});

describe('Cabeçalho — contagem', () => {
  const data = (feed: FeedModel) => ({
    generatedAt: '2026-09-25T13:00:00Z', today: TODAY, feed: { state: 'ok', data: feed },
  }) as unknown as DashboardOverview;
  const header = (feed: FeedModel) => renderToStaticMarkup(h(HeaderContext, { data: data(feed) }));

  it('fonte que falhou: nunca "0 exceções" — diz o que não carregou', () => {
    const html = header(feedOf({ failed: [{ domain: 'supply', label: 'Supply' }] }));
    expect(html).not.toMatch(/0 exceç/);
    expect(html).toContain('Fila de atenção incompleta');
    expect(html).toContain('Não carregou: Supply');
  });

  it('piso: "ao menos N exceções"', () => {
    const html = header(feedOf({ total: 259, critical: 3, partial: true }));
    expect(html).toContain('ao menos');
    expect(html).toContain('259 exceções');
    expect(header(feedOf({ total: 4 }))).not.toContain('ao menos');
  });
});

const stageOf = (id: StageId, over: Partial<FlowStage> = {}): FlowStage => ({
  id, label: id, state: 'ok', stuck: { value: 0, noun: 'parado' }, context: null, tone: 'success', href: `/${id}`, definition: 'def', reason: null, ...over,
});
const IDS: StageId[] = ['comercial', 'os', 'projeto', 'planejamento', 'necessidades', 'supply', 'execucao', 'medicao', 'faturamento', 'recebivel'];
const caixa = stageOf('caixa', { state: 'unavailable', stuck: null, href: null, reason: 'Nenhuma conta de caixa conectada' });
const flow = (stages: FlowStage[], hasOperation: boolean | null) => renderToStaticMarkup(h(BusinessFlow, { stages, hasOperation }));

describe('Fluxo do negócio', () => {
  // Os motivos são os do SERVIDOR (rules.ts): a tela os classifica pelo texto.
  it('etapa ok sem número (autorizadas sem OS restrito ou que falhou): o motivo, nunca 0 — e fora de "sem pendência"', () => {
    const restricted = stageOf('comercial', { stuck: null, context: '12 oportunidades abertas', tone: 'neutral', reason: COMERCIAL_STUCK_REASON.restricted, noNumber: 'restricted' });
    const html = flow([restricted, ...IDS.slice(1).map((id) => stageOf(id)), caixa], true);
    expect(html).toContain('Restrito');
    expect(html).toContain(COMERCIAL_STUCK_REASON.restricted);
    expect(html).not.toMatch(/<b class="num">0<\/b><\/span><span class="dv2-stage-context">12 oportunidades/);
    expect(html).toContain('9 etapas sem pendência');
    expect(html).toContain('1 restrita');

    const failed = stageOf('comercial', { stuck: null, tone: 'neutral', reason: COMERCIAL_STUCK_REASON.error, noNumber: 'error' });
    const out = flow([failed, ...IDS.slice(1).map((id) => stageOf(id)), caixa], true);
    expect(out).toContain(COMERCIAL_STUCK_REASON.error);
    expect(out).toContain('1 não carregou');
  });

  it('etapa ok sem número por leitura incompleta (não é restrição nem falha): "sem número", nunca 0 nem "não carregou"', () => {
    const planning = stageOf('planejamento', { stuck: null, tone: 'neutral', context: '≥ 8 atividades críticas', reason: SCHEDULE_PARTIAL_REASON, noNumber: 'incomplete' });
    const html = flow([planning, stageOf('os', { stuck: { value: 2, noun: 'a emitir' }, tone: 'warning' }), caixa], true);
    expect(html).toContain(SCHEDULE_PARTIAL_REASON);
    expect(html).toContain('1 de 1 etapas legíveis com pendência · 1 sem número');
    expect(html).not.toContain('não carregou');
    expect(html).toContain('data-nonum="true"');
  });

  it('perfil sem nenhuma etapa legível: nunca "sem pendência" nem "não há operação"', () => {
    const stages = [...IDS.map((id) => stageOf(id, { state: 'restricted', stuck: null, reason: 'Seu perfil não lê esta etapa' })), caixa];
    for (const hasOperation of [false, null]) {
      const html = flow(stages, hasOperation);
      expect(html).toContain('Nenhuma etapa legível · 10 restritas');
      expect(html).toContain('O seu perfil não lê nenhuma etapa do fluxo.');
      expect(html).not.toMatch(/sem pendência|Ainda não há operação|Nenhuma etapa com pendência/);
    }
  });

  it('leitura de operação que falhou: contada à parte; resumo só sobre as legíveis', () => {
    const stages = IDS.map((id, i) => (i >= 1 && i <= 3 ? stageOf(id, { state: 'error', stuck: null, reason: 'Não carregou' })
      : i === 5 ? stageOf(id, { stuck: { value: 2, noun: 'entregas atrasadas' }, tone: 'warning' }) : stageOf(id)));
    const html = flow([...stages, caixa], null);
    expect(html).toContain('1 de 7 etapas legíveis com pendência · 3 não carregaram');
    expect(html).toContain('6 etapas sem pendência');
    expect(html).toContain('3 não carregaram · 1 sem fonte');
  });

  it('"Ainda não há operação" só com hasOperation === false; null é neutro', () => {
    const stages = [...IDS.map((id) => stageOf(id)), caixa];
    expect(flow(stages, false)).toContain('Ainda não há operação em nenhuma etapa.');
    expect(flow(stages, false)).toContain('data-start="true"');
    const unknown = flow(stages, null);
    expect(unknown).not.toContain('Ainda não há operação');
    expect(unknown).not.toContain('data-start');
    expect(unknown).toContain('Nenhuma etapa com trabalho parado.');
  });

  it('número de leitura com corte é piso ("≥")', () => {
    const html = flow([stageOf('necessidades', { stuck: { value: 12, noun: 'sem cobertura' }, partial: true, tone: 'warning' })], true);
    expect(html).toContain('≥ 12');
    expect(html).toContain('ao menos 12 sem cobertura');
  });
});

const calendar = (model: CalendarModel) => renderToStaticMarkup(h(CompanyCalendar, { section: { state: 'ok', data: model }, today: TODAY }));
const lanes = (over: Partial<Record<CalendarModel['lanes'][number]['id'], Partial<CalendarModel['lanes'][number]>>> = {}): CalendarModel['lanes'] =>
  (['operacao', 'supply', 'medicao', 'recebivel'] as const).map((id) => ({ id, label: id === 'operacao' ? 'Operação' : id, state: 'ok' as const, ...over[id] }));

describe('Próximos 30 dias', () => {
  it('faixa que falhou fica visível ("não carregou") e o calendário não diz "Nada previsto"', () => {
    const html = calendar({ days: 30, lanes: lanes({ operacao: { state: 'unavailable' } }), items: [] });
    expect(html).not.toContain('Nada previsto nos próximos 30 dias');
    expect(html).toContain('não carregou — esta faixa não foi lida');
    expect(html).toContain('<strong>Operação:</strong> não carregou');
    expect(html).toContain('nas faixas que carregaram');
  });

  it('faixa parcial: dita como parcial; "Nada previsto" só com tudo lido por inteiro e vazio', () => {
    const partial = calendar({ days: 30, lanes: lanes({ supply: { partial: true } }), items: [] });
    expect(partial).not.toContain('Nada previsto nos próximos 30 dias');
    expect(partial).toContain('carregou só em parte');
    expect(calendar({ days: 30, lanes: lanes(), items: [] })).toContain('Nada previsto nos próximos 30 dias');
  });

  it('SVG com links é `group` (nomes expostos), nunca `img`; geometria finita', () => {
    const html = calendar({
      days: 30, lanes: lanes(),
      items: [{ id: 'm1', date: '2026-10-02', title: 'Comissionamento UG-05', lane: 'operacao', kind: 'milestone', tone: 'accent', href: '/projetos/p1', project: 'UG-05' },
        { id: 'bad', date: 'x', title: 'Data inválida', lane: 'supply', kind: 'need', tone: 'warning', href: null, project: null }],
    });
    expect(html).toContain('role="group"');
    expect(html).not.toContain('role="img"');
    expect(html).toMatch(/<a href="\/projetos\/p1" aria-label="[^"]+ — Marco: Comissionamento UG-05 · UG-05">/);
    expect(html).toContain('aria-label="Operação: 1 item"');
    // O item de data inválida não é desenhado nem contado.
    expect(html).toContain('aria-label="supply: nada previsto"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

const explainOf = (over: Partial<Extract<ExplainResponse, { ok: true }>> = {}) => ({
  ok: true, ref: 'mat:x', title: 'Falta de material',
  detected: { object: 'Cabo 10mm', problem: 'Sem cobertura', due: null, owner: null, ownerApplicable: false, location: 'UG-05' },
  chain: [] as ChainLink[], relation: null, evidence: [], apex: null, nextAction: null, rule: null, asOf: '2026-09-25T13:00:00Z', ...over,
});
const explain = () => renderToStaticMarkup(h(ExplainPanel, { reference: 'mat:x', today: TODAY, onClose: () => undefined }));

describe('Entender', () => {
  beforeEach(() => { explainState.state = 'ready'; panelProps.last = null; });

  it('"Responsável" só onde o tipo tem dono', () => {
    explainState.data = explainOf();
    expect(explain()).not.toContain('Responsável');
    explainState.data = explainOf({ detected: { ...explainOf().detected, ownerApplicable: true } });
    expect(explain()).toContain('<dt>Responsável</dt><dd>sem responsável</dd>');
  });

  it('cada elo mostra a ETAPA e o rótulo — "Próximo marco do cronograma" não se perde', () => {
    explainState.data = explainOf({
      chain: [
        { stage: 'Marco contratual', label: 'Vínculo contratual restrito', detail: 'Seu perfil não lê Contratos.', state: 'restricted', href: null },
        { stage: 'Próximo marco do cronograma', label: 'COMISSIONAMENTO UG-05', detail: 'previsto para 12/10/2026', state: 'found', tone: 'neutral', href: '/projetos/p1', note: 'proximidade no cronograma, não dependência' },
        { stage: 'Faturamento', label: 'ainda não nasceu', detail: 'O faturamento nasce do aceite do cliente sobre a medição.', state: 'pending', href: null },
      ],
    });
    const html = explain();
    expect(html).toContain('<span class="dv2-chain-stage">Próximo marco do cronograma</span><span class="dv2-chain-label">COMISSIONAMENTO UG-05</span>');
    expect(html).toContain('<span class="dv2-chain-stage">Faturamento</span><span class="dv2-chain-label">ainda não nasceu</span>');
    expect(html).toContain('<span class="dv2-chain-stage">Marco contratual</span>');
    expect(html).toContain('proximidade no cronograma, não dependência');
  });

  it('os tons --dv2-* chegam ao painel, que vai por portal para fora de .dv2', () => {
    explainState.data = explainOf();
    explain();
    expect(panelProps.last?.testId).toBe('dashboard-explain');
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/components/dashboard-v2/dashboard-v2.css'), 'utf8');
    const rule = css.match(/([^{}]+)\{[^}]*--dv2-accent:/);
    expect(rule?.[1]).toContain(".ax-sheet[data-testid='dashboard-explain']");
    expect(rule?.[1]).toContain('.dv2');
  });
});
