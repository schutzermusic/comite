'use client';

import {
  Briefcase,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Heart,
  ShieldAlert,
  Activity,
  Clock,
} from 'lucide-react';
import { HudKpiStrip, type KpiItem } from '@/components/hud';

export interface ProjectKpiSummary {
  total: number;
  inProgress: number;
  completed: number;
  delayed: number;
  critical: number;
  totalValue: number;
  avgHealth: number;
  avgProgress: number;
  openRisks: number;
  trendInProgress?: number;
  spark?: number[];
}

interface ProjectKpiGridProps {
  summary: ProjectKpiSummary;
  className?: string;
  /** Torna cada KPI clicável (padrão Contratos) — o pai decide a ação por id. */
  onKpiClick?: (id: string) => void;
  /** Ids de KPIs com filtro ativo (estado visual aria-pressed + tint). */
  activeKpiIds?: string[];
}

export function ProjectKpiGrid({ summary, className, onKpiClick, activeKpiIds }: ProjectKpiGridProps) {
  const healthVariant: KpiItem['variant'] =
    summary.avgHealth >= 80 ? 'success' : summary.avgHealth >= 60 ? 'info' : 'warning';

  const baseKpis: KpiItem[] = [
    {
      id: 'total',
      label: 'Total de projetos',
      value: summary.total,
      icon: <Briefcase className="w-5 h-5" />,
      variant: 'info',
    },
    {
      id: 'in-progress',
      label: 'Em andamento',
      value: summary.inProgress,
      icon: <Activity className="w-5 h-5" />,
      variant: 'success',
      delta: summary.trendInProgress,
    },
    {
      id: 'value',
      label: 'Valor do portfólio',
      value: summary.totalValue,
      format: 'compactCurrency',
      icon: <DollarSign className="w-5 h-5" />,
      variant: 'default',
    },
    {
      id: 'critical',
      label: 'Projetos críticos',
      value: summary.critical,
      icon: <AlertTriangle className="w-5 h-5" />,
      variant: summary.critical > 0 ? 'danger' : 'default',
    },
    {
      id: 'health',
      label: 'Saúde média',
      value: summary.avgHealth,
      suffix: '%',
      icon: <Heart className="w-5 h-5" />,
      variant: healthVariant,
    },
    {
      id: 'risks',
      label: 'Riscos abertos',
      value: summary.openRisks,
      icon: <ShieldAlert className="w-5 h-5" />,
      variant: summary.openRisks > 0 ? 'danger' : 'default',
    },
    {
      id: 'progress',
      label: 'Progresso médio',
      value: summary.avgProgress,
      suffix: '%',
      icon: <TrendingUp className="w-5 h-5" />,
      variant: 'info',
    },
    {
      id: 'delayed',
      label: 'Tarefas atrasadas',
      value: summary.delayed,
      icon: <Clock className="w-5 h-5" />,
      variant: summary.delayed > 0 ? 'warning' : 'default',
    },
  ];

  const kpis: KpiItem[] = onKpiClick
    ? baseKpis.map((kpi) => ({
        ...kpi,
        onClick: () => onKpiClick(kpi.id),
        active: activeKpiIds?.includes(kpi.id) ?? false,
      }))
    : baseKpis;

  return <HudKpiStrip kpis={kpis} columns={4} size="md" className={className} />;
}

export default ProjectKpiGrid;
