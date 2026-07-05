"use client";

import React from "react";
import { HudDrawer, HudStatusPill } from "@/components/hud";
import type { ExtendedRisk } from "./risk-types";
import type { DrawerContext } from "./risk-types";
import { SEVERITY_LABELS, FUNNEL_STAGE_LABELS } from "./risk-types";
import { computeAging, severityColor, severityVariant, statusVariant, fmtDateShort, cellSeverityLabel } from "./risk-utils";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, User, ChevronRight, Gauge, MapPin } from "lucide-react";

interface Props {
  context: DrawerContext;
  risks: ExtendedRisk[];
  onClose: () => void;
  onRiskClick: (risk: ExtendedRisk) => void;
}

function drawerMeta(ctx: NonNullable<DrawerContext>) {
  if (ctx.type === "cell") {
    const label = cellSeverityLabel(ctx.probability, ctx.impact);
    return {
      title: `Riscos — ${label}`,
      subtitle: `Probabilidade ${ctx.probability} × Impacto ${ctx.impact}`,
    };
  }
  if (ctx.type === "funnel") {
    return {
      title: `Riscos — ${FUNNEL_STAGE_LABELS[ctx.stage]}`,
      subtitle: `Etapa do funil de mitigação`,
    };
  }
  return {
    title: "Detalhe do risco",
    subtitle: `Registro ${ctx.riskId}`,
  };
}

export function RiskDrawer({ context, risks, onClose, onRiskClick }: Props) {
  if (!context) return null;
  const { title, subtitle } = drawerMeta(context);

  return (
    <HudDrawer isOpen={true} onClose={onClose} title={title} subtitle={subtitle} width="480px">
      <div className="space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-ig-border-subtle">
          <span className="text-[11px] font-semibold text-ig-fg-muted uppercase tracking-wider">
            {risks.length} risco(s)
          </span>
        </div>

        {risks.length === 0 && (
          <div className="py-10 text-center">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-ig-fg-subtle" />
            <p className="text-[12px] text-ig-fg-muted">Nenhum risco neste filtro.</p>
          </div>
        )}

        {risks.map((risk) => {
          const aging = computeAging(risk.createdAt);
          return (
            <button
              key={risk.id}
              type="button"
              onClick={() => onRiskClick(risk)}
              className="group w-full text-left rounded-xl border border-ig-border-subtle p-3.5 transition-all hover:border-ig-accent hover:bg-ig-accent-weak/30"
            >
              {/* Row 1: title + score */}
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12px] font-semibold text-ig-fg-strong leading-snug line-clamp-2 group-hover:text-ig-accent transition-colors">
                  {risk.title}
                </span>
                <span
                  className="shrink-0 rounded-md border px-1.5 py-0.5 text-[12px] font-bold ig-tabular"
                  style={{
                    color: severityColor(risk.severity),
                    borderColor: `color-mix(in oklab, ${severityColor(risk.severity)} 30%, transparent)`,
                    backgroundColor: `color-mix(in oklab, ${severityColor(risk.severity)} 8%, transparent)`,
                  }}
                >
                  {risk.level}
                </span>
              </div>

              {/* Row 2: pills */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <HudStatusPill variant={severityVariant(risk.severity)} size="sm">
                  {SEVERITY_LABELS[risk.severity]}
                </HudStatusPill>
                <HudStatusPill variant={statusVariant(risk.status)} size="sm">
                  {risk.status === "open" ? "Aberto" : risk.status === "mitigating" ? "Mitigando" : "Resolvido"}
                </HudStatusPill>
              </div>

              {/* Row 3: metadata */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ig-fg-muted">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{risk.area}</span>
                <span className="flex items-center gap-1"><User className="h-3 w-3" />{risk.responsibleName ?? "—"}</span>
                <span className="flex items-center gap-1"><Gauge className="h-3 w-3" />{risk.probability}×{risk.impact}</span>
                <span className={cn("flex items-center gap-1", aging > 60 ? "text-ig-danger" : aging > 30 ? "text-ig-warning" : "")}>
                  <Clock className="h-3 w-3" />{aging}d
                </span>
              </div>

              {/* Row 4: next action */}
              {risk.nextAction && (
                <div className="mt-2 flex items-start gap-1.5 text-[10px]">
                  <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-ig-accent" />
                  <span className="text-ig-fg-default">{risk.nextAction}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </HudDrawer>
  );
}
