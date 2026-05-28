'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, BrainCircuit } from 'lucide-react';
import { HudPageLayout, HudHeader, HudButton } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { triggerFinanceAiScan } from '@/lib/services/risks';
import {
  computeTopDrivers,
  getPendingActionCount,
} from '@/lib/finance/finance-store';
import { FinanceControlBar } from './FinanceControlBar';
import { FinancialHealthHero } from './FinancialHealthHero';
import { DreIntelligenceBridge } from './DreIntelligenceBridge';
import { AiFinancialAnalyst } from './AiFinancialAnalyst';
import { ForecastScenarioChart } from './ForecastScenarioChart';
import { ProjectMarginMatrix } from './ProjectMarginMatrix';
import { CostCenterHeatmap } from './CostCenterHeatmap';
import { ContractRevenuePanel } from './ContractRevenuePanel';
import { ManagerialDreTable } from './ManagerialDreTable';
import { TopVariationsPanel } from './TopVariationsPanel';
import { ExecutiveDecisionQueue } from './ExecutiveDecisionQueue';
import { FinancialRiskRadar } from './FinancialRiskRadar';
import {
  AI_INSIGHTS,
  CONTRACTS,
  COST_HEATMAP,
  DECISION_QUEUE,
  FINANCIAL_RISKS,
  FORECAST_TIMESERIES,
  PROJECT_MARGINS,
  buildManagerialDre,
} from './mock-data';
import { SCENARIOS, type ControlRoomFilters } from './types';
import { periodLabel } from './helpers';

const PROJECTS = [
  { id: 'proj-1', label: 'FPSO P-80' },
  { id: 'proj-2', label: 'FPSO Mero' },
  { id: 'proj-3', label: 'Bacalhau Submarina' },
  { id: 'proj-4', label: 'Búzios Inspeção' },
  { id: 'proj-5', label: 'Mero Topside' },
  { id: 'proj-6', label: 'Sépia Operação' },
];

const CONTRACTS_OPTIONS = CONTRACTS.map((c) => ({ id: c.id, label: c.name }));

const COST_CENTERS = [
  { id: 'cc-eng-campo', label: 'Engenharia de Campo' },
  { id: 'cc-mob', label: 'Mobilização' },
  { id: 'cc-logistica', label: 'Logística' },
  { id: 'cc-ti', label: 'TI' },
  { id: 'cc-financeiro', label: 'Financeiro' },
  { id: 'cc-admin-sp', label: 'Adm. SP' },
];

export function FinanceControlRoom() {
  const [filters, setFilters] = useState<ControlRoomFilters>({
    periodFrom: '2026-01',
    periodTo: '2026-03',
    scenario: 'actual',
    projectId: 'all',
    contractId: 'all',
    costCenterId: 'all',
    consolidation: 'consolidated',
  });

  const updateFilters = useCallback((next: Partial<ControlRoomFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const dreRows = useMemo(() => buildManagerialDre(filters.scenario), [filters.scenario]);

  const topDrivers = useMemo(
    () => computeTopDrivers(filters.periodFrom, filters.periodTo, 6),
    [filters.periodFrom, filters.periodTo],
  );

  const pendingCount = useMemo(() => getPendingActionCount(), []);

  const scenario = SCENARIOS.find((s) => s.key === filters.scenario) ?? SCENARIOS[0];

  // Hero metrics derived from DRE
  const netRevenue = dreRows.find((r) => r.key === 'net_revenue')?.actual ?? 0;
  const ebitda = dreRows.find((r) => r.key === 'ebitda')?.actual ?? 0;
  const ebitdaMargin = netRevenue !== 0 ? (ebitda / netRevenue) * 100 : 0;
  const operating = dreRows.find((r) => r.key === 'gross_margin')?.actual ?? 0;
  const forecastEbitda = dreRows.find((r) => r.key === 'ebitda')?.forecast ?? 0;
  const forecastGap = forecastEbitda - (dreRows.find((r) => r.key === 'ebitda')?.budget ?? 0);
  const cashRisk = -92_000_000;

  const periodRangeLabel = `${periodLabel(filters.periodFrom)} → ${periodLabel(filters.periodTo)}`;

  const { hasPermission } = usePermissions();
  const canScanAi = hasPermission('risks.ai_scan');
  const [scanningAi, setScanningAi] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const handleAiScan = async () => {
    if (
      !window.confirm(
        `Disparar analise de risco com IA sobre lancamentos financeiros (${periodRangeLabel})? Pode levar ate 1 minuto e consome tokens.`,
      )
    )
      return;
    setScanningAi(true);
    setAiNotice(null);
    try {
      const { count, scanned, skipped } = await triggerFinanceAiScan({
        periodFrom: filters.periodFrom,
        periodTo: filters.periodTo,
      });
      setAiNotice(
        `Analise IA: ${count} risco(s) gerado(s) a partir de ${scanned} lancamento(s)` +
          (skipped ? ` · ${skipped} duplicado(s) ignorado(s)` : '') +
          '. Veja em /riscos (aba Alertas IA).',
      );
    } catch (err) {
      setAiNotice(err instanceof Error ? err.message : 'Erro na analise IA financeira.');
    } finally {
      setScanningAi(false);
    }
  };

  return (
    <HudPageLayout maxWidth="2xl">
      <HudHeader
        title="Financeiro"
        subtitle="Sala Financeira Executiva — DRE, Forecast e Performance por Projeto"
        icon={<Activity className="h-5 w-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: 'Financeiro' }]}
        statusChips={[
          { label: scenario.label, variant: 'info' },
          { label: periodRangeLabel, variant: 'neutral' },
          { label: `${pendingCount} pendentes`, variant: pendingCount > 0 ? 'warning' : 'success' },
        ]}
        actions={
          canScanAi ? (
            <HudButton
              variant="glass"
              size="md"
              leftIcon={<BrainCircuit className="h-4 w-4" />}
              disabled={scanningAi}
              onClick={handleAiScan}
            >
              {scanningAi ? 'Analisando...' : 'Analisar com IA'}
            </HudButton>
          ) : undefined
        }
      />
      {aiNotice && (
        <div className="rounded-lg border border-ig-accent-weak bg-ig-accent-weak/30 px-4 py-2 text-[12px] text-ig-fg-default">
          {aiNotice}
        </div>
      )}

      <FinanceControlBar
        filters={filters}
        onChange={updateFilters}
        projects={PROJECTS}
        contracts={CONTRACTS_OPTIONS}
        costCenters={COST_CENTERS}
      />

      <FinancialHealthHero
        healthScore={78}
        netRevenue={netRevenue}
        ebitda={ebitda}
        ebitdaMargin={ebitdaMargin}
        operatingResult={operating}
        forecastGap={forecastGap}
        cashRisk={cashRisk}
        pendingActions={pendingCount + DECISION_QUEUE.length}
        periodLabel={periodRangeLabel}
        scenarioLabel={scenario.label}
      />

      {/* Main Control Grid */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:h-[480px] lg:grid-cols-12 lg:overflow-hidden xl:h-[520px]">
        <div className="flex min-w-0 w-full lg:col-span-8 lg:h-full lg:overflow-hidden">
          <DreIntelligenceBridge rows={dreRows} scenarioLabel={scenario.label} />
        </div>
        <div className="flex min-w-0 w-full lg:col-span-4 lg:h-full lg:overflow-hidden">
          <AiFinancialAnalyst
            insights={AI_INSIGHTS}
            approvalQueue={DECISION_QUEUE}
          />
        </div>
      </div>

      {/* Secondary Analytics */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 w-full lg:col-span-7">
          <ForecastScenarioChart data={FORECAST_TIMESERIES} />
        </div>
        <div className="flex min-w-0 w-full lg:col-span-5">
          <ProjectMarginMatrix rows={PROJECT_MARGINS} />
        </div>
      </div>

      {/* Tertiary Layer */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 w-full lg:col-span-7">
          <CostCenterHeatmap data={COST_HEATMAP} />
        </div>
        <div className="flex min-w-0 w-full lg:col-span-5">
          <ContractRevenuePanel contracts={CONTRACTS} />
        </div>
      </div>

      {/* Managerial DRE Table */}
      <ManagerialDreTable rows={dreRows} />

      {/* Decision Intelligence Layer */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 w-full lg:col-span-4">
          <TopVariationsPanel drivers={topDrivers} />
        </div>
        <div className="flex min-w-0 w-full lg:col-span-4">
          <ExecutiveDecisionQueue items={DECISION_QUEUE} />
        </div>
        <div className="flex min-w-0 w-full lg:col-span-4">
          <FinancialRiskRadar risks={FINANCIAL_RISKS} />
        </div>
      </div>
    </HudPageLayout>
  );
}
