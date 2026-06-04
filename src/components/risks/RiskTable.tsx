"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { HudStatusPill, HudTable, type HudTableColumn } from "@/components/hud";
import { Calendar, FolderGit2, FileText, ShieldAlert, User } from "lucide-react";
import { formatCurrency } from "@/lib/i18n/format";
import type { ExtendedRisk } from "./risk-types";
import { SEVERITY_LABELS, STATUS_LABELS, FUNNEL_STAGE_LABELS, categoryToDomain } from "./risk-types";
import { computeAging, severityVariant, statusVariant, fmtDateShort, riskToFunnelStage } from "./risk-utils";
import { isOverdue, riskExposure } from "./risk-analytics";

interface Props {
  risks: ExtendedRisk[];
  onRowClick?: (risk: ExtendedRisk) => void;
  selectedId?: string | null;
}

function scoreColor(level: number) {
  if (level >= 16) return "text-ig-danger";
  if (level >= 12) return "text-ig-warning";
  if (level >= 7) return "text-ig-info";
  return "text-ig-success";
}

export function RiskTable({ risks, onRowClick, selectedId }: Props) {
  const columns: HudTableColumn<ExtendedRisk>[] = [
    {
      key: "title",
      header: "Risco",
      cell: (r) => (
        <div className="min-w-[200px] max-w-[340px]">
          <div className="flex items-center gap-1.5">
            <span className="block truncate text-[clamp(11px,1vw,13px)] font-semibold text-ig-fg-strong">{r.title}</span>
            {r.origin === "ai" && !r.aiDismissed && (
              <span className="shrink-0 rounded bg-ig-accent-weak px-1 py-px text-[8px] font-bold uppercase tracking-wide text-ig-accent">IA</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ig-fg-subtle">
            <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />{categoryToDomain(r.category)}</span>
            <span className="ig-tabular">{formatCurrency(riskExposure(r), { compact: true })}</span>
          </div>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severidade",
      width: "104px",
      cell: (r) => <HudStatusPill variant={severityVariant(r.severity)} size="sm">{SEVERITY_LABELS[r.severity]}</HudStatusPill>,
    },
    {
      key: "pi",
      header: "P × I",
      width: "64px",
      align: "center",
      cell: (r) => <span className="font-mono text-[11px] text-ig-fg-muted ig-tabular">{r.probability}×{r.impact}</span>,
    },
    {
      key: "score",
      header: "Score",
      width: "60px",
      align: "center",
      cell: (r) => <span className={cn("font-mono text-[clamp(13px,1.2vw,15px)] font-bold ig-tabular", scoreColor(r.level))}>{r.level}</span>,
    },
    {
      key: "owner",
      header: "Responsável",
      width: "150px",
      cell: (r) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <User className="h-3 w-3 shrink-0 text-ig-fg-subtle" />
          <span className="truncate text-[11px] font-medium text-ig-fg-muted">{r.responsibleName ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "link",
      header: "Vínculo",
      width: "150px",
      cell: (r) =>
        r.referenceName ? (
          <span className="flex items-center gap-1.5 min-w-0" title={r.referenceName}>
            {r.origin === "project" ? <FolderGit2 className="h-3 w-3 shrink-0 text-ig-info" /> : <FileText className="h-3 w-3 shrink-0 text-ig-chart-3" />}
            <span className="truncate text-[10.5px] text-ig-fg-muted">{r.referenceName}</span>
          </span>
        ) : (
          <span className="text-[10.5px] text-ig-fg-subtle">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: "104px",
      cell: (r) => <HudStatusPill variant={statusVariant(r.status)} size="sm">{STATUS_LABELS[r.status]}</HudStatusPill>,
    },
    {
      key: "mitigation",
      header: "Mitigação",
      width: "118px",
      cell: (r) => (
        <span className="text-[10.5px] font-medium text-ig-fg-muted">{FUNNEL_STAGE_LABELS[riskToFunnelStage(r)]}</span>
      ),
    },
    {
      key: "due",
      header: "Prazo",
      width: "92px",
      cell: (r) => {
        const overdue = isOverdue(r);
        return (
          <span className={cn("flex items-center gap-1 text-[10.5px] ig-tabular", overdue ? "font-semibold text-ig-danger" : "text-ig-fg-muted")}>
            <Calendar className="h-3 w-3" />{fmtDateShort(r.dueDate)}
          </span>
        );
      },
    },
    {
      key: "aging",
      header: "Aging",
      width: "64px",
      align: "center",
      cell: (r) => {
        const aging = computeAging(r.createdAt);
        return <span className={cn("font-mono text-[11px] ig-tabular", aging > 60 ? "text-ig-danger" : aging > 30 ? "text-ig-warning" : "text-ig-fg-muted")}>{aging}d</span>;
      },
    },
  ];

  return (
    <div className="overflow-x-auto">
      <HudTable
        columns={columns}
        data={risks}
        keyExtractor={(r) => r.id}
        onRowClick={onRowClick}
        selectedRowId={selectedId ?? null}
        emptyState={
          <div className="py-12 text-center">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-ig-fg-subtle" />
            <p className="text-[clamp(11px,1vw,13px)] font-medium text-ig-fg-muted">Nenhum risco no recorte atual.</p>
            <p className="mt-1 text-[10px] text-ig-fg-subtle">Ajuste os filtros ou limpe o recorte ativo.</p>
          </div>
        }
      />
    </div>
  );
}
