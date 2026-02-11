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
                  ? 'bg-semantic-warning-bg border border-semantic-warning-DEFAULT/20' 
                  : 'bg-semantic-info-bg border border-semantic-info-DEFAULT/20'
              )}>
                <Building2 className={cn(
                  'w-5 h-5',
                  costCenter.isAbnormal ? 'text-semantic-warning-DEFAULT' : 'text-semantic-info-DEFAULT'
                )} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {costCenter.name}
                </h2>
                <p className="text-xs text-orion-text-muted">
                  Análise detalhada do centro de custo
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-orion-text-muted hover:text-white"
              >
                <Download className="w-4 h-4 mr-1" />
                Exportar
              </Button>
              {onClose ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-orion-text-muted hover:text-white"
                >
                  <X className="w-4 h-4" />
                </Button>
              ) : (
                <Link href="/workforce-cost">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-orion-text-muted hover:text-white"
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
            <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-orion-text-muted" />
                <span className="text-xs text-orion-text-muted">Folha</span>
              </div>
              <p className="text-lg font-bold text-white">
                {formatWorkforceCurrency(costCenter.payrollValue, currency)}
              </p>
            </div>
            
            <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-orion-text-muted" />
                <span className="text-xs text-orion-text-muted">Headcount</span>
              </div>
              <p className="text-lg font-bold text-white">
                {costCenter.headcount}
              </p>
            </div>
            
            <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-orion-text-muted" />
                <span className="text-xs text-orion-text-muted">Custo Médio</span>
              </div>
              <p className="text-lg font-bold text-white">
                {formatWorkforceCurrency(avgCost, currency)}
              </p>
            </div>
            
            <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
              <div className="flex items-center gap-2 mb-1">
                {costCenter.growthVsPrevious > 0 ? (
                  <TrendingUp className={cn(
                    'w-4 h-4',
                    costCenter.isAbnormal ? 'text-semantic-warning-DEFAULT' : 'text-semantic-success-DEFAULT'
                  )} />
                ) : (
                  <TrendingDown className="w-4 h-4 text-semantic-success-DEFAULT" />
                )}
                <span className="text-xs text-orion-text-muted">Crescimento</span>
              </div>
              <p className={cn(
                'text-lg font-bold',
                costCenter.isAbnormal ? 'text-semantic-warning-DEFAULT' : 'text-white'
              )}>
                {formatWorkforcePercentage(costCenter.growthVsPrevious)}
              </p>
            </div>
          </div>

          {/* PJ vs CLT Distribution */}
          <div className="p-4 rounded-lg bg-orion-bg-elevated/30 mb-6">
            <h4 className="text-sm font-medium text-white mb-3">Mix Contratual</h4>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xs text-orion-text-muted">PJ</span>
                  <p className="text-lg font-bold text-semantic-info-DEFAULT">{pjCltDistribution.pj}</p>
                </div>
                <div>
                  <span className="text-xs text-orion-text-muted">CLT</span>
                  <p className="text-lg font-bold text-semantic-success-DEFAULT">{pjCltDistribution.clt}</p>
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
          <div className="border-t border-orion-border-subtle pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-4 h-4 text-semantic-info-DEFAULT" />
              <h4 className="text-sm font-semibold text-white">Recomendações Executivas</h4>
            </div>
            
            <div className="space-y-3">
              {recommendations.map((rec, idx) => (
                <motion.div
                  key={rec.id}
                  className={cn(
                    'p-3 rounded-lg',
                    rec.type === 'action' 
                      ? 'bg-semantic-info-bg border border-semantic-info-DEFAULT/20'
                      : rec.type === 'warning'
                      ? 'bg-semantic-warning-bg border border-semantic-warning-DEFAULT/20'
                      : 'bg-orion-bg-elevated/50'
                  )}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{rec.title}</p>
                      <p className="text-xs text-orion-text-secondary mt-0.5">
                        {rec.description}
                      </p>
                    </div>
                    {rec.impact && (
                      <span className="text-xs text-semantic-success-DEFAULT whitespace-nowrap">
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

