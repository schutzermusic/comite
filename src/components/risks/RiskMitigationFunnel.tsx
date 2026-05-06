"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Search, ClipboardCheck, Shield, CheckCircle2 } from "lucide-react";
import type { FunnelStage } from "./risk-types";
import { FUNNEL_STAGE_LABELS, FUNNEL_STAGE_ORDER } from "./risk-types";

interface Props {
  counts: Record<FunnelStage, number>;
  onStageClick: (stage: FunnelStage) => void;
  activeStage?: FunnelStage | null;
}

const STAGE_META: Record<FunnelStage, { icon: typeof Search; color: string }> = {
  identified: { icon: Search, color: "var(--ig-info)" },
  assessed:   { icon: ClipboardCheck, color: "var(--ig-chart-3)" },
  mitigating: { icon: Shield, color: "var(--ig-warning)" },
  resolved:   { icon: CheckCircle2, color: "var(--ig-success)" },
};

const WIDTHS: Record<FunnelStage, string> = {
  identified: "100%",
  assessed:   "82%",
  mitigating: "62%",
  resolved:   "42%",
};

export function RiskMitigationFunnel({ counts, onStageClick, activeStage }: Props) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  return (
    <div className="flex flex-col gap-2.5">
      {FUNNEL_STAGE_ORDER.map((stage) => {
        const meta = STAGE_META[stage];
        const Icon = meta.icon;
        const count = counts[stage];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = activeStage === stage;

        return (
          <button
            key={stage}
            type="button"
            onClick={() => onStageClick(stage)}
            className={cn(
              "group relative mx-auto flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-300",
              "hover:scale-[1.02] hover:shadow-lg",
              isActive
                ? "border-ig-accent bg-ig-accent-weak ring-1 ring-ig-accent"
                : "border-ig-border-subtle bg-ig-raised hover:border-ig-border-strong hover:bg-ig-bg-overlay",
            )}
            style={{ width: WIDTHS[stage] }}
          >
            {/* Glow layer */}
            <div
              className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
              style={{ background: `radial-gradient(ellipse at center, color-mix(in oklab, ${meta.color} 12%, transparent), transparent 70%)` }}
            />

            <span
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
                color: meta.color,
              }}
            >
              <Icon className="h-4 w-4" />
            </span>

            <div className="relative flex flex-1 items-center justify-between min-w-0">
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-ig-fg-muted">
                  {FUNNEL_STAGE_LABELS[stage]}
                </span>
                <span className="mt-0.5 block text-[clamp(18px,2vw,24px)] font-extrabold leading-none ig-tabular" style={{ color: meta.color }}>
                  {count}
                </span>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-medium text-ig-fg-subtle">{pct}%</span>
                {/* Mini bar */}
                <div className="mt-1 h-1.5 w-12 overflow-hidden rounded-full bg-ig-bg-canvas">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: meta.color }}
                  />
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
