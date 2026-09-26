/**
 * O MODELO ESQUEMÁTICO DA OBRA (HUD 3D do local) — geometria procedural por
 * tipo de obra, finita e contada; a spec sai só do dado real do local.
 *
 *   layouts   subestação (bays, pórticos, disjuntores, barramentos, trafo,
 *             casa de comando, canaleta), LT (torres + catenárias), solar
 *             (mesas + inversores), hidrelétrica (unidades), eólica, genérica
 *   tipo      desconhecido/ausente → genérica (só muda o desenho)
 *   foco      palavra-chave do título da fase → grupo; sem casar → nenhum
 *   spec      só canteiro (`precision: 'site'`) e Visão geral/Planejar;
 *             equipe restrita = sem pontos e "Restrito" (nunca 0); zero =
 *             "Nenhuma alocação registrada" (a fonte, não "ninguém na obra");
 *             avanço só com percentual; pátio → Supply Chain
 *   cartões   dentro da área livre do HUD, sem cruzar outro cartão, o rótulo
 *             obrigatório nem o hexágono do local; virados/afastados com fio;
 *             ponto atrás de painel ou sem lugar = não aparece (nunca cortado)
 *
 *   npx vitest run --project unit tests/unit/dashboard-globe-twin.test.ts
 */
import { describe, expect, it } from 'vitest';
import type { TwinSpec } from '@/components/dashboard-globe/contract';
import { freeRect, siteView, TWIN_AZIMUTH_DEG, type HudGrid } from '@/components/dashboard-globe/presets';
import {
  buildLayout, catenary, groupFrame, layoutBox, layoutKind, primPoints, rect, schematicScale, TWIN_KINDS, TWIN_TARGET_M,
} from '@/components/dashboard-globe/twin/layouts';
import { focusGroupFor, fold, shortDate, TEAM_NONE, TWIN_NOTE, twinSpecFor, wantsHighlightNew } from '@/components/dashboard-globe/twin/spec';
import {
  CARD_DOT, CARD_SIZE, placeCards, TwinModel, twinGeometryKey, twinToneColor, type CardRequest, type ScreenRect, type TwinProjector,
} from '@/components/dashboard-globe/twin/draw';
import { hotspotAriaLabel } from '@/components/dashboard-globe/twin/hotspots';
import { ecefOf, latLngOfSurface, poseFromView, projectPose } from '@/components/dashboard-globe/camera';
import type { SectionState, SiteHud, SiteKind, SitePosition } from '@/lib/dashboard/types';

const finiteDeep = (v: unknown): boolean => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finiteDeep);
  if (v && typeof v === 'object') return Object.values(v).every(finiteDeep);
  return true;
};

describe('layouts procedurais por tipo de obra', () => {
  it('todos os tipos: geometria finita, grupos coerentes, âncoras finitas', () => {
    for (const kind of TWIN_KINDS) {
      const L = buildLayout(kind);
      expect(L.kind).toBe(kind);
      expect(L.prims.length).toBeGreaterThan(10);
      expect(finiteDeep(L.prims)).toBe(true);
      expect(finiteDeep(L.anchors)).toBe(true);
      expect(L.groups).toContain(L.defaultFocus);
      expect(L.groups).toContain('laydown');
      expect(new Set(L.groups).size).toBe(L.groups.length);
      for (const p of L.prims) {
        expect(L.groups).toContain(p.group);
        // tudo dentro da extensão declarada (+ folga do pátio fora da cerca)
        for (const [x, y, z] of primPoints(p)) {
          expect(Math.abs(x)).toBeLessThanOrEqual(L.extent.halfL * 1.1 + 40);
          expect(Math.abs(y)).toBeLessThanOrEqual(L.extent.halfW * 1.1 + 40);
          expect(z).toBeGreaterThanOrEqual(0);
          expect(z).toBeLessThan(160);
        }
        if (p.t === 'box') expect(p.h).toBeGreaterThan(0);
        if (p.t === 'cyl') expect(p.z1).toBeGreaterThan(p.z0);
      }
      const f = groupFrame(L, L.defaultFocus);
      expect(f && finiteDeep(f)).toBe(true);
    }
  });

  it('contagens por tipo (o que a gramática promete desenhar)', () => {
    const count = (kind: SiteKind, pred: (p: ReturnType<typeof buildLayout>['prims'][number]) => boolean) => buildLayout(kind).prims.filter(pred).length;
    // subestação: 6 bays → 6 disjuntores (caixa), 2 trafos (+ parede corta-fogo), casa de comando, 2 barras
    expect(count('substation', (p) => p.group === 'breakers' && p.t === 'box')).toBe(6);
    expect(count('substation', (p) => p.group === 'transformer' && p.t === 'box')).toBe(3);
    expect(count('substation', (p) => p.group === 'control' && p.t === 'box')).toBe(2);
    expect(count('substation', (p) => p.group === 'trench')).toBeGreaterThan(2);
    expect(count('substation', (p) => p.group === 'gantries')).toBeGreaterThan(20);
    expect(count('substation', (p) => 'isNew' in p && p.isNew === true)).toBeGreaterThan(0);
    for (const g of ['gantries', 'breakers', 'buses', 'transformer', 'control', 'trench', 'foundations', 'laydown', 'fence', 'yard']) {
      expect(buildLayout('substation').groups).toContain(g);
    }
    // LT: 5 torres (4 pés cada) e 4 vãos × (3 fases + para-raios) de catenária
    expect(count('transmission', (p) => p.group === 'foundations')).toBe(20);
    expect(count('transmission', (p) => p.group === 'conductors')).toBe(16);
    // solar: 3 × 2 blocos × 6 fileiras de mesas; 6 inversores + cabine
    expect(count('solar', (p) => p.t === 'quad')).toBe(36);
    expect(count('solar', (p) => p.group === 'inverters')).toBe(7);
    // hidrelétrica: 4 unidades (estator + rotor) em raio-x
    expect(count('hydro', (p) => p.group === 'unit' && p.t === 'cyl')).toBe(8);
    // eólica: 3 aerogeradores (torre cilíndrica)
    expect(count('wind', (p) => p.group === 'turbines' && p.t === 'cyl')).toBe(3);
    expect(count('generic', (p) => p.group === 'building')).toBeGreaterThan(0);
  });

  it('tipo → layout: desconhecido/ausente é genérico; memorizado', () => {
    expect(layoutKind('substation')).toBe('substation');
    expect(layoutKind('usina nuclear')).toBe('generic');
    expect(layoutKind(undefined)).toBe('generic');
    expect(layoutKind(42)).toBe('generic');
    expect(buildLayout(undefined).kind).toBe('generic');
    expect(buildLayout('solar')).toBe(buildLayout('solar'));
  });

  it('primitivas: retângulo anti-horário, catenária com flecha no meio', () => {
    const q = rect(0, 0, 4, 2);
    // área com sinal > 0 = anti-horário
    const area = q.reduce((s, p, i) => s + p[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * p[1], 0) / 2;
    expect(area).toBeCloseTo(8, 9);
    const c = catenary([0, 0, 30], [100, 0, 30], 9, 16);
    expect(c).toHaveLength(17);
    expect(c[8][2]).toBeCloseTo(21, 9);
    expect(c[0][2]).toBe(30);
    expect(c[16][2]).toBe(30);
  });

  it('groupFrame: grupo inexistente = null', () => {
    expect(groupFrame(buildLayout('solar'), 'turbines')).toBeNull();
    expect(groupFrame(buildLayout('solar'), null)).toBeNull();
  });
});

describe('frente de trabalho pelo título da fase', () => {
  it('subestação', () => {
    expect(focusGroupFor('substation', 'Montagem eletromecânica dos pórticos')).toBe('gantries');
    expect(focusGroupFor('substation', 'Instalação de disjuntores 138 kV')).toBe('breakers');
    expect(focusGroupFor('substation', 'Lançamento de cabos de controle')).toBe('trench');
    expect(focusGroupFor('substation', 'Montagem do Transformador TR-2')).toBe('transformer');
    expect(focusGroupFor('substation', 'Casa de comando — painéis de proteção')).toBe('control');
    expect(focusGroupFor('substation', 'Fundações do pátio')).toBe('foundations');
    // mais de um termo: vence a regra mais específica, na ordem da tabela ("equipamentos" antes de "fundações")
    expect(focusGroupFor('substation', 'Fundações dos equipamentos')).toBe('breakers');
  });

  it('LT, solar, hidrelétrica, eólica, genérica', () => {
    expect(focusGroupFor('transmission', 'Lançamento de cabos condutores')).toBe('conductors');
    expect(focusGroupFor('transmission', 'Montagem de torres')).toBe('towers');
    expect(focusGroupFor('transmission', 'Fundações das torres')).toBe('foundations');
    expect(focusGroupFor('solar', 'Montagem de módulos fotovoltaicos')).toBe('tables');
    expect(focusGroupFor('solar', 'Instalação dos inversores')).toBe('inverters');
    expect(focusGroupFor('hydro', 'Instalação do estator da UG-05')).toBe('unit');
    expect(focusGroupFor('hydro', 'Içamento com a ponte rolante')).toBe('crane');
    expect(focusGroupFor('wind', 'Montagem do aerogerador AG-03')).toBe('turbines');
    expect(focusGroupFor('generic', 'Obra civil do galpão')).toBe('building');
  });

  it('sem casar, sem título ou grupo ausente no layout → null (nunca um palpite)', () => {
    expect(focusGroupFor('substation', 'Reunião de kickoff')).toBeNull();
    expect(focusGroupFor('substation', '')).toBeNull();
    expect(focusGroupFor('substation', null)).toBeNull();
    expect(focusGroupFor('solar', 'Montagem de torres')).toBeNull(); // "torres" não existe no layout solar
    expect(focusGroupFor(undefined, 'Obra civil')).toBe('building');
    // sem falso positivo em pedaço de palavra ("base" ≠ "baseline", "tc" ≠ "tcheco")
    expect(focusGroupFor('substation', 'Revisão da baseline')).toBeNull();
    expect(focusGroupFor('substation', 'Fornecedor tcheco')).toBeNull();
  });

  it('auxiliares: sem acento, ampliação, data curta', () => {
    expect(fold('Ampliação da SE — Pórticos')).toBe('ampliacao da se — porticos');
    expect(wantsHighlightNew('SE Tucuruí — ampliação 138 kV')).toBe(true);
    expect(wantsHighlightNew('Obra nova', null, undefined)).toBe(false);
    expect(shortDate('2026-10-07')).toBe('07/10');
    expect(shortDate('x')).toBeNull();
  });
});

const TUCURUI = { lat: -3.7662, lng: -49.6725 };
const position = (over: Partial<SitePosition> = {}): SitePosition => ({
  lat: TUCURUI.lat, lng: TUCURUI.lng, precision: 'site', label: 'Canteiro CANT-TUCURUI', municipality: 'Tucuruí', uf: 'PA',
  source: 'project_site', evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: null }, ...over,
});

function hud(over: {
  kind?: SiteKind | null;
  phase?: { id: string; title: string; percent: number | null } | null;
  team?: SectionState<{ allocated: number }>;
  supply?: SiteHud['supply'];
  now?: 'ok' | 'restricted';
  health?: 'critical' | 'attention' | 'healthy' | 'unknown' | null;
} = {}): SiteHud {
  const kind = over.kind === null ? undefined : { kind: over.kind ?? 'substation', basis: ['nome'], matched: ['SE'] };
  return {
    ok: true, generatedAt: '2026-09-25T12:00:00Z', today: '2026-09-25',
    project: { id: 'qa-scn-tucurui', name: 'SE Tucuruí — ampliação 138 kV', code: 'QA-TUC', client: 'QA', status: 'ACTIVE', scope: null, href: '/projetos/qa-scn-tucurui', kind: kind as SiteHud['project']['kind'] },
    location: { state: 'ok', data: { position: position(), pending: null } },
    now: over.now === 'restricted' ? { state: 'restricted' } : {
      state: 'ok',
      data: {
        health: over.health === null ? null : { level: over.health ?? 'attention', reasons: [] },
        phase: over.phase === undefined ? { id: 'a1', title: 'Lançamento de cabos de controle', percent: 45 } : over.phase,
        schedule: null,
        nextMilestone: { id: 'm1', date: '2026-10-07', title: 'Energização do bay 5' },
        progress: null,
        team: over.team ?? { state: 'ok', data: { allocated: 12 } },
        serviceOrders: { state: 'restricted' },
      },
    },
    attention: { state: 'restricted' },
    nextAction: null,
    measurements: { state: 'restricted' },
    risks: { state: 'restricted' },
    supply: over.supply ?? { state: 'ok', data: { shortages: { total: 1, critical: 1, partial: false }, apexOpen: 1 } },
    contract: { state: 'restricted' },
    billing: { state: 'restricted' },
    decisions: { state: 'restricted' },
    calendar: { state: 'restricted' },
    notReadable: [],
  };
}

describe('twinSpecFor: a spec só com dado real', () => {
  const base = { projectId: 'qa-scn-tucurui', position: position(), view: 'overview' as const, azimuthDeg: TWIN_AZIMUTH_DEG };

  it('Tucuruí (subestação): frente pela fase, avanço, equipe, pátio → Supply, marco → Planejar, rótulo obrigatório', () => {
    const s = twinSpecFor({ ...base, hud: hud() })!;
    expect(s).not.toBeNull();
    expect(s.kind).toBe('substation');
    expect(s.anchor).toEqual(TUCURUI);
    expect(s.azimuthDeg).toBe(148);
    expect(s.focusGroup).toBe('trench');
    expect(s.progress).toBeCloseTo(0.45, 9);
    expect(s.people).toBe(12);
    expect(s.tone).toBe('attention');
    expect(s.highlightNew).toBe(true);
    expect(s.label).toBe(TWIN_NOTE);
    expect(s.label).toBe('Representação esquemática — não é o projeto executivo');
    const by = Object.fromEntries(s.hotspots.map((h) => [h.id, h]));
    expect(by.workfront).toMatchObject({ role: 'workfront', label: 'Lançamento de cabos de controle', value: '45% concluído', target: 'plan' });
    expect(by.team).toMatchObject({ role: 'team', value: '12 pessoas alocadas', target: null });
    expect(by.laydown).toMatchObject({ role: 'laydown', value: '1 material em falta', tone: 'critical', target: 'supply' });
    expect(by.milestone).toMatchObject({ role: 'milestone', value: 'Energização do bay 5 · 07/10', target: 'plan' });
    expect(s.key).toBe('qa-scn-tucurui|substation|new');
  });

  it('fora do canteiro, fora de Visão geral/Planejar, sem HUD → sem modelo', () => {
    expect(twinSpecFor({ ...base, hud: hud(), position: position({ precision: 'municipality' }) })).toBeNull();
    expect(twinSpecFor({ ...base, hud: hud(), view: 'billing' })).toBeNull();
    expect(twinSpecFor({ ...base, hud: hud(), view: 'supply' })).toBeNull();
    expect(twinSpecFor({ ...base, hud: hud(), view: 'portfolio' })).toBeNull();
    expect(twinSpecFor({ ...base, hud: null })).toBeNull();
    expect(twinSpecFor({ ...base, hud: hud(), position: null })).toBeNull();
    expect(twinSpecFor({ ...base, hud: hud(), position: position({ lat: Number.NaN }) })).toBeNull();
    expect(twinSpecFor({ ...base, hud: hud(), view: 'plan' })).not.toBeNull();
  });

  it('tipo ausente (servidor ainda sem `kind`) → genérica', () => {
    const s = twinSpecFor({ ...base, hud: hud({ kind: null }) })!;
    expect(s.kind).toBe('generic');
    expect(s.focusGroup).toBe('trench');
  });

  it('equipe restrita: sem pontos e "Restrito" (nunca 0); leitura falhou: "Não foi possível ler"; zero é zero', () => {
    const r = twinSpecFor({ ...base, hud: hud({ team: { state: 'restricted' } }) })!;
    expect(r.people).toBeNull();
    expect(r.hotspots.find((h) => h.id === 'team')?.value).toBe('Restrito');
    const e = twinSpecFor({ ...base, hud: hud({ team: { state: 'error', message: 'x' } }) })!;
    expect(e.people).toBeNull();
    expect(e.hotspots.find((h) => h.id === 'team')).toMatchObject({ value: 'Não foi possível ler', tone: 'unknown' });
    const z = twinSpecFor({ ...base, hud: hud({ team: { state: 'ok', data: { allocated: 0 } } }) })!;
    expect(z.people).toBe(0);
    // zero ALOCAÇÕES registradas — não "ninguém na obra" (um requisito de equipe pode estar marcado atendido)
    expect(z.hotspots.find((h) => h.id === 'team')).toMatchObject({ value: 'Nenhuma alocação registrada', tone: 'attention' });
    expect(TEAM_NONE).toBe('Nenhuma alocação registrada');
    expect(z.hotspots.some((h) => /pessoa alocada/.test(h.value ?? ''))).toBe(false);
  });

  it('sem fase: sem frente, sem anel de avanço; avanço nulo não vira 0', () => {
    const s = twinSpecFor({ ...base, hud: hud({ phase: null }) })!;
    expect(s.focusGroup).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.hotspots.some((h) => h.role === 'workfront')).toBe(false);
    const p = twinSpecFor({ ...base, hud: hud({ phase: { id: 'a', title: 'Montagem de pórticos', percent: null } }) })!;
    expect(p.progress).toBeNull();
    expect(p.hotspots.find((h) => h.id === 'workfront')?.value).toBeNull();
  });

  it('Supply restrito/falhou: nunca "sem falta"; restrito não navega', () => {
    const r = twinSpecFor({ ...base, hud: hud({ supply: { state: 'restricted' } }) })!;
    expect(r.hotspots.find((h) => h.id === 'laydown')).toMatchObject({ value: 'Restrito', target: null, tone: 'unknown' });
    const e = twinSpecFor({ ...base, hud: hud({ supply: { state: 'error', message: 'x' } }) })!;
    expect(e.hotspots.find((h) => h.id === 'laydown')).toMatchObject({ value: 'Não foi possível ler', target: 'supply' });
    const partial = twinSpecFor({ ...base, hud: hud({ supply: { state: 'ok', data: { shortages: { total: 0, critical: 0, partial: true }, apexOpen: null } } }) })!;
    expect(partial.hotspots.find((h) => h.id === 'laydown')).toMatchObject({ value: 'Leitura parcial do estoque', tone: 'unknown' });
    const ok = twinSpecFor({ ...base, hud: hud({ supply: { state: 'ok', data: { shortages: { total: 0, critical: 0, partial: false }, apexOpen: 0 } } }) })!;
    expect(ok.hotspots.find((h) => h.id === 'laydown')).toMatchObject({ value: 'Sem falta de material', tone: 'healthy' });
  });

  it('sem leitura de saúde: tom neutro (nunca "em dia")', () => {
    const s = twinSpecFor({ ...base, hud: hud({ health: null }) })!;
    expect(s.tone).toBe('unknown');
    expect(twinToneColor('unknown')).toEqual([148, 163, 184]);
    expect(twinToneColor('critical')).toEqual([239, 75, 85]);
    const n = twinSpecFor({ ...base, hud: hud({ now: 'restricted' }) })!;
    expect(n.people).toBeNull();
    expect(n.progress).toBeNull();
    expect(n.hotspots.map((h) => h.id)).toEqual(['laydown']);
  });

  it('nome acessível do hotspot diz o valor e para onde vai', () => {
    const s = twinSpecFor({ ...base, hud: hud() })!;
    expect(hotspotAriaLabel(s.hotspots.find((h) => h.id === 'laydown')!)).toBe('Pátio de materiais: 1 material em falta — abre Supply Chain');
    expect(hotspotAriaLabel(s.hotspots.find((h) => h.id === 'team')!)).toBe('Equipe: 12 pessoas alocadas');
  });
});

/** Canvas 2D de mentira. */
function stubCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  const store: Record<string, unknown> = {};
  let calls = 0;
  const ctx = new Proxy(store, {
    get: (target, key: string) => {
      if (key === '__calls') return calls;
      if (key in target) return target[key];
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => grad;
      return (...args: unknown[]) => {
        calls += 1;
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`NaN em ${key}`);
      };
    },
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Projetor de teste: ECEF → lat/lng → px (1 px por metro perto da âncora), sempre visível. */
function metricProjector(): TwinProjector {
  return {
    ok: true,
    project(x, y, z, out) {
      const ll = latLngOfSurface([x, y, z]);
      out[0] = 720 + (ll.lng - TUCURUI.lng) * 111_000;
      out[1] = 450 - (ll.lat - TUCURUI.lat) * 111_000;
      out[2] = 1400 + (ll.lat - TUCURUI.lat) * 111_000;
      return true;
    },
  };
}

describe('TwinModel: ECEF finito, desenho sem NaN, hotspots posicionados', () => {
  const spec = (kind: SiteKind, over: Partial<TwinSpec> = {}): TwinSpec => ({
    key: `p|${kind}|`, kind, anchor: TUCURUI, azimuthDeg: 148, focusGroup: null, progress: 0.45, people: 12, tone: 'attention',
    hotspots: [
      { id: 'workfront', role: 'workfront', label: 'Frente', value: '45%', target: 'plan' },
      { id: 'team', role: 'team', label: 'Equipe', value: '12' },
      { id: 'laydown', role: 'laydown', label: 'Pátio', value: '1 em falta', tone: 'critical', target: 'supply' },
      { id: 'milestone', role: 'milestone', label: 'Marco', value: '07/10', target: 'plan' },
    ],
    label: TWIN_NOTE,
    ...over,
  });

  it('escala esquemática: eixo longo ~440 m na tela do local, entre 1× e 5×', () => {
    expect(TWIN_TARGET_M).toBe(440);
    expect(schematicScale(72)).toBeCloseTo(440 / 144, 9);
    expect(schematicScale(850)).toBe(1); // a LT já é longa
    expect(schematicScale(10)).toBe(5);
    expect(schematicScale(Number.NaN)).toBe(1);
    for (const kind of TWIN_KINDS) {
      const L = buildLayout(kind);
      expect(L.scale).toBeGreaterThanOrEqual(1);
      expect(L.scale).toBeLessThanOrEqual(5);
      expect(2 * L.extent.halfL * L.scale).toBeGreaterThanOrEqual(TWIN_TARGET_M - 1e-6);
    }
  });

  it('local → ECEF: âncora no lugar, eixo longo no rumo pedido, escala aplicada e desfeita', () => {
    const m = new TwinModel(spec('substation'));
    const o = [0, 0, 0];
    m.toEcef(0, 0, 0, o);
    const a = ecefOf(TUCURUI.lat, TUCURUI.lng, 0);
    o.forEach((v, i) => expect(v).toBeCloseTo(a[i], 3));
    // 100 m do layout ao longo do eixo (rumo 148°): sul-sudeste, a 100 × escala do centro
    m.toEcef(100, 0, 0, o);
    const ll = latLngOfSurface(o as [number, number, number]);
    expect(ll.lat).toBeLessThan(TUCURUI.lat);
    expect(ll.lng).toBeGreaterThan(TUCURUI.lng);
    expect(Math.hypot(o[0] - a[0], o[1] - a[1], o[2] - a[2])).toBeCloseTo(100 * m.layout.scale, 1);
    const local = m.toLocal({ x: o[0], y: o[1], z: o[2] });
    expect(local[0]).toBeCloseTo(100, 3);
    expect(local[1]).toBeCloseTo(0, 3);
  });

  it('cada tipo desenha sem NaN e devolve os 4 hotspots + o rótulo visíveis', () => {
    for (const kind of TWIN_KINDS) {
      const L = buildLayout(kind);
      const m = new TwinModel(spec(kind, { focusGroup: L.defaultFocus, highlightNew: true }));
      const ctx = stubCtx();
      const cam = ecefOf(TUCURUI.lat - 0.01, TUCURUI.lng - 0.01, 1000);
      const res = m.draw(ctx, metricProjector(), { x: cam[0], y: cam[1], z: cam[2] }, { alpha: 1, t: 3, reducedMotion: false, spec: m.spec });
      expect(res.hotspots.map((h) => h.id)).toEqual(['workfront', 'team', 'laydown', 'milestone']);
      expect(res.hotspots.every((h) => h.visible && Number.isFinite(h.x) && Number.isFinite(h.y))).toBe(true);
      expect(res.note?.visible).toBe(true);
      expect(res.motion).toBe(true); // a equipe se mexe
      expect((ctx as unknown as { __calls: number }).__calls).toBeGreaterThan(50);
    }
  });

  it('movimento reduzido: equipe parada; transparente: nada desenhado e hotspots escondidos', () => {
    const m = new TwinModel(spec('solar'));
    const cam = ecefOf(TUCURUI.lat - 0.01, TUCURUI.lng, 1000);
    const still = m.draw(stubCtx(), metricProjector(), { x: cam[0], y: cam[1], z: cam[2] }, { alpha: 1, t: 3, reducedMotion: true, spec: m.spec });
    expect(still.motion).toBe(false);
    const ctx = stubCtx();
    const off = m.draw(ctx, metricProjector(), { x: cam[0], y: cam[1], z: cam[2] }, { alpha: 0, t: 3, reducedMotion: false, spec: m.spec });
    expect(off.hotspots.every((h) => !h.visible)).toBe(true);
    expect(off.note).toBeNull();
    expect((ctx as unknown as { __calls: number }).__calls).toBe(0);
    const none = new TwinModel(spec('solar', { people: null }));
    expect(none.draw(stubCtx(), metricProjector(), { x: cam[0], y: cam[1], z: cam[2] }, { alpha: 1, t: 3, reducedMotion: false, spec: none.spec }).motion).toBe(false);
  });

  const req = (id: string, x: number, y: number, prio: number, over: Partial<CardRequest> = {}): CardRequest =>
    ({ id, x, y, visible: true, w: 216, h: 38, prio, ...over });
  const cross = (p: ScreenRect, q: ScreenRect) => p.l < q.r && p.r > q.l && p.t < q.b && p.b > q.t;
  const boxOf = (c: { left: number; top: number; w: number; h: number }): ScreenRect => ({ l: c.left, t: c.top, r: c.left + c.w, b: c.top + c.h });
  const inside = (b: ScreenRect, f: ScreenRect) => b.l >= f.l - 1e-9 && b.r <= f.r + 1e-9 && b.t >= f.t - 1e-9 && b.b <= f.b + 1e-9;

  it('cartões: prioridade primeiro; quem cruza sobe/desce ou vira; o losango fica no ponto quando pode', () => {
    const free = { l: 0, t: 0, r: 1400, b: 900 };
    const out = placeCards([req('team', 500, 300, 3), req('workfront', 510, 305, 0), req('far', 1100, 300, 2)], free);
    const wf = out.get('workfront')!;
    // prioridade 0 fica no ponto: sai para a direita, losango a 13 px da borda, centrado na vertical
    expect(wf).toMatchObject({ shown: true, side: 'r', left: 510 - CARD_DOT, top: 305 - 19, cx: 510, cy: 305 });
    expect(out.get('far')).toMatchObject({ shown: true, left: 1100 - CARD_DOT, cx: 1100, cy: 300 });
    const team = out.get('team')!;
    expect(team.shown).toBe(true);
    expect(cross(boxOf(team), boxOf(wf))).toBe(false);
    // o fio liga o ponto real ao cartão deslocado
    expect([team.ax, team.ay]).toEqual([500, 300]);
    // invisível/não-finito não aparece
    const hidden = placeCards([req('x', Number.NaN, 0, 0), req('y', 10, 10, 0, { visible: false })], free);
    expect(hidden.get('x')?.shown).toBe(false);
    expect(hidden.get('y')?.shown).toBe(false);
  });

  it('cartões na borda direita da área livre viram para a esquerda (390 px: nada cortado)', () => {
    const free = { l: 12, t: 60, r: 378, b: 323 };
    const out = placeCards([req('milestone', 300, 200, 0, { w: 200, h: 44 })], free);
    const c = out.get('milestone')!;
    expect(c).toMatchObject({ shown: true, side: 'l' });
    expect(inside(boxOf(c), free)).toBe(true);
    // virado: o losango na ponta direita, no ponto
    expect(c.cx).toBeCloseTo(300, 9);
    expect(c.left + c.w - CARD_DOT).toBeCloseTo(300, 9);
  });

  it('ponto atrás de um painel (fora da área livre) ou sem lugar: o cartão não aparece; nunca por baixo do HUD', () => {
    const free = { l: 32, t: 72, r: 916, b: 348 }; // Planejar a 1440: a faixa acima do Gantt
    const out = placeCards([req('laydown', 400, 520, 1)], free); // o pátio caiu atrás do Gantt
    expect(out.get('laydown')?.shown).toBe(false);
    // área minúscula: nem vira, nem desliza — não aparece
    const tiny = placeCards([req('a', 50, 50, 0)], { l: 0, t: 0, r: 120, b: 100 });
    expect(tiny.get('a')?.shown).toBe(false);
    // caixas fixas (rótulo obrigatório, hexágono do local) também são evitadas
    const fixed = [{ l: 490, t: 290, r: 530, b: 330 }];
    const f2 = placeCards([req('team', 500, 310, 0)], { l: 0, t: 0, r: 1400, b: 900 }, fixed);
    expect(cross(boxOf(f2.get('team')!), fixed[0])).toBe(false);
  });

  it('histerese: o candidato do quadro anterior é tentado primeiro (a respiração não faz o cartão pular)', () => {
    const free = { l: 0, t: 0, r: 1400, b: 900 };
    const blocker = { l: 480, t: 280, r: 720, b: 330 };
    const first = placeCards([req('a', 500, 300, 0)], free, [blocker]).get('a')!;
    expect(first.shown).toBe(true);
    // sem o obstáculo, o lugar ideal voltaria a ser o 0 — mas o anterior ainda serve e fica
    const again = placeCards([req('a', 501, 301, 0)], free, [], new Map([['a', first.pick]])).get('a')!;
    expect(again.pick).toBe(first.pick);
    expect(placeCards([req('a', 501, 301, 0)], free).get('a')!.pick).toBe(0);
  });

  it('em todo tipo, os cartões desenhados não se cruzam e ficam na área livre', () => {
    const free = { l: 300, t: 100, r: 1200, b: 800 };
    for (const kind of TWIN_KINDS) {
      const L = buildLayout(kind);
      const m = new TwinModel(spec(kind, { focusGroup: L.defaultFocus }));
      const cam = ecefOf(TUCURUI.lat - 0.01, TUCURUI.lng - 0.01, 1000);
      const res = m.draw(stubCtx(), metricProjector(), { x: cam[0], y: cam[1], z: cam[2] }, {
        alpha: 1, t: 1, reducedMotion: true, spec: m.spec, place: { free, sizes: new Map(), note: { w: 300, h: 23 } },
      });
      const shown = Array.from(res.cards.values()).filter((c) => c.shown);
      const note = res.note!;
      expect(note.visible).toBe(true);
      // o rótulo obrigatório encaixado no canto inferior esquerdo da área livre
      expect([note.x, note.y]).toEqual([free.l, free.b - 23]);
      const noteBox = { l: note.x, t: note.y, r: note.x + 300, b: note.y + 23 };
      for (const c of shown) {
        expect(inside(boxOf(c), free), `${kind}: ${c.id} dentro`).toBe(true);
        expect(cross(boxOf(c), noteBox), `${kind}: ${c.id} × rótulo`).toBe(false);
      }
      for (let i = 0; i < shown.length; i += 1) {
        for (let j = i + 1; j < shown.length; j += 1) {
          expect(cross(boxOf(shown[i]), boxOf(shown[j])), `${kind}: ${shown[i].id} × ${shown[j].id}`).toBe(false);
        }
      }
    }
  });

  /** Projetor do motor PURO (poseFromView + campo vertical fixo), como o Cesium desenha. */
  const poseProjector = (view: Parameters<typeof poseFromView>[0], W: number, H: number): TwinProjector & { cam: { x: number; y: number; z: number } } => {
    const pose = poseFromView(view, H);
    return {
      ok: true,
      cam: { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
      project(x, y, z, out) {
        const s = projectPose(pose, W, H, [x, y, z]);
        if (!s) return false;
        out[0] = s[0];
        out[1] = s[1];
        out[2] = Math.hypot(x - pose.position[0], y - pose.position[1], z - pose.position[2]);
        return true;
      },
    };
  };

  it('Tucuruí na câmera real (1440 × 900 Visão geral e Planejar; 390 px): cartões e rótulo DENTRO da área livre, nenhum cortado', () => {
    const tucurui = spec('substation', {
      focusGroup: 'gantries', people: 0,
      hotspots: [
        { id: 'workfront', role: 'workfront', label: 'Montagem das estruturas metálicas', value: '35% concluído', target: 'plan' },
        { id: 'team', role: 'team', label: 'Equipe', value: TEAM_NONE },
        { id: 'laydown', role: 'laydown', label: 'Pátio de materiais', value: '1 material em falta', tone: 'critical', target: 'supply' },
        { id: 'milestone', role: 'milestone', label: 'Próximo marco', value: 'Energização dos novos bays · 22/10', target: 'plan' },
      ],
    });
    const desk: HudGrid = { W: 1368, H: 858, mobile: false, safe: 24, top: 14, topH: 44, leftW: 440, rightW: 400 };
    const phone: HudGrid = { W: 390, H: 371, mobile: true, safe: 12, top: 8, topH: 44, leftW: 440, rightW: 400 };
    const cases: Array<[string, HudGrid, 'overview' | 'plan', number]> = [
      ['1440 Visão geral', desk, 'overview', 4], ['1440 Planejar (Gantt medido)', { ...desk, ganttTop: 360 }, 'plan', 4],
      ['1440 Planejar (Gantt de 8 linhas)', desk, 'plan', 4], ['390 Visão geral', phone, 'overview', 2],
    ];
    for (const [name, g, view, minShown] of cases) {
      const free = freeRect(view, g)!;
      const cam = siteView({ ...TUCURUI, precision: 'site' }, view, { mobile: g.mobile, frame: { W: g.W, H: g.H, free } }, 'substation')!;
      const P = poseProjector(cam, g.W, g.H);
      const m = new TwinModel(tucurui);
      const w = g.mobile ? 200 : CARD_SIZE.w;
      const sizes = new Map(tucurui.hotspots.map((h) => [h.id, { w, h: g.mobile ? 44 : 38 }]));
      const res = m.draw(stubCtx(), P, P.cam, { alpha: 1, t: 1, reducedMotion: true, spec: tucurui, place: { free, sizes, note: { w: 300, h: 23 } } });
      const shown = Array.from(res.cards.values()).filter((c) => c.shown);
      expect(shown.length, name).toBeGreaterThanOrEqual(minShown);
      // a frente de trabalho e o pátio (falta de material) aparecem sempre
      expect(res.cards.get('workfront')?.shown, name).toBe(true);
      expect(res.cards.get('laydown')?.shown, name).toBe(true);
      for (const c of shown) expect(inside(boxOf(c), free), `${name}: ${c.id}`).toBe(true);
      expect(res.note?.visible, name).toBe(true);
      expect(inside({ l: res.note!.x, t: res.note!.y, r: res.note!.x + 300, b: res.note!.y + 23 }, free), name).toBe(true);
    }
  });

  it('caixa do modelo para o enquadramento: escala esquemática aplicada, pátio/marco/rótulo incluídos, finita', () => {
    for (const kind of TWIN_KINDS) {
      const b = layoutBox(kind);
      const L = buildLayout(kind);
      expect(finiteDeep(b), kind).toBe(true);
      const pts = [...L.prims.flatMap(primPoints), L.anchors.laydown, L.anchors.milestone, L.anchors.label];
      for (const [x, y, z] of pts) {
        const s = L.scale;
        expect(x * s >= b.minX - 1e-9 && x * s <= b.maxX + 1e-9 && y * s >= b.minY - 1e-9 && y * s <= b.maxY + 1e-9, kind).toBe(true);
        expect(z * s, kind).toBeLessThanOrEqual(b.top);
      }
      expect(b.top, kind).toBeGreaterThan(0);
    }
    expect(layoutBox('xyz')).toBe(layoutBox('generic'));
  });

  it('a geometria só remonta quando tipo, âncora ou rumo mudam', () => {
    const a = spec('substation');
    expect(twinGeometryKey(a)).toBe(twinGeometryKey({ ...a, progress: 0.9, people: 3, hotspots: [] }));
    expect(twinGeometryKey(a)).not.toBe(twinGeometryKey({ ...a, azimuthDeg: 150 }));
    expect(twinGeometryKey(a)).not.toBe(twinGeometryKey({ ...a, kind: 'solar' }));
    expect(twinGeometryKey(a)).not.toBe(twinGeometryKey({ ...a, anchor: { lat: -3.7, lng: -49.6 } }));
  });
});
