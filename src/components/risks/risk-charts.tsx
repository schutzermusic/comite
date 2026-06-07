"use client";

import React, { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { cn } from "@/lib/utils";

/* ── Theme-aware color reader ── */
function v(name: string, fb = "#888") {
  if (typeof window === "undefined") return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

function useC() {
  return useMemo(() => ({
    fg: v("--ig-fg-strong", "#F2F5F7"),
    fgM: v("--ig-fg-muted", "rgba(242,245,247,0.60)"),
    fgS: v("--ig-fg-subtle", "rgba(242,245,247,0.38)"),
    bd: v("--ig-border-subtle", "rgba(170,200,190,0.06)"),
    pnl: v("--ig-bg-panel", "rgba(18,26,34,0.72)"),
    cvs: v("--ig-bg-canvas", "#07090C"),
    acc: v("--ig-accent", "#14B8A6"),
    ok: v("--ig-success", "#10B981"),
    warn: v("--ig-warning", "#F5A524"),
    err: v("--ig-danger", "#EF4B55"),
    info: v("--ig-info", "#3B82F6"),
    c1: v("--ig-chart-1", "#14B8A6"),
    c2: v("--ig-chart-2", "#3B82F6"),
    c3: v("--ig-chart-3", "#A855F7"),
    c4: v("--ig-chart-4", "#F5A524"),
    c5: v("--ig-chart-5", "#EF4B55"),
  }), []);
}

type Palette = ReturnType<typeof useC>;

function tip(c: Palette) {
  return {
    backgroundColor: c.pnl, borderColor: c.bd, borderWidth: 1, borderRadius: 10,
    padding: [10, 14],
    textStyle: { color: c.fg, fontSize: 11, fontFamily: "Inter, sans-serif" },
    extraCssText: "backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 8px 32px rgba(0,0,0,.35);",
  };
}

/* ── Severity → color (module-level so chart useMemo deps stay stable). ── */
function sevColor(key: string, c: Palette): string {
  return key === "critical" ? c.err : key === "high" ? c.warn : key === "medium" ? c.info : c.ok;
}

/* ── Empty-data placeholder ──
   ECharts crashes on degenerate configs (e.g. a radar with an empty
   `indicator` array throws "Cannot read properties of undefined (reading
   'push')"). Render this instead of the chart when there is no data. */
function ChartEmpty({ height = 280 }: { height?: number | string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 text-center"
      style={{ height, width: "100%" }}
    >
      <span className="text-[11px] font-medium text-ig-fg-muted">Sem dados no recorte atual</span>
      <span className="text-[10px] text-ig-fg-subtle">Ajuste os filtros ou cadastre riscos</span>
    </div>
  );
}

/* ════════════════════════════════════════════════
   SEVERITY DISTRIBUTION — Donut
   ════════════════════════════════════════════════ */
interface SeverityProps { critical: number; high: number; medium: number; low: number; height?: number | string }

export function SeverityDistributionChart({ critical, high, medium, low, height = 280 }: SeverityProps) {
  const c = useC();
  const total = critical + high + medium + low;
  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "item" as const },
    legend: { bottom: 4, textStyle: { color: c.fgM, fontSize: 10, fontFamily: "Inter" }, itemWidth: 8, itemHeight: 8, itemGap: 14, icon: "circle" },
    series: [{
      type: "pie", radius: ["52%", "78%"], center: ["50%", "44%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: c.cvs, borderWidth: 3 },
      label: { show: false },
      emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 20, shadowColor: "rgba(20,184,166,.25)" } },
      data: [
        { value: critical, name: "Crítico", itemStyle: { color: c.err } },
        { value: high, name: "Alto", itemStyle: { color: c.warn } },
        { value: medium, name: "Médio", itemStyle: { color: c.info } },
        { value: low, name: "Baixo", itemStyle: { color: c.ok } },
      ],
      animationType: "scale", animationEasing: "cubicOut", animationDuration: 700,
    }],
    graphic: [{
      type: "group", left: "center", top: "37%",
      children: [
        { type: "text", style: { text: String(total), textAlign: "center", fill: c.fg, fontSize: 28, fontWeight: 700, fontFamily: "Inter" }, left: "center", top: -10 },
        { type: "text", style: { text: "Riscos", textAlign: "center", fill: c.fgM, fontSize: 10, fontFamily: "Inter" }, left: "center", top: 20 },
      ],
    }],
  }), [c, critical, high, medium, low, total]);

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/* ════════════════════════════════════════════════
   STATUS BREAKDOWN — Horizontal bar
   ════════════════════════════════════════════════ */
interface StatusProps { open: number; mitigating: number; resolved: number; height?: number | string; onStatusClick?: (status: string) => void }

export function StatusBreakdownChart({ open, mitigating, resolved, height = 200, onStatusClick }: StatusProps) {
  const c = useC();
  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
    grid: { left: 4, right: 32, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value" as const, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    yAxis: {
      type: "category" as const, data: ["Resolvido", "Mitigando", "Aberto"],
      axisLabel: { color: c.fgM, fontSize: 11, fontFamily: "Inter", fontWeight: 500 },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: "bar",
      data: [
        { value: resolved, itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: `${c.ok}cc` }, { offset: 1, color: c.ok }] } } },
        { value: mitigating, itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: `${c.warn}cc` }, { offset: 1, color: c.warn }] } } },
        { value: open, itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: `${c.err}cc` }, { offset: 1, color: c.err }] } } },
      ],
      barWidth: 20,
      itemStyle: { borderRadius: [0, 5, 5, 0] },
      label: { show: true, position: "right" as const, color: c.fgM, fontSize: 12, fontWeight: 700, fontFamily: "Inter" },
      animationDuration: 700,
    }],
  }), [c, open, mitigating, resolved]);

  const events: Record<string, (params: { dataIndex: number }) => void> | undefined = onStatusClick ? {
    click: (params: { dataIndex: number }) => {
      const map = ["resolved", "mitigating", "open"];
      onStatusClick(map[params.dataIndex]);
    },
  } : undefined;

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   RISK TREND — Area line + corporate score overlay
   ════════════════════════════════════════════════ */
interface TrendPoint { month: string; critical: number; high: number; medium: number; score?: number }
interface TrendProps { data: TrendPoint[]; height?: number | string; onSelect?: (month: string, severity?: "critical" | "high" | "medium") => void }

const TREND_SERIES_SEV: Record<string, "critical" | "high" | "medium" | undefined> = {
  "Crítico": "critical", "Alto": "high", "Médio": "medium", "Score corporativo": undefined,
};

export function RiskExposureTrendChart({ data, height = 280, onSelect }: TrendProps) {
  const c = useC();
  const hasScore = data.some((d) => typeof d.score === "number");

  const opt = useMemo(() => {
    const mkSeries = (name: string, key: "critical" | "high" | "medium", color: string) => ({
      name, type: "line" as const, data: data.map((d) => d[key]), smooth: true,
      symbol: "circle", symbolSize: 5,
      lineStyle: { width: 2.5, color },
      itemStyle: { color },
      areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}30` }, { offset: 1, color: `${color}04` }] } },
    });
    return {
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "axis" as const },
    legend: { top: 0, right: 0, textStyle: { color: c.fgM, fontSize: 10, fontFamily: "Inter" }, itemWidth: 14, itemHeight: 3, icon: "roundRect" },
    grid: { left: 8, right: hasScore ? 30 : 8, top: 36, bottom: 8, containLabel: true },
    xAxis: { type: "category" as const, data: data.map((d) => d.month), axisLabel: { color: c.fgM, fontSize: 10 }, axisLine: { lineStyle: { color: c.bd } }, axisTick: { show: false }, boundaryGap: false },
    yAxis: [
      { type: "value" as const, name: "Riscos", nameTextStyle: { color: c.fgS, fontSize: 9 }, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
      ...(hasScore ? [{
        type: "value" as const, name: "Score", min: 0, max: 10, position: "right" as const,
        nameTextStyle: { color: c.fgS, fontSize: 9 },
        axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { show: false }, axisLine: { show: false },
      }] : []),
    ],
    series: [
      mkSeries("Crítico", "critical", c.err),
      mkSeries("Alto", "high", c.warn),
      mkSeries("Médio", "medium", c.info),
      ...(hasScore ? [{
        name: "Score corporativo", type: "line" as const, yAxisIndex: 1,
        data: data.map((d) => d.score ?? null), smooth: true,
        symbol: "circle", symbolSize: 6,
        lineStyle: { width: 2.5, color: c.acc, type: "dashed" as const },
        itemStyle: { color: c.acc },
        z: 5,
      }] : []),
    ],
    };
  }, [c, data, hasScore]);

  const events = onSelect
    ? { click: (p: { name?: string; seriesName?: string }) => { if (p.name) onSelect(p.name, TREND_SERIES_SEV[p.seriesName ?? ""]); } }
    : undefined;

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   SEVERITY DONUT + SIDE LEGEND
   ════════════════════════════════════════════════ */
interface SeveritySlice { key: string; label: string; value: number; pct: number }
interface DonutLegendProps { slices: SeveritySlice[]; height?: number | string; onSelect?: (key: string) => void }

export function SeverityDonutWithLegend({ slices, height = 240, onSelect }: DonutLegendProps) {
  const c = useC();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const [hover, setHover] = useState<string | null>(null);

  /* Geometry — pure SVG donut (no charting lib). */
  const R = 74, SW = 22, CIRC = 2 * Math.PI * R, GAP_DEG = 6;
  const visible = slices.filter((s) => s.value > 0);
  const angles = visible.map((s) => (s.value / total) * 360);
  const segs = visible.map((s, i) => {
    const start = angles.slice(0, i).reduce((a, b) => a + b, 0);
    const arcLen = Math.max(2, (angles[i] / 360) * CIRC - (GAP_DEG / 360) * CIRC);
    return { ...s, rot: start - 90, dash: arcLen, color: sevColor(s.key, c) };
  });
  const active = hover ? slices.find((s) => s.key === hover) ?? null : null;
  const activeColor = active ? sevColor(active.key, c) : c.fg;

  return (
    <div className="flex items-center gap-3" style={{ minHeight: height }}>
      <div className="shrink-0" style={{ width: "50%", height }}>
        {total === 0 ? (
          <ChartEmpty height={height} />
        ) : (
          <svg viewBox="0 0 200 200" className="overflow-visible" style={{ width: "100%", height }} role="img" aria-label="Distribuição por severidade">
            <defs>
              {segs.map((s) => (
                <linearGradient key={s.key} id={`sev-grad-${s.key}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={`color-mix(in oklab, ${s.color} 72%, white 24%)`} />
                  <stop offset="100%" stopColor={s.color} />
                </linearGradient>
              ))}
            </defs>

            {/* base track */}
            <circle cx="100" cy="100" r={R} fill="none" stroke={c.bd} strokeWidth={SW} opacity={0.45} style={{ pointerEvents: "none" }} />

            {segs.map((s, i) => {
              const dim = hover !== null && hover !== s.key;
              const on = hover === s.key;
              return (
                <circle
                  key={s.key}
                  cx="100" cy="100" r={R} fill="none"
                  stroke={`url(#sev-grad-${s.key})`}
                  strokeWidth={on ? SW + 5 : SW}
                  strokeLinecap="round"
                  strokeDasharray={`0 ${CIRC}`}
                  transform={`rotate(${s.rot} 100 100)`}
                  style={{
                    opacity: dim ? 0.22 : 1,
                    cursor: onSelect ? "pointer" : "default",
                    filter: on ? `drop-shadow(0 0 7px color-mix(in oklab, ${s.color} 70%, transparent))` : "none",
                    transition: "opacity .2s ease, stroke-width .2s ease, filter .2s ease",
                  }}
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={onSelect ? () => onSelect(s.key) : undefined}
                >
                  <title>{`${s.label}: ${s.value} (${s.pct}%)`}</title>
                  <animate attributeName="stroke-dasharray" from={`0 ${CIRC}`} to={`${s.dash} ${CIRC}`} dur="0.7s" begin={`${i * 0.1}s`} fill="freeze" />
                </circle>
              );
            })}

            {/* center readout */}
            <text x="100" y="98" textAnchor="middle" style={{ fontFamily: "Inter, sans-serif", fontSize: 30, fontWeight: 700, fill: activeColor, transition: "fill .2s ease" }}>
              {active ? active.value : total}
            </text>
            <text x="100" y="118" textAnchor="middle" style={{ fontFamily: "Inter, sans-serif", fontSize: 9, fontWeight: 600, letterSpacing: 1, fill: c.fgM }}>
              {active ? active.label.toUpperCase() : "RISCOS"}
            </text>
          </svg>
        )}
      </div>
      <ul className="flex-1 space-y-2">
        {slices.map((s) => {
          const Row = onSelect ? "button" : "li";
          const color = sevColor(s.key, c);
          return (
            <Row
              key={s.key}
              type={onSelect ? "button" : undefined}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              className={cn(
                "group/sev relative w-full overflow-hidden rounded-lg border border-ig-border-subtle bg-ig-raised px-2.5 py-1.5 text-left",
                onSelect && "cursor-pointer transition-all hover:border-ig-accent hover:bg-ig-accent-weak/30",
              )}
            >
              {/* progress track */}
              <span
                className="pointer-events-none absolute inset-y-0 left-0 opacity-15 transition-opacity group-hover/sev:opacity-25"
                style={{ width: `${s.pct}%`, background: `linear-gradient(90deg, ${color}, transparent)` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                  <span className="truncate text-[11px] font-medium text-ig-fg-muted">{s.label}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span className="text-[13px] font-bold ig-tabular text-ig-fg-strong">{s.value}</span>
                  <span className="text-[10px] font-medium ig-tabular text-ig-fg-subtle">{s.pct}%</span>
                </span>
              </span>
            </Row>
          );
        })}
      </ul>
    </div>
  );
}

/* ════════════════════════════════════════════════
   EXPOSURE WATERFALL / BRIDGE
   ════════════════════════════════════════════════ */
interface WaterfallStep { name: string; value: number; kind: "total" | "inc" | "dec" }
type WaterfallBucketKey = "anterior" | "novos" | "escalados" | "mitigados" | "resolvidos" | "atual";
interface WaterfallProps { data: WaterfallStep[]; height?: number | string; onSelect?: (bucket: WaterfallBucketKey) => void }

const WATERFALL_NAME_BUCKET: Record<string, WaterfallBucketKey> = {
  "Anterior": "anterior", "Novos": "novos", "Escalados": "escalados",
  "Mitigados": "mitigados", "Resolvidos": "resolvidos", "Atual": "atual",
};

export function RiskWaterfallChart({ data, height = 260, onSelect }: WaterfallProps) {
  const c = useC();

  const opt = useMemo(() => {
    const colorFor = (step: WaterfallStep) =>
      step.kind === "total" ? c.info : step.kind === "inc" ? c.err : c.ok;
    // Compute the transparent base for each floating bar.
    const bases: number[] = [];
    const values: number[] = [];
    let running = 0;
    data.forEach((step) => {
      if (step.kind === "total") {
        bases.push(0);
        values.push(step.value);
        running = step.value;
      } else {
        const v = step.value;
        if (v >= 0) { bases.push(running); values.push(v); }
        else { bases.push(running + v); values.push(-v); }
        running += v;
      }
    });
    return {
    backgroundColor: "transparent",
    tooltip: {
      ...tip(c), trigger: "axis" as const, axisPointer: { type: "shadow" as const },
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const step = data[i];
        const sign = step.kind === "inc" ? "+" : step.kind === "dec" ? "−" : "";
        return `<div style="font-size:11px;color:${c.fg}"><b>${step.name}</b></div><div style="font-size:11px;color:${c.fgM}">${sign}${Math.abs(step.value)} pts de exposição</div>`;
      },
    },
    grid: { left: 8, right: 12, top: 12, bottom: 8, containLabel: true },
    xAxis: { type: "category" as const, data: data.map((d) => d.name), axisLabel: { color: c.fgM, fontSize: 10, interval: 0 }, axisLine: { lineStyle: { color: c.bd } }, axisTick: { show: false } },
    yAxis: { type: "value" as const, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    series: [
      { type: "bar", stack: "wf", silent: true, itemStyle: { color: "transparent" }, data: bases, barWidth: "52%", emphasis: { itemStyle: { color: "transparent" } } },
      {
        type: "bar", stack: "wf", barWidth: "52%",
        cursor: onSelect ? "pointer" : "default",
        data: values.map((v, i) => ({ value: v, itemStyle: { color: colorFor(data[i]), borderRadius: [4, 4, 0, 0] } })),
        label: { show: true, position: "top" as const, color: c.fgM, fontSize: 10, fontWeight: 700, formatter: (p: { dataIndex: number }) => { const s = data[p.dataIndex]; return `${s.kind === "inc" ? "+" : s.kind === "dec" ? "−" : ""}${Math.abs(s.value)}`; } },
        animationDuration: 700,
      },
    ],
    };
  }, [c, data, onSelect]);

  const events = onSelect
    ? { click: (p: { dataIndex?: number }) => { const s = data[p.dataIndex ?? -1]; const b = s ? WATERFALL_NAME_BUCKET[s.name] : undefined; if (b) onSelect(b); } }
    : undefined;

  if (data.length === 0) return <ChartEmpty height={height} />;
  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   BUBBLE — Probability × Impact × Exposure
   ════════════════════════════════════════════════ */
interface BubblePoint { id: string; title: string; probability: number; impact: number; exposure: number; severity: string }
interface BubbleProps { data: BubblePoint[]; height?: number | string; onSelect?: (riskId: string) => void }

export function RiskBubbleChart({ data, height = 300, onSelect }: BubbleProps) {
  const c = useC();

  const opt = useMemo(() => {
    const maxExp = Math.max(...data.map((d) => d.exposure), 1);
    return {
    backgroundColor: "transparent",
    tooltip: {
      ...tip(c), trigger: "item" as const,
      formatter: (p: { data: { raw: BubblePoint } }) => {
        const r = p.data.raw;
        const exp = new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL", maximumFractionDigits: 1 }).format(r.exposure);
        return `<div style="max-width:220px"><div style="font-size:11px;font-weight:700;color:${c.fg}">${r.title}</div><div style="font-size:10px;color:${c.fgM};margin-top:4px">P${r.probability} × I${r.impact} · Score ${r.probability * r.impact}</div><div style="font-size:10px;color:${c.fgS}">Exposição ${exp}</div></div>`;
      },
    },
    grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
    xAxis: { type: "value" as const, name: "Probabilidade", nameLocation: "middle" as const, nameGap: 26, min: 0.5, max: 5.5, interval: 1, nameTextStyle: { color: c.fgM, fontSize: 10 }, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    yAxis: { type: "value" as const, name: "Impacto", nameLocation: "middle" as const, nameGap: 22, min: 0.5, max: 5.5, interval: 1, nameTextStyle: { color: c.fgM, fontSize: 10 }, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    series: [{
      type: "scatter",
      cursor: onSelect ? "pointer" : "default",
      symbolSize: (val: number[]) => 12 + Math.sqrt((val[2] ?? 0) / maxExp) * 34,
      data: data.map((d) => {
        const color = sevColor(d.severity, c);
        return {
          value: [d.probability, d.impact, d.exposure],
          raw: d,
          itemStyle: { color: `${color}cc`, borderColor: color, borderWidth: 1.5, shadowBlur: 8, shadowColor: `${color}55` },
        };
      }),
      emphasis: { itemStyle: { shadowBlur: 16 } },
      animationDuration: 700,
    }],
    };
  }, [c, data, onSelect]);

  const events = onSelect
    ? { click: (p: { data?: { raw?: { id: string } } }) => { if (p.data?.raw?.id) onSelect(p.data.raw.id); } }
    : undefined;

  if (data.length === 0) return <ChartEmpty height={height} />;
  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   HEATMAP — Area × Severity concentration
   ════════════════════════════════════════════════ */
interface HeatmapProps {
  rows: string[];
  cols: { key: string; label: string }[];
  cells: [number, number, number][];
  max: number;
  height?: number | string;
  onSelect?: (area: string, severityKey: string) => void;
}

export function RiskHeatmapChart({ rows, cols, cells, max, height = 300, onSelect }: HeatmapProps) {
  const c = useC();
  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      ...tip(c), position: "top" as const,
      formatter: (p: { data: [number, number, number] }) => {
        const [x, y, v] = p.data;
        return `<div style="font-size:11px;color:${c.fg}">${rows[y]} · ${cols[x].label}</div><div style="font-size:13px;font-weight:700;color:${c.fg}">${v} risco(s)</div>`;
      },
    },
    grid: { left: 8, right: 12, top: 8, bottom: 22, containLabel: true },
    xAxis: { type: "category" as const, data: cols.map((cc) => cc.label), splitArea: { show: true }, axisLabel: { color: c.fgM, fontSize: 10 }, axisLine: { lineStyle: { color: c.bd } }, axisTick: { show: false } },
    yAxis: { type: "category" as const, data: rows, splitArea: { show: true }, axisLabel: { color: c.fgM, fontSize: 10 }, axisLine: { lineStyle: { color: c.bd } }, axisTick: { show: false } },
    visualMap: {
      min: 0, max, calculable: false, show: false,
      inRange: { color: [`${c.acc}10`, `${c.info}99`, c.warn, c.err] },
    },
    series: [{
      type: "heatmap", data: cells,
      cursor: onSelect ? "pointer" : "default",
      label: { show: true, color: c.fg, fontSize: 10, fontWeight: 600, formatter: (p: { data: [number, number, number] }) => (p.data[2] > 0 ? String(p.data[2]) : "") },
      itemStyle: { borderColor: c.cvs, borderWidth: 2, borderRadius: 4 },
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: `${c.acc}55` } },
      animationDuration: 700,
    }],
  }), [c, rows, cols, cells, max, onSelect]);

  const events = onSelect
    ? { click: (p: { data?: [number, number, number] }) => { if (p.data) { const [x, y] = p.data; const area = rows[y]; const sev = cols[x]?.key; if (area && sev) onSelect(area, sev); } } }
    : undefined;

  if (rows.length === 0) return <ChartEmpty height={height} />;
  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   CATEGORY DISTRIBUTION — Bar
   ════════════════════════════════════════════════ */
interface CatItem { name: string; value: number }
interface CatProps { data: CatItem[]; height?: number | string; onSelect?: (name: string) => void }

export function CategoryDistributionChart({ data, height = 280, onSelect }: CatProps) {
  const c = useC();
  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "axis" as const, axisPointer: { type: "shadow" as const, shadowStyle: { color: `${c.acc}08` } } },
    grid: { left: 8, right: 16, top: 12, bottom: 24, containLabel: true },
    xAxis: {
      type: "category" as const, data: data.map((d) => d.name),
      axisLabel: { color: c.fgM, fontSize: 10, fontFamily: "Inter", interval: 0, rotate: data.length > 5 ? 20 : 0 },
      axisLine: { lineStyle: { color: c.bd } }, axisTick: { show: false },
    },
    yAxis: { type: "value" as const, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    series: [{
      type: "bar", data: data.map((d) => d.value), barWidth: "44%",
      cursor: onSelect ? "pointer" : "default",
      itemStyle: {
        borderRadius: [5, 5, 0, 0],
        color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c.c1 }, { offset: 1, color: `${c.c1}55` }] },
      },
      emphasis: { itemStyle: { shadowBlur: 14, shadowColor: `${c.acc}44` } },
      animationDuration: 700,
    }],
  }), [c, data, onSelect]);

  const events = onSelect ? { click: (p: { name?: string }) => { if (p.name) onSelect(p.name); } } : undefined;

  if (data.length === 0) return <ChartEmpty height={height} />;
  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   TOP RISK OWNERS — Horizontal bar
   ════════════════════════════════════════════════ */
interface OwnerItem { name: string; count: number }
interface OwnersProps { data: OwnerItem[]; height?: number | string; onSelect?: (name: string) => void }

export function TopRiskOwnersChart({ data, height = 280, onSelect }: OwnersProps) {
  const c = useC();
  const sorted = useMemo(() => [...data].sort((a, b) => a.count - b.count), [data]);
  const palette = [c.c1, c.c2, c.c3, c.c4, c.c5];

  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
    grid: { left: 4, right: 32, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value" as const, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    yAxis: {
      type: "category" as const, data: sorted.map((d) => d.name),
      axisLabel: { color: c.fgM, fontSize: 10, fontFamily: "Inter" },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: "bar",
      cursor: onSelect ? "pointer" : "default",
      data: sorted.map((d, i) => ({
        value: d.count,
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: palette[i % 5] }, { offset: 1, color: `${palette[i % 5]}88` }] },
        },
      })),
      barWidth: 14,
      label: { show: true, position: "right" as const, color: c.fgM, fontSize: 10, fontWeight: 700 },
      animationDuration: 700,
    }],
  }), [c, sorted, palette, onSelect]);

  const events = onSelect ? { click: (p: { name?: string }) => { if (p.name) onSelect(p.name); } } : undefined;

  if (sorted.length === 0) return <ChartEmpty height={height} />;
  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={events} />;
}

/* ════════════════════════════════════════════════
   AREA EXPOSURE — Enhanced Radar
   ════════════════════════════════════════════════ */
interface AreaItem { area: string; score: number; count: number }
interface AreaProps { data: AreaItem[]; height?: number | string }

export function RiskAreaExposureChart({ data, height = 300 }: AreaProps) {
  const c = useC();
  const maxVal = Math.max(...data.map((d) => d.score), 10);

  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      ...tip(c), trigger: "item" as const,
      formatter: (p: { name: string; value: number[] }) => {
        const item = data.find((d) => d.area === p.name);
        return `<div style="font-size:10px;color:${c.fgM}">${p.name}</div><div style="font-size:16px;font-weight:700;color:${c.fg}">Score ${item?.score ?? "—"}</div><div style="font-size:10px;color:${c.fgS}">${item?.count ?? 0} risco(s)</div>`;
      },
    },
    radar: {
      indicator: data.map((d) => ({ name: `${d.area}\n(${d.count})`, max: maxVal })),
      shape: "polygon" as const, splitNumber: 4,
      axisName: { color: c.fgM, fontSize: 10, fontFamily: "Inter", lineHeight: 14 },
      splitLine: { lineStyle: { color: c.bd } },
      splitArea: { areaStyle: { color: ["transparent", `${c.acc}06`, "transparent", `${c.acc}04`] } },
      axisLine: { lineStyle: { color: c.bd } },
      center: ["50%", "52%"],
      radius: "68%",
    },
    series: [{
      type: "radar",
      data: [{
        value: data.map((d) => d.score), name: "Exposição",
        areaStyle: {
          color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: `${c.err}38` }, { offset: 1, color: `${c.acc}10` }] },
        },
      }],
      symbol: "circle", symbolSize: 7,
      lineStyle: { width: 2.5, color: c.err },
      itemStyle: { color: c.err, borderColor: c.cvs, borderWidth: 2 },
      emphasis: { lineStyle: { width: 3 }, areaStyle: { color: `${c.err}48` } },
      animationDuration: 800,
    }],
  }), [c, data, maxVal]);

  if (data.length === 0) return <ChartEmpty height={height} />;
  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

interface FunnelProps {
  identified: number;
  assessed: number;
  mitigating: number;
  resolved: number;
  height?: number | string;
}

export function MitigationFunnelChart({ identified, assessed, mitigating, resolved, height = 260 }: FunnelProps) {
  const c = useC();
  const data = [
    { name: "Identificados", value: identified, color: c.info },
    { name: "Avaliados", value: assessed, color: c.c1 },
    { name: "Mitigando", value: mitigating, color: c.warn },
    { name: "Resolvidos", value: resolved, color: c.ok },
  ];

  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "item" as const },
    series: [{
      type: "funnel",
      left: "8%",
      right: "8%",
      top: 8,
      bottom: 8,
      minSize: "18%",
      maxSize: "100%",
      sort: "none" as const,
      gap: 4,
      label: { color: c.fg, fontSize: 11, fontWeight: 600 },
      labelLine: { lineStyle: { color: c.bd } },
      itemStyle: { borderColor: c.cvs, borderWidth: 2, borderRadius: 4 },
      data: data.map((item) => ({
        name: item.name,
        value: item.value,
        itemStyle: { color: item.color },
      })),
    }],
  }), [c, data]);

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

interface HeatAreaItem { area: string; score: number; count?: number }
interface HeatAreaProps { data: HeatAreaItem[]; height?: number | string }

export function RiskHeatByAreaChart({ data, height = 260 }: HeatAreaProps) {
  return (
    <RiskAreaExposureChart
      data={data.map((item) => ({ area: item.area, score: item.score, count: item.count ?? 1 }))}
      height={height}
    />
  );
}
