"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Search, ClipboardCheck, Shield, BadgeCheck, CheckCircle2, ChevronRight } from "lucide-react";
import type { FunnelStage } from "./risk-types";
import type { PipelineStageStat } from "./risk-analytics";

interface Props {
  stages: PipelineStageStat[];
  activeStage?: FunnelStage | null;
  onStageClick: (stage: FunnelStage) => void;
}

/* ── Per-stage color + glow rgba prefix (no CSS-var interpolation in rgba) ── */
const STAGE_META: Record<FunnelStage, {
  icon: typeof Search;
  color: string;
  glowColor: string;
}> = {
  identified: { icon: Search,        color: "var(--ig-info)",    glowColor: "rgba(59,130,246,"   },
  assessed:   { icon: ClipboardCheck, color: "var(--ig-chart-3)", glowColor: "rgba(168,85,247,"   },
  mitigating: { icon: Shield,         color: "var(--ig-warning)", glowColor: "rgba(245,165,36,"   },
  validating: { icon: BadgeCheck,     color: "var(--ig-accent)",  glowColor: "rgba(20,184,166,"   },
  resolved:   { icon: CheckCircle2,   color: "var(--ig-success)", glowColor: "rgba(16,185,129,"   },
};

export function RiskMitigationPipeline({ stages, activeStage, onStageClick }: Props) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-2">
      {stages.map((s, idx) => {
        const { icon: Icon, color, glowColor } = STAGE_META[s.stage];
        const isActive = activeStage === s.stage;
        const isLast = idx === stages.length - 1;

        return (
          <React.Fragment key={s.stage}>
            <button
              type="button"
              onClick={() => onStageClick(s.stage)}
              aria-pressed={isActive}
              className={cn(
                "group relative flex flex-1 flex-col gap-2 overflow-hidden rounded-xl border p-3 text-left transition-all duration-200",
                "hover:-translate-y-px",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent",
                isActive
                  ? "border-ig-accent ring-1 ring-ig-accent/40 scale-[1.02]"
                  : "border-ig-border-subtle bg-ig-raised hover:border-ig-border-strong",
              )}
              style={
                isActive
                  ? { backgroundColor: `${glowColor}10)` }
                  : undefined
              }
            >
              {/* Ambient bottom glow — fades in on hover, persists on active */}
              <span
                className="pointer-events-none absolute bottom-0 left-1/2 h-16 w-full -translate-x-1/2 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: `radial-gradient(ellipse 90% 55% at 50% 100%, ${glowColor}16), transparent)` }}
              />
              {isActive && (
                <span
                  className="pointer-events-none absolute bottom-0 left-1/2 h-16 w-full -translate-x-1/2"
                  style={{ background: `radial-gradient(ellipse 90% 55% at 50% 100%, ${glowColor}22), transparent)` }}
                />
              )}

              {/* Header row: icon + conversion badge */}
              <div className="relative flex items-center justify-between gap-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition-transform duration-200 group-hover:scale-105"
                  style={{
                    backgroundColor: `${glowColor}15)`,
                    color,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 8px ${glowColor}20)`,
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>

                {idx > 0 && (
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-ig-fg-muted"
                    style={{ borderColor: `${glowColor}25)`, backgroundColor: `${glowColor}08)` }}
                    title="Conversão da etapa anterior"
                  >
                    {s.conversion}%
                  </span>
                )}
              </div>

              {/* Stage label + count */}
              <div className="relative">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.07em] text-ig-fg-muted">
                  {s.label}
                </span>
                <span
                  className="mt-0.5 block text-[clamp(20px,2.2vw,26px)] font-extrabold leading-none tabular-nums"
                  style={{
                    color,
                    textShadow: `0 0 20px ${glowColor}40)`,
                  }}
                >
                  {s.count}
                </span>
              </div>

              {/* Share bar */}
              <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-ig-bg-canvas">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${s.pct}%`,
                    backgroundColor: color,
                    boxShadow: `0 0 6px ${glowColor}50)`,
                  }}
                />
              </div>

              {/* Footer: avg aging + overdue */}
              <div className="relative flex items-center justify-between text-[9.5px] text-ig-fg-subtle">
                <span title="Aging médio">{s.avgAging}d médio</span>
                {s.overdue > 0 && (
                  <span className="font-semibold text-ig-danger" title="Mitigações em atraso">
                    {s.overdue} atras.
                  </span>
                )}
              </div>
            </button>

            {!isLast && (
              <div className="hidden items-center justify-center sm:flex">
                <ChevronRight className="h-4 w-4 text-ig-fg-subtle" />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
