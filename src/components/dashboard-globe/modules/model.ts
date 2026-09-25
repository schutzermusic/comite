/**
 * MÓDULOS DO LOCAL — regras de TELA em código puro (sem React, sem CSS).
 *
 * Planejar, Supply Chain e Faturamento desenham os dados do servidor na
 * gramática do protótipo APEX FILM. Aqui mora só o COMO desenhar: a escala do
 * Gantt (dia → fração do eixo, com guarda de NaN em toda coordenada), os
 * caminhos das dependências, a camada do mapa do Supply (arcos, cartões e
 * enquadramento), as linhas do balanço de material e o tom de cada estado do
 * eventograma. Nada aqui inventa dado: o que não veio não vira número.
 */
import type { CameraView, GlobeArc, GlobeNode, MapLayer } from '../contract';
import type {
  ActivityNeed, ChainLink, EventogramRow, EventogramState, GanttActivity, GanttLink, InboundOrder, MaterialBalance,
  SitePlanData, SiteSupplyData, StockNode,
} from '@/lib/dashboard/types';

const DAY_MS = 86_400_000;
export const MONTHS_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/* ══════════════════════════════════════════════════════════════════════════
   DATAS — dia de calendário (sem fuso: "2026-10-18" é o dia 18, sempre)
   ══════════════════════════════════════════════════════════════════════════ */

/** "YYYY-MM-DD" (ou ISO com hora) → número do dia desde 1970-01-01. Data inválida ("2026-02-31") → null. */
export function dayNumber(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(t)) return null;
  const back = new Date(t);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}

function partsOf(day: number): { y: number; m: number; d: number } {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

/** "18 OUT" — o rótulo curto do protótipo. Sem data válida → "—". */
export function dayMonth(value: string | null | undefined): string {
  const n = dayNumber(value);
  return n === null ? '—' : dayMonthOf(n);
}
export function dayMonthOf(day: number): string {
  const p = partsOf(day);
  return `${String(p.d).padStart(2, '0')} ${MONTHS_PT[p.m]}`;
}

/** "18 OUT — 31 OUT" (uma data só quando início = fim; "sem datas" quando não há nenhuma). */
export function spanLabel(start: string | null | undefined, finish: string | null | undefined): string {
  const s = dayNumber(start);
  const f = dayNumber(finish);
  if (s === null && f === null) return 'sem datas no cronograma';
  if (s === null || f === null || s === f) return dayMonthOf((s ?? f) as number);
  return `${dayMonthOf(Math.min(s, f))} — ${dayMonthOf(Math.max(s, f))}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   GANTT — escala e linhas
   ══════════════════════════════════════════════════════════════════════════ */

export interface GanttScale {
  /** Primeiro dia do eixo (inclusivo) e o dia seguinte ao último (exclusivo). */
  d0: number;
  d1: number;
  /** Fração 0..1 do INÍCIO de um dia no eixo; fora do eixo (ou sem dia) → null. */
  at(day: number | null | undefined): number | null;
  /** Fração presa em [0, 1] — para barras que começam antes ou terminam depois da janela. */
  clampAt(day: number | null | undefined): number | null;
  months: Array<{ key: string; x: number; label: string }>;
  ticks: Array<{ key: string; x: number; label: string }>;
}

/** Dias que o eixo estica para mostrar "Hoje" / "Necessário até" logo fora da janela do servidor. */
const REACH_DAYS = 120;
const MIN_SPAN = 14;
const MAX_SPAN = 1100;

/**
 * A escala do Gantt sobre `plan.window`. Janela inválida ou invertida cai para
 * as datas das atividades; sem nenhuma data, uma janela em torno de hoje. Hoje
 * e as datas de `include` (a necessidade em foco) esticam o eixo quando estão
 * perto dele; longe, simplesmente não são desenhadas.
 */
export function ganttScale(input: {
  window?: { start: string | null; end: string | null } | null;
  activities: Array<Pick<GanttActivity, 'start' | 'finish'>>;
  today?: string | null;
  include?: Array<string | null | undefined>;
}): GanttScale {
  let d0 = dayNumber(input.window?.start ?? null);
  let d1 = dayNumber(input.window?.end ?? null);
  if (d0 !== null && d1 !== null) d1 += 1;
  if (d0 === null || d1 === null || d1 <= d0) {
    const days = input.activities.flatMap((a) => [dayNumber(a.start), dayNumber(a.finish)]).filter(finite);
    if (days.length > 0) {
      d0 = Math.min(...days);
      d1 = Math.max(...days) + 1;
    } else {
      const t = dayNumber(input.today ?? null) ?? 0;
      d0 = t - 14;
      d1 = t + 30;
    }
  }
  for (const extra of [input.today ?? null, ...(input.include ?? [])]) {
    const x = dayNumber(extra ?? null);
    if (x === null) continue;
    if (x < d0 && d0 - x <= REACH_DAYS) d0 = x - 2;
    if (x >= d1 && x - d1 < REACH_DAYS) d1 = x + 3;
  }
  if (d1 - d0 < MIN_SPAN) {
    const pad = Math.ceil((MIN_SPAN - (d1 - d0)) / 2);
    d0 -= pad;
    d1 += pad;
  }
  if (d1 - d0 > MAX_SPAN) d1 = d0 + MAX_SPAN;
  const lo = d0;
  const hi = d1;
  const span = hi - lo;

  const at = (day: number | null | undefined): number | null => {
    if (!finite(day) || day < lo || day > hi) return null;
    const x = (day - lo) / span;
    return Number.isFinite(x) ? x : null;
  };
  const clampAt = (day: number | null | undefined): number | null => {
    if (!finite(day)) return null;
    const x = (day - lo) / span;
    return Number.isFinite(x) ? clamp01(x) : null;
  };

  // Meses: rótulo no primeiro dia de cada mês dentro do eixo (o ano entra quando a janela passa de ~11 meses).
  const monthStarts: number[] = [];
  const first = partsOf(lo);
  let y = first.y;
  let m = first.d === 1 ? first.m : first.m + 1;
  for (let guard = 0; guard < 60; guard += 1) {
    if (m > 11) { m = 0; y += 1; }
    const day = Math.round(Date.UTC(y, m, 1) / DAY_MS);
    if (day >= hi) break;
    monthStarts.push(day);
    m += 1;
  }
  const every = Math.max(1, Math.ceil(monthStarts.length / 12));
  const withYear = span > 330;
  const months = monthStarts
    .filter((_, i) => i % every === 0)
    .map((day) => {
      const p = partsOf(day);
      return { key: `m${day}`, x: at(day) as number, label: withYear && (p.m === 0 || day === monthStarts[0]) ? `${MONTHS_PT[p.m]} ${String(p.y).slice(2)}` : MONTHS_PT[p.m] };
    })
    .filter((mm) => finite(mm.x));

  // Marcas de dia nas segundas-feiras: semanais até ~10 semanas, quinzenais até ~5 meses; depois só os meses.
  const step = span <= 70 ? 7 : span <= 150 ? 14 : 0;
  const ticks: GanttScale['ticks'] = [];
  if (step > 0) {
    let first = lo + 1;
    while (weekday(first) !== 1) first += 1;
    for (let day = first; day < hi; day += step) {
      const p = partsOf(day);
      // colado no rótulo do mês (logo depois dele, ou logo antes do próximo)
      if (p.d < 6 || daysInMonth(p.y, p.m) - p.d < 2) continue;
      const x = at(day);
      if (x !== null) ticks.push({ key: `t${day}`, x, label: String(p.d).padStart(2, '0') });
    }
  }
  return { d0: lo, d1: hi, at, clampAt, months, ticks };
}

/** 0 = domingo … 6 = sábado (1970-01-01 foi uma quinta-feira). */
export const weekday = (day: number): number => (((day + 4) % 7) + 7) % 7;
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Onde vai a pílula da linha (CRÍTICA / VENCIDA / BLOQUEADA): depois da
 * barra quando cabe; senão antes do início; senão por dentro, no fim da
 * barra. `w` é a largura do eixo em px (0 = ainda não medido).
 */
export function pillSide(start: number, end: number, w: number, label: string): 'after' | 'before' | 'inside' {
  if (!(w > 0)) return end <= 0.74 ? 'after' : start > 0.3 ? 'before' : 'inside';
  const need = 54 + label.length * 9;
  if ((1 - end) * w + 20 >= need) return 'after';
  if (start * w >= need) return 'before';
  return 'inside';
}

/** Largura estimada (px) de uma bandeira do calendário ("HOJE · 25 SET"). */
export const flagWidth = (label: string): number => 22 + label.length * 7.4;

/**
 * Lados das bandeiras "Hoje" e "Necessário até" (as duas acima do calendário):
 * cada uma à direita da sua linha, virando para a esquerda perto da borda; se
 * as duas se encostam, a mais à esquerda vira para a esquerda. Ainda assim
 * encostadas, a da necessidade desce para a faixa do calendário ("strip").
 */
export function flagSides(input: {
  todayX: number | null; needX: number | null; w: number; todayLabel: string; needLabel: string;
}): { today: 'right' | 'left'; need: 'right' | 'left' | 'strip' } {
  const { todayX, needX, w } = input;
  const tw = flagWidth(input.todayLabel);
  const nw = flagWidth(input.needLabel);
  const own = (x: number | null, fw: number): 'right' | 'left' => {
    if (x === null) return 'right';
    if (w > 0) return x * w + 12 + fw <= w + 20 ? 'right' : 'left';
    return x > 0.74 ? 'left' : 'right';
  };
  let today = own(todayX, tw);
  let need: 'right' | 'left' | 'strip' = own(needX, nw);
  if (todayX === null || needX === null || !(w > 0)) return { today, need };
  const span = (x: number, fw: number, side: 'right' | 'left') => (side === 'right' ? [x * w + 12, x * w + 12 + fw] : [x * w - 12 - fw, x * w - 12]);
  const overlap = (a: number[], b: number[]) => a[0] < b[1] + 8 && b[0] < a[1] + 8;
  if (!overlap(span(todayX, tw, today), span(needX, nw, need))) return { today, need };
  // A da esquerda vira para a esquerda; a da direita fica à direita.
  if (todayX <= needX) { today = 'left'; need = 'right'; } else { today = 'right'; need = 'left'; }
  const fits = (x: number, fw: number, side: 'right' | 'left') => {
    const [a, b] = span(x, fw, side);
    return a >= -20 && b <= w + 20;
  };
  if (!fits(todayX, tw, today) || !fits(needX, nw, need) || overlap(span(todayX, tw, today), span(needX, nw, need))) {
    return { today: own(todayX, tw), need: 'strip' };
  }
  return { today, need };
}

export type BarTone = 'done' | 'run' | 'plan' | 'warn';

export interface GanttRowView {
  id: string;
  title: string;
  level: number;
  summary: boolean;
  milestone: boolean;
  critical: boolean;
  atRisk: boolean;
  overdue: boolean;
  blocked: boolean;
  /** 0..100, ou null quando o cronograma não informa. */
  pct: number | null;
  pctText: string;
  tone: BarTone;
  /** Frações do eixo (presas em [0, 1]); null = sem data ou fora da janela. */
  bar: { x0: number; x1: number } | null;
  /** Fração do losango do marco; null = sem data ou fora da janela. */
  diamond: number | null;
  pill: { kind: 'overdue' | 'blocked' | 'critical'; label: string } | null;
  statusLabel: string;
  span: string;
}

const DONE_STATUS = /^(completed|complete|done|concluded|finished|concluida|concluída|closed)$/i;
const RUN_STATUS = /^(in_progress|started|running|em_andamento|ongoing)$/i;

/**
 * `percent` do cronograma em 0..100 (o `percent_complete` da origem). Número
 * inválido → null ("—"), nunca 0.
 */
export function percentOf(value: number | null | undefined): number | null {
  if (!finite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

export function barTone(a: Pick<GanttActivity, 'percent' | 'status' | 'atRisk'>): BarTone {
  const pct = percentOf(a.percent);
  if ((pct !== null && pct >= 100) || DONE_STATUS.test(a.status ?? '')) return 'done';
  if (a.atRisk) return 'warn';
  if ((pct !== null && pct > 0) || RUN_STATUS.test(a.status ?? '')) return 'run';
  return 'plan';
}

export function ganttRows(activities: GanttActivity[], scale: GanttScale): GanttRowView[] {
  return activities.map((a) => {
    const pct = percentOf(a.percent);
    let s = dayNumber(a.start);
    let f = dayNumber(a.finish);
    if (s === null) s = f;
    if (f === null) f = s;
    if (s !== null && f !== null && f < s) [s, f] = [f, s];
    let bar: GanttRowView['bar'] = null;
    let diamond: number | null = null;
    if (a.isMilestone) {
      diamond = scale.at(s);
    } else if (s !== null && f !== null && f + 1 > scale.d0 && s < scale.d1) {
      const x0 = scale.clampAt(s);
      const x1 = scale.clampAt(f + 1);
      if (x0 !== null && x1 !== null && x1 > x0) bar = { x0, x1 };
    }
    const pill: GanttRowView['pill'] = a.overdue ? { kind: 'overdue', label: 'Vencida' }
      : a.blocked ? { kind: 'blocked', label: 'Bloqueada' }
        : a.critical ? { kind: 'critical', label: 'Crítica' } : null;
    return {
      id: a.id,
      title: a.title?.trim() || 'Atividade sem título',
      level: finite(a.level) && a.level > 0 ? Math.min(6, Math.floor(a.level)) : 0,
      summary: Boolean(a.isSummary),
      milestone: Boolean(a.isMilestone),
      critical: Boolean(a.critical),
      atRisk: Boolean(a.atRisk),
      overdue: Boolean(a.overdue),
      blocked: Boolean(a.blocked),
      pct,
      pctText: pct === null ? '—' : `${Math.round(pct)}%`,
      tone: barTone(a),
      bar,
      diamond,
      pill,
      statusLabel: a.statusLabel ?? '',
      span: spanLabel(a.start, a.finish),
    };
  });
}

/** A atividade em foco: a escolhida (se ainda existe) → o foco do servidor → a primeira folha → a primeira. */
export function focusActivity(plan: Pick<SitePlanData, 'activities' | 'focus'>, picked: string | null): GanttActivity | null {
  const byId = (id: string | null) => (id ? plan.activities.find((a) => a.id === id) ?? null : null);
  return byId(picked) ?? byId(plan.focus) ?? plan.activities.find((a) => !a.isSummary) ?? plan.activities[0] ?? null;
}

/** Faixa hachurada entre hoje e a necessidade (em qualquer ordem); null quando falta uma das datas ou ambas estão fora do eixo. */
export function gapSpan(scale: GanttScale, today: string | null | undefined, needBy: string | null | undefined): { x0: number; x1: number } | null {
  const t = dayNumber(today);
  const n = dayNumber(needBy);
  if (t === null || n === null || t === n) return null;
  if (scale.at(t) === null && scale.at(n) === null) return null;
  const x0 = scale.clampAt(Math.min(t, n));
  const x1 = scale.clampAt(Math.max(t, n));
  if (x0 === null || x1 === null || !(x1 > x0)) return null;
  return { x0, x1 };
}

export interface LinkPath { key: string; d: string; toFocus: boolean }

/**
 * As dependências como caminhos SVG em px (a gramática do protótipo: desce
 * logo depois do predecessor e corre na linha do sucessor; se o sucessor
 * começa antes, entra por cima). Qualquer coordenada não finita descarta o
 * elo — nunca "NaN" num `d`.
 */
export function ganttLinkPaths(
  links: GanttLink[], rows: GanttRowView[], dims: { w: number; rowH: number }, focusId: string | null,
): LinkPath[] {
  const { w, rowH } = dims;
  if (!finite(w) || !finite(rowH) || w <= 0 || rowH <= 0) return [];
  const index = new Map(rows.map((r, i) => [r.id, i]));
  const k = rowH / 66; // o protótipo desenha em linhas de 66 px
  const startOf = (r: GanttRowView) => r.bar?.x0 ?? r.diamond;
  const endOf = (r: GanttRowView) => r.bar?.x1 ?? r.diamond;
  const out: LinkPath[] = [];
  for (const link of links) {
    const ia = index.get(link.from);
    const ib = index.get(link.to);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const a = rows[ia];
    const b = rows[ib];
    const type = link.type ?? 'FS';
    const fa = type === 'SS' || type === 'SF' ? startOf(a) : endOf(a);
    const fb = type === 'FF' || type === 'SF' ? endOf(b) : startOf(b);
    if (fa === null || fa === undefined || fb === null || fb === undefined) continue;
    const x1 = fa * w;
    const x2 = fb * w;
    const y1 = (ia + 0.5) * rowH;
    const y2 = (ib + 0.5) * rowH;
    const sy = y2 > y1 ? 1 : -1;
    const r = (n: number) => Math.round(n * 10) / 10;
    const P = (n: number) => r(n * k);
    let d: string;
    if (x2 - x1 > P(34)) {
      d = `M${r(x1)},${r(y1)} L${r(x1 + P(10))},${r(y1)} Q${r(x1 + P(18))},${r(y1)} ${r(x1 + P(18))},${r(y1 + sy * P(8))}`
        + ` L${r(x1 + P(18))},${r(y2 - sy * P(8))} Q${r(x1 + P(18))},${r(y2)} ${r(x1 + P(26))},${r(y2)} L${r(x2 - P(4))},${r(y2)}`;
    } else {
      const lane = y2 - sy * (P(11) + P(10));
      d = `M${r(x1)},${r(y1)} L${r(x1 + P(10))},${r(y1)} Q${r(x1 + P(18))},${r(y1)} ${r(x1 + P(18))},${r(y1 + sy * P(8))}`
        + ` L${r(x1 + P(18))},${r(lane - sy * P(8))} Q${r(x1 + P(18))},${r(lane)} ${r(x1 + P(10))},${r(lane)}`
        + ` L${r(x2 - P(14))},${r(lane)} Q${r(x2 - P(22))},${r(lane)} ${r(x2 - P(22))},${r(lane + sy * P(8))}`
        + ` L${r(x2 - P(22))},${r(y2)} L${r(x2 - P(4))},${r(y2)}`;
    }
    if (/NaN|Infinity/.test(d)) continue;
    out.push({ key: `${link.from}>${link.to}:${type}`, d, toFocus: link.to === focusId });
  }
  return out;
}

/* ── Necessidades da atividade ──────────────────────────────────────────── */

export type NeedTone = 'ok' | 'partial' | 'warn' | 'late' | 'unknown';

/**
 * Tom da necessidade pela cobertura viva: coberta (verde), parcial (âmbar),
 * em falta (linha âmbar, a "Em risco" do protótipo). Sem cobertura calculável
 * (documento, dependência do cliente…), só a DATA fala: necessidade já
 * passada → âmbar; senão neutro.
 */
export function needTone(n: Pick<ActivityNeed, 'status' | 'requiredBy'>, today?: string | null): NeedTone {
  switch (n.status) {
    case 'covered': return 'ok';
    case 'partial': return 'partial';
    case 'short': return 'warn';
    default: {
      const due = dayNumber(n.requiredBy);
      const now = dayNumber(today ?? null);
      return due !== null && now !== null && due < now ? 'late' : 'unknown';
    }
  }
}

/** Quantidade com a unidade do requisito ("1.200 m"); sem número → null (a linha mostra só o título). */
export function qtyText(value: number | null | undefined, unit?: string | null): string | null {
  if (!finite(value)) return null;
  const s = value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unit ? `${s} ${unit}` : s;
}

/* ══════════════════════════════════════════════════════════════════════════
   SUPPLY — balanço, pedidos e a camada do mapa
   ══════════════════════════════════════════════════════════════════════════ */

export interface BalanceRow { key: string; label: string; text: string; tone: 'default' | 'ok' | 'danger' | 'good' }

/**
 * As linhas do balanço (cobertura VIVA, na unidade do requisito): Necessário,
 * Reservado, Consumido, Em trânsito, Pedido — e Em requisição / Em inspeção
 * quando existem —, Coberto e Falta. Falta zero é dita: "0 m · coberto".
 */
export function balanceRows(m: MaterialBalance): BalanceRow[] {
  const unit = m.item?.unit ?? null;
  const t = (v: number) => qtyText(v, unit) ?? '—';
  const rows: BalanceRow[] = [
    { key: 'required', label: 'Necessário', text: t(m.required), tone: 'default' },
    { key: 'reserved', label: 'Reservado', text: t(m.reserved), tone: 'default' },
    { key: 'consumed', label: 'Consumido', text: t(m.consumed), tone: 'default' },
    { key: 'inTransit', label: 'Em trânsito', text: t(m.inTransit), tone: 'default' },
    { key: 'onOrder', label: 'Pedido', text: t(m.onOrder), tone: 'default' },
  ];
  if (finite(m.requested) && m.requested > 0) rows.push({ key: 'requested', label: 'Em requisição', text: t(m.requested), tone: 'default' });
  if (finite(m.inspection) && m.inspection > 0) rows.push({ key: 'inspection', label: 'Em inspeção', text: t(m.inspection), tone: 'default' });
  rows.push({ key: 'covered', label: 'Coberto', text: t(m.covered), tone: 'ok' });
  if (!finite(m.shortage)) rows.push({ key: 'shortage', label: 'Falta', text: '—', tone: 'default' });
  else if (m.shortage > 0) rows.push({ key: 'shortage', label: 'Falta', text: t(m.shortage), tone: 'danger' });
  else rows.push({ key: 'shortage', label: 'Falta', text: `${t(0)} · coberto`, tone: 'good' });
  return rows;
}

export interface CoverageSegment { key: 'covered' | 'inbound' | 'shortage'; label: string; qty: number; text: string }

/** A barra de cobertura: coberto → a caminho → falta, proporcional; nada quando não há quantidade. */
export function coverageSegments(m: MaterialBalance): CoverageSegment[] {
  const pos = (v: unknown) => (finite(v) && v > 0 ? v : 0);
  const unit = m.item?.unit ?? null;
  const parts: CoverageSegment[] = [
    { key: 'covered', label: 'Coberto', qty: pos(m.covered), text: '' },
    { key: 'inbound', label: 'A caminho', qty: pos(m.inbound), text: '' },
    { key: 'shortage', label: 'Falta', qty: pos(m.shortage), text: '' },
  ];
  return parts.filter((p) => p.qty > 0).map((p) => ({ ...p, text: `${p.label} · ${qtyText(p.qty, unit)}` }));
}

export interface OrderTiming { tone: 'late' | 'ok' | 'none'; text: string }

/** Chegada do pedido COMPARADA à necessidade — "chega N dias depois da necessidade", nunca "atrasa a obra". */
export function orderTiming(o: Pick<InboundOrder, 'expected' | 'late' | 'lateDays'>, needBy: string | null | undefined): OrderTiming {
  if (o.late) {
    const n = finite(o.lateDays) && o.lateDays > 0 ? Math.round(o.lateDays) : null;
    return { tone: 'late', text: n === null ? 'chega depois da necessidade' : `chega ${n} ${n === 1 ? 'dia' : 'dias'} depois da necessidade` };
  }
  if (!o.expected || dayNumber(o.expected) === null) return { tone: 'none', text: 'sem previsão de chegada' };
  if (needBy && dayNumber(needBy) !== null) return { tone: 'ok', text: 'chega até a necessidade' };
  return { tone: 'none', text: `previsão ${dayMonth(o.expected)}` };
}

export function validPoint(lat: unknown, lng: unknown): boolean {
  return finite(lat) && finite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  return Number.isFinite(d) ? d : 0;
}

/**
 * Supply (GLOBE.md §3): centro do retângulo, pitch 64, rumo −6, ox −20, oy −30,
 * distância presa em 60–2400 km. A distância ENCAIXA os pontos no vão entre
 * os painéis (FOV vertical 32°): no eixo norte–sul, meia cobertura ≈
 * D·tan16°/sin64° ≈ 0,32·D com ~80 % da altura livre; no leste–oeste,
 * ≈ 0,46·D com ~37 % da largura livre (os painéis ocupam os lados), mais
 * 15 % de folga. Daí D = max(NS × 2,25, LO × 3,4). A regra "diagonal × 1,4"
 * deixava Marabá e Belém fora da tela no QA; esta reproduz os 2.200 km do
 * protótipo para a rede dele. `ox` −60 (e não −20): os cartões `wl-node`
 * abrem à DIREITA do ponto, e o do almoxarifado mais a leste ficava sob o
 * painel da direita.
 */
export const SUPPLY_FRAME = { ns: 2.25, ew: 3.4, min: 60, max: 2400, pitch: 64, heading: -6, ox: -60, oy: -30 } as const;

export function frameView(points: Array<{ lat: number; lng: number }>): CameraView | null {
  const pts = points.filter((p) => validPoint(p.lat, p.lng));
  if (pts.length === 0) return null;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) };
  const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) };
  const midLat = (sw.lat + ne.lat) / 2;
  const nsKm = haversineKm({ lat: sw.lat, lng: sw.lng }, { lat: ne.lat, lng: sw.lng });
  const ewKm = haversineKm({ lat: midLat, lng: sw.lng }, { lat: midLat, lng: ne.lng });
  const dist = Math.min(SUPPLY_FRAME.max, Math.max(SUPPLY_FRAME.min, nsKm * SUPPLY_FRAME.ns, ewKm * SUPPLY_FRAME.ew));
  const view: CameraView = {
    lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2, dist,
    pitch: SUPPLY_FRAME.pitch, heading: SUPPLY_FRAME.heading, ox: SUPPLY_FRAME.ox, oy: SUPPLY_FRAME.oy,
  };
  return Object.values(view).every((v) => Number.isFinite(v)) ? view : null;
}

/** Abaixo disto o almoxarifado está no próprio canteiro: cartão sim, arco (de comprimento zero) não. */
const SAME_PLACE_KM = 1;

export function stockNodeValue(n: Pick<StockNode, 'available'>, unit: string | null): string {
  return finite(n.available) && n.available > 0 ? `${qtyText(n.available, unit)} disponíveis` : 'sem saldo disponível';
}

/**
 * O que o Supply põe no mapa: um cartão (`wl-node`) por posição do item com
 * coordenada, um arco de cada uma até o canteiro — cheio e com fluxo quando
 * há saldo disponível, tracejado e apagado quando não há — e o enquadramento
 * que cabe canteiro + almoxarifados. Sem nenhuma posição localizada além do
 * canteiro, `view: null` (a página usa o preset). Fornecedor não tem
 * coordenada: não há arco inventado.
 */
export function supplyMapLayer(data: Pick<SiteSupplyData, 'stock' | 'site' | 'focus'>): MapLayer {
  const site = data.site && validPoint(data.site.lat, data.site.lng) ? { lat: data.site.lat, lng: data.site.lng } : null;
  const unit = data.focus?.item?.unit ?? null;
  const seen = new Set<string>();
  const located = (data.stock.state === 'ok' ? data.stock.data : [])
    .filter((n) => !n.isSite && validPoint(n.lat, n.lng))
    .filter((n) => (seen.has(n.locationId) ? false : (seen.add(n.locationId), true)));
  const nodes: GlobeNode[] = located.map((n) => ({
    id: `stock:${n.locationId}`, lat: n.lat as number, lng: n.lng as number,
    title: n.name, value: stockNodeValue(n, unit), tone: finite(n.available) && n.available > 0 ? 'hit' : 'none',
  }));
  const arcs: GlobeArc[] = [];
  if (site) {
    for (const n of located) {
      const from = { lat: n.lat as number, lng: n.lng as number };
      const km = haversineKm(from, site);
      if (!(km >= SAME_PLACE_KM)) continue;
      const hit = finite(n.available) && n.available > 0;
      const h = Math.min(160, Math.max(12, km * 0.16)) * (hit ? 1 : 0.65);
      arcs.push({
        id: `stock:${n.locationId}`, from, to: site, h: Math.round(h * 10) / 10,
        tone: hit ? 'completed' : 'healthy', dash: hit ? null : [6, 8], flow: hit ? 0.4 : 0,
        width: hit ? 2 : 1.2, alpha: hit ? 0.95 : 0.4,
      });
    }
  }
  const view = located.length > 0 ? frameView(site ? [site, ...located.map((n) => ({ lat: n.lat as number, lng: n.lng as number }))] : located.map((n) => ({ lat: n.lat as number, lng: n.lng as number }))) : null;
  return { arcs, nodes, view };
}

/* ══════════════════════════════════════════════════════════════════════════
   FATURAMENTO — eventograma e a cadeia do evento
   ══════════════════════════════════════════════════════════════════════════ */

export type EventTone = 'muted' | 'accent' | 'ok' | 'danger' | 'cancelled';

/** Cores do protótipo: Aguardando apagado, Elegível/Liberação em teal, Faturado/Recebível/Pago em verde. */
export const EVENT_TONE: Record<EventogramState, EventTone> = {
  awaiting: 'muted', eligible: 'accent', pending_release: 'accent', released: 'accent',
  invoiced: 'ok', receivable: 'ok', paid: 'ok', blocked: 'danger', cancelled: 'cancelled',
};
export const eventTone = (state: string): EventTone => EVENT_TONE[state as EventogramState] ?? 'muted';

/** A linha de contexto do evento: medição · NF · recebível — só o que existe, sem repetir o estado da linha. */
export function eventContext(row: Pick<EventogramRow, 'measurement' | 'fiscal' | 'receivable'> & { stateLabel?: string }): string {
  const parts: string[] = [];
  if (row.measurement?.statusLabel) parts.push(`Medição ${row.measurement.statusLabel.toLowerCase()}`);
  const fiscalIsState = !!row.fiscal && !row.fiscal.number && !!row.stateLabel && row.fiscal.statusLabel === row.stateLabel;
  if (row.fiscal && !fiscalIsState) {
    const nf = row.fiscal.number ? `NF ${row.fiscal.number}` : 'NF';
    parts.push(row.fiscal.statusLabel ? `${nf} · ${row.fiscal.statusLabel.toLowerCase()}` : nf);
  }
  if (row.receivable) {
    const due = row.receivable.due && dayNumber(row.receivable.due) !== null ? `vence ${dayMonth(row.receivable.due)}` : null;
    const st = row.receivable.stateLabel ? row.receivable.stateLabel.toLowerCase() : null;
    const txt = [st, due].filter(Boolean).join(' · ');
    if (txt) parts.push(txt);
  }
  return parts.join(' · ');
}

/**
 * A referência "Entender" do evento escolhido. O servidor só dá a do evento
 * em foco; os outros eventos usam o mesmo formato documentado (`bill:<id>`) —
 * e só quando a do foco existe (sem ela, a pessoa não lê a cadeia).
 */
export function billingRef(data: { focus: string | null; focusExplainRef: string | null }, selectedId: string | null): string | null {
  if (!data.focusExplainRef || !selectedId) return null;
  return selectedId === data.focus ? data.focusExplainRef : `bill:${selectedId}`;
}

export type StepState = 'done' | 'wait' | 'attention' | 'danger' | 'pending' | 'restricted' | 'none';

/**
 * Estado do passo no stepper do protótipo, pelo ESTADO do elo (nunca pelo
 * texto): registrado → feito (verde) — ou em espera (teal) quando o registro
 * aguarda algo, ou vermelho quando recusado/vencido; a confirmar/sem registro
 * esperado → atenção; ainda não nasceu → pendente; Restrito → cadeado.
 */
export function stepState(link: Pick<ChainLink, 'state' | 'tone'>): StepState {
  switch (link.state) {
    case 'found': return link.tone === 'danger' ? 'danger' : link.tone === 'warning' ? 'wait' : 'done';
    case 'unconfirmed': return 'attention';
    case 'restricted': return 'restricted';
    case 'pending': return 'pending';
    case 'none': return link.tone === 'warning' || link.tone === 'danger' ? 'attention' : 'none';
    default: return 'none';
  }
}

export const STEP_STATE_LABEL: Record<StepState, string> = {
  done: 'registrado', wait: 'em andamento', attention: 'a verificar', danger: 'recusado ou vencido',
  pending: 'ainda não nasceu', restricted: 'Restrito', none: 'sem vínculo registrado',
};
