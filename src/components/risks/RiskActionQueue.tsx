"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { HudStatusPill } from "@/components/hud";
import type { ExtendedRisk } from "./risk-types";
import { SEVERITY_LABELS, STATUS_LABELS, CATEGORY_LABELS } from "./risk-types";
import { computeAging, severityColor, severityVariant, statusVariant, fmtDateShort } from "./risk-utils";
import {
  Calendar, ChevronRight, Clock, Eye, Gauge, ListChecks,
  MapPin, Shield, Target, User,
} from "lucide-react";

interface Props {
  risks: ExtendedRisk[];
  onRiskClick: (risk: ExtendedRisk) => void;
}

export function RiskActionQueue({ risks, onRiskClick }: Props) {
  if (risks.length === 0) {
    return (
      <div className="py-14 text-center">
        <Shield className="mx-auto mb-3 h-8 w-8 text-ig-fg-subtle" />
        <p className="text-[clamp(11px,1vw,13px)] font-medium text-ig-fg-muted">Nenhum risco no recorte atual.</p>
        <p className="mt-1 text-[10px] text-ig-fg-subtle">Ajuste os filtros ou critérios de busca.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {risks.map((risk) => {
        const aging = computeAging(risk.createdAt);
        const pendingActions = risk.actions.filter((a) => a.status !== "done").length;
        const color = severityColor(risk.severity);

        return (
          <button
            key={risk.id}
            type="button"
            onClick={() => onRiskClick(risk)}
            className="group relative w-full text-left rounded-xl border border-ig-border-subtle p-4 transition-all duration-200 hover:border-ig-accent hover:bg-ig-accent-weak/20 hover:shadow-md"
          >
            {/* Severity accent bar */}
            <div
              className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-all group-hover:h-auto"
              style={{ backgroundColor: color }}
            />

            {/* Row 1: Title + Score badge */}
            <div className="flex items-start justify-between gap-3 pl-3">
              <div className="min-w-0 flex-1">
                <span className="block text-[clamp(12px,1.1vw,14px)] font-semibold leading-snug text-ig-fg-strong group-hover:text-ig-accent transition-colors">
                  {risk.title}
                </span>
                <span className="mt-0.5 block text-[clamp(10px,0.9vw,11px)] leading-snug text-ig-fg-muted line-clamp-1">
                  {risk.description}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[clamp(14px,1.3vw,18px)] font-bold ig-tabular"
                  style={{
                    color,
                    borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
                    backgroundColor: `color-mix(in oklab, ${color} 8%, transparent)`,
                  }}
                >
                  <Gauge className="h-3.5 w-3.5" />
                  {risk.level}
                </span>
              </div>
            </div>

            {/* Row 2: Pills */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-3">
              <HudStatusPill variant={severityVariant(risk.severity)} size="sm">
                {SEVERITY_LABELS[risk.severity]}
              </HudStatusPill>
              <HudStatusPill variant={statusVariant(risk.status)} size="sm">
                {STATUS_LABELS[risk.status]}
              </HudStatusPill>
              {risk.origin === 'ai' && (
                <HudStatusPill variant="info" size="sm">IA</HudStatusPill>
              )}
              <span className="text-[10px] font-medium text-ig-fg-subtle ig-tabular">
                {risk.probability}×{risk.impact}
              </span>
            </div>

            {/* Row 3: Metadata grid */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-3 text-[10px] text-ig-fg-muted">
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{risk.area}</span>
              <span className="flex items-center gap-1"><User className="h-3 w-3" />{risk.responsibleName ?? "—"}</span>
              <span className="flex items-center gap-1"><Shield className="h-3 w-3" />{CATEGORY_LABELS[risk.category ?? ""] ?? risk.category}</span>
              <span className={cn("flex items-center gap-1", aging > 60 ? "text-ig-danger" : aging > 30 ? "text-ig-warning" : "")}>
                <Clock className="h-3 w-3" />{aging}d
              </span>
              {risk.dueDate && (
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Prazo: {fmtDateShort(risk.dueDate)}</span>
              )}
              {pendingActions > 0 && (
                <span className="flex items-center gap-1 text-ig-accent"><ListChecks className="h-3 w-3" />{pendingActions} ação(ões)</span>
              )}
            </div>

            {/* Row 4: Next action + mitigation */}
            {(risk.nextAction || risk.mitigationPlan) && (
              <div className="mt-2 space-y-1 pl-3">
                {risk.nextAction && (
                  <div className="flex items-start gap-1.5 text-[10px]">
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-ig-accent" />
                    <span className="text-ig-fg-default line-clamp-1">{risk.nextAction}</span>
                  </div>
                )}
                {risk.mitigationPlan && (
                  <div className="flex items-start gap-1.5 text-[10px]">
                    <Target className="mt-0.5 h-3 w-3 shrink-0 text-ig-fg-subtle" />
                    <span className="text-ig-fg-muted line-clamp-1">{risk.mitigationPlan}</span>
                  </div>
                )}
              </div>
            )}

            {/* Row 5: Quick actions */}
            <div className="mt-3 flex items-center gap-2 pl-3 opacity-0 transition-opacity group-hover:opacity-100">
              {[
                { label: "Ver detalhes", icon: Eye },
                { label: "Adicionar ação", icon: ListChecks },
                { label: "Atualizar mitigação", icon: Target },
              ].map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="flex items-center gap-1 rounded-md border border-ig-border-subtle bg-ig-raised px-2 py-1 text-[9px] font-semibold text-ig-fg-muted"
                >
                  <Icon className="h-3 w-3" />{label}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
