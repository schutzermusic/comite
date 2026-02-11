'use client';

import React, { useMemo } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  FileText,
  Vote,
  Shield,
  BarChart3,
  Calendar,
  Briefcase,
  Target,
  Zap,
} from 'lucide-react';

// Orion components
import { OrionCard, KpiCard, DecisionQueue } from '@/components/orion';
import { GovernanceHealthCard, RiskOrbitalCard } from '@/components/three';
import { FinancialPulse } from '@/components/dashboard/FinancialPulse';
import { GlobeSlot } from '@/components/dashboard/GlobeSlot';

// Sci-Fi Dashboard Components
import { ThreatMonitor, ConsensusEngine } from '@/components/dashboard/futuristic';

// Workforce Intelligence components (Signal card for dashboard)
import { WorkforceSignalCard } from '@/components/workforce';

// Motion components
import { HoverCard, ContainerHoverCard } from '@/components/motion';

// ECharts components (upgraded from Nivo)
import {
  VotingStatusDonut,
  KpiSparkline,
  RiskHeatRing as RiskHeatRingECharts,
  ComplianceGauge,
  DecisionVelocityLine,
  DecisionVelocityMini,
  EngagementMini,
  DocumentsMini,
  AuditReadyMini,
  PortfolioValueTrend,
} from '@/components/charts/echarts';

// Background system
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';

// Data layer
import {
  getMockDashboardData,
  formatCurrency,
  type DashboardPayload,
  type DecisionItem,
} from '@/lib/dashboard-data';

export default function ExecutiveDashboard() {
  // In production, this would be fetched from an API
  const data = useMemo<DashboardPayload>(() => getMockDashboardData(), []);

  // Transform decision queue items
  const queueItems = data.decisionQueue.map((item: DecisionItem) => ({
    ...item,
    onOpenPackage: () => console.log('Open package', item.id),
    onViewMinutes: () => console.log('View minutes', item.id),
    onStartVote: item.type === 'vote' ? () => console.log('Start vote', item.id) : undefined,
  }));

  // Prepare sparkline data for KPI cards
  const engagementSparkline = data.performanceMetrics.sparklineData?.engagement || [85, 87, 84, 88, 86, 89, 87];
  const velocitySparkline = [4.5, 4.3, 4.4, 4.1, 4.2, 4.0, 4.2];
  const boardHealthSparkline = data.healthMetrics.sparklineData?.boardHealth || [82, 83, 84, 84, 85, 85, 85];
  const packageReadinessSparkline = data.healthMetrics.sparklineData?.packageReadiness || [88, 89, 90, 91, 91, 92, 92];
  const decisionsOpenSparkline = data.healthMetrics.sparklineData?.decisionsOpen || [12, 11, 10, 9, 9, 8, 8];
  const realizedValueSparkline = data.portfolioMetrics
    ? [170, 172, 175, 178, 179, 181, 182].map(v => v * 1000000) // Generate trend data in millions
    : [];
  // Sparkline for votes (last 7 days of pending votes)
  const votesSparkline = [5, 4, 6, 3, 4, 2, data.votingStatus.endingIn72h];

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">
                Sala de Controle Executivo
              </h1>
              <p className="text-sm text-orion-text-tertiary">
                Visão Geral de Governança e Desempenho • {data.cycleSummary.currentCycle}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-orion-text-muted">Última atualização</p>
                <p className="text-sm text-orion-text-secondary">
                  {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="w-px h-10 bg-orion-border-DEFAULT" />
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-glass-light">
                <div className="w-2 h-2 rounded-full bg-semantic-success-DEFAULT animate-pulse" />
                <span className="text-xs text-orion-text-secondary">Ao Vivo</span>
              </div>
            </div>
          </div>
        </header>

        {/* Top KPI Band - CEO Enterprise View */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {/* Active Portfolio Value */}
          {data.portfolioMetrics && (
            <KpiCard
              label="Portfólio Ativo"
              value={formatCurrency(data.portfolioMetrics.activeValue, data.portfolioMetrics.currency)}
              icon={Briefcase}
              status="neutral"
              trend={{
                value: data.portfolioMetrics.activeValueDelta,
                label: 'este mês'
              }}
              sparkline={
                <KpiSparkline
                  data={data.portfolioMetrics.activeValueTrend}
                  height={32}
                  width={100}
                  color="primary"
                />
              }
              size="sm"
            />
          )}

          {/* Realized Value */}
          {data.portfolioMetrics && (
            <KpiCard
              label="Valor Realizado"
              value={formatCurrency(data.portfolioMetrics.realizedValue, data.portfolioMetrics.currency)}
              icon={TrendingUp}
              status="success"
              trend={{
                value: data.portfolioMetrics.realizedValueTrend,
                label: 'vs período anterior'
              }}
              sparkline={
                <KpiSparkline
                  data={realizedValueSparkline}
                  height={32}
                  width={100}
                  color="success"
                />
              }
              size="sm"
            />
          )}

          {/* Decisions Open */}
          <KpiCard
            label="Decisões Abertas"
            value={data.cycleSummary.decisionsRequired - data.cycleSummary.decisionsCompleted}
            subtitle={`${data.cycleSummary.decisionsCompleted} de ${data.cycleSummary.decisionsRequired} concluídas`}
            icon={CheckCircle}
            status="neutral"
            sparkline={
              <KpiSparkline
                data={decisionsOpenSparkline}
                height={32}
                width={100}
                color="secondary"
              />
            }
            size="sm"
          />

          {/* Votes Ending Soon */}
          <KpiCard
            label="Votos em 72h"
            value={data.votingStatus.endingIn72h}
            subtitle={`${data.votingStatus.pending} pendentes`}
            icon={Vote}
            status={data.votingStatus.endingIn72h > 2 ? 'warning' : 'success'}
            sparkline={
              <KpiSparkline
                data={votesSparkline}
                height={32}
                width={100}
                color={data.votingStatus.endingIn72h > 2 ? 'warning' : 'success'}
              />
            }
            size="sm"
          />
        </section>

        {/* ================================================================
            FINANCE ROW - 2 Column Layout
            Left: Saúde Financeira panel
            Right: Interactive Globe Slot
            Globe is contained ONLY in this slot, not polluting other areas
            ================================================================ */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Left Column: Saúde Financeira */}
          {data.financialPulse && (
            <FinancialPulse data={data.financialPulse} />
          )}
          
          {/* Right Column: Globe Slot - Interactive operational presence */}
          <GlobeSlot 
            minHeight={420} 
            className="hidden lg:block"
          />
        </section>

        {/* Workforce Signal Card - SINALIZA (compact for dashboard) - Full width integration */}
        {data.workforceData && (
          <section className="mb-8">
            <WorkforceSignalCard
              status={data.workforceData.payrollRisk.status}
              payrollRevenuePercent={data.workforceData.metrics.payrollAsRevenuePercent.value}
              threshold={data.workforceData.metrics.payrollAsRevenuePercent.threshold}
              abnormalCenters={data.workforceData.costConcentration.costCenters.filter(c => c.isAbnormal).length}
              sparkline={data.workforceData.metrics.monthlyPayroll.sparkline}
              riskScore={data.workforceData.payrollRisk.riskScore}
            />
          </section>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content (2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Risk & Voting Row - Sci-Fi Visualizations (PRIORITY) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Threat Monitor - Replaces Risk Radar */}
              <ThreatMonitor
                className="w-full max-w-none"
                risks={[
                  ...data.riskSummary.categories
                    .filter(c => c.name === 'Compliance')
                    .slice(0, 2)
                    .map((_, i) => ({
                      id: `critical-${i}`,
                      title: i === 0 ? 'Falha no Compliance' : 'Contrato Vencendo',
                      description: i === 0 ? 'Política de conformidade desatualizada' : 'Contrato fornecedor expira em 7 dias',
                      level: 'critical' as const,
                      angle: 45 + i * 135,
                      category: 'Compliance',
                    })),
                  { id: 'high-1', title: 'Auditoria Pendente', description: 'Auditoria interna atrasada 15 dias', level: 'high' as const, angle: 90, category: 'Auditoria' },
                  { id: 'high-2', title: 'KPI Abaixo Meta', description: 'Indicador de eficiência operacional', level: 'high' as const, angle: 220, category: 'Performance' },
                  { id: 'medium-1', title: 'Atualização Sistema', description: 'Patch de segurança disponível', level: 'medium' as const, angle: 300, category: 'TI' },
                  { id: 'medium-2', title: 'Treinamento Vencido', description: '3 colaboradores com certificação vencida', level: 'medium' as const, angle: 135, category: 'RH' },
                  { id: 'low-1', title: 'Revisão Orçamento', description: 'Revisão trimestral agendada', level: 'low' as const, angle: 270, category: 'Financeiro' },
                  { id: 'low-2', title: 'Manutenção Preventiva', description: 'Equipamentos setor B', level: 'low' as const, angle: 15, category: 'Operações' },
                ]}
              />

              {/* Consensus Engine - Replaces Voting Status */}
              <ConsensusEngine
                className="w-full max-w-none"
                title="Status das Votações"
                data={{
                  total: data.votingStatus.approved + data.votingStatus.rejected + data.votingStatus.pending,
                  approved: data.votingStatus.approved,
                  rejected: data.votingStatus.rejected,
                  pending: data.votingStatus.pending,
                  approvalPercentage: data.votingStatus.averageParticipation,
                }}
              />
            </div>

            {/* Decision Queue */}
            <ContainerHoverCard lightSweep>
              <OrionCard variant="default">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-white orion-text-heading">Fila de Decisões</h2>
                    <p className="text-sm text-orion-text-muted">Itens que requerem atenção executiva</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-white">{queueItems.length}</span>
                    <span className="text-sm text-orion-text-muted">pendentes</span>
                  </div>
                </div>
                <DecisionQueue
                  items={queueItems}
                  title=""
                  emptyMessage="Todas as decisões processadas"
                />
              </OrionCard>
            </ContainerHoverCard>

            {/* Governance Cycle Status - Moved to last position */}
            <ContainerHoverCard lightSweep>
              <OrionCard variant="default">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-white orion-text-heading">Ciclo de Governança</h2>
                    <p className="text-sm text-orion-text-muted">Progresso {data.cycleSummary.currentCycle}</p>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-semantic-info-DEFAULT/10">
                    <Calendar className="w-4 h-4 text-semantic-info-DEFAULT" />
                    <span className="text-sm font-medium text-semantic-info-DEFAULT">
                      {data.cycleSummary.daysRemaining} dias restantes
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-orion-text-secondary">Conclusão do Ciclo</span>
                    <span className="text-sm font-semibold text-white">{data.cycleSummary.completionRate}%</span>
                  </div>
                  <div className="h-2 bg-orion-bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-semantic-info-DEFAULT to-semantic-success-DEFAULT rounded-full transition-all duration-500"
                      style={{ width: `${data.cycleSummary.completionRate}%` }}
                    />
                  </div>
                </div>

                {/* Cycle stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-orion-text-muted" />
                      <span className="text-xs text-orion-text-muted">Reuniões</span>
                    </div>
                    <p className="text-lg font-semibold text-white">
                      {data.cycleSummary.meetingsHeld}/{data.cycleSummary.meetingsScheduled}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-orion-text-muted" />
                      <span className="text-xs text-orion-text-muted">Decisões</span>
                    </div>
                    <p className="text-lg font-semibold text-white">
                      {data.cycleSummary.decisionsCompleted}/{data.cycleSummary.decisionsRequired}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-orion-text-muted" />
                      <span className="text-xs text-orion-text-muted">Tempo Médio</span>
                    </div>
                    <p className="text-lg font-semibold text-white">
                      {data.healthMetrics.decisionVelocity}d
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-orion-text-muted" />
                      <span className="text-xs text-orion-text-muted">Conformidade</span>
                    </div>
                    <p className="text-lg font-semibold text-white">
                      {data.healthMetrics.complianceScore}%
                    </p>
                  </div>
                </div>
              </OrionCard>
            </ContainerHoverCard>
          </div>

          {/* Right Rail - Performance & Trust */}
          <div className="space-y-6">
            {/* Governance Health Ring - 3D WebGL with 2D fallback */}
            <GovernanceHealthCard
              value={data.healthMetrics.overallHealth}
              trend={data.healthMetrics.trend}
            />

            {/* Performance Metrics */}
            <HoverCard preset="card" lightSweep>
              <OrionCard variant="default">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 orion-text-heading">
                  Desempenho e Confiança
                </h3>

                <div className="space-y-4">
                  {/* Decision Velocity */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-3">
                      <Zap className="w-5 h-5 text-cyan-400" />
                      <div>
                        <p className="text-sm font-medium text-white">Velocidade de Decisão</p>
                        <p className="text-xs text-orion-text-muted">Tempo médio para decisão</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <DecisionVelocityMini
                        data={velocitySparkline}
                        height={40}
                        width={80}
                      />
                      <div className="text-right">
                        <p className="text-lg font-bold text-white">{data.performanceMetrics.avgDecisionTime}d</p>
                        <p className={`text-xs ${data.performanceMetrics.avgDecisionTimeTrend < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.performanceMetrics.avgDecisionTimeTrend > 0 ? '+' : ''}{data.performanceMetrics.avgDecisionTimeTrend}%
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Member Engagement */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium text-white">Engajamento</p>
                        <p className="text-xs text-orion-text-muted">Participação dos membros</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <EngagementMini
                        data={engagementSparkline}
                        height={40}
                        width={80}
                      />
                      <p className="text-lg font-bold text-white">{data.performanceMetrics.memberEngagement}%</p>
                    </div>
                  </div>

                  {/* Document Completeness */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-white">Documentos</p>
                        <p className="text-xs text-orion-text-muted">Taxa de completude</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <DocumentsMini
                        value={data.performanceMetrics.documentCompleteness}
                        height={40}
                        width={80}
                      />
                      <p className="text-lg font-bold text-white">{data.performanceMetrics.documentCompleteness}%</p>
                    </div>
                  </div>

                  {/* Audit Readiness */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-orion-bg-elevated/50">
                    <div className="flex items-center gap-3">
                      <Shield className="w-5 h-5 text-amber-400" />
                      <div>
                        <p className="text-sm font-medium text-white">Pronto p/ Auditoria</p>
                        <p className="text-xs text-orion-text-muted">Score de conformidade</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <AuditReadyMini
                        value={data.performanceMetrics.auditReadiness}
                        height={40}
                        width={80}
                      />
                      <p className="text-lg font-bold text-white">{data.performanceMetrics.auditReadiness}%</p>
                    </div>
                  </div>
                </div>
              </OrionCard>
            </HoverCard>

            {/* Financial Overview */}
            {data.financialOverview && (
              <HoverCard preset="card" lightSweep>
                <OrionCard variant="default" glowColor="success">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-white uppercase tracking-wider orion-text-heading">
                      Valor do Portfólio
                    </h3>
                    <Briefcase className="w-4 h-4 text-emerald-400" />
                  </div>

                  <p className="text-3xl font-bold mb-1 orion-kpi-number">
                    {formatCurrency(data.financialOverview.portfolioValue, data.financialOverview.currency)}
                  </p>

                  <div className="flex items-center gap-4 mb-4">
                    <span className={`text-sm ${data.financialOverview.monthlyChange >= 0 ? 'text-semantic-success-DEFAULT' : 'text-semantic-error-DEFAULT'}`}>
                      {data.financialOverview.monthlyChange >= 0 ? '+' : ''}{data.financialOverview.monthlyChange}% este mês
                    </span>
                  </div>

                  {/* Portfolio Trend Chart */}
                  {data.financialOverview.trendData && data.financialOverview.trendData.length > 0 && (
                    <div className="mb-4">
                      <PortfolioValueTrend
                        data={data.financialOverview.trendData}
                        height={60}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-orion-border-subtle">
                    <div>
                      <p className="text-xs text-orion-text-muted mb-1">Projetos</p>
                      <p className="text-lg font-semibold text-white">{data.financialOverview.projectsUnderGovernance}</p>
                    </div>
                    <div>
                      <p className="text-xs text-orion-text-muted mb-1">Orçamento Usado</p>
                      <p className="text-lg font-semibold text-white">{data.financialOverview.budgetUtilization}%</p>
                    </div>
                  </div>
                </OrionCard>
              </HoverCard>
            )}

            {/* Quick Cycle Summary */}
            <OrionCard variant="glass" className="text-center">
              <p className="text-xs text-orion-text-muted mb-2">Resumo do Ciclo</p>
              <p className="text-sm text-orion-text-secondary leading-relaxed">
                <span className="text-white font-semibold">{data.cycleSummary.decisionsCompleted}</span> decisões tomadas de{' '}
                <span className="text-white font-semibold">{data.cycleSummary.decisionsRequired}</span> necessárias.{' '}
                <span className="text-emerald-400">{data.cycleSummary.daysRemaining} dias</span> restantes no ciclo.
              </p>
            </OrionCard>
          </div>
        </div>
      </div>
    </OrionGreenBackground>
  );
}
