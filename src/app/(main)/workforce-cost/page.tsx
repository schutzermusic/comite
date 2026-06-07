'use client';

import { useMemo, useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Download,
  Share2,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Users,
  DatabaseZap,
  FileSpreadsheet,
  ArrowRight,
  Zap,
  Building2,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { hasAnyPermission, hasPermission } from '@/lib/auth/permissions';

import {
  WorkforceOverviewCards,
  CostConcentrationPanel,
  WorkforceTrendChart,
  CostCenterDrilldown,
  HiringSimulatorExpanded,
  PayrollRiskIndicator,
  WorkforcePeriodFilter,
  PayrollEvolutionPanel,
  HeadcountDynamicsPanel,
  WorkforceCompositionPanel,
  WorkforceEfficiencyPanel,
  CollapsibleDetailPanel,
} from '@/components/workforce';

import { RiskStatus } from '@/lib/workforce-data';
import {
  selectWorkforceViewWithClosings,
  selectPayrollComposition,
  selectPayrollSCurve,
  selectPayrollVsRevenue,
  selectBenefitsByType,
  selectAdmissionsVsDismissals,
  selectTurnoverTrend,
  selectAbsenteeismByArea,
  selectOvertimeTrend,
  selectWorkforceEfficiency,
  buildEffectiveSeries,
  enrichSeriesWithRevenue,
  DEFAULT_WORKFORCE_PERIOD,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';
import { repositoryMode } from '@/lib/payroll/closing-client';
import type { PayrollClosingBatchApproved } from '@/lib/types/payroll-closing';
import { openWorkforceReport } from '@/lib/workforce/export-report';
import { getAPARTitles } from '@/lib/finance/finance-store';
import { selectMonthlyRevenue } from '@/lib/finance/selectors/apar';

import {
  HudPageLayout,
  HudHeader,
  HudButton,
} from '@/components/hud';
import { getEsocialDashboardData } from '@/lib/esocial';
import { cn } from '@/lib/utils';

// ─── helpers ────────────────────────────────────────────────────────────────

const statusConfig: Record<RiskStatus, {
  icon: typeof CheckCircle;
  label: string;
  variant: 'active' | 'warning' | 'error';
}> = {
  healthy: { icon: CheckCircle, label: 'Saudável', variant: 'active' },
  attention: { icon: AlertTriangle, label: 'Atenção', variant: 'warning' },
  risk: { icon: AlertCircle, label: 'Risco', variant: 'error' },
};

const PAYROLL_PERMS = ['people.payroll_close', 'people.payroll_send', 'people.payroll_send_sensitive'];

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-1 h-5 rounded-full bg-ig-accent/70 shrink-0" />
      <div>
        <h2 className="text-sm font-semibold text-ig-fg-strong tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-ig-fg-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Compact signal strip ────────────────────────────────────────────────────

interface WorkforceSignalStripProps {
  alerts: { id: string; type?: string; severity: 'warning' | 'error'; title: string; description: string; value?: number; costCenterId?: string }[];
  payrollGrowth: number;
  revenueGrowth: number;
  turnoverPct: number;
  absenteeismMax: number;
  overtimePct: number;
  payrollRevenuePct: number;
  payrollRevenueThreshold: number;
  top3Concentration: number;
}

function WorkforceSignalStrip({
  alerts, payrollGrowth, revenueGrowth, turnoverPct, absenteeismMax,
  overtimePct, payrollRevenuePct, payrollRevenueThreshold, top3Concentration,
}: WorkforceSignalStripProps) {
  const signals: { level: 'ok' | 'warn' | 'error'; label: string; detail: string }[] = [];

  if (payrollGrowth - revenueGrowth > 5)
    signals.push({ level: 'error', label: 'Crescimento', detail: `Folha +${payrollGrowth.toFixed(1)}% > Rec. +${revenueGrowth.toFixed(1)}%` });
  else if (payrollGrowth - revenueGrowth > 2)
    signals.push({ level: 'warn', label: 'Crescimento', detail: `Folha acima da receita` });
  else
    signals.push({ level: 'ok', label: 'Crescimento', detail: 'Alinhado com receita' });

  if (overtimePct > 12)
    signals.push({ level: 'warn', label: 'H. Extras', detail: `${overtimePct.toFixed(1)}%` });
  else
    signals.push({ level: 'ok', label: 'H. Extras', detail: `${overtimePct.toFixed(1)}%` });

  if (absenteeismMax > 5)
    signals.push({ level: 'error', label: 'Absenteísmo', detail: `Pico ${absenteeismMax.toFixed(1)}%` });
  else if (absenteeismMax > 4)
    signals.push({ level: 'warn', label: 'Absenteísmo', detail: `${absenteeismMax.toFixed(1)}%` });
  else
    signals.push({ level: 'ok', label: 'Absenteísmo', detail: `${absenteeismMax.toFixed(1)}%` });

  if (turnoverPct > 3)
    signals.push({ level: 'error', label: 'Turnover', detail: `${turnoverPct.toFixed(2)}%/mês` });
  else if (turnoverPct > 2)
    signals.push({ level: 'warn', label: 'Turnover', detail: `${turnoverPct.toFixed(2)}%/mês` });
  else
    signals.push({ level: 'ok', label: 'Turnover', detail: `${turnoverPct.toFixed(2)}%/mês` });

  if (top3Concentration > 80)
    signals.push({ level: 'error', label: 'Concentração', detail: `Top-3: ${top3Concentration.toFixed(0)}%` });
  else if (top3Concentration > 70)
    signals.push({ level: 'warn', label: 'Concentração', detail: `Top-3: ${top3Concentration.toFixed(0)}%` });
  else
    signals.push({ level: 'ok', label: 'Concentração', detail: `Top-3: ${top3Concentration.toFixed(0)}%` });

  if (payrollRevenuePct >= payrollRevenueThreshold + 5)
    signals.push({ level: 'error', label: 'Folha/Rec.', detail: `${payrollRevenuePct.toFixed(1)}% (limite ${payrollRevenueThreshold}%)` });
  else if (payrollRevenuePct >= payrollRevenueThreshold)
    signals.push({ level: 'warn', label: 'Folha/Rec.', detail: `${payrollRevenuePct.toFixed(1)}% no limite` });
  else
    signals.push({ level: 'ok', label: 'Folha/Rec.', detail: `${payrollRevenuePct.toFixed(1)}%` });

  const errorCount = signals.filter((s) => s.level === 'error').length;
  const warnCount = signals.filter((s) => s.level === 'warn').length;
  const allGood = errorCount === 0 && warnCount === 0;

  const levelIcon = { ok: CheckCircle, warn: AlertTriangle, error: AlertCircle };
  const chipCls = {
    ok: 'bg-ig-success/8 border-ig-success/20 text-ig-success',
    warn: 'bg-ig-warning/8 border-ig-warning/20 text-ig-warning',
    error: 'bg-ig-danger/8 border-ig-danger/20 text-ig-danger',
  };
  const iconCls = {
    ok: 'text-ig-success',
    warn: 'text-ig-warning',
    error: 'text-ig-danger',
  };

  const ccAlerts = alerts.filter((a) => a.type === 'abnormal_growth' || !a.type);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl border border-ig-border-subtle bg-ig-panel">
      {/* Label + overall status */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Zap className="w-3.5 h-3.5 text-ig-accent" />
        <span className="text-xs font-semibold text-ig-fg-muted">Sinais de Risco</span>
      </div>
      <span className={cn(
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0',
        allGood
          ? 'bg-ig-success/8 border-ig-success/20 text-ig-success'
          : errorCount > 0
            ? 'bg-ig-danger/8 border-ig-danger/20 text-ig-danger'
            : 'bg-ig-warning/8 border-ig-warning/20 text-ig-warning',
      )}>
        {allGood ? '✓ Tudo OK' : `${errorCount} crítico${errorCount !== 1 ? 's' : ''} · ${warnCount} alerta${warnCount !== 1 ? 's' : ''}`}
      </span>

      <div className="w-px h-4 bg-ig-border-subtle mx-0.5 hidden sm:block" />

      {/* Signal chips */}
      {signals.map((s) => {
        const Icon = levelIcon[s.level];
        return (
          <div
            key={s.label}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] shrink-0',
              chipCls[s.level],
            )}
          >
            <Icon className={cn('w-3 h-3 shrink-0', iconCls[s.level])} />
            <span className="font-semibold">{s.label}</span>
            <span className="text-ig-fg-muted hidden md:inline">· {s.detail}</span>
          </div>
        );
      })}

      {/* Cost center alerts */}
      {ccAlerts.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] shrink-0 bg-ig-warning/8 border-ig-warning/20 text-ig-warning">
          <Building2 className="w-3 h-3 shrink-0" />
          <span className="font-semibold">{ccAlerts.length} centro{ccAlerts.length !== 1 ? 's' : ''}</span>
          <span className="hidden md:inline text-ig-fg-muted">· crescimento anormal</span>
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

function WorkforceCostPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const costCenterId = searchParams.get('costCenterId');

  const { roles, permissions } = useCurrentUser();
  const canSeePayroll =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission(permissions, 'admin.manage_users') ||
    hasAnyPermission(permissions, PAYROLL_PERMS);
  const goToPayrollClosing = () => router.push('/workforce-cost/fechamento-folha');

  const esocial = useMemo(() => getEsocialDashboardData(), []);

  const [approvedBatches, setApprovedBatches] = useState<PayrollClosingBatchApproved[]>([]);
  useEffect(() => {
    if (repositoryMode() !== 'supabase') return;
    fetch('/api/payroll/batches?approved=true')
      .then((r) => r.json())
      .then((d: { ok: boolean; batches?: PayrollClosingBatchApproved[] }) => {
        if (d.ok) setApprovedBatches(d.batches ?? []);
      })
      .catch(() => {});
  }, []);

  const [period, setPeriod] = useState<WorkforcePeriodSelection>(DEFAULT_WORKFORCE_PERIOD);

  const arTitles = useMemo(() => getAPARTitles('receivable'), []);
  const monthlyRevenue = useMemo(() => selectMonthlyRevenue(arTitles), [arTitles]);

  const effectiveSeries = useMemo(
    () => enrichSeriesWithRevenue(buildEffectiveSeries(approvedBatches), monthlyRevenue),
    [approvedBatches, monthlyRevenue],
  );

  const workforce = useMemo(
    () => selectWorkforceViewWithClosings(period, approvedBatches, effectiveSeries),
    [period, approvedBatches, effectiveSeries],
  );

  const composition = useMemo(() => selectPayrollComposition(period, effectiveSeries), [period, effectiveSeries]);
  const scurve = useMemo(() => selectPayrollSCurve(period, effectiveSeries), [period, effectiveSeries]);
  const vsRevenue = useMemo(() => selectPayrollVsRevenue(period, effectiveSeries), [period, effectiveSeries]);
  const benefits = useMemo(() => selectBenefitsByType(period, effectiveSeries), [period, effectiveSeries]);
  const admissions = useMemo(() => selectAdmissionsVsDismissals(period, effectiveSeries), [period, effectiveSeries]);
  const turnoverTrend = useMemo(() => selectTurnoverTrend(period, effectiveSeries), [period, effectiveSeries]);
  const absenteeism = useMemo(() => selectAbsenteeismByArea(period, effectiveSeries), [period, effectiveSeries]);
  const overtime = useMemo(() => selectOvertimeTrend(period, effectiveSeries), [period, effectiveSeries]);
  const efficiency = useMemo(() => selectWorkforceEfficiency(period, effectiveSeries), [period, effectiveSeries]);

  const latestEfficiency = efficiency[efficiency.length - 1];
  const latestTurnover = turnoverTrend[turnoverTrend.length - 1];
  const latestOvertime = overtime[overtime.length - 1];
  const avgAbsenteeism = absenteeism.length > 0
    ? absenteeism.reduce((s, a) => s + a.pct, 0) / absenteeism.length
    : 0;
  const maxAbsenteeism = absenteeism.length > 0 ? absenteeism[0].pct : 0;
  const latestComposition = composition[composition.length - 1];
  const benefitsTotal = latestComposition ? latestComposition.benefits : undefined;
  const chargesTotal = latestComposition ? latestComposition.charges : undefined;
  const directPct = latestComposition
    ? (latestComposition.salary / (latestComposition.salary + latestComposition.benefits + latestComposition.charges)) * 100
    : 68.5;
  const indirectPct = 100 - directPct;

  const riskStatus = workforce.payrollRisk.status;
  const config = statusConfig[riskStatus];

  const selectedCostCenter = useMemo(() => {
    if (!costCenterId) return null;
    return workforce.costConcentration.costCenters.find((c) => c.id === costCenterId) || null;
  }, [costCenterId, workforce]);

  return (
    <HudPageLayout>
      {/* ── Header ── */}
      <HudHeader
        title="Pessoas & Custos"
        subtitle="Cockpit Executivo de Workforce — Inteligência de Custos, Eficiência e Risco"
        icon={<Users className="w-5 h-5" />}
        iconTint="#10B981"
        breadcrumbs={[{ label: 'Pessoas & Custos' }]}
        statusChips={[
          { label: workforce.meta.periodLabel, variant: 'info' },
          {
            label: `${config.label} ${workforce.payrollRisk.riskScore}/100`,
            variant: config.variant === 'active' ? 'success' : config.variant === 'warning' ? 'warning' : 'critical',
          },
          ...(workforce.hasMockFallback
            ? [{ label: 'dados demonstrativos', variant: 'neutral' as const }]
            : [{ label: 'folha importada', variant: 'success' as const }]),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ig-panel border border-ig-border-subtle text-sm text-ig-fg-muted">
              <DatabaseZap className="w-4 h-4 text-ig-accent" />
              <span>Fonte: eSocial</span>
              <span className="hidden font-mono text-xs text-ig-fg-subtle md:inline">
                última sync {esocial.config.lastSyncAt ? '05/05 09:30' : 'pendente'}
              </span>
            </div>
            <WorkforcePeriodFilter value={period} onChange={setPeriod} />
            {canSeePayroll && (
              <HudButton
                variant="primary"
                size="sm"
                leftIcon={<FileSpreadsheet className="w-4 h-4" />}
                onClick={goToPayrollClosing}
              >
                Fechamento da Folha
              </HudButton>
            )}
            <HudButton variant="secondary" size="sm" leftIcon={<Share2 className="w-4 h-4" />}>
              Compartilhar
            </HudButton>
            <HudButton
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={() => openWorkforceReport(workforce)}
            >
              Exportar PDF
            </HudButton>
          </div>
        }
      />

      {/* Payroll closing entry */}
      {canSeePayroll && (
        <section>
          <div className="relative overflow-hidden rounded-2xl border border-ig-border-focus/40 bg-ig-panel p-5 shadow-[var(--ig-shadow-e1)]">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-ig-accent/70" />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="shrink-0 rounded-xl bg-ig-accent-weak p-2.5">
                  <FileSpreadsheet className="h-5 w-5 text-ig-accent" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-ig-fg-strong">Fechamento da Folha</h3>
                  <p className="text-sm text-ig-fg-muted">
                    Importar folha, gerar análise com IA, anexar holerites e enviar por e-mail.
                  </p>
                </div>
              </div>
              <HudButton
                variant="primary"
                leftIcon={<FileSpreadsheet className="h-4 w-4" />}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                onClick={goToPayrollClosing}
              >
                Novo fechamento
              </HudButton>
            </div>
          </div>
        </section>
      )}

      {/* Cost Center Drilldown (conditional) */}
      {selectedCostCenter && (
        <section>
          <CostCenterDrilldown
            costCenter={selectedCostCenter}
            currency={workforce.costConcentration.currency}
          />
        </section>
      )}

      {/* ── A. Cockpit Executivo — KPI Strip ── */}
      <section>
        <WorkforceOverviewCards
          data={workforce.metrics}
          meta={workforce.meta}
          extended={{
            turnoverPct: latestTurnover?.turnoverPct,
            absenteeismPct: avgAbsenteeism,
            overtimePct: latestOvertime?.overtimePct,
            benefitsTotal,
            chargesTotal,
            revenuePerEmployee: latestEfficiency?.revenuePerEmployee,
            directPayrollPct: directPct,
            indirectPayrollPct: indirectPct,
          }}
        />
      </section>

      {/* ── Sinais de Risco (strip compacto) ── */}
      <section>
        <WorkforceSignalStrip
          alerts={workforce.alerts}
          payrollGrowth={workforce.payrollRisk.payrollGrowth}
          revenueGrowth={workforce.payrollRisk.revenueGrowth}
          turnoverPct={latestTurnover?.turnoverPct ?? 0}
          absenteeismMax={maxAbsenteeism}
          overtimePct={latestOvertime?.overtimePct ?? 0}
          payrollRevenuePct={workforce.metrics.payrollAsRevenuePercent.value}
          payrollRevenueThreshold={workforce.metrics.payrollAsRevenuePercent.threshold}
          top3Concentration={workforce.costConcentration.top3Concentration}
        />
      </section>

      {/* ── B. Workforce Composition ── */}
      <section className="space-y-3">
        <SectionHeader title="Composição do Workforce" subtitle="Distribuição de pessoas e folha por área, base e vínculo" />
        <WorkforceCompositionPanel
          costConcentration={workforce.costConcentration}
          pjPercent={workforce.metrics.contractDistribution.pjPercent}
          cltPercent={workforce.metrics.contractDistribution.cltPercent}
          pjCount={workforce.metrics.contractDistribution.pj}
          cltCount={workforce.metrics.contractDistribution.clt}
          pjCost={workforce.metrics.contractDistribution.pjCost}
          cltCost={workforce.metrics.contractDistribution.cltCost}
        />
      </section>

      {/* ── C. Payroll Evolution + S-Curve ── */}
      <section className="space-y-3">
        <SectionHeader title="Evolução da Folha" subtitle="Tendência, composição salarial, Curva S acumulada e comparativo com receita" />
        <PayrollEvolutionPanel
          composition={composition}
          scurve={scurve}
          vsRevenue={vsRevenue}
          benefits={benefits}
          currency={workforce.costConcentration.currency}
        />
      </section>

      {/* ── D. Headcount Dynamics ── */}
      <section className="space-y-3">
        <SectionHeader title="Dinâmica de Headcount" subtitle="Admissões, desligamentos, turnover, absenteísmo e horas extras" />
        <HeadcountDynamicsPanel
          admissions={admissions}
          turnover={turnoverTrend}
          absenteeism={absenteeism}
          overtime={overtime}
        />
      </section>

      {/* ── E. Cost Concentration (full width) ── */}
      <section className="space-y-3">
        <SectionHeader title="Concentração por Centro de Custo" subtitle="Ranking Pareto da folha — barras com acumulado e destaque Top-3" />
        <CostConcentrationPanel data={workforce.costConcentration} />
      </section>

      {/* ── F. Efficiency & Productivity ── */}
      <section className="space-y-3">
        <SectionHeader title="Eficiência & Produtividade" subtitle="Receita por colaborador, custo médio e índice folha/receita ao longo do tempo" />
        <WorkforceEfficiencyPanel
          data={efficiency}
          currency={workforce.costConcentration.currency}
        />
      </section>

      {/* ── G. Payroll Risk + Trend ── */}
      <section className="space-y-3">
        <SectionHeader title="Risco de Folha & Tendência" subtitle="Score de risco, evolução histórica e comparativo payroll vs receita" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PayrollRiskIndicator data={workforce.payrollRisk} />
          <WorkforceTrendChart
            data={workforce.trend}
            currency={workforce.costConcentration.currency}
          />
        </div>
      </section>

      {/* ── H. Hiring Simulator ── */}
      <section className="space-y-3">
        <SectionHeader title="Simulador de Contratação" subtitle="Análise de impacto estratégico para decisão do board" />
        <HiringSimulatorExpanded
          initialAvgCost={workforce.metrics.avgCostPerEmployee.value}
          currentPayroll={workforce.metrics.monthlyPayroll.value}
          currentRevenue={latestEfficiency?.revenue ?? 0}
          currentHeadcount={workforce.metrics.headcount.total}
          payrollRevenueThreshold={workforce.metrics.payrollAsRevenuePercent.threshold}
        />
      </section>

      {/* ── I. Collapsible Detail Tables ── */}
      <section className="space-y-3">
        <SectionHeader title="Detalhamento" subtitle="Tabelas detalhadas — expanda conforme necessário" />
        <CollapsibleDetailPanel
          costConcentration={workforce.costConcentration}
          trend={workforce.trend}
        />
      </section>
    </HudPageLayout>
  );
}

export default function WorkforceCostPage() {
  return (
    <Suspense
      fallback={
        <HudPageLayout>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Users className="w-12 h-12 text-ig-fg-subtle mx-auto mb-3 animate-pulse" />
              <p className="text-sm text-ig-fg-muted">Carregando dados...</p>
            </div>
          </div>
        </HudPageLayout>
      }
    >
      <WorkforceCostPageInner />
    </Suspense>
  );
}
