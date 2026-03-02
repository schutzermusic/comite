'use client';

import { useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Download,
  Share2,
  Calendar,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Users,
} from 'lucide-react';

import {
  WorkforceOverviewCards,
  CostConcentrationPanel,
  WorkforceAlertCenter,
  WorkforceTrendChart,
  CostCenterDrilldown,
  HiringSimulatorExpanded,
  PayrollRiskIndicator,
  generateMockTrendData,
} from '@/components/workforce';

import { getMockDashboardData } from '@/lib/dashboard-data';
import { RiskStatus } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

import {
  HudPageLayout,
  HudHeader,
  HudButton,
  HudStatusPill,
  HudEmptyState,
} from '@/components/hud';

const statusConfig: Record<RiskStatus, {
  icon: typeof CheckCircle;
  label: string;
  variant: 'active' | 'warning' | 'error';
}> = {
  healthy: { icon: CheckCircle, label: 'Saudável', variant: 'active' },
  attention: { icon: AlertTriangle, label: 'Atenção', variant: 'warning' },
  risk: { icon: AlertCircle, label: 'Risco', variant: 'error' },
};

function WorkforceCostPageInner() {
  const searchParams = useSearchParams();
  const costCenterId = searchParams.get('costCenterId');

  const data = useMemo(() => getMockDashboardData(), []);
  const workforce = data.workforceData;
  const trendData = useMemo(() => generateMockTrendData(), []);

  const selectedCostCenter = useMemo(() => {
    if (!costCenterId || !workforce) return null;
    return workforce.costConcentration.costCenters.find((c) => c.id === costCenterId) || null;
  }, [costCenterId, workforce]);

  if (!workforce) {
    return (
      <HudPageLayout>
        <HudEmptyState
          icon="alert"
          title="Dados de Workforce Indisponíveis"
          description="Não foi possível carregar os dados de workforce neste momento."
        />
      </HudPageLayout>
    );
  }

  const riskStatus = workforce.payrollRisk.status;
  const config = statusConfig[riskStatus];

  return (
    <HudPageLayout>
      <HudHeader
        title="Pessoas & Custos"
        subtitle="Sala de Controle de Custos de Pessoal — Análise Completa para Decisão"
        icon={<Users className="w-5 h-5" />}
        breadcrumbs={[{ label: 'Pessoas & Custos' }]}
        statusChips={[
          {
            label: `${config.label} ${workforce.payrollRisk.riskScore}/100`,
            variant: config.variant === 'active' ? 'success' : config.variant === 'warning' ? 'warning' : 'critical',
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-white/60">
              <Calendar className="w-4 h-4" />
              <span>{data.cycleSummary.currentCycle}</span>
            </div>
            <HudButton variant="secondary" size="sm" leftIcon={<Share2 className="w-4 h-4" />}>
              Compartilhar
            </HudButton>
            <HudButton variant="secondary" size="sm" leftIcon={<Download className="w-4 h-4" />}>
              Exportar PDF
            </HudButton>
          </div>
        }
      />

      {selectedCostCenter && (
        <section>
          <CostCenterDrilldown
            costCenter={selectedCostCenter}
            currency={workforce.costConcentration.currency}
          />
        </section>
      )}

      <section>
        <WorkforceOverviewCards data={workforce.metrics} />
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
              <Users className="w-12 h-12 text-white/30 mx-auto mb-3 animate-pulse" />
              <p className="text-sm text-white/50">Carregando dados...</p>
            </div>
          </div>
        </HudPageLayout>
      }
    >
      <WorkforceCostPageInner />
    </Suspense>
  );
}
