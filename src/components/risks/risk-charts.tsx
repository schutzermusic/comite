"use client";

import React, { useMemo } from "react";
import ReactECharts from "echarts-for-react";

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

function tip(c: ReturnType<typeof useC>) {
  return {
    backgroundColor: c.pnl, borderColor: c.bd, borderWidth: 1, borderRadius: 10,
    padding: [10, 14],
    textStyle: { color: c.fg, fontSize: 11, fontFamily: "Inter, sans-serif" },
    extraCssText: "backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 8px 32px rgba(0,0,0,.35);",
  };
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
   RISK TREND — Area line
   ════════════════════════════════════════════════ */
interface TrendPoint { month: string; critical: number; high: number; medium: number }
interface TrendProps { data: TrendPoint[]; height?: number | string }

export function RiskExposureTrendChart({ data, height = 280 }: TrendProps) {
  const c = useC();
  const mkSeries = (name: string, key: keyof TrendPoint, color: string) => ({
    name, type: "line" as const, data: data.map((d) => d[key] as number), smooth: true,
    symbol: "circle", symbolSize: 5,
    lineStyle: { width: 2.5, color },
    itemStyle: { color },
    areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}30` }, { offset: 1, color: `${color}04` }] } },
  });

  const opt = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tip(c), trigger: "axis" as const },
    legend: { top: 0, right: 0, textStyle: { color: c.fgM, fontSize: 10, fontFamily: "Inter" }, itemWidth: 14, itemHeight: 3, icon: "roundRect" },
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    xAxis: { type: "category" as const, data: data.map((d) => d.month), axisLabel: { color: c.fgM, fontSize: 10 }, axisLine: { lineStyle: { color: c.bd } }, axisTick: { show: false }, boundaryGap: false },
    yAxis: { type: "value" as const, axisLabel: { color: c.fgS, fontSize: 10 }, splitLine: { lineStyle: { color: c.bd, type: "dashed" as const } }, axisLine: { show: false } },
    series: [
      mkSeries("Crítico", "critical", c.err),
      mkSeries("Alto", "high", c.warn),
      mkSeries("Médio", "medium", c.info),
    ],
  }), [c, data]);

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/* ════════════════════════════════════════════════
   CATEGORY DISTRIBUTION — Bar
   ════════════════════════════════════════════════ */
interface CatItem { name: string; value: number }
interface CatProps { data: CatItem[]; height?: number | string }

export function CategoryDistributionChart({ data, height = 280 }: CatProps) {
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
      itemStyle: {
        borderRadius: [5, 5, 0, 0],
        color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c.c1 }, { offset: 1, color: `${c.c1}55` }] },
      },
      emphasis: { itemStyle: { shadowBlur: 14, shadowColor: `${c.acc}44` } },
      animationDuration: 700,
    }],
  }), [c, data]);

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

/* ════════════════════════════════════════════════
   TOP RISK OWNERS — Horizontal bar
   ════════════════════════════════════════════════ */
interface OwnerItem { name: string; count: number }
interface OwnersProps { data: OwnerItem[]; height?: number | string }

export function TopRiskOwnersChart({ data, height = 280 }: OwnersProps) {
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
  }), [c, sorted, palette]);

  return <ReactECharts option={opt} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
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
