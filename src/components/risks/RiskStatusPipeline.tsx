"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, Shield, CheckCircle2 } from "lucide-react";
import type { Risk } from "@/lib/types";

type StatusKey = Risk["status"];

interface Props {
  counts: Record<StatusKey, number>;
  active: StatusKey | null;
  onStatusClick: (status: StatusKey) => void;
}

const META: { key: StatusKey; label: string; icon: typeof AlertCircle; color: string }[] = [
  { key: "open", label: "Aberto", icon: AlertCircle, color: "var(--ig-danger)" },
  { key: "mitigating", label: "Mitigando", icon: Shield, color: "var(--ig-warning)" },
  { key: "resolved", label: "Resolvido", icon: CheckCircle2, color: "var(--ig-success)" },
];

export function RiskStatusPipeline({ counts, active, onStatusClick }: Props) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  return (
    <div className="flex gap-2">
      {META.map(({ key, label, icon: Icon, color }) => {
        const count = counts[key];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = active === key;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onStatusClick(key)}
            className={cn(
              "group relative flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all duration-200",
              isActive
                ? "border-ig-accent bg-ig-accent-weak scale-[1.03]"
                : "border-ig-border-subtle bg-ig-raised hover:border-ig-border-strong hover:bg-ig-bg-overlay",
            )}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{
                backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                color,
              }}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            <span className="text-[clamp(18px,2vw,24px)] font-extrabold leading-none ig-tabular" style={{ color }}>
              {count}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">{label}</span>

            {/* Progress bar */}
            <div className="mt-1 h-1 w-full max-w-[60px] overflow-hidden rounded-full bg-ig-bg-canvas">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
