"use client";

import React from "react";
import { Flame, Building2, Hourglass, CalendarClock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/i18n/format";
import type { ExecutiveInsights } from "./risk-analytics";

interface Props {
  insights: ExecutiveInsights;
}

function Item({
  icon, tint, label, value, hint,
}: { icon: React.ReactNode; tint: string; label: string; value: string; hint?: string }) {
  return (
    <div className="group flex min-w-0 items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-ig-bg-overlay/40">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
        style={{
          backgroundColor: `color-mix(in oklab, ${tint} 12%, transparent)`,
          color: tint,
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">
          {label}
        </p>
        <p className="mt-1 truncate text-[13px] font-semibold leading-tight text-ig-fg-strong" title={value}>
          {value}
        </p>
        {hint && (
          <p className="mt-0.5 truncate text-[11px] font-medium text-ig-fg-muted">{hint}</p>
        )}
      </div>
    </div>
  );
}

export function RiskInsightStrip({ insights }: Props) {
  const { topExposure, criticalArea, oldestRisk, overdueMitigation, trend } = insights;

  const trendMeta =
    trend.direction === "up"
      ? { icon: <TrendingUp className="h-4 w-4" />, tint: "var(--ig-danger)",  value: `Em alta (+${trend.delta})`,   hint: "Score corporativo subindo"   }
      : trend.direction === "down"
        ? { icon: <TrendingDown className="h-4 w-4" />, tint: "var(--ig-success)", value: `Em queda (${trend.delta})`,   hint: "Score corporativo recuando"  }
        : { icon: <Minus className="h-4 w-4" />,        tint: "var(--ig-info)",    value: "Estável",                    hint: "Sem variação relevante"     };

  return (
    <div
      className="grid grid-cols-1 divide-y divide-ig-border-subtle overflow-hidden rounded-2xl border border-ig-border bg-ig-bg-panel/50 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 sm:[&>*]:border-r sm:[&>*]:border-ig-border-subtle sm:[&>*:last-child]:border-r-0"
      style={{
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <Item
        icon={<Flame className="h-4 w-4" />}
        tint="var(--ig-danger)"
        label="Principal exposição"
        value={topExposure ? topExposure.title : "—"}
        hint={topExposure ? formatCurrency(topExposure.value, { compact: true }) : "Sem riscos ativos"}
      />
      <Item
        icon={<Building2 className="h-4 w-4" />}
        tint="var(--ig-warning)"
        label="Área mais crítica"
        value={criticalArea ? criticalArea.name : "—"}
        hint={criticalArea ? `Score médio ${criticalArea.score} · ${criticalArea.count} risco(s)` : "—"}
      />
      <Item
        icon={<Hourglass className="h-4 w-4" />}
        tint="var(--ig-chart-3)"
        label="Maior aging"
        value={oldestRisk ? oldestRisk.title : "—"}
        hint={oldestRisk ? `${oldestRisk.aging} dias em aberto` : "—"}
      />
      <Item
        icon={<CalendarClock className="h-4 w-4" />}
        tint="var(--ig-danger)"
        label="Mitigação atrasada"
        value={overdueMitigation.count ? `${overdueMitigation.count} em atraso` : "Nenhuma"}
        hint={overdueMitigation.count ? `Exposição ${formatCurrency(overdueMitigation.exposure, { compact: true })}` : "Prazos sob controle"}
      />
      <Item
        icon={trendMeta.icon}
        tint={trendMeta.tint}
        label="Tendência de exposição"
        value={trendMeta.value}
        hint={trendMeta.hint}
      />
    </div>
  );
}
