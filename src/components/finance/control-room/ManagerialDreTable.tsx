'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Table2, ChevronRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL, formatPct } from './helpers';
import type { DreLine } from './types';

interface ManagerialDreTableProps {
  rows: DreLine[];
}

export function ManagerialDreTable({ rows }: ManagerialDreTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="">
        <header className="flex items-center justify-between border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklab, #14B8A6 14%, transparent)', color: '#14B8A6', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #14B8A6 28%, transparent)' }}
            >
              <Table2 className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">DRE Gerencial</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Estrutura completa · Realizado · Orçado · Projeção · Variação · Status</p>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">{rows.length} linhas</span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[color:var(--ig-bg-raised)]/85 backdrop-blur-md">
                <Th className="text-left">Linha DRE</Th>
                <Th className="text-right">Realizado</Th>
                <Th className="text-right">Orçado</Th>
                <Th className="text-right">Projeção</Th>
                <Th className="text-right">Var. R$</Th>
                <Th className="text-right">Var. %</Th>
                <Th className="text-center">Status</Th>
                <Th className="text-right">Ação</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const expand = expanded[r.key];
                const beneficial: 'positive' | 'negative' = r.emphasis === 'positive' ? 'positive' : 'negative';
                const tone = varianceTone(r.variance_abs, beneficial);
                const toneColor = tone === 'success' ? '#10B981' : tone === 'warning' ? '#F59E0B' : tone === 'danger' ? '#EF4444' : 'var(--ig-fg-muted)';
                return (
                  <React.Fragment key={r.key}>
                    <motion.tr
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, delay: i * 0.02 }}
                      className={cn(
                        'group transition-colors',
                        r.isSubtotal
                          ? 'bg-[color:var(--ig-bg-raised)]/40 font-semibold'
                          : 'hover:bg-[color:var(--ig-bg-raised)]/40',
                      )}
                    >
                      <Td className={cn('text-left', r.isSubtotal ? 'text-[color:var(--ig-fg-strong)]' : 'text-[color:var(--ig-fg-default)]')}>
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => ({ ...e, [r.key]: !e[r.key] }))}
                          className="flex items-center gap-1.5"
                        >
                          <ChevronRight
                            className={cn('h-3 w-3 text-[color:var(--ig-fg-subtle)] transition-transform', expand && 'rotate-90')}
                          />
                          <span className={r.isSubtotal ? 'tracking-tight' : ''}>{r.label}</span>
                          {r.isSubtotal && <span className="ml-1 h-1 w-1 rounded-full bg-[color:var(--ig-accent)]" />}
                        </button>
                      </Td>
                      <Td className="text-right tabular-nums">
                        <span className={r.isSubtotal ? 'text-[color:var(--ig-fg-strong)]' : 'text-[color:var(--ig-fg-default)]'}>{formatCompactBRL(r.actual)}</span>
                      </Td>
                      <Td className="text-right tabular-nums text-[color:var(--ig-fg-muted)]">{formatCompactBRL(r.budget)}</Td>
                      <Td className="text-right tabular-nums text-[color:var(--ig-fg-muted)]">{formatCompactBRL(r.forecast)}</Td>
                      <Td className="text-right tabular-nums" style={{ color: toneColor }}>
                        {r.variance_abs >= 0 ? '+' : ''}{formatCompactBRL(r.variance_abs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        <span
                          className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            color: toneColor,
                            borderColor: `color-mix(in oklab, ${toneColor} 30%, transparent)`,
                            background: `color-mix(in oklab, ${toneColor} 10%, transparent)`,
                          }}
                        >
                          {formatPct(r.variance_pct)}
                        </span>
                      </Td>
                      <Td className="text-center">
                        <StatusDot tone={tone} />
                      </Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ig-border-strong)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--ig-fg-muted)] transition-all hover:border-[color:var(--ig-border-focus)] hover:text-[color:var(--ig-accent)]"
                        >
                          Drill
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      </Td>
                    </motion.tr>
                    {expand && (
                      <tr className="bg-[color:var(--ig-bg-canvas)]/40">
                        <td colSpan={8} className="border-b border-[color:var(--ig-border-subtle)] px-8 py-2.5">
                          <div className="grid grid-cols-4 gap-3 text-[11px]">
                            <ExpandStat label="Mês corrente" value={formatCompactBRL(r.actual / 3)} />
                            <ExpandStat label="Acumulado YTD" value={formatCompactBRL(r.actual)} />
                            <ExpandStat label="Taxa anual" value={formatCompactBRL(r.actual * 4)} />
                            <ExpandStat label="Δ Projeção" value={formatCompactBRL(r.forecast - r.actual)} tone={r.forecast > r.actual ? 'positive' : 'negative'} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

function varianceTone(varianceAbs: number, beneficial: 'positive' | 'negative'): 'success' | 'warning' | 'danger' | 'neutral' {
  if (Math.abs(varianceAbs) < 1_000_000) return 'neutral';
  const isPositive = varianceAbs > 0;
  const isFavorable = beneficial === 'positive' ? isPositive : !isPositive;
  if (isFavorable) return 'success';
  if (Math.abs(varianceAbs) > 10_000_000) return 'danger';
  return 'warning';
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-[color:var(--ig-border-strong)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <td className={cn('border-b border-[color:var(--ig-border-subtle)] px-4 py-2.5 text-[12px]', className)} style={style}>
      {children}
    </td>
  );
}

function StatusDot({ tone }: { tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const color = tone === 'success' ? '#10B981' : tone === 'warning' ? '#F59E0B' : tone === 'danger' ? '#EF4444' : '#64748B';
  return (
    <span className="inline-flex items-center justify-center">
      <span className="relative flex h-2 w-2">
        {tone !== 'neutral' && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
            style={{ background: color }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </span>
    </span>
  );
}

function ExpandStat({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  const color = tone === 'positive' ? '#10B981' : tone === 'negative' ? '#EF4444' : 'var(--ig-fg-strong)';
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 px-2.5 py-1.5">
      <span className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">{label}</span>
      <span className="text-[11.5px] font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}
