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
  BRAZIL, VIEW_DIM, brazilView, haversineKm, markersFor, portfolioView, siteView, sortSites, supplyView, validLatLng, viewFor,
} from '@/components/dashboard-globe/presets';
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
});
