'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Radar,
  TrendingUp,
  TrendingDown,
  Minus,
  Banknote,
  ShieldAlert,
  Receipt,
  FileWarning,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL } from './helpers';
import type { FinancialRiskItem } from './types';

interface FinancialRiskRadarProps {
  risks: FinancialRiskItem[];
}

const DOMAIN_META: Record<FinancialRiskItem['domain'], { color: string; label: string; icon: React.ReactNode }> = {
  margin: { color: '#A78BFA', label: 'Margem', icon: <Activity className="h-3 w-3" /> },
  cash: { color: '#22D3EE', label: 'Caixa', icon: <Banknote className="h-3 w-3" /> },
  tax: { color: '#F59E0B', label: 'Tributário', icon: <Receipt className="h-3 w-3" /> },
  invoicing: { color: '#818CF8', label: 'Faturamento', icon: <FileWarning className="h-3 w-3" /> },
  cost: { color: '#F43F5E', label: 'Custo', icon: <ShieldAlert className="h-3 w-3" /> },
};

const SEVERITY_META: Record<FinancialRiskItem['severity'], { color: string; label: string; level: number }> = {
  critical: { color: '#EF4444', label: 'Crítico', level: 4 },
  high: { color: '#F87171', label: 'Alto', level: 3 },
  medium: { color: '#F59E0B', label: 'Médio', level: 2 },
  low: { color: '#10B981', label: 'Baixo', level: 1 },
};

export function FinancialRiskRadar({ risks }: FinancialRiskRadarProps) {
  const totalExposure = risks.reduce((sum, r) => sum + r.exposure, 0);
  const criticalCount = risks.filter((r) => r.severity === 'critical' || r.severity === 'high').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative h-full"
      data-elev={3}
      data-sweep
      data-state="critical"
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklab, #EF4444 14%, transparent)', color: '#EF4444', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #EF4444 28%, transparent)' }}
            >
              <Radar className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-[#EF4444]" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Financial Risk Radar</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Exposição agregada · {criticalCount} riscos elevados</p>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[14px] font-semibold tabular-nums text-[#EF4444]">{formatCompactBRL(totalExposure)}</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">Exposição total</div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          {risks.map((r, i) => {
            const dm = DOMAIN_META[r.domain];
            const sm = SEVERITY_META[r.severity];
            const TrendIcon = r.trend === 'up' ? TrendingUp : r.trend === 'down' ? TrendingDown : Minus;
            const trendColor = r.trend === 'up' ? '#EF4444' : r.trend === 'down' ? '#10B981' : 'var(--ig-fg-muted)';
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className={cn(
                  'group relative overflow-hidden rounded-lg border p-3 transition-all hover:-translate-y-px',
                  'bg-[color:var(--ig-bg-raised)]/40 backdrop-blur-sm',
                )}
                style={{
                  borderColor: `color-mix(in oklab, ${sm.color} 26%, transparent)`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 14px -10px ${sm.color}`,
                }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-px"
                  style={{ background: `linear-gradient(90deg, transparent, ${sm.color}, transparent)` }}
                />
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{
                      color: dm.color,
                      borderColor: `color-mix(in oklab, ${dm.color} 32%, transparent)`,
                      background: `color-mix(in oklab, ${dm.color} 10%, transparent)`,
                    }}
                  >
                    {dm.icon}
                    {dm.label}
                  </span>
                  <SeverityMeter level={sm.level} color={sm.color} />
                </div>
                <h4 className="mt-2 text-[12px] font-semibold leading-tight text-[color:var(--ig-fg-strong)]">{r.label}</h4>
                <p className="mt-1 text-[10.5px] leading-snug text-[color:var(--ig-fg-muted)]">{r.detail}</p>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-[11.5px] font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">{formatCompactBRL(r.exposure)}</span>
                    <span className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">expos.</span>
                  </div>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums" style={{ color: trendColor }}>
                    <TrendIcon className="h-3 w-3" />
                    {r.trend === 'up' ? 'Crescente' : r.trend === 'down' ? 'Em redução' : 'Estável'}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function SeverityMeter({ level, color }: { level: number; color: string }) {
  return (
    <div className="flex items-center gap-0.5" title={`Severidade ${level}/4`}>
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className="h-2.5 w-1 rounded-sm"
          style={{
            background: i < level ? color : 'color-mix(in oklab, var(--ig-fg-subtle) 30%, transparent)',
            boxShadow: i < level ? `0 0 4px ${color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}
