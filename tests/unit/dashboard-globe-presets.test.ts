/**
 * PRESETS DO GLOBO — a câmera sai do dado, nunca de um lugar inventado.
 *
 *   portfólio   enquadra todos os marcadores (diagonal × 1,25, preso em
 *               900–4500 km); sem marcador, o Brasil a 5200 km
 *   local       Visão geral / Planejar / Faturamento pela PRECISÃO da posição
 *               (canteiro × município); sem posição, fica no portfólio
 *   Supply      enquadra canteiro + estoques com coordenada (60–2400 km)
 *   celular     ox/oy = 0 (o HUD vira folha inferior)
 *   marcadores  tom pela saúde, pulso .7 crítico / .4 atenção, rótulo do pior
 *               local, posição inválida (NaN, fora do intervalo) não entra
 */
import { describe, expect, it } from 'vitest';
import {
  BRAZIL, HUD_SPACE, MARKER_PAD, NOMINAL_TWIN_KIND, TWIN_AZIMUTH_DEG, TWIN_MAX_DIST_KM, VIEW_DIM, brazilView, fitView, freeRect, haversineKm, markersFor,
  portfolioView, siteView, sortSites, supplyView, twinBoxPoints, validLatLng, viewFor, type HudGrid, type Rect,
} from '@/components/dashboard-globe/presets';
import { ecefOf, poseFromView, projectPose } from '@/components/dashboard-globe/camera';
import type { CameraView } from '@/components/dashboard-globe/contract';
import { layoutBox } from '@/components/dashboard-globe/twin/layouts';
import type { SiteMarker, SitePosition } from '@/lib/dashboard/types';

const DESKTOP = { mobile: false };
const MOBILE = { mobile: true };

// Os três canteiros com coordenada do QA (Pará) — dado real do cadastro do Supply.
const TUCURUI = { lat: -3.7662, lng: -49.6725 };
const MARABA = { lat: -5.3686, lng: -49.1178 };
const BARCARENA = { lat: -1.5059, lng: -48.6255 };

const pos = (p: { lat: number; lng: number }, over: Partial<SitePosition> = {}): SitePosition => ({
  lat: p.lat, lng: p.lng, precision: 'site', label: 'Canteiro', municipality: null, uf: 'PA', source: 'project_site',
  evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: null }, ...over,
});
const site = (id: string, p: { lat: number; lng: number }, level: SiteMarker['level'], name = id): SiteMarker => ({
  projectId: id, name, client: null, code: null, position: pos(p), level, reasons: [], nextMilestone: null,
  exceptions: { total: 0, critical: 0, partial: false }, topIssue: null, href: `/projetos/${id}`,
});

describe('coordenada válida', () => {
  it('só número finito dentro do intervalo', () => {
    expect(validLatLng(TUCURUI)).toBe(true);
    expect(validLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(validLatLng({ lat: 0, lng: Infinity })).toBe(false);
    expect(validLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(validLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(validLatLng({ lat: '1', lng: 2 } as never)).toBe(false);
    expect(validLatLng(null)).toBe(false);
  });

  it('haversine: Tucuruí–Marabá ≈ 188 km', () => {
    expect(haversineKm(TUCURUI, MARABA)).toBeGreaterThan(180);
    expect(haversineKm(TUCURUI, MARABA)).toBeLessThan(195);
  });
});

describe('portfólio', () => {
  it('sem marcador: o Brasil a 5200 km, pitch 52', () => {
    const v = portfolioView([], DESKTOP);
    expect(v).toMatchObject({ lat: BRAZIL.lat, lng: BRAZIL.lng, dist: 5200, pitch: 52 });
    expect(v).toEqual(brazilView(DESKTOP));
  });

  it('marcadores inválidos contam como ausentes', () => {
    expect(portfolioView([{ lat: Number.NaN, lng: 1 }, { lat: 200, lng: 0 }], DESKTOP)).toEqual(brazilView(DESKTOP));
  });

  it('enquadra a caixa dos marcadores, com o mínimo de 900 km', () => {
    const v = portfolioView([TUCURUI, MARABA, BARCARENA], DESKTOP);
    expect(v.lat).toBeCloseTo((BARCARENA.lat + MARABA.lat) / 2, 6);
    expect(v.lng).toBeCloseTo((TUCURUI.lng + BARCARENA.lng) / 2, 6);
    // Diagonal ≈ 470 km × 1,25 < 900 → o piso.
    expect(v.dist).toBe(900);
    expect(v).toMatchObject({ pitch: 52, heading: -4, ox: 200, oy: 90 });
  });

  it('um marcador só: centrado nele, 900 km', () => {
    expect(portfolioView([TUCURUI], DESKTOP)).toMatchObject({ lat: TUCURUI.lat, lng: TUCURUI.lng, dist: 900 });
  });

  it('país inteiro: diagonal × 1,25 presa em 4500 km', () => {
    const v = portfolioView([{ lat: 2, lng: -60 }, { lat: -30, lng: -51 }], DESKTOP);
    const diag = haversineKm({ lat: -30, lng: -60 }, { lat: 2, lng: -51 });
    expect(v.dist).toBeCloseTo(Math.min(4500, diag * 1.25), 6);
    const far = portfolioView([{ lat: 5, lng: -73 }, { lat: -33, lng: -34 }], DESKTOP);
    expect(far.dist).toBe(4500);
  });

  it('no celular o alvo fica no centro; no palco menor o deslocamento escala', () => {
    expect(portfolioView([TUCURUI], MOBILE)).toMatchObject({ ox: 0, oy: 0 });
    expect(brazilView(MOBILE)).toMatchObject({ ox: 0, oy: 0 });
    expect(portfolioView([TUCURUI], { mobile: false, scale: 0.75 })).toMatchObject({ ox: 150, oy: 68 });
    // Escala fora da faixa é presa (nunca NaN, nunca deslocamento gigante).
    expect(portfolioView([TUCURUI], { mobile: false, scale: Number.NaN })).toMatchObject({ ox: 200, oy: 90 });
    expect(portfolioView([TUCURUI], { mobile: false, scale: 9 })).toMatchObject({ ox: 200, oy: 90 });
  });
});

describe('local', () => {
  it('Visão geral: canteiro 1,4 km; município 18 km', () => {
    expect(siteView({ ...TUCURUI, precision: 'site' }, 'overview', DESKTOP))
      .toEqual({ lat: TUCURUI.lat, lng: TUCURUI.lng, dist: 1.4, pitch: 48, heading: 58, ox: 190, oy: 40 });
    expect(siteView({ ...TUCURUI, precision: 'municipality' }, 'overview', DESKTOP)?.dist).toBe(18);
  });

  it('Planejar: 1,6 km / 22 km, alvo acima do cronograma', () => {
    expect(siteView({ ...TUCURUI, precision: 'site' }, 'plan', DESKTOP)).toMatchObject({ dist: 1.6, pitch: 50, heading: 64, ox: 40, oy: -170 });
    expect(siteView({ ...TUCURUI, precision: 'municipality' }, 'plan', DESKTOP)?.dist).toBe(22);
  });

  it('Faturamento: 9 km; município 30 km', () => {
    expect(siteView({ ...TUCURUI, precision: 'site' }, 'billing', DESKTOP)).toMatchObject({ dist: 9, pitch: 54, heading: 60, ox: 90, oy: 60 });
    expect(siteView({ ...TUCURUI, precision: 'municipality' }, 'billing', DESKTOP)?.dist).toBe(30);
  });

  it('celular: ox/oy = 0', () => {
    expect(siteView({ ...TUCURUI, precision: 'site' }, 'plan', MOBILE)).toMatchObject({ ox: 0, oy: 0 });
  });

  it('sem posição válida: null (a página fica no portfólio)', () => {
    expect(siteView(null, 'overview', DESKTOP)).toBeNull();
    expect(siteView({ lat: Number.NaN, lng: 0 }, 'overview', DESKTOP)).toBeNull();
  });

  it('modelo esquemático: eixo longo = rumo da Visão geral + 90° (atravessado na tela; não gira no Planejar)', () => {
    expect(TWIN_AZIMUTH_DEG).toBe(148);
    expect(TWIN_AZIMUTH_DEG).toBe((siteView({ ...TUCURUI, precision: 'site' }, 'overview', DESKTOP)?.heading ?? 0) + 90);
  });
});

describe('Supply Chain', () => {
  it('só o canteiro: 60 km sobre ele', () => {
    expect(supplyView(TUCURUI, [], DESKTOP)).toMatchObject({ lat: TUCURUI.lat, lng: TUCURUI.lng, dist: 60, pitch: 64, heading: -6, ox: -20, oy: -30 });
  });

  it('canteiro + almoxarifado com coordenada: a caixa dos dois, diagonal × 1,4', () => {
    const belem = { lat: -1.4558, lng: -48.4902 };
    const v = supplyView(TUCURUI, [belem, { lat: null, lng: null }], DESKTOP);
    expect(v?.lat).toBeCloseTo((TUCURUI.lat + belem.lat) / 2, 6);
    // A caixa vai de (Tucuruí.lat, Tucuruí.lng) a (Belém.lat, Belém.lng): a diagonal é a distância entre os dois.
    expect(v?.dist).toBeCloseTo(haversineKm(TUCURUI, belem) * 1.4, 6);
    expect(v!.dist).toBeGreaterThanOrEqual(60);
    expect(v!.dist).toBeLessThanOrEqual(2400);
  });

  it('rede continental: presa em 2400 km', () => {
    expect(supplyView(TUCURUI, [{ lat: -30, lng: -51 }, { lat: 5, lng: -35 }], DESKTOP)?.dist).toBe(2400);
  });

  it('sem posição do local: null', () => {
    expect(supplyView(null, [TUCURUI], DESKTOP)).toBeNull();
  });
});

describe('viewFor', () => {
  const markers = [TUCURUI, MARABA];
  it('portfólio enquadra os marcadores', () => {
    expect(viewFor('portfolio', { markers, site: null }, DESKTOP)).toEqual(portfolioView(markers, DESKTOP));
  });
  it('local sem posição cai no portfólio', () => {
    expect(viewFor('overview', { markers, site: null }, DESKTOP)).toEqual(portfolioView(markers, DESKTOP));
    expect(viewFor('supply', { markers, site: null }, DESKTOP)).toEqual(portfolioView(markers, DESKTOP));
  });
  it('o enquadramento do módulo prevalece (e zera o deslocamento no celular)', () => {
    const layerView = { lat: -2, lng: -49, dist: 300, pitch: 64, heading: -6, ox: -20, oy: -30 };
    expect(viewFor('supply', { markers, site: TUCURUI, layerView }, DESKTOP)).toEqual(layerView);
    expect(viewFor('supply', { markers, site: TUCURUI, layerView }, MOBILE)).toMatchObject({ ox: 0, oy: 0, dist: 300 });
    // Enquadramento inválido é ignorado.
    expect(viewFor('supply', { markers, site: TUCURUI, layerView: { ...layerView, dist: Number.NaN } }, DESKTOP))
      .toEqual(supplyView(TUCURUI, [], DESKTOP));
  });
  it('o recuo do mundo por vista', () => {
    expect(VIEW_DIM).toEqual({ portfolio: 0.16, overview: 0.06, plan: 0.42, supply: 0.22, billing: 0.38 });
  });
});

describe('marcadores', () => {
  const sites = [
    site('b', BARCARENA, 'healthy', 'Barcarena'),
    site('m', MARABA, 'attention', 'Marabá'),
    site('t', TUCURUI, 'critical', 'Tucuruí'),
    site('x', { lat: Number.NaN, lng: 0 }, 'critical', 'Inválido'),
    site('u', { lat: -2, lng: -50 }, null, 'Não ativo'),
  ];

  it('ordem: crítico → atenção → o resto, depois o nome', () => {
    expect(sortSites(sites).map((s) => s.projectId)).toEqual(['x', 't', 'm', 'b', 'u']);
  });

  it('tom pela saúde, pulso .7/.4, posição inválida fora, rótulo do pior local no portfólio', () => {
    const m = markersFor(sites, { view: 'portfolio', focused: null, hovered: null });
    expect(m.map((x) => x.id)).toEqual(['t', 'm', 'b', 'u']);
    expect(m.find((x) => x.id === 't')).toMatchObject({ tone: 'critical', pulse: 0.7, showLabel: true, size: 44, selected: false });
    expect(m.find((x) => x.id === 'm')).toMatchObject({ tone: 'attention', pulse: 0.4, showLabel: false });
    expect(m.find((x) => x.id === 'b')).toMatchObject({ tone: 'healthy', pulse: 0 });
    expect(m.find((x) => x.id === 'u')).toMatchObject({ tone: 'unknown', pulse: 0 });
    for (const x of m) { expect(Number.isFinite(x.lat)).toBe(true); expect(Number.isFinite(x.lng)).toBe(true); }
  });

  it('hover: 54 px, selecionado, com rótulo', () => {
    const m = markersFor(sites, { view: 'portfolio', focused: null, hovered: 'b' });
    expect(m.find((x) => x.id === 'b')).toMatchObject({ size: 54, selected: true, showLabel: true });
  });

  it('em foco: selecionado, maior, com pulso; fora do portfólio só o local em foco tem rótulo', () => {
    const m = markersFor(sites, { view: 'supply', focused: 'b', hovered: null });
    expect(m.find((x) => x.id === 'b')).toMatchObject({ selected: true, size: 52, pulse: 0.5, showLabel: true });
    expect(m.find((x) => x.id === 't')).toMatchObject({ showLabel: false });
    expect(markersFor(sites, { view: 'overview', focused: 't', hovered: null }).find((x) => x.id === 't'))
      .toMatchObject({ size: 58, pulse: 0.7 });
  });

  it('Supply Chain: os outros projetos são contexto — sem pulso (o anel não parece a resposta de um almoxarifado)', () => {
    const m = markersFor(sites, { view: 'supply', focused: 'm', hovered: null });
    expect(m.find((x) => x.id === 't')).toMatchObject({ tone: 'critical', pulse: 0, selected: false });
    expect(m.find((x) => x.id === 'm')).toMatchObject({ pulse: 0.5, selected: true });
    // fora do Supply o contexto continua pulsando pela saúde
    expect(markersFor(sites, { view: 'overview', focused: 'm', hovered: null }).find((x) => x.id === 't')?.pulse).toBe(0.7);
  });
});

/* ══ Enquadramento na área livre do HUD (palco medido) ═════════════════════ */

/** O palco do Dashboard a 1440 × 900 (menu lateral de 72 px, barra de 42 px) e a 390 × 844 (globo de 44vh). */
const DESK: HudGrid = { W: 1368, H: 858, mobile: false, safe: 24, top: 14, topH: 44, leftW: 440, rightW: 400 };
const PHONE: HudGrid = { W: 390, H: 371, mobile: true, safe: 12, top: 8, topH: 44, leftW: 440, rightW: 400 };
const TABLET: HudGrid = { W: 952, H: 726, mobile: false, tablet: true, safe: 16, top: 14, topH: 44, leftW: 360, rightW: 340 };

/** Onde a câmera PURA (a mesma do motor) põe cada ponto na tela. */
function screenOf(view: CameraView, W: number, H: number, pts: Array<{ lat: number; lng: number }>): Array<[number, number]> {
  const pose = poseFromView(view, H);
  return pts.map((p) => projectPose(pose, W, H, ecefOf(p.lat, p.lng, 0))!);
}
const within = (s: [number, number], r: Rect, pad = 0) => s[0] >= r.l + pad - 0.5 && s[0] <= r.r - pad + 0.5 && s[1] >= r.t + pad - 0.5 && s[1] <= r.b - pad + 0.5;

describe('área livre do HUD por vista', () => {
  it('1440: portfólio entre as colunas, abaixo da barra, acima da dica; local/Supply acima do dock', () => {
    expect(freeRect('portfolio', DESK)).toEqual({ l: 24 + 440 + 16, t: 14 + 44 + 14, r: 1368 - 24 - 400 - 16, b: 858 - 24 - 30 });
    expect(freeRect('overview', DESK)).toEqual({ l: 480, t: 72, r: 928, b: 858 - 24 - 78 - 8 });
    expect(freeRect('supply', DESK)).toEqual(freeRect('overview', DESK));
    expect(HUD_SPACE).toMatchObject({ dock: 78, hint: 30, moduleGap: 20, ganttMax: 484 });
  });

  it('Planejar: a faixa ACIMA do Gantt (medido; sem medida, o Gantt de 8 linhas) e à esquerda da coluna direita', () => {
    const measured = freeRect('plan', { ...DESK, ganttTop: 360 })!;
    expect(measured).toEqual({ l: 32, t: 72, r: 1368 - 24 - 400 - 20 - 8, b: 348 });
    const est = freeRect('plan', DESK)!;
    expect(est.b).toBe(858 - 24 - 78 - 484 - 12);
    // medida absurda (acima da barra, abaixo do dock) é ignorada
    expect(freeRect('plan', { ...DESK, ganttTop: 10 })).toEqual(est);
    expect(freeRect('plan', { ...DESK, ganttTop: 5000 })).toEqual(est);
    // 768–1179: o Gantt ocupa no máximo 46% da altura
    expect(freeRect('plan', TABLET)!.b).toBe(Math.round(726 - 16 - 78 - Math.min(484, 726 * 0.46) - 12));
  });

  it('768–1179: a coluna direita do portfólio recolhida libera a direita', () => {
    expect(freeRect('portfolio', { ...TABLET, rightClosed: true })!.r).toBe(952 - 16);
    expect(freeRect('portfolio', TABLET)!.r).toBe(952 - 16 - 340 - 16);
  });

  it('celular: o bloco do globo menos a barra, a folha (−22 px) e os créditos', () => {
    expect(freeRect('portfolio', PHONE)).toEqual({ l: 12, t: 8 + 44 + 8, r: 378, b: 371 - 48 });
    expect(freeRect('plan', PHONE)).toEqual(freeRect('portfolio', PHONE));
  });

  it('sem palco ou área degenerada: null / o palco inteiro (nunca um retângulo invertido)', () => {
    expect(freeRect('portfolio', null)).toBeNull();
    expect(freeRect('portfolio', { ...DESK, W: Number.NaN })).toBeNull();
    const narrow = freeRect('overview', { ...DESK, W: 900 })!; // colunas se cruzam
    expect(narrow.r - narrow.l).toBeGreaterThanOrEqual(HUD_SPACE.minW);
    expect(narrow.b).toBeGreaterThan(narrow.t);
  });
});

describe('enquadramento: o assunto DENTRO da área livre', () => {
  const sites3 = [TUCURUI, MARABA, BARCARENA];

  it('portfólio 1440 (primeira carga e depois do Esc): as 3 operações entre as colunas e acima da dica', () => {
    const free = freeRect('portfolio', DESK)!;
    const v = portfolioView(sites3, { mobile: false, frame: { W: DESK.W, H: DESK.H, free } });
    expect(v).toMatchObject({ pitch: 52, heading: -4 });
    expect(v.dist).toBeGreaterThanOrEqual(900);
    const s = screenOf(v, DESK.W, DESK.H, sites3);
    // cada hexágono com a margem do marcador (30 px) dentro da área: nada sob a dica nem contra a coluna
    for (const p of s) expect(within(p, free, 29)).toBe(true);
    // o assunto fica centrado (±2 px) na área útil
    const cx = (Math.min(...s.map((p) => p[0])) + Math.max(...s.map((p) => p[0]))) / 2;
    expect(Math.abs(cx - (free.l + free.r) / 2)).toBeLessThan(2);
    // determinístico e inteiro (a mesma vista nunca vira um voo novo)
    expect(portfolioView(sites3, { mobile: false, frame: { W: DESK.W, H: DESK.H, free } })).toEqual(v);
    expect(Number.isInteger(v.ox) && Number.isInteger(v.oy)).toBe(true);
  });

  it('portfólio 390: recua até as 3 caberem entre a barra e os créditos', () => {
    const free = freeRect('portfolio', PHONE)!;
    const v = portfolioView(sites3, { mobile: true, frame: { W: PHONE.W, H: PHONE.H, free } });
    expect(v.dist).toBeGreaterThan(900);
    for (const p of screenOf(v, PHONE.W, PHONE.H, sites3)) expect(within(p, free, 29)).toBe(true);
  });

  it('sem marcador com área medida: o Brasil no centro da área livre', () => {
    const free = freeRect('portfolio', DESK)!;
    const v = brazilView({ mobile: false, frame: { W: DESK.W, H: DESK.H, free } });
    expect(v).toMatchObject({ dist: 5200, ox: Math.round((free.l + free.r) / 2 - DESK.W / 2), oy: Math.round((free.t + free.b) / 2 - DESK.H / 2) });
  });

  it('Visão geral 1440: a caixa inteira do modelo entre as colunas (recua do 1,4 km só o necessário)', () => {
    const free = freeRect('overview', DESK)!;
    const v = siteView({ ...TUCURUI, precision: 'site' }, 'overview', { mobile: false, frame: { W: DESK.W, H: DESK.H, free } }, 'substation')!;
    expect(v).toMatchObject({ pitch: 48, heading: 58 });
    expect(v.dist).toBeGreaterThanOrEqual(1.4);
    expect(v.dist).toBeLessThanOrEqual(TWIN_MAX_DIST_KM);
    const pose = poseFromView(v, DESK.H);
    const box = twinBoxPoints(TUCURUI, layoutBox('substation'));
    for (const p of box) expect(within(projectPose(pose, DESK.W, DESK.H, p)!, free, 11)).toBe(true);
  });

  it('Planejar 1440: o modelo INTEIRO na faixa acima do Gantt (medido ou de 8 linhas) e à esquerda da coluna direita', () => {
    for (const ganttTop of [360, null]) {
      const free = freeRect('plan', { ...DESK, ganttTop })!;
      const v = siteView({ ...TUCURUI, precision: 'site' }, 'plan', { mobile: false, frame: { W: DESK.W, H: DESK.H, free } }, 'substation')!;
      expect(v).toMatchObject({ pitch: 50, heading: 64 });
      expect(v.dist).toBeGreaterThanOrEqual(1.6);
      expect(v.dist).toBeLessThanOrEqual(TWIN_MAX_DIST_KM);
      const pose = poseFromView(v, DESK.H);
      for (const p of twinBoxPoints(TUCURUI, layoutBox('substation'))) {
        expect(within(projectPose(pose, DESK.W, DESK.H, p)!, free, 11), `Gantt ${ganttTop}`).toBe(true);
      }
    }
    // o Gantt medido (6 linhas) deixa a faixa maior: o modelo chega mais perto
    const near = siteView({ ...TUCURUI, precision: 'site' }, 'plan', { mobile: false, frame: { W: DESK.W, H: DESK.H, free: freeRect('plan', { ...DESK, ganttTop: 360 })! } }, 'substation')!;
    const far = siteView({ ...TUCURUI, precision: 'site' }, 'plan', { mobile: false, frame: { W: DESK.W, H: DESK.H, free: freeRect('plan', DESK)! } }, 'substation')!;
    expect(near.dist).toBeLessThan(far.dist);
  });

  it('tipo ainda desconhecido: o layout genérico (o mesmo que o motor desenha); município: o marcador com o nome', () => {
    const free = freeRect('overview', DESK)!;
    const frame = { W: DESK.W, H: DESK.H, free };
    expect(siteView({ ...TUCURUI, precision: 'site' }, 'overview', { mobile: false, frame }))
      .toEqual(siteView({ ...TUCURUI, precision: 'site' }, 'overview', { mobile: false, frame }, NOMINAL_TWIN_KIND));
    const mun = siteView({ ...TUCURUI, precision: 'municipality' }, 'overview', { mobile: false, frame })!;
    expect(mun.dist).toBe(18);
    expect(within(screenOf(mun, DESK.W, DESK.H, [TUCURUI])[0], free, 29)).toBe(true);
    // Faturamento segue o preset
    expect(siteView({ ...TUCURUI, precision: 'site' }, 'billing', { mobile: false, frame }))
      .toEqual(siteView({ ...TUCURUI, precision: 'site' }, 'billing', DESKTOP));
    // viewFor repassa o tipo
    expect(viewFor('overview', { markers: sites3, site: { ...TUCURUI, precision: 'site' }, twinKind: 'hydro' }, { mobile: false, frame }))
      .toEqual(siteView({ ...TUCURUI, precision: 'site' }, 'overview', { mobile: false, frame }, 'hydro'));
  });

  it('fitView: nunca aproxima além do preset, respeita o teto e nunca solta NaN', () => {
    const free = { l: 480, t: 72, r: 928, b: 804 };
    const base = { lat: TUCURUI.lat, lng: TUCURUI.lng, dist: 900, pitch: 52, heading: -4, ox: 0, oy: 0 };
    const one = fitView(base, [ecefOf(TUCURUI.lat, TUCURUI.lng, 0)], { W: 1368, H: 858, free }, { pad: MARKER_PAD, minDist: 900, maxDist: 4500 });
    expect(one.dist).toBe(900);
    const far = fitView(base, [ecefOf(5, -73, 0), ecefOf(-33, -34, 0)], { W: 1368, H: 858, free }, { pad: MARKER_PAD, minDist: 900, maxDist: 4500 });
    expect(far.dist).toBeLessThanOrEqual(4500);
    expect([far.lat, far.lng, far.dist, far.ox, far.oy].every(Number.isFinite)).toBe(true);
    // sem palco/sem pontos: a vista base; área minúscula: só centra
    expect(fitView(base, [], { W: 1368, H: 858, free }, { pad: MARKER_PAD, minDist: 900, maxDist: 4500 })).toEqual(base);
    expect(fitView(base, [ecefOf(0, 0, 0)], null, { pad: MARKER_PAD, minDist: 900, maxDist: 4500 })).toEqual(base);
    const tiny = fitView(base, [ecefOf(TUCURUI.lat, TUCURUI.lng, 0)], { W: 1368, H: 858, free: { l: 100, t: 100, r: 140, b: 130 } }, { pad: MARKER_PAD, minDist: 900, maxDist: 4500 });
    expect(tiny).toMatchObject({ ox: 120 - 684, oy: 115 - 429, dist: 900 });
  });
});
