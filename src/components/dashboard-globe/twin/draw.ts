/**
 * O DESENHO DO MODELO ESQUEMÁTICO — o gêmeo do filme no overlay 2D projetado.
 *
 * Portes de `APEX FILM/js/world/site.js`: `obox` (caixa orientada com faces de
 * trás descartadas, tampa mais clara), `cylinder` (anéis + silhueta, raio-x),
 * `person` (pé → cabeça, brilho quando na frente), `halo` (anel no chão com
 * degradê) e o anel de avanço no estilo do enrolamento da UG-05 (três traços +
 * brilho na ponta). Ordenação do pintor pela profundidade de cada peça.
 *
 * Gramática de raio-x: tudo translúcido sobre a imagem de satélite; o grupo da
 * frente de trabalho acende no tom da saúde; o resto fica em linha fria.
 * Geometria em ECEF calculada UMA vez por spec (`key`); por quadro só projeção.
 */
import type { GlobeTone, TwinSpec } from '../contract';
import { clamp, ecefOf, enuAt, type Vec3 } from '../camera';
import { rgba, type Rgb } from '../markers';
import { buildLayout, groupFrame, type P3, type TwinLayout, type TwinPrim } from './layouts';

const EARTH_R = 6_371_000;
const CYL_SEG = 24;
const RING_SEG = 64;
const MAX_PEOPLE = 24;

const COL = {
  line: [214, 226, 236],
  dim: [148, 163, 184],
  teal: [45, 212, 191],
  tealDeep: [20, 184, 166],
  cyan: [125, 235, 255],
  amber: [245, 165, 36],
  red: [239, 75, 85],
  green: [16, 185, 129],
  face: [10, 18, 24],
  top: [24, 38, 48],
  warm: [255, 244, 222],
  water: [40, 110, 160],
  panel: [26, 52, 96],
} as const satisfies Record<string, Rgb>;

/** Cor da frente de trabalho pela saúde (sem leitura = neutro, nunca "em dia"). */
export function twinToneColor(tone: GlobeTone | null | undefined): Rgb {
  switch (tone) {
    case 'attention':
      return COL.amber;
    case 'critical':
      return COL.red;
    case 'completed':
      return COL.green;
    case 'unknown':
      return COL.dim;
    default:
      return COL.teal;
  }
}

/** Projeção do overlay: `out[0..1]` = x, y (px CSS), `out[2]` = profundidade (w). */
export interface TwinProjector {
  readonly ok: boolean;
  project(x: number, y: number, z: number, out: Float64Array): boolean;
}

export interface TwinScreenPoint {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

/** Retângulo em px do palco (esquerda, topo, direita, base). */
export interface ScreenRect { l: number; t: number; r: number; b: number }

/** Tamanho medido (px) de um cartão DOM. */
export interface CardSize { w: number; h: number }

/**
 * Onde os cartões podem ficar neste quadro: a área livre do HUD (nada atrás
 * de painel, dock, Gantt ou créditos) e o tamanho REAL de cada cartão.
 */
export interface TwinPlaceInput {
  free: ScreenRect;
  sizes: ReadonlyMap<string, CardSize>;
  note: CardSize | null;
}

export interface TwinDrawResult {
  /** O ponto do losango de cada cartão (x, y) e se ele aparece. */
  hotspots: TwinScreenPoint[];
  /** O lugar de cada cartão (canto, lado, ponto real × ponto do cartão). */
  cards: Map<string, CardPlacement>;
  /** O rótulo obrigatório: canto superior esquerdo (x, y) e se aparece. */
  note: TwinScreenPoint | null;
  /** Algo do modelo se move (equipe, ênfase de hotspot). */
  motion: boolean;
}

interface Built {
  p: TwinPrim;
  focus: boolean;
  fresh: boolean;
  /** Vértices em ECEF (x, y, z…). */
  v: Float64Array;
  /** Tela: x, y por vértice; `ok` por vértice. */
  s: Float64Array;
  ok: Uint8Array;
  /** Centro local (m) e em ECEF. */
  lc: P3;
  ec: Float64Array;
  depth: number;
  /** Caixa: normais e centros locais das faces [topo, lado0..3]. */
  faces?: Array<{ n: P3; c: P3; idx: number[]; top: boolean }>;
}

interface Person {
  ang: number;
  rad: number;
  ph: number;
  sp: number;
}

/** Semente determinística (o mesmo local desenha a mesma equipe). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIM_PTS = (p: TwinPrim): P3[] => {
  switch (p.t) {
    case 'box':
      return [...p.q.map((q): P3 => [q[0], q[1], p.z0]), ...p.q.map((q): P3 => [q[0], q[1], p.z0 + p.h])];
    case 'cyl': {
      const out: P3[] = [];
      for (const z of [p.z0, p.z1]) {
        for (let i = 0; i < CYL_SEG; i += 1) {
          const a = (i / CYL_SEG) * Math.PI * 2;
          out.push([p.c[0] + Math.cos(a) * p.r, p.c[1] + Math.sin(a) * p.r, z]);
        }
      }
      return out;
    }
    case 'line':
    case 'quad':
      return p.pts;
    case 'area':
      return p.pts.map((q): P3 => [q[0], q[1], 0.05]);
    default:
      return [];
  }
};

/**
 * Um modelo montado para uma spec (âncora + rumo + tipo). Recriado quando a
 * `key`, a âncora ou o rumo mudam; o resto da spec é lido a cada quadro.
 */
export class TwinModel {
  readonly key: string;
  readonly layout: TwinLayout;
  /** Âncora em ECEF (para o encolhimento do hexágono em foco). */
  readonly anchorEcef: Vec3;
  private readonly O: Vec3;
  private readonly X: Vec3;
  private readonly Y: Vec3;
  private readonly U: Vec3;
  private readonly built: Built[];
  private readonly order: number[];
  private readonly people: Person[];
  private readonly tmp = new Float64Array(3);
  private readonly scr = new Float64Array(3);
  private focusKey = '';
  /** O projetor do quadro corrente. */
  private lastP: TwinProjector | null = null;
  /** O candidato escolhido por cartão no quadro anterior (histerese: nada pisca com a respiração). */
  private readonly picks = new Map<string, number>();

  constructor(readonly spec: TwinSpec) {
    this.key = twinGeometryKey(spec);
    this.layout = buildLayout(spec.kind);
    this.O = ecefOf(spec.anchor.lat, spec.anchor.lng, 0);
    this.anchorEcef = this.O;
    const { e, n, u } = enuAt(spec.anchor.lat, spec.anchor.lng);
    const A = (Number.isFinite(spec.azimuthDeg) ? spec.azimuthDeg : 0) * (Math.PI / 180);
    const sa = Math.sin(A);
    const ca = Math.cos(A);
    this.X = [e[0] * sa + n[0] * ca, e[1] * sa + n[1] * ca, e[2] * sa + n[2] * ca];
    this.Y = [-e[0] * ca + n[0] * sa, -e[1] * ca + n[1] * sa, -e[2] * ca + n[2] * sa];
    this.U = u;
    this.built = this.layout.prims.map((p) => this.build(p));
    this.order = this.built.map((_, i) => i);
    const r = rng(hashSeed(spec.key || 'twin'));
    this.people = Array.from({ length: MAX_PEOPLE }, () => ({ ang: r() * Math.PI * 2, rad: 0.55 + r() * 0.45, ph: r() * Math.PI * 2, sp: 0.35 + r() * 0.4 }));
  }

  /** Local (m do layout) → ECEF (m): escala esquemática + queda da curvatura. */
  toEcef(xIn: number, yIn: number, zIn: number, out: Float64Array | number[], o = 0): void {
    const k = this.layout.scale;
    const x = xIn * k;
    const y = yIn * k;
    const drop = (x * x + y * y) / (2 * EARTH_R);
    const h = zIn * k - drop;
    out[o] = this.O[0] + this.X[0] * x + this.Y[0] * y + this.U[0] * h;
    out[o + 1] = this.O[1] + this.X[1] * x + this.Y[1] * y + this.U[1] * h;
    out[o + 2] = this.O[2] + this.X[2] * x + this.Y[2] * y + this.U[2] * h;
  }

  /** ECEF → local (m do layout) — para o teste de face e a posição da câmera. */
  toLocal(p: { x: number; y: number; z: number }): P3 {
    const d: Vec3 = [p.x - this.O[0], p.y - this.O[1], p.z - this.O[2]];
    const k = this.layout.scale || 1;
    const dot = (a: Vec3) => (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / k;
    return [dot(this.X), dot(this.Y), dot(this.U)];
  }

  private build(p: TwinPrim): Built {
    const pts = PRIM_PTS(p);
    const v = new Float64Array(pts.length * 3);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    pts.forEach(([x, y, z], i) => {
      this.toEcef(x, y, z, v, i * 3);
      cx += x;
      cy += y;
      cz += z;
    });
    const n = Math.max(1, pts.length);
    const lc: P3 = [cx / n, cy / n, cz / n];
    const ec = new Float64Array(3);
    this.toEcef(lc[0], lc[1], lc[2], ec);
    const b: Built = {
      p, focus: false, fresh: false, v, s: new Float64Array(pts.length * 2), ok: new Uint8Array(pts.length), lc, ec, depth: 0,
    };
    if (p.t === 'box') {
      const top = p.z0 + p.h;
      const faces: NonNullable<Built['faces']> = [{ n: [0, 0, 1], c: [lc[0], lc[1], top], idx: [4, 5, 6, 7], top: true }];
      for (let i = 0; i < 4; i += 1) {
        const a = p.q[i];
        const q = p.q[(i + 1) % 4];
        const dx = q[0] - a[0];
        const dy = q[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        // base anti-horária: a normal externa da aresta é (dy, −dx)
        faces.push({ n: [dy / len, -dx / len, 0], c: [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2, p.z0 + p.h / 2], idx: [i, (i + 1) % 4, 4 + ((i + 1) % 4), 4 + i], top: false });
      }
      b.faces = faces;
    }
    return b;
  }

  /** O quadro: desenha e devolve onde ficam os hotspots e o rótulo obrigatório. */
  draw(ctx: CanvasRenderingContext2D, P: TwinProjector, cam: { x: number; y: number; z: number }, f: {
    alpha: number;
    t: number;
    reducedMotion: boolean;
    spec: TwinSpec;
    emphasis?: ReadonlyMap<string, number>;
    /** Área livre e tamanhos medidos; ausente = sem limite e o cartão padrão. */
    place?: TwinPlaceInput | null;
  }): TwinDrawResult {
    const spec = f.spec;
    this.lastP = P;
    const a = clamp(f.alpha);
    const hidden: TwinDrawResult = {
      hotspots: spec.hotspots.map((h) => ({ id: h.id, x: 0, y: 0, visible: false })), cards: new Map(), note: null, motion: false,
    };
    if (a <= 0.003 || !P.ok) return hidden;
    const focusGroup = spec.focusGroup && this.layout.groups.includes(spec.focusGroup) ? spec.focusGroup : null;
    const fk = `${focusGroup ?? ''}|${spec.highlightNew ? 1 : 0}`;
    if (fk !== this.focusKey) {
      this.focusKey = fk;
      for (const b of this.built) {
        b.focus = focusGroup !== null && b.p.group === focusGroup;
        b.fresh = Boolean(spec.highlightNew) && 'isNew' in b.p && Boolean(b.p.isNew);
      }
    }
    const toneCol = twinToneColor(spec.tone);
    const camL = this.toLocal(cam);
    let motion = false;

    // projeção de todas as peças
    for (const b of this.built) {
      const n = b.ok.length;
      for (let i = 0; i < n; i += 1) {
        const ok = P.project(b.v[i * 3], b.v[i * 3 + 1], b.v[i * 3 + 2], this.scr);
        b.ok[i] = ok ? 1 : 0;
        b.s[i * 2] = this.scr[0];
        b.s[i * 2 + 1] = this.scr[1];
      }
      b.depth = P.project(b.ec[0], b.ec[1], b.ec[2], this.scr) ? this.scr[2] : Number.NaN;
    }

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1 · chão: pátio, cerca, canaletas, acessos, água, bases
    for (const b of this.built) if (b.p.t === 'area') this.drawArea(ctx, b, a, toneCol);

    // 2 · peças + equipe, do fundo para a frente (pintor)
    const frame = groupFrame(this.layout, focusGroup ?? this.layout.defaultFocus);
    const people = typeof spec.people === 'number' && spec.people > 0 ? Math.min(MAX_PEOPLE, Math.round(spec.people)) : 0;
    const crewR = frame ? clamp(frame.radius * 0.5, 6, 18) : 10;
    const personPts: Array<{ x: number; y: number; d: number }> = [];
    if (frame && people > 0) {
      for (let i = 0; i < people; i += 1) {
        const m = this.people[i];
        const wob = f.reducedMotion ? 0 : 1;
        const x = frame.c[0] + Math.cos(m.ang) * crewR * m.rad + Math.sin(f.t * m.sp + m.ph) * 1.2 * wob;
        const y = frame.c[1] + Math.sin(m.ang) * crewR * m.rad + Math.cos(f.t * m.sp * 0.8 + m.ph) * 1.0 * wob;
        this.toEcef(x, y, 0, this.tmp);
        const d = P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr) ? this.scr[2] : Number.NaN;
        if (Number.isFinite(d)) personPts.push({ x, y, d });
      }
      motion = motion || !f.reducedMotion;
    }
    const order = this.order;
    order.sort((i, j) => (this.built[j].depth || 0) - (this.built[i].depth || 0));
    const solids = order.filter((i) => this.built[i].p.t !== 'area' && Number.isFinite(this.built[i].depth));
    personPts.sort((p, q) => q.d - p.d);
    let pi = 0;
    for (const i of solids) {
      const b = this.built[i];
      while (pi < personPts.length && personPts[pi].d > b.depth) {
        this.person(ctx, P, personPts[pi].x, personPts[pi].y, a, true);
        pi += 1;
      }
      this.drawSolid(ctx, b, a, toneCol, camL, focusGroup !== null);
    }
    for (; pi < personPts.length; pi += 1) this.person(ctx, P, personPts[pi].x, personPts[pi].y, a, true);

    // 3 · halos (as necessidades ligadas ao seu gêmeo físico) + anel de avanço
    const emph = (id: string) => clamp(f.emphasis?.get(id) ?? 0);
    if (frame && focusGroup) {
      this.halo(ctx, P, frame.c[0], frame.c[1], clamp(frame.radius * 0.5, 8, 18), 0.55 + 0.45 * emph('workfront'), toneCol, a);
    }
    const lay = spec.hotspots.find((h) => h.role === 'laydown');
    if (lay) {
      const warn = lay.tone === 'attention' || lay.tone === 'critical';
      const k = Math.max(warn ? 0.85 : 0, emph(lay.id));
      if (k > 0) this.halo(ctx, P, this.layout.anchors.laydown[0], this.layout.anchors.laydown[1], 14, k, lay.tone === 'critical' ? COL.red : warn ? COL.amber : COL.teal, a);
    }
    for (const h of spec.hotspots) if (emph(h.id) > 0.01) motion = true;
    if (frame && typeof spec.progress === 'number' && Number.isFinite(spec.progress)) {
      this.progressRing(ctx, P, frame.c[0], frame.c[1], frame.top + 1.5, clamp(frame.radius * 0.3, 5, 12), clamp(spec.progress), toneCol, a);
    }
    ctx.restore();

    // 4 · hotspots (DOM) e o rótulo obrigatório — dentro da área livre, sem cartão por cima de cartão
    const counts = new Map<string, number>();
    const raw = spec.hotspots.map((h): TwinScreenPoint & { role: string } => {
      const k = counts.get(h.role) ?? 0;
      counts.set(h.role, k + 1);
      const at = this.anchorFor(h.role, frame, crewR);
      const ok = this.projectLocal(at[0] + k * 12, at[1], at[2]);
      return { id: h.id, role: h.role, x: this.scr[0], y: this.scr[1], visible: ok };
    });
    // o modelo está na tela quando o canto da frente (onde ficava o rótulo) projeta
    const L = this.layout.anchors.label;
    const noteOk = this.projectLocal(L[0], L[1], L[2]);
    const place = f.place ?? null;
    const free = place ? place.free : OPEN_RECT;
    // o rótulo obrigatório fica ENCAIXADO no canto inferior esquerdo da área livre (sempre legível)
    const nsz = place?.note ?? NOTE_SIZE;
    const noteW = Math.min(nsz.w, Math.max(40, free.r - free.l));
    const noteLeft = free === OPEN_RECT ? 0 : free.l;
    const noteTop = free === OPEN_RECT ? 0 : free.b - nsz.h;
    const fixed: ScreenRect[] = [];
    if (noteOk) fixed.push({ l: noteLeft, t: noteTop, r: noteLeft + noteW, b: noteTop + nsz.h });
    // o hexágono do local (no centro do modelo) nunca fica sob um cartão
    if (this.projectLocal(0, 0, 0)) fixed.push({ l: this.scr[0] - SITE_HEX_R, t: this.scr[1] - SITE_HEX_R, r: this.scr[0] + SITE_HEX_R, b: this.scr[1] + SITE_HEX_R });
    const cards = placeCards(
      raw.map((h) => {
        const sz = place?.sizes.get(h.id) ?? CARD_SIZE;
        return { id: h.id, x: h.x, y: h.y, visible: h.visible, w: sz.w, h: sz.h, prio: ROLE_PRIORITY[h.role] ?? 9 };
      }),
      free,
      fixed,
      this.picks,
    );
    this.picks.clear();
    for (const [id, c] of cards) if (c.shown) this.picks.set(id, c.pick);
    const hotspots = raw.map((h): TwinScreenPoint => {
      const c = cards.get(h.id);
      if (!c || !c.shown) return { id: h.id, x: h.x, y: h.y, visible: false };
      if (Math.hypot(c.cx - c.ax, c.cy - c.ay) > 3) this.leader(ctx, c.ax, c.ay, c.cx, c.cy, a);
      return { id: h.id, x: c.cx, y: c.cy, visible: true };
    });
    const note: TwinScreenPoint = { id: 'note', x: noteLeft, y: noteTop, visible: noteOk };
    return { hotspots, cards, note, motion };
  }

  /** Cartão fora do ponto (empurrado, virado, preso na área livre): um fio fino liga o ponto real ao cartão. */
  private leader(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, a: number): void {
    ctx.save();
    ctx.strokeStyle = rgba(COL.cyan, 0.5 * a);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(COL.cyan, 0.9 * a);
    ctx.beginPath();
    ctx.arc(x0, y0, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Onde cada papel de hotspot fica no layout (m). */
  anchorFor(role: string, frame: { c: [number, number]; top: number } | null, crewR: number): P3 {
    const c = frame?.c ?? [0, 0];
    switch (role) {
      case 'workfront':
        return [c[0], c[1], (frame?.top ?? 8) + 4];
      case 'team':
        return [c[0], c[1] - crewR - 4, 1.8];
      case 'laydown':
        return this.layout.anchors.laydown;
      case 'milestone':
        return this.layout.anchors.milestone;
      default:
        return [c[0], c[1], 4];
    }
  }

  private projectLocal(x: number, y: number, z: number): boolean {
    const P = this.lastP;
    if (!P || !P.ok) return false;
    this.toEcef(x, y, z, this.tmp);
    return P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr);
  }

  /* ── primitivas ── */

  private drawArea(ctx: CanvasRenderingContext2D, b: Built, a: number, toneCol: Rgb): void {
    const p = b.p as Extract<TwinPrim, { t: 'area' }>;
    if (!this.path(ctx, b, 0, b.ok.length, true)) return;
    const focus = b.focus;
    switch (p.style) {
      case 'yard':
        ctx.fillStyle = rgba(COL.tealDeep, 0.05 * a);
        ctx.fill();
        ctx.strokeStyle = rgba(COL.cyan, 0.42 * a);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      case 'fence':
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = rgba(COL.cyan, 0.3 * a);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'trench':
        ctx.fillStyle = rgba(focus ? toneCol : COL.cyan, (focus ? 0.34 : 0.1) * a);
        ctx.fill();
        ctx.strokeStyle = rgba(focus ? toneCol : COL.cyan, (focus ? 0.9 : 0.28) * a);
        ctx.lineWidth = focus ? 1.3 : 0.8;
        ctx.stroke();
        break;
      case 'road':
        ctx.fillStyle = rgba(COL.line, 0.05 * a);
        ctx.fill();
        ctx.strokeStyle = rgba(COL.dim, 0.22 * a);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        break;
      case 'water':
        ctx.fillStyle = rgba(COL.water, 0.12 * a);
        ctx.fill();
        break;
      case 'pad':
      default:
        ctx.fillStyle = rgba(focus ? toneCol : COL.line, (focus ? 0.16 : 0.05) * a);
        ctx.fill();
        ctx.strokeStyle = rgba(focus ? toneCol : COL.line, (focus ? 0.8 : 0.22) * a);
        ctx.lineWidth = 0.9;
        ctx.stroke();
        break;
    }
  }

  private strokeFor(b: Built, a: number, toneCol: Rgb, anyFocus: boolean): { col: Rgb; al: number; w: number; dash: boolean } {
    if (b.focus) return { col: toneCol, al: 0.95 * a, w: 1.4, dash: false };
    if (b.fresh) return { col: COL.teal, al: 0.78 * a, w: 1.1, dash: true };
    return { col: COL.line, al: (anyFocus ? 0.3 : 0.42) * a, w: 1, dash: false };
  }

  private drawSolid(ctx: CanvasRenderingContext2D, b: Built, a: number, toneCol: Rgb, camL: P3, anyFocus: boolean): void {
    const st = this.strokeFor(b, a, toneCol, anyFocus);
    ctx.setLineDash(st.dash ? [5, 4] : []);
    const p = b.p;
    if (p.t === 'line') {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < b.ok.length; i += 1) {
        if (!b.ok[i]) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(b.s[i * 2], b.s[i * 2 + 1]);
        else ctx.moveTo(b.s[i * 2], b.s[i * 2 + 1]);
        pen = true;
      }
      ctx.strokeStyle = rgba(st.col, st.al);
      ctx.lineWidth = st.w;
      ctx.stroke();
    } else if (p.t === 'quad') {
      if (this.path(ctx, b, 0, 4, true)) {
        ctx.fillStyle = rgba(b.focus ? toneCol : COL.panel, (b.focus ? 0.34 : 0.4) * a);
        ctx.fill();
        ctx.strokeStyle = rgba(st.col, st.al * 0.8);
        ctx.lineWidth = st.w * 0.8;
        ctx.stroke();
      }
    } else if (p.t === 'box' && b.faces) {
      if (b.ok.some((v) => !v)) {
        ctx.setLineDash([]);
        return;
      }
      for (const face of b.faces) {
        const dx = camL[0] - face.c[0];
        const dy = camL[1] - face.c[1];
        const dz = camL[2] - face.c[2];
        if (face.n[0] * dx + face.n[1] * dy + face.n[2] * dz <= 0) continue; // face de trás
        ctx.beginPath();
        face.idx.forEach((k, j) => (j ? ctx.lineTo(b.s[k * 2], b.s[k * 2 + 1]) : ctx.moveTo(b.s[k * 2], b.s[k * 2 + 1])));
        ctx.closePath();
        const base = face.top ? COL.top : COL.face;
        ctx.fillStyle = b.focus ? rgba(mix(base, toneCol, 0.35), 0.4 * a) : rgba(base, (face.top ? 0.34 : 0.28) * a);
        ctx.fill();
        ctx.strokeStyle = rgba(st.col, st.al);
        ctx.lineWidth = st.w;
        ctx.stroke();
      }
    } else if (p.t === 'cyl') {
      const n = CYL_SEG;
      if (b.ok.some((v) => !v)) {
        ctx.setLineDash([]);
        return;
      }
      ctx.strokeStyle = rgba(st.col, st.al);
      ctx.lineWidth = st.w;
      this.path(ctx, b, 0, n, true);
      ctx.stroke();
      // silhueta: pontos mais à esquerda/direita do anel de cima até o de baixo
      let li = 0;
      let ri = 0;
      for (let i = 0; i < n; i += 1) {
        const x = b.s[(n + i) * 2];
        if (x < b.s[(n + li) * 2]) li = i;
        if (x > b.s[(n + ri) * 2]) ri = i;
      }
      ctx.beginPath();
      for (const k of [li, ri]) {
        ctx.moveTo(b.s[(n + k) * 2], b.s[(n + k) * 2 + 1]);
        ctx.lineTo(b.s[k * 2], b.s[k * 2 + 1]);
      }
      ctx.stroke();
      this.path(ctx, b, n, 2 * n, true);
      ctx.fillStyle = b.focus ? rgba(mix(COL.face, toneCol, 0.35), 0.35 * a) : rgba(COL.face, 0.22 * a);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Caminho pelos vértices [i0, i1) já projetados; `false` se algum sumiu. */
  private path(ctx: CanvasRenderingContext2D, b: Built, i0: number, i1: number, close: boolean): boolean {
    for (let i = i0; i < i1; i += 1) if (!b.ok[i]) return false;
    ctx.beginPath();
    for (let i = i0; i < i1; i += 1) {
      if (i === i0) ctx.moveTo(b.s[i * 2], b.s[i * 2 + 1]);
      else ctx.lineTo(b.s[i * 2], b.s[i * 2 + 1]);
    }
    if (close) ctx.closePath();
    return true;
  }

  /** `site.js:173-193`: pé → cabeça (1,8 m), cabeça redonda, brilho no chão quando na frente. */
  private person(ctx: CanvasRenderingContext2D, P: TwinProjector, x: number, y: number, a: number, hot: boolean): void {
    this.toEcef(x, y, 0, this.tmp);
    if (!P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr)) return;
    const fx = this.scr[0];
    const fy = this.scr[1];
    this.toEcef(x, y, 1.8, this.tmp);
    if (!P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr)) return;
    const hx = this.scr[0];
    const hy = this.scr[1];
    const r = Math.max(1.5, Math.min(4, (fy - hy) * 0.24));
    const col = hot ? COL.teal : COL.warm;
    ctx.strokeStyle = rgba(col, 0.85 * a);
    ctx.lineWidth = Math.max(1, r * 0.6);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(hx, hy + r);
    ctx.stroke();
    ctx.fillStyle = rgba(col, a);
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    if (hot) {
      ctx.fillStyle = rgba(COL.teal, 0.18 * a);
      ctx.beginPath();
      ctx.arc(fx, fy, r * 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** `site.js:423-438`: anel no chão (projetado, com perspectiva) + degradê radial. */
  private halo(ctx: CanvasRenderingContext2D, P: TwinProjector, cx: number, cy: number, r: number, k: number, col: Rgb, a: number): void {
    if (k <= 0.003) return;
    this.toEcef(cx, cy, 0.1, this.tmp);
    if (!P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr)) return;
    const ox = this.scr[0];
    const oy = this.scr[1];
    ctx.beginPath();
    let rr = 0;
    let first = true;
    for (let i = 0; i <= 48; i += 1) {
      const ang = (i / 48) * Math.PI * 2;
      this.toEcef(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 0.1, this.tmp);
      if (!P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr)) {
        first = true;
        continue;
      }
      rr = Math.max(rr, Math.hypot(this.scr[0] - ox, this.scr[1] - oy));
      if (first) ctx.moveTo(this.scr[0], this.scr[1]);
      else ctx.lineTo(this.scr[0], this.scr[1]);
      first = false;
    }
    ctx.strokeStyle = rgba(col, 0.75 * k * a);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    if (rr > 1) {
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
      g.addColorStop(0, rgba(col, 0.16 * k * a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  /** O anel de avanço no estilo do enrolamento da UG-05 (`site.js:329-352`): trilho + três traços + brilho na ponta. */
  private progressRing(ctx: CanvasRenderingContext2D, P: TwinProjector, cx: number, cy: number, z: number, r: number, prog: number, col: Rgb, a: number): void {
    const pts: Array<[number, number]> = [];
    const track: Array<[number, number] | null> = [];
    for (let i = 0; i <= RING_SEG; i += 1) {
      const an = -Math.PI / 2 + (i / RING_SEG) * Math.PI * 2;
      this.toEcef(cx + Math.cos(an) * r, cy + Math.sin(an) * r, z, this.tmp);
      track.push(P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr) ? [this.scr[0], this.scr[1]] : null);
    }
    ctx.beginPath();
    let pen = false;
    for (const p of track) {
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.strokeStyle = rgba(COL.line, 0.14 * a);
    ctx.lineWidth = 1;
    ctx.stroke();
    const steps = Math.max(2, Math.round(prog * RING_SEG));
    for (let i = 0; i <= steps; i += 1) {
      const an = -Math.PI / 2 + (i / steps) * prog * Math.PI * 2;
      this.toEcef(cx + Math.cos(an) * r, cy + Math.sin(an) * r, z, this.tmp);
      if (P.project(this.tmp[0], this.tmp[1], this.tmp[2], this.scr)) pts.push([this.scr[0], this.scr[1]]);
    }
    if (prog <= 0 || pts.length < 2) return;
    for (const [w, al] of [[7, 0.12], [3.2, 0.4], [1.6, 1]] as const) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = rgba(col, al * a);
      ctx.lineWidth = w;
      ctx.stroke();
    }
    const head = pts[pts.length - 1];
    if (head && prog < 1) {
      const g = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 18);
      g.addColorStop(0, rgba(col, 0.7 * a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head[0], head[1], 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ── Cartões: dentro da área livre, sem sobreposição ────────────────────── */

/** Cartão padrão (antes da primeira medida): o `.ag-hs` de 2 linhas. */
export const CARD_SIZE: CardSize = Object.freeze({ w: 216, h: 38 });
/** Rótulo obrigatório padrão (uma linha de 11 px). */
export const NOTE_SIZE: CardSize = Object.freeze({ w: 300, h: 23 });
/** Da borda do cartão ao centro do losango: padding 6 + margem 2 + meio losango 5. */
export const CARD_DOT = 13;
/** Meio lado da caixa que protege o hexágono do local (px). */
const SITE_HEX_R = 16;
/** Sem área livre informada: sem limite. */
const OPEN_RECT: ScreenRect = Object.freeze({ l: -1e6, t: -1e6, r: 1e6, b: 1e6 });
/** Quem escolhe primeiro quando dois cartões disputam o lugar (menor = primeiro). */
const ROLE_PRIORITY: Record<string, number> = { workfront: 0, laydown: 1, milestone: 2, team: 3 };
const GAP = 4;
/** O ponto real pode passar da área livre até isto (px) e o cartão ainda aparece. */
const EDGE_TOL = 6;

export interface CardRequest {
  id: string;
  /** O ponto real no modelo (px do palco). */
  x: number;
  y: number;
  visible: boolean;
  w: number;
  h: number;
  prio: number;
}

export interface CardPlacement {
  id: string;
  /** Aparece: ponto visível DENTRO da área livre e um lugar sem cobrir nada. */
  shown: boolean;
  /** Canto superior esquerdo do cartão (px do palco). */
  left: number;
  top: number;
  w: number;
  h: number;
  /** O cartão sai para a direita do ponto ('r') ou para a esquerda ('l', losango na ponta direita). */
  side: 'r' | 'l';
  /** O ponto real (ax, ay) e o losango do cartão (cx, cy) — diferentes = fio de ligação. */
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  /** O candidato escolhido (o quadro seguinte tenta este primeiro). */
  pick: number;
}

/** Passos verticais (em alturas de cartão) e horizontais (em `DX_PX`, para longe do ponto). */
const DY_STEPS = [0, 1, -1, 2, -2, 3, -3] as const;
const DX_STEPS = [0, 1, 2, 3] as const;
const DX_PX = 64;

/**
 * Os lugares candidatos, do mais perto do ponto ao mais longe: custo = passos
 * verticais + 1,2 × passos horizontais + ½ se virado; por último, deslizando
 * para dentro da área. Lista fixa (a histerese guarda o índice).
 */
const CANDIDATES: ReadonlyArray<{ side: 'r' | 'l'; k: number; dx: number; slide: boolean }> = Object.freeze((() => {
  const base = (['r', 'l'] as const).flatMap((side) => DY_STEPS.flatMap((k) => DX_STEPS.map((dx) => ({
    side, k, dx, slide: false, cost: Math.abs(k) + 1.2 * dx + (side === 'l' ? 0.5 : 0),
  }))));
  const ordered = base.map((c, i) => ({ c, i })).sort((p, q) => p.c.cost - q.c.cost || p.i - q.i).map(({ c }) => c);
  const slides = (['r', 'l'] as const).flatMap((side) => DY_STEPS.map((k) => ({ side, k, dx: 0, slide: true, cost: 99 })));
  return [...ordered, ...slides].map(({ side, k, dx, slide }) => ({ side, k, dx, slide }));
})());

const inside = (b: ScreenRect, f: ScreenRect) => b.l >= f.l && b.r <= f.r && b.t >= f.t && b.b <= f.b;
const crosses = (b: ScreenRect, q: ScreenRect) => b.l < q.r + GAP && b.r > q.l - GAP && b.t < q.b + GAP && b.b > q.t - GAP;

/**
 * Posiciona os cartões por prioridade, cada um no primeiro candidato que fica
 * INTEIRO dentro da área livre sem cruzar um cartão já posto nem as caixas
 * fixas (rótulo obrigatório, hexágono do local): à direita do ponto, depois à
 * esquerda (virado), subindo/descendo em passos de um cartão e se afastando
 * em passos de 64 px (um fio liga o ponto ao cartão), e por último
 * deslizando na horizontal para dentro da área. Ponto fora da área livre (atrás
 * de um painel) ou sem lugar = o cartão não aparece — nunca um cartão cortado
 * ou por baixo do HUD. `prev` (o candidato do quadro anterior) é tentado
 * primeiro: a respiração da câmera não faz o cartão pular de lado.
 */
export function placeCards(
  reqs: ReadonlyArray<CardRequest>,
  free: ScreenRect,
  fixed: ReadonlyArray<ScreenRect> = [],
  prev?: ReadonlyMap<string, number>,
): Map<string, CardPlacement> {
  const out = new Map<string, CardPlacement>();
  const taken: ScreenRect[] = [...fixed];
  const order = reqs.map((it, i) => ({ it, i })).sort((p, q) => p.it.prio - q.it.prio || p.i - q.i);
  for (const { it } of order) {
    const w = Number.isFinite(it.w) && it.w > 0 ? it.w : CARD_SIZE.w;
    const h = Number.isFinite(it.h) && it.h > 0 ? it.h : CARD_SIZE.h;
    const none: CardPlacement = { id: it.id, shown: false, left: 0, top: 0, w, h, side: 'r', ax: it.x, ay: it.y, cx: it.x, cy: it.y, pick: -1 };
    const anchorIn = it.visible && Number.isFinite(it.x) && Number.isFinite(it.y) &&
      it.x >= free.l - EDGE_TOL && it.x <= free.r + EDGE_TOL && it.y >= free.t - EDGE_TOL && it.y <= free.b + EDGE_TOL;
    if (!anchorIn) {
      out.set(it.id, none);
      continue;
    }
    const tryAt = (idx: number): CardPlacement | null => {
      const c = CANDIDATES[idx];
      if (!c) return null;
      const cy = it.y + c.k * (h + GAP);
      let left = c.side === 'r' ? it.x - CARD_DOT + c.dx * DX_PX : it.x + CARD_DOT - w - c.dx * DX_PX;
      if (c.slide) left = Math.min(Math.max(left, free.l), free.r - w);
      const box = { l: left, t: cy - h / 2, r: left + w, b: cy + h / 2 };
      if (!inside(box, free) || taken.some((q) => crosses(box, q))) return null;
      const cx = c.side === 'r' ? left + CARD_DOT : left + w - CARD_DOT;
      return { id: it.id, shown: true, left, top: box.t, w, h, side: c.side, ax: it.x, ay: it.y, cx, cy, pick: idx };
    };
    const first = prev?.get(it.id);
    let got = typeof first === 'number' ? tryAt(first) : null;
    for (let i = 0; !got && i < CANDIDATES.length; i += 1) got = tryAt(i);
    if (!got) {
      out.set(it.id, none);
      continue;
    }
    taken.push({ l: got.left, t: got.top, r: got.left + w, b: got.top + h });
    out.set(it.id, got);
  }
  return out;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** O que obriga a remontar a geometria: tipo/local (`key`), âncora e rumo. */
export function twinGeometryKey(spec: TwinSpec): string {
  const r = (v: number, k: number) => (Number.isFinite(v) ? v.toFixed(k) : 'x');
  return `${spec.key}|${spec.kind}|${r(spec.anchor.lat, 7)}|${r(spec.anchor.lng, 7)}|${r(spec.azimuthDeg, 2)}`;
}
