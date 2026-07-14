'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  UserPlus,
  Calculator,
  DollarSign,
  Target,
  Users,
  Zap,
  Shield,
  Flame,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Percent,
} from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface HiringSimulatorExpandedProps {
  /** Real average TOTAL cost per employee (payroll total ÷ headcount). */
  initialAvgCost?: number;
  /** Real total monthly payroll (from approved payroll closing). */
  currentPayroll?: number;
  /** Real monthly revenue (from AR module). */
  currentRevenue?: number;
  /** Current headcount (from approved payroll closing). */
  currentHeadcount?: number;
  /** Folha/Receita threshold (default 30%). */
  payrollRevenueThreshold?: number;
  className?: string;
}

type Scenario = 'conservative' | 'moderate' | 'aggressive';

const SCENARIO_CONFIGS: Record<Scenario, { revenueGrowth: number; label: string; icon: typeof Shield; color: string; desc: string }> = {
  conservative: { revenueGrowth: 0.02, label: 'Conservador', icon: Shield, color: 'text-ig-success', desc: '+2% receita/mês' },
  moderate:     { revenueGrowth: 0.05, label: 'Moderado',    icon: Zap,    color: 'text-ig-info',    desc: '+5% receita/mês' },
  aggressive:   { revenueGrowth: 0.10, label: 'Agressivo',   icon: Flame,  color: 'text-ig-warning', desc: '+10% receita/mês' },
};

// Typical CLT Brazil encargos breakdown (shown in tooltip)
const ENCARGOS_BREAKDOWN = [
  { label: 'INSS patronal',    pct: 20.0 },
  { label: 'FGTS',             pct: 8.0  },
  { label: '13º salário',      pct: 8.33 },
  { label: 'Férias + 1/3',     pct: 11.11 },
  { label: 'FGTS 13º/férias',  pct: 2.5  },
  { label: 'RAT + Terceiros',  pct: 5.8  },
  { label: 'Benefícios est.',  pct: 14.26 },
];

export function HiringSimulatorExpanded({
  initialAvgCost = 15000,
  currentPayroll = 0,
  currentRevenue = 0,
  currentHeadcount = 0,
  payrollRevenueThreshold = 30,
  className,
}: HiringSimulatorExpandedProps) {
  // Base salary defaults to back-calculated from total cost (real avg cost / 1.70)
  const defaultBase = initialAvgCost > 0 ? Math.round(initialAvgCost / 1.70 / 500) * 500 : 9000;
  const [baseSalary, setBaseSalary]   = useState(defaultBase);
  const [encargosPct, setEncargosPct] = useState(70);   // % sobre salário base
  const [hires, setHires]             = useState(1);
  const [activeScenario, setActiveScenario] = useState<Scenario>('moderate');

  const hasRealData = currentPayroll > 0 && currentRevenue > 0;

  // Total cost per hire = salário base × (1 + encargos/100)
  const totalCostPerHire = useMemo(() => Math.round(baseSalary * (1 + encargosPct / 100)), [baseSalary, encargosPct]);

  const sim = useMemo(() => {
    const additionalCost = totalCostPerHire * hires;
    const newPayroll     = currentPayroll + additionalCost;
    const newHeadcount   = currentHeadcount + hires;

    const currentRatio   = currentRevenue > 0 ? (currentPayroll / currentRevenue) * 100 : 0;
    const projectedRatio = currentRevenue > 0 ? (newPayroll    / currentRevenue) * 100 : 0;
    const ratioDelta     = projectedRatio - currentRatio;

    // Δ Faturamento para manter índice ATUAL (sem degradação)
    //   nova_folha / ratio_atual = receita_necessária → Δ = receita_necessária - receita_atual
    const revenueToMaintainRatio = currentRatio > 0
      ? newPayroll / (currentRatio / 100)
      : 0;
    const revenueGapMaintain = Math.max(0, revenueToMaintainRatio - currentRevenue);

    // Δ Faturamento para retornar ao threshold (se excedeu)
    const revenueToHitThreshold = newPayroll / (payrollRevenueThreshold / 100);
    const revenueGapThreshold   = Math.max(0, revenueToHitThreshold - currentRevenue);

    // Break-even: t ≈ (additionalCost / currentPayroll) / taxa
    const breakEvens = (Object.entries(SCENARIO_CONFIGS) as [Scenario, typeof SCENARIO_CONFIGS[Scenario]][]).reduce<Record<string, number>>((acc, [key, cfg]) => {
      if (cfg.revenueGrowth <= 0 || currentPayroll <= 0) { acc[key] = 36; return acc; }
      acc[key] = Math.min(Math.ceil((additionalCost / currentPayroll) / cfg.revenueGrowth), 36);
      return acc;
    }, {});

    const exceedsThreshold = projectedRatio > payrollRevenueThreshold;
    const nearThreshold    = projectedRatio > payrollRevenueThreshold * 0.9;

    // Receita incremental necessária para que ESTAS contratações fiquem dentro do limite
    // Fórmula: custo_adicional ÷ (threshold/100) → sempre computável, sem depender de dados reais
    const revenueNeededForHires = additionalCost / (payrollRevenueThreshold / 100);
    // Se temos dados reais: quanto a receita atual ainda está longe da receita necessária total
    const revenueCurrentGap = hasRealData
      ? Math.max(0, (newPayroll / (payrollRevenueThreshold / 100)) - currentRevenue)
      : revenueNeededForHires;

    return {
      additionalCost, newPayroll, newHeadcount,
      currentRatio, projectedRatio, ratioDelta,
      revenueGapMaintain, revenueGapThreshold,
      revenueNeededForHires, revenueCurrentGap,
      breakEvens, exceedsThreshold, nearThreshold,
    };
  }, [totalCostPerHire, hires, currentPayroll, currentRevenue, currentHeadcount, payrollRevenueThreshold]);

  const activeBreakEven = sim.breakEvens[activeScenario];
  const activeCfg       = SCENARIO_CONFIGS[activeScenario];

  const handleBaseChange     = useCallback((v: number[]) => setBaseSalary(v[0]),   []);
  const handleEncargosChange = useCallback((v: number[]) => setEncargosPct(v[0]),  []);
  const handleHiresChange    = useCallback((v: number[]) => setHires(v[0]),         []);

  // Board summary
  const boardSummary = useMemo(() => {
    const funcStr    = formatWorkforceCurrency(totalCostPerHire);
    const addStr     = formatWorkforceCurrency(sim.additionalCost);
    const revStr     = formatWorkforceCurrency(sim.revenueNeededForHires);
    const projRatio  = `${sim.projectedRatio.toFixed(1)}%`;

    const base = `Para contratar ${hires} pessoa${hires > 1 ? 's' : ''} com salário ${formatWorkforceCurrency(baseSalary)} + ${encargosPct}% encargos (= ${funcStr}/func.), a empresa precisa gerar ${revStr} a mais de faturamento mensal para manter o índice Folha/Receita ≤ ${payrollRevenueThreshold}%.`;

    if (!hasRealData) {
      return `${base} Importe a folha e contas a receber para ver o impacto sobre os dados reais.`;
    }

    const projNote = sim.exceedsThreshold
      ? ` Com a receita atual, o índice projetado seria ${projRatio} — acima do limite. O gap de faturamento é de ${formatWorkforceCurrency(sim.revenueCurrentGap)}.`
      : ` Com a receita atual, o índice projetado (${projRatio}) permanece dentro do limite.`;

    return `${base}${projNote} No cenário ${activeCfg.label.toLowerCase()}, o break-even ocorre em ${activeBreakEven} ${activeBreakEven === 1 ? 'mês' : 'meses'}.`;
  }, [sim, hires, baseSalary, encargosPct, totalCostPerHire, hasRealData, payrollRevenueThreshold, activeCfg, activeBreakEven]);

  return (
    <OrionCard variant="elevated" className={cn('space-y-5', className)}>
      {/* Context bar */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-ig-info/10 border border-ig-info/20">
          <Calculator className="w-4 h-4 text-ig-info" />
        </div>
        <p className="flex-1 text-xs text-ig-fg-muted min-w-0">
          {hasRealData
            ? `Base atual: ${currentHeadcount} func. · folha ${formatWorkforceCurrency(currentPayroll)}/mês · receita ${formatWorkforceCurrency(currentRevenue)}/mês`
            : 'Dados demonstrativos — importe folha e AR para projeções reais'}
        </p>
        {!hasRealData && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-ig-warning/10 text-ig-warning border border-ig-warning/20 shrink-0">demo</span>
        )}
      </div>

      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Salário base */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-ig-fg-muted" />
              <span className="text-xs text-ig-fg-default">Salário bruto</span>
            </div>
            <span className="text-xs font-semibold text-ig-fg-strong ig-tabular">
              {formatWorkforceCurrency(baseSalary)}
            </span>
          </div>
          <Slider value={[baseSalary]} onValueChange={handleBaseChange} min={1500} max={50000} step={500} />
          <div className="flex justify-between text-[10px] text-ig-fg-subtle">
            <span>R$ 1,5K</span>
            <span>R$ 50K</span>
          </div>
        </div>

        {/* Encargos % */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5 text-ig-fg-muted" />
              <span className="text-xs text-ig-fg-default">Encargos s/ salário</span>
            </div>
            <span className="text-xs font-semibold text-ig-fg-strong ig-tabular">{encargosPct}%</span>
          </div>
          <Slider value={[encargosPct]} onValueChange={handleEncargosChange} min={30} max={120} step={1} />
          <div className="flex justify-between text-[10px] text-ig-fg-subtle">
            <span>30% (PJ)</span>
            <span>~70% (CLT típico)</span>
            <span>120%</span>
          </div>
        </div>

        {/* Contratações */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-ig-fg-muted" />
              <span className="text-xs text-ig-fg-default">Contratações</span>
            </div>
            <span className="text-xs font-semibold text-ig-fg-strong ig-tabular">
              {hires} {hires === 1 ? 'pessoa' : 'pessoas'}
            </span>
          </div>
          <Slider value={[hires]} onValueChange={handleHiresChange} min={1} max={50} step={1} />
          <div className="flex justify-between text-[10px] text-ig-fg-subtle">
            <span>1</span>
            {currentHeadcount > 0 && (
              <span className="text-ig-fg-muted">{currentHeadcount} → {sim.newHeadcount}</span>
            )}
            <span>50</span>
          </div>
        </div>
      </div>

      {/* Cost decomposition chip */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-ig-panel border border-ig-border-subtle text-xs">
        <span className="text-ig-fg-muted">Custo total / contratação:</span>
        <span className="font-bold text-ig-fg-strong ig-tabular">{formatWorkforceCurrency(totalCostPerHire)}</span>
        <span className="text-ig-fg-subtle">=</span>
        <span className="text-ig-fg-muted">salário {formatWorkforceCurrency(baseSalary)}</span>
        <span className="text-ig-fg-subtle">+</span>
        <span className="text-ig-fg-muted">encargos {formatWorkforceCurrency(totalCostPerHire - baseSalary)} ({encargosPct}%)</span>
        <details className="ml-auto cursor-pointer">
          <summary className="text-[10px] text-ig-fg-subtle hover:text-ig-fg-muted list-none">ver composição ↓</summary>
          <div className="absolute z-10 mt-1 p-2.5 rounded-xl bg-ig-panel border border-ig-border-subtle shadow-lg min-w-[200px]">
            {ENCARGOS_BREAKDOWN.map((e) => (
              <div key={e.label} className="flex justify-between gap-4 text-[10px] py-0.5">
                <span className="text-ig-fg-muted">{e.label}</span>
                <span className="text-ig-fg-strong ig-tabular">{e.pct.toFixed(2)}%</span>
              </div>
            ))}
            <div className="border-t border-ig-border-subtle mt-1 pt-1 flex justify-between text-[10px] font-semibold">
              <span className="text-ig-fg-default">Total típico CLT</span>
              <span className="text-ig-fg-strong ig-tabular">70%</span>
            </div>
          </div>
        </details>
      </div>

      {/* ── Hero: Faturamento necessário ────────────────────────────────── */}
      <div className="rounded-2xl border bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-accent)_9%,transparent),transparent)] border-ig-border-focus/50 p-4">
        <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted mb-2">
          Para contratar {hires} {hires === 1 ? 'pessoa' : 'pessoas'} ({formatWorkforceCurrency(totalCostPerHire)}/func.), a empresa precisa faturar a mais:
        </p>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <p className="text-4xl font-bold ig-tabular text-ig-accent leading-none">
              + {formatWorkforceCurrency(sim.revenueNeededForHires)}
            </p>
            <p className="text-xs text-ig-fg-muted mt-1.5">
              /mês · para manter Folha/Receita ≤ {payrollRevenueThreshold}%
            </p>
          </div>
          {/* Folha/Receita badge — só com dados reais */}
          {hasRealData && (
            <div className={cn(
              'ml-auto shrink-0 flex flex-col items-center p-2.5 rounded-xl border',
              sim.exceedsThreshold ? 'bg-ig-danger/10 border-ig-danger/20' : 'bg-ig-success/10 border-ig-success/20',
            )}>
              <p className="text-[10px] text-ig-fg-muted">Folha/Rec. projetada</p>
              <p className={cn('text-xl font-bold ig-tabular', sim.exceedsThreshold ? 'text-ig-danger' : sim.nearThreshold ? 'text-ig-warning' : 'text-ig-success')}>
                {sim.projectedRatio.toFixed(1)}%
              </p>
              <p className={cn('text-[10px] font-semibold', sim.ratioDelta > 0 ? 'text-ig-danger' : 'text-ig-success')}>
                {sim.ratioDelta > 0 ? '+' : ''}{sim.ratioDelta.toFixed(1)} p.p.
              </p>
              <p className="text-[10px] text-ig-fg-subtle">atual: {sim.currentRatio.toFixed(1)}%</p>
            </div>
          )}
        </div>
        {/* Se tiver dados reais e exceder o limite: mostrar o gap real */}
        {hasRealData && sim.revenueCurrentGap > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-ig-danger shrink-0" />
            <span className="text-ig-fg-muted">
              Com a receita atual, ainda faltam{' '}
              <span className="font-semibold text-ig-danger">{formatWorkforceCurrency(sim.revenueCurrentGap)}</span>
              {' '}para a folha total (incluindo estas contratações) caber no limite de {payrollRevenueThreshold}%.
            </span>
          </div>
        )}
        {hasRealData && !sim.exceedsThreshold && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <CheckCircle className="w-3.5 h-3.5 text-ig-success shrink-0" />
            <span className="text-ig-fg-muted">
              Com a receita atual de{' '}
              <span className="font-semibold text-ig-fg-strong">{formatWorkforceCurrency(currentRevenue)}</span>
              {', '}a empresa suporta estas contratações dentro do limite.
            </span>
          </div>
        )}
      </div>

      {/* ── Impact grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-ig-panel border border-ig-border-subtle">
          <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted mb-1">Custo total / func.</p>
          <p className="text-base font-bold text-ig-fg-strong ig-tabular">{formatWorkforceCurrency(totalCostPerHire)}</p>
          <p className="text-[10px] text-ig-fg-subtle">base + {encargosPct}% enc.</p>
        </div>
        <div className="p-3 rounded-xl bg-ig-panel border border-ig-border-subtle">
          <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted mb-1">Custo adicional total</p>
          <p className="text-base font-bold text-ig-fg-strong ig-tabular">{formatWorkforceCurrency(sim.additionalCost)}</p>
          <p className="text-[10px] text-ig-fg-subtle">{hires} × {formatWorkforceCurrency(totalCostPerHire)}</p>
        </div>
        <div className="p-3 rounded-xl bg-ig-panel border border-ig-border-subtle">
          <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted mb-1">Nova folha total</p>
          <p className="text-base font-bold text-ig-fg-strong ig-tabular">{formatWorkforceCurrency(sim.newPayroll)}</p>
          <p className="text-[10px] text-ig-fg-subtle">{sim.newHeadcount} pessoas</p>
        </div>
        <div className="p-3 rounded-xl bg-ig-panel border border-ig-border-subtle">
          <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted mb-1">Folha/Rec. atual</p>
          <p className={cn('text-base font-bold ig-tabular', sim.currentRatio > payrollRevenueThreshold ? 'text-ig-danger' : 'text-ig-success')}>
            {hasRealData ? `${sim.currentRatio.toFixed(1)}%` : '–'}
          </p>
          <p className="text-[10px] text-ig-fg-subtle">limite: {payrollRevenueThreshold}%</p>
        </div>
      </div>

      {/* ── Break-even por cenário ────────────────────────────────────────── */}
      <Tabs value={activeScenario} onValueChange={(v) => setActiveScenario(v as Scenario)}>
        <TabsList className="w-full bg-ig-panel border border-ig-border-subtle">
          {(Object.entries(SCENARIO_CONFIGS) as [Scenario, typeof SCENARIO_CONFIGS[Scenario]][]).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <TabsTrigger key={key} value={key} className="flex-1 data-[state=active]:bg-ig-panel-hover">
                <Icon className="w-3.5 h-3.5 mr-1.5" />
                <span className="hidden sm:inline">{cfg.label}</span>
                <span className="sm:hidden">{cfg.label.slice(0, 4)}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(Object.entries(SCENARIO_CONFIGS) as [Scenario, typeof SCENARIO_CONFIGS[Scenario]][]).map(([key, cfg]) => {
          const be = sim.breakEvens[key];
          const Icon = cfg.icon;
          return (
            <TabsContent key={key} value={key} className="mt-3">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${key}-${hires}-${totalCostPerHire}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="flex items-center gap-4 p-3 rounded-xl bg-ig-panel border border-ig-border-subtle"
                >
                  <div className="p-2 rounded-lg bg-ig-panel-hover shrink-0">
                    <Icon className={cn('w-4 h-4', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ig-fg-default">{cfg.desc}</p>
                    <p className="text-[11px] text-ig-fg-muted">
                      Faturamento absorve o custo incremental em{' '}
                      <span className={cn('font-semibold', cfg.color)}>
                        {be < 36 ? `${be} ${be === 1 ? 'mês' : 'meses'}` : '36+ meses'}
                      </span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('text-2xl font-bold ig-tabular leading-none', cfg.color)}>
                      {be < 36 ? be : '36+'}
                    </p>
                    <p className="text-[10px] text-ig-fg-muted">meses</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Board summary */}
      <div className={cn(
        'p-3.5 rounded-xl border flex items-start gap-3',
        sim.exceedsThreshold ? 'bg-ig-danger/5 border-ig-danger/20' : 'bg-ig-info/5 border-ig-info/20',
      )}>
        {sim.exceedsThreshold
          ? <AlertTriangle className="w-4 h-4 text-ig-danger mt-0.5 shrink-0" />
          : <CheckCircle   className="w-4 h-4 text-ig-info   mt-0.5 shrink-0" />
        }
        <div className="min-w-0">
          <p className={cn('text-[10px] font-semibold uppercase tracking-wider mb-1', sim.exceedsThreshold ? 'text-ig-danger' : 'text-ig-info')}>
            Resumo para o Board
          </p>
          <p className="text-xs leading-relaxed text-ig-fg-default">{boardSummary}</p>
        </div>
      </div>

      {/* Context chips */}
      {hasRealData && (
        <div className="flex flex-wrap gap-2">
          {[
            { icon: TrendingUp, label: 'Custo médio real',      value: formatWorkforceCurrency(initialAvgCost) },
            { icon: Target,     label: 'Limite Folha/Rec.',     value: `${payrollRevenueThreshold}%` },
            { icon: Users,      label: 'Headcount projetado',   value: `${sim.newHeadcount} pessoas` },
            { icon: UserPlus,   label: 'Encargos s/ salário',   value: `${encargosPct}%` },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ig-panel border border-ig-border-subtle text-xs">
                <Icon className="w-3 h-3 text-ig-fg-muted" />
                <span className="text-ig-fg-muted">{c.label}:</span>
                <span className="font-semibold text-ig-fg-strong">{c.value}</span>
              </div>
            );
          })}
        </div>
      )}
    </OrionCard>
  );
}
