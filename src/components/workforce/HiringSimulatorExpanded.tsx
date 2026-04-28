'use client';

import { useState, useMemo, useCallback } from 'react';
import { 
  UserPlus, 
  Calculator, 
  TrendingDown, 
  DollarSign, 
  Target, 
  Users,
  Zap,
  Shield,
  Flame,
} from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HoverCard, ContainerHoverCard } from '@/components/motion';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  calculateRequiredRevenue, 
  calculateEbitdaImpact,
  formatWorkforceCurrency,
} from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface ScenarioResult {
  requiredRevenue: number;
  ebitdaImpact: number;
  totalMonthlyCost: number;
  breakEvenMonths: number;
}

interface HiringSimulatorExpandedProps {
  initialAvgCost?: number;
  initialEbitdaMargin?: number;
  currentRevenue?: number;
  className?: string;
}

export function HiringSimulatorExpanded({
  initialAvgCost = 15000,
  initialEbitdaMargin = 22.8,
  currentRevenue = 125000000,
  className,
}: HiringSimulatorExpandedProps) {
  const [avgCost, setAvgCost] = useState(initialAvgCost);
  const [targetMargin, setTargetMargin] = useState(initialEbitdaMargin);
  const [hiresToSimulate, setHiresToSimulate] = useState(1);
  const [activeScenario, setActiveScenario] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');

  // Scenario multipliers
  const scenarioConfigs = {
    conservative: { revenueGrowth: 0.02, label: 'Conservador', icon: Shield, color: 'text-ig-success' },
    moderate: { revenueGrowth: 0.05, label: 'Moderado', icon: Zap, color: 'text-ig-info' },
    aggressive: { revenueGrowth: 0.10, label: 'Agressivo', icon: Flame, color: 'text-ig-warning' },
  };

  // Calculate scenario results
  const scenarios = useMemo(() => {
    const totalCost = avgCost * hiresToSimulate;
    
    const calculateScenario = (revenueGrowthRate: number): ScenarioResult => {
      const requiredRevenuePerHire = calculateRequiredRevenue(avgCost, targetMargin);
      const totalRequiredRevenue = requiredRevenuePerHire * hiresToSimulate;
      const ebitdaImpact = calculateEbitdaImpact(totalCost, currentRevenue, targetMargin);
      
      // Break-even: months until revenue growth covers additional cost
      const monthlyRevenueGrowth = currentRevenue * revenueGrowthRate;
      const breakEvenMonths = monthlyRevenueGrowth > 0 
        ? Math.ceil(totalRequiredRevenue / monthlyRevenueGrowth)
        : 999;
      
      return {
        requiredRevenue: totalRequiredRevenue,
        ebitdaImpact,
        totalMonthlyCost: totalCost,
        breakEvenMonths: Math.min(breakEvenMonths, 24),
      };
    };

    return {
      conservative: calculateScenario(scenarioConfigs.conservative.revenueGrowth),
      moderate: calculateScenario(scenarioConfigs.moderate.revenueGrowth),
      aggressive: calculateScenario(scenarioConfigs.aggressive.revenueGrowth),
    };
  }, [avgCost, targetMargin, hiresToSimulate, currentRevenue]);

  const activeResult = scenarios[activeScenario];
  const activeConfig = scenarioConfigs[activeScenario];

  // Generate board-ready summary
  const boardSummary = useMemo(() => {
    const costText = formatWorkforceCurrency(activeResult.totalMonthlyCost, 'BRL');
    const revenueText = formatWorkforceCurrency(activeResult.requiredRevenue, 'BRL');
    const impactText = activeResult.ebitdaImpact.toFixed(2);
    
    return `Contratar ${hiresToSimulate} funcionário${hiresToSimulate > 1 ? 's' : ''} adiciona ${costText}/mês em custos fixos. Para preservar a margem de ${targetMargin.toFixed(1)}%, é necessário gerar ${revenueText}/mês em receita adicional. Sem este incremento, o impacto na margem EBITDA é de ${impactText} p.p. No cenário ${activeConfig.label.toLowerCase()}, o break-even ocorre em ${activeResult.breakEvenMonths} meses.`;
  }, [activeResult, hiresToSimulate, targetMargin, activeConfig]);

  const handleCostChange = useCallback((value: number[]) => setAvgCost(value[0]), []);
  const handleMarginChange = useCallback((value: number[]) => setTargetMargin(value[0]), []);
  const handleHiresChange = useCallback((value: number[]) => setHiresToSimulate(value[0]), []);

  return (
    <ContainerHoverCard lightSweep>
      <OrionCard variant="elevated" className={cn('', className)}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-ig-info/10 border border-ig-info/25">
              <Calculator className="w-5 h-5 text-ig-info" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-ig-fg-strong">
                Simulador de Contratação
              </h3>
              <p className="text-xs text-ig-fg-muted">
                Análise de impacto estratégico para decisão do board
              </p>
            </div>
          </div>
        </div>

        {/* Input Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* Average Cost */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-ig-fg-muted" />
                <span className="text-sm text-ig-fg-default">Custo Médio/Func.</span>
              </div>
              <span className="text-sm font-semibold text-ig-fg-strong">
                {formatWorkforceCurrency(avgCost, 'BRL')}
              </span>
            </div>
            <Slider
              value={[avgCost]}
              onValueChange={handleCostChange}
              min={5000}
              max={50000}
              step={500}
            />
            <div className="flex justify-between text-[10px] text-ig-fg-muted">
              <span>R$ 5K</span>
              <span>R$ 50K</span>
            </div>
          </div>

          {/* Target Margin */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-ig-fg-muted" />
                <span className="text-sm text-ig-fg-default">Margem EBITDA Alvo</span>
              </div>
              <span className="text-sm font-semibold text-ig-fg-strong">
                {targetMargin.toFixed(1)}%
              </span>
            </div>
            <Slider
              value={[targetMargin]}
              onValueChange={handleMarginChange}
              min={5}
              max={40}
              step={0.5}
            />
            <div className="flex justify-between text-[10px] text-ig-fg-muted">
              <span>5%</span>
              <span>40%</span>
            </div>
          </div>

          {/* Hires to Simulate */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-ig-fg-muted" />
                <span className="text-sm text-ig-fg-default">Contratações</span>
              </div>
              <span className="text-sm font-semibold text-ig-fg-strong">
                {hiresToSimulate} funcionário{hiresToSimulate > 1 ? 's' : ''}
              </span>
            </div>
            <Slider
              value={[hiresToSimulate]}
              onValueChange={handleHiresChange}
              min={1}
              max={20}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-ig-fg-muted">
              <span>1</span>
              <span>20</span>
            </div>
          </div>
        </div>

        {/* Scenario Tabs */}
        <Tabs value={activeScenario} onValueChange={(v) => setActiveScenario(v as typeof activeScenario)}>
          <TabsList className="w-full mb-4 bg-ig-panel border border-ig-border-subtle">
            {Object.entries(scenarioConfigs).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <TabsTrigger
                  key={key}
                  value={key}
                  className={cn(
                    'flex-1 data-[state=active]:bg-ig-panel-hover',
                    `data-[state=active]:${config.color}`
                  )}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {config.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Results for each scenario */}
          {Object.entries(scenarios).map(([key, result]) => (
            <TabsContent key={key} value={key}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${key}-${hiresToSimulate}-${avgCost}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Results Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {/* Total Monthly Cost */}
                    <div className="p-4 rounded-xl bg-ig-panel border border-ig-border-subtle">
                      <p className="text-xs text-ig-fg-muted mb-1">Custo Mensal Total</p>
                      <p className="text-xl font-semibold text-ig-fg-strong">
                        {formatWorkforceCurrency(result.totalMonthlyCost, 'BRL')}
                      </p>
                    </div>

                    {/* Required Revenue */}
                    <div className="p-4 rounded-xl bg-ig-info/10 border border-ig-info/25">
                      <p className="text-xs text-ig-fg-muted mb-1">Receita Necessária</p>
                      <p className="text-xl font-semibold text-ig-info">
                        {formatWorkforceCurrency(result.requiredRevenue, 'BRL')}
                      </p>
                      <p className="text-xs text-ig-fg-muted">/mês</p>
                    </div>

                    {/* EBITDA Impact */}
                    <div className={cn(
                      'p-4 rounded-xl',
                      Math.abs(result.ebitdaImpact) > 0.1
                        ? 'bg-ig-warning/10 border border-ig-warning/25'
                        : 'bg-ig-panel border border-ig-border-subtle'
                    )}>
                      <p className="text-xs text-ig-fg-muted mb-1">Impacto EBITDA</p>
                      <p className={cn(
                        'text-xl font-semibold',
                        Math.abs(result.ebitdaImpact) > 0.1
                          ? 'text-ig-warning'
                          : 'text-ig-fg-default'
                      )}>
                        {result.ebitdaImpact.toFixed(2)} p.p.
                      </p>
                      <p className="text-xs text-ig-fg-muted">sem receita adicional</p>
                    </div>

                    {/* Break-even */}
                    <div className="p-4 rounded-xl bg-ig-panel border border-ig-border-subtle">
                      <p className="text-xs text-ig-fg-muted mb-1">Break-even</p>
                      <p className="text-xl font-semibold text-ig-success">
                        {result.breakEvenMonths < 24 ? `${result.breakEvenMonths} meses` : '24+ meses'}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </TabsContent>
          ))}
        </Tabs>

        {/* Board Summary */}
        <div
          className={cn(
            'p-4 rounded-xl border bg-gradient-to-r',
            'from-sky-50/95 via-white to-slate-50/90 border-sky-200/75 shadow-[0_8px_30px_rgba(14,116,144,0.08)]',
            'dark:from-cyan-950/35 dark:via-transparent dark:to-transparent dark:border-ig-info/25 dark:shadow-none'
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'p-2 rounded-lg border',
                'bg-sky-100/90 border-sky-200/80',
                'dark:bg-ig-info/15 dark:border-transparent'
              )}
            >
              <UserPlus className="w-4 h-4 text-sky-700 dark:text-ig-info" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold mb-1 text-sky-900 dark:text-ig-info">
                Resumo para o Board
              </p>
              <p className="text-sm leading-relaxed text-slate-800 dark:text-ig-fg-default">
                {boardSummary}
              </p>
            </div>
          </div>
        </div>
      </OrionCard>
    </ContainerHoverCard>
  );
}

