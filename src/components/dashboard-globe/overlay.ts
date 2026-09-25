/**
 * A SOBREPOSIÇÃO DO MUNDO — o canvas 2D desenhado por cima do globo, na
 * gramática do filme (`APEX FILM/js/world/world.js`): divisas das UFs e o
 * realce ciano, arcos com brilho em 3 traços + partículas + desenho
 * progressivo, hexágonos com os dois anéis de pulso defasados, e as posições
 * de tela que alimentam os rótulos DOM e o clique/hover.
 *
 * Cada ponto é projetado UMA vez por quadro, com a matriz de visão×projeção da
 * câmera do Cesium no próprio quadro (a mesma conta de
 * `SceneTransforms.worldToWindowCoordinates` em 3D, sem alocar) e o teste de
 * horizonte do `EllipsoidalOccluder` (espaço escalado do WGS84).
 *
 * Estado por id (marcadores, arcos, cartões, UFs): nada é recriado no hover;
 * o que entra aparece com fade, o que sai some com fade e só então é apagado.
 */
import type { GlobeArc, GlobeMarker, GlobeNode, GlobeTone } from './contract';
import { approach, clamp, DEG, invLerp, shortestArc } from './camera';
import { HEX_SIZE, hexSprite, paletteFor, rgba, type Rgb } from './markers';
import type { LabelSpec } from './labels';

/* ── WGS84 ──────────────────────────────────────────────────────────────── */

const WGS84_A = 6_378_137.0;
const WGS84_B = 6_356_752.314245179;
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

/** Geodésico (graus, metros) → ECEF (metros), como `Cartesian3.fromDegrees` no WGS84. */
export function llhToEcef(latDeg: number, lngDeg: number, h: number, out: Float64Array | number[], o = 0): void {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const s = Math.sin(lat);
  const c = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  out[o] = (N + h) * c * Math.cos(lng);
  out[o + 1] = (N + h) * c * Math.sin(lng);
  out[o + 2] = (N * (1 - WGS84_E2) + h) * s;
}

export const validLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/* ── Projeção ───────────────────────────────────────────────────────────── */

/**
 * Projeta ECEF → pixels CSS do canvas com a matriz visão×projeção do quadro.
 * `project` devolve `false` atrás da câmera, atrás do horizonte ou não-finito.
 */
export class Projector {
  private readonly m = new Float64Array(16);
  W = 0;
  H = 0;
  ok = false;
  private cvx = 0;
  private cvy = 0;
  private cvz = 0;
  private vhMagSq = 0;

  /** `viewProj` em ordem de coluna (Cesium `Matrix4`), câmera em ECEF (m). */
  set(viewProj: ArrayLike<number>, W: number, H: number, cam: { x: number; y: number; z: number }): void {
    let ok = W > 0 && H > 0 && Number.isFinite(W) && Number.isFinite(H);
    for (let i = 0; i < 16; i += 1) {
      const v = viewProj[i];
      if (!Number.isFinite(v)) ok = false;
      this.m[i] = v;
    }
    this.W = W;
    this.H = H;
    this.cvx = cam.x / WGS84_A;
    this.cvy = cam.y / WGS84_A;
    this.cvz = cam.z / WGS84_B;
    this.vhMagSq = this.cvx * this.cvx + this.cvy * this.cvy + this.cvz * this.cvz - 1;
    this.ok = ok && Number.isFinite(this.vhMagSq);
  }

  /** Visível? (no ponto `out[0..1]` ficam x, y em px CSS). */
  project(x: number, y: number, z: number, out: Float64Array | number[]): boolean {
    if (!this.ok) return false;
    const m = this.m;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(cw > 1e-9)) return false;
    // horizonte (Cesium EllipsoidalOccluder.isScaledSpacePointVisible)
    const tx = x / WGS84_A - this.cvx;
    const ty = y / WGS84_A - this.cvy;
    const tz = z / WGS84_B - this.cvz;
    const vtDotVc = -(tx * this.cvx + ty * this.cvy + tz * this.cvz);
    const occluded = this.vhMagSq < 0
      ? vtDotVc > 0
      : vtDotVc > this.vhMagSq && (vtDotVc * vtDotVc) / (tx * tx + ty * ty + tz * tz) > this.vhMagSq;
    if (occluded) return false;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const sx = (cx / cw + 1) * 0.5 * this.W;
    const sy = (1 - cy / cw) * 0.5 * this.H;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return false;
    out[0] = sx;
    out[1] = sy;
    return true;
  }
}

/* ── Limites das UFs (topologia de br-uf-geo.ts) ────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV: Record<string, number> = Object.fromEntries(B64.split('').map((ch, i) => [ch, i]));

/** Um arco codificado → inteiros [lng, lat]·1000 absolutos (zigzag + varint base64url). */
export function decodeArcInts(s: string): number[] {
  const vals: number[] = [];
  let i = 0;
  while (i < s.length) {
    let z = 0;
    let shift = 0;
    for (;;) {
      const c = B64_REV[s[i]];
      i += 1;
      if (c === undefined) return [];
      z += (c & 31) * 2 ** shift;
      shift += 5;
      if (c < 32 || i >= s.length) break;
    }
    vals.push(z % 2 === 0 ? z / 2 : -(z + 1) / 2);
  }
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let j = 0; j + 1 < vals.length; j += 2) {
    x += vals[j];
    y += vals[j + 1];
    out.push(x, y);
  }
  return out;
}

/** Anel = arcos concatenados (o 1º ponto de cada arco seguinte é o último do anterior). */
export function ringInts(arcs: readonly number[][], refs: readonly number[]): number[] {
  const ring: number[] = [];
  for (const ref of refs) {
    const src = ref >= 0 ? arcs[ref] : arcs[~ref];
    if (!src) continue;
    const pts: number[] = [];
    if (ref >= 0) pts.push(...src);
    else for (let k = src.length - 2; k >= 0; k -= 2) pts.push(src[k], src[k + 1]);
    ring.push(...(ring.length ? pts.slice(2) : pts));
  }
  return ring;
}

export interface UfGeo {
  /** Cada divisa uma vez, em ECEF (x, y, z …). */
  arcs: Float64Array[];
  /** Anéis por UF, em ECEF. */
  rings: Map<string, Float64Array[]>;
}

function intsToEcef(ints: number[]): Float64Array {
  const out = new Float64Array((ints.length / 2) * 3);
  for (let i = 0, j = 0; i + 1 < ints.length; i += 2, j += 3) llhToEcef(ints[i + 1] / 1000, ints[i] / 1000, 0, out, j);
  return out;
}

export function buildUfGeo(
  arcStrings: readonly string[],
  ringRefs: Readonly<Record<string, readonly (readonly number[])[]>>,
): UfGeo {
  const ints = arcStrings.map(decodeArcInts);
  const rings = new Map<string, Float64Array[]>();
  for (const [uf, list] of Object.entries(ringRefs)) {
    rings.set(uf.toUpperCase(), list.map((refs) => intsToEcef(ringInts(ints, refs))));
  }
  return { arcs: ints.map(intsToEcef), rings };
}

/* ── Hit-test ───────────────────────────────────────────────────────────── */

export interface ScreenMark {
  id: string;
  x: number;
  y: number;
}

/** O marcador mais próximo de (x, y) dentro do raio (px), ou `null`. */
export function pickNearest(marks: readonly ScreenMark[], x: number, y: number, radius = 42): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best: string | null = null;
  let bd = radius;
  for (const m of marks) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) {
      bd = d;
      best = m.id;
    }
  }
  return best;
}

/* ── Estado por id ──────────────────────────────────────────────────────── */

interface MarkerState {
  m: GlobeMarker;
  ecef: Float64Array;
  alpha: number;
  present: boolean;
  visible: boolean;
  sx: number;
  sy: number;
}

interface ArcState {
  a: GlobeArc;
  alpha: number;
  draw: number;
  present: boolean;
}

interface NodeState {
  n: GlobeNode;
  ecef: Float64Array;
  alpha: number;
  reveal: number;
  present: boolean;
}

interface UfState {
  k: number;
  present: boolean;
}

export interface OverlayStep {
  dt: number;
  flying: boolean;
  /** Fração linear do voo (1 = pousou). */
  arrive: number;
  reducedMotion: boolean;
}

export interface OverlayDraw {
  t: number;
  /** Distância da câmera (km). */
  dist: number;
  reducedMotion: boolean;
  hoverId: string | null;
}

const QUIET_BORDER: Rgb = [220, 235, 245];
const CYAN: Rgb = [125, 235, 255];
const CYAN_LINE: Rgb = [200, 245, 255];
const CYAN_FILL: Rgb = [34, 211, 238];
const WHITE: Rgb = [242, 245, 247];
const ARC_SEGMENTS = 48;
const PARTICLES = 3;

const EPS = 0.002;

function fadeRate(reduced: boolean): number {
  // opacidade em ≤150 ms sob movimento reduzido; senão o "sm(…, 6)" do filme
  return reduced ? 25 : 6;
}

function settled(v: number, target: number): boolean {
  return Math.abs(v - target) < EPS;
}

export class WorldOverlay {
  private readonly markers = new Map<string, MarkerState>();
  private readonly arcs = new Map<string, ArcState>();
  private readonly nodes = new Map<string, NodeState>();
  private readonly ufs = new Map<string, UfState>();
  private geo: UfGeo | null = null;
  private readonly p = new Float64Array(3);
  private readonly s = new Float64Array(2);
  private readonly marks: ScreenMark[] = [];
  /** O último quadro desenhou pulso ou partícula visível. */
  motion = false;

  setGeo(geo: UfGeo | null): void {
    this.geo = geo;
  }

  hasGeo(): boolean {
    return this.geo !== null;
  }

  /** Recebe as props (diff por id). */
  sync(
    markers: readonly GlobeMarker[] | undefined,
    arcs: readonly GlobeArc[] | undefined,
    nodes: readonly GlobeNode[] | undefined,
    ufs: readonly string[] | undefined,
  ): void {
    const seenM = new Set<string>();
    for (const m of markers ?? []) {
      if (!m || typeof m.id !== 'string' || seenM.has(m.id) || !validLatLng(m.lat, m.lng)) continue;
      seenM.add(m.id);
      const st = this.markers.get(m.id);
      if (st) {
        if (st.m.lat !== m.lat || st.m.lng !== m.lng) llhToEcef(m.lat, m.lng, 0, st.ecef);
        st.m = m;
        st.present = true;
      } else {
        const ecef = new Float64Array(3);
        llhToEcef(m.lat, m.lng, 0, ecef);
        this.markers.set(m.id, { m, ecef, alpha: 0, present: true, visible: false, sx: 0, sy: 0 });
      }
    }
    for (const [id, st] of this.markers) if (!seenM.has(id)) st.present = false;

    const seenA = new Set<string>();
    for (const a of arcs ?? []) {
      if (!a || typeof a.id !== 'string' || seenA.has(a.id)) continue;
      if (!a.from || !a.to || !validLatLng(a.from.lat, a.from.lng) || !validLatLng(a.to.lat, a.to.lng)) continue;
      seenA.add(a.id);
      const st = this.arcs.get(a.id);
      if (st) {
        st.a = a;
        st.present = true;
      } else {
        this.arcs.set(a.id, { a, alpha: 0, draw: 0, present: true });
      }
    }
    for (const [id, st] of this.arcs) if (!seenA.has(id)) st.present = false;

    const seenN = new Set<string>();
    for (const n of nodes ?? []) {
      if (!n || typeof n.id !== 'string' || seenN.has(n.id) || !validLatLng(n.lat, n.lng)) continue;
      seenN.add(n.id);
      const st = this.nodes.get(n.id);
      if (st) {
        if (st.n.lat !== n.lat || st.n.lng !== n.lng) llhToEcef(n.lat, n.lng, 0, st.ecef);
        st.n = n;
        st.present = true;
      } else {
        const ecef = new Float64Array(3);
        llhToEcef(n.lat, n.lng, 0, ecef);
        this.nodes.set(n.id, { n, ecef, alpha: 0, reveal: 0, present: true });
      }
    }
    for (const [id, st] of this.nodes) if (!seenN.has(id)) st.present = false;

    const seenU = new Set<string>();
    for (const raw of ufs ?? []) {
      if (typeof raw !== 'string') continue;
      const uf = raw.trim().toUpperCase();
      if (!uf || seenU.has(uf)) continue;
      seenU.add(uf);
      const st = this.ufs.get(uf);
      if (st) st.present = true;
      else this.ufs.set(uf, { k: 0, present: true });
    }
    for (const [uf, st] of this.ufs) if (!seenU.has(uf)) st.present = false;
  }

  /** Avança fades e desenho progressivo. Devolve `true` enquanto algo ainda se move. */
  step(f: OverlayStep): boolean {
    const rate = fadeRate(f.reducedMotion);
    const dt = Number.isFinite(f.dt) ? Math.max(0, f.dt) : 0;
    // arcos e cartões crescem junto com a entrada dos painéis (settle)
    const settleK = clamp((f.arrive - 0.55) / 0.45);
    let moving = false;
    for (const [id, st] of this.markers) {
      const target = st.present ? 1 : 0;
      st.alpha = approach(st.alpha, target, dt, rate);
      if (!st.present && st.alpha < EPS) this.markers.delete(id);
      else if (!settled(st.alpha, target)) moving = true;
      else st.alpha = target;
    }
    for (const [id, st] of this.arcs) {
      const target = st.present ? 1 : 0;
      st.alpha = approach(st.alpha, target, dt, rate);
      if (f.reducedMotion) st.draw = 1;
      else if (f.flying) st.draw = Math.max(st.draw, settleK);
      else st.draw = Math.min(1, st.draw + dt / 0.8);
      if (!st.present && st.alpha < EPS) this.arcs.delete(id);
      else if (!settled(st.alpha, target) || st.draw < 1) moving = true;
      else st.alpha = target;
    }
    for (const [id, st] of this.nodes) {
      const target = st.present ? 1 : 0;
      st.alpha = approach(st.alpha, target, dt, rate);
      if (f.reducedMotion) st.reveal = 1;
      else if (f.flying) st.reveal = Math.max(st.reveal, settleK);
      else st.reveal = Math.min(1, st.reveal + dt / 0.6);
      if (!st.present && st.alpha < EPS) this.nodes.delete(id);
      else if (!settled(st.alpha, target) || st.reveal < 1) moving = true;
      else st.alpha = target;
    }
    for (const [uf, st] of this.ufs) {
      const target = st.present ? 1 : 0;
      st.k = approach(st.k, target, dt, f.reducedMotion ? 25 : 4);
      if (!st.present && st.k < EPS) this.ufs.delete(uf);
      else if (!settled(st.k, target)) moving = true;
      else st.k = target;
    }
    return moving;
  }

  /** Desenha o quadro e devolve os rótulos a posicionar. */
  draw(ctx: CanvasRenderingContext2D, P: Projector, f: OverlayDraw): LabelSpec[] {
    const labels: LabelSpec[] = [];
    this.marks.length = 0;
    this.motion = false;
    if (!P.ok) {
      for (const st of this.markers.values()) st.visible = false;
      return labels;
    }
    const dist = Number.isFinite(f.dist) ? f.dist : 1e4;

    // 1 · divisas das UFs + realce
    if (this.geo) {
      const quiet = 0.5 * (1 - invLerp(10, 3, dist));
      if (quiet > 0.003) {
        ctx.beginPath();
        for (const arc of this.geo.arcs) this.pathLine(ctx, P, arc, false);
        ctx.strokeStyle = rgba(QUIET_BORDER, quiet);
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      const near = 1 - invLerp(20, 5, dist);
      for (const [uf, st] of this.ufs) {
        const k = st.k * near;
        if (k <= 0.003) continue;
        const rings = this.geo.rings.get(uf);
        if (rings) this.highlight(ctx, P, rings, k);
      }
    }

    // 2 · arcos
    for (const st of this.arcs.values()) this.drawArc(ctx, P, st, f);

    // 3 · cartões (âncora pequena) — o rótulo DOM vem depois
    for (const [id, st] of this.nodes) {
      const a = st.alpha;
      const tone = st.n.tone ?? 'default';
      const visible = a > 0.003 && P.project(st.ecef[0], st.ecef[1], st.ecef[2], this.s);
      if (visible) {
        const spriteTone: GlobeTone = tone === 'hit' ? 'completed' : 'healthy';
        const size = tone === 'hit' ? 46 : tone === 'none' ? 36 : 40;
        this.drawHex(ctx, this.s[0], this.s[1], spriteTone, false, size, a * (tone === 'none' ? 0.6 : 1));
      }
      labels.push({
        id: `n:${id}`,
        kind: 'node',
        title: st.n.title,
        value: st.n.value ?? null,
        tone,
        x: this.s[0] + 18,
        y: this.s[1],
        alpha: visible ? a * st.reveal : 0,
      });
    }

    // 4 · marcadores: comuns primeiro, destacados por cima
    const ordered = Array.from(this.markers.values()).sort((a, b) => rank(a, f.hoverId) - rank(b, f.hoverId));
    for (const st of ordered) {
      const m = st.m;
      const hovered = f.hoverId === m.id;
      st.visible = st.alpha > 0.003 && P.project(st.ecef[0], st.ecef[1], st.ecef[2], this.s);
      if (st.visible) {
        st.sx = this.s[0];
        st.sy = this.s[1];
        const pulse = clamp(Number.isFinite(m.pulse) ? (m.pulse as number) : 0);
        if (pulse > 0 && !f.reducedMotion) {
          const col = paletteFor(m.tone).rgb;
          for (let k = 0; k < 2; k += 1) {
            const u = (((f.t * 0.7 + k * 0.5) % 1) + 1) % 1;
            ctx.beginPath();
            ctx.arc(st.sx, st.sy, 14 + u * 60, 0, Math.PI * 2);
            ctx.strokeStyle = rgba(col, (1 - u) * 0.6 * st.alpha * pulse);
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
          this.motion = true;
        }
        const selected = Boolean(m.selected) || hovered;
        const base = Number.isFinite(m.size) && (m.size as number) > 0
          ? clamp(m.size as number, 8, 120)
          : m.selected ? HEX_SIZE.selectedDefault : HEX_SIZE.normal;
        const size = hovered ? Math.max(base, HEX_SIZE.hover) : base;
        this.drawHex(ctx, st.sx, st.sy, m.tone, selected, size, st.alpha);
        if (st.alpha > 0.5) this.marks.push({ id: m.id, x: st.sx, y: st.sy });
      }
      const showLabel = Boolean(m.showLabel || m.selected || hovered) && typeof m.label === 'string' && m.label.length > 0;
      labels.push({
        id: `m:${m.id}`,
        kind: 'tag',
        title: m.label ?? '',
        x: st.sx + 26,
        y: st.sy,
        alpha: st.visible && showLabel ? st.alpha : 0,
      });
    }
    return labels;
  }

  /** Marcador sob o ponteiro (raio 42 px, como o protótipo). */
  pick(x: number, y: number, radius = 42): string | null {
    return pickNearest(this.marks, x, y, radius);
  }

  private drawHex(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tone: GlobeTone,
    selected: boolean,
    size: number,
    alpha: number,
  ): void {
    const sprite = hexSprite(tone, selected);
    if (!sprite || alpha <= 0.003) return;
    ctx.globalAlpha = clamp(alpha);
    ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
  }

  /** Linha projetada; levanta a caneta onde o ponto some (horizonte, atrás da câmera). */
  private pathLine(ctx: CanvasRenderingContext2D, P: Projector, pts: Float64Array, closed: boolean): boolean {
    let pen = false;
    let all = true;
    const n = pts.length / 3;
    const count = closed ? n + 1 : n;
    for (let i = 0; i < count; i += 1) {
      const j = (i % n) * 3;
      if (P.project(pts[j], pts[j + 1], pts[j + 2], this.s)) {
        if (pen) ctx.lineTo(this.s[0], this.s[1]);
        else ctx.moveTo(this.s[0], this.s[1]);
        pen = true;
      } else {
        pen = false;
        all = false;
      }
    }
    return all;
  }

  /** Realce da UF (`world.js:380-396`): preenchimento suave + três traços ciano. */
  private highlight(ctx: CanvasRenderingContext2D, P: Projector, rings: Float64Array[], k: number): void {
    // preenchimento só dos anéis inteiramente visíveis (como `pathPoly` do filme)
    ctx.beginPath();
    let any = false;
    for (const ring of rings) {
      const n = ring.length / 3;
      let ok = n >= 3;
      for (let i = 0; ok && i < n; i += 1) ok = P.project(ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], this.s);
      if (!ok) continue;
      for (let i = 0; i < n; i += 1) {
        P.project(ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], this.s);
        if (i === 0) ctx.moveTo(this.s[0], this.s[1]);
        else ctx.lineTo(this.s[0], this.s[1]);
      }
      ctx.closePath();
      any = true;
    }
    if (any) {
      ctx.fillStyle = rgba(CYAN_FILL, 0.1 * k);
      ctx.fill('evenodd');
    }
    ctx.beginPath();
    for (const ring of rings) this.pathLine(ctx, P, ring, true);
    ctx.lineJoin = 'round';
    for (const [w, col, al] of [[7, CYAN, 0.16], [3.2, CYAN, 0.32], [1.4, CYAN_LINE, 0.9]] as const) {
      ctx.strokeStyle = rgba(col, al * k);
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }

  /** Arco 3D entre dois pontos do chão, `h` km no meio (`world.js:110-164`). */
  private drawArc(ctx: CanvasRenderingContext2D, P: Projector, st: ArcState, f: OverlayDraw): void {
    const a = st.a;
    const draw = clamp(st.draw);
    const alpha = st.alpha * clamp(Number.isFinite(a.alpha) ? (a.alpha as number) : 1);
    if (draw <= 0.001 || alpha <= 0.003) return;
    const col = paletteFor(a.tone).rgb;
    const hM = Math.max(0, Number.isFinite(a.h) ? a.h : 0) * 1000;
    const dlng = shortestArc(a.from.lng, a.to.lng);
    const at = (u: number): boolean => {
      const lat = a.from.lat + (a.to.lat - a.from.lat) * u;
      const lng = a.from.lng + dlng * u;
      llhToEcef(lat, lng, Math.sin(Math.PI * u) * hM, this.p);
      return P.project(this.p[0], this.p[1], this.p[2], this.s);
    };
    const xs: number[] = [];
    const ys: number[] = [];
    const breaks: boolean[] = [];
    let prevOk = false;
    for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
      const ok = at((i / ARC_SEGMENTS) * draw);
      if (ok) {
        xs.push(this.s[0]);
        ys.push(this.s[1]);
        breaks.push(!prevOk);
      }
      prevOk = ok;
    }
    if (xs.length >= 2) {
      const width = Number.isFinite(a.width) && (a.width as number) > 0 ? (a.width as number) : 1.3;
      const dash = Array.isArray(a.dash) && a.dash.length === 2 && a.dash.every((v) => Number.isFinite(v) && v >= 0)
        ? a.dash
        : null;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [w, al] of [[6, 0.1], [2.6, 0.28], [width, 1]] as const) {
        ctx.beginPath();
        for (let i = 0; i < xs.length; i += 1) {
          if (breaks[i]) ctx.moveTo(xs[i], ys[i]);
          else ctx.lineTo(xs[i], ys[i]);
        }
        ctx.setLineDash(dash ? [dash[0], dash[1]] : []);
        ctx.strokeStyle = rgba(col, alpha * al);
        ctx.lineWidth = w;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
    }
    // partículas em fluxo
    const flow = Number.isFinite(a.flow) ? (a.flow as number) : 0;
    if (flow > 0 && !f.reducedMotion) {
      for (let k = 0; k < PARTICLES; k += 1) {
        const u = ((((f.t * flow + k / PARTICLES) % 1) + 1) % 1) * draw;
        if (!at(u)) continue;
        const x = this.s[0];
        const y = this.s[1];
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, rgba(WHITE, 0.95 * alpha));
        g.addColorStop(0.35, rgba(col, 0.6 * alpha));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        this.motion = true;
      }
    }
  }
}

function rank(st: MarkerState, hoverId: string | null): number {
  if (st.m.id === hoverId) return 3;
  if (st.m.selected) return 2;
  if (st.m.tone === 'critical') return 1;
  return 0;
}
