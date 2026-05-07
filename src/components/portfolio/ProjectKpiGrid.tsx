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
}

export function ProjectKpiGrid({ summary, className }: ProjectKpiGridProps) {
  const healthVariant: KpiItem['variant'] =
    summary.avgHealth >= 80 ? 'success' : summary.avgHealth >= 60 ? 'info' : 'warning';

  const kpis: KpiItem[] = [
    {
      id: 'total',
      label: 'Total Projects',
      value: summary.total,
      icon: <Briefcase className="w-5 h-5" />,
      variant: 'info',
    },
    {
      id: 'in-progress',
      label: 'In Progress',
      value: summary.inProgress,
      icon: <Activity className="w-5 h-5" />,
      variant: 'success',
      delta: summary.trendInProgress,
    },
    {
      id: 'value',
      label: 'Portfolio Value',
      value: summary.totalValue,
      format: 'compactCurrency',
      icon: <DollarSign className="w-5 h-5" />,
      variant: 'default',
    },
    {
      id: 'critical',
      label: 'Critical Projects',
      value: summary.critical,
      icon: <AlertTriangle className="w-5 h-5" />,
      variant: summary.critical > 0 ? 'danger' : 'default',
    },
    {
      id: 'health',
      label: 'Avg Health',
      value: summary.avgHealth,
      suffix: '%',
      icon: <Heart className="w-5 h-5" />,
      variant: healthVariant,
    },
    {
      id: 'risks',
      label: 'Open Risks',
      value: summary.openRisks,
      icon: <ShieldAlert className="w-5 h-5" />,
      variant: summary.openRisks > 0 ? 'danger' : 'default',
    },
    {
      id: 'progress',
      label: 'Avg Progress',
      value: summary.avgProgress,
      suffix: '%',
      icon: <TrendingUp className="w-5 h-5" />,
      variant: 'info',
    },
    {
      id: 'delayed',
      label: 'Delayed',
      value: summary.delayed,
      icon: <Clock className="w-5 h-5" />,
      variant: summary.delayed > 0 ? 'warning' : 'default',
    },
  ];

  return <HudKpiStrip kpis={kpis} columns={4} size="md" className={className} />;
}

export default ProjectKpiGrid;
