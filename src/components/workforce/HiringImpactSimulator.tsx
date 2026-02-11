'use client';

import { useState, useMemo, useCallback } from 'react';
import { UserPlus, Calculator, TrendingDown, DollarSign, Target } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HoverCard } from '@/components/motion';
import { Slider } from '@/components/ui/slider';
import { 
  calculateRequiredRevenue, 
  calculateEbitdaImpact,
  formatWorkforceCurrency,
} from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface HiringImpactSimulatorProps {
  initialAvgCost?: number;
  initialEbitdaMargin?: number;
  currentRevenue?: number;
  className?: string;
}

export function HiringImpactSimulator({
  initialAvgCost = 15000,
  initialEbitdaMargin = 22.8,
  currentRevenue = 125000000, // 125M monthly revenue
  className,
}: HiringImpactSimulatorProps) {
  const [avgCost, setAvgCost] = useState(initialAvgCost);
  const [targetMargin, setTargetMargin] = useState(initialEbitdaMargin);

  // Calculate simulation results
  const results = useMemo(() => {
    const requiredRevenue = calculateRequiredRevenue(avgCost, targetMargin);
    const ebitdaImpact = calculateEbitdaImpact(avgCost, currentRevenue, targetMargin);
    
    return {
      requiredRevenue,
      ebitdaImpact,
      marginDilution: Math.abs(ebitdaImpact),
      revenuePerHeadcount: requiredRevenue,
    };
  }, [avgCost, targetMargin, currentRevenue]);

  const handleCostChange = useCallback((value: number[]) => {
    setAvgCost(value[0]);
  }, []);

  const handleMarginChange = useCallback((value: number[]) => {
    setTargetMargin(value[0]);
  }, []);

  const isHighImpact = results.marginDilution > 0.1;

  return (
    <HoverCard preset="card" lightSweep>
      <OrionCard 
        variant="elevated" 
        glowColor={isHighImpact ? 'warning' : 'info'}
        className={cn('h-full', className)}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-semantic-info-bg border border-semantic-info-DEFAULT/20">
              <Calculator className="w-5 h-5 text-semantic-info-DEFAULT" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white orion-text-heading">
                Simulador de Contratação
              </h3>
              <p className="text-xs text-orion-text-muted">
                Impacto estratégico por nova contratação
              </p>
            </div>
          </div>
        </div>

        {/* Input Controls */}
        <div className="space-y-6 mb-6">
          {/* Average Employee Cost Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-orion-text-muted" />
                <span className="text-sm text-orion-text-secondary">
                  Custo Médio/Funcionário
                </span>
              </div>
              <span className="text-sm font-semibold text-white">
                {formatWorkforceCurrency(avgCost, 'BRL')}
              </span>
            </div>
            <Slider
              value={[avgCost]}
              onValueChange={handleCostChange}
              min={5000}
              max={50000}
              step={500}
              className="py-2"
            />
            <div className="flex justify-between text-[10px] text-orion-text-muted">
              <span>R$ 5K</span>
              <span>R$ 50K</span>
            </div>
          </div>

          {/* Target EBITDA Margin Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-orion-text-muted" />
                <span className="text-sm text-orion-text-secondary">
                  Margem EBITDA Alvo
                </span>
              </div>
              <span className="text-sm font-semibold text-white">
                {targetMargin.toFixed(1)}%
              </span>
            </div>
            <Slider
              value={[targetMargin]}
              onValueChange={handleMarginChange}
              min={5}
              max={40}
              step={0.5}
              className="py-2"
            />
            <div className="flex justify-between text-[10px] text-orion-text-muted">
              <span>5%</span>
              <span>40%</span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-orion-border-default to-transparent mb-6" />

        {/* Results Section */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${avgCost}-${targetMargin}`}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Required Revenue per Hire */}
            <div className={cn(
              'p-4 rounded-xl',
              'bg-gradient-to-br from-semantic-info-bg to-transparent',
              'border border-semantic-info-DEFAULT/20'
            )}>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-semantic-info-DEFAULT/20">
                  <UserPlus className="w-4 h-4 text-semantic-info-DEFAULT" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-orion-text-muted mb-1">
                    +1 funcionário requer
                  </p>
                  <p className="text-xl font-bold text-white">
                    {formatWorkforceCurrency(results.requiredRevenue, 'BRL')}
                    <span className="text-sm font-normal text-orion-text-muted">/mês</span>
                  </p>
                  <p className="text-xs text-orion-text-secondary mt-1">
                    em receita adicional para preservar margem
                  </p>
                </div>
              </div>
            </div>

            {/* EBITDA Impact Warning */}
            <div className={cn(
              'p-4 rounded-xl',
              isHighImpact 
                ? 'bg-gradient-to-br from-semantic-warning-bg to-transparent border border-semantic-warning-DEFAULT/20'
                : 'bg-gradient-to-br from-orion-bg-elevated/50 to-transparent border border-orion-border-subtle'
            )}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  'p-2 rounded-lg',
                  isHighImpact 
                    ? 'bg-semantic-warning-DEFAULT/20' 
                    : 'bg-orion-bg-elevated'
                )}>
                  <TrendingDown className={cn(
                    'w-4 h-4',
                    isHighImpact 
                      ? 'text-semantic-warning-DEFAULT' 
                      : 'text-orion-text-muted'
                  )} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-orion-text-muted mb-1">
                    Impacto no EBITDA sem receita adicional
                  </p>
                  <p className={cn(
                    'text-xl font-bold',
                    isHighImpact 
                      ? 'text-semantic-warning-DEFAULT' 
                      : 'text-orion-text-secondary'
                  )}>
                    -{results.marginDilution.toFixed(2)}%
                    <span className="text-sm font-normal text-orion-text-muted ml-1">
                      por contratação
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Executive Insight Message */}
            <div className="p-3 rounded-lg bg-orion-bg-elevated/30 border border-orion-border-subtle">
              <p className="text-xs text-orion-text-secondary leading-relaxed">
                <span className="text-semantic-info-DEFAULT font-medium">Insight:</span>{' '}
                A cada contratação com custo de{' '}
                <span className="text-white font-medium">
                  {formatWorkforceCurrency(avgCost, 'BRL')}
                </span>
                , a empresa precisa gerar{' '}
                <span className="text-semantic-success-DEFAULT font-medium">
                  {formatWorkforceCurrency(results.requiredRevenue, 'BRL')}
                </span>{' '}
                em receita adicional mensal para manter a margem de{' '}
                <span className="text-white font-medium">{targetMargin.toFixed(1)}%</span>.
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </OrionCard>
    </HoverCard>
  );
}

