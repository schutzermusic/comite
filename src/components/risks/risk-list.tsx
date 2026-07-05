"use client";

import { HudStatusPill } from "@/components/hud/HudStatusPill";
import { HudTable, type HudTableColumn } from "@/components/hud/HudTable";
import type { Risk } from "@/lib/types";
import { Calendar, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";

const SEVERITY_LABELS: Record<Risk["severity"], string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};

const SEVERITY_VARIANTS: Record<Risk["severity"], "critical" | "warning" | "neutral" | "active"> = {
  critical: "critical",
  high: "warning",
  medium: "neutral",
  low: "active",
};

const STATUS_LABELS: Record<Risk["status"], string> = {
  open: "Aberto",
  mitigating: "Mitigando",
  resolved: "Resolvido",
};

const STATUS_VARIANTS: Record<Risk["status"], "critical" | "warning" | "completed"> = {
  open: "critical",
  mitigating: "warning",
  resolved: "completed",
};

const CATEGORY_LABELS: Record<string, string> = {
  Operational: "Operacional",
  Financial: "Financeiro",
  Legal: "Jurídico",
  Contractual: "Contratual",
  Compliance: "Compliance",
};

interface RiskListProps {
  risks: Risk[];
  onRowClick?: (risk: Risk) => void;
  highlightedIds?: string[];
}

function formatDate(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function riskScoreColor(level: number) {
  if (level >= 16) return "text-ig-danger";
  if (level >= 11) return "text-ig-warning";
  if (level >= 6) return "text-ig-info";
  return "text-ig-success";
}

export function RiskList({ risks, onRowClick, highlightedIds }: RiskListProps) {
  const columns: HudTableColumn<Risk>[] = [
    {
      key: "title",
      header: "Risco",
      cell: (risk) => (
        <div className="min-w-[180px] max-w-[320px]">
          <span className="block text-[clamp(11px,1vw,13px)] font-semibold leading-snug text-ig-fg-strong">
            {risk.title}
          </span>
          <span className="mt-0.5 line-clamp-1 text-[clamp(10px,0.9vw,11px)] leading-snug text-ig-fg-muted">
            {risk.description}
          </span>
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-ig-fg-subtle">
            {risk.category && (
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3" />
                {CATEGORY_LABELS[risk.category] ?? risk.category}
              </span>
            )}
            {risk.updatedAt && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(risk.updatedAt)}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severidade",
      width: "110px",
      cell: (risk) => (
        <HudStatusPill variant={SEVERITY_VARIANTS[risk.severity]} size="sm">
          {SEVERITY_LABELS[risk.severity]}
        </HudStatusPill>
      ),
    },
    {
      key: "score",
      header: "Score",
      width: "72px",
      align: "center",
      cell: (risk) => (
        <span className={cn("text-[clamp(13px,1.2vw,16px)] font-bold ig-tabular", riskScoreColor(risk.level))}>
          {risk.level}
        </span>
      ),
    },
    {
      key: "probability",
      header: "P × I",
      width: "80px",
      align: "center",
      cell: (risk) => (
        <span className="text-[clamp(10px,0.9vw,12px)] text-ig-fg-muted ig-tabular">
          {risk.probability}×{risk.impact}
        </span>
      ),
    },
    {
      key: "responsibleName",
      header: "Responsável",
      cell: (risk) => (
        <div className="flex items-center gap-1.5 min-w-[100px]">
          <User className="h-3 w-3 flex-shrink-0 text-ig-fg-subtle" />
          <span className="truncate text-[clamp(10px,0.9vw,12px)] font-medium text-ig-fg-muted">
            {risk.responsibleName ?? "—"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "110px",
      cell: (risk) => (
        <HudStatusPill variant={STATUS_VARIANTS[risk.status]} size="sm">
          {STATUS_LABELS[risk.status]}
        </HudStatusPill>
      ),
    },
  ];

  return (
    <HudTable
      columns={columns}
      data={risks}
      keyExtractor={(risk) => risk.id}
      onRowClick={onRowClick}
      selectedRowId={highlightedIds?.[0] ?? null}
      emptyState={
        <div className="py-12 text-center">
          <Shield className="mx-auto mb-3 h-8 w-8 text-ig-fg-subtle" />
          <p className="text-[clamp(11px,1vw,13px)] font-medium text-ig-fg-muted">Nenhum risco encontrado.</p>
          <p className="mt-1 text-[10px] text-ig-fg-subtle">Ajuste os filtros ou critérios de busca.</p>
        </div>
      }
    />
  );
}
