'use client';

/**
 * Indicadores da carteira oficial — mesma faixa executiva de Projetos
 * (`HudKpiStrip`), com métricas de contrato.
 *
 * Não inventa zero: indicador `Official` ausente ou em erro vira "—", e a
 * linha de apoio (`deltaLabel`) diz se a leitura falhou ou ainda não apurou.
 */

import {
  FileSignature,
  Activity,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  FileWarning,
  Receipt,
  Clock,
} from 'lucide-react';
import { HudKpiStrip, type KpiItem } from '@/components/hud';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';

export interface PortfolioKpiCardsProps {
  stats: TrustedPortfolioStats;
  className?: string;
  onKpiClick?: (id: string) => void;
  activeKpiIds?: string[];
}

function readNumber(v: Official<number>): { value: number | string; hint?: string } {
  if (isError(v)) return { value: '—', hint: 'indisponível' };
  if (!hasOfficialValue(v)) return { value: '—', hint: 'não apurado' };
  return { value: v.value };
}

export function PortfolioKpiCards({
  stats, className, onKpiClick, activeKpiIds,
}: PortfolioKpiCardsProps) {
  const totalValue = readNumber(stats.totalValue);
  const billed = readNumber(stats.billedValue);
  const highRisk = readNumber(stats.highRisk);
  const expiring = readNumber(stats.expiring90);
  const overdue = readNumber(stats.overdueObligations);
  const pendingDocs = readNumber(stats.pendingDocuments);

  const execution = hasOfficialValue(stats.billedPct)
    ? { value: Math.round(stats.billedPct.value * 100), hint: undefined as string | undefined }
    : isError(stats.billedPct)
      ? { value: '—' as const, hint: 'indisponível' }
      : { value: '—' as const, hint: 'não apurado' };

  const highRiskN = typeof highRisk.value === 'number' ? highRisk.value : 0;
  const overdueN = typeof overdue.value === 'number' ? overdue.value : 0;
  const docsN = typeof pendingDocs.value === 'number' ? pendingDocs.value : 0;

  const baseKpis: KpiItem[] = [
    {
      id: 'total',
      label: 'Total de contratos',
      value: stats.contractCount,
      icon: <FileSignature className="w-5 h-5" />,
      variant: 'info',
      deltaLabel: stats.scope.total === stats.contractCount
        ? `${stats.contractCount} na carteira oficial`
        : `${stats.contractCount} oficial · ${stats.scope.total - stats.contractCount} fora`,
    },
    {
      id: 'expiring',
      label: 'A vencer (90d)',
      value: expiring.value,
      icon: <Activity className="w-5 h-5" />,
      variant: typeof expiring.value === 'number' && expiring.value > 0 ? 'warning' : 'success',
      deltaLabel: expiring.hint,
    },
    {
      id: 'value',
      label: 'Exposição contratada',
      value: totalValue.value,
      format: typeof totalValue.value === 'number' ? 'compactCurrency' : 'raw',
      icon: <DollarSign className="w-5 h-5" />,
      variant: 'default',
      deltaLabel: totalValue.hint ?? 'Soma dos contratos de origem validada',
    },
    {
      id: 'critical',
      label: 'Alto risco',
      value: highRisk.value,
      icon: <AlertTriangle className="w-5 h-5" />,
      variant: highRiskN > 0 ? 'danger' : 'default',
      deltaLabel: highRisk.hint
        ?? (hasOfficialValue(stats.highRiskExposure)
          ? `expostos na carteira oficial`
          : undefined),
    },
    {
      id: 'execution',
      label: 'Execução média',
      value: execution.value,
      suffix: typeof execution.value === 'number' ? '%' : undefined,
      icon: <TrendingUp className="w-5 h-5" />,
      variant: typeof execution.value === 'number'
        ? (execution.value >= 80 ? 'success' : execution.value >= 40 ? 'info' : 'warning')
        : 'default',
      deltaLabel: execution.hint,
    },
    {
      id: 'docs',
      label: 'Docs pendentes',
      value: pendingDocs.value,
      icon: <FileWarning className="w-5 h-5" />,
      variant: docsN > 0 ? 'danger' : 'default',
      deltaLabel: pendingDocs.hint,
    },
    {
      id: 'billed',
      label: 'Faturado',
      value: billed.value,
      format: typeof billed.value === 'number' ? 'compactCurrency' : 'raw',
      icon: <Receipt className="w-5 h-5" />,
      variant: 'info',
      deltaLabel: billed.hint,
    },
    {
      id: 'overdue',
      label: 'Obrigações atrasadas',
      value: overdue.value,
      icon: <Clock className="w-5 h-5" />,
      variant: overdueN > 0 ? 'warning' : 'default',
      deltaLabel: overdue.hint,
    },
  ];

  const kpis: KpiItem[] = onKpiClick
    ? baseKpis.map((kpi) => ({
        ...kpi,
        onClick: () => onKpiClick(kpi.id),
        active: activeKpiIds?.includes(kpi.id) ?? false,
      }))
    : baseKpis;

  return (
    <HudKpiStrip
      kpis={kpis}
      columns={4}
      size="md"
      className={className}
    />
  );
}
