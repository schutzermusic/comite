
'use client';
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { HUDProgressBar } from "@/components/ui/hud-progress-bar";
import { AlertTriangle, TrendingUp, TrendingDown, Shield } from "lucide-react";
import { ProjetoAnalytics } from "@/lib/types";

interface ProjectRiskAssessmentProps {
  analytics: ProjetoAnalytics;
}

export default function ProjectRiskAssessment({ analytics }: ProjectRiskAssessmentProps) {
  if (!analytics?.avaliacao_risco) {
    return (
      <HUDCard>
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-[rgba(255,255,255,0.20)] mx-auto mb-3" />
          <p className="text-[rgba(255,255,255,0.65)]">Análise de risco não disponível</p>
        </div>
      </HUDCard>
    );
  }

  const { nivel_risco, score_risco, fatores_risco, riscos_identificados } = analytics.avaliacao_risco;

  const getRiskVariant = (nivel: 'baixo' | 'medio' | 'alto' | 'critico'): 'completed' | 'active' | 'at_risk' | 'critical' => {
    if (nivel === 'critico') return 'critical';
    if (nivel === 'alto') return 'at_risk';
    if (nivel === 'medio') return 'active';
    return 'completed';
  };

  const getRiskGlowColor = (nivel: 'baixo' | 'medio' | 'alto' | 'critico'): 'green' | 'amber' | 'red' => {
    if (nivel === 'critico' || nivel === 'alto') return 'red';
    if (nivel === 'medio') return 'amber';
    return 'green';
  };

  const getImpactoIcon = (impacto: 'alto' | 'medio' | 'baixo') => {
    if (impacto === 'alto') return <TrendingUp className="w-4 h-4 text-[#FF5860]" />;
    if (impacto === 'medio') return <TrendingUp className="w-4 h-4 text-[#FFB04D]" />;
    return <TrendingDown className="w-4 h-4 text-[#00FFB4]" />;
  };

  return (
    <div className="space-y-6">
      {/* Overall Risk Score */}
      <HUDCard glow glowColor={getRiskGlowColor(nivel_risco)}>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Shield className={`w-8 h-8 ${
                nivel_risco === 'critico' ? 'text-[#FF5860]' :
                nivel_risco === 'alto' ? 'text-[#FFB04D]' :
                nivel_risco === 'medio' ? 'text-[#00C8FF]' :
                'text-[#00FFB4]'
              }`} />
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Avaliação de Risco</p>
                <p className="text-3xl font-semibold text-white capitalize">{nivel_risco}</p>
              </div>
            </div>
            <StatusPill variant={getRiskVariant(nivel_risco)} className="text-lg px-4 py-2">
              {nivel_risco.toUpperCase()}
            </StatusPill>
          </div>
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Score de Risco</span>
              <span className="text-2xl font-bold text-white">{score_risco}/100</span>
            </div>
            <HUDProgressBar 
              value={score_risco}
              variant={getRiskVariant(nivel_risco)}
            />
          </div>
          
          {riscos_identificados && riscos_identificados.length > 0 && (
            <div className="pt-4 border-t border-[rgba(255,255,255,0.08)]">
              <h4 className="font-semibold text-white mb-3">Riscos Identificados</h4>
              <ul className="space-y-2">
                {riscos_identificados.map((risco, idx) => (
                  <li key={idx} className="text-sm text-[rgba(255,255,255,0.85)] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#FFB04D] mt-0.5 flex-shrink-0" />
                    <span>{risco}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </HUDCard>

      {/* Risk Factors */}
      {fatores_risco && fatores_risco.length > 0 && (
        <HUDCard>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white orion-text-heading">Fatores de Risco Detalhados</h2>
            <p className="text-sm text-[rgba(255,255,255,0.65)] mt-1">Análise detalhada dos principais fatores de risco identificados</p>
          </div>
          <div className="space-y-4">
            {fatores_risco.map((fator, idx) => {
              const impactoColors = {
                alto: {
                  border: 'border-[rgba(255,88,96,0.25)]',
                  bg: 'bg-[rgba(255,88,96,0.08)]',
                  badge: 'critical' as const
                },
                medio: {
                  border: 'border-[rgba(255,176,77,0.25)]',
                  bg: 'bg-[rgba(255,176,77,0.08)]',
                  badge: 'at_risk' as const
                },
                baixo: {
                  border: 'border-[rgba(0,255,180,0.25)]',
                  bg: 'bg-[rgba(0,255,180,0.08)]',
                  badge: 'active' as const
                }
              };
              const colors = impactoColors[fator.impacto as keyof typeof impactoColors] || impactoColors.medio;

              return (
                <div 
                  key={idx} 
                  className={`p-5 rounded-xl border ${colors.border} ${colors.bg} transition-all hover:bg-opacity-20`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {getImpactoIcon(fator.impacto as any)}
                      <h4 className="font-semibold text-white">{fator.fator}</h4>
                    </div>
                    <StatusPill variant={colors.badge} className="text-xs">
                      Impacto {fator.impacto.charAt(0).toUpperCase() + fator.impacto.slice(1)}
                    </StatusPill>
                  </div>
                  {fator.descricao && (
                    <p className="text-sm text-[rgba(255,255,255,0.85)] mb-3">{fator.descricao}</p>
                  )}
                  {fator.mitigacao_sugerida && (
                    <div className="mt-4 p-4 bg-[rgba(0,200,255,0.12)] rounded-lg border border-[rgba(0,200,255,0.25)]">
                      <div className="flex items-start gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-[#00C8FF] mt-0.5" />
                        <p className="text-xs font-semibold text-white uppercase tracking-wide">Mitigação Sugerida</p>
                      </div>
                      <p className="text-sm text-[rgba(255,255,255,0.85)]">{fator.mitigacao_sugerida}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </HUDCard>
      )}
    </div>
  );
}
