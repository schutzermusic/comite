'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Table2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { OrionCard } from '@/components/orion';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { CostConcentrationData } from '@/lib/workforce-data';
import type { WorkforceTrendPoint } from '@/lib/workforce/period';
import { cn } from '@/lib/utils';

interface CollapsibleDetailPanelProps {
  costConcentration: CostConcentrationData;
  trend: WorkforceTrendPoint[];
  className?: string;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-ig-border-subtle rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-ig-panel hover:bg-ig-panel-hover transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Table2 className="w-3.5 h-3.5 text-ig-fg-muted" />
          <span className="text-sm font-medium text-ig-fg-strong">{title}</span>
          {count !== undefined && (
            <span className="text-xs text-ig-fg-subtle px-1.5 py-0.5 rounded bg-ig-panel-hover border border-ig-border-subtle">
              {count}
            </span>
          )}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-ig-fg-muted" /> : <ChevronRight className="w-4 h-4 text-ig-fg-muted" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 bg-ig-bg border-t border-ig-border-subtle">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CollapsibleDetailPanel({ costConcentration, trend, className }: CollapsibleDetailPanelProps) {
  const sorted = [...costConcentration.costCenters].sort((a, b) => b.payrollValue - a.payrollValue);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Cost centers table */}
      <Section title="Centros de Custo" count={sorted.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ig-fg-subtle border-b border-ig-border-subtle">
                <th className="text-left py-2 font-medium">Centro</th>
                <th className="text-left py-2 font-medium">Área</th>
                <th className="text-right py-2 font-medium">Headcount</th>
                <th className="text-right py-2 font-medium">Folha</th>
                <th className="text-right py-2 font-medium">Var. %</th>
                <th className="text-right py-2 font-medium">Part. %</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((cc, i) => {
                const share = costConcentration.totalPayroll > 0
                  ? ((cc.payrollValue / costConcentration.totalPayroll) * 100).toFixed(1)
                  : '–';
                return (
                  <tr key={cc.id} className={cn('border-b border-ig-border-subtle/50', i % 2 === 0 ? '' : 'bg-ig-panel/40')}>
                    <td className="py-2 font-medium text-ig-fg-strong">{cc.name}</td>
                    <td className="py-2 text-ig-fg-muted">{cc.department ?? '–'}</td>
                    <td className="py-2 text-right ig-tabular">{cc.headcount}</td>
                    <td className="py-2 text-right ig-tabular">{formatWorkforceCurrency(cc.payrollValue)}</td>
                    <td className={cn(
                      'py-2 text-right ig-tabular',
                      cc.isAbnormal ? 'text-ig-danger' : cc.growthVsPrevious > 5 ? 'text-ig-warning' : 'text-ig-success',
                    )}>
                      {cc.growthVsPrevious > 0 ? '+' : ''}{cc.growthVsPrevious.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right text-ig-fg-muted ig-tabular">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ig-fg-strong border-t border-ig-border-subtle">
                <td className="pt-2" colSpan={2}>Total</td>
                <td className="pt-2 text-right ig-tabular">
                  {sorted.reduce((s, c) => s + c.headcount, 0)}
                </td>
                <td className="pt-2 text-right ig-tabular">{formatWorkforceCurrency(costConcentration.totalPayroll)}</td>
                <td />
                <td className="pt-2 text-right ig-tabular text-ig-fg-muted">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      {/* Monthly history table */}
      <Section title="Histórico Mensal" count={trend.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ig-fg-subtle border-b border-ig-border-subtle">
                <th className="text-left py-2 font-medium">Período</th>
                <th className="text-right py-2 font-medium">Headcount</th>
                <th className="text-right py-2 font-medium">Folha</th>
                <th className="text-right py-2 font-medium">Custo Médio</th>
              </tr>
            </thead>
            <tbody>
              {[...trend].reverse().map((t, i) => (
                <tr key={t.period} className={cn('border-b border-ig-border-subtle/50', i % 2 === 0 ? '' : 'bg-ig-panel/40')}>
                  <td className="py-2 font-medium text-ig-fg-strong">{t.period}</td>
                  <td className="py-2 text-right ig-tabular">{t.headcount.toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-right ig-tabular">{formatWorkforceCurrency(t.payroll)}</td>
                  <td className="py-2 text-right ig-tabular">{formatWorkforceCurrency(t.avgCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
