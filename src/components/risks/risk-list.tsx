"use client";

import { HudStatusPill } from "@/components/hud/HudStatusPill";
import { HudTable, type HudTableColumn } from "@/components/hud/HudTable";
import type { Risk } from "@/lib/types";

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

interface RiskListProps {
  risks: Risk[];
  onRowClick?: (risk: Risk) => void;
  highlightedIds?: string[];
}

export function RiskList({ risks, onRowClick, highlightedIds }: RiskListProps) {
  const columns: HudTableColumn<Risk>[] = [
    {
      key: "title",
      header: "Risco",
      cell: (risk) => (
        <div className="min-w-[220px]">
          <span className="block text-ig-body-sm font-medium text-ig-fg-strong">{risk.title}</span>
          <span className="line-clamp-1 text-ig-caption text-ig-fg-muted">{risk.description}</span>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severidade",
      width: "120px",
      cell: (risk) => (
        <HudStatusPill variant={SEVERITY_VARIANTS[risk.severity]} size="sm">
          {SEVERITY_LABELS[risk.severity]}
        </HudStatusPill>
      ),
    },
    {
      key: "probability",
      header: "Prob.",
      width: "80px",
      align: "center",
      cell: (risk) => (
        <span className="font-mono text-ig-body-sm text-ig-fg-muted">{risk.probability}/5</span>
      ),
    },
    {
      key: "impact",
      header: "Impacto",
      width: "90px",
      align: "center",
      cell: (risk) => (
        <span className="font-mono text-ig-body-sm text-ig-fg-muted">{risk.impact}/5</span>
      ),
    },
    {
      key: "responsibleName",
      header: "Responsável",
      cell: (risk) => (
        <span className="text-ig-body-sm text-ig-fg-muted">{risk.responsibleName ?? "-"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
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
          <p className="text-ig-body-sm text-ig-fg-muted">Nenhum risco encontrado.</p>
        </div>
      }
    />
  );
}
