/**
 * O MODELO ESQUEMÁTICO DA OBRA — geometria PROCEDURAL por tipo de obra.
 *
 * NÃO é projeto executivo nem as-built: é a gramática do gêmeo do filme
 * (`APEX FILM/js/world/site.js` — casa de força em raio-x, unidades, pátio,
 * equipe) generalizada para os tipos de obra do produto. Nada aqui vem do
 * dado da obra além do TIPO (`SiteKind`); o que é dado real (frente de
 * trabalho, avanço, equipe, falta de material, marco) entra pela `TwinSpec` e
 * só DESTACA elementos daqui.
 *
 * Unidades em METROS num plano local: `x` ao longo do eixo longo do layout
 * (o rumo `azimuthDeg` da spec), `y` à esquerda de `x`, `z` para cima. Na
 * câmera do local (rumo 58°) o eixo longo fica atravessado na tela (y < 0 =
 * perto da câmera). Tudo é determinístico (sem sorteio) e finito.
 */
import type { SiteKind } from '@/lib/dashboard/types';

export type P2 = [number, number];
export type P3 = [number, number, number];

export type AreaStyle = 'fence' | 'yard' | 'trench' | 'road' | 'water' | 'pad';

export type TwinPrim =
  /** Caixa orientada: base (4 pontos em sentido anti-horário visto de cima) de z0 a z0 + h. */
  | { t: 'box'; group: string; q: [P2, P2, P2, P2]; z0: number; h: number; isNew?: boolean }
  /** Cilindro vertical (unidade geradora, bucha, torre de aerogerador). */
  | { t: 'cyl'; group: string; c: P2; r: number; z0: number; z1: number; isNew?: boolean }
  /** Linha 3D (treliça, viga, cabo em catenária). */
  | { t: 'line'; group: string; pts: P3[]; isNew?: boolean }
  /** Área no chão (cerca, pátio, canaleta, acesso, água, base). */
  | { t: 'area'; group: string; pts: P2[]; style: AreaStyle }
  /** Quadrilátero inclinado (mesa de módulos solares). */
  | { t: 'quad'; group: string; pts: [P3, P3, P3, P3]; isNew?: boolean };

export interface TwinLayout {
  kind: SiteKind;
  prims: TwinPrim[];
  /** Grupos presentes (a frente de trabalho só destaca um destes). */
  groups: string[];
  /** Grupo usado para posicionar a frente quando a fase não aponta nenhum. */
  defaultFocus: string;
  anchors: {
    /** Pátio de materiais (hotspot "laydown"). */
    laydown: P3;
    /** Onde o marco aparece (casa de comando, portaria…). */
    milestone: P3;
    /** Canto da frente do modelo: o rótulo obrigatório "Representação esquemática…". */
    label: P3;
  };
  /** Meia-extensão do layout (m): eixo longo e transversal. */
  extent: { halfL: number; halfW: number };
  /**
   * Escala ESQUEMÁTICA uniforme (≥ 1): leva o eixo longo a ~`TWIN_TARGET_M` para o
   * modelo ler na câmera do local (1,4 km), como o gêmeo do filme. É um desenho,
   * não a planta — o rótulo obrigatório diz isso.
   */
  scale: number;
}

/**
 * Comprimento-alvo (m) do eixo longo do modelo: a 1,4 km (Visão geral) ≈ 490 px
 * a 1440×900 — cabe entre as colunas do HUD, como o gêmeo do filme.
 */
export const TWIN_TARGET_M = 440;

/** A escala esquemática de um layout: eixo longo → ~`TWIN_TARGET_M`, entre 1× e 5×. */
export function schematicScale(halfL: number): number {
  if (!(halfL > 0) || !Number.isFinite(halfL)) return 1;
  return Math.min(5, Math.max(1, TWIN_TARGET_M / (2 * halfL)));
}

export const TWIN_KINDS: readonly SiteKind[] = Object.freeze(['substation', 'transmission', 'solar', 'hydro', 'wind', 'generic']);

/** Qualquer valor → um `SiteKind` conhecido (desconhecido/ausente = 'generic'). */
export function layoutKind(kind: unknown): SiteKind {
  return typeof kind === 'string' && (TWIN_KINDS as readonly string[]).includes(kind) ? (kind as SiteKind) : 'generic';
}

/* ── Primitivas de construção ───────────────────────────────────────────── */

/** Retângulo centrado em (cx, cy), `l` ao longo de x, `w` ao longo de y, girado `rot` rad — anti-horário. */
export function rect(cx: number, cy: number, l: number, w: number, rot = 0): [P2, P2, P2, P2] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const p = (dx: number, dy: number): P2 => [cx + dx * c - dy * s, cy + dx * s + dy * c];
  return [p(-l / 2, -w / 2), p(l / 2, -w / 2), p(l / 2, w / 2), p(-l / 2, w / 2)];
}

function box(group: string, cx: number, cy: number, l: number, w: number, z0: number, h: number, isNew = false, rot = 0): TwinPrim {
  return { t: 'box', group, q: rect(cx, cy, l, w, rot), z0, h, ...(isNew ? { isNew } : {}) };
}

function area(group: string, style: AreaStyle, cx: number, cy: number, l: number, w: number): TwinPrim {
  return { t: 'area', group, style, pts: rect(cx, cy, l, w) };
}

function line(group: string, pts: P3[], isNew = false): TwinPrim {
  return { t: 'line', group, pts, ...(isNew ? { isNew } : {}) };
}

/** Pórtico: duas colunas + viga no topo (eixo da viga ao longo de y quando `alongY`). */
function gantry(group: string, cx: number, cy: number, span: number, h: number, alongY: boolean, isNew = false): TwinPrim[] {
  const a: P2 = alongY ? [cx, cy - span / 2] : [cx - span / 2, cy];
  const b: P2 = alongY ? [cx, cy + span / 2] : [cx + span / 2, cy];
  return [
    line(group, [[a[0], a[1], 0], [a[0], a[1], h]], isNew),
    line(group, [[b[0], b[1], 0], [b[0], b[1], h]], isNew),
    line(group, [[a[0], a[1], h], [b[0], b[1], h]], isNew),
    // travamento em X na viga (a leitura de "treliça" do pórtico)
    line(group, [[a[0], a[1], h - 1.6], [b[0], b[1], h]], isNew),
  ];
}

/** Cabo em catenária (parábola) entre dois pontos 3D, com `sag` m no meio. */
export function catenary(a: P3, b: P3, sag: number, n = 16): P3[] {
  const out: P3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s - sag * 4 * s * (1 - s)]);
  }
  return out;
}

/** Pilha de caixotes/bobinas no pátio (adereço esquemático, não é contagem de estoque). */
function crates(group: string, cx: number, cy: number): TwinPrim[] {
  return [
    box(group, cx - 4.5, cy - 2, 3.8, 1.6, 0, 1.1),
    box(group, cx, cy - 2, 3.8, 1.6, 0, 1.1),
    box(group, cx + 4.5, cy - 2, 3.8, 1.6, 0, 1.1),
    box(group, cx - 2.2, cy + 2.2, 3.8, 1.6, 0, 1.1),
    { t: 'cyl', group, c: [cx + 3.6, cy + 2.6], r: 1.3, z0: 0, z1: 1.6 },
  ];
}

/* ── Subestação: bays, pórticos, disjuntores, barramentos, trafo, casa de comando, canaleta ── */

type RawLayout = Omit<TwinLayout, 'scale'>;

function substation(): RawLayout {
  const prims: TwinPrim[] = [];
  const halfL = 72;
  const halfW = 46;
  prims.push(area('yard', 'yard', 0, 0, halfL * 2, halfW * 2));
  prims.push(area('fence', 'fence', 0, 0, halfL * 2 + 6, halfW * 2 + 6));
  const BAYS = 6;
  const pitch = 22;
  const x0 = -((BAYS - 1) * pitch) / 2;
  for (let i = 0; i < BAYS; i += 1) {
    const x = x0 + i * pitch;
    const isNew = i >= BAYS - 2; // os dois últimos bays: "ampliação" quando a spec pede
    // pórtico de entrada de linha (fundo do pátio)
    prims.push(...gantry('gantries', x, 39, 9, 15, false, isNew));
    // chave seccionadora, disjuntor, TCs/TPs
    prims.push({ t: 'cyl', group: 'breakers', c: [x - 2.2, 32], r: 0.45, z0: 0, z1: 5.2, ...(isNew ? { isNew } : {}) });
    prims.push({ t: 'cyl', group: 'breakers', c: [x + 2.2, 32], r: 0.45, z0: 0, z1: 5.2, ...(isNew ? { isNew } : {}) });
    prims.push(box('breakers', x, 10, 3.2, 1.8, 0, 3.6, isNew));
    for (const dx of [-2.4, 0, 2.4]) prims.push({ t: 'cyl', group: 'breakers', c: [x + dx, 10], r: 0.3, z0: 3.6, z1: 6.4, ...(isNew ? { isNew } : {}) });
    for (const dx of [-2.4, 0, 2.4]) prims.push({ t: 'cyl', group: 'breakers', c: [x + dx, 1], r: 0.38, z0: 0, z1: 4.8, ...(isNew ? { isNew } : {}) });
    // pórtico do barramento (atravessa o pátio em y)
    prims.push(...gantry('gantries', x, 26, 16, 12, true, isNew));
    // base (fundação) do bay
    prims.push({ t: 'area', group: 'foundations', style: 'pad', pts: rect(x, 10, 5, 3.4) });
    // descida do bay até o barramento
    prims.push(line('buses', [[x, 39, 13.5], [x, 32, 8], [x, 10, 6.4]], isNew));
  }
  // barramentos (duas barras ao longo de x)
  for (const y of [22, 30]) prims.push(line('buses', [[x0 - 8, y, 10.5], [-x0 + 8, y, 10.5]]));
  // transformadores + parede corta-fogo
  for (const x of [-34, 6]) {
    prims.push(box('transformer', x, -26, 9, 6, 0, 5.2));
    for (let k = -3; k <= 3; k += 1) prims.push(line('transformer', [[x + k * 1.2, -29.6, 0.6], [x + k * 1.2, -29.6, 4.6]]));
    for (const dx of [-2.6, 0, 2.6]) prims.push({ t: 'cyl', group: 'transformer', c: [x + dx, -24.6], r: 0.35, z0: 5.2, z1: 8.2 });
    prims.push(line('buses', [[x, -24.6, 8.2], [x, -6, 9], [x, 10, 6.4]]));
  }
  prims.push(box('transformer', -14, -26, 1, 9, 0, 7));
  // casa de comando e sala de baterias
  prims.push(box('control', 50, -31, 18, 9, 0, 4.6));
  prims.push(box('control', 50, -22.5, 6, 4, 0, 3.2));
  // canaleta de cabos: espinha ao longo de x + ramal até a casa de comando
  prims.push({ t: 'area', group: 'trench', style: 'trench', pts: rect(0, -12, 132, 1.4) });
  prims.push({ t: 'area', group: 'trench', style: 'trench', pts: rect(50, -19, 1.4, 14) });
  for (let i = 0; i < BAYS; i += 1) prims.push({ t: 'area', group: 'trench', style: 'trench', pts: rect(x0 + i * pitch, -1, 1, 22) });
  // acesso + pátio de materiais (fora da cerca, perto da câmera)
  prims.push(area('access', 'road', 30, -64, 8, 30));
  prims.push(area('laydown', 'pad', -46, -64, 34, 18));
  prims.push(...crates('laydown', -46, -64));
  return {
    kind: 'substation',
    prims,
    groups: groupsOf(prims),
    defaultFocus: 'gantries',
    anchors: { laydown: [-46, -64, 3], milestone: [50, -31, 7], label: [-10, -halfW - 5, 0] },
    extent: { halfL, halfW },
  };
}

/* ── Linha de transmissão: torres treliçadas + catenárias ───────────────── */

/** Altura da cruzeta e do pico do para-raios da torre (m). */
const TOWER_H = 42;
const TOWER_TOP = 54;

function tower(group: string, x: number, isNew = false): TwinPrim[] {
  const base = 6;
  const waist = 1.8;
  const H = TOWER_H;
  const top = TOWER_TOP;
  const out: TwinPrim[] = [];
  const corners: P2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sy] of corners) out.push(line(group, [[x + sx * base, sy * base, 0], [x + sx * waist, sy * waist, H]], isNew));
  // travamentos em X nas quatro faces (duas alturas)
  for (const [z0, z1, r0, r1] of [[0, 18, base, 3.8], [18, H, 3.8, waist]] as const) {
    for (let k = 0; k < 4; k += 1) {
      const [ax, ay] = corners[k];
      const [bx, by] = corners[(k + 1) % 4];
      out.push(line(group, [[x + ax * r0, ay * r0, z0], [x + bx * r1, by * r1, z1]], isNew));
      out.push(line(group, [[x + bx * r0, by * r0, z0], [x + ax * r1, ay * r1, z1]], isNew));
    }
  }
  // mastro + cruzeta (braços em y) + pico do para-raios
  out.push(line(group, [[x - waist, 0, H], [x, 0, top], [x + waist, 0, H]], isNew));
  out.push(line(group, [[x, -12, H + 2], [x, 12, H + 2]], isNew));
  out.push(line(group, [[x - waist, -waist, H], [x, -12, H + 2]], isNew));
  out.push(line(group, [[x - waist, waist, H], [x, 12, H + 2]], isNew));
  for (const [sx, sy] of corners) out.push({ t: 'area', group: 'foundations', style: 'pad', pts: rect(x + sx * base, sy * base, 2.2, 2.2) });
  return out;
}

function transmission(): RawLayout {
  const prims: TwinPrim[] = [];
  const TOWERS = 5;
  const span = 340;
  const x0 = -((TOWERS - 1) * span) / 2;
  const xs = Array.from({ length: TOWERS }, (_, i) => x0 + i * span);
  prims.push(area('access', 'road', 0, -34, TOWERS * span, 6));
  xs.forEach((x, i) => prims.push(...tower('towers', x, i === TOWERS - 1)));
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const a = xs[i];
    const b = xs[i + 1];
    for (const y of [-12, 0, 12]) {
      const z = y === 0 ? TOWER_H : TOWER_H + 1.6;
      prims.push(line('conductors', catenary([a, y, z], [b, y, z], 9)));
    }
    prims.push(line('conductors', catenary([a, 0, TOWER_TOP], [b, 0, TOWER_TOP], 6)));
  }
  const ld: P3 = [xs[1] + 40, -52, 3];
  prims.push(area('laydown', 'pad', ld[0], ld[1], 30, 16));
  prims.push(...crates('laydown', ld[0], ld[1]));
  prims.push({ t: 'cyl', group: 'laydown', c: [ld[0] + 20, ld[1] + 2], r: 2.4, z0: 0, z1: 2.2 }); // bobina de cabo
  const halfL = (TOWERS * span) / 2;
  return {
    kind: 'transmission',
    prims,
    groups: groupsOf(prims),
    defaultFocus: 'towers',
    anchors: { laydown: ld, milestone: [xs[3], 0, TOWER_TOP + 4], label: [40, -60, 0] },
    extent: { halfL, halfW: 60 },
  };
}

/* ── Usina solar: blocos de mesas + inversores ──────────────────────────── */

function solar(): RawLayout {
  const prims: TwinPrim[] = [];
  const BX = 3;
  const BY = 2;
  const bl = 70;
  const bw = 40;
  const gap = 12;
  const halfL = (BX * bl + (BX - 1) * gap) / 2 + 6;
  const halfW = (BY * bw + (BY - 1) * gap) / 2 + 6;
  prims.push(area('fence', 'fence', 0, 0, halfL * 2, halfW * 2));
  for (let bx = 0; bx < BX; bx += 1) {
    for (let by = 0; by < BY; by += 1) {
      const cx = -halfL + 6 + bl / 2 + bx * (bl + gap);
      const cy = -halfW + 6 + bw / 2 + by * (bw + gap);
      const isNew = bx === BX - 1 && by === BY - 1;
      for (let r = 0; r < 6; r += 1) {
        const y = cy - bw / 2 + 3 + r * 6.6;
        prims.push({ t: 'quad', group: 'tables', pts: [[cx - bl / 2 + 3, y, 0.8], [cx + bl / 2 - 3, y, 0.8], [cx + bl / 2 - 3, y + 3.8, 2.4], [cx - bl / 2 + 3, y + 3.8, 2.4]], ...(isNew ? { isNew } : {}) });
      }
      prims.push(box('inverters', cx + bl / 2 + gap / 2, cy, 2.6, 6, 0, 2.9, isNew));
      prims.push({ t: 'area', group: 'trench', style: 'trench', pts: rect(cx + bl / 2 + gap / 2, cy - bw / 2 - gap / 2 + 0.5, bl + gap, 1) });
    }
  }
  prims.push(box('inverters', halfL - 16, -halfW + 12, 10, 5, 0, 3.4)); // cabine de entrega
  prims.push(area('access', 'road', halfL - 16, -halfW - 16, 8, 26));
  const ld: P3 = [-halfL + 26, -halfW - 20, 3];
  prims.push(area('laydown', 'pad', ld[0], ld[1], 34, 16));
  prims.push(...crates('laydown', ld[0], ld[1]));
  return {
    kind: 'solar',
    prims,
    groups: groupsOf(prims),
    defaultFocus: 'tables',
    anchors: { laydown: ld, milestone: [halfL - 16, -halfW + 12, 6], label: [-10, -halfW - 5, 0] },
    extent: { halfL, halfW },
  };
}

/* ── Hidrelétrica: casa de força em raio-x, unidades, ponte rolante (o gêmeo do filme) ── */

function hydro(): RawLayout {
  const prims: TwinPrim[] = [];
  const UNITS = 4;
  const halfL = 64;
  const hallW = 36;
  prims.push(area('water', 'water', 0, 48, 180, 40)); // reservatório
  prims.push(area('water', 'water', 0, -44, 150, 22)); // canal de fuga
  prims.push(box('dam', 0, 25, 190, 10, 0, 6));
  prims.push(box('powerhouse', 0, 0, halfL * 2, hallW, 0, 26));
  const pitch = (halfL * 2 * 0.8) / UNITS;
  for (let k = 0; k < UNITS; k += 1) {
    const x = -halfL * 0.8 + pitch * (k + 0.5);
    prims.push({ t: 'cyl', group: 'unit', c: [x, 0], r: 7.5, z0: 2, z1: 12 });
    prims.push({ t: 'cyl', group: 'unit', c: [x, 0], r: 5.4, z0: 6, z1: 12.8 });
    prims.push(line('powerhouse', [[x - pitch / 2, -hallW / 2, 26], [x - pitch / 2, hallW / 2, 26]]));
  }
  prims.push(box('crane', -halfL * 0.8 + pitch * 1.5, 0, 5, hallW - 2, 21, 2.2));
  // pátio na margem, ao lado da casa de força (longe da frente de trabalho)
  const ld: P3 = [-84, -26, 3];
  prims.push(area('laydown', 'pad', ld[0], ld[1], 30, 14));
  prims.push(...crates('laydown', ld[0], ld[1]));
  return {
    kind: 'hydro',
    prims,
    groups: groupsOf(prims),
    defaultFocus: 'unit',
    anchors: { laydown: ld, milestone: [halfL - 10, 0, 30], label: [0, -58, 0] },
    extent: { halfL: 95, halfW: 68 },
  };
}

/* ── Eólica: aerogeradores em linha ─────────────────────────────────────── */

function wind(): RawLayout {
  const prims: TwinPrim[] = [];
  const xs = [-260, 0, 260];
  prims.push(area('access', 'road', 0, -30, 620, 6));
  xs.forEach((x, i) => {
    const isNew = i === xs.length - 1;
    prims.push({ t: 'area', group: 'foundations', style: 'pad', pts: rect(x, 0, 22, 22) });
    prims.push({ t: 'area', group: 'foundations', style: 'pad', pts: rect(x + 26, -8, 30, 16) }); // plataforma do guindaste
    prims.push({ t: 'cyl', group: 'turbines', c: [x, 0], r: 2.2, z0: 0, z1: 90, ...(isNew ? { isNew } : {}) });
    prims.push(box('turbines', x, 0, 10, 3.6, 90, 3.6, isNew));
    const hub: P3 = [x - 5.6, 0, 91.8];
    for (let b = 0; b < 3; b += 1) {
      const a = -Math.PI / 2 + (b * 2 * Math.PI) / 3 + 0.35;
      prims.push(line('turbines', [hub, [hub[0], Math.cos(a) * 52, hub[2] + Math.sin(a) * 52]], isNew));
    }
    // vala da rede de média tensão até o próximo aerogerador
    if (i < xs.length - 1) prims.push({ t: 'area', group: 'trench', style: 'trench', pts: rect(x + 130, -22, 260, 1) });
  });
  const ld: P3 = [-200, -58, 3];
  prims.push(area('laydown', 'pad', ld[0], ld[1], 40, 18));
  prims.push(...crates('laydown', ld[0], ld[1]));
  return {
    kind: 'wind',
    prims,
    groups: groupsOf(prims),
    defaultFocus: 'turbines',
    anchors: { laydown: ld, milestone: [260, 0, 100], label: [40, -60, 0] },
    extent: { halfL: 320, halfW: 72 },
  };
}

/* ── Genérica: terreno, edificação em obra, escritório, pátio ───────────── */

function generic(): RawLayout {
  const prims: TwinPrim[] = [];
  const halfL = 56;
  const halfW = 38;
  prims.push(area('plot', 'yard', 0, 0, halfL * 2, halfW * 2));
  prims.push(area('fence', 'fence', 0, 0, halfL * 2 + 4, halfW * 2 + 4));
  prims.push(box('building', -6, 8, 34, 18, 0, 10));
  for (const z of [3.4, 6.8]) prims.push(line('building', [[-23, -1, z], [11, -1, z], [11, 17, z], [-23, 17, z], [-23, -1, z]]));
  prims.push(box('offices', 36, -22, 6, 2.5, 0, 2.6));
  prims.push(box('offices', 36, -17, 6, 2.5, 0, 2.6));
  prims.push({ t: 'area', group: 'trench', style: 'trench', pts: rect(10, -8, 70, 1.2) });
  prims.push(area('access', 'road', 40, -50, 8, 24));
  const ld: P3 = [-30, -24, 3];
  prims.push(area('laydown', 'pad', ld[0], ld[1], 30, 14));
  prims.push(...crates('laydown', ld[0], ld[1]));
  return {
    kind: 'generic',
    prims,
    groups: groupsOf(prims),
    defaultFocus: 'building',
    anchors: { laydown: ld, milestone: [36, -20, 5], label: [-8, -halfW - 5, 0] },
    extent: { halfL, halfW },
  };
}

/** Grupos presentes, na ordem em que aparecem. */
function groupsOf(prims: TwinPrim[]): string[] {
  return Array.from(new Set(prims.map((p) => p.group)));
}

const BUILDERS: Record<SiteKind, () => Omit<TwinLayout, 'scale'>> = { substation, transmission, solar, hydro, wind, generic };
const cache = new Map<SiteKind, TwinLayout>();

/** O layout de um tipo de obra (memorizado: a geometria é a mesma para todo local do tipo). */
export function buildLayout(kind: unknown): TwinLayout {
  const k = layoutKind(kind);
  const hit = cache.get(k);
  if (hit) return hit;
  const raw = BUILDERS[k]();
  const built: TwinLayout = { ...raw, scale: schematicScale(raw.extent.halfL) };
  cache.set(k, built);
  return built;
}

/** Pontos 3D de uma primitiva (para centróide/altura). */
export function primPoints(p: TwinPrim): P3[] {
  switch (p.t) {
    case 'box':
      return [...p.q.map((q): P3 => [q[0], q[1], p.z0]), ...p.q.map((q): P3 => [q[0], q[1], p.z0 + p.h])];
    case 'cyl':
      return [[p.c[0] - p.r, p.c[1], p.z0], [p.c[0] + p.r, p.c[1], p.z1], [p.c[0], p.c[1] - p.r, p.z0], [p.c[0], p.c[1] + p.r, p.z1]];
    case 'line':
      return p.pts;
    case 'area':
      return p.pts.map((q): P3 => [q[0], q[1], 0]);
    case 'quad':
      return p.pts;
    default:
      return [];
  }
}

/** Centro no chão, topo e raio (m) de um grupo; `null` se o grupo não existe no layout. */
export function groupFrame(layout: TwinLayout, group: string | null | undefined): { c: P2; top: number; radius: number } | null {
  if (!group) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let top = 0;
  let any = false;
  for (const p of layout.prims) {
    if (p.group !== group) continue;
    for (const [x, y, z] of primPoints(p)) {
      any = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z > top) top = z;
    }
  }
  if (!any) return null;
  const c: P2 = [(minX + maxX) / 2, (minY + maxY) / 2];
  return { c, top, radius: Math.max(4, Math.hypot(maxX - minX, maxY - minY) / 2) };
}

/** Caixa do modelo no plano local, JÁ na escala esquemática (m): o que a câmera do local enquadra. */
export interface LayoutBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Altura do ponto mais alto (inclui o ponto do hotspot da frente, 4 m acima do grupo). */
  top: number;
}

const boxCache = new Map<SiteKind, LayoutBox>();

/**
 * A caixa de TUDO que o modelo desenha ou ancora (peças, pátio, marco, rótulo),
 * em metros depois da escala esquemática — memorizada por tipo. É o que a
 * câmera da Visão geral/Planejar põe dentro da área livre do HUD.
 */
export function layoutBox(kind: unknown): LayoutBox {
  const k = layoutKind(kind);
  const hit = boxCache.get(k);
  if (hit) return hit;
  const L = buildLayout(k);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let top = 0;
  const add = ([x, y, z]: P3) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z > top) top = z;
  };
  for (const p of L.prims) for (const q of primPoints(p)) add(q);
  add(L.anchors.laydown);
  add(L.anchors.milestone);
  add(L.anchors.label);
  const s = L.scale;
  const box: LayoutBox = { minX: minX * s, maxX: maxX * s, minY: minY * s, maxY: maxY * s, top: (top + 4) * s };
  boxCache.set(k, box);
  return box;
}
