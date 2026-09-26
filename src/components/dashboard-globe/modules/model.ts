/**
 * MÓDULOS DO LOCAL — regras de TELA em código puro (sem React, sem CSS).
 *
 * Planejar, Supply Chain e Faturamento desenham os dados do servidor na
 * gramática do protótipo APEX FILM. Aqui mora só o COMO desenhar: a escala do
 * Gantt (dia → fração do eixo, com guarda de NaN em toda coordenada), os
 * caminhos das dependências, a camada do mapa do Supply (arcos, cartões,
 * enquadramento e a VARREDURA da rede), as linhas do balanço de material, o
 * fluxo guiado do Supply (plano → solicitação → fornecedores → A × B, com os
 * corpos exatos das rotas governadas) e o tom de cada estado do eventograma.
 * Nada aqui inventa dado: o que não veio não vira número.
 */
import type { CameraView, GlobeArc, GlobeNode, GlobeScan, MapLayer } from '../contract';
import type {
  ActivityNeed, ChainLink, EventogramRow, EventogramState, ExternalSupplierCandidate, GanttActivity, GanttLink, InboundOrder,
  MaterialBalance, PlanStepKind, QuoteOption, RequisitionView, RfqView, SectionState, SitePlanData, SiteSupplyData, StockNode,
  SupplierCandidate, SupplyCapabilities, SupplyPlan, SupplyPlanStep,
} from '@/lib/dashboard/types';
import { SUPPLIER_STATUS_LABEL } from '@/lib/supply/procurement';

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

export type FrameSpec = { ns: number; ew: number; min: number; max: number; pitch: number; heading: number; ox: number; oy: number };

export function frameView(points: Array<{ lat: number; lng: number }>, frame: FrameSpec = SUPPLY_FRAME): CameraView | null {
  const pts = points.filter((p) => validPoint(p.lat, p.lng));
  if (pts.length === 0) return null;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) };
  const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) };
  const midLat = (sw.lat + ne.lat) / 2;
  const nsKm = haversineKm({ lat: sw.lat, lng: sw.lng }, { lat: ne.lat, lng: sw.lng });
  const ewKm = haversineKm({ lat: midLat, lng: sw.lng }, { lat: midLat, lng: ne.lng });
  const dist = Math.min(frame.max, Math.max(frame.min, nsKm * frame.ns, ewKm * frame.ew));
  const view: CameraView = {
    lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2, dist,
    pitch: frame.pitch, heading: frame.heading, ox: frame.ox, oy: frame.oy,
  };
  return Object.values(view).every((v) => Number.isFinite(v)) ? view : null;
}

/** Abaixo disto o almoxarifado está no próprio canteiro: cartão sim, arco (de comprimento zero) não. */
const SAME_PLACE_KM = 1;

type LatLng = { lat: number; lng: number };

export function stockNodeValue(n: Pick<StockNode, 'available'>, unit: string | null): string {
  return finite(n.available) && n.available > 0 ? `${qtyText(n.available, unit)} disponíveis` : 'sem saldo disponível';
}

const hasStock = (n: Pick<StockNode, 'available'>) => finite(n.available) && n.available > 0;
const pointOf = (n: Pick<StockNode, 'lat' | 'lng'>): LatLng => ({ lat: n.lat as number, lng: n.lng as number });
/** Id do nó/arco de uma posição de estoque no mapa — o MESMO nos resultados da varredura. */
export const stockNodeId = (locationId: string) => `stock:${locationId}`;

/** O canteiro deste projeto (a origem dos arcos e dos anéis); `null` sem coordenada válida. */
export function sitePoint(data: Pick<SiteSupplyData, 'site'>): LatLng | null {
  return data.site && validPoint(data.site.lat, data.site.lng) ? { lat: data.site.lat, lng: data.site.lng } : null;
}

/** As posições do item em OUTROS locais, com coordenada válida, uma por local. */
export function locatedStock(data: Pick<SiteSupplyData, 'stock'>): StockNode[] {
  const seen = new Set<string>();
  return (data.stock.state === 'ok' ? data.stock.data : [])
    .filter((n) => !n.isSite && validPoint(n.lat, n.lng))
    .filter((n) => (seen.has(n.locationId) ? false : (seen.add(n.locationId), true)));
}

/** Um arco de cada posição até o canteiro — cheio e com fluxo com saldo; tracejado e apagado sem. No mesmo lugar, nenhum. */
function stockArcs(site: LatLng | null, located: StockNode[]): GlobeArc[] {
  const arcs: GlobeArc[] = [];
  if (!site) return arcs;
  for (const n of located) {
    const from = pointOf(n);
    const km = haversineKm(from, site);
    if (!(km >= SAME_PLACE_KM)) continue;
    const hit = hasStock(n);
    const h = Math.min(160, Math.max(12, km * 0.16)) * (hit ? 1 : 0.65);
    arcs.push({
      id: stockNodeId(n.locationId), from, to: site, h: Math.round(h * 10) / 10,
      tone: hit ? 'completed' : 'healthy', dash: hit ? null : [6, 8], flow: hit ? 0.4 : 0,
      width: hit ? 2 : 1.2, alpha: hit ? 0.95 : 0.4,
    });
  }
  return arcs;
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
  const site = sitePoint(data);
  const unit = data.focus?.item?.unit ?? null;
  const located = locatedStock(data);
  const nodes: GlobeNode[] = located.map((n) => ({
    id: stockNodeId(n.locationId), ...pointOf(n), title: n.name, value: stockNodeValue(n, unit), tone: hasStock(n) ? 'hit' : 'none',
  }));
  const arcs = stockArcs(site, located);
  const view = located.length > 0 ? frameView(site ? [site, ...located.map(pointOf)] : located.map(pointOf)) : null;
  return { arcs, nodes, view };
}

/* ══════════════════════════════════════════════════════════════════════════
   SUPPLY — o fluxo guiado do filme (cena 3): necessidade → "Analisar a rede
   de estoque" (a câmera recua e varre o mapa) → plano do Apex → solicitação
   → fornecedores → cotações A × B → a decisão de quem tem a alçada.
   ══════════════════════════════════════════════════════════════════════════ */

/** Etapa do fluxo na tela: perto do canteiro, varrendo, plano revelado (depois da varredura) ou direto (atalho, sem varredura). */
export type SupplyStage = 'idle' | 'scanning' | 'revealed' | 'direct';

export const SCAN_STATUS_TEXT = 'Apex analisando a rede de estoque';
export const SCAN_PENDING_TEXT = 'consultando…';
/** Deriva lenta depois do pouso — "procurando" (filme, 18,6 → 25 s). */
export const SCAN_DRIFT = { headingDeg: -4, distK: 0.95, seconds: 4.6 } as const;
export const SCAN_MIN_KM = 30;
/** O anel passa um pouco além do nó mais longe (a última resposta chega com folga). */
export const SCAN_REACH = 1.15;
/**
 * Rede de segurança: sem o aviso "done" do globo (motor travado, aba em segundo plano), o plano aparece
 * assim mesmo, este tempo depois da releitura. A varredura do motor leva ~5,5 s (recuo + anéis + respostas).
 */
export const SCAN_FALLBACK_MS = 8000;
/** Os passos do plano entram um a um (filme: 22,1 s + i × 0,32 s). */
export const PLAN_STAGGER_MS = 320;
/**
 * Depois que o ÚLTIMO passo do plano começa a entrar: a entrada (0,45 s) e um
 * instante de leitura; então o fluxo assenta (o plano feito fecha e a etapa
 * "agora" vem à vista no painel).
 */
export const FLOW_SETTLE_MS = 2250;

/** Alcance dos anéis, km: a distância do nó mais longe × 1,15, nunca abaixo de 30 km. */
export function scanRadiusKm(site: LatLng, nodes: Array<Pick<StockNode, 'lat' | 'lng'>>): number {
  let far = 0;
  for (const n of nodes) {
    if (!validPoint(n.lat, n.lng)) continue;
    const d = haversineKm(site, pointOf(n));
    if (Number.isFinite(d) && d > far) far = d;
  }
  return Math.max(SCAN_MIN_KM, Math.round(far * SCAN_REACH * 10) / 10);
}

/** A resposta de cada nó — o MESMO texto do cartão ("250 m disponíveis" · "sem saldo disponível"). */
export function scanResults(nodes: StockNode[], unit: string | null): Record<string, { tone: 'hit' | 'none'; value: string }> {
  const out: Record<string, { tone: 'hit' | 'none'; value: string }> = {};
  for (const n of nodes) out[stockNodeId(n.locationId)] = { tone: hasStock(n) ? 'hit' : 'none', value: stockNodeValue(n, unit) };
  return out;
}

/**
 * Antes da varredura o módulo abre PERTO do canteiro, sem nós nem arcos
 * (filme, 16 s: a usina de perto, painel à esquerda) — o canteiro cai à
 * direita do painel "Necessidade".
 */
export const SITE_CLOSE = { dist: 1.8, pitch: 46, heading: 64, ox: 170, oy: 40 } as const;

export function siteCloseView(site: LatLng | null): CameraView | null {
  if (!site || !validPoint(site.lat, site.lng)) return null;
  return { lat: site.lat, lng: site.lng, ...SITE_CLOSE };
}

/**
 * Enquadramento da varredura: o canteiro ± o alcance dos anéis (norte, sul,
 * leste, oeste) e os nós — o canteiro fica no centro do vão entre os painéis
 * e os anéis se abrem a partir dele. Fatores menores que os do Supply (os
 * anéis podem passar por baixo do vidro dos painéis; os nós, não).
 */
export const SCAN_FRAME: FrameSpec = { ns: 1.7, ew: 2.3, min: 60, max: 2400, pitch: 62, heading: -6, ox: 0, oy: -20 };

/**
 * Depois da varredura (plano revelado, ou o atalho direto): canteiro + nós
 * no vão entre os DOIS painéis — ~40 % mais longe que o `SUPPLY_FRAME` e o
 * alvo mais à esquerda, porque o cartão do nó mais a leste abre à DIREITA do
 * ponto (~290 px com o nome longo) e não pode cair sob o painel do plano.
 * Medido no QA (Tucuruí · Marabá · Belém, 1440 × 900).
 */
export const REVEAL_FRAME: FrameSpec = { ns: 3.2, ew: 4.8, min: 60, max: 2400, pitch: 64, heading: -6, ox: -120, oy: -30 };

/**
 * O VÃO LIVRE entre os painéis, medido na tela (px): o tamanho do palco (o
 * canvas do globo) e os limites do vão RELATIVOS AO CENTRO do palco (x →
 * direita, y → baixo). É o que o enquadramento depois da varredura respeita.
 */
export interface Corridor {
  width: number; height: number; left: number; right: number; top: number; bottom: number;
  /**
   * O globo ignora o deslocamento de tela (celular: a página zera ox/oy — o
   * alvo é sempre o centro). O conjunto é centrado no vão movendo o ALVO.
   */
  centered?: boolean;
}

/** Folgas de cada ponto no vão (px): o marcador do canteiro e o cartão `wl-node` (abre à DIREITA do ponto, 14 px dele). */
export const CORRIDOR_PAD = 14;
export const SITE_BOX = { l: 34, r: 34, u: 46, d: 34 } as const;
/** Medido no QA: "Almoxarifado Central — Belém" (28 caracteres, 16 px) = 253 px de cartão → ~8 px/caractere + 28 px de margem. */
const NODE_CARD = { gap: 14, pad: 30, namePx: 8.3, valuePx: 7.9, min: 120, max: 330, half: 38 } as const;

type Box = { l: number; r: number; u: number; d: number };

/** O cartão do nó: largura estimada pelo nome/valor (fonte 16/15 px do `wl-node`), aberto à direita do ponto. */
export function nodeCardBox(title: string, value: string | null): Box {
  const w = Math.min(NODE_CARD.max, Math.max(NODE_CARD.min,
    Math.max(title.length * NODE_CARD.namePx, (value ?? '').length * NODE_CARD.valuePx) + NODE_CARD.pad));
  return { l: 10, r: NODE_CARD.gap + w, u: NODE_CARD.half, d: NODE_CARD.half };
}

/**
 * Projeção de um ponto no chão para a tela (px, relativo ao ALVO), com a
 * câmera do globo: distância `dist` (km) até o alvo, `pitch` = ângulo abaixo
 * do horizonte, `heading` a partir do norte, campo vertical fixo de 32°.
 * Terra plana local (o erro é pequeno nos ~500 km de uma rede regional).
 */
export function projectToScreen(p: LatLng, target: LatLng, view: { dist: number; pitch: number; heading: number }, heightPx: number): { x: number; y: number } | null {
  const F = heightPx / 2 / Math.tan((16 * Math.PI) / 180);
  const kmLng = 111.195 * Math.cos((target.lat * Math.PI) / 180);
  const ex = (p.lng - target.lng) * kmLng;
  const ny = (p.lat - target.lat) * 111.195;
  const h = (view.heading * Math.PI) / 180;
  const pr = (view.pitch * Math.PI) / 180;
  const a = ex * Math.cos(h) - ny * Math.sin(h);
  const b = ex * Math.sin(h) + ny * Math.cos(h);
  const z = view.dist + b * Math.cos(pr);
  if (!(z > view.dist * 0.15)) return null;
  const out = { x: (F * a) / z, y: (-F * b * Math.sin(pr)) / z };
  return Number.isFinite(out.x) && Number.isFinite(out.y) ? out : null;
}

/** O inverso de `projectToScreen`: o ponto do chão que aparece em (x, y) px do alvo. `null` acima do horizonte. */
export function unprojectFromScreen(x: number, y: number, target: LatLng, view: { dist: number; pitch: number; heading: number }, heightPx: number): LatLng | null {
  const F = heightPx / 2 / Math.tan((16 * Math.PI) / 180);
  const pr = (view.pitch * Math.PI) / 180;
  const den = F * Math.sin(pr) + y * Math.cos(pr);
  if (!(Math.abs(den) > 1e-6)) return null;
  const b = (-y * view.dist) / den;
  const z = view.dist + b * Math.cos(pr);
  if (!(z > view.dist * 0.15)) return null;
  const a = (x * z) / F;
  const h = (view.heading * Math.PI) / 180;
  const ex = a * Math.cos(h) + b * Math.sin(h);
  const ny = -a * Math.sin(h) + b * Math.cos(h);
  const kmLng = 111.195 * Math.cos((target.lat * Math.PI) / 180);
  const out = { lat: target.lat + ny / 111.195, lng: target.lng + (kmLng > 1e-6 ? ex / kmLng : 0) };
  return validPoint(out.lat, out.lng) ? out : null;
}

/** Quanto o rumo pode girar (graus, para cada lado do rumo do filme) para a rede caber mais perto no vão. */
export const CORRIDOR_TURN = { maxDeg: 20, stepDeg: 2, costPerDeg: 0.01, centeredMaxDeg: 50 } as const;

/**
 * O enquadramento depois da varredura CONTRA O VÃO REAL: a menor distância
 * em que o canteiro (marcador) e cada nó com o seu cartão cabem inteiros
 * entre os dois painéis, e o deslocamento (ox, oy) que centra o conjunto no
 * vão. Os cartões abrem à DIREITA do ponto e o vão é estreito (≈ 440 px em
 * 1440 × 900): uma rede espalhada no leste–oeste só caberia muito longe. Por
 * isso o rumo pode girar até ±20° do rumo do filme (−6°) — o rumo em que a
 * rede cabe mais perto, com um custo pequeno por grau girado. `drift` (a
 * deriva lenta depois do pouso aproxima e gira a câmera) entra na conta: o
 * quadro é medido já com a deriva aplicada.
 */
export function corridorView(
  site: LatLng | null,
  nodes: Array<{ lat: number; lng: number; box: Box }>,
  corridor: Corridor,
  frame: FrameSpec = REVEAL_FRAME,
  drift: { headingDeg: number; distK: number } | null = null,
): CameraView | null {
  const pts = [...(site ? [{ lat: site.lat, lng: site.lng, box: SITE_BOX as Box }] : []), ...nodes]
    .filter((p) => validPoint(p.lat, p.lng));
  // Centrar movendo o alvo muda um pouco a perspectiva: 5 % de folga a mais nesse caso.
  const slack = corridor.centered ? 0.95 : 1;
  const W = (corridor.right - corridor.left - 2 * CORRIDOR_PAD) * slack;
  const H = (corridor.bottom - corridor.top - 2 * CORRIDOR_PAD) * slack;
  if (pts.length === 0 || !(W > 40) || !(H > 40) || !(corridor.height > 0)) return null;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const target = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
  const k = drift && finite(drift.distK) && drift.distK > 0 ? drift.distK : 1;
  const turn = drift && finite(drift.headingDeg) ? drift.headingDeg : 0;
  const extent = (dist: number, heading: number, at: LatLng = target) => {
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const p of pts) {
      const s = projectToScreen(p, at, { dist, pitch: frame.pitch, heading: heading + turn }, corridor.height);
      if (!s) return null;
      minX = Math.min(minX, s.x - p.box.l); maxX = Math.max(maxX, s.x + p.box.r);
      minY = Math.min(minY, s.y - p.box.u); maxY = Math.max(maxY, s.y + p.box.d);
    }
    return { minX, maxX, minY, maxY };
  };
  const fits = (dist: number, heading: number) => {
    const e = extent(dist, heading);
    return e !== null && e.maxX - e.minX <= W && e.maxY - e.minY <= H;
  };
  // A menor distância DEPOIS da deriva (`dist × distK`) em que tudo cabe com este rumo; `null` = não cabe nem no máximo.
  const fitDist = (heading: number): number | null => {
    let lo = frame.min * k;
    let hi = frame.max * k;
    if (fits(lo, heading)) return lo;
    if (!fits(hi, heading)) return null;
    for (let i = 0; i < 40 && hi - lo > 0.5; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid, heading)) hi = mid; else lo = mid;
    }
    return hi;
  };
  let best: { heading: number; dist: number; cost: number } | null = null;
  // Celular: o bloco do globo (≈ 390 × 370) é pequeno para cartões de ~260 px — o rumo pode girar mais para caber perto.
  const maxTurn = corridor.centered ? CORRIDOR_TURN.centeredMaxDeg : CORRIDOR_TURN.maxDeg;
  for (let d = -maxTurn; d <= maxTurn; d += CORRIDOR_TURN.stepDeg) {
    const heading = frame.heading + d;
    const dist = fitDist(heading);
    if (dist === null) continue;
    const cost = dist * (1 + CORRIDOR_TURN.costPerDeg * Math.abs(d));
    if (!best || cost < best.cost - 1e-6) best = { heading, dist, cost };
  }
  // Nem girando cabe: o rumo do filme, no máximo da distância (o mais perto de caber).
  const pick = best ?? { heading: frame.heading, dist: frame.max * k };
  const cx = (corridor.left + corridor.right) / 2;
  const cy = (corridor.top + corridor.bottom) / 2;
  // Globo sem deslocamento de tela (celular): o ALVO anda no chão até o conjunto ficar no centro do vão.
  let at: LatLng = target;
  if (corridor.centered) {
    for (let i = 0; i < 6; i += 1) {
      const c = extent(pick.dist, pick.heading, at);
      if (!c) break;
      const dx = cx - (c.minX + c.maxX) / 2;
      const dy = cy - (c.minY + c.maxY) / 2;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
      const next = unprojectFromScreen(-dx, -dy, at, { dist: pick.dist, pitch: frame.pitch, heading: pick.heading + turn }, corridor.height);
      if (!next) break;
      at = next;
    }
  }
  const e = extent(pick.dist, pick.heading, at);
  if (!e) return null;
  const view: CameraView = {
    lat: at.lat, lng: at.lng, dist: Math.min(frame.max, pick.dist / k), pitch: frame.pitch, heading: pick.heading,
    ox: corridor.centered ? 0 : Math.round(cx - (e.minX + e.maxX) / 2), oy: corridor.centered ? 0 : Math.round(cy - (e.minY + e.maxY) / 2),
  };
  return Object.values(view).every((v) => Number.isFinite(v)) ? view : null;
}

/** Um vão medido é usável? (sem medida, celular ou vão estreito demais → o enquadramento fixo `REVEAL_FRAME`). */
export function usableCorridor(c: Corridor | null | undefined): c is Corridor {
  return Boolean(c && [c.width, c.height, c.left, c.right, c.top, c.bottom].every(finite)
    && c.width > 0 && c.height > 0 && c.right - c.left >= 200 && c.bottom - c.top >= 200);
}

export function ringBox(site: LatLng, radiusKm: number): LatLng[] {
  const dLat = radiusKm / 111.195;
  const dLng = radiusKm / (111.195 * Math.max(0.05, Math.cos((site.lat * Math.PI) / 180)));
  const lat = (v: number) => Math.max(-89.9, Math.min(89.9, v));
  const lng = (v: number) => Math.max(-180, Math.min(180, v));
  return [
    { lat: lat(site.lat + dLat), lng: site.lng }, { lat: lat(site.lat - dLat), lng: site.lng },
    { lat: site.lat, lng: lng(site.lng + dLng) }, { lat: site.lat, lng: lng(site.lng - dLng) },
  ];
}

export function scanView(site: LatLng, radiusKm: number, nodes: Array<Pick<StockNode, 'lat' | 'lng'>>): CameraView | null {
  const pts = [site, ...ringBox(site, radiusKm), ...nodes.filter((n) => validPoint(n.lat, n.lng)).map(pointOf)];
  return frameView(pts, SCAN_FRAME);
}

/**
 * A camada do mapa do fluxo, por etapa:
 *  • idle — perto do canteiro, SEM nós nem arcos (o filme antes da varredura);
 *  • scanning/revealed — o enquadramento da rede, um cartão por posição
 *    (mesmos ids dos resultados), a varredura (`scan`: `null` por nó enquanto
 *    a releitura não voltou; depois, a resposta) e a deriva; os arcos só
 *    quando a resposta existe — antes dela nenhum arco adianta o resultado;
 *  • direct — a rede já respondida, sem varredura (atalho para a decisão).
 * Sem canteiro localizado não há origem: sem anéis, cartões sim, arco nenhum.
 */
export function supplyFlowLayer(
  data: Pick<SiteSupplyData, 'stock' | 'site' | 'focus'>,
  flow: { stage: SupplyStage; scanId: string | null; fresh: boolean; corridor?: Corridor | null },
): MapLayer {
  const site = sitePoint(data);
  if (flow.stage === 'idle') return { arcs: [], nodes: [], view: siteCloseView(site), scan: null, drift: null };
  const unit = data.focus?.item?.unit ?? null;
  const located = locatedStock(data);
  const answered = flow.fresh || flow.stage === 'direct';
  const nodes: GlobeNode[] = located.map((n) => ({
    id: stockNodeId(n.locationId), ...pointOf(n), title: n.name,
    value: answered ? stockNodeValue(n, unit) : null, tone: answered ? (hasStock(n) ? 'hit' : 'none') : 'default',
  }));
  const arcs = answered ? stockArcs(site, located) : [];
  const radiusKm = site ? scanRadiusKm(site, located) : SCAN_MIN_KM;
  const scanning = (flow.stage === 'scanning' || flow.stage === 'revealed') && site !== null && flow.scanId !== null;
  // Varrendo: o canteiro no centro e o anel inteiro no quadro. Plano revelado: a câmera assenta no
  // enquadramento da rede no vão ENTRE os dois painéis (o da direita acabou de abrir) — medido na tela
  // quando dá (canteiro e cartões inteiros no vão); sem medida, o enquadramento fixo.
  const points = site ? [site, ...located.map(pointOf)] : located.map(pointOf);
  const measured = flow.stage !== 'scanning' && usableCorridor(flow.corridor) && points.length > 1
    ? corridorView(site, located.map((n) => ({ ...pointOf(n), box: nodeCardBox(n.name, stockNodeValue(n, unit)) })), flow.corridor,
      REVEAL_FRAME, scanning ? SCAN_DRIFT : null)
    : null;
  const view = flow.stage === 'scanning' && site ? scanView(site, radiusKm, located)
    : measured ?? (points.length > 0 ? frameView(points, REVEAL_FRAME) : null);
  const scan: GlobeScan | null = scanning ? {
    id: flow.scanId as string, origin: site as LatLng, radiusKm,
    results: flow.fresh ? scanResults(located, unit) : Object.fromEntries(located.map((n) => [stockNodeId(n.locationId), null])),
    pendingText: SCAN_PENDING_TEXT, statusText: SCAN_STATUS_TEXT,
  } : null;
  return { arcs, nodes, view, scan, drift: scanning ? { ...SCAN_DRIFT } : null };
}

/** O que a rede respondeu, para o painel "Necessidade" (o livro-razão do filme: "+ 175 und. · Almoxarifado Uberaba"). */
export function networkSummary(data: Pick<SiteSupplyData, 'stock' | 'focus'>): {
  state: 'ok' | 'restricted' | 'error'; hits: Array<{ id: string; name: string; text: string }>; empty: number; unlocated: number;
} {
  if (data.stock.state !== 'ok') return { state: data.stock.state, hits: [], empty: 0, unlocated: 0 };
  const unit = data.focus?.item?.unit ?? null;
  const others = data.stock.data.filter((n) => !n.isSite);
  const hits = others.filter(hasStock)
    .sort((a, b) => b.available - a.available || a.name.localeCompare(b.name, 'pt-BR'))
    .map((n) => ({ id: n.locationId, name: n.name, text: `+ ${qtyText(n.available, unit) ?? n.available}` }));
  return {
    state: 'ok', hits, empty: others.filter((n) => !hasStock(n)).length,
    unlocated: others.filter((n) => !validPoint(n.lat, n.lng)).length,
  };
}

/* ── Leitura defensiva: seção ausente nunca vira calma ─────────────────── */

const MISSING = (what: string) => ({ state: 'error' as const, message: `${what} não veio nesta leitura.` });

/** Campos novos do Supply que um servidor mais antigo não manda: viram "não carregou", nunca vazio. */
export function normalizeSupply(data: SiteSupplyData): SiteSupplyData {
  const d = data as Partial<SiteSupplyData> & SiteSupplyData;
  return {
    ...d,
    plan: d.plan ?? MISSING('O plano da Apex'),
    procurement: d.procurement ?? MISSING('A solicitação de compra'),
    suppliers: d.suppliers ?? MISSING('A lista de fornecedores'),
    capabilities: d.capabilities ?? {
      request: false, source: false, approve: false, suppliersManage: false, reserve: false, transfer: false,
      aiSearch: { available: false, reason: 'Busca externa indisponível nesta leitura' },
    },
  };
}

/* ── Plano do Apex ─────────────────────────────────────────────────────── */

/** Tom do Signal do produto (`HudSignal`), sem importar React aqui. */
export type SignalTone = 'critical' | 'danger' | 'warning' | 'success' | 'info' | 'accent' | 'neutral' | 'live';

const PLAN_RANK: Record<PlanStepKind, number> = { reserve: 0, transfer: 1, buy: 2 };
export const PLAN_VERB: Record<PlanStepKind, string> = { reserve: 'Reservar', transfer: 'Transferir', buy: 'Comprar' };
export const PLAN_STATUS: Record<SupplyPlanStep['status'], { label: string; tone: SignalTone }> = {
  suggested: { label: 'Sugerido', tone: 'accent' },
  pending: { label: 'Pedida', tone: 'info' },
  done: { label: 'Feito', tone: 'success' },
  blocked: { label: 'Bloqueado', tone: 'warning' },
};

/** Os passos na ordem do filme (reservar → transferir → comprar; a ordem do servidor dentro de cada tipo), cada um com o atraso da entrada. */
export function planSteps(plan: Pick<SupplyPlan, 'steps'>): Array<SupplyPlanStep & { key: string; delayMs: number }> {
  return plan.steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (PLAN_RANK[a.s.kind] ?? 9) - (PLAN_RANK[b.s.kind] ?? 9) || a.i - b.i)
    .map(({ s, i }, k) => ({ ...s, key: `${s.kind}:${s.from?.locationId ?? '-'}:${i}`, delayMs: k * PLAN_STAGGER_MS }));
}

/** O corpo que vai para a rota governada do passo: o do servidor, com a chave de idempotência da intenção quando não veio. */
export function planActionBody(step: Pick<SupplyPlanStep, 'action'>, idempotencyKey: string): Record<string, unknown> | null {
  if (!step.action) return null;
  const body = { ...step.action.body };
  if (body.idempotencyKey === undefined || body.idempotencyKey === null) body.idempotencyKey = idempotencyKey;
  return body;
}

/* ── Solicitação de compra ─────────────────────────────────────────────── */

export const REQUISITIONS_URL = '/api/supply/procurement/requisitions';

export function requisitionPriority(risk: MaterialBalance['risk']): 'low' | 'medium' | 'high' | 'critical' {
  return risk === 'critical' ? 'critical' : risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : 'low';
}

/** O canteiro deste projeto como local de entrega (a posição PROJECT_SITE do item); `null` sem leitura ou sem canteiro. */
export function siteLocationId(data: Pick<SiteSupplyData, 'stock'>): string | null {
  if (data.stock.state !== 'ok') return null;
  return data.stock.data.find((n) => n.isSite)?.locationId ?? null;
}

/** POST /api/supply/procurement/requisitions — a requisição NASCE DA FALTA (rastro por requisito). */
export function requisitionBody(focus: Pick<MaterialBalance, 'requirementId' | 'risk'>, deliveryLocationId: string | null, idempotencyKey: string) {
  return {
    source: 'SHORTAGE' as const, requirementIds: [focus.requirementId], deliveryLocationId,
    priority: requisitionPriority(focus.risk), idempotencyKey,
  };
}

const DEAD_REQUISITION = new Set(['CANCELLED']);

/** As solicitações vivas do requisito em foco (a cancelada não conta) — as em cotação e as já atendidas por pedido. */
export function liveRequisitions(section: SectionState<{ requisitions: RequisitionView[] }>): RequisitionView[] {
  return section.state === 'ok' ? section.data.requisitions.filter((r) => !DEAD_REQUISITION.has(r.status)) : [];
}

/** A falta que sobra para COMPRAR: a do plano quando ele existe; sem plano, a falta viva sem requisição. */
export function remainingToBuy(data: Pick<SiteSupplyData, 'plan' | 'focus'>): number | null {
  if (data.plan.state === 'ok') return finite(data.plan.data.remainingShortage) ? Math.max(0, data.plan.data.remainingShortage) : null;
  const f = data.focus;
  if (!f || !finite(f.shortage)) return null;
  return Math.max(0, f.shortage - (finite(f.requested) ? f.requested : 0));
}

/**
 * Quanto uma solicitação aberta AGORA pediria — a MESMA conta do banco
 * (`purchase_requisition_from_shortage`: falta viva − o que já está requisitado
 * em aberto). Não desconta reserva/transferência que o plano só SUGERE: é por
 * isso que a tela avisa "faça antes o que está acima".
 */
export function requisitionQty(focus: Pick<MaterialBalance, 'shortage' | 'requested'> | null | undefined): number | null {
  if (!focus || !finite(focus.shortage)) return null;
  return Math.max(0, focus.shortage - (finite(focus.requested) ? focus.requested : 0));
}

/**
 * O que falta REQUISITAR pelo plano: a falta depois da rede (reservar/transferir)
 * menos o que já está requisitado em aberto. Sem plano lido, a conta do banco.
 */
export function planToRequisition(data: Pick<SiteSupplyData, 'plan' | 'focus'>): number | null {
  const f = data.focus;
  if (!f) return null;
  if (data.plan.state !== 'ok') return requisitionQty(f);
  const left = data.plan.data.remainingShortage;
  if (!finite(left)) return null;
  return Math.max(0, left - (finite(f.requested) ? f.requested : 0));
}

/**
 * A confirmação de "Criar solicitação": a quantidade que o BANCO vai pedir e,
 * quando o plano ainda sugere reservar/transferir, o quanto disso a rede
 * cobriria (`extra`) — faça antes o que está acima, ou compra-se a mais.
 */
export function requisitionPreview(data: Pick<SiteSupplyData, 'plan' | 'focus'>): {
  qty: number | null; planQty: number | null; extra: number; openSteps: Array<Pick<SupplyPlanStep, 'kind' | 'qty' | 'unit' | 'label'>>;
} {
  const qty = requisitionQty(data.focus);
  const planQty = planToRequisition(data);
  const openSteps = data.plan.state === 'ok'
    ? data.plan.data.steps.filter((s) => s.status === 'suggested' && s.kind !== 'buy').map(({ kind, qty: q, unit, label }) => ({ kind, qty: q, unit, label }))
    : [];
  const extra = qty !== null && planQty !== null ? Math.max(0, qty - planQty) : 0;
  return { qty, planQty, extra, openSteps };
}

/**
 * "Criar solicitação de compra": com a leitura de compras ok, a permissão de
 * requisitar, algo a requisitar PELO PLANO e algo que o BANCO aceite requisitar
 * (falta − requisitado em aberto > 0). Uma solicitação antiga (já atendida por
 * pedido, ou de uma necessidade menor) não esconde a falta que cresceu.
 */
export function canCreateRequisition(data: Pick<SiteSupplyData, 'plan' | 'focus' | 'procurement' | 'capabilities'>): boolean {
  if (!data.focus || !data.capabilities.request || data.procurement.state !== 'ok') return false;
  const plan = planToRequisition(data);
  const db = requisitionQty(data.focus);
  return plan !== null && plan > 0 && db !== null && db > 0;
}

/* ── Cotação: convite e envio ──────────────────────────────────────────── */

export const RFQS_URL = '/api/supply/procurement/rfqs';
export const rfqUrl = (rfqId: string) => `${RFQS_URL}/${encodeURIComponent(rfqId)}`;
export const rfqSendUrl = (rfqId: string) => `${rfqUrl(rfqId)}/send`;
export const poUrl = (poId: string) => `/api/supply/procurement/purchase-orders/${encodeURIComponent(poId)}`;

const addDaysIso = (iso: string, days: number): string | null => {
  const n = dayNumber(iso);
  if (n === null) return null;
  const { y, m, d } = partsOf(n + days);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Prazo de resposta sugerido: 5 dias, ou a véspera da necessidade se vier antes — nunca antes de amanhã. */
export function defaultResponseDue(today: string, needBy: string | null): string | null {
  const five = addDaysIso(today, 5);
  const tomorrow = addDaysIso(today, 1);
  if (!five || !tomorrow) return null;
  const eve = needBy ? addDaysIso(needBy, -1) : null;
  const pick = eve && eve < five ? eve : five;
  return pick < tomorrow ? tomorrow : pick;
}

/** POST /api/supply/procurement/rfqs — abrir a cotação para a linha da solicitação, convidando os fornecedores escolhidos. */
export function rfqCreateBody(lineId: string, supplierIds: string[], responseDue: string | null) {
  return { requisitionLineIds: [lineId], supplierIds: [...new Set(supplierIds)], responseDue };
}

/** POST /api/supply/procurement/rfqs/[id]/send — só os convidados pedidos (nunca "todos" por omissão na tela). */
export function rfqSendBody(supplierIds: string[]) {
  return { supplierIds: [...new Set(supplierIds)] };
}

export type SendOutcome = 'SENT' | 'SIMULATED' | 'NO_CONTACT' | 'ALREADY_SENT' | 'FAILED';
export interface SendResult { supplierId: string; name: string; outcome: SendOutcome; message: string }

export const SEND_OUTCOME: Record<SendOutcome, { label: string; tone: SignalTone }> = {
  SENT: { label: 'Cotação enviada', tone: 'success' },
  SIMULATED: { label: 'Registrado — ambiente de teste', tone: 'info' },
  NO_CONTACT: { label: 'Sem e-mail cadastrado', tone: 'warning' },
  ALREADY_SENT: { label: 'Já tinha sido enviada', tone: 'neutral' },
  FAILED: { label: 'Não foi enviada', tone: 'danger' },
};

/** Lê a resposta do envio (`results`), descartando o que não tem a forma do contrato. */
export function sendResults(result: Record<string, unknown> | null | undefined): SendResult[] {
  const raw = result && Array.isArray((result as { results?: unknown }).results) ? (result as { results: unknown[] }).results : [];
  return raw.flatMap((r) => {
    const o = r as Partial<SendResult>;
    if (!o || typeof o.supplierId !== 'string' || !o.outcome || !(o.outcome in SEND_OUTCOME)) return [];
    return [{ supplierId: o.supplierId, name: typeof o.name === 'string' ? o.name : 'Fornecedor', outcome: o.outcome, message: typeof o.message === 'string' ? o.message : '' }];
  });
}

/** Quem um envio ATENDEU (tudo menos "não foi enviada"): sai do botão "Enviar cotação" até a releitura. */
export function handledBySend(results: SendResult[]): string[] {
  return results.filter((r) => r.outcome !== 'FAILED').map((r) => r.supplierId);
}

/** Os convidados que ainda pedem envio: os sem envio na leitura, menos os que o último envio atendeu. */
export function unsentPending(unsent: string[], handled: string[]): string[] {
  const done = new Set(handled);
  return unsent.filter((id) => !done.has(id));
}

/** Os homologados sugeridos para o convite: com e-mail, mais pontuais e mais rápidos primeiro (até 3). */
export function preselectSuppliers(cands: SupplierCandidate[], max = 3): string[] {
  const rate = (c: SupplierCandidate) => (finite(c.onTimeRate) ? c.onTimeRate : -1);
  const lead = (c: SupplierCandidate) => (finite(c.leadDays) ? c.leadDays : Number.POSITIVE_INFINITY);
  return cands
    .filter((c) => c.status === 'HOMOLOGATED' && c.hasEmail)
    .sort((a, b) => rate(b) - rate(a) || lead(a) - lead(b) || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, max)
    .map((c) => c.supplierId);
}

/** A cotação que importa na solicitação: aberta com mais propostas; senão a decidida; cancelada nunca. */
export function activeRfq(req: Pick<RequisitionView, 'rfqs'> | null | undefined): RfqView | null {
  if (!req) return null;
  const live = req.rfqs.filter((r) => r.status !== 'CANCELLED');
  const open = live.filter((r) => r.status === 'OPEN').sort((a, b) => b.quotes.length - a.quotes.length);
  return open[0] ?? live.find((r) => r.status === 'DECIDED') ?? null;
}

/** Convidados com contato que ainda não receberam a cotação — quem já mandou proposta não recebe pedido de novo. */
export function unsentInvited(rfq: Pick<RfqView, 'invited' | 'quotes'>): string[] {
  const quoted = new Set(rfq.quotes.map((q) => q.supplier.id));
  return rfq.invited.filter((i) => i.hasContact && !i.sentAt && !quoted.has(i.supplierId)).map((i) => i.supplierId);
}

/** Pontualidade como porcentagem ("92%"); aceita razão (0..1) ou já porcentagem. */
export function pctText(rate: number | null | undefined): string | null {
  if (!finite(rate) || rate < 0) return null;
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${Math.round(Math.min(100, pct))}%`;
}

export function leadText(days: number | null | undefined): string | null {
  if (!finite(days) || days < 0) return null;
  const n = Math.round(days);
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
}

/* ── Cotações A × B ────────────────────────────────────────────────────── */

/**
 * A (a recomendada pela Apex) e B (a alternativa: a mais barata que sobra;
 * senão a próxima que chega antes). Sem recomendação, A é a que chega a tempo
 * com menor custo — nunca uma escolha inventada: é a mesma ordem do servidor.
 */
export function abPair(rfq: Pick<RfqView, 'quotes' | 'recommendation'>): { a: QuoteOption; b: QuoteOption | null; more: number } | null {
  const qs = rfq.quotes;
  if (qs.length === 0) return null;
  const recId = rfq.recommendation?.quoteId ?? qs.find((q) => q.recommended)?.quoteId ?? null;
  const a = qs.find((q) => q.quoteId === recId) ?? qs[0];
  const rest = qs.filter((q) => q.quoteId !== a.quoteId);
  const b = rest.find((q) => q.cheapest) ?? [...rest].sort((x, y) => (x.lateDays ?? 0) - (y.lateDays ?? 0))[0] ?? null;
  return { a, b, more: Math.max(0, qs.length - (b ? 2 : 1)) };
}

/** "R$ 12.345,67" → { value: 12345.67, prefix: "R$" }. Texto restrito/ausente → null (nunca 0). */
export function parseMoneyText(text: string | null | undefined): { value: number; prefix: string } | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/ | /g, ' ').trim();
  const m = /^([−-])?\s*([^\d\s−-]*)\s*([−-])?\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)$/.exec(t);
  if (!m) return null;
  const value = Number(m[4].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return { value: (m[1] || m[3]) ? -value : value, prefix: m[2].trim() };
}

/** Valor com o mesmo prefixo do texto do servidor ("R$ 850" / "R$ 850,50"). */
export function moneyLike(prefix: string, value: number): string {
  const cents = Math.abs(value - Math.round(value)) > 0.004;
  const s = Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return prefix ? `${prefix} ${s}` : s;
}

/**
 * Abaixo desta pontualidade histórica o prazo PROMETIDO não basta como
 * garantia — a MESMA régua do `evaluateQuotes` de Compras (que põe
 * "pontualidade histórica de X%" no veredito abaixo de 80%).
 */
export const RELIABILITY_WARN = 0.8;

/** Pontualidade histórica baixa (razão 0..1 ou porcentagem); sem histórico → `null` (nunca "0%"). */
export function lowReliability(rate: number | null | undefined): string | null {
  if (!finite(rate) || rate < 0) return null;
  const r = rate <= 1 ? rate : rate / 100;
  return r < RELIABILITY_WARN ? pctText(rate) : null;
}

/**
 * Chegada COMPARADA à necessidade — "Dentro do prazo" / "+7 dias depois da
 * necessidade"; nunca "atrasa a obra". Dentro do prazo PROMETIDO por quem
 * historicamente entrega com atraso não acende verde: vem em alerta, com a
 * pontualidade ao lado.
 */
export function arrivalText(q: Pick<QuoteOption, 'onTime' | 'lateDays'> & { supplier?: Pick<QuoteOption['supplier'], 'onTimeRate'> }): { text: string; tone: SignalTone } {
  if (finite(q.lateDays) && q.lateDays > 0) {
    const n = Math.round(q.lateDays);
    return { text: `+${n} ${n === 1 ? 'dia' : 'dias'} depois da necessidade`, tone: 'warning' };
  }
  if (q.onTime === true) {
    const low = lowReliability(q.supplier?.onTimeRate);
    // O número já está na linha "Pontualidade" do cartão (e no veredito): aqui só o alerta, curto.
    return low ? { text: 'Dentro do prazo prometido', tone: 'warning' } : { text: 'Dentro do prazo', tone: 'success' };
  }
  if (q.onTime === false) return { text: 'Chega depois da necessidade', tone: 'warning' };
  return { text: 'Sem prazo informado', tone: 'neutral' };
}

/**
 * A caixa de recomendação do filme, calculada dos totais REAIS e da chegada
 * contra a necessidade (os textos de total do servidor; restrito → sem R$).
 * "Apex recomenda A: + R$ 850 para chegar a tempo" · "− 7 dias de atraso".
 * Quando A chega a tempo só pelo prazo PROMETIDO e o histórico do fornecedor é
 * de atraso, a caixa diz isso (`caveat`) — pagar a mais "para chegar a tempo"
 * sem esse aviso seria uma recomendação sem o fato que a enfraquece.
 */
export function recommendationLine(pair: { a: QuoteOption; b: QuoteOption | null }, hasRecommendation: boolean): {
  head: string; detail: string | null; plus: string | null; minus: string | null; caveat: string | null;
} {
  const { a, b } = pair;
  if (!hasRecommendation) {
    return { head: 'A Apex não recomenda nenhuma proposta', detail: 'Nenhuma é elegível (validade, homologação ou cobertura do pedido) — decida com justificativa.', plus: null, minus: null, caveat: null };
  }
  const ta = parseMoneyText(a.totalText);
  const tb = b ? parseMoneyText(b.totalText) : null;
  const diff = ta && tb && ta.prefix === tb.prefix ? Math.round((ta.value - tb.value) * 100) / 100 : null;
  const prefix = ta?.prefix ?? '';
  const aLate = finite(a.lateDays) && a.lateDays > 0 ? Math.round(a.lateDays) : 0;
  const bLate = b && finite(b.lateDays) && b.lateDays > 0 ? Math.round(b.lateDays) : 0;
  const days = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
  const low = a.onTime === true ? lowReliability(a.supplier.onTimeRate) : null;
  const caveat = low ? `Atenção: A chega a tempo pelo prazo prometido, mas a pontualidade histórica deste fornecedor é de ${low} — confirme a data antes de decidir.` : null;
  if (!b) {
    return { head: `Apex recomenda A${a.onTime === true ? ': chega a tempo' : ''}`, detail: 'Só uma proposta recebida até agora.', plus: null, minus: null, caveat };
  }
  if (a.onTime === true && bLate > 0) {
    const minus = `− ${days(bLate)} de atraso`;
    if (diff !== null && diff > 0) {
      return { head: `Apex recomenda A: + ${moneyLike(prefix, diff)} para chegar a tempo`,
        detail: `B custa ${moneyLike(prefix, diff)} a menos, mas chega ${days(bLate)} depois da necessidade.`, plus: `+ ${moneyLike(prefix, diff)}`, minus, caveat };
    }
    if (diff !== null) {
      return { head: diff === 0 ? 'Apex recomenda A: mesmo custo e chega a tempo' : `Apex recomenda A: chega a tempo e custa ${moneyLike(prefix, -diff)} a menos`,
        detail: `B chega ${days(bLate)} depois da necessidade.`, plus: null, minus, caveat };
    }
    return { head: 'Apex recomenda A: chega a tempo', detail: `B chega ${days(bLate)} depois da necessidade.`, plus: null, minus, caveat };
  }
  if (aLate > 0) {
    return { head: `Nenhuma chega a tempo — Apex recomenda A, com o menor atraso (${days(aLate)})`,
      detail: bLate > 0 ? `B chega ${days(bLate)} depois da necessidade.` : null, plus: diff !== null && diff > 0 ? `+ ${moneyLike(prefix, diff)}` : null, minus: null, caveat };
  }
  if (diff !== null && diff < 0) {
    return { head: `Apex recomenda A: menor custo total entre as que chegam a tempo (− ${moneyLike(prefix, -diff)})`, detail: null, plus: null, minus: null, caveat };
  }
  return { head: 'Apex recomenda A', detail: diff !== null && diff > 0 ? `B custa ${moneyLike(prefix, diff)} a menos, mas tem desvio ou restrição.` : null, plus: diff !== null && diff > 0 ? `+ ${moneyLike(prefix, diff)}` : null, minus: null, caveat };
}

/* ── A decisão (quem cota) e a aprovação (quem tem a alçada) ───────────── */

export const RATIONALE_MIN = 10;

/**
 * Seguindo a recomendação, a justificativa já vem escrita (a rota exige ≥ 10
 * caracteres sempre); contra ela, em branco. Se a escolhida chega a tempo só
 * pelo prazo prometido de quem historicamente atrasa, o texto sugerido registra
 * isso — quem decide assina sabendo.
 */
export function defaultRationale(rfq: Pick<RfqView, 'recommendation'> & { quotes?: QuoteOption[] }, quoteId: string): string {
  const rec = rfq.recommendation;
  if (!rec?.quoteId || rec.quoteId !== quoteId) return '';
  const text = rec.text?.trim() || 'chega a tempo com o menor custo total entre as elegíveis';
  const q = rfq.quotes?.find((x) => x.quoteId === quoteId);
  const low = q && q.onTime === true ? lowReliability(q.supplier.onTimeRate) : null;
  const note = low && !text.includes(`pontualidade histórica de ${low}`)
    ? ` Pontualidade histórica do fornecedor: ${low} — data de entrega a confirmar com ele.` : '';
  return `Segue a recomendação da Apex: ${text}${note}`.slice(0, 2000);
}

export function rationaleState(rfq: Pick<RfqView, 'recommendation'>, quoteId: string, rationale: string): { against: boolean; ok: boolean; hint: string } {
  const against = Boolean(rfq.recommendation?.quoteId && rfq.recommendation.quoteId !== quoteId);
  const len = rationale.trim().length;
  const ok = len >= RATIONALE_MIN;
  const hint = ok ? (against ? 'Indo contra a recomendação — a justificativa fica registrada na decisão.' : 'A justificativa fica registrada na decisão.')
    : against ? `Você está indo contra a recomendação da Apex — explique o porquê (mínimo ${RATIONALE_MIN} caracteres).`
      : `Justificativa obrigatória (mínimo ${RATIONALE_MIN} caracteres).`;
  return { against, ok, hint };
}

/** POST /api/supply/procurement/rfqs/[id] {action:'decide'} — a MESMA forma da tela de Compras, com a comparação que sustentou. */
export function decideBody(rfq: Pick<RfqView, 'quotes' | 'recommendation'>, quoteId: string, rationale: string) {
  return {
    action: 'decide' as const, quoteId, recommendedQuoteId: rfq.recommendation?.quoteId ?? null, rationale: rationale.trim(),
    comparison: {
      source: 'dashboard',
      recommendation: rfq.recommendation,
      quotes: rfq.quotes.map((q) => ({
        quoteId: q.quoteId, supplierId: q.supplier.id, supplier: q.supplier.name, total: q.totalText, leadDays: q.leadDays, eta: q.eta,
        onTime: q.onTime, lateDays: q.lateDays, recommended: q.recommended, cheapest: q.cheapest, verdict: q.verdict,
      })),
    },
  };
}

export const PO_SUBMIT_BODY = { action: 'submit' as const };
export const poUpdateBody = (deliveryLocationId: string) => ({ action: 'update' as const, deliveryLocationId });
/** A recusa do banco "defina o local de entrega antes de submeter" (a única que o Dashboard resolve sozinho, com o canteiro). */
export const missingDeliveryLocation = (message: string | null | undefined) => /local de entrega/i.test(message ?? '');

export type GovStep =
  | { kind: 'decide' }
  | { kind: 'wait-decision' }
  | { kind: 'submit'; poId: string; poNumber: string | null }
  | { kind: 'draft'; poNumber: string | null }
  | { kind: 'approve'; decisionKey: string; poNumber: string | null }
  | { kind: 'awaiting'; poNumber: string | null }
  | { kind: 'settled'; poNumber: string | null; label: string }
  | { kind: 'none' };

/**
 * O próximo ato governado PARA ESTA PESSOA: quem cota decide o fornecedor e
 * submete o pedido; quem tem a alçada aprova (a chave de Decisões só vem
 * para quem está na caixa); os outros veem o estado, sem botão.
 */
export function govStep(rfq: Pick<RfqView, 'status' | 'quotes' | 'decision'>, caps: Pick<SupplyCapabilities, 'source'>): GovStep {
  const d = rfq.decision;
  if (!d) {
    if (rfq.status !== 'OPEN' || rfq.quotes.length === 0) return { kind: 'none' };
    return caps.source ? { kind: 'decide' } : { kind: 'wait-decision' };
  }
  const st = d.poStatus;
  if (st === 'DRAFT') return caps.source && d.poId ? { kind: 'submit', poId: d.poId, poNumber: d.poNumber } : { kind: 'draft', poNumber: d.poNumber };
  if (st === 'APPROVAL_REQUIRED') return d.decisionKey ? { kind: 'approve', decisionKey: d.decisionKey, poNumber: d.poNumber } : { kind: 'awaiting', poNumber: d.poNumber };
  if (st) return { kind: 'settled', poNumber: d.poNumber, label: d.poStatusLabel ?? st };
  return { kind: 'none' };
}

/* ── Fornecedores da internet (Apex): nunca contato automático ─────────── */

/** Só http(s) vira link (um `javascript:` vindo da busca nunca vira clique). Domínio nu ganha https://. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export const SUPPLIERS_URL = '/api/supply/suppliers';

/**
 * O CNPJ como o servidor o validou: numérico (14 dígitos) ou o ALFANUMÉRICO de
 * 2026 (12 posições 0-9/A-Z + 2 dígitos verificadores). Qualquer outra forma → `null`.
 */
export function cnpjOf(value: string | null | undefined): { raw: string; alnum: boolean } | null {
  const raw = (value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^\d{14}$/.test(raw)) return { raw, alnum: false };
  if (/^[0-9A-Z]{12}\d{2}$/.test(raw)) return { raw, alnum: true };
  return null;
}

/**
 * POST /api/supply/suppliers — cadastra o candidato como PROSPECTO (em
 * avaliação): nome, CNPJ, contato e a ORIGEM nas notas. Nunca convida nem
 * escreve ao fornecedor. O CNPJ alfanumérico (2026) vai só nas notas: o
 * cadastro do banco ainda normaliza o documento para dígitos e o perderia.
 */
export function prospectBody(c: ExternalSupplierCandidate, today: string) {
  const doc = cnpjOf(c.cnpj);
  const cnpj = doc && !doc.alnum ? doc.raw : null;
  const foreign = !doc && c.country && !/^(br|brasil|brazil)$/i.test(c.country.trim());
  const sources = c.evidenceUrls.map(safeHttpUrl).filter((u): u is string => Boolean(u)).slice(0, 5);
  const where = [c.city, c.uf, c.country].filter(Boolean).join(' · ');
  const notes = [
    `Encontrado pela busca da Apex na internet em ${dayMonth(today)} — NÃO homologado: verificar cadastro, documentação e capacidade antes de convidar.`,
    doc?.alnum ? `CNPJ informado (alfanumérico): ${cnpjText(doc.raw)}.` : null,
    where ? `Local informado: ${where}.` : null,
    c.site ? `Site: ${c.site}.` : null,
    sources.length ? `Fontes: ${sources.join(' , ')}` : null,
  ].filter(Boolean).join('\n').slice(0, 2000);
  const email = c.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()) ? c.email.trim() : null;
  return {
    legalName: c.name.trim().slice(0, 300), tradeName: null, kind: 'organization' as const,
    documentType: cnpj ? ('cnpj' as const) : foreign ? ('foreign' as const) : null, documentNumber: cnpj,
    contactEmail: email, contactPhone: c.phone ? c.phone.trim().slice(0, 60) : null, notes,
  };
}

/** "12.345.678/0001-90" · "12.ABC.345/01DE-35" (alfanumérico); forma inválida → `null`. */
export function cnpjText(value: string | null | undefined): string | null {
  const d = cnpjOf(value)?.raw;
  if (!d) return null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/* ── O cadastro interno antes de "Cadastrar como prospecto" ──────────────── */

/** O que a tela lê de GET /api/supply/suppliers para conferir o candidato (o resto da linha não interessa aqui). */
export interface RegistrySupplier {
  id: string; name: string; legalName: string; document: string | null; status: string; contactEmail: string | null;
}

/** O status do fornecedor em português (o rótulo de Compras); desconhecido → "no cadastro", nunca o código cru. */
export function supplierStatusText(status: string): string {
  return (SUPPLIER_STATUS_LABEL as Record<string, string>)[status] ?? 'no cadastro';
}

const COMPANY_SUFFIX = /\b(ltda|ltd|s\s*\/?\s*a|eireli|me|epp|ss|inc|llc|gmbh|co)\b\.?/g;
/** Nome para comparar: sem acento, sem pontuação, sem o sufixo societário ("Ltda", "S/A"…). */
export function companyKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9/\s]/g, ' ').replace(COMPANY_SUFFIX, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * O candidato da internet JÁ está no cadastro? Pelo CNPJ, pelo e-mail ou pelo
 * nome (sem sufixo societário). Achou → a tela diz "Já no cadastro (status)" e
 * não oferece cadastrar: o cadastro por CNPJ ATUALIZARIA o fornecedor que existe
 * (contato e notas), nunca criaria um prospecto novo.
 */
export function registryMatch(c: Pick<ExternalSupplierCandidate, 'name' | 'cnpj' | 'email'>, registry: RegistrySupplier[]): RegistrySupplier | null {
  const doc = cnpjOf(c.cnpj)?.raw ?? null;
  const email = c.email?.trim().toLowerCase() || null;
  const key = companyKey(c.name);
  return registry.find((s) => (doc !== null && cnpjOf(s.document)?.raw === doc)
    || (email !== null && (s.contactEmail ?? '').trim().toLowerCase() === email)
    || (key.length >= 3 && (companyKey(s.legalName) === key || companyKey(s.name) === key))) ?? null;
}

/** A lista do cadastro na resposta de GET /api/supply/suppliers; forma inesperada → `null` (nunca "ninguém cadastrado"). */
export function registryList(payload: unknown): RegistrySupplier[] | null {
  const list = payload && typeof payload === 'object' ? (payload as { suppliers?: unknown }).suppliers : undefined;
  if (!Array.isArray(list)) return null;
  return list.flatMap((r) => {
    const o = r as Partial<RegistrySupplier>;
    if (!o || typeof o.id !== 'string') return [];
    return [{
      id: o.id, name: typeof o.name === 'string' ? o.name : '', legalName: typeof o.legalName === 'string' ? o.legalName : '',
      document: typeof o.document === 'string' ? o.document : null, status: typeof o.status === 'string' ? o.status : '',
      contactEmail: typeof o.contactEmail === 'string' ? o.contactEmail : null,
    }];
  });
}

/* ── O fluxo na tela ───────────────────────────────────────────────────── */

export type FlowStepId = 'plan' | 'requisition' | 'suppliers' | 'quotes';
/**
 * `skip` = a etapa não é necessária (a rede cobre a falta: nada a comprar).
 * `restricted` = o perfil não lê a parte (cadeado, neutro — nunca "vazio");
 * `error` = a leitura falhou (perigo — nunca calma).
 */
/** `waiting` = nada a fazer AQUI agora, mas um passo pedido aguarda outra pessoa (ex.: transferência a aprovar no Estoque). */
export type FlowState = 'done' | 'current' | 'pending' | 'waiting' | 'restricted' | 'error' | 'skip';
export const FLOW_ORDER: FlowStepId[] = ['plan', 'requisition', 'suppliers', 'quotes'];

/**
 * O estado de cada etapa do trilho (Plano · Solicitação · Fornecedores ·
 * Cotação), pelo DADO — nunca pelo clique.
 *  • Plano: aberto enquanto houver passo SUGERIDO (reservar/transferir/comprar
 *    ainda por fazer), feito quando não houver — nunca "feito" ao lado de um
 *    passo sugerido.
 *  • Solicitação: aberta quando há o que requisitar (pelo plano E pelo banco),
 *    feita com uma solicitação viva e nada mais a requisitar.
 *  • Antes de a compra começar (nenhuma solicitação viva), a ordem é a do
 *    filme: a primeira etapa aberta é a "atual", as outras esperam. Depois
 *    que ela começou, o que sobra do plano corre EM PARALELO à compra — os
 *    dois podem estar "agora" (ex.: uma transferência sugerida e as propostas
 *    a decidir).
 */
export function flowStates(data: Pick<SiteSupplyData, 'plan' | 'procurement' | 'focus'>): Record<FlowStepId, FlowState> {
  const reqs = liveRequisitions(data.procurement);
  const rfq = reqs.map(activeRfq).find(Boolean) ?? null;
  const started = reqs.length > 0;
  const proc = data.procurement.state;
  const readable = proc === 'ok';
  const unread: 'restricted' | 'error' = proc === 'restricted' ? 'restricted' : 'error';
  const toReq = planToRequisition(data);
  const dbReq = requisitionQty(data.focus);
  const needReq = readable && toReq !== null && toReq > 0 && dbReq !== null && dbReq > 0;
  // "Não precisa" só com as DUAS leituras em mãos: o plano diz que nada sobra E compras diz que não há solicitação.
  // Leitura que falhou nunca vira "não precisa".
  const nothingToBuy = readable && !started && data.plan.state === 'ok' && finite(data.plan.data.remainingShortage) && data.plan.data.remainingShortage <= 0;
  const settled = Boolean(rfq?.decision?.poStatus && !['DRAFT', 'APPROVAL_REQUIRED'].includes(rfq.decision.poStatus));
  const sent = Boolean(rfq && (rfq.quotes.length > 0 || (rfq.invited.length > 0 && rfq.invited.every((i) => i.sentAt || !i.hasContact))));
  const planBase: 'done' | 'open' | 'waiting' | 'restricted' | 'error' = data.plan.state === 'ok'
    ? (data.plan.data.steps.some((s) => s.status === 'suggested') ? 'open'
      : data.plan.data.steps.some((s) => s.status === 'pending') ? 'waiting' : 'done')
    : data.plan.state === 'restricted' ? 'restricted' : 'error';
  const base: Record<FlowStepId, 'done' | 'open' | 'waiting' | 'restricted' | 'error' | 'skip'> = {
    plan: planBase,
    requisition: !readable ? unread : needReq ? 'open' : started ? 'done' : nothingToBuy ? 'skip' : 'open',
    suppliers: !readable ? unread : nothingToBuy ? 'skip' : sent ? 'done' : 'open',
    quotes: !readable ? unread : nothingToBuy ? 'skip' : settled ? 'done' : 'open',
  };
  const out = {} as Record<FlowStepId, FlowState>;
  // Compra em andamento: o plano fica fora da fila (paralelo); antes dela, o plano é a primeira etapa da fila.
  const queue: FlowStepId[] = started ? ['requisition', 'suppliers', 'quotes'] : FLOW_ORDER;
  if (started) out.plan = planBase === 'open' ? 'current' : planBase;
  let current = false;
  for (const id of queue) {
    const b = base[id];
    if (b !== 'open') { out[id] = b; continue; }
    out[id] = current ? 'pending' : 'current';
    current = true;
  }
  return out;
}

/**
 * Rolagem do painel para mostrar uma etapa: a etapa inteira quando cabe
 * (o topo dela no topo do painel); quando não cabe, o que importa (`focusBottom`,
 * ex.: o bloco da decisão) no pé do painel. Coordenadas no conteúdo rolável (px).
 */
export function panelScrollTarget(o: { secTop: number; secBottom: number; focusBottom?: number | null; viewH: number; scrollMax: number; pad?: number }): number {
  const pad = o.pad ?? 12;
  const top = Math.max(0, o.secTop - pad);
  const bottom = Math.max(o.secBottom, o.focusBottom ?? o.secBottom);
  const want = bottom - top + pad <= o.viewH ? top : Math.max(0, (o.focusBottom ?? o.secTop + o.viewH - pad) + pad - o.viewH);
  return Math.round(Math.max(0, Math.min(o.scrollMax, want)));
}

/** A etapa da COMPRA que está "agora" (a que a tela traz à vista quando o fluxo assenta); `null` sem nenhuma. */
export function currentPurchaseStep(states: Record<FlowStepId, FlowState>): FlowStepId | null {
  return (['requisition', 'suppliers', 'quotes'] as FlowStepId[]).find((id) => states[id] === 'current')
    ?? (states.plan === 'current' ? 'plan' : null);
}

/**
 * Há algo a ver no painel do plano e da compra? Com o plano, as compras E os
 * fornecedores todos Restritos, "Ver o plano do Apex" levaria a uma pilha de
 * cadeados — o botão não é oferecido e a tela diz por quê.
 */
export function flowReadable(data: Pick<SiteSupplyData, 'plan' | 'procurement' | 'suppliers'>): boolean {
  return [data.plan.state, data.procurement.state, data.suppliers.state].some((s) => s !== 'restricted');
}

/**
 * O que ESTA pessoa tem para fazer agora neste material (o atalho do painel
 * "Necessidade" para quem veio decidir, sem refazer a varredura).
 */
export function pendingForViewer(data: Pick<SiteSupplyData, 'procurement' | 'decisions' | 'capabilities'>): string | null {
  const rfq = liveRequisitions(data.procurement).map(activeRfq).find(Boolean) ?? null;
  if (rfq) {
    const g = govStep(rfq, data.capabilities);
    if (g.kind === 'approve') return `A compra${g.poNumber ? ` ${g.poNumber}` : ''} aguarda a sua aprovação`;
    if (g.kind === 'decide' && rfq.quotes.length >= 2) return `A cotação ${rfq.number} tem ${rfq.quotes.length} propostas para você decidir`;
    if (g.kind === 'submit') return `O pedido${g.poNumber ? ` ${g.poNumber}` : ''} está em rascunho — falta enviar para aprovação`;
  }
  if (data.decisions.state === 'ok' && data.decisions.data.length > 0) return 'Uma compra deste material aguarda a sua decisão';
  return null;
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
