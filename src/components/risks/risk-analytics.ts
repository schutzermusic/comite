import type { ExtendedRisk, FunnelStage } from "./risk-types";
import { FUNNEL_STAGE_LABELS, FUNNEL_STAGE_ORDER, categoryToDomain, RISK_DOMAINS, CATEGORY_LABELS } from "./risk-types";
import { computeAging, riskToFunnelStage } from "./risk-utils";
import type { TrendPoint } from "./risk-demo-data";

/* ════════════════════════════════════════════════════════════════════
   RISK ANALYTICS — pure selectors
   ────────────────────────────────────────────────────────────────────
   All non-trivial risk math lives here so UI components stay declarative.
   Every function is pure and side-effect free.
   ════════════════════════════════════════════════════════════════════ */

const SEVERITY_WEIGHT: Record<ExtendedRisk["severity"], number> = {
  critical: 5, high: 3, medium: 1.5, low: 0.5,
};

/** Estimated/declared financial exposure for a single risk (BRL). */
export function riskExposure(risk: ExtendedRisk): number {
  if (typeof risk.financialExposure === "number") return risk.financialExposure;
  // Deterministic estimate for risks without an explicit figure.
  return risk.level * 50_000;
}

export function isOverdue(risk: ExtendedRisk, now = Date.now()): boolean {
  return !!risk.dueDate && risk.dueDate.getTime() < now && risk.status !== "resolved";
}

export function hasActionPlan(risk: ExtendedRisk): boolean {
  return !!risk.mitigationPlan || risk.actions.length > 0;
}

/* ── Executive summary ────────────────────────────────────────────── */
export interface RiskSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  open: number;
  mitigating: number;
  resolved: number;
  score: number;
  avgAging: number;
  withPlanPct: number;
  onTimePct: number;
  overdue: number;
  aiActive: number;
  totalExposure: number;
  openExposure: number;
}

export function computeRiskSummary(risks: ExtendedRisk[]): RiskSummary {
  const total = risks.length;
  const bySev = (s: ExtendedRisk["severity"]) => risks.filter((r) => r.severity === s).length;
  const open = risks.filter((r) => r.status === "open");
  const mitigating = risks.filter((r) => r.status === "mitigating");
  const resolved = risks.filter((r) => r.status === "resolved");
  const active = risks.filter((r) => r.status !== "resolved");

  const avgAging = active.length
    ? Math.round(active.reduce((s, r) => s + computeAging(r.createdAt), 0) / active.length)
    : 0;

  const withPlan = active.filter(hasActionPlan).length;
  const withPlanPct = active.length ? Math.round((withPlan / active.length) * 100) : 0;

  const withDue = active.filter((r) => !!r.dueDate);
  const onTime = withDue.filter((r) => !isOverdue(r)).length;
  const onTimePct = withDue.length ? Math.round((onTime / withDue.length) * 100) : 100;

  const overdue = risks.filter((r) => isOverdue(r)).length;
  const aiActive = risks.filter((r) => r.origin === "ai" && !r.aiDismissed).length;

  // Corporate exposure index (0-10), weighted by severity over open population.
  const raw = active.reduce((s, r) => s + (SEVERITY_WEIGHT[r.severity] ?? 0), 0);
  const score = active.length
    ? Math.round(Math.min(10, raw / Math.max(1, active.length / 2)) * 10) / 10
    : 0;

  return {
    total,
    critical: bySev("critical"),
    high: bySev("high"),
    medium: bySev("medium"),
    low: bySev("low"),
    open: open.length,
    mitigating: mitigating.length,
    resolved: resolved.length,
    score,
    avgAging,
    withPlanPct,
    onTimePct,
    overdue,
    aiActive,
    totalExposure: risks.reduce((s, r) => s + riskExposure(r), 0),
    openExposure: active.reduce((s, r) => s + riskExposure(r), 0),
  };
}

/* ── Severity distribution ────────────────────────────────────────── */
export interface SeveritySlice { key: ExtendedRisk["severity"]; label: string; value: number; pct: number }

export function computeSeverityDistribution(risks: ExtendedRisk[]): SeveritySlice[] {
  const total = risks.length || 1;
  const order: { key: ExtendedRisk["severity"]; label: string }[] = [
    { key: "critical", label: "Crítico" },
    { key: "high", label: "Alto" },
    { key: "medium", label: "Médio" },
    { key: "low", label: "Baixo" },
  ];
  return order.map(({ key, label }) => {
    const value = risks.filter((r) => r.severity === key).length;
    return { key, label, value, pct: Math.round((value / total) * 100) };
  });
}

/* ── Category / domain distribution ───────────────────────────────── */
export function computeCategoryDistribution(risks: ExtendedRisk[]): { name: string; value: number }[] {
  const map: Record<string, number> = {};
  risks.forEach((r) => {
    const key = CATEGORY_LABELS[r.category ?? ""] ?? r.category ?? "Outros";
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/* ── Owner distribution ───────────────────────────────────────────── */
export function computeOwnerDistribution(risks: ExtendedRisk[]): { name: string; count: number; exposure: number }[] {
  const map: Record<string, { count: number; exposure: number }> = {};
  risks.forEach((r) => {
    const name = r.responsibleName ?? "Não atribuído";
    if (!map[name]) map[name] = { count: 0, exposure: 0 };
    map[name].count += 1;
    map[name].exposure += riskExposure(r);
  });
  return Object.entries(map)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/* ── Domain exposure (radar) ──────────────────────────────────────── */
export interface DomainExposure { area: string; score: number; count: number }

export function computeDomainExposure(risks: ExtendedRisk[]): DomainExposure[] {
  const agg: Record<string, { total: number; count: number }> = {};
  RISK_DOMAINS.forEach((d) => { agg[d] = { total: 0, count: 0 }; });
  risks.forEach((r) => {
    const d = categoryToDomain(r.category);
    if (!agg[d]) agg[d] = { total: 0, count: 0 };
    agg[d].total += r.level;
    agg[d].count += 1;
  });
  return RISK_DOMAINS.map((d) => ({
    area: d,
    score: agg[d].count ? Math.round((agg[d].total / agg[d].count) * 10) / 10 : 0,
    count: agg[d].count,
  }));
}

/* ── Area exposure (radar, used when category != area) ────────────── */
export function computeAreaExposure(risks: ExtendedRisk[]): DomainExposure[] {
  const map: Record<string, { total: number; count: number }> = {};
  risks.forEach((r) => {
    const key = r.area || "—";
    if (!map[key]) map[key] = { total: 0, count: 0 };
    map[key].total += r.level;
    map[key].count += 1;
  });
  return Object.entries(map)
    .map(([area, { total, count }]) => ({ area, score: Math.round((total / count) * 10) / 10, count }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

/* ── 5×5 matrix cells ─────────────────────────────────────────────── */
export interface MatrixCell {
  probability: number;
  impact: number;
  level: number;
  count: number;
  exposure: number;
  topRisks: ExtendedRisk[];
}

export function computeMatrixCells(risks: ExtendedRisk[]): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      const inCell = risks.filter((r) => r.probability === p && r.impact === i);
      cells.push({
        probability: p,
        impact: i,
        level: p * i,
        count: inCell.length,
        exposure: inCell.reduce((s, r) => s + r.level, 0),
        topRisks: [...inCell].sort((a, b) => b.level - a.level).slice(0, 3),
      });
    }
  }
  return cells;
}

/* ── Mitigation pipeline (5 stages) ───────────────────────────────── */
export interface PipelineStageStat {
  stage: FunnelStage;
  label: string;
  count: number;
  pct: number;
  conversion: number;
  avgAging: number;
  overdue: number;
}

export function computePipeline(risks: ExtendedRisk[]): PipelineStageStat[] {
  const buckets: Record<FunnelStage, ExtendedRisk[]> = {
    identified: [], assessed: [], mitigating: [], validating: [], resolved: [],
  };
  risks.forEach((r) => { buckets[riskToFunnelStage(r)].push(r); });
  const total = risks.length || 1;

  let prevCount = 0;
  return FUNNEL_STAGE_ORDER.map((stage, idx) => {
    const list = buckets[stage];
    const count = list.length;
    const avgAging = count ? Math.round(list.reduce((s, r) => s + computeAging(r.createdAt), 0) / count) : 0;
    const conversion = idx === 0 ? 100 : prevCount ? Math.round((count / prevCount) * 100) : 0;
    prevCount = count;
    return {
      stage,
      label: FUNNEL_STAGE_LABELS[stage],
      count,
      pct: Math.round((count / total) * 100),
      conversion,
      avgAging,
      overdue: list.filter((r) => isOverdue(r)).length,
    };
  });
}

/* ── Exposure waterfall / bridge ──────────────────────────────────── */
export interface WaterfallStep { name: string; value: number; kind: "total" | "inc" | "dec" }

export function computeWaterfall(risks: ExtendedRisk[]): WaterfallStep[] {
  const open = risks.filter((r) => r.status !== "resolved");
  const sumLevel = (list: ExtendedRisk[]) => list.reduce((s, r) => s + r.level, 0);

  const atual = sumLevel(open);
  const novos = sumLevel(open.filter((r) => computeAging(r.createdAt) <= 30));
  const escalados = Math.round(sumLevel(risks.filter((r) => r.severity === "critical")) * 0.25);
  const mitigados = Math.round(sumLevel(risks.filter((r) => r.status === "mitigating")) * 0.35);
  const resolvidos = sumLevel(risks.filter((r) => r.status === "resolved"));
  const anterior = Math.max(0, atual - novos - escalados + mitigados + resolvidos);

  return [
    { name: "Anterior", value: anterior, kind: "total" },
    { name: "Novos", value: novos, kind: "inc" },
    { name: "Escalados", value: escalados, kind: "inc" },
    { name: "Mitigados", value: -mitigados, kind: "dec" },
    { name: "Resolvidos", value: -resolvidos, kind: "dec" },
    { name: "Atual", value: atual, kind: "total" },
  ];
}

/* ── Heatmap: area × severity ─────────────────────────────────────── */
export interface HeatmapData {
  rows: string[];                       // areas (y)
  cols: { key: ExtendedRisk["severity"]; label: string }[]; // severities (x)
  cells: [number, number, number][];    // [colIdx, rowIdx, count]
  max: number;
}

export function computeHeatmap(risks: ExtendedRisk[]): HeatmapData {
  const cols: { key: ExtendedRisk["severity"]; label: string }[] = [
    { key: "low", label: "Baixo" },
    { key: "medium", label: "Médio" },
    { key: "high", label: "Alto" },
    { key: "critical", label: "Crítico" },
  ];
  const areaTotals: Record<string, number> = {};
  risks.forEach((r) => { areaTotals[r.area || "—"] = (areaTotals[r.area || "—"] || 0) + 1; });
  const rows = Object.entries(areaTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a]) => a);

  const cells: [number, number, number][] = [];
  let max = 0;
  rows.forEach((area, rowIdx) => {
    cols.forEach((col, colIdx) => {
      const count = risks.filter((r) => (r.area || "—") === area && r.severity === col.key).length;
      max = Math.max(max, count);
      cells.push([colIdx, rowIdx, count]);
    });
  });
  return { rows, cols, cells, max: max || 1 };
}

/* ── Bubble / scatter: probability × impact × exposure ────────────── */
export interface BubblePoint {
  id: string;
  title: string;
  probability: number;
  impact: number;
  exposure: number;
  severity: ExtendedRisk["severity"];
}

export function computeBubble(risks: ExtendedRisk[]): BubblePoint[] {
  return risks.map((r) => ({
    id: r.id,
    title: r.title,
    probability: r.probability,
    impact: r.impact,
    exposure: riskExposure(r),
    severity: r.severity,
  }));
}

/* ── Exposure trend (real data fallback) ──────────────────────────── */
const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function computeExposureTrend(risks: ExtendedRisk[], months = 6): TrendPoint[] {
  const now = new Date();
  const points: TrendPoint[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
    // Risks that existed (created before window end) and not resolved before it.
    const live = risks.filter((r) => r.createdAt < next && (!r.resolvedAt || r.resolvedAt >= ref));
    const critical = live.filter((r) => r.severity === "critical").length;
    const high = live.filter((r) => r.severity === "high").length;
    const medium = live.filter((r) => r.severity === "medium").length;
    const raw = live.reduce((s, r) => s + (SEVERITY_WEIGHT[r.severity] ?? 0), 0);
    const score = live.length ? Math.round(Math.min(10, raw / Math.max(1, live.length / 2)) * 10) / 10 : 0;
    points.push({ month: MONTHS_PT[ref.getMonth()], critical, high, medium, score });
  }
  return points;
}

/* ── Executive insights ───────────────────────────────────────────── */
export interface ExecutiveInsights {
  topExposure: { title: string; value: number } | null;
  criticalArea: { name: string; score: number; count: number } | null;
  oldestRisk: { title: string; aging: number } | null;
  overdueMitigation: { count: number; exposure: number };
  trend: { direction: "up" | "down" | "flat"; delta: number };
}

export function computeInsights(risks: ExtendedRisk[], trend: TrendPoint[]): ExecutiveInsights {
  const active = risks.filter((r) => r.status !== "resolved");

  const topExposure = active.length
    ? active.reduce((best, r) => (riskExposure(r) > riskExposure(best) ? r : best))
    : null;

  const domains = computeDomainExposure(risks).filter((d) => d.count > 0);
  const criticalArea = domains.length
    ? domains.reduce((best, d) => (d.score > best.score ? d : best))
    : null;

  const oldest = active.length
    ? active.reduce((best, r) => (computeAging(r.createdAt) > computeAging(best.createdAt) ? r : best))
    : null;

  const overdueList = risks.filter((r) => isOverdue(r) && (r.status === "mitigating" || hasActionPlan(r)));

  let direction: "up" | "down" | "flat" = "flat";
  let delta = 0;
  if (trend.length >= 2) {
    const a = trend[trend.length - 2].score;
    const b = trend[trend.length - 1].score;
    delta = Math.round((b - a) * 10) / 10;
    direction = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  }

  return {
    topExposure: topExposure ? { title: topExposure.title, value: riskExposure(topExposure) } : null,
    criticalArea: criticalArea ? { name: criticalArea.area, score: criticalArea.score, count: criticalArea.count } : null,
    oldestRisk: oldest ? { title: oldest.title, aging: computeAging(oldest.createdAt) } : null,
    overdueMitigation: { count: overdueList.length, exposure: overdueList.reduce((s, r) => s + riskExposure(r), 0) },
    trend: { direction, delta },
  };
}

/* ── Distinct filter option helpers ───────────────────────────────── */
export function distinctOwners(risks: ExtendedRisk[]): string[] {
  return Array.from(new Set(risks.map((r) => r.responsibleName).filter(Boolean) as string[])).sort();
}
export function distinctAreas(risks: ExtendedRisk[]): string[] {
  return Array.from(new Set(risks.map((r) => r.area).filter(Boolean))).sort();
}
export function distinctCategories(risks: ExtendedRisk[]): { value: string; label: string }[] {
  const set = new Set(risks.map((r) => r.category).filter(Boolean));
  return Array.from(set).map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c })).sort((a, b) => a.label.localeCompare(b.label));
}
