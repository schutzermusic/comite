'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Gavel, ArrowRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL } from './helpers';
import type { ExecutiveDecisionItem } from './types';

interface ExecutiveDecisionQueueProps {
  items: ExecutiveDecisionItem[];
}

const PRIORITY_META: Record<ExecutiveDecisionItem['priority'], { color: string; label: string }> = {
  high: { color: '#EF4444', label: 'Alta' },
  medium: { color: '#F59E0B', label: 'Média' },
  low: { color: '#10B981', label: 'Baixa' },
};

export function ExecutiveDecisionQueue({ items }: ExecutiveDecisionQueueProps) {
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
              style={{ background: 'color-mix(in oklab, #14B8A6 14%, transparent)', color: '#14B8A6', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #14B8A6 28%, transparent)' }}
            >
              <Gavel className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Executive Decision Queue</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Decisões financeiras com SLA · {items.length} ativas</p>
            </div>
          </div>
        </header>

        <div className="flex-1 divide-y divide-[color:var(--ig-border-subtle)] overflow-y-auto">
          {items.map((d, i) => {
            const pm = PRIORITY_META[d.priority];
            const overSla = d.aging_days * 24 > d.sla_hours;
            const slaColor = overSla ? '#EF4444' : d.aging_days >= 3 ? '#F59E0B' : '#10B981';
            return (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[color:var(--ig-bg-raised)]/40"
              >
                <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 font-mono text-[12px] font-bold tabular-nums" style={{ color: slaColor }}>
                  {d.aging_days}d
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full" style={{ background: slaColor, boxShadow: `0 0 6px ${slaColor}` }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-[12px] font-semibold leading-tight text-[color:var(--ig-fg-strong)]">{d.title}</h4>
                    <span
                      className="flex-shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                      style={{
                        color: pm.color,
                        borderColor: `color-mix(in oklab, ${pm.color} 30%, transparent)`,
                        background: `color-mix(in oklab, ${pm.color} 10%, transparent)`,
                      }}
                    >
                      {pm.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-[color:var(--ig-fg-muted)]">
                    <span>{d.category}</span>
                    <span>·</span>
                    <span>{d.owner}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      SLA {d.sla_hours}h
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-mono text-[12px] font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">
                      {formatCompactBRL(d.impact)}
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ig-border-strong)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ig-fg-default)] transition-all hover:border-[color:var(--ig-border-focus)] hover:text-[color:var(--ig-accent)]"
                    >
                      Decidir
                      <ArrowRight className="h-3 w-3" />
                    </button>
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
