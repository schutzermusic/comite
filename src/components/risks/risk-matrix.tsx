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

const PROB_LABELS: Record<number, string> = { 5: "Muito Alta", 4: "Alta", 3: "Média", 2: "Baixa", 1: "Muito Baixa" };
const IMP_LABELS: Record<number, string> = { 1: "Muito Baixo", 2: "Baixo", 3: "Médio", 4: "Alto", 5: "Muito Alto" };

function cellLevel(p: number, i: number) { return p * i; }

function cellGradient(level: number) {
  if (level >= 16) return "linear-gradient(135deg, rgba(239,75,85,0.28), rgba(239,75,85,0.12))";
  if (level >= 11) return "linear-gradient(135deg, rgba(245,165,36,0.24), rgba(245,165,36,0.10))";
  if (level >= 6)  return "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(59,130,246,0.08))";
  return "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))";
}

function cellBorderColor(level: number) {
  if (level >= 16) return "rgba(239,75,85,0.35)";
  if (level >= 11) return "rgba(245,165,36,0.30)";
  if (level >= 6)  return "rgba(59,130,246,0.25)";
  return "rgba(16,185,129,0.20)";
}

function dotColor(level: number) {
  if (level >= 16) return "var(--ig-danger)";
  if (level >= 11) return "var(--ig-warning)";
  if (level >= 6)  return "var(--ig-info)";
  return "var(--ig-success)";
}

export function RiskMatrix5x5({ risks, onCellClick, highlightedCell }: Props) {
  const getRisksForCell = (p: number, i: number) =>
    risks.filter((r) => r.probability === p && r.impact === i);

  return (
    <div className="space-y-2">
      {/* Column labels */}
      <div className="flex items-end gap-1 pl-[clamp(3rem,6vw,4.5rem)]">
        <span className="flex-1 text-center text-[clamp(8px,0.7vw,10px)] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">
          Impacto →
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <div className="inline-grid min-w-[clamp(320px,100%,520px)]" style={{ gridTemplateColumns: `clamp(3rem,6vw,4.5rem) repeat(5, 1fr)` }}>
          {/* Impact header row */}
          <div /> {/* empty top-left */}
          {IMPS.map((imp) => (
            <div key={`h-${imp}`} className="flex flex-col items-center justify-end pb-1.5 px-0.5">
              <span className="text-[clamp(13px,1.4vw,18px)] font-bold ig-tabular text-ig-fg-muted">{imp}</span>
              <span className="text-[clamp(7px,0.6vw,8px)] text-ig-fg-subtle truncate">{IMP_LABELS[imp]}</span>
            </div>
          ))}

          {/* Data rows */}
          {PROBS.map((prob) => (
            <React.Fragment key={`r-${prob}`}>
              {/* Row label */}
              <div className="flex items-center justify-end gap-1 pr-2">
                <div className="flex flex-col items-end">
                  <span className="text-[clamp(7px,0.6vw,8px)] text-ig-fg-subtle">{PROB_LABELS[prob]}</span>
                  <span className="text-[clamp(13px,1.4vw,18px)] font-bold ig-tabular text-ig-fg-muted">{prob}</span>
                </div>
              </div>

              {/* Cells */}
              {IMPS.map((imp) => {
                const level = cellLevel(prob, imp);
                const cellRisks = getRisksForCell(prob, imp);
                const count = cellRisks.length;
                const isHighlighted = highlightedCell?.prob === prob && highlightedCell?.impact === imp;

                return (
                  <button
                    key={`c-${prob}-${imp}`}
                    type="button"
                    onClick={() => onCellClick(prob, imp)}
                    className={cn(
                      "group relative m-[2px] flex flex-col items-center justify-center rounded-lg border transition-all duration-200",
                      "aspect-square min-h-[clamp(44px,5vw,60px)]",
                      "hover:scale-105 hover:z-10 hover:shadow-lg",
                      isHighlighted && "ring-2 ring-ig-accent scale-105 z-10",
                    )}
                    style={{
                      background: cellGradient(level),
                      borderColor: isHighlighted ? "var(--ig-accent)" : cellBorderColor(level),
                    }}
                    title={`P${prob} × I${imp} = ${level} | ${count} risco(s)`}
                  >
                    {/* Level number */}
                    <span className="text-[clamp(10px,1vw,14px)] font-bold ig-tabular text-ig-fg-strong opacity-70 group-hover:opacity-100 transition-opacity">
                      {level}
                    </span>

                    {/* Risk count badge */}
                    {count > 0 && (
                      <span
                        className="absolute -top-1.5 -right-1.5 flex h-[clamp(16px,1.4vw,20px)] min-w-[clamp(16px,1.4vw,20px)] items-center justify-center rounded-full border-2 text-[clamp(8px,0.7vw,10px)] font-bold shadow-md"
                        style={{
                          backgroundColor: dotColor(level),
                          borderColor: "var(--ig-bg-canvas)",
                          color: "#fff",
                        }}
                      >
                        {count}
                      </span>
                    )}

                    {/* Hover glow */}
                    <div className="pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: `radial-gradient(ellipse at center, color-mix(in oklab, ${dotColor(level)} 18%, transparent), transparent 70%)` }}
                    />
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        {[
          { label: "Crítico (16-25)", color: "var(--ig-danger)" },
          { label: "Alto (11-15)", color: "var(--ig-warning)" },
          { label: "Médio (6-10)", color: "var(--ig-info)" },
          { label: "Baixo (1-5)", color: "var(--ig-success)" },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1 text-[clamp(8px,0.65vw,9px)] text-ig-fg-subtle">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* Prob label */}
      <div className="flex justify-start pl-2 text-[clamp(8px,0.7vw,10px)] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">
        ← Probabilidade
      </div>
    </div>
  );
}
