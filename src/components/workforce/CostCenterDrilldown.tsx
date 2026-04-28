'use client';

import { useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Users, DollarSign, Building2, Lightbulb, ArrowLeft, Download } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { Button } from '@/components/ui/button';
import { PJvsCLTBar } from './PJvsCLTBar';
import { CostCenter, formatWorkforceCurrency, formatWorkforcePercentage } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface CostCenterDrilldownProps {
  costCenter: CostCenter | null;
  currency?: string;
  onClose?: () => void;
  className?: string;
}

interface Recommendation {
  id: string;
  type: 'action' | 'insight' | 'warning';
  title: string;
  description: string;
  impact?: string;
}

function generateRecommendations(center: CostCenter): Recommendation[] {
  const recommendations: Recommendation[] = [];

  if (center.isAbnormal && center.growthVsPrevious > 20) {
    recommendations.push({
      id: 'freeze-hiring',
      type: 'action',
      title: 'Congelar contratações',
      description: 'Pausar novas contratações neste centro até estabilização',
      impact: `Economia potencial de ${formatWorkforceCurrency(center.payrollValue * 0.05, 'BRL')}/mês`,
    });
  }

  if (center.growthVsPrevious > 15) {
    recommendations.push({
      id: 'review-structure',
      type: 'insight',
      title: 'Revisar estrutura organizacional',
      description: 'Avaliar se o crescimento está alinhado com demanda de projetos',
      impact: 'Otimização de 10-15% possível',
    });
  }

  if (center.headcount > 100) {
    recommendations.push({
      id: 'pj-analysis',
      type: 'insight',
      title: 'Analisar mix PJ/CLT',
      description: 'Considerar rebalanceamento para maior flexibilidade',
      impact: 'Redução de custos fixos',
    });
  }

  // Always add a positive insight
  recommendations.push({
    id: 'benchmark',
    type: 'insight',
    title: 'Benchmarking setorial',
    description: `Custo médio de ${formatWorkforceCurrency(center.payrollValue / center.headcount, 'BRL')}/func está ${center.growthVsPrevious > 10 ? 'acima' : 'alinhado com'} mercado`,
  });

  return recommendations.slice(0, 3);
}

export function CostCenterDrilldown({
  costCenter,
  currency = 'BRL',
  onClose,
  className,
}: CostCenterDrilldownProps) {
  const recommendations = useMemo(() => 
    costCenter ? generateRecommendations(costCenter) : [],
    [costCenter]
  );

  const avgCost = costCenter ? costCenter.payrollValue / costCenter.headcount : 0;

  // Simulate PJ/CLT distribution based on center type
  const pjCltDistribution = useMemo(() => {
    if (!costCenter) return { pj: 0, clt: 0, pjPercent: 0, cltPercent: 0 };
    // Simulate based on center name
    const isEngOrPD = costCenter.name.toLowerCase().includes('eng') || 
                      costCenter.name.toLowerCase().includes('p&d');
    const pjPercent = isEngOrPD ? 45 : 25;
    const pj = Math.round(costCenter.headcount * (pjPercent / 100));
    const clt = costCenter.headcount - pj;
    return { pj, clt, pjPercent, cltPercent: 100 - pjPercent };
  }, [costCenter]);

  if (!costCenter) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className={className}
      >
        <OrionCard 
          variant="elevated" 
          glowColor={costCenter.isAbnormal ? 'warning' : 'info'}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2.5 rounded-xl',
                costCenter.isAbnormal
                  ? 'bg-ig-warning/10 border border-ig-warning/25'
                  : 'bg-ig-info/10 border border-ig-info/25'
              )}>
                <Building2 className={cn(
                  'w-5 h-5',
                  costCenter.isAbnormal ? 'text-ig-warning' : 'text-ig-info'
                )} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ig-fg-strong tracking-tight">
                  {costCenter.name}
                </h2>
                <p className="text-xs text-ig-fg-muted">
                  Análise detalhada do centro de custo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-ig-fg-muted hover:text-ig-fg-strong hover:bg-ig-panel-hover"
              >
                <Download className="w-4 h-4 mr-1" />
                Exportar
              </Button>
              {onClose ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-ig-fg-muted hover:text-ig-fg-strong hover:bg-ig-panel-hover"
                >
                  <X className="w-4 h-4" />
                </Button>
              ) : (
                <Link href="/workforce-cost">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-ig-fg-muted hover:text-ig-fg-strong hover:bg-ig-panel-hover"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Voltar
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-ig-fg-subtle" />
                <span className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle">Folha</span>
              </div>
              <p className="text-lg font-semibold text-ig-fg-strong ig-tabular tracking-tight">
                {formatWorkforceCurrency(costCenter.payrollValue, currency)}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-ig-fg-subtle" />
                <span className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle">Headcount</span>
              </div>
              <p className="text-lg font-semibold text-ig-fg-strong ig-tabular tracking-tight">
                {costCenter.headcount}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-ig-fg-subtle" />
                <span className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle">Custo Médio</span>
              </div>
              <p className="text-lg font-semibold text-ig-fg-strong ig-tabular tracking-tight">
                {formatWorkforceCurrency(avgCost, currency)}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
              <div className="flex items-center gap-2 mb-1">
                {costCenter.growthVsPrevious > 0 ? (
                  <TrendingUp className={cn(
                    'w-4 h-4',
                    costCenter.isAbnormal ? 'text-ig-warning' : 'text-ig-success'
                  )} />
                ) : (
                  <TrendingDown className="w-4 h-4 text-ig-success" />
                )}
                <span className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle">Crescimento</span>
              </div>
              <p className={cn(
                'text-lg font-semibold ig-tabular tracking-tight',
                costCenter.isAbnormal ? 'text-ig-warning' : 'text-ig-fg-strong'
              )}>
                {formatWorkforcePercentage(costCenter.growthVsPrevious)}
              </p>
            </div>
          </div>

          {/* PJ vs CLT Distribution */}
          <div className="p-4 rounded-lg bg-ig-panel/60 border border-ig-border-subtle mb-6">
            <h4 className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle mb-3">Mix Contratual</h4>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xs text-ig-fg-muted">PJ</span>
                  <p className="text-lg font-semibold text-ig-info ig-tabular tracking-tight">{pjCltDistribution.pj}</p>
                </div>
                <div>
                  <span className="text-xs text-ig-fg-muted">CLT</span>
                  <p className="text-lg font-semibold text-ig-success ig-tabular tracking-tight">{pjCltDistribution.clt}</p>
                </div>
              </div>
            </div>
            <PJvsCLTBar
              pjPercent={pjCltDistribution.pjPercent}
              cltPercent={pjCltDistribution.cltPercent}
              showLabels={false}
            />
          </div>

          {/* Executive Recommendations */}
          <div className="border-t border-ig-border-subtle pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-4 h-4 text-ig-info" />
              <h4 className="text-sm font-semibold text-ig-fg-strong tracking-tight">Recomendações Executivas</h4>
            </div>

            <div className="space-y-3">
              {recommendations.map((rec, idx) => (
                <motion.div
                  key={rec.id}
                  className={cn(
                    'p-3 rounded-lg',
                    rec.type === 'action'
                      ? 'bg-ig-info/10 border border-ig-info/25'
                      : rec.type === 'warning'
                      ? 'bg-ig-warning/10 border border-ig-warning/25'
                      : 'bg-ig-panel border border-ig-border-subtle'
                  )}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ig-fg-strong">{rec.title}</p>
                      <p className="text-xs text-ig-fg-muted mt-0.5">
                        {rec.description}
                      </p>
                    </div>
                    {rec.impact && (
                      <span className="text-xs text-ig-success font-medium whitespace-nowrap">
                        {rec.impact}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </OrionCard>
      </motion.div>
    </AnimatePresence>
  );
}

