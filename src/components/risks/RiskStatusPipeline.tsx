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

const META: {
  key: StatusKey;
  label: string;
  icon: typeof AlertCircle;
  color: string;
  glowColor: string;
}[] = [
  {
    key: "open",
    label: "Aberto",
    icon: AlertCircle,
    color: "var(--ig-danger)",
    glowColor: "rgba(239,75,85,",
  },
  {
    key: "mitigating",
    label: "Mitigando",
    icon: Shield,
    color: "var(--ig-warning)",
    glowColor: "rgba(245,165,36,",
  },
  {
    key: "resolved",
    label: "Resolvido",
    icon: CheckCircle2,
    color: "var(--ig-success)",
    glowColor: "rgba(16,185,129,",
  },
];

export function RiskStatusPipeline({ counts, active, onStatusClick }: Props) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  return (
    <div className="flex gap-2.5">
      {META.map(({ key, label, icon: Icon, color, glowColor }) => {
        const count = counts[key];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = active === key;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onStatusClick(key)}
            aria-pressed={isActive}
            className={cn(
              "group relative flex flex-1 flex-col items-center gap-2 overflow-hidden rounded-xl border px-3 py-3.5 transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent",
              isActive
                ? "border-ig-accent ring-1 ring-ig-accent/40 scale-[1.03]"
                : "border-ig-border-subtle bg-ig-raised hover:border-ig-border-strong hover:scale-[1.02]",
            )}
            style={
              isActive
                ? {
                    backgroundColor: `${glowColor}10)`,
                    borderColor: "var(--ig-accent)",
                  }
                : undefined
            }
          >
            {/* Ambient bottom glow */}
            <span
              className="pointer-events-none absolute bottom-0 left-1/2 h-20 w-full -translate-x-1/2 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{
                background: `radial-gradient(ellipse 90% 55% at 50% 100%, ${glowColor}18), transparent)`,
              }}
            />
            {isActive && (
              <span
                className="pointer-events-none absolute bottom-0 left-1/2 h-20 w-full -translate-x-1/2"
                style={{
                  background: `radial-gradient(ellipse 90% 55% at 50% 100%, ${glowColor}22), transparent)`,
                }}
              />
            )}

            {/* Icon */}
            <span
              className="relative flex h-8 w-8 items-center justify-center rounded-[10px] transition-transform duration-200 group-hover:scale-110"
              style={{
                backgroundColor: `${glowColor}15)`,
                color,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 8px ${glowColor}20)`,
              }}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            {/* Count */}
            <span
              className="relative text-[clamp(22px,2.5vw,28px)] font-extrabold leading-none tabular-nums tracking-tight"
              style={{
                color,
                textShadow: `0 0 24px ${glowColor}45)`,
              }}
            >
              {count}
            </span>

            {/* Label + percentage row */}
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ig-fg-muted">
                {label}
              </span>
              <span className="text-[10px] font-medium tabular-nums text-ig-fg-subtle">
                {pct}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="mt-0.5 h-[3px] w-full max-w-[52px] overflow-hidden rounded-full bg-ig-bg-canvas">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  boxShadow: `0 0 6px ${glowColor}50)`,
                }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
