"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { ExtendedRisk } from "./risk-types";

interface Props {
  risks: ExtendedRisk[];
  onCellClick: (prob: number, impact: number) => void;
  highlightedCell?: { prob: number; impact: number } | null;
}

const PROBS = [5, 4, 3, 2, 1];
const IMPS = [1, 2, 3, 4, 5];

const PROB_LABELS: Record<number, string> = {
  5: "Muito Alta", 4: "Alta", 3: "Média", 2: "Baixa", 1: "Muito Baixa",
};
const IMP_LABELS: Record<number, string> = {
  1: "M. Baixo", 2: "Baixo", 3: "Médio", 4: "Alto", 5: "M. Alto",
};

function cellLevel(p: number, i: number) { return p * i; }

/* ── Zone config (level thresholds) ── */
type Zone = "critical" | "high" | "medium" | "low";
function cellZone(level: number): Zone {
  if (level >= 16) return "critical";
  if (level >= 11) return "high";
  if (level >= 6)  return "medium";
  return "low";
}

const ZONE_STYLES: Record<Zone, {
  bg: string; border: string; glow: string; dot: string; dotGlow: string;
}> = {
  critical: {
    bg: "linear-gradient(145deg, rgba(239,75,85,0.22) 0%, rgba(239,75,85,0.08) 60%, rgba(239,75,85,0.04) 100%)",
    border: "rgba(239,75,85,0.30)",
    glow: "rgba(239,75,85,0.15)",
    dot: "var(--ig-danger)",
    dotGlow: "rgba(239,75,85,0.60)",
  },
  high: {
    bg: "linear-gradient(145deg, rgba(245,165,36,0.20) 0%, rgba(245,165,36,0.07) 60%, rgba(245,165,36,0.03) 100%)",
    border: "rgba(245,165,36,0.26)",
    glow: "rgba(245,165,36,0.12)",
    dot: "var(--ig-warning)",
    dotGlow: "rgba(245,165,36,0.60)",
  },
  medium: {
    bg: "linear-gradient(145deg, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0.06) 60%, rgba(59,130,246,0.03) 100%)",
    border: "rgba(59,130,246,0.22)",
    glow: "rgba(59,130,246,0.10)",
    dot: "var(--ig-info)",
    dotGlow: "rgba(59,130,246,0.60)",
  },
  low: {
    bg: "linear-gradient(145deg, rgba(16,185,129,0.14) 0%, rgba(16,185,129,0.05) 60%, rgba(16,185,129,0.02) 100%)",
    border: "rgba(16,185,129,0.18)",
    glow: "rgba(16,185,129,0.08)",
    dot: "var(--ig-success)",
    dotGlow: "rgba(16,185,129,0.55)",
  },
};

const ZONE_BADGE: Record<Zone, { label: string; range: string; color: string; bg: string; border: string }> = {
  critical: { label: "Crítico",  range: "16–25", color: "var(--ig-danger)",  bg: "color-mix(in oklab, var(--ig-danger) 12%, transparent)",  border: "color-mix(in oklab, var(--ig-danger) 28%, transparent)"  },
  high:     { label: "Alto",     range: "11–15", color: "var(--ig-warning)", bg: "color-mix(in oklab, var(--ig-warning) 12%, transparent)", border: "color-mix(in oklab, var(--ig-warning) 28%, transparent)" },
  medium:   { label: "Médio",    range: "6–10",  color: "var(--ig-info)",    bg: "color-mix(in oklab, var(--ig-info) 12%, transparent)",    border: "color-mix(in oklab, var(--ig-info) 28%, transparent)"    },
  low:      { label: "Baixo",    range: "1–5",   color: "var(--ig-success)", bg: "color-mix(in oklab, var(--ig-success) 12%, transparent)", border: "color-mix(in oklab, var(--ig-success) 28%, transparent)" },
};

/* ── Column template: label gutter uses a fixed percentage of total width ── */
const COL_TEMPLATE = "8% repeat(5, 1fr)";

export function RiskMatrix5x5({ risks, onCellClick, highlightedCell }: Props) {
  const getRisksForCell = (p: number, i: number) =>
    risks.filter((r) => r.probability === p && r.impact === i);

  return (
    /* container-type:inline-size so cqw = % of THIS element's width */
    <div className="w-full flex flex-col gap-2" style={{ containerType: "inline-size" }}>
      {/* ── Impact axis header ── */}
      <div className="flex items-center gap-1.5" style={{ paddingLeft: "8%" }}>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-ig-border-subtle to-transparent" />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">
          Impacto →
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-ig-border-subtle to-transparent" />
      </div>

      {/* ── Square grid wrapper — height driven by own width via aspect-ratio.
           Works on any screen size: no h-full / flex-1 dependency on parent. ── */}
      <div className="relative w-full flex-shrink-0" style={{ aspectRatio: "1 / 1" }}>
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: COL_TEMPLATE,
            gridTemplateRows: "auto repeat(5, 1fr)",
          }}
        >
          {/* Impact column headers */}
          <div />
          {IMPS.map((imp) => (
            <div key={`h-${imp}`} className="flex flex-col items-center justify-end pb-1 px-0.5">
              <span className="text-[clamp(11px,2.6cqw,18px)] font-bold tabular-nums text-ig-fg-muted leading-none">
                {imp}
              </span>
              <span className="mt-0.5 text-[clamp(6px,1.3cqw,9px)] font-medium text-ig-fg-subtle truncate">
                {IMP_LABELS[imp]}
              </span>
            </div>
          ))}

          {/* Data rows */}
          {PROBS.map((prob) => (
            <React.Fragment key={`r-${prob}`}>
              {/* Row label */}
              <div className="flex items-center justify-end pr-1.5">
                <div className="flex flex-col items-end text-right">
                  <span className="text-[clamp(6px,1.3cqw,9px)] font-medium text-ig-fg-subtle leading-tight">
                    {PROB_LABELS[prob]}
                  </span>
                  <span className="text-[clamp(11px,2.6cqw,18px)] font-bold tabular-nums text-ig-fg-muted leading-none">
                    {prob}
                  </span>
                </div>
              </div>

              {/* Cells */}
              {IMPS.map((imp) => {
                const level = cellLevel(prob, imp);
                const zone = cellZone(level);
                const zs = ZONE_STYLES[zone];
                const cellRisks = getRisksForCell(prob, imp);
                const count = cellRisks.length;
                const exposure = cellRisks.reduce((s, r) => s + r.level, 0);
                const isHighlighted = highlightedCell?.prob === prob && highlightedCell?.impact === imp;
                const dimmed = !!highlightedCell && !isHighlighted;
                const topTitles = [...cellRisks]
                  .sort((a, b) => b.level - a.level)
                  .slice(0, 3)
                  .map((r) => `• ${r.title}`)
                  .join("\n");
                const tooltip =
                  `P${prob} × I${imp} = ${level}\n${count} risco(s) · exposição ${exposure}` +
                  (topTitles ? `\n${topTitles}` : "") +
                  (count ? "\n(clique para filtrar)" : "");

                return (
                  <button
                    key={`c-${prob}-${imp}`}
                    type="button"
                    onClick={() => onCellClick(prob, imp)}
                    aria-pressed={isHighlighted}
                    className={cn(
                      "group relative m-[2px] flex h-[calc(100%-4px)] w-[calc(100%-4px)] flex-col items-center justify-center rounded-[8px] border transition-all duration-200",
                      "hover:scale-[1.06] hover:z-10",
                      isHighlighted && "ring-2 ring-ig-accent scale-[1.06] z-10",
                      dimmed && "opacity-35",
                    )}
                    style={{
                      background: cellGradientWithHighlight(zone, isHighlighted),
                      borderColor: isHighlighted ? "var(--ig-accent)" : zs.border,
                      boxShadow: isHighlighted
                        ? `0 0 0 1px var(--ig-accent), 0 4px 16px ${zs.glow}, inset 0 1px 0 rgba(255,255,255,0.08)`
                        : `0 2px 8px ${zs.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                    }}
                    title={tooltip}
                  >
                    <span className="relative z-10 text-[clamp(10px,3cqw,20px)] font-bold tabular-nums text-ig-fg-strong opacity-75 transition-opacity group-hover:opacity-100">
                      {level}
                    </span>

                    {count > 0 && (
                      <span className="relative z-10 mt-0.5 text-[clamp(5.5px,1.3cqw,9px)] font-medium tabular-nums text-ig-fg-subtle">
                        {exposure}
                      </span>
                    )}

                    {count > 0 && (
                      <span
                        className="absolute -top-1.5 -right-1.5 z-20 flex h-[clamp(14px,3cqw,22px)] min-w-[clamp(14px,3cqw,22px)] items-center justify-center rounded-full border-2 px-0.5 text-[clamp(7px,1.6cqw,11px)] font-bold shadow-md"
                        style={{
                          backgroundColor: zs.dot,
                          borderColor: "var(--ig-bg-canvas)",
                          color: "#fff",
                          boxShadow: `0 0 8px ${zs.dotGlow}`,
                        }}
                      >
                        {count}
                      </span>
                    )}

                    <div
                      className="pointer-events-none absolute inset-0 rounded-[8px] opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: `radial-gradient(ellipse 80% 80% at 50% 50%, ${zs.glow}, transparent 75%)` }}
                    />
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {(["critical", "high", "medium", "low"] as Zone[]).map((zone) => {
          const b = ZONE_BADGE[zone];
          return (
            <span
              key={zone}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[9.5px] font-semibold"
              style={{ color: b.color, backgroundColor: b.bg, borderColor: b.border }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: b.color, boxShadow: `0 0 5px ${b.color}` }} />
              {b.label}
              <span className="opacity-55 font-normal">{b.range}</span>
            </span>
          );
        })}
      </div>

      {/* ── Probability axis label ── */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">
          ← Probabilidade
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-ig-border-subtle to-transparent opacity-60" />
      </div>
    </div>
  );
}

function cellGradientWithHighlight(zone: Zone, highlighted: boolean): string {
  const zs = ZONE_STYLES[zone];
  if (highlighted) {
    return zs.bg.replace(/rgba/g, "rgba").replace(
      /0\.(22|20|18|14)\)/,
      (_, n) => `${(parseFloat(n) * 1.6).toFixed(2)})`
    );
  }
  return zs.bg;
}
