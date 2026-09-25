/**
 * O HEXÁGONO DO PRODUTO — a "joia" que marca um projeto no mapa.
 *
 * Mesma geometria de `CesiumDashboardGlobe.buildMarkerImage` (V1) e de
 * `APEX FILM/js/world/world.js:399-504`: halo radial, anel hexagonal, corpo em
 * degradê com brilho especular, micro-hexágono interno e, quando selecionado,
 * o retículo externo com seis marcas. Pré-renderizado a 3× por tom/seleção e
 * guardado em cache; desenhado no canvas de sobreposição em 2·size px.
 */
import type { GlobeTone } from './contract';

export type Rgb = readonly [number, number, number];

export interface HexPalette {
  core: string;
  ring: string;
  halo: string;
  /** Cor do tom para pulsos, arcos e partículas. */
  rgb: Rgb;
}

export const HEX_PALETTE: Readonly<Record<GlobeTone, HexPalette>> = Object.freeze({
  healthy: { core: '#22D3EE', ring: '#7DEBFF', halo: 'rgba(34,211,238,0.28)', rgb: [34, 211, 238] },
  attention: { core: '#F5A524', ring: '#FFD27A', halo: 'rgba(245,165,36,0.32)', rgb: [245, 165, 36] },
  critical: { core: '#EF4B55', ring: '#FF8A8F', halo: 'rgba(239,75,85,0.34)', rgb: [239, 75, 85] },
  completed: { core: '#10B981', ring: '#86EFAC', halo: 'rgba(16,185,129,0.28)', rgb: [16, 185, 129] },
  // `ig-tone-neutral` — sem leitura de saúde: nunca parece "em dia"
  unknown: { core: '#94A3B8', ring: '#CBD5E1', halo: 'rgba(148,163,184,0.24)', rgb: [148, 163, 184] },
  accent: { core: '#2DD4BF', ring: '#99F6E4', halo: 'rgba(45,212,191,0.30)', rgb: [45, 212, 191] },
});

export function paletteFor(tone: GlobeTone | string | null | undefined): HexPalette {
  return (tone && (HEX_PALETTE as Record<string, HexPalette>)[tone]) || HEX_PALETTE.unknown;
}

export function rgba(c: Rgb, a: number): string {
  const al = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0;
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.round(al * 1000) / 1000})`;
}

/** Tamanhos em px lógicos (metade do lado desenhado): normal, hover, principal. */
export const HEX_SIZE = Object.freeze({ normal: 44, hover: 54, main: 58, selectedDefault: 52 });

/** Hexágono de ponta para cima, centrado em (cx, cy), raio circunscrito `r`. */
export function hexPath(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  c.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((ch) => parseInt(ch + ch, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [v[0] || 0, v[1] || 0, v[2] || 0];
}

/** Mistura duas cores hex em sRGB; `t` = 0 → a, 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const m = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

const SPRITE_UNITS = 96;
const SPRITE_SCALE = 3;
const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * O sprite (96 unidades lógicas, 3×) de um tom, selecionado ou não. `null` fora
 * do navegador ou sem contexto 2D.
 */
export function hexSprite(tone: GlobeTone, selected: boolean): HTMLCanvasElement | null {
  const key = `${tone}:${selected ? 'sel' : 'def'}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const P = paletteFor(tone);
  const cv = document.createElement('canvas');
  cv.width = SPRITE_UNITS * SPRITE_SCALE;
  cv.height = SPRITE_UNITS * SPRITE_SCALE;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.scale(SPRITE_SCALE, SPRITE_SCALE);
  const cx = SPRITE_UNITS / 2;
  const cy = SPRITE_UNITS / 2;

  // 1 · halo atmosférico
  const haloR = selected ? 36 : 22;
  const halo = c.createRadialGradient(cx, cy, 2, cx, cy, haloR);
  halo.addColorStop(0, P.halo);
  halo.addColorStop(0.55, P.halo.replace(/[\d.]+\)$/, '0.10)'));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = halo;
  c.beginPath();
  c.arc(cx, cy, haloR, 0, Math.PI * 2);
  c.fill();

  // 2 · anel hexagonal (silhueta sobre a imagem de satélite)
  const outerR = selected ? 18 : 13;
  c.strokeStyle = P.ring;
  c.globalAlpha = selected ? 0.9 : 0.42;
  c.lineWidth = selected ? 1.4 : 1.1;
  c.lineJoin = 'miter';
  hexPath(c, cx, cy, outerR);
  c.stroke();
  c.globalAlpha = 1;

  // 3 · corpo: base escura + degradê "joia"
  const bodyR = selected ? 11 : 9;
  c.fillStyle = 'rgba(8, 14, 20, 0.55)';
  hexPath(c, cx, cy, bodyR + 1.2);
  c.fill();
  const body = c.createLinearGradient(cx, cy - bodyR, cx, cy + bodyR);
  body.addColorStop(0, mixHex(P.core, '#FFFFFF', 0.42));
  body.addColorStop(0.5, P.core);
  body.addColorStop(1, mixHex(P.core, '#000000', 0.45));
  c.fillStyle = body;
  hexPath(c, cx, cy, bodyR);
  c.fill();

  // 4 · contorno nítido do corpo
  c.strokeStyle = mixHex(P.ring, '#FFFFFF', 0.15);
  c.lineWidth = 1.3;
  hexPath(c, cx, cy, bodyR);
  c.stroke();

  // 5 · brilho especular recortado no hexágono
  c.save();
  hexPath(c, cx, cy, bodyR);
  c.clip();
  const spec = c.createLinearGradient(cx - bodyR, cy - bodyR, cx + bodyR * 0.2, cy + bodyR * 0.4);
  spec.addColorStop(0, 'rgba(255,255,255,0.65)');
  spec.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = spec;
  c.fillRect(cx - bodyR, cy - bodyR, bodyR * 2, bodyR * 1.4);
  c.restore();

  // 6 · micro-hexágono interno
  c.strokeStyle = 'rgba(255,255,255,0.7)';
  c.lineWidth = 0.8;
  hexPath(c, cx, cy, bodyR * 0.5);
  c.stroke();

  // 7 · selecionado: retículo externo com seis marcas radiais
  if (selected) {
    const br = 24;
    c.strokeStyle = P.ring;
    c.globalAlpha = 0.55;
    c.lineWidth = 0.9;
    hexPath(c, cx, cy, br);
    c.stroke();
    c.globalAlpha = 0.85;
    c.lineWidth = 1.2;
    c.lineCap = 'round';
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      c.beginPath();
      c.moveTo(cx + (br + 1) * Math.cos(a), cy + (br + 1) * Math.sin(a));
      c.lineTo(cx + (br + 4) * Math.cos(a), cy + (br + 4) * Math.sin(a));
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  spriteCache.set(key, cv);
  return cv;
}
