'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL, formatPct } from './helpers';
import type { TopDriver } from '@/lib/types/finance';

interface TopVariationsPanelProps {
  drivers: TopDriver[];
}

export function TopVariationsPanel({ drivers }: TopVariationsPanelProps) {
  const top = drivers.slice(0, 6);
  const maxAbs = Math.max(...top.map((d) => Math.abs(d.variance_abs)), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
              style={{ background: 'color-mix(in oklab, #F59E0B 14%, transparent)', color: '#F59E0B', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #F59E0B 28%, transparent)' }}
            >
              <Flame className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Maiores Variações</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Top desvios por categoria · impacto em R$</p>
            </div>
          </div>
        </header>

        <div className="flex-1 divide-y divide-[color:var(--ig-border-subtle)]">
          {top.length === 0 && (
            <div className="flex h-full items-center justify-center px-5 py-10 text-[11px] text-[color:var(--ig-fg-muted)]">
              Sem variações relevantes no período.
            </div>
          )}
          {top.map((d, i) => {
            const isOver = d.variance_abs > 0;
            const color = isOver ? '#EF4444' : '#10B981';
            const widthPct = (Math.abs(d.variance_abs) / maxAbs) * 100;
            return (
              <motion.div
                key={`${d.category_id}-${d.project_id ?? 'corp'}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className="relative px-5 py-3"
              >
                <div
                  className="absolute inset-y-2 left-5 rounded-sm opacity-[0.10]"
                  style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${color}, transparent)` }}
                />
                <div className="relative flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-semibold"
                        style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
                      >
                        {d.rank}
                      </span>
                      <h4 className="truncate text-[12px] font-semibold text-[color:var(--ig-fg-strong)]">{d.category_name}</h4>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[color:var(--ig-fg-muted)]">
                      <span>{d.group_label}</span>
                      <span>·</span>
                      <span className="truncate">{d.project_name ?? 'Corporativo'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={cn('flex items-center gap-1 font-mono text-[12px] font-semibold tabular-nums')} style={{ color }}>
                      {isOver ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {isOver ? '+' : ''}{formatCompactBRL(d.variance_abs)}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">{formatPct(d.variance_pct)}</span>
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
