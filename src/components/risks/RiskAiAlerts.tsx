"use client";

import React, { useMemo } from "react";
import { BrainCircuit, ChevronRight, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtendedRisk } from "./risk-types";
import { SEVERITY_LABELS } from "./risk-types";
import { severityColor } from "./risk-utils";

interface Props {
  risks: ExtendedRisk[];
  onSelect: (risk: ExtendedRisk) => void;
  onAnalyze?: () => void;
  /** Max alerts rendered before "ver todos". */
  limit?: number;
}

/* ── Avisos de Riscos por IA ──
   Compact, scrollable feed of AI-detected risks (origin === 'ai'), ranked by
   severity level then confidence. Mirrors the AI section of the detail drawer. */
export function RiskAiAlerts({ risks, onSelect, onAnalyze, limit = 6 }: Props) {
  const aiRisks = useMemo(
    () =>
      risks
        .filter((r) => r.origin === "ai" && !r.aiDismissed)
        .sort((a, b) => b.level - a.level || (b.aiConfidence ?? 0) - (a.aiConfidence ?? 0)),
    [risks],
  );

  const shown = aiRisks.slice(0, limit);
  const overflow = aiRisks.length - shown.length;

  if (aiRisks.length === 0) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-4 text-center">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-[12px]"
          style={{
            backgroundColor: "color-mix(in oklab, var(--ig-success) 14%, transparent)",
            color: "var(--ig-success)",
          }}
        >
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-ig-fg-strong">Nenhum aviso da IA</p>
          <p className="mt-0.5 text-[11px] text-ig-fg-muted">
            Nenhum risco foi sinalizado pela IA no recorte atual.
          </p>
        </div>
        {onAnalyze && (
          <button
            type="button"
            onClick={onAnalyze}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-ig-accent bg-ig-accent-weak px-3 py-1 text-[11px] font-semibold text-ig-accent transition-colors hover:bg-ig-accent-weak/70"
          >
            <Sparkles className="h-3 w-3" />
            Analisar com IA
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-[280px] flex-col gap-2.5 lg:h-full lg:min-h-0">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
          <BrainCircuit className="h-3.5 w-3.5 text-ig-accent" />
          {aiRisks.length} aviso(s) ativo(s)
        </span>
        {onAnalyze && (
          <button
            type="button"
            onClick={onAnalyze}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-ig-fg-muted transition-colors hover:text-ig-accent"
          >
            <Sparkles className="h-3 w-3" />
            Reanalisar
          </button>
        )}
      </div>

      <div className="-mr-1 max-h-[380px] space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
        {shown.map((risk) => {
          const color = severityColor(risk.severity);
          const confidence =
            typeof risk.aiConfidence === "number" ? Math.round(risk.aiConfidence * 100) : null;
          const detail = risk.aiRecommendation || risk.aiRationale || risk.description;
          return (
            <button
              key={risk.id}
              type="button"
              onClick={() => onSelect(risk)}
              className={cn(
                "group flex w-full items-start gap-2 rounded-xl border border-ig-border-subtle bg-ig-raised/60 px-2.5 py-2 text-left transition-all",
                "hover:border-ig-border-strong hover:bg-ig-raised",
              )}
            >
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-semibold text-ig-fg-strong" title={risk.title}>
                    {risk.title}
                  </p>
                  {confidence !== null && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
                      style={{
                        color,
                        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                      }}
                    >
                      {confidence}%
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-ig-fg-muted">
                  {detail}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[9.5px] font-medium uppercase tracking-[0.08em] text-ig-fg-subtle">
                  <span style={{ color }}>{SEVERITY_LABELS[risk.severity]}</span>
                  {risk.area && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="truncate">{risk.area}</span>
                    </>
                  )}
                </div>
              </div>
              <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ig-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ig-accent" />
            </button>
          );
        })}
      </div>

      {overflow > 0 && onAnalyze && (
        <button
          type="button"
          onClick={onAnalyze}
          className="shrink-0 rounded-lg border border-dashed border-ig-border-subtle py-2 text-[11px] font-medium text-ig-fg-muted transition-colors hover:border-ig-accent hover:text-ig-accent"
        >
          + {overflow} outro(s) aviso(s) da IA
        </button>
      )}
    </div>
  );
}
