'use client';

import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { HUDCard } from '@/components/ui/hud-card';
import { HUDProgressBar } from '@/components/ui/hud-progress-bar';
import { DollarSign, Clock } from 'lucide-react';

type ResourceAllocationProps = {
  project?: any;
  projects?: any[];
};

const ResourceAllocation: React.FC<ResourceAllocationProps> = ({ project, projects }) => {
  // Garantir que sempre temos algum dado para trabalhar
  const currentProject = project || projects?.[0] || {};

  const totalBudget = Number(currentProject.orcamentoAprovado ?? 0);
  const usedBudget = Number(currentProject.orcamentoUtilizado ?? 0);
  const plannedHours = Number(currentProject.horasPlanejadas ?? 0);
  const usedHours = Number(currentProject.horasUtilizadas ?? 0);

  const budgetUtilization =
    totalBudget > 0 ? Math.round((usedBudget / totalBudget) * 100) : 0;

  const hoursUtilization =
    plannedHours > 0 ? Math.round((usedHours / plannedHours) * 100) : 0;

  const getUtilizationVariant = (percent: number): 'completed' | 'active' | 'at_risk' | 'critical' => {
    if (percent <= 80) return 'active';
    if (percent <= 100) return 'at_risk';
    return 'critical';
  };

  return (
    <div className="space-y-6">
      {/* Eficiência Financeira */}
      <HUDCard glow glowColor="cyan">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <DollarSign className="w-8 h-8 text-[#00C8FF]" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Eficiência de Alocação Financeira</p>
              <p className="text-2xl font-semibold text-white">
                {budgetUtilization}%
              </p>
            </div>
          </div>
          <HUDProgressBar 
            value={budgetUtilization}
            variant={getUtilizationVariant(budgetUtilization)}
          />
        </div>
        <div className="space-y-3 pt-4 border-t border-[rgba(255,255,255,0.08)]">
          <div className="flex justify-between text-sm">
            <span className="text-[rgba(255,255,255,0.65)]">Orçamento aprovado</span>
            <span className="font-medium text-white">
              {totalBudget.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[rgba(255,255,255,0.65)]">Orçamento utilizado</span>
            <span className="font-medium text-white">
              {usedBudget.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </span>
          </div>
        </div>
      </HUDCard>

      {/* Eficiência de Horas / Esforço */}
      <HUDCard glow glowColor="amber">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Clock className="w-8 h-8 text-[#FFB04D]" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Eficiência de Uso de Horas</p>
              <p className="text-2xl font-semibold text-white">
                {hoursUtilization}%
              </p>
            </div>
          </div>
          <HUDProgressBar 
            value={hoursUtilization}
            variant={getUtilizationVariant(hoursUtilization)}
          />
        </div>
        <div className="space-y-3 pt-4 border-t border-[rgba(255,255,255,0.08)]">
          <div className="flex justify-between text-sm">
            <span className="text-[rgba(255,255,255,0.65)]">Horas planejadas</span>
            <span className="font-medium text-white">{plannedHours.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[rgba(255,255,255,0.65)]">Horas registradas</span>
            <span className="font-medium text-white">{usedHours.toLocaleString('pt-BR')}</span>
          </div>
        </div>
      </HUDCard>
    </div>
  );
};

export default ResourceAllocation;
