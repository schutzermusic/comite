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
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { hasAnyPermission, hasPermission } from '@/lib/auth/permissions';

import {
  WorkforceOverviewCards,
  CostConcentrationPanel,
  WorkforceAlertCenter,
  WorkforceTrendChart,
  CostCenterDrilldown,
  HiringSimulatorExpanded,
  PayrollRiskIndicator,
  WorkforcePeriodFilter,
} from '@/components/workforce';

import { getMockDashboardData } from '@/lib/dashboard-data';
import { RiskStatus } from '@/lib/workforce-data';
import {
  selectWorkforceViewWithClosings,
  DEFAULT_WORKFORCE_PERIOD,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';
import { repositoryMode } from '@/lib/payroll/closing-client';
import type { PayrollClosingBatchApproved } from '@/lib/types/payroll-closing';
import { openWorkforceReport } from '@/lib/workforce/export-report';

import {
  HudPageLayout,
  HudHeader,
  HudButton,
} from '@/components/hud';
import { getEsocialDashboardData } from '@/lib/esocial';

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

function WorkforceCostPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const costCenterId = searchParams.get('costCenterId');

  // Show the payroll closing entry points to owners/admins or anyone holding a
  // payroll permission. Owners/admins are never blocked even if perms aren't
  // seeded yet. (Server routes still enforce permissions on every action.)
  const { roles, permissions } = useCurrentUser();
  const canSeePayroll =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission(permissions, 'admin.manage_users') ||
    hasAnyPermission(permissions, PAYROLL_PERMS);
  const goToPayrollClosing = () => router.push('/workforce-cost/fechamento-folha');

  const data = useMemo(() => getMockDashboardData(), []);
  const esocial = useMemo(() => getEsocialDashboardData(), []);

  // Load approved closing batches so the overview uses imported payroll data.
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

  // Global period filter — every workforce indicator below is derived from the
  // selected period through the `selectWorkforce*` selectors (no hardcoding).
  const [period, setPeriod] = useState<WorkforcePeriodSelection>(DEFAULT_WORKFORCE_PERIOD);
  const workforce = useMemo(
    () => selectWorkforceViewWithClosings(period, approvedBatches),
    [period, approvedBatches],
  );
  const trendData = workforce.trend;

  const handleExportPdf = () => {
    openWorkforceReport(workforce);
  };

  const selectedCostCenter = useMemo(() => {
    if (!costCenterId) return null;
    return workforce.costConcentration.costCenters.find((c) => c.id === costCenterId) || null;
  }, [costCenterId, workforce]);

  const riskStatus = workforce.payrollRisk.status;
  const config = statusConfig[riskStatus];

  return (
    <HudPageLayout>
      <HudHeader
        title="Pessoas & Custos"
        subtitle="Sala de Controle de Custos de Pessoal — Análise Completa para Decisão"
        icon={<Users className="w-5 h-5" />}
        iconTint="#10B981"
        breadcrumbs={[{ label: 'Pessoas & Custos' }]}
        statusChips={[
          {
            label: workforce.meta.periodLabel,
            variant: 'info',
          },
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
                ultima sync {esocial.config.lastSyncAt ? '05/05 09:30' : 'pendente'}
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
              onClick={handleExportPdf}
            >
              Exportar PDF
            </HudButton>
          </div>
        }
      />

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

      {selectedCostCenter && (
        <section>
          <CostCenterDrilldown
            costCenter={selectedCostCenter}
            currency={workforce.costConcentration.currency}
          />
        </section>
      )}

      <section>
        <WorkforceOverviewCards data={workforce.metrics} meta={workforce.meta} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CostConcentrationPanel data={workforce.costConcentration} />
        </div>
        <div>
          <WorkforceAlertCenter
            costCenters={workforce.costConcentration.costCenters}
            payrollRevenuePercent={workforce.metrics.payrollAsRevenuePercent.value}
            payrollRevenueThreshold={workforce.metrics.payrollAsRevenuePercent.threshold}
          />
        </div>
      </section>

      <section>
        <HiringSimulatorExpanded
          initialAvgCost={workforce.metrics.avgCostPerEmployee.value}
          initialEbitdaMargin={data.financialPulse?.ebitda.margin || 22.8}
          currentRevenue={data.financialPulse?.revenue.value || 125000000}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PayrollRiskIndicator data={workforce.payrollRisk} />
        <WorkforceTrendChart
          data={trendData}
          currency={workforce.costConcentration.currency}
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
