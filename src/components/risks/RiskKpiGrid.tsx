"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export type KpiTone = "default" | "danger" | "warning" | "info" | "success" | "accent";

export interface RiskKpiCardData {
  id: string;
  label: string;
  value: string | number;
  suffix?: string;
  icon: React.ReactNode;
  tone?: KpiTone;
  /** Percentage delta vs previous period. Positive = up. */
  delta?: number;
  /** When true, an upward delta is good (green). Defaults to false (up = bad). */
  upIsGood?: boolean;
  /** Helper text shown on hover (native tooltip). */
  help?: string;
  /** Mini sparkline series. */
  spark?: number[];
  /** Click handler — turns the card into a filter trigger. */
  onClick?: () => void;
  active?: boolean;
}

const TONE: Record<KpiTone, { text: string; bg: string; border: string; stroke: string }> = {
  default: { text: "text-ig-fg-strong", bg: "bg-ig-accent-weak", border: "border-ig-border-focus", stroke: "var(--ig-accent)" },
  danger: { text: "text-ig-danger", bg: "bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)]", border: "border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)]", stroke: "var(--ig-danger)" },
  warning: { text: "text-ig-warning", bg: "bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)]", border: "border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)]", stroke: "var(--ig-warning)" },
  info: { text: "text-ig-info", bg: "bg-[color-mix(in_oklab,var(--ig-info)_12%,transparent)]", border: "border-[color-mix(in_oklab,var(--ig-info)_28%,transparent)]", stroke: "var(--ig-info)" },
  success: { text: "text-ig-success", bg: "bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)]", border: "border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]", stroke: "var(--ig-success)" },
  accent: { text: "text-ig-accent", bg: "bg-ig-accent-weak", border: "border-ig-border-focus", stroke: "var(--ig-accent)" },
};

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (!data || data.length < 2) return null;
  const w = 64;
  const h = 22;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / span) * h}`).join(" ");
  const areaPts = `0,${h} ${pts} ${w},${h}`;
  const gid = `spk-${stroke.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeltaBadge({ delta, upIsGood }: { delta: number; upIsGood: boolean }) {
  const up = delta > 0;
  const flat = delta === 0;
  const good = flat ? false : up === upIsGood;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        flat && "bg-ig-panel text-ig-fg-muted",
        !flat && good && "bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success",
        !flat && !good && "bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] text-ig-danger",
      )}
    >
      <Icon className="h-3 w-3" />
      {up ? "+" : ""}{delta}%
    </span>
  );
}

export function RiskKpiGrid({ cards }: { cards: RiskKpiCardData[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => {
        const tone = TONE[card.tone ?? "default"];
        const Comp = card.onClick ? "button" : "div";
        return (
          <Comp
            key={card.id}
            type={card.onClick ? "button" : undefined}
            onClick={card.onClick}
            title={card.help}
            aria-pressed={card.onClick ? card.active : undefined}
            className={cn(
              "group relative flex min-h-[6.25rem] flex-col justify-between overflow-hidden rounded-2xl border border-ig-border-subtle p-3.5 text-left transition-all duration-200",
              "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-panel)_90%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent))]",
              "shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_70%,transparent)]",
              card.onClick && "cursor-pointer hover:-translate-y-px hover:border-ig-border-focus",
              card.active && "border-ig-accent/60 bg-ig-accent-weak/40",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border", tone.bg, tone.border, tone.text)}>
                {card.icon}
              </span>
              {typeof card.delta === "number" && <DeltaBadge delta={card.delta} upIsGood={card.upIsGood ?? false} />}
            </div>

            <div className="mt-2 min-w-0">
              <p className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-ig-fg-muted">{card.label}</p>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <span className={cn("ig-tabular text-[1.5rem] font-semibold leading-none", card.tone && card.tone !== "default" ? tone.text : "text-ig-fg-strong")}>
                  {typeof card.value === "number" ? card.value.toLocaleString("pt-BR") : card.value}
                  {card.suffix && <span className="ml-0.5 text-[11px] font-medium text-ig-fg-muted">{card.suffix}</span>}
                </span>
                {card.spark && card.spark.length > 1 && (
                  <span className="shrink-0 opacity-80"><Sparkline data={card.spark} stroke={tone.stroke} /></span>
                )}
              </div>
            </div>
          </Comp>
        );
      })}
    </div>
  );
}
