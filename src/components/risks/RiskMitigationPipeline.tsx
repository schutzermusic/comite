"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Search, ClipboardCheck, Shield, BadgeCheck, CheckCircle2 } from "lucide-react";
import type { FunnelStage } from "./risk-types";
import type { PipelineStageStat } from "./risk-analytics";

interface Props {
  stages: PipelineStageStat[];
  activeStage?: FunnelStage | null;
  onStageClick: (stage: FunnelStage) => void;
}

/* ── Per-stage icon + token color. Tints derivam via color-mix, sem rgba manual. ── */
const STAGE_META: Record<FunnelStage, { icon: typeof Search; color: string }> = {
  identified: { icon: Search, color: "var(--ig-info)" },
  assessed: { icon: ClipboardCheck, color: "var(--ig-chart-3)" },
  mitigating: { icon: Shield, color: "var(--ig-warning)" },
  validating: { icon: BadgeCheck, color: "var(--ig-accent)" },
  resolved: { icon: CheckCircle2, color: "var(--ig-success)" },
};

const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`;

export function RiskMitigationPipeline({ stages, activeStage, onStageClick }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {stages.map((s, idx) => {
        const { icon: Icon, color } = STAGE_META[s.stage];
        const isActive = activeStage === s.stage;

        return (
          <button
            key={s.stage}
            type="button"
            onClick={() => onStageClick(s.stage)}
            aria-pressed={isActive}
            className={cn(
              "group relative flex flex-col gap-3 overflow-hidden rounded-xl border p-3.5 text-left",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ig-bg-panel",
              isActive
                ? "border-ig-border-strong bg-ig-bg-overlay"
                : "border-ig-border-subtle bg-ig-raised hover:border-ig-border-strong hover:bg-ig-bg-overlay/50",
            )}
          >
            {/* Top accent rail — o único uso de cor forte, 2px, sem blur */}
            <span
              className="pointer-events-none absolute inset-x-0 top-0 h-[2px] transition-opacity duration-150"
              style={{ backgroundColor: color, opacity: isActive ? 1 : 0.35 }}
            />

            {/* Header: índice da etapa + conversão */}
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: tint(color, 12), color }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-ig-fg-subtle">
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </span>

              {idx > 0 && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{ backgroundColor: tint(color, 10), color }}
                  title="Conversão da etapa anterior"
                >
                  {s.conversion}%
                </span>
              )}
            </div>

            {/* Etapa + contagem */}
            <div>
              <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
                {s.label}
              </span>
              <span className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ig-fg-strong">
                  {s.count}
                </span>
                <span className="text-[11px] font-medium tabular-nums text-ig-fg-subtle">
                  {s.pct}%
                </span>
              </span>
            </div>

            {/* Share bar */}
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-ig-bg-canvas">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${s.pct}%`, backgroundColor: color }}
              />
            </div>

            {/* Footer: aging médio + atrasos */}
            <div className="flex items-center justify-between text-[10.5px] font-medium text-ig-fg-subtle">
              <span title="Aging médio">{s.avgAging}d médio</span>
              {s.overdue > 0 && (
                <span className="font-semibold text-ig-danger" title="Mitigações em atraso">
                  {s.overdue} em atraso
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
