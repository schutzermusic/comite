/**
 * Regras PURAS das operações no globo (src/lib/dashboard/sites.ts):
 *  • precedência da posição: oficial → canteiro único do Supply (só ativo);
 *  • ambiguidade (dois canteiros com coordenada = sem ponto);
 *  • coordenada fora do mundo / não finita não vira ponto;
 *  • exceções contadas ANTES do corte da fila, com a contagem sem corte de Operações;
 *  • "sem localização" = ativos sem nenhuma posição (exata ou `truncated`);
 *  • estados `restricted` / `error` da seção.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSitesModel, buildSitesSection, canonicalPosition, compareMarkers, normalizeUf, projectPlace, projectSitePosition,
  resolvePositions, siteExceptions, siteLabel, siteStates, validCoordinate, SITES_HEALTH_ERROR, SITES_POSITIONS_ERROR,
  type CanonicalMarkerRow, type ProjectSiteRow, type SiteHealthInput, type SitePositionsRead, type SiteProject, type SitesOpsInput,
} from '@/lib/dashboard/sites';
import { buildFeedModel, rankFeed, FEED_ROWS_CAP } from '@/lib/dashboard/rules';
import type { FeedRow, SiteMarker } from '@/lib/dashboard/types';

/* ── Fixtures (os três canteiros reais do QA, no Pará) ──────────────────── */

const TUC = 'qa-scn-tucurui';
const MAR = 'qa-scn-maraba';
const BAR = 'qa-scn-barcarena';

const site = (id: string, project_id: string | null, lat: unknown, lng: unknown, over: Partial<ProjectSiteRow> = {}): ProjectSiteRow => ({
  id, project_id, code: `CANT-${id.toUpperCase()}`, name: `Canteiro ${id}`, latitude: lat, longitude: lng,
  updated_at: '2026-09-24T18:45:17.534152+00:00', ...over,
});

const canon = (project_id: string, over: Partial<CanonicalMarkerRow> = {}): CanonicalMarkerRow => ({
  project_id, project_name: null, project_code: null, latitude: -18.4933, longitude: -49.4919, precision: 'site',
  site_label: 'UG-05 — casa de força', municipality: 'Cachoeira Dourada', state_code: 'go', evidence_kind: 'contract_scope',
  source_contract_id: 'c-1', source_document_id: 'd-1', source_page: 12, geocoded_at: '2026-09-20T10:00:00Z', ...over,
});

const proj = (id: string, over: Partial<SiteProject> = {}): SiteProject => ({
  id, name: `Projeto ${id}`, code: null, client: 'Cliente', municipality: null, uf: 'PA', ...over,
});

const health = (projectId: string, level: SiteHealthInput['level'], over: Partial<SiteHealthInput> = {}): SiteHealthInput => ({
  projectId, level, reasons: level === 'critical' ? ['1 atividade bloqueada'] : [], nextMilestone: null, nextMilestoneTitle: null, ...over,
});

const read = (over: Partial<SitePositionsRead> = {}): SitePositionsRead => ({
  canonical: [], canonicalTruncated: false, sites: [], sitesState: 'ok', sitesTruncated: false, projects: [], ...over,
});

const ops = (h: SiteHealthInput[], over: Partial<SitesOpsInput> = {}): SitesOpsInput & { health: SiteHealthInput[] } => ({
  health: h, attentionByProject: {}, projectsTruncated: false, ...over,
} as SitesOpsInput & { health: SiteHealthInput[] });

let seq = 0;
const row = (over: Partial<FeedRow>): FeedRow => ({
  key: `k:${seq++}`, domain: 'supply', severity: 'high', kindLabel: 'Material', location: { kind: 'project', id: TUC, label: 'SE Tucuruí' },
  object: 'o', problem: 'Falta 500 m — sem estoque nem pedido', consequence: null, due: null, owner: null, ownerApplicable: false, count: 1,
  nextAction: { label: 'Cobrir falta', href: '/supply/planejamento-materiais?req=r', focused: true }, explainRef: null, apex: null,
  rule: 'regra', ...over,
});

/* ── Validação ──────────────────────────────────────────────────────────── */

describe('validCoordinate', () => {
  it('aceita número finito dentro do mundo (inclusive nos limites e em texto numérico)', () => {
    expect(validCoordinate(-3.7662, -49.6725)).toEqual({ lat: -3.7662, lng: -49.6725 });
    expect(validCoordinate('-1.5059', '-48.6255')).toEqual({ lat: -1.5059, lng: -48.6255 });
    expect(validCoordinate(90, 180)).toEqual({ lat: 90, lng: 180 });
    expect(validCoordinate(-90, -180)).toEqual({ lat: -90, lng: -180 });
  });

  it('recusa nulo, vazio, NaN, infinito, fora do intervalo e tipos estranhos — nunca um ponto em (0, 0)', () => {
    for (const [lat, lng] of [
      [null, -49], [-3, null], [undefined, undefined], ['', ''], [' ', '-49'], [Number.NaN, -49], [-3, Number.POSITIVE_INFINITY],
      [90.0001, 0], [-90.5, 0], [0, 180.01], [0, -181], [true, false], ['abc', '-49'], [{}, []],
    ] as Array<[unknown, unknown]>) {
      expect(validCoordinate(lat, lng), `${String(lat)},${String(lng)}`).toBeNull();
    }
  });

  it('normalizeUf: só as 27 UFs', () => {
    expect(normalizeUf(' pa ')).toBe('PA');
    expect(normalizeUf('DF')).toBe('DF');
    expect(normalizeUf('XX')).toBeNull();
    expect(normalizeUf('Pará')).toBeNull();
    expect(normalizeUf(null)).toBeNull();
  });

  it('projectPlace: cidade/UF declaradas no cadastro (project → project_v2)', () => {
    expect(projectPlace({ cidade: 'Tucuruí', uf: 'PA' }, null)).toEqual({ municipality: 'Tucuruí', uf: 'PA' });
    expect(projectPlace({}, { location: { city: 'Cachoeira Dourada', uf: 'go' } })).toEqual({ municipality: 'Cachoeira Dourada', uf: 'GO' });
    expect(projectPlace({ uf: 'Pará' }, null)).toEqual({ municipality: null, uf: null });
    expect(projectPlace(null, null)).toEqual({ municipality: null, uf: null });
  });
});

describe('posições', () => {
  it('canonicalPosition: proveniência documental, UF normalizada, precisão conservadora', () => {
    expect(canonicalPosition(canon('p-ug05'))).toEqual({
      lat: -18.4933, lng: -49.4919, precision: 'site', label: 'UG-05 — casa de força', municipality: 'Cachoeira Dourada', uf: 'GO',
      source: 'canonical',
      evidence: { kind: 'contract_scope', contractId: 'c-1', documentId: 'd-1', page: 12, at: '2026-09-20T10:00:00Z' },
    });
    expect(canonicalPosition(canon('p', { precision: 'estimated' }))?.precision).toBe('municipality');
    // sem proveniência reconhecida não há posição oficial
    expect(canonicalPosition(canon('p', { evidence_kind: null }))).toBeNull();
    expect(canonicalPosition(canon('p', { evidence_kind: 'geocoder_guess' }))).toBeNull();
    expect(canonicalPosition(canon('p', { latitude: Number.NaN }))).toBeNull();
  });

  it('projectSitePosition: "Canteiro <código>", precisão de canteiro, fonte Supply, cidade/UF do cadastro', () => {
    const pos = projectSitePosition(site('tucurui', TUC, -3.7662, -49.6725, { code: 'CANT-TUCURUI' }), { municipality: 'Tucuruí', uf: 'PA' });
    expect(pos).toEqual({
      lat: -3.7662, lng: -49.6725, precision: 'site', label: 'Canteiro CANT-TUCURUI', municipality: 'Tucuruí', uf: 'PA',
      source: 'project_site',
      evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: '2026-09-24T18:45:17.534152+00:00' },
    });
    expect(siteLabel({ code: null, name: 'Canteiro SE Tucuruí' })).toBe('Canteiro SE Tucuruí');
    expect(siteLabel({ code: '', name: 'Pátio 138 kV' })).toBe('Canteiro Pátio 138 kV');
    expect(projectSitePosition(site('x', TUC, 95, 0), null)).toBeNull();
  });

  it('precedência: a oficial vence o canteiro; canteiro só para projeto ATIVO', () => {
    const r = resolvePositions(read({
      canonical: [canon(TUC)],
      sites: [site('tuc', TUC, -3.7662, -49.6725), site('mar', MAR, -5.3686, -49.1178), site('old', 'p-inativo', -2, -50)],
      projects: [proj(TUC), proj(MAR, { municipality: 'Marabá' }), proj('p-inativo')],
    }), new Set([TUC, MAR]));
    expect(r.positions.get(TUC)?.source).toBe('canonical');
    expect(r.positions.get(MAR)).toMatchObject({ source: 'project_site', lat: -5.3686, municipality: 'Marabá', uf: 'PA' });
    expect(r.positions.has('p-inativo')).toBe(false);
    expect(r.ambiguous.size).toBe(0);
  });

  it('ambiguidade: dois canteiros com coordenada = sem ponto; um válido + um inválido = o válido', () => {
    const r = resolvePositions(read({
      sites: [
        site('a', MAR, -5.3686, -49.1178), site('b', MAR, -5.4, -49.2),
        site('c', BAR, -1.5059, -48.6255), site('d', BAR, Number.NaN, -48.6),
      ],
      projects: [proj(MAR), proj(BAR)],
    }), new Set([MAR, BAR]));
    expect(r.positions.has(MAR)).toBe(false);
    expect([...r.ambiguous]).toEqual([MAR]);
    expect(r.positions.get(BAR)).toMatchObject({ source: 'project_site', lat: -1.5059, lng: -48.6255 });
  });

  it('oficial que não passa na validação NÃO cai para o canteiro (a fonte não muda calada)', () => {
    const r = resolvePositions(read({
      canonical: [canon(TUC, { latitude: 'NaN' })],
      sites: [site('tuc', TUC, -3.7662, -49.6725)],
      projects: [proj(TUC)],
    }), new Set([TUC]));
    expect(r.positions.size).toBe(0);
  });

  it('canteiros não lidos (restrito ou falha): só as oficiais', () => {
    for (const sitesState of ['restricted', 'error'] as const) {
      const r = resolvePositions(read({ canonical: [canon(TUC)], sites: [site('mar', MAR, -5.3686, -49.1178)], sitesState,
        projects: [proj(TUC), proj(MAR)] }), new Set([TUC, MAR]));
      expect([...r.positions.keys()]).toEqual([TUC]);
    }
  });
});

/* ── Exceções ───────────────────────────────────────────────────────────── */

describe('siteExceptions', () => {
  it('conta a fila INTEIRA antes do corte de 40, por projeto; top = a mais grave', () => {
    const rows: FeedRow[] = [
      ...Array.from({ length: 50 }, (_, i) => row({ key: `req:a${i}`, severity: i < 3 ? 'critical' : 'high', location: { kind: 'project', id: BAR, label: 'Barcarena' } })),
      ...Array.from({ length: 7 }, (_, i) => row({ key: `req:t${i}`, severity: i === 0 ? 'critical' : 'medium', due: '2026-09-30',
        problem: i === 0 ? 'Falta 500 m — sem estoque nem pedido' : 'outra' })),
      row({ key: 'bill:c1:release', domain: 'faturamento', location: { kind: 'contract', id: 'c1', label: 'CT-1' } }),
      row({ key: 'sig:x', location: { kind: 'organization', id: null, label: null } }),
    ];
    const ranked = rankFeed(rows);
    const feed = buildFeedModel(ranked);
    expect(feed.rows).toHaveLength(FEED_ROWS_CAP);
    // as linhas de Tucuruí ficaram quase todas fora do corte — e contam mesmo assim
    expect(feed.rows.filter((r) => r.location.id === TUC).length).toBeLessThan(7);
    const ex = siteExceptions(ranked, {});
    expect(ex.get(BAR)).toMatchObject({ total: 50, critical: 3 });
    expect(ex.get(TUC)).toMatchObject({ total: 7, critical: 1 });
    expect(ex.get(TUC)?.top?.severity).toBe('critical');
    expect(ex.get(TUC)?.top?.problem).toBe('Falta 500 m — sem estoque nem pedido');
    // contrato e organização não têm local no mapa
    expect(ex.has('c1')).toBe(false);
    expect([...ex.keys()].sort()).toEqual([BAR, TUC].sort());
  });

  it('OS / medição / risco / dependência vêm da contagem SEM corte de Operações (sem contar duas vezes)', () => {
    const ranked = rankFeed([
      row({ key: 'os:o1', domain: 'operacao', severity: 'critical', kindLabel: 'OS' }),
      row({ key: 'meas:m1', domain: 'medicao', severity: 'high', kindLabel: 'Medição' }),
      row({ key: 'req:r1', severity: 'high' }),
      row({ key: 'proj-act:x', domain: 'operacao', severity: 'critical', kindLabel: 'Cronograma' }),
    ]);
    // Operações contou 5 para Tucuruí (2 perigo) — a fila dela cortou 3; Marabá só tem linha cortada.
    const ex = siteExceptions(ranked, { [TUC]: { total: 5, danger: 2 }, [MAR]: { total: 2, danger: 0 } });
    expect(ex.get(TUC)).toMatchObject({ total: 2 + 5, critical: 1 + 2 });
    expect(ex.get(TUC)?.top?.key).toMatch(/^(os:o1|proj-act:x)$/);
    expect(ex.get(MAR)).toEqual({ total: 2, critical: 0, top: null });
    // sem a contagem de Operações: só o que chegou à fila
    expect(siteExceptions(ranked, null).get(TUC)).toMatchObject({ total: 4, critical: 2 });
  });
});

/* ── Modelo ─────────────────────────────────────────────────────────────── */

describe('buildSitesModel', () => {
  const qaRead = () => read({
    sites: [
      site('tuc', TUC, -3.7662, -49.6725, { code: 'CANT-TUCURUI' }),
      site('mar', MAR, -5.3686, -49.1178, { code: 'CANT-MARABA' }),
      site('bar', BAR, -1.5059, -48.6255, { code: 'CANT-BARCARENA' }),
    ],
    projects: [
      proj(TUC, { name: 'SE Tucuruí 138 kV — Ampliação do pátio', client: 'Equatorial Pará', municipality: 'Tucuruí' }),
      proj(MAR, { name: 'LT Marabá–Parauapebas — Reforço de estruturas', client: 'Vale S.A.', municipality: 'Marabá' }),
      proj(BAR, { name: 'Usina Solar Barcarena — Comissionamento', client: 'Hydro Alunorte', municipality: 'Barcarena' }),
    ],
  });

  it('os três canteiros do QA: marcadores do Supply, saúde de todos, ordem crítico → atenção, UF', () => {
    const others = Array.from({ length: 345 }, (_, i) => health(`p-${i}`, 'critical'));
    const { model, truncated } = buildSitesModel({
      read: qaRead(),
      ops: ops([...others, health(MAR, 'attention', { nextMilestone: '2026-10-24', nextMilestoneTitle: 'Reforço concluído' }),
        health(TUC, 'critical', { nextMilestone: '2026-10-22T00:00:00Z' }), health(BAR, 'critical')]),
      ranked: rankFeed([row({ key: 'req:t1', severity: 'critical' })]),
      exceptionsPartial: false,
      unlocatedHref: '/supply/estoque?view=locais',
    });
    expect(truncated).toBe(false);
    // críticos pelo nome ("SE Tucuruí" < "Usina Solar Barcarena"), depois atenção
    expect(model.markers.map((m) => m.projectId)).toEqual([TUC, BAR, MAR]);
    expect(model.markers.every((m) => m.position.source === 'project_site' && m.position.evidence.kind === 'supply_site')).toBe(true);
    const tuc = model.markers.find((m) => m.projectId === TUC)!;
    expect(tuc).toMatchObject({
      name: 'SE Tucuruí 138 kV — Ampliação do pátio', client: 'Equatorial Pará', code: null, level: 'critical',
      reasons: ['1 atividade bloqueada'], nextMilestone: { date: '2026-10-22', title: null },
      exceptions: { total: 1, critical: 1, partial: false },
      topIssue: { label: 'Material: Falta 500 m — sem estoque nem pedido', href: '/supply/planejamento-materiais?req=r', severity: 'critical' },
      href: '/projetos/qa-scn-tucurui?tab=overview',
      position: { label: 'Canteiro CANT-TUCURUI', municipality: 'Tucuruí', uf: 'PA', precision: 'site' },
    });
    const mar = model.markers.find((m) => m.projectId === MAR)!;
    expect(mar.level).toBe('attention');
    expect(mar.nextMilestone).toEqual({ date: '2026-10-24', title: 'Reforço concluído' });
    expect(mar.exceptions).toEqual({ total: 0, critical: 0, partial: false });
    expect(mar.topIssue).toBeNull();
    // 348 ativos, 3 localizados
    expect(model.unlocated).toBe(345);
    expect(model.unlocatedHref).toBe('/supply/estoque?view=locais');
    expect(model.states).toEqual([{ uf: 'PA', projects: 3, critical: 2, attention: 1 }]);
  });

  it('"sem localização" = ativos sem posição; o inativo com oficial vira ponto com level null e não conta', () => {
    const { model } = buildSitesModel({
      read: read({
        canonical: [canon('p-oficial'), canon('p-inativo', { state_code: 'SP' })],
        sites: [site('a', 'p-canteiro', -3, -49), site('b', 'p-ambiguo', -3, -49), site('c', 'p-ambiguo', -3.1, -49.1)],
        projects: [proj('p-oficial'), proj('p-inativo', { uf: null }), proj('p-canteiro'), proj('p-ambiguo')],
      }),
      ops: ops([health('p-oficial', 'healthy'), health('p-canteiro', 'unknown'), health('p-ambiguo', 'attention'), health('p-nada', 'critical')]),
      ranked: [],
      exceptionsPartial: true,
      unlocatedHref: '/projetos',
    });
    expect(model.markers.map((m) => [m.projectId, m.level])).toEqual([
      ['p-oficial', 'healthy'], ['p-canteiro', 'unknown'], ['p-inativo', null],
    ]);
    const inactive = model.markers.find((m) => m.projectId === 'p-inativo')!;
    expect(inactive).toMatchObject({ reasons: [], nextMilestone: null, exceptions: { total: 0, critical: 0, partial: true } });
    // ativos: oficial, canteiro, ambíguo, nada → sem posição: ambíguo e nada
    expect(model.unlocated).toBe(2);
    expect(model.states).toEqual([{ uf: 'GO', projects: 1, critical: 0, attention: 0 }, { uf: 'PA', projects: 1, critical: 0, attention: 0 },
      { uf: 'SP', projects: 1, critical: 0, attention: 0 }]);
  });

  it('projeto sem identidade lida (RLS) não vira ponto nem id cru', () => {
    const { model } = buildSitesModel({
      read: read({ sites: [site('a', TUC, -3, -49)], projects: [] }),
      ops: ops([health(TUC, 'critical')]), ranked: [], exceptionsPartial: false, unlocatedHref: '/projetos',
    });
    expect(model.markers).toEqual([]);
    expect(model.unlocated).toBe(1);
  });

  it('`truncated`: canteiros não lidos, leitura cortada ou lista de ativos cortada → "sem localização" é teto', () => {
    const base = { ops: ops([health(TUC, 'critical')]), ranked: [], exceptionsPartial: false, unlocatedHref: '/projetos' };
    const withSites = qaRead();
    expect(buildSitesModel({ ...base, read: withSites }).truncated).toBe(false);
    expect(buildSitesModel({ ...base, read: { ...withSites, sitesState: 'error' } }).truncated).toBe(true);
    expect(buildSitesModel({ ...base, read: { ...withSites, sitesState: 'restricted' } }).truncated).toBe(true);
    expect(buildSitesModel({ ...base, read: { ...withSites, sitesTruncated: true } }).truncated).toBe(true);
    expect(buildSitesModel({ ...base, read: { ...withSites, canonicalTruncated: true } }).truncated).toBe(true);
    expect(buildSitesModel({ ...base, read: withSites, ops: ops([health(TUC, 'critical')], { projectsTruncated: true }) }).truncated).toBe(true);
    // saúde de leitura cortada: um "em dia" pode não ser
    expect(buildSitesModel({ ...base, read: withSites, ops: ops([health(TUC, 'healthy')], { healthPartial: true }) }).truncated).toBe(true);
    // sem canteiros lidos, Tucuruí fica sem ponto e conta como sem localização (teto)
    const failed = buildSitesModel({ ...base, read: { ...withSites, sitesState: 'error' } });
    expect(failed.model.markers).toEqual([]);
    expect(failed.model.unlocated).toBe(1);
  });

  it('organização vazia: 0 marcadores, 0 sem localização, nenhuma UF', () => {
    const { model, truncated } = buildSitesModel({ read: read(), ops: ops([]), ranked: [], exceptionsPartial: false, unlocatedHref: '/projetos' });
    expect(model).toEqual({ markers: [], unlocated: 0, unlocatedHref: '/projetos', states: [] });
    expect(truncated).toBe(false);
  });

  it('compareMarkers e siteStates: ordem estável', () => {
    const m = (projectId: string, level: SiteMarker['level'], name: string, uf: string | null): SiteMarker => ({
      projectId, name, client: null, code: null, level, reasons: [], nextMilestone: null, topIssue: null, href: '',
      exceptions: { total: 0, critical: 0, partial: false },
      position: { lat: 0, lng: 0, precision: 'site', label: null, municipality: null, uf, source: 'project_site',
        evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: null } },
    });
    const list = [m('e', null, 'Alfa', 'SP'), m('d', 'unknown', 'Alfa', 'PA'), m('c', 'healthy', 'Alfa', 'PA'), m('b', 'attention', 'Beta', 'GO'),
      m('a', 'critical', 'Zeta', null), m('a2', 'critical', 'Ágata', 'GO')].sort(compareMarkers);
    expect(list.map((x) => x.projectId)).toEqual(['a2', 'a', 'b', 'c', 'd', 'e']);
    expect(siteStates(list)).toEqual([
      { uf: 'GO', projects: 2, critical: 1, attention: 1 }, { uf: 'PA', projects: 2, critical: 0, attention: 0 },
      { uf: 'SP', projects: 1, critical: 0, attention: 0 },
    ]);
  });
});

/* ── Aditivos de Operações (src/lib/operations/overview.ts) ─────────────── */

describe('operationsOverview · healthAll (aditivo para o globo)', () => {
  type Spec = { rows?: Record<string, unknown>[]; error?: string };
  function fakeClient(tables: Record<string, Spec>) {
    return {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'is', 'not', 'or', 'order', 'limit', 'in']) chain[m] = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) => {
          const spec = tables[table] ?? {};
          return resolve(spec.error ? { data: null, error: { message: spec.error } } : { data: spec.rows ?? [], error: null });
        };
        return chain;
      },
    };
  }
  const TODAY = '2026-09-25';
  const project = (id: string, status = 'em_andamento') => ({ id, project: { nome: `Projeto ${id}`, status }, project_v2: null });
  const listServiceOrders = vi.fn(async () => [] as unknown[]);

  afterEach(() => {
    vi.doUnmock('@/lib/operations/service-orders/read-model'); vi.doUnmock('@/lib/commercial/owner-directory');
    vi.resetModules(); listServiceOrders.mockReset(); listServiceOrders.mockImplementation(async () => []);
  });
  async function load() {
    vi.doMock('@/lib/operations/service-orders/read-model', () => ({ listServiceOrders }));
    vi.doMock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));
    vi.resetModules();
    return import('@/lib/operations/overview');
  }

  it('saúde de TODOS os ativos (sem o corte de 30) e candidatos da fila por projeto (sem o corte de 40/15)', async () => {
    const { operationsOverview } = await load();
    const counts = { unreviewedItems: 0, blockingOpen: 2, openDivergences: 0 };
    listServiceOrders.mockResolvedValueOnce([
      { id: 'o1', osNumber: 'OS-1', title: 'OS', status: 'PENDING_CONFIRMATION', projectId: 'p0', customer: null, plannedStart: null, ownerName: null, counts },
    ]);
    const sb = fakeClient({
      projects: { rows: [...Array.from({ length: 40 }, (_, i) => project(`p${i}`)), project('p-fim', 'concluido')] },
      // 20 dependências vencidas do cliente em p1: a fila leva 15, a contagem por projeto leva 20
      project_requirements: { rows: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, project_id: 'p1', title: `Dep ${i}`, required_by: '2026-09-01' })) },
      risks: { rows: [{ id: 'r1', title: 'Transformador', severity: 'high', status: 'open', responsible_id: null, reference_id: 'p2',
        origin: 'manual', due_date: null }] },
    });
    const access = { projects: true, measurements: true, risks: true, serviceOrders: true };
    const o = await operationsOverview({ supabase: sb as never, organizationId: 'org-1' }, access, TODAY, { healthAll: true });
    expect(o.projectHealth).toHaveLength(30);
    expect(o.projectHealthAll).toHaveLength(40);
    expect(o.projectHealthAll?.some((p) => p.projectId === 'p-fim')).toBe(false);
    expect(o.projectHealthAll?.find((p) => p.projectId === 'p1')?.level).toBe('critical');
    expect(o.attention.filter((a) => a.kind === 'dependency')).toHaveLength(15);
    expect(o.attentionByProject).toEqual({ p0: { total: 1, danger: expect.any(Number) }, p1: { total: 20, danger: 20 }, p2: { total: 1, danger: 0 } });
    expect(o.projectsTruncated).toBe(false);

    // Sem a opção: a resposta de Operações não carrega as listas sem corte.
    const plain = await operationsOverview({ supabase: sb as never, organizationId: 'org-1' }, access, TODAY);
    expect(plain.projectHealthAll).toBeNull();
    expect(plain.attentionByProject).toBeNull();
    expect(plain.projectHealth).toHaveLength(30);
  });

  it('sem leitura de projetos: nada de saúde, mesmo com a opção', async () => {
    const { operationsOverview } = await load();
    const o = await operationsOverview({ supabase: fakeClient({}) as never, organizationId: 'org-1' },
      { projects: false, measurements: false, risks: false, serviceOrders: false }, TODAY, { healthAll: true });
    expect(o.projectHealthAll).toBeNull();
    expect(o.projectsTruncated).toBe(false);
  });
});

/* ── Seção ──────────────────────────────────────────────────────────────── */

describe('buildSitesSection', () => {
  const okOps = { state: 'ok' as const, data: { health: [health(TUC, 'critical')], attentionByProject: {}, projectsTruncated: false } };
  const okRead = { state: 'ok' as const, data: read({ sites: [site('a', TUC, -3.7662, -49.6725)], projects: [proj(TUC)] }) };
  const base = { ranked: [], exceptionsPartial: false, unlocatedHref: '/projetos' };

  it('sem leitura de projetos → Restrito (nunca 0 marcadores)', () => {
    expect(buildSitesSection({ ...base, gate: false, positions: okRead, ops: okOps })).toEqual({ state: 'restricted' });
    expect(buildSitesSection({ ...base, gate: true, positions: { state: 'restricted' }, ops: okOps })).toEqual({ state: 'restricted' });
  });

  it('posições oficiais que falham → `error`; saúde que falha ou falta → `error` (nunca "sem cronograma")', () => {
    expect(buildSitesSection({ ...base, gate: true, positions: { state: 'error', message: 'x' }, ops: okOps }))
      .toEqual({ state: 'error', message: SITES_POSITIONS_ERROR });
    expect(buildSitesSection({ ...base, gate: true, positions: okRead, ops: { state: 'error', message: 'x' } }))
      .toEqual({ state: 'error', message: SITES_HEALTH_ERROR });
    expect(buildSitesSection({ ...base, gate: true, positions: okRead,
      ops: { state: 'ok', data: { health: null, attentionByProject: null, projectsTruncated: false } } }))
      .toEqual({ state: 'error', message: SITES_HEALTH_ERROR });
  });

  it('ok: modelo; `truncated` só quando incompleto', () => {
    const s = buildSitesSection({ ...base, gate: true, positions: okRead, ops: okOps });
    expect(s.state).toBe('ok');
    if (s.state !== 'ok') return;
    expect(s.truncated).toBeUndefined();
    expect(s.data.markers).toHaveLength(1);
    expect(s.data.unlocated).toBe(0);
    const canonicalOnly = buildSitesSection({ ...base, gate: true, positions: { state: 'ok', data: { ...okRead.data, sitesState: 'restricted' } }, ops: okOps });
    expect(canonicalOnly).toMatchObject({ state: 'ok', truncated: true, data: { markers: [], unlocated: 1 } });
  });
});
