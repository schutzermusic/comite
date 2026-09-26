/**
 * PRESETS DE CÂMERA E DE MUNDO do Dashboard (estilo APEX FILM).
 *
 * Tudo aqui é PURO: recebe os dados (posições reais dos locais, nós de estoque
 * com coordenada) e devolve a câmera-alvo, o recuo do mundo (`dim`) e os
 * marcadores do globo. A página só escolhe a vista; o globo voa até ela.
 *
 * Valores de `APEX FILM/js/app/app.js:38-44`, adaptados ao dado real
 * (GLOBE.md §3):
 *  • portfólio — enquadra TODOS os marcadores: centro da caixa, distância =
 *    diagonal × 1,25 (mínimo 900 km), presa em 900–4500 km; sem marcador,
 *    o Brasil a 5200 km;
 *  • local (Visão geral / Planejar / Faturamento) — o ponto do local, com a
 *    distância pela PRECISÃO da posição (canteiro × município);
 *  • Supply Chain — enquadra o canteiro e os almoxarifados com coordenada.
 *
 * ENQUADRAMENTO NA ÁREA LIVRE: com o palco medido (`LayoutOpts.frame`), o
 * portfólio, a Visão geral e o Planejar não usam mais um deslocamento fixo —
 * o assunto (os marcadores; o modelo esquemático da obra) é PROJETADO com a
 * mesma câmera do motor (`camera.ts`) e posto dentro da área que o HUD deixa
 * livre naquela vista (`freeRect`: entre as colunas, abaixo da barra, acima da
 * dica/dock/Gantt e dos créditos), recuando a câmera só o necessário.
 *
 * Sem o palco medido (primeiro render), `ox`/`oy` (onde o alvo cai na tela,
 * em px) estão na escala do palco do filme (1920 px de largura) e são
 * multiplicados por `scale`; no celular são 0.
 */
import type { HealthLevel, SiteKind, SiteMarker, SitePosition } from '@/lib/dashboard/types';
import { ecefOf, enuAt, poseFromView, projectPose, type Vec3 } from './camera';
import type { CameraView, GlobeMarker, GlobeTone, ModuleId } from './contract';
import { layoutBox, type LayoutBox } from './twin/layouts';

export type DashView = 'portfolio' | ModuleId;

/** Retângulo em px do palco (esquerda, topo, direita, base). */
export interface Rect { l: number; t: number; r: number; b: number }

/** O palco medido (px) e a área que o HUD deixa livre nesta vista. */
export interface StageFrame { W: number; H: number; free: Rect }

export interface LayoutOpts {
  /** ≤ 767 px: HUD em folha inferior (sem `frame`, alvo centrado: ox = oy = 0). */
  mobile: boolean;
  /** Fator dos deslocamentos de tela (largura do palco ÷ 1920), 0.5–1. Padrão 1. */
  scale?: number;
  /** Palco medido + área livre: o assunto da vista é enquadrado nela (`fitView`). */
  frame?: StageFrame | null;
}

export interface LatLng { lat: number; lng: number }

/** O mundo recua atrás do HUD (brilho/saturação), por vista (`app.js:499`). */
export const VIEW_DIM: Record<DashView, number> = {
  portfolio: 0.16,
  overview: 0.06,
  plan: 0.42,
  supply: 0.22,
  billing: 0.38,
};

export const BRAZIL: LatLng = { lat: -14.235, lng: -54.5 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Coordenada utilizável: número finito dentro do intervalo. Nunca NaN no mapa. */
export function validLatLng(p: { lat: unknown; lng: unknown } | null | undefined): p is LatLng {
  if (!p) return false;
  const { lat, lng } = p;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Distância de grande círculo, em km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Caixa de enquadramento das posições válidas; `null` sem nenhuma. */
export function bounds(points: Array<{ lat: unknown; lng: unknown }>): { center: LatLng; diagKm: number } | null {
  const ok = points.filter(validLatLng);
  if (ok.length === 0) return null;
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  for (const p of ok) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return {
    center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
    diagKm: haversineKm({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng }),
  };
}

function offset(ox: number, oy: number, opts: LayoutOpts): { ox: number; oy: number } {
  if (opts.mobile) return { ox: 0, oy: 0 };
  const k = clamp(Number.isFinite(opts.scale) ? (opts.scale as number) : 1, 0.5, 1);
  return { ox: Math.round(ox * k), oy: Math.round(oy * k) };
}

/* ── Área livre do HUD ─────────────────────────────────────────────────── */

/** A grade do HUD (px), lida das variáveis CSS do Dashboard, e o palco medido. */
export interface HudGrid {
  W: number;
  H: number;
  /** ≤ 767 px: o globo é um bloco no alto e o HUD vira folhas embaixo. */
  mobile: boolean;
  /** 768–1179 px: colunas estreitas, Gantt na largura toda (≤ 46% da altura). */
  tablet?: boolean;
  safe: number;
  top: number;
  topH: number;
  leftW: number;
  rightW: number;
  /** A coluna direita do portfólio está recolhida (768–1179 px). */
  rightClosed?: boolean;
  /** Topo MEDIDO do cronograma (Planejar), px do palco; ausente = o Gantt de 8 linhas. */
  ganttTop?: number | null;
}

/** Folgas do HUD (px) — espelho de `dashboard-globe.css` e `modules/modules.css`. */
export const HUD_SPACE = Object.freeze({
  /** Respiro entre o assunto e um painel. */
  gap: 16,
  /** As colunas começam 14 px abaixo da barra. */
  colGap: 14,
  /** `--dg-dock-space` nas vistas do local. */
  dock: 78,
  /** A dica do portfólio e a linha dos créditos, na base. */
  hint: 30,
  /** `--dgm-gap`: entre o Gantt e a coluna direita. */
  moduleGap: 20,
  /** Celular: abaixo da barra, e a folha do HUD (−22 px) + a linha dos créditos na base. */
  mobileTop: 8,
  mobileBottom: 48,
  /** O Gantt com 8 linhas visíveis (cabeçalho + 8 × 43 px) na escala 0,84. */
  ganttMax: 484,
  /** 768–1179 px: o Gantt ocupa no máximo 46% da altura. */
  ganttShareTablet: 0.46,
  /** Menor área útil; abaixo disso o assunto usa o palco inteiro (nunca um retângulo invertido). */
  minW: 160,
  minH: 120,
});

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A área do palco que o HUD deixa livre nesta vista (px): entre as colunas,
 * abaixo da barra, acima da dica/dock (e do Gantt no Planejar); no celular, o
 * bloco do globo menos a barra, a folha e os créditos. `null` sem palco medido.
 */
export function freeRect(view: DashView, g: HudGrid | null | undefined): Rect | null {
  if (!g || !finiteNum(g.W) || !finiteNum(g.H) || g.W < 2 || g.H < 2) return null;
  const n = (v: unknown, d: number) => (finiteNum(v) && v >= 0 ? v : d);
  const W = g.W;
  const H = g.H;
  const safe = n(g.safe, 24);
  const barB = n(g.top, 14) + n(g.topH, 44);
  const leftW = n(g.leftW, 440);
  const rightW = n(g.rightW, 400);
  const whole: Rect = { l: safe, t: barB + 8, r: W - safe, b: H - (g.mobile ? HUD_SPACE.mobileBottom : safe) };
  let r: Rect;
  if (g.mobile) {
    r = { l: safe, t: barB + HUD_SPACE.mobileTop, r: W - safe, b: H - HUD_SPACE.mobileBottom };
  } else {
    const t = barB + HUD_SPACE.colGap;
    const leftEdge = safe + leftW + HUD_SPACE.gap;
    const rightEdge = W - safe - rightW - HUD_SPACE.gap;
    const colB = H - safe - HUD_SPACE.dock;
    switch (view) {
      case 'portfolio':
        r = { l: leftEdge, t, r: g.rightClosed ? W - safe : rightEdge, b: H - safe - HUD_SPACE.hint };
        break;
      case 'plan': {
        // o Gantt ocupa a base da esquerda até a coluna direita; o modelo fica na faixa de cima
        const est = colB - Math.min(HUD_SPACE.ganttMax, g.tablet ? H * HUD_SPACE.ganttShareTablet : colB - t);
        const gTop = finiteNum(g.ganttTop) && g.ganttTop > t && g.ganttTop <= colB ? g.ganttTop : est;
        r = { l: safe + 8, t, r: W - safe - rightW - HUD_SPACE.moduleGap - 8, b: gTop - 12 };
        break;
      }
      case 'billing':
        r = { l: safe + leftW + 40 + HUD_SPACE.gap, t, r: rightEdge, b: colB - 8 };
        break;
      default: // Visão geral, Supply Chain
        r = { l: leftEdge, t, r: rightEdge, b: colB - 8 };
    }
  }
  const ok = r.r - r.l >= HUD_SPACE.minW && r.b - r.t >= HUD_SPACE.minH;
  const out = ok ? r : whole;
  return { l: Math.round(out.l), t: Math.round(out.t), r: Math.round(out.r), b: Math.round(out.b) };
}

/* ── Enquadrar o assunto na área livre ─────────────────────────────────── */

export interface FitOpts {
  /** Margem (px) em volta do assunto projetado (hexágono, rótulo, cartões). */
  pad: Rect;
  /** A distância do preset é o PISO (o enquadramento só recua); o teto protege o modelo. */
  minDist: number;
  maxDist: number;
}

const round3 = (v: number) => {
  const k = 10 ** (2 - Math.floor(Math.log10(Math.abs(v) || 1)));
  return Math.round(v * k) / k;
};

/**
 * Enquadra os pontos (ECEF) na área livre: projeta com a MESMA câmera do motor
 * (`poseFromView` + campo vertical de 32°), recua a câmera até a caixa (com a
 * margem) caber e desloca o alvo (ox/oy) até o centro da caixa cair no centro
 * da área. Iterativo (a perspectiva não é linear); nunca aproxima além do preset.
 */
export function fitView(base: CameraView, pts: readonly Vec3[], frame: StageFrame | null | undefined, o: FitOpts): CameraView {
  if (!frame || !(frame.W > 0) || !(frame.H > 0) || pts.length === 0) return base;
  const { W, H, free } = frame;
  const fw = free.r - free.l - o.pad.l - o.pad.r;
  const fh = free.b - free.t - o.pad.t - o.pad.b;
  const lo = Math.max(1e-3, Math.min(o.minDist, o.maxDist));
  const hi = Math.max(lo, o.maxDist);
  let v: CameraView = { ...base, dist: clamp(base.dist, lo, hi) };
  if (!(fw > 8) || !(fh > 8)) {
    // área pequena demais para o assunto: só centra o alvo nela
    return { ...v, ox: Math.round((free.l + free.r) / 2 - W / 2), oy: Math.round((free.t + free.b) / 2 - H / 2) };
  }
  const fcx = (free.l + o.pad.l + free.r - o.pad.r) / 2;
  const fcy = (free.t + o.pad.t + free.b - o.pad.b) / 2;
  for (let i = 0; i < 12; i += 1) {
    const pose = poseFromView(v, H);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let ok = true;
    for (const p of pts) {
      const s = projectPose(pose, W, H, p);
      if (!s) { ok = false; break; }
      if (s[0] < minX) minX = s[0];
      if (s[0] > maxX) maxX = s[0];
      if (s[1] < minY) minY = s[1];
      if (s[1] > maxY) maxY = s[1];
    }
    if (!ok) {
      if (v.dist >= hi) break;
      v = { ...v, dist: Math.min(hi, v.dist * 1.6) };
      continue;
    }
    const k = Math.max((maxX - minX) / fw, (maxY - minY) / fh);
    const dist = clamp(v.dist * (k > 0 && Number.isFinite(k) ? k : 1), lo, hi);
    const dx = fcx - (minX + maxX) / 2;
    const dy = fcy - (minY + maxY) / 2;
    const settled = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dist - v.dist) <= v.dist * 1e-3;
    v = { ...v, dist, ox: clamp(v.ox + dx, -4000, 4000), oy: clamp(v.oy + dy, -4000, 4000) };
    if (settled) break;
  }
  return { ...v, dist: round3(v.dist), ox: Math.round(v.ox), oy: Math.round(v.oy) };
}

/** Margem em volta de cada marcador do portfólio: o hexágono e, em cima, o nome do pior local. */
export const MARKER_PAD: Rect = Object.freeze({ l: 30, t: 38, r: 30, b: 30 });
/**
 * Margem do modelo esquemático: o cartão da frente sobe 21 px; embaixo, a faixa
 * do rótulo obrigatório (encaixado no canto inferior esquerdo da área). No
 * Planejar a faixa é larga e baixa: o rótulo fica à esquerda do modelo, sem faixa.
 */
export const TWIN_PAD: Rect = Object.freeze({ l: 12, t: 26, r: 12, b: 36 });
export const TWIN_PAD_WIDE: Rect = Object.freeze({ l: 12, t: 26, r: 12, b: 12 });

/** O Brasil inteiro — sem nenhuma operação localizada (nunca um ponto inventado). */
export function brazilView(opts: LayoutOpts): CameraView {
  const v: CameraView = { ...BRAZIL, dist: 5200, pitch: 52, heading: -4, ...offset(200, 90, opts) };
  const f = opts.frame;
  if (!f) return v;
  // sem assunto: o centro do país no centro da área livre
  return { ...v, ox: Math.round((f.free.l + f.free.r) / 2 - f.W / 2), oy: Math.round((f.free.t + f.free.b) / 2 - f.H / 2) };
}

/**
 * Portfólio: enquadra todos os marcadores (`app.js:39`, com a caixa do dado
 * real): centro da caixa, distância = diagonal × 1,25 (900–4500 km) — e, com
 * o palco medido, a caixa inteira DENTRO da área livre (recuando se preciso).
 */
export function portfolioView(points: Array<{ lat: unknown; lng: unknown }>, opts: LayoutOpts): CameraView {
  const b = bounds(points);
  if (!b) return brazilView(opts);
  const dist = clamp(Math.max(b.diagKm * 1.25, 900), 900, 4500);
  const preset: CameraView = { ...b.center, dist, pitch: 52, heading: -4, ...offset(200, 90, opts) };
  if (!opts.frame) return preset;
  const pts = points.filter(validLatLng).map((p) => ecefOf(p.lat, p.lng, 0));
  return fitView({ ...preset, ox: 0, oy: 0 }, pts, opts.frame, { pad: MARKER_PAD, minDist: dist, maxDist: 4500 });
}

type SiteModule = Exclude<ModuleId, 'supply'>;

/** Distância e ângulos do local por módulo; a distância depende da precisão da posição. */
const SITE_PRESET: Record<SiteModule, { site: number; municipality: number; pitch: number; heading: number; ox: number; oy: number }> = {
  overview: { site: 1.4, municipality: 18, pitch: 48, heading: 58, ox: 190, oy: 40 },
  plan: { site: 1.6, municipality: 22, pitch: 50, heading: 64, ox: 40, oy: -170 },
  billing: { site: 9, municipality: 30, pitch: 54, heading: 60, ox: 90, oy: 60 },
};

/**
 * Rumo do eixo longo do modelo esquemático da obra: o rumo da câmera da Visão
 * geral + 90° (o modelo fica atravessado na tela). Fixo por local — não gira
 * ao trocar de Visão geral para Planejar.
 */
export const TWIN_AZIMUTH_DEG = SITE_PRESET.overview.heading + 90;

/**
 * Tipo presumido do modelo antes de o HUD do local dizer o tipo: o layout
 * genérico (o mesmo que o motor desenha sem `kind`). Quando o tipo chega, o
 * enquadramento se ajusta — um refinamento do mesmo voo (`reaimable`).
 */
export const NOMINAL_TWIN_KIND: SiteKind = 'generic';

/** Recuo máximo do local com modelo: ele fica inteiro (opacidade 1) até 4 km (`twinDistanceAlpha`). */
export const TWIN_MAX_DIST_KM = 4;

/**
 * Os 8 cantos (ECEF) da caixa do modelo esquemático ancorado no local, no rumo
 * do eixo longo — as MESMAS contas de `TwinModel.toEcef` (sem a queda da
 * curvatura, desprezível em ~500 m).
 */
export function twinBoxPoints(anchor: LatLng, box: LayoutBox, azimuthDeg = TWIN_AZIMUTH_DEG): Vec3[] {
  const O = ecefOf(anchor.lat, anchor.lng, 0);
  const { e, n, u } = enuAt(anchor.lat, anchor.lng);
  const A = (Number.isFinite(azimuthDeg) ? azimuthDeg : 0) * (Math.PI / 180);
  const sa = Math.sin(A);
  const ca = Math.cos(A);
  const X: Vec3 = [e[0] * sa + n[0] * ca, e[1] * sa + n[1] * ca, e[2] * sa + n[2] * ca];
  const Y: Vec3 = [-e[0] * ca + n[0] * sa, -e[1] * ca + n[1] * sa, -e[2] * ca + n[2] * sa];
  const out: Vec3[] = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [0, box.top]) {
        out.push([O[0] + X[0] * x + Y[0] * y + u[0] * z, O[1] + X[1] * x + Y[1] * y + u[1] * z, O[2] + X[2] * x + Y[2] * y + u[2] * z]);
      }
    }
  }
  return out;
}

/**
 * O local em foco (Visão geral, Planejar, Faturamento). `null` sem posição válida.
 * Com o palco medido, a Visão geral e o Planejar põem o assunto na área livre:
 * no CANTEIRO, a caixa do modelo esquemático (tipo `twinKind`, ou o genérico);
 * no município, o marcador com o nome. Faturamento segue o preset.
 */
export function siteView(
  pos: (LatLng & { precision?: SitePosition['precision'] | null }) | null,
  module: SiteModule,
  opts: LayoutOpts,
  twinKind?: SiteKind | null,
): CameraView | null {
  if (!validLatLng(pos)) return null;
  const p = SITE_PRESET[module];
  const dist = pos.precision === 'municipality' ? p.municipality : p.site;
  const preset: CameraView = { lat: pos.lat, lng: pos.lng, dist, pitch: p.pitch, heading: p.heading, ...offset(p.ox, p.oy, opts) };
  if (!opts.frame || module === 'billing') return preset;
  const base = { ...preset, ox: 0, oy: 0 };
  if (pos.precision === 'site') {
    const pts = twinBoxPoints(pos, layoutBox(twinKind ?? NOMINAL_TWIN_KIND));
    const f = opts.frame.free;
    // faixa larga e baixa (Planejar acima do Gantt): o rótulo cabe à esquerda do modelo
    const wide = !opts.mobile && f.r - f.l > 2.4 * (f.b - f.t);
    return fitView(base, pts, opts.frame, { pad: wide ? TWIN_PAD_WIDE : TWIN_PAD, minDist: dist, maxDist: Math.max(dist, TWIN_MAX_DIST_KM) });
  }
  return fitView(base, [ecefOf(pos.lat, pos.lng, 0)], opts.frame, { pad: MARKER_PAD, minDist: dist, maxDist: dist * 2 });
}

/**
 * Supply Chain: o canteiro e os locais de estoque com coordenada, enquadrados
 * juntos (diagonal × 1,4, mínimo 60 km, preso em 60–2400 km). `null` sem
 * posição válida do local.
 */
export function supplyView(site: LatLng | null, nodes: Array<{ lat: unknown; lng: unknown }>, opts: LayoutOpts): CameraView | null {
  if (!validLatLng(site)) return null;
  const b = bounds([site, ...nodes]);
  const center = b ? b.center : site;
  const diag = b ? b.diagKm : 0;
  const dist = clamp(Math.max(diag * 1.4, 60), 60, 2400);
  return { ...center, dist, pitch: 64, heading: -6, ...offset(-20, -30, opts) };
}

/**
 * A câmera de cada vista. Sem posição do local (projeto sem localização
 * apurada), o globo fica no portfólio — o painel diz por quê; o módulo pode
 * trazer o próprio enquadramento (`layerView`), que prevalece.
 */
export function viewFor(view: DashView, ctx: {
  markers: Array<{ lat: unknown; lng: unknown }>;
  site: (LatLng & { precision?: SitePosition['precision'] | null }) | null;
  nodes?: Array<{ lat: unknown; lng: unknown }>;
  layerView?: CameraView | null;
  /** Tipo de obra do modelo esquemático, quando o HUD do local já disse. */
  twinKind?: SiteKind | null;
}, opts: LayoutOpts): CameraView {
  const portfolio = portfolioView(ctx.markers, opts);
  if (view === 'portfolio') return portfolio;
  if (ctx.layerView && validLatLng(ctx.layerView) && Number.isFinite(ctx.layerView.dist) && ctx.layerView.dist > 0) {
    return opts.mobile ? { ...ctx.layerView, ox: 0, oy: 0 } : ctx.layerView;
  }
  if (view === 'supply') return supplyView(ctx.site, ctx.nodes ?? [], opts) ?? portfolio;
  return siteView(ctx.site, view, opts, ctx.twinKind) ?? portfolio;
}

/* ── Marcadores ────────────────────────────────────────────────────────── */

const LEVEL_RANK: Record<HealthLevel, number> = { critical: 0, attention: 1, healthy: 2, unknown: 3 };
const rank = (l: HealthLevel | null) => (l ? LEVEL_RANK[l] : 4);

/** A ordem da lista e do "pior local": crítico → atenção → o resto; depois pelo nome. */
export function sortSites<T extends Pick<SiteMarker, 'level' | 'name'>>(sites: T[]): T[] {
  return [...sites].sort((a, b) => rank(a.level) - rank(b.level) || a.name.localeCompare(b.name, 'pt-BR'));
}

export function toneForLevel(level: HealthLevel | null): GlobeTone {
  return level === 'critical' ? 'critical' : level === 'attention' ? 'attention' : level === 'healthy' ? 'healthy' : 'unknown';
}

export const PULSE: Record<GlobeTone, number> = { critical: 0.7, attention: 0.4, healthy: 0, completed: 0, unknown: 0, accent: 0 };

/** Tamanho do marcador em foco por vista (`app.js:570-593`: 58 no local, 52 no Supply, 48 no Faturamento). */
const FOCUS_SIZE: Record<DashView, number> = { portfolio: 58, overview: 58, plan: 58, supply: 52, billing: 48 };

/**
 * Os marcadores do globo a partir das posições reais. Em foco: selecionado,
 * maior, com rótulo; em hover: 54 px e rótulo; o pior local mostra o rótulo
 * no portfólio. Posição inválida não vira marcador. No Supply Chain, os OUTROS
 * projetos são contexto: sem pulso (o anel não pode parecer a resposta de um
 * almoxarifado vizinho); o motor ainda os desenha esmaecidos, por baixo dos nós.
 */
export function markersFor(sites: SiteMarker[], state: { view: DashView; focused: string | null; hovered: string | null }): GlobeMarker[] {
  const sorted = sortSites(sites.filter((s) => validLatLng(s.position)));
  const worst = sorted[0]?.projectId ?? null;
  return sorted.map((s) => {
    const tone = toneForLevel(s.level);
    const focused = s.projectId === state.focused;
    const hovered = s.projectId === state.hovered;
    const inPortfolio = state.view === 'portfolio';
    const context = state.view === 'supply' && !focused;
    return {
      id: s.projectId,
      lat: s.position.lat,
      lng: s.position.lng,
      tone,
      label: s.name,
      selected: focused || hovered,
      pulse: focused ? Math.max(PULSE[tone], 0.5) : context ? 0 : PULSE[tone],
      size: focused ? FOCUS_SIZE[state.view] : hovered ? 54 : 44,
      showLabel: focused || hovered || (inPortfolio && s.projectId === worst),
    };
  });
}
