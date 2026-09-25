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
 * `ox`/`oy` (onde o alvo cai na tela, em px) estão na escala do palco do
 * filme (1920 px de largura) e são multiplicados por `scale`; no celular são 0
 * (o HUD vira folha inferior e o alvo fica no centro do globo).
 */
import type { HealthLevel, SiteMarker, SitePosition } from '@/lib/dashboard/types';
import type { CameraView, GlobeMarker, GlobeTone, ModuleId } from './contract';

export type DashView = 'portfolio' | ModuleId;

export interface LayoutOpts {
  /** ≤ 767 px: HUD em folha inferior — alvo centrado (ox = oy = 0). */
  mobile: boolean;
  /** Fator dos deslocamentos de tela (largura do palco ÷ 1920), 0.5–1. Padrão 1. */
  scale?: number;
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

/** O Brasil inteiro — sem nenhuma operação localizada (nunca um ponto inventado). */
export function brazilView(opts: LayoutOpts): CameraView {
  return { ...BRAZIL, dist: 5200, pitch: 52, heading: -4, ...offset(200, 90, opts) };
}

/** Portfólio: enquadra todos os marcadores (`app.js:39`, com a caixa do dado real). */
export function portfolioView(points: Array<{ lat: unknown; lng: unknown }>, opts: LayoutOpts): CameraView {
  const b = bounds(points);
  if (!b) return brazilView(opts);
  const dist = clamp(Math.max(b.diagKm * 1.25, 900), 900, 4500);
  return { ...b.center, dist, pitch: 52, heading: -4, ...offset(200, 90, opts) };
}

type SiteModule = Exclude<ModuleId, 'supply'>;

/** Distância e ângulos do local por módulo; a distância depende da precisão da posição. */
const SITE_PRESET: Record<SiteModule, { site: number; municipality: number; pitch: number; heading: number; ox: number; oy: number }> = {
  overview: { site: 1.4, municipality: 18, pitch: 48, heading: 58, ox: 190, oy: 40 },
  plan: { site: 1.6, municipality: 22, pitch: 50, heading: 64, ox: 40, oy: -170 },
  billing: { site: 9, municipality: 30, pitch: 54, heading: 60, ox: 90, oy: 60 },
};

/** O local em foco (Visão geral, Planejar, Faturamento). `null` sem posição válida. */
export function siteView(pos: (LatLng & { precision?: SitePosition['precision'] | null }) | null, module: SiteModule, opts: LayoutOpts): CameraView | null {
  if (!validLatLng(pos)) return null;
  const p = SITE_PRESET[module];
  const dist = pos.precision === 'municipality' ? p.municipality : p.site;
  return { lat: pos.lat, lng: pos.lng, dist, pitch: p.pitch, heading: p.heading, ...offset(p.ox, p.oy, opts) };
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
}, opts: LayoutOpts): CameraView {
  const portfolio = portfolioView(ctx.markers, opts);
  if (view === 'portfolio') return portfolio;
  if (ctx.layerView && validLatLng(ctx.layerView) && Number.isFinite(ctx.layerView.dist) && ctx.layerView.dist > 0) {
    return opts.mobile ? { ...ctx.layerView, ox: 0, oy: 0 } : ctx.layerView;
  }
  if (view === 'supply') return supplyView(ctx.site, ctx.nodes ?? [], opts) ?? portfolio;
  return siteView(ctx.site, view, opts) ?? portfolio;
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
 * no portfólio. Posição inválida não vira marcador.
 */
export function markersFor(sites: SiteMarker[], state: { view: DashView; focused: string | null; hovered: string | null }): GlobeMarker[] {
  const sorted = sortSites(sites.filter((s) => validLatLng(s.position)));
  const worst = sorted[0]?.projectId ?? null;
  return sorted.map((s) => {
    const tone = toneForLevel(s.level);
    const focused = s.projectId === state.focused;
    const hovered = s.projectId === state.hovered;
    const inPortfolio = state.view === 'portfolio';
    return {
      id: s.projectId,
      lat: s.position.lat,
      lng: s.position.lng,
      tone,
      label: s.name,
      selected: focused || hovered,
      pulse: focused ? Math.max(PULSE[tone], 0.5) : PULSE[tone],
      size: focused ? FOCUS_SIZE[state.view] : hovered ? 54 : 44,
      showLabel: focused || hovered || (inPortfolio && s.projectId === worst),
    };
  });
}
