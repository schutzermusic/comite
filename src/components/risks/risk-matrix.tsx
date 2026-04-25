"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Risk } from "@/lib/types";

interface RiskMatrixProps {
  risks: Risk[];
  onRiskClick?: (risk: Risk) => void;
  onCellClick?: (prob: number, impact: number) => void;
  highlightedCell?: { prob: number; impact: number } | null;
}

const PROBABILITIES = [5, 4, 3, 2, 1];
const IMPACTS = [1, 2, 3, 4, 5];

const PROBABILITY_LABELS: Record<number, string> = {
  5: "Muito Alta",
  4: "Alta",
  3: "Média",
  2: "Baixa",
  1: "Muito Baixa",
};

const IMPACT_LABELS: Record<number, string> = {
  1: "Muito Baixo",
  2: "Baixo",
  3: "Médio",
  4: "Alto",
  5: "Muito Alto",
};

function getSeverityLabel(probability: number, impact: number) {
  const level = probability * impact;
  if (level >= 16) return "Crítico";
  if (level >= 11) return "Alto";
  if (level >= 6) return "Médio";
  return "Baixo";
}

function getCellClass(probability: number, impact: number) {
  const level = probability * impact;
  if (level >= 16) {
    return "bg-[color-mix(in_oklab,var(--ig-danger)_18%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_44%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-danger)_24%,transparent)]";
  }
  if (level >= 11) {
    return "bg-[color-mix(in_oklab,var(--ig-warning)_18%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_42%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-warning)_24%,transparent)]";
  }
  if (level >= 6) {
    return "bg-[color-mix(in_oklab,var(--ig-info)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_34%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-info)_20%,transparent)]";
  }
  return "bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_34%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-success)_20%,transparent)]";
}

export function RiskMatrix({ risks, onRiskClick, onCellClick, highlightedCell }: RiskMatrixProps) {
  const getRisksForCell = (probability: number, impact: number) =>
    risks.filter((risk) => risk.probability === probability && risk.impact === impact);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-ig-fg-strong">
        <AlertTriangle className="h-5 w-5 text-ig-warning" />
        <h3 className="text-ig-h3">Matriz de Risco 5x5</h3>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[88px_repeat(5,minmax(96px,1fr))] gap-2">
          <div aria-hidden="true" />
          {IMPACTS.map((impact) => (
            <div key={`impact-${impact}`} className="text-center">
              <div className="text-ig-body-sm font-semibold text-ig-fg-strong">{impact}</div>
              <div className="text-[10px] text-ig-fg-muted">{IMPACT_LABELS[impact]}</div>
            </div>
          ))}

          {PROBABILITIES.map((probability) => (
            <div key={`row-${probability}`} className="contents">
              <div className="flex flex-col items-center justify-center rounded-[var(--ig-radius-sm)] border border-ig-border-subtle bg-ig-panel px-2 text-center">
                <div className="text-ig-body-sm font-semibold text-ig-fg-strong">{probability}</div>
                <div className="text-[10px] text-ig-fg-muted">{PROBABILITY_LABELS[probability]}</div>
              </div>

              {IMPACTS.map((impact) => {
                const cellRisks = getRisksForCell(probability, impact);
                const level = probability * impact;
                const selected =
                  highlightedCell?.prob === probability && highlightedCell.impact === impact;

                return (
                  <button
                    key={`cell-${probability}-${impact}`}
                    type="button"
                    data-selected={selected ? "true" : undefined}
                    title={`${cellRisks.length} risco(s) em probabilidade ${probability} e impacto ${impact}`}
                    onClick={() => {
                      onCellClick?.(probability, impact);
                      if (cellRisks[0]) onRiskClick?.(cellRisks[0]);
                    }}
                    className={cn(
                      "relative min-h-[92px] rounded-[var(--ig-radius-md)] border p-3 text-left transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-ig-border-focus",
                      getCellClass(probability, impact),
                      selected && "border-ig-accent ring-1 ring-ig-border-focus",
                    )}
                  >
                    <span className="block text-[11px] font-medium text-ig-fg-muted">
                      {getSeverityLabel(probability, impact)}
                    </span>
                    <span className="mt-1 block text-2xl font-bold text-ig-fg-strong">{level}</span>
                    {cellRisks.length > 0 && (
                      <span className="absolute right-2 top-2 rounded-full border border-ig-border-focus bg-ig-accent-weak px-2 py-0.5 text-[11px] font-semibold text-ig-accent">
                        {cellRisks.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ig-border-subtle pt-4 text-ig-caption text-ig-fg-muted">
        <span>
          <span className="font-medium text-ig-fg-strong">Eixo Y:</span> Probabilidade
        </span>
        <span>
          <span className="font-medium text-ig-fg-strong">Eixo X:</span> Impacto
        </span>
      </div>
    </div>
  );
}
