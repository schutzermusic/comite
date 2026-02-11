'use client';

import { Risk } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";

interface RiskMatrixProps {
  risks: Risk[];
  onRiskClick?: (risk: Risk) => void;
}

export function RiskMatrix({ risks, onRiskClick }: RiskMatrixProps) {
  // 5x5 matrix (Probability x Impact)
  const probabilities = [5, 4, 3, 2, 1]; // High to Low
  const impacts = [1, 2, 3, 4, 5]; // Low to High

  const probabilityLabels: Record<number, string> = {
    5: 'Muito Alta',
    4: 'Alta',
    3: 'Média',
    2: 'Baixa',
    1: 'Muito Baixa'
  };

  const impactLabels: Record<number, string> = {
    1: 'Muito Baixo',
    2: 'Baixo',
    3: 'Médio',
    4: 'Alto',
    5: 'Muito Alto'
  };

  // Get risks for specific cell
  const getRisksForCell = (probability: number, impact: number) => {
    return risks.filter(r => r.probability === probability && r.impact === impact);
  };

  // Get cell color based on level
  const getCellColor = (probability: number, impact: number) => {
    const level = probability * impact;
    if (level >= 16) return 'bg-[rgba(255,88,96,0.16)] hover:bg-[rgba(255,88,96,0.22)] border-[rgba(255,88,96,0.45)]';
    if (level >= 11) return 'bg-[rgba(255,176,77,0.18)] hover:bg-[rgba(255,176,77,0.24)] border-[rgba(255,176,77,0.45)]';
    if (level >= 6) return 'bg-[rgba(0,200,255,0.12)] hover:bg-[rgba(0,200,255,0.18)] border-[rgba(0,200,255,0.35)]';
    return 'bg-[rgba(0,255,180,0.12)] hover:bg-[rgba(0,255,180,0.18)] border-[rgba(0,255,180,0.35)]';
  };

  // Get severity label
  const getSeverityLabel = (probability: number, impact: number) => {
    const level = probability * impact;
    if (level >= 16) return 'Crítico';
    if (level >= 11) return 'Alto';
    if (level >= 6) return 'Médio';
    return 'Baixo';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-[#FFB04D]" />
        <h3 className="text-lg font-semibold text-white">Matriz de Risco 5×5</h3>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid grid-cols-[auto_repeat(5,minmax(100px,1fr))] gap-2">
            {/* Header Row */}
            <div className="font-semibold text-sm text-[rgba(255,255,255,0.75)] flex items-center justify-center" />
            {impacts.map(impact => (
              <div key={`impact-${impact}`} className="text-center">
                <div className="font-semibold text-sm text-white">{impact}</div>
                <div className="text-xs text-[rgba(255,255,255,0.60)]">{impactLabels[impact]}</div>
              </div>
            ))}

            {/* Matrix Cells */}
            {probabilities.map(probability => (
              <>
                {/* Row Header */}
                <div key={`prob-${probability}`} className="flex flex-col items-center justify-center">
                  <div className="font-semibold text-sm text-white">{probability}</div>
                  <div className="text-xs text-[rgba(255,255,255,0.60)] text-center w-20">
                    {probabilityLabels[probability]}
                  </div>
                </div>

                {/* Cells */}
                {impacts.map(impact => {
                  const cellRisks = getRisksForCell(probability, impact);
                  const level = probability * impact;
                  const severityLabel = getSeverityLabel(probability, impact);

                  return (
                    <TooltipProvider key={`cell-${probability}-${impact}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={`
                              relative p-3 rounded-lg border cursor-pointer transition-all
                              ${getCellColor(probability, impact)}
                              ${cellRisks.length > 0 ? 'shadow-[0_0_18px_rgba(0,255,180,0.18)]' : ''}
                            `}
                            onClick={() => cellRisks[0] && onRiskClick?.(cellRisks[0])}
                          >
                            {/* Severity Label */}
                            <div className="text-xs font-medium text-[rgba(255,255,255,0.80)] mb-1">
                              {severityLabel}
                            </div>

                            {/* Level Score */}
                            <div className="text-2xl font-bold text-white mb-1">
                              {level}
                            </div>

                            {/* Risk Count */}
                            {cellRisks.length > 0 && (
                              <div className="absolute top-1 right-1 px-2 py-0.5 rounded-full bg-[rgba(0,200,255,0.18)] border border-[rgba(0,200,255,0.45)] text-[11px] text-[#00C8FF] font-semibold">
                                {cellRisks.length}
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs bg-[#0A1612] border-[rgba(255,255,255,0.08)] text-white">
                          <div className="space-y-2">
                            <div className="font-semibold">
                              Probabilidade: {probability} | Impacto: {impact}
                            </div>
                            <div className="text-sm text-[rgba(255,255,255,0.85)]">
                              Nível: {level} ({severityLabel})
                            </div>
                            {cellRisks.length > 0 ? (
                              <div className="text-sm text-[rgba(255,255,255,0.85)]">
                                <strong>{cellRisks.length} risco(s):</strong>
                                <ul className="list-disc list-inside mt-1">
                                  {cellRisks.slice(0, 3).map(risk => (
                                    <li key={risk.id} className="truncate">{risk.title}</li>
                                  ))}
                                  {cellRisks.length > 3 && (
                                    <li>+{cellRisks.length - 3} mais...</li>
                                  )}
                                </ul>
                              </div>
                            ) : (
                              <div className="text-sm text-[rgba(255,255,255,0.65)]">Nenhum risco neste nível</div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>

      {/* Axis Labels */}
      <div className="flex justify-between items-center text-sm text-[rgba(255,255,255,0.70)] pt-4 border-t border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rotate-45 bg-[rgba(0,200,255,0.6)]" />
          <span className="font-medium text-white">Eixo Y:</span> Probabilidade
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">Eixo X:</span> Impacto
          <div className="w-2 h-2 rotate-45 bg-[rgba(0,255,180,0.6)]" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 pt-4 border-t border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[rgba(0,255,180,0.16)] border border-[rgba(0,255,180,0.45)]" />
          <span className="text-xs text-[rgba(255,255,255,0.70)]">Baixo (1-5)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[rgba(0,200,255,0.16)] border border-[rgba(0,200,255,0.45)]" />
          <span className="text-xs text-[rgba(255,255,255,0.70)]">Médio (6-10)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[rgba(255,176,77,0.18)] border border-[rgba(255,176,77,0.45)]" />
          <span className="text-xs text-[rgba(255,255,255,0.70)]">Alto (11-15)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[rgba(255,88,96,0.18)] border border-[rgba(255,88,96,0.45)]" />
          <span className="text-xs text-[rgba(255,255,255,0.70)]">Crítico (16-25)</span>
        </div>
      </div>
    </div>
  );
}
