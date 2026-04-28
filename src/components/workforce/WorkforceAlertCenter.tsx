'use client';

import { AlertTriangle, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { CostCenter, formatWorkforcePercentage } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import Link from 'next/link';

interface WorkforceAlert {
  id: string;
  type: 'abnormal_growth' | 'threshold_exceeded' | 'risk_detected';
  severity: 'warning' | 'error' | 'info';
  title: string;
  description: string;
  costCenterId?: string;
  value?: number;
}

interface WorkforceAlertCenterProps {
  costCenters: CostCenter[];
  payrollRevenuePercent: number;
  payrollRevenueThreshold: number;
  className?: string;
}

export function WorkforceAlertCenter({
  costCenters,
  payrollRevenuePercent,
  payrollRevenueThreshold,
  className,
}: WorkforceAlertCenterProps) {
  // Generate alerts from data
  const alerts: WorkforceAlert[] = [];

  // Check for abnormal growth in cost centers
  costCenters.forEach(center => {
    if (center.isAbnormal) {
      alerts.push({
        id: `abnormal-${center.id}`,
        type: 'abnormal_growth',
        severity: center.growthVsPrevious > 20 ? 'error' : 'warning',
        title: center.name,
        description: `Crescimento de ${formatWorkforcePercentage(center.growthVsPrevious)} acima do esperado`,
        costCenterId: center.id,
        value: center.growthVsPrevious,
      });
    }
  });

  // Check payroll/revenue threshold
  if (payrollRevenuePercent >= payrollRevenueThreshold) {
    alerts.push({
      id: 'threshold-payroll-revenue',
      type: 'threshold_exceeded',
      severity: payrollRevenuePercent >= payrollRevenueThreshold + 5 ? 'error' : 'warning',
      title: 'Folha/Receita',
      description: `${payrollRevenuePercent.toFixed(1)}% atingiu o limite de ${payrollRevenueThreshold}%`,
      value: payrollRevenuePercent,
    });
  }

  const severityConfig = {
    warning: {
      icon: AlertTriangle,
      color: 'text-ig-warning',
      bgColor: 'bg-ig-warning/10',
      borderColor: 'border-ig-warning/25',
    },
    error: {
      icon: AlertCircle,
      color: 'text-ig-danger',
      bgColor: 'bg-ig-danger/10',
      borderColor: 'border-ig-danger/25',
    },
    info: {
      icon: CheckCircle,
      color: 'text-ig-info',
      bgColor: 'bg-ig-info/10',
      borderColor: 'border-ig-info/25',
    },
  };

  if (alerts.length === 0) {
    return (
      <OrionCard variant="elevated" className={className}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ig-fg-strong tracking-tight">
            Central de Alertas
          </h3>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-ig-success/10 border border-ig-success/25">
            <CheckCircle className="w-3 h-3 text-ig-success" />
            <span className="text-xs text-ig-success font-medium">Tudo OK</span>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <CheckCircle className="w-10 h-10 text-ig-success mx-auto mb-2 opacity-50" />
            <p className="text-sm text-ig-fg-muted">Nenhum alerta ativo</p>
            <p className="text-xs text-ig-fg-subtle mt-1">
              Todos os indicadores estão dentro dos limites
            </p>
          </div>
        </div>
      </OrionCard>
    );
  }

  return (
    <OrionCard variant="elevated" className={className}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ig-fg-strong tracking-tight">
          Central de Alertas
        </h3>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-ig-warning/10 border border-ig-warning/25">
          <AlertTriangle className="w-3 h-3 text-ig-warning" />
          <span className="text-xs text-ig-warning font-medium ig-tabular">
            {alerts.length} alerta{alerts.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {alerts.map((alert, idx) => {
          const config = severityConfig[alert.severity];
          const AlertIcon = config.icon;

          const content = (
            <motion.div
              key={alert.id}
              className={cn(
                'p-3 rounded-lg',
                config.bgColor,
                'border',
                config.borderColor,
                alert.costCenterId && 'cursor-pointer hover:border-ig-border-strong transition-colors'
              )}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <div className="flex items-start gap-3">
                <AlertIcon className={cn('w-4 h-4 mt-0.5', config.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-sm font-semibold', config.color)}>
                      {alert.title}
                    </span>
                    {alert.value !== undefined && (
                      <div className="flex items-center gap-1">
                        <TrendingUp className={cn('w-3 h-3', config.color)} />
                        <span className={cn('text-xs font-semibold ig-tabular', config.color)}>
                          {typeof alert.value === 'number' && alert.value > 0 ? '+' : ''}
                          {alert.value.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-ig-fg-muted mt-1">
                    {alert.description}
                  </p>
                </div>
              </div>
            </motion.div>
          );

          if (alert.costCenterId) {
            return (
              <Link
                key={alert.id}
                href={`/workforce-cost?costCenterId=${encodeURIComponent(alert.costCenterId)}`}
              >
                {content}
              </Link>
            );
          }

          return content;
        })}
      </div>

      {/* Quick Recommendations */}
      <div className="mt-4 pt-4 border-t border-ig-border-subtle">
        <p className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle mb-2">Recomendações rápidas</p>
        <ul className="space-y-1.5">
          {alerts.some(a => a.type === 'abnormal_growth') && (
            <li className="text-xs text-ig-fg-default flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-ig-warning" />
              Revisar contratações nos centros com crescimento anormal
            </li>
          )}
          {alerts.some(a => a.type === 'threshold_exceeded') && (
            <li className="text-xs text-ig-fg-default flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-ig-warning" />
              Avaliar otimização de custos ou aumento de receita
            </li>
          )}
        </ul>
      </div>
    </OrionCard>
  );
}

