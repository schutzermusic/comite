'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  Download, 
  Share2, 
  Calendar,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

// Background system
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';

// Workforce components
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

// UI components
import { Button } from '@/components/ui/button';

// Data layer
import { getMockDashboardData } from '@/lib/dashboard-data';
import { RiskStatus } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

const statusConfig: Record<RiskStatus, {
  icon: typeof CheckCircle;
  label: string;
  color: string;
  bgColor: string;
}> = {
  healthy: {
    icon: CheckCircle,
    label: 'Saudável',
    color: 'text-semantic-success-DEFAULT',
    bgColor: 'bg-semantic-success-bg',
  },
  attention: {
    icon: AlertTriangle,
    label: 'Atenção',
    color: 'text-semantic-warning-DEFAULT',
    bgColor: 'bg-semantic-warning-bg',
  },
  risk: {
    icon: AlertCircle,
    label: 'Risco',
    color: 'text-semantic-error-DEFAULT',
    bgColor: 'bg-semantic-error-bg',
  },
};

export default function WorkforceCostPage() {
  const searchParams = useSearchParams();
  const costCenterId = searchParams.get('costCenterId');

  // Get dashboard data with workforce
  const data = useMemo(() => getMockDashboardData(), []);
  const workforce = data.workforceData;

  // Generate trend data
  const trendData = useMemo(() => generateMockTrendData(), []);

  // Find selected cost center for drill-down
  const selectedCostCenter = useMemo(() => {
    if (!costCenterId || !workforce) return null;
    return workforce.costConcentration.costCenters.find(c => c.id === costCenterId) || null;
  }, [costCenterId, workforce]);

  // Loading/empty state
  if (!workforce) {
    return (
      <OrionGreenBackground className="orion-page">
        <div className="orion-page-content max-w-[1800px] mx-auto">
          <div className="flex items-center justify-center h-[60vh]">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-semantic-warning-DEFAULT mx-auto mb-4 opacity-50" />
              <h2 className="text-lg font-semibold text-white mb-2">
                Dados de Workforce Indisponíveis
              </h2>
              <p className="text-sm text-orion-text-muted">
                Não foi possível carregar os dados de workforce neste momento.
              </p>
            </div>
          </div>
        </div>
      </OrionGreenBackground>
    );
  }

  const riskStatus = workforce.payrollRisk.status;
  const StatusIcon = statusConfig[riskStatus].icon;

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">
                Pessoas & Custos
              </h1>
              <p className="text-sm text-orion-text-tertiary">
                Sala de Controle de Custos de Pessoal • Análise Completa para Decisão
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Period Selector */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-glass-light">
                <Calendar className="w-4 h-4 text-orion-text-muted" />
                <span className="text-sm text-orion-text-secondary">
                  {data.cycleSummary.currentCycle}
                </span>
              </div>

              {/* Status Badge */}
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg',
                statusConfig[riskStatus].bgColor
              )}>
                <StatusIcon className={cn('w-4 h-4', statusConfig[riskStatus].color)} />
                <span className={cn('text-sm font-medium', statusConfig[riskStatus].color)}>
                  {statusConfig[riskStatus].label}
                </span>
                <span className={cn('text-sm', statusConfig[riskStatus].color)}>
                  {workforce.payrollRisk.riskScore}/100
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-orion-text-secondary">
                  <Share2 className="w-4 h-4 mr-2" />
                  Compartilhar
                </Button>
                <Button variant="outline" size="sm" className="text-orion-text-secondary">
                  <Download className="w-4 h-4 mr-2" />
                  Exportar PDF
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Drill-down Panel (if cost center selected) */}
        {selectedCostCenter && (
          <section className="mb-8">
            <CostCenterDrilldown
              costCenter={selectedCostCenter}
              currency={workforce.costConcentration.currency}
            />
          </section>
        )}

        {/* ROW A - KPI Executive Band */}
        <section className="mb-8">
          <WorkforceOverviewCards data={workforce.metrics} />
        </section>

        {/* ROW B - Concentration & Alerts */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Cost Concentration Panel - 2/3 */}
          <div className="lg:col-span-2">
            <CostConcentrationPanel data={workforce.costConcentration} />
          </div>

          {/* Alert Center - 1/3 */}
          <div>
            <WorkforceAlertCenter
              costCenters={workforce.costConcentration.costCenters}
              payrollRevenuePercent={workforce.metrics.payrollAsRevenuePercent.value}
              payrollRevenueThreshold={workforce.metrics.payrollAsRevenuePercent.threshold}
            />
          </div>
        </section>

        {/* ROW C - Strategic Simulator */}
        <section className="mb-8">
          <HiringSimulatorExpanded
            initialAvgCost={workforce.metrics.avgCostPerEmployee.value}
            initialEbitdaMargin={data.financialPulse?.ebitda.margin || 22.8}
            currentRevenue={data.financialPulse?.revenue.value || 125000000}
          />
        </section>

        {/* ROW D - Risk & Trends */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Payroll Risk Indicator - Full */}
          <PayrollRiskIndicator data={workforce.payrollRisk} />

          {/* Trend Analysis */}
          <WorkforceTrendChart
            data={trendData}
            currency={workforce.costConcentration.currency}
          />
        </section>
      </div>
    </OrionGreenBackground>
  );
}

