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
import type { GlobeArc, GlobeMarker, GlobeNode, GlobeScan, GlobeTone, ScanPhase, TwinSpec } from './contract';
import { approach, clamp, DEG, invLerp, shortestArc } from './camera';
import { HEX_SIZE, hexSprite, paletteFor, rgba, type Rgb } from './markers';
import type { LabelSpec } from './labels';
import { TwinModel, twinGeometryKey, type CardPlacement, type TwinPlaceInput, type TwinScreenPoint } from './twin/draw';

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
  /** A câmera do quadro em ECEF (m) — teste de face do modelo esquemático. */
  readonly cam = { x: 0, y: 0, z: 0 };
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
    this.cam.x = cam.x;
    this.cam.y = cam.y;
    this.cam.z = cam.z;
    this.cvx = cam.x / WGS84_A;
    this.cvy = cam.y / WGS84_A;
    this.cvz = cam.z / WGS84_B;
    this.vhMagSq = this.cvx * this.cvx + this.cvy * this.cvy + this.cvz * this.cvz - 1;
    this.ok = ok && Number.isFinite(this.vhMagSq);
  }

  /** Visível? (no ponto `out[0..1]` ficam x, y em px CSS; em `out[2]`, se houver, a profundidade w). */
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
    if (out.length > 2) out[2] = cw;
    return true;
  }
}

/* ── Varredura da rede ("Analisar a rede de estoque", cena 3 do filme) ─── */

/**
 * Tempos da varredura (s), a partir de `s3-material.js:196-222`: três anéis
 * a 0,45 s um do outro, 1,6 s cada (saída cúbica); cada nó é ALCANÇADO quando
 * o primeiro anel cruza a distância dele; o cartão entra 0,2 s antes; a
 * resposta vira 0,55 s depois do alcance E quando o servidor já respondeu;
 * os vazios se aquietam 0,9 s depois (0,6 s); "pronto" 0,6 s após a última
 * resposta (nunca antes do fim dos anéis).
 */
export const SCAN_T = Object.freeze({
  rings: 3,
  gap: 0.45,
  ringDur: 1.6,
  answerDelay: 0.55,
  cardLead: 0.2,
  cardFade: 0.4,
  arcDraw: 0.6,
  quietDelay: 0.9,
  quietDur: 0.6,
  doneHold: 0.6,
  statusOut: 0.8,
  /** O relógio da varredura começa quando o voo de recuo passa desta fração (ou pousa). */
  startArrive: 0.85,
});

/** Fim do último anel (s). */
export const SCAN_RINGS_END = (SCAN_T.rings - 1) * SCAN_T.gap + SCAN_T.ringDur;

/** Rampa linear 0..1 de `start` por `dur` s. */
export const prog = (t: number, start: number, dur: number): number =>
  Number.isFinite(t) ? clamp(dur > 0 ? (t - start) / dur : t >= start ? 1 : 0) : 0;

/** Saída cúbica (o crescimento dos anéis). */
export const outCubic = (u: number): number => 1 - (1 - clamp(u)) ** 3;

/** Instante (s) em que o 1º anel cruza `dKm` num alcance `R` km (inverso de `outCubic`). */
export function scanReachTime(dKm: number, R: number): number {
  if (!(R > 0) || !Number.isFinite(dKm)) return SCAN_T.ringDur;
  const f = clamp(dKm / R);
  return SCAN_T.ringDur * (1 - Math.cbrt(1 - f));
}

/** Os anéis vivos em `st` s: raio (km) e opacidade. */
export function scanRings(st: number, R: number): Array<{ r: number; alpha: number }> {
  const out: Array<{ r: number; alpha: number }> = [];
  if (!(R > 0) || !Number.isFinite(st)) return out;
  for (let k = 0; k < SCAN_T.rings; k += 1) {
    const u = (st - k * SCAN_T.gap) / SCAN_T.ringDur;
    if (u > 0 && u < 1) out.push({ r: R * outCubic(u), alpha: (1 - u) * 0.55 });
  }
  return out;
}

/** A fase da varredura em `st` s dado quando cada nó respondeu (`null` = ainda consultando). */
export function scanPhaseOf(st: number, answeredAt: Array<number | null>, reduced = false): ScanPhase | null {
  if (!Number.isFinite(st) || st < 0) return null;
  const all = answeredAt.every((a) => a !== null);
  const any = answeredAt.some((a) => a !== null);
  if (reduced) return all ? 'done' : 'answering';
  const last = answeredAt.reduce<number>((m, a) => (a !== null && a > m ? a : m), 0);
  if (all && st >= Math.max(SCAN_RINGS_END, last + SCAN_T.doneHold)) return 'done';
  if (any || st >= SCAN_T.ringDur) return 'answering';
  return 'rings';
}

/** Ponto a `km` do ponto de partida no rumo `bearingDeg` (grande círculo, esfera de 6371 km). */
export function destinationPoint(lat: number, lng: number, bearingDeg: number, km: number): { lat: number; lng: number } {
  const d = km / 6371;
  const p1 = lat * DEG;
  const l1 = lng * DEG;
  const th = bearingDeg * DEG;
  const sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th);
  const p2 = Math.asin(clamp(sp2, -1, 1));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lng: ((((l2 / DEG) + 540) % 360) - 180) };
}

/** Distância de grande círculo (km). */
export function greatCircleKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

const sameLatLng = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(shortestArc(a.lng, b.lng)) < 1e-6;

/** O nó da varredura de um arco: mesmo id, ou uma ponta do arco no nó. */
export function scanNodeForArc(arc: GlobeArc, nodes: ReadonlyArray<{ id: string; lat: number; lng: number }>, results: GlobeScan['results']): string | null {
  if (Object.prototype.hasOwnProperty.call(results, arc.id) && nodes.some((n) => n.id === arc.id)) return arc.id;
  for (const n of nodes) {
    if (!Object.prototype.hasOwnProperty.call(results, n.id)) continue;
    if (sameLatLng(arc.from, n) || sameLatLng(arc.to, n)) return n.id;
  }
  return null;
}

interface ScanRun {
  scan: GlobeScan;
  /** Início do relógio (relógio do laço, s); `null` = esperando o voo de recuo. */
  t0: number | null;
  answered: Map<string, number>;
  doneAt: number | null;
  phase: ScanPhase | null;
}

interface ScanNodeVis {
  reveal: number;
  answered: boolean;
  quiet: number;
  tone: 'hit' | 'none' | null;
  value: string;
  reachT: number;
}

interface TwinState {
  model: TwinModel;
  spec: TwinSpec;
  alpha: number;
  present: boolean;
}

/** Onde o motor põe os hotspots do modelo (DOM) neste quadro. */
export interface TwinOverlayOut {
  spec: TwinSpec;
  alpha: number;
  hotspots: TwinScreenPoint[];
  /** O lugar de cada cartão, já dentro da área livre (`placeCards`). */
  cards: Map<string, CardPlacement>;
  note: TwinScreenPoint | null;
}

/** Opacidade dos marcadores de CONTEXTO (outros projetos) enquanto um módulo põe nós no mapa. */
export const CONTEXT_MARKER_ALPHA = 0.35;

/* ── Área livre do HUD (onde cartões e rótulos podem ficar) ─────────────── */

/** Sem área declarada pela página: a margem mínima do palco (px). */
export const STAGE_MARGIN = 12;

type Box = { l: number; t: number; r: number; b: number };

/** `--ag-free` ("l t r b", px do palco) → retângulo dentro do palco; `null` se não for utilizável. */
export function parseFreeRect(raw: string | null | undefined, W: number, H: number): Box | null {
  if (typeof raw !== 'string' || !(W > 0) || !(H > 0)) return null;
  const n = raw.trim().replace(/^["']|["']$/g, '').split(/[\s,]+/).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const r = { l: Math.max(0, n[0]), t: Math.max(0, n[1]), r: Math.min(W, n[2]), b: Math.min(H, n[3]) };
  return r.r - r.l >= 40 && r.b - r.t >= 40 ? r : null;
}

/**
 * A área livre do quadro: a declarada pela página (ou o palco menos a margem),
 * sem a linha de atribuição das imagens quando ela cruza a área (a Esri exige o
 * crédito visível: nada por cima dele).
 */
export function effectiveFree(declared: Box | null, W: number, H: number, credits: Box | null): Box {
  let f: Box = declared ?? { l: STAGE_MARGIN, t: STAGE_MARGIN, r: W - STAGE_MARGIN, b: H - STAGE_MARGIN };
  if (credits && credits.r > credits.l && credits.b > credits.t && credits.l < f.r && credits.r > f.l && credits.t - 6 < f.b) {
    f = { ...f, b: Math.max(f.t + 40, credits.t - 6) };
  }
  return f;
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
  /** Há voo em curso / fração do voo (a varredura começa com o recuo quase pousado). */
  flying?: boolean;
  arrive?: number;
  /** Área livre do HUD e tamanhos dos cartões do modelo (o motor mede). */
  twinPlace?: TwinPlaceInput | null;
}

const QUIET_BORDER: Rgb = [220, 235, 245];
const CYAN: Rgb = [125, 235, 255];
/** Até esta distância (km) do centro do modelo, o hexágono em foco encolhe quando o modelo aparece. */
const TWIN_SHRINK_M = 250;
/**
 * O modelo aparece de 7,5 km para dentro e fica INTEIRO até 4 km (opacidade
 * (7,5 − d)/3,5): o Planejar, numa tela baixa, recua até ~3,4 km para caber
 * acima do Gantt e o modelo não pode lavar.
 */
export const twinDistanceAlpha = (distKm: number): number => (Number.isFinite(distKm) ? clamp((7.5 - distKm) / 3.5) : 0);
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
  private scanRun: ScanRun | null = null;
  private readonly scanVis = new Map<string, ScanNodeVis>();
  private twin: TwinState | null = null;
  private readonly emphasis = new Map<string, number>();
  private readonly p3 = new Float64Array(3);
  /** O último quadro desenhou pulso ou partícula visível. */
  motion = false;
  /** Fase da varredura calculada no último quadro (o motor avisa a página). */
  scanPhase: { id: string; phase: ScanPhase } | null = null;
  /** Hotspots/rótulo do modelo no último quadro (o motor posiciona o DOM). */
  twinOut: TwinOverlayOut | null = null;

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

  /** A varredura da camada (id novo = relógio novo; mesmo id = só as respostas mudam). */
  syncScan(scan: GlobeScan | null | undefined): void {
    const ok = scan && typeof scan.id === 'string' && scan.id && scan.origin && validLatLng(scan.origin.lat, scan.origin.lng) &&
      scan.results && typeof scan.results === 'object';
    if (!ok) {
      this.scanRun = null;
      this.scanVis.clear();
      this.scanPhase = null;
      return;
    }
    if (this.scanRun && this.scanRun.scan.id === scan.id) {
      this.scanRun.scan = scan;
      return;
    }
    this.scanRun = { scan, t0: null, answered: new Map(), doneAt: null, phase: null };
    this.scanVis.clear();
    this.scanPhase = null;
  }

  /** Há varredura com este id (o motor força o voo de recuo numa varredura nova). */
  scanId(): string | null {
    return this.scanRun?.scan.id ?? null;
  }

  /** O modelo esquemático (geometria remontada só quando tipo/âncora/rumo mudam). */
  syncTwin(spec: TwinSpec | null | undefined): void {
    const valid = spec && spec.anchor && validLatLng(spec.anchor.lat, spec.anchor.lng) && Array.isArray(spec.hotspots);
    if (!valid) {
      if (this.twin) this.twin.present = false;
      return;
    }
    const key = twinGeometryKey(spec);
    if (!this.twin || this.twin.model.key !== key) {
      const alpha = this.twin && this.twin.present ? this.twin.alpha : 0;
      this.twin = { model: new TwinModel(spec), spec, alpha, present: true };
      return;
    }
    this.twin.spec = spec;
    this.twin.present = true;
  }

  /** O centro do modelo (ECEF) e a opacidade atual — para o motor decidir o que encolher. */
  twinAnchor(): { ecef: readonly number[]; alpha: number } | null {
    return this.twin ? { ecef: this.twin.model.anchorEcef, alpha: this.twin.alpha } : null;
  }

  /** A spec que o modelo desenha neste quadro (inclusive saindo com fade) — o motor mede os cartões dela. */
  twinSpec(): TwinSpec | null {
    return this.twin?.spec ?? null;
  }

  /** Os marcadores na tela no último quadro (px do palco) — QA em desenvolvimento. */
  screenMarks(): ScreenMark[] {
    return this.marks.map((m) => ({ ...m }));
  }

  /** Algum nó (cartão de dado) de uma camada está no mapa. */
  private hasNodes(): boolean {
    for (const ns of this.nodes.values()) if (ns.present || ns.alpha > EPS) return true;
    return false;
  }

  /** Um hotspot sem destino foi clicado: o halo dele pulsa por ~2 s. */
  emphasize(id: string): void {
    this.emphasis.set(id, 1);
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
    if (this.twin) {
      const tw = this.twin;
      const target = tw.present ? 1 : 0;
      tw.alpha = approach(tw.alpha, target, dt, f.reducedMotion ? 25 : 3);
      if (!tw.present && tw.alpha < EPS) this.twin = null;
      else if (!settled(tw.alpha, target)) moving = true;
      else tw.alpha = target;
    }
    for (const [id, k] of this.emphasis) {
      const next = k - dt / 2;
      if (next <= 0) this.emphasis.delete(id);
      else {
        this.emphasis.set(id, next);
        moving = true;
      }
    }
    return moving;
  }

  /**
   * O quadro da varredura: relógio, alcance e resposta de cada nó, fase.
   * Devolve `st` (s desde o início; −1 = ainda não começou).
   */
  private scanFrame(f: OverlayDraw): number {
    const run = this.scanRun;
    this.scanVis.clear();
    if (!run) {
      this.scanPhase = null;
      return -1;
    }
    const flying = Boolean(f.flying);
    const arrive = Number.isFinite(f.arrive) ? (f.arrive as number) : 1;
    if (run.t0 === null && (!flying || arrive >= SCAN_T.startArrive || f.reducedMotion)) run.t0 = f.t;
    const st = run.t0 === null ? -1 : f.t - run.t0;
    const scan = run.scan;
    const R = Number.isFinite(scan.radiusKm) && scan.radiusKm > 0 ? scan.radiusKm : 0;
    const pending = typeof scan.pendingText === 'string' && scan.pendingText ? scan.pendingText : 'consultando…';
    const answeredAt: Array<number | null> = [];
    let settleUntil = SCAN_RINGS_END;
    for (const [id, ns] of this.nodes) {
      if (!ns.present || !Object.prototype.hasOwnProperty.call(scan.results, id)) continue;
      const res = scan.results[id];
      const reachT = f.reducedMotion ? 0 : scanReachTime(greatCircleKm(scan.origin, ns.n), R);
      let at = run.answered.get(id) ?? null;
      if (at === null && res && st >= 0 && (f.reducedMotion || st >= reachT + SCAN_T.answerDelay)) {
        at = st;
        run.answered.set(id, at);
      }
      answeredAt.push(at);
      const tone = res && at !== null ? (res.tone === 'hit' ? 'hit' : 'none') : null;
      const quiet = tone === 'none' && at !== null ? (f.reducedMotion ? 1 : prog(st, at + SCAN_T.quietDelay, SCAN_T.quietDur)) : 0;
      if (at !== null) settleUntil = Math.max(settleUntil, at + SCAN_T.quietDelay + SCAN_T.quietDur + 0.05);
      this.scanVis.set(id, {
        reveal: st < 0 ? 0 : f.reducedMotion ? 1 : prog(st, reachT - SCAN_T.cardLead, SCAN_T.cardFade),
        answered: at !== null,
        quiet,
        tone,
        value: at !== null && res ? res.value : pending,
        reachT,
      });
    }
    const phase = scanPhaseOf(st, answeredAt, f.reducedMotion);
    if (phase === 'done' && run.doneAt === null) run.doneAt = st;
    run.phase = phase;
    this.scanPhase = phase ? { id: scan.id, phase } : null;
    const statusEnd = run.doneAt !== null ? run.doneAt + SCAN_T.statusOut + 0.5 : Infinity;
    if (st < 0 || phase !== 'done' || st < Math.max(settleUntil, statusEnd)) this.motion = true;
    return st;
  }

  /** Os anéis no chão: grandes círculos de 72 segmentos a partir do local. */
  private drawScanRings(ctx: CanvasRenderingContext2D, P: Projector, st: number, reduced: boolean): void {
    const run = this.scanRun;
    if (!run || st < 0 || reduced) return;
    const { origin, radiusKm } = run.scan;
    for (const ring of scanRings(st, radiusKm)) {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= 72; i += 1) {
        const q = destinationPoint(origin.lat, origin.lng, (i / 72) * 360, ring.r);
        llhToEcef(q.lat, q.lng, 0, this.p);
        if (P.project(this.p[0], this.p[1], this.p[2], this.s)) {
          if (pen) ctx.lineTo(this.s[0], this.s[1]);
          else ctx.moveTo(this.s[0], this.s[1]);
          pen = true;
        } else pen = false;
      }
      ctx.strokeStyle = rgba(CYAN, ring.alpha);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  /** A linha de status da varredura, presa ao local. */
  private scanStatus(P: Projector, st: number, labels: LabelSpec[]): void {
    const run = this.scanRun;
    const text = run?.scan.statusText;
    if (!run || typeof text !== 'string' || !text) return;
    llhToEcef(run.scan.origin.lat, run.scan.origin.lng, 0, this.p);
    const visible = P.project(this.p[0], this.p[1], this.p[2], this.s);
    const fadeIn = st < 0 ? 0 : prog(st, 0, 0.4);
    const out = run.doneAt !== null ? prog(st, run.doneAt + SCAN_T.statusOut, 0.5) : 0;
    labels.push({ id: 's:scan', kind: 'status', title: text, x: this.s[0], y: this.s[1] + 44, alpha: visible ? fadeIn * (1 - out) : 0 });
  }

  /** Desenha o quadro e devolve os rótulos a posicionar. */
  draw(ctx: CanvasRenderingContext2D, P: Projector, f: OverlayDraw): LabelSpec[] {
    const labels: LabelSpec[] = [];
    this.marks.length = 0;
    this.motion = false;
    this.twinOut = null;
    if (!P.ok) {
      for (const st of this.markers.values()) st.visible = false;
      return labels;
    }
    const dist = Number.isFinite(f.dist) ? f.dist : 1e4;
    const scanT = this.scanFrame(f);

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

    // 1b · varredura: anéis no chão a partir do local
    this.drawScanRings(ctx, P, scanT, f.reducedMotion);

    // 1c · o modelo esquemático da obra (só perto do chão)
    const tw = this.twin;
    const twinVis = tw ? tw.alpha * twinDistanceAlpha(dist) : 0;
    if (tw && twinVis > 0.003) {
      const res = tw.model.draw(ctx, P, P.cam, {
        alpha: twinVis, t: f.t, reducedMotion: f.reducedMotion, spec: tw.spec, emphasis: this.emphasis, place: f.twinPlace ?? null,
      });
      if (res.motion) this.motion = true;
      this.twinOut = { spec: tw.spec, alpha: twinVis, hotspots: res.hotspots, cards: res.cards, note: res.note };
    } else if (tw) {
      this.twinOut = { spec: tw.spec, alpha: 0, hotspots: [], cards: new Map(), note: null };
    }

    // 1d · com nós de uma camada no mapa (Supply), os OUTROS projetos são contexto:
    // esmaecidos e POR BAIXO dos nós — o arco e a resposta nunca parecem de outro projeto
    const layered = this.hasNodes();
    const anchor = tw && twinVis > 0.003 ? tw.model.anchorEcef : null;
    const ordered = Array.from(this.markers.values()).sort((a, b) => rank(a, f.hoverId) - rank(b, f.hoverId));
    const isContext = (st: MarkerState) => layered && !st.m.selected && st.m.id !== f.hoverId;
    if (layered) {
      for (const st of ordered) if (isContext(st)) this.drawMarker(ctx, P, st, f, anchor, twinVis, labels, CONTEXT_MARKER_ALPHA);
    }

    // 2 · arcos (os da varredura seguem o alcance dos anéis e a resposta do nó)
    const scanNodes = this.scanRun ? this.scanNodeList() : [];
    for (const arc of this.arcs.values()) {
      const nid = this.scanRun ? scanNodeForArc(arc.a, scanNodes, this.scanRun.scan.results) : null;
      const vis = nid ? this.scanVis.get(nid) : undefined;
      if (!nid || !vis) {
        this.drawArc(ctx, P, arc, f);
        continue;
      }
      if (scanT < 0) continue;
      const hit = vis.answered && vis.tone === 'hit';
      this.drawArc(ctx, P, arc, f, {
        draw: f.reducedMotion ? 1 : prog(scanT, vis.reachT, SCAN_T.arcDraw),
        alpha: vis.answered ? (hit ? 0.95 : 0.6 * (1 - vis.quiet * 0.85)) : 0.6,
        width: hit ? 2 : 1.3,
        tone: hit ? 'completed' : 'healthy',
        flow: hit ? Math.max(Number.isFinite(arc.a.flow) ? (arc.a.flow as number) : 0, 0.35) : 0,
      });
    }

    // 3 · cartões (âncora pequena) — o rótulo DOM vem depois
    for (const [id, ns] of this.nodes) {
      const vis = this.scanVis.get(id);
      const a = ns.alpha * (vis ? vis.reveal * (1 - vis.quiet * 0.5) : 1);
      const tone = vis ? (vis.answered && vis.tone ? vis.tone : 'default') : ns.n.tone ?? 'default';
      const visible = a > 0.003 && P.project(ns.ecef[0], ns.ecef[1], ns.ecef[2], this.s);
      if (visible) {
        const spriteTone: GlobeTone = tone === 'hit' ? 'completed' : 'healthy';
        const size = tone === 'hit' ? 46 : tone === 'none' ? 36 : 40;
        if (vis && tone === 'hit' && !f.reducedMotion) {
          // o nó que respondeu pulsa (a "resposta" do filme)
          for (let k = 0; k < 2; k += 1) {
            const u = (((f.t * 0.7 + k * 0.5) % 1) + 1) % 1;
            ctx.beginPath();
            ctx.arc(this.s[0], this.s[1], 12 + u * 44, 0, Math.PI * 2);
            ctx.strokeStyle = rgba(paletteFor('completed').rgb, (1 - u) * 0.5 * a);
            ctx.lineWidth = 1.3;
            ctx.stroke();
          }
          this.motion = true;
        }
        this.drawHex(ctx, this.s[0], this.s[1], spriteTone, Boolean(vis && tone === 'hit'), size, a * (tone === 'none' ? 0.6 : 1));
      }
      labels.push({
        id: `n:${id}`,
        kind: 'node',
        title: ns.n.title,
        value: vis ? vis.value : ns.n.value ?? null,
        tone,
        state: vis ? (vis.answered ? 'answer' : 'pending') : undefined,
        x: this.s[0] + 18,
        y: this.s[1],
        alpha: visible ? a * (vis ? 1 : ns.reveal) : 0,
      });
    }

    // 4 · marcadores: comuns primeiro, destacados por cima (o contexto já foi, por baixo dos nós)
    for (const st of ordered) if (!isContext(st)) this.drawMarker(ctx, P, st, f, anchor, twinVis, labels, 1);

    // 5 · a linha de status da varredura
    this.scanStatus(P, scanT, labels);
    return labels;
  }

  /** Um marcador (pulso, hexágono, alvo do clique) e o rótulo dele; `k` esmaece o contexto. */
  private drawMarker(
    ctx: CanvasRenderingContext2D,
    P: Projector,
    st: MarkerState,
    f: OverlayDraw,
    anchor: readonly number[] | null,
    twinVis: number,
    labels: LabelSpec[],
    k: number,
  ): void {
    const m = st.m;
    const hovered = f.hoverId === m.id;
    st.visible = st.alpha > 0.003 && P.project(st.ecef[0], st.ecef[1], st.ecef[2], this.s);
    // com o modelo à vista, o hexágono do local encolhe (o modelo passa a ser o "marcador")
    const onTwin = anchor !== null && Boolean(m.selected) &&
      Math.hypot(st.ecef[0] - anchor[0], st.ecef[1] - anchor[1], st.ecef[2] - anchor[2]) < TWIN_SHRINK_M;
    const shrink = onTwin ? 1 - 0.5 * twinVis : 1;
    const alpha = st.alpha * k;
    if (st.visible) {
      st.sx = this.s[0];
      st.sy = this.s[1];
      const pulse = clamp(Number.isFinite(m.pulse) ? (m.pulse as number) : 0) * (onTwin ? 1 - 0.8 * twinVis : 1);
      if (pulse > 0 && !f.reducedMotion) {
        const col = paletteFor(m.tone).rgb;
        for (let i = 0; i < 2; i += 1) {
          const u = (((f.t * 0.7 + i * 0.5) % 1) + 1) % 1;
          ctx.beginPath();
          ctx.arc(st.sx, st.sy, 14 + u * 60, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(col, (1 - u) * 0.6 * alpha * pulse);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        this.motion = true;
      }
      const selected = Boolean(m.selected) || hovered;
      const base = Number.isFinite(m.size) && (m.size as number) > 0
        ? clamp(m.size as number, 8, 120)
        : m.selected ? HEX_SIZE.selectedDefault : HEX_SIZE.normal;
      const size = (hovered ? Math.max(base, HEX_SIZE.hover) : base) * shrink;
      this.drawHex(ctx, st.sx, st.sy, m.tone, selected, size, alpha);
      if (st.alpha > 0.5) this.marks.push({ id: m.id, x: st.sx, y: st.sy });
    }
    const showLabel = Boolean(m.showLabel || m.selected || hovered) && typeof m.label === 'string' && m.label.length > 0;
    labels.push({
      id: `m:${m.id}`,
      kind: 'tag',
      title: m.label ?? '',
      x: st.sx + 26 * shrink,
      y: st.sy,
      // com o modelo à vista o nome sai do mapa (o painel do local já o diz; os hotspots ficam legíveis)
      alpha: st.visible && showLabel ? alpha * (onTwin ? 1 - twinVis : 1) : 0,
    });
  }

  /** Os nós presentes que fazem parte da varredura. */
  private scanNodeList(): Array<{ id: string; lat: number; lng: number }> {
    const out: Array<{ id: string; lat: number; lng: number }> = [];
    for (const [id, ns] of this.nodes) if (ns.present && this.scanVis.has(id)) out.push({ id, lat: ns.n.lat, lng: ns.n.lng });
    return out;
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
  private drawArc(ctx: CanvasRenderingContext2D, P: Projector, st: ArcState, f: OverlayDraw, over?: {
    draw: number; alpha: number; width: number; tone: GlobeTone; flow: number;
  }): void {
    const a = over ? { ...st.a, alpha: over.alpha, width: over.width, tone: over.tone, flow: over.flow } : st.a;
    const draw = clamp(over ? over.draw : st.draw);
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
