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

const STAGE_META: Record<FunnelStage, { icon: typeof Search; color: string }> = {
  identified: { icon: Search, color: "var(--ig-info)" },
  assessed: { icon: ClipboardCheck, color: "var(--ig-chart-3)" },
  mitigating: { icon: Shield, color: "var(--ig-warning)" },
  validating: { icon: BadgeCheck, color: "var(--ig-accent)" },
  resolved: { icon: CheckCircle2, color: "var(--ig-success)" },
};

export function RiskMitigationPipeline({ stages, activeStage, onStageClick }: Props) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-1">
      {stages.map((s, idx) => {
        const meta = STAGE_META[s.stage];
        const Icon = meta.icon;
        const isActive = activeStage === s.stage;
        const isLast = idx === stages.length - 1;

        return (
          <React.Fragment key={s.stage}>
            <button
              type="button"
              onClick={() => onStageClick(s.stage)}
              aria-pressed={isActive}
              className={cn(
                "group relative flex flex-1 flex-col gap-2 rounded-xl border p-3 text-left transition-all duration-200",
                "hover:-translate-y-px hover:shadow-md",
                isActive
                  ? "border-ig-accent bg-ig-accent-weak ring-1 ring-ig-accent"
                  : "border-ig-border-subtle bg-ig-raised hover:border-ig-border-strong",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `color-mix(in oklab, ${meta.color} 14%, transparent)`, color: meta.color }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {idx > 0 && (
                  <span className="rounded-full bg-ig-bg-canvas px-1.5 py-0.5 text-[9px] font-semibold ig-tabular text-ig-fg-muted" title="Conversão da etapa anterior">
                    {s.conversion}%
                  </span>
                )}
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-ig-fg-muted">{s.label}</span>
                <span className="mt-0.5 block text-[clamp(20px,2.2vw,26px)] font-extrabold leading-none ig-tabular" style={{ color: meta.color }}>
                  {s.count}
                </span>
              </div>

              {/* Mini share bar */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-ig-bg-canvas">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s.pct}%`, backgroundColor: meta.color }} />
              </div>

              <div className="flex items-center justify-between text-[9.5px] text-ig-fg-subtle">
                <span title="Aging médio">{s.avgAging}d médio</span>
                {s.overdue > 0 && (
                  <span className="font-semibold text-ig-danger" title="Mitigações em atraso">{s.overdue} atras.</span>
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
