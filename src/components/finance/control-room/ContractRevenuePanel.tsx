'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FileText, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL } from './helpers';
import type { ContractRevenueRow } from './types';

interface ContractRevenuePanelProps {
  contracts: ContractRevenueRow[];
}

const RISK_META: Record<ContractRevenueRow['delayRisk'], { color: string; label: string; icon: React.ReactNode }> = {
  low: { color: '#10B981', label: 'Baixo', icon: <CheckCircle2 className="h-3 w-3" /> },
  medium: { color: '#F59E0B', label: 'Médio', icon: <Clock className="h-3 w-3" /> },
  high: { color: '#EF4444', label: 'Alto', icon: <AlertTriangle className="h-3 w-3" /> },
};

export function ContractRevenuePanel({ contracts }: ContractRevenuePanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative h-full"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklab, #818CF8 14%, transparent)', color: '#818CF8', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #818CF8 28%, transparent)' }}
            >
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Contract Revenue</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Faturado · A faturar · Forecast · Risco</p>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col divide-y divide-[color:var(--ig-border-subtle)] overflow-y-auto">
          {contracts.map((c, i) => {
            const invoicedPct = (c.invoiced / c.contractTotal) * 100;
            const forecastPct = ((c.invoiced + c.forecastInvoicing) / c.contractTotal) * 100;
            const riskMeta = RISK_META[c.delayRisk];
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className="px-5 py-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-[12.5px] font-semibold text-[color:var(--ig-fg-strong)]">{c.name}</h4>
                      <span
                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                        style={{
                          color: riskMeta.color,
                          borderColor: `color-mix(in oklab, ${riskMeta.color} 32%, transparent)`,
                          background: `color-mix(in oklab, ${riskMeta.color} 12%, transparent)`,
                        }}
                      >
                        {riskMeta.icon}
                        Risco {riskMeta.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[color:var(--ig-fg-muted)]">
                      <span>{c.client}</span>
                      <span>·</span>
                      <span>Encerra {c.endDate}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[14px] font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">{formatCompactBRL(c.contractTotal)}</div>
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--ig-fg-subtle)]">Total contrato</div>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <MiniStat label="Faturado" value={formatCompactBRL(c.invoiced)} color="#14B8A6" />
                  <MiniStat label="A Faturar" value={formatCompactBRL(c.toInvoice)} color="#A78BFA" />
                  <MiniStat label="Forecast" value={formatCompactBRL(c.forecastInvoicing)} color="#F59E0B" />
                </div>

                <div className="mt-2.5">
                  <div className="relative h-2 overflow-hidden rounded-full bg-[color:var(--ig-bg-canvas)]/50 ring-1 ring-inset ring-[color:var(--ig-border-strong)]">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ background: 'linear-gradient(90deg, #14B8A6, #0F9C8F)' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${invoicedPct}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full opacity-40"
                      style={{ background: 'linear-gradient(90deg, transparent, #F59E0B)' }}
                      initial={{ width: `${invoicedPct}%`, opacity: 0 }}
                      animate={{ width: `${forecastPct}%`, opacity: 0.4 }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[color:var(--ig-fg-muted)]">
                    <span>Faturado {invoicedPct.toFixed(1)}%</span>
                    <span>Forecast {forecastPct.toFixed(1)}%</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">
        <span className="h-1.5 w-1.5 rounded-sm" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[11.5px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
