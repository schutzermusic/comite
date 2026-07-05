"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { HudDrawer, HudStatusPill } from "@/components/hud";
import { AlertTriangle, ChevronRight, Clock, FolderGit2, FileText, Gauge, MapPin, Table2, User, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/i18n/format";
import type { ExtendedRisk } from "./risk-types";
import { SEVERITY_LABELS, STATUS_LABELS, categoryToDomain } from "./risk-types";
import { computeAging, severityColor, severityVariant, statusVariant, fmtDateShort } from "./risk-utils";
import { isOverdue, riskExposure, type RiskDrilldownContext } from "./risk-analytics";

interface Props {
  context: RiskDrilldownContext | null;
  onClose: () => void;
  onRiskClick: (risk: ExtendedRisk) => void;
  /** Optional bridge to apply the selection to the main table. */
  onApplyToTable?: (ctx: RiskDrilldownContext) => void;
}

const SEV_ORDER: { key: ExtendedRisk["severity"]; label: string }[] = [
  { key: "critical", label: "Crítico" },
  { key: "high", label: "Alto" },
  { key: "medium", label: "Médio" },
  { key: "low", label: "Baixo" },
];

export function RiskDrilldownDrawer({ context, onClose, onRiskClick, onApplyToTable }: Props) {
  if (!context) return null;
  const { label, sublabel, risks, total, exposure, severity } = context;

  return (
    <HudDrawer isOpen={!!context} onClose={onClose} title="Riscos do recorte" subtitle={label} width="500px">
      <div className="flex h-full flex-col">
        {/* ── Summary header ── */}
        <div className="space-y-3 border-b border-ig-border-subtle pb-4">
          {sublabel && <p className="text-[11px] text-ig-fg-muted">{sublabel}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ig-fg-subtle">Riscos</p>
              <p className="text-[20px] font-bold ig-tabular text-ig-fg-strong">{total}</p>
            </div>
            <div className="rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ig-fg-subtle">Exposição</p>
              <p className="text-[20px] font-bold ig-tabular text-ig-fg-strong">{formatCurrency(exposure, { compact: true })}</p>
            </div>
          </div>

          {/* Severity breakdown bar */}
          {total > 0 && (
            <div>
              <div className="flex h-2 overflow-hidden rounded-full">
                {SEV_ORDER.map(({ key }) => {
                  const v = severity[key];
                  if (!v) return null;
                  return <span key={key} style={{ width: `${(v / total) * 100}%`, backgroundColor: severityColor(key) }} />;
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {SEV_ORDER.map(({ key, label: l }) => (
                  <span key={key} className="flex items-center gap-1 text-[10px] text-ig-fg-muted">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityColor(key) }} />
                    {l} <span className="font-semibold ig-tabular text-ig-fg-strong">{severity[key]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {onApplyToTable && total > 0 && (
            <button
              type="button"
              onClick={() => onApplyToTable(context)}
              className="flex items-center gap-1.5 rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-1.5 text-[11px] font-semibold text-ig-fg-muted transition-all hover:border-ig-accent hover:text-ig-accent"
            >
              <Table2 className="h-3.5 w-3.5" /> Ver na tabela completa
            </button>
          )}
        </div>

        {/* ── Risk list ── */}
        <div className="-mr-2 mt-3 flex-1 space-y-2 overflow-y-auto pr-2">
          {total === 0 ? (
            <div className="py-14 text-center">
              <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-ig-fg-subtle" />
              <p className="text-[12px] font-medium text-ig-fg-muted">Nenhum risco neste recorte.</p>
              <p className="mt-1 text-[10px] text-ig-fg-subtle">Selecione outro item do dashboard.</p>
            </div>
          ) : (
            risks.map((risk) => {
              const aging = computeAging(risk.createdAt);
              const overdue = isOverdue(risk);
              const color = severityColor(risk.severity);
              return (
                <button
                  key={risk.id}
                  type="button"
                  onClick={() => onRiskClick(risk)}
                  className="group w-full rounded-xl border border-ig-border-subtle p-3 text-left transition-all hover:border-ig-accent hover:bg-ig-accent-weak/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-semibold leading-snug text-ig-fg-strong line-clamp-2 group-hover:text-ig-accent transition-colors">
                      {risk.title}
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-bold ig-tabular"
                      style={{ color, borderColor: `color-mix(in oklab, ${color} 30%, transparent)`, backgroundColor: `color-mix(in oklab, ${color} 8%, transparent)` }}
                    >
                      <Gauge className="h-3 w-3" />{risk.level}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <HudStatusPill variant={severityVariant(risk.severity)} size="sm">{SEVERITY_LABELS[risk.severity]}</HudStatusPill>
                    <HudStatusPill variant={statusVariant(risk.status)} size="sm">{STATUS_LABELS[risk.status]}</HudStatusPill>
                    {risk.origin === "ai" && !risk.aiDismissed && <HudStatusPill variant="info" size="sm">IA</HudStatusPill>}
                    <span className="text-[10px] font-medium ig-tabular text-ig-fg-subtle">{risk.probability}×{risk.impact}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ig-fg-muted">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{categoryToDomain(risk.category)}</span>
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{risk.responsibleName ?? "—"}</span>
                    <span className="flex items-center gap-1 ig-tabular"><Wallet className="h-3 w-3" />{formatCurrency(riskExposure(risk), { compact: true })}</span>
                    <span className={cn("flex items-center gap-1", aging > 60 ? "text-ig-danger" : aging > 30 ? "text-ig-warning" : "")}>
                      <Clock className="h-3 w-3" />{aging}d
                    </span>
                    {risk.dueDate && (
                      <span className={cn("flex items-center gap-1", overdue && "font-semibold text-ig-danger")}>
                        Prazo {fmtDateShort(risk.dueDate)}
                      </span>
                    )}
                    {risk.referenceName && (
                      <span className="flex items-center gap-1" title={risk.referenceName}>
                        {risk.origin === "project" ? <FolderGit2 className="h-3 w-3 text-ig-info" /> : <FileText className="h-3 w-3 text-ig-chart-3" />}
                        <span className="max-w-[120px] truncate">{risk.referenceName}</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-ig-accent opacity-0 transition-opacity group-hover:opacity-100">
                    Abrir detalhe <ChevronRight className="h-3 w-3" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </HudDrawer>
  );
}
