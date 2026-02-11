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
    conservative: { revenueGrowth: 0.02, label: 'Conservador', icon: Shield, color: 'text-semantic-success-DEFAULT' },
    moderate: { revenueGrowth: 0.05, label: 'Moderado', icon: Zap, color: 'text-semantic-info-DEFAULT' },
    aggressive: { revenueGrowth: 0.10, label: 'Agressivo', icon: Flame, color: 'text-semantic-warning-DEFAULT' },
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
            <div className="p-2.5 rounded-xl bg-semantic-info-bg border border-semantic-info-DEFAULT/20">
              <Calculator className="w-5 h-5 text-semantic-info-DEFAULT" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white orion-text-heading">
                Simulador de Contratação
              </h3>
              <p className="text-xs text-orion-text-muted">
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
                <DollarSign className="w-4 h-4 text-orion-text-muted" />
                <span className="text-sm text-orion-text-secondary">Custo Médio/Func.</span>
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
            />
            <div className="flex justify-between text-[10px] text-orion-text-muted">
              <span>R$ 5K</span>
              <span>R$ 50K</span>
            </div>
          </div>

          {/* Target Margin */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-orion-text-muted" />
                <span className="text-sm text-orion-text-secondary">Margem EBITDA Alvo</span>
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
            />
            <div className="flex justify-between text-[10px] text-orion-text-muted">
              <span>5%</span>
              <span>40%</span>
            </div>
          </div>

          {/* Hires to Simulate */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-orion-text-muted" />
                <span className="text-sm text-orion-text-secondary">Contratações</span>
              </div>
              <span className="text-sm font-semibold text-white">
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
            <div className="flex justify-between text-[10px] text-orion-text-muted">
              <span>1</span>
              <span>20</span>
            </div>
          </div>
        </div>

        {/* Scenario Tabs */}
        <Tabs value={activeScenario} onValueChange={(v) => setActiveScenario(v as typeof activeScenario)}>
          <TabsList className="w-full mb-4 bg-orion-bg-elevated/50">
            {Object.entries(scenarioConfigs).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <TabsTrigger
                  key={key}
                  value={key}
                  className={cn(
                    'flex-1 data-[state=active]:bg-glass-medium',
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
                    <div className="p-4 rounded-xl bg-orion-bg-elevated/50">
                      <p className="text-xs text-orion-text-muted mb-1">Custo Mensal Total</p>
                      <p className="text-xl font-bold text-white">
                        {formatWorkforceCurrency(result.totalMonthlyCost, 'BRL')}
                      </p>
                    </div>

                    {/* Required Revenue */}
                    <div className="p-4 rounded-xl bg-semantic-info-bg border border-semantic-info-DEFAULT/20">
                      <p className="text-xs text-orion-text-muted mb-1">Receita Necessária</p>
                      <p className="text-xl font-bold text-semantic-info-DEFAULT">
                        {formatWorkforceCurrency(result.requiredRevenue, 'BRL')}
                      </p>
                      <p className="text-xs text-orion-text-muted">/mês</p>
                    </div>

                    {/* EBITDA Impact */}
                    <div className={cn(
                      'p-4 rounded-xl',
                      Math.abs(result.ebitdaImpact) > 0.1
                        ? 'bg-semantic-warning-bg border border-semantic-warning-DEFAULT/20'
                        : 'bg-orion-bg-elevated/50'
                    )}>
                      <p className="text-xs text-orion-text-muted mb-1">Impacto EBITDA</p>
                      <p className={cn(
                        'text-xl font-bold',
                        Math.abs(result.ebitdaImpact) > 0.1
                          ? 'text-semantic-warning-DEFAULT'
                          : 'text-orion-text-secondary'
                      )}>
                        {result.ebitdaImpact.toFixed(2)} p.p.
                      </p>
                      <p className="text-xs text-orion-text-muted">sem receita adicional</p>
                    </div>

                    {/* Break-even */}
                    <div className="p-4 rounded-xl bg-orion-bg-elevated/50">
                      <p className="text-xs text-orion-text-muted mb-1">Break-even</p>
                      <p className="text-xl font-bold text-semantic-success-DEFAULT">
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
        <div className="p-4 rounded-xl bg-gradient-to-r from-semantic-info-bg to-transparent border border-semantic-info-DEFAULT/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-semantic-info-DEFAULT/20">
              <UserPlus className="w-4 h-4 text-semantic-info-DEFAULT" />
            </div>
            <div>
              <p className="text-xs text-semantic-info-DEFAULT font-medium mb-1">
                Resumo para o Board
              </p>
              <p className="text-sm text-orion-text-secondary leading-relaxed">
                {boardSummary}
              </p>
            </div>
          </div>
        </div>
      </OrionCard>
    </ContainerHoverCard>
  );
}

