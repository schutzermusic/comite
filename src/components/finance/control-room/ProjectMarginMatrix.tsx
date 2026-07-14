'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { FolderKanban, ArrowUpRight, AlertTriangle, CheckCircle2, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL, formatPct } from './helpers';
import type { ProjectMarginRow } from './types';

interface ProjectMarginMatrixProps {
  rows: ProjectMarginRow[];
}

const STATUS_META: Record<ProjectMarginRow['status'], { color: string; label: string; icon: React.ReactNode }> = {
  healthy: { color: '#10B981', label: 'Saudável', icon: <CheckCircle2 className="h-3 w-3" /> },
  watch: { color: '#F59E0B', label: 'Atenção', icon: <Eye className="h-3 w-3" /> },
  critical: { color: '#EF4444', label: 'Crítico', icon: <AlertTriangle className="h-3 w-3" /> },
};

export function ProjectMarginMatrix({ rows }: ProjectMarginMatrixProps) {
  const sorted = [...rows].sort((a, b) => b.margin_pct - a.margin_pct);
  const maxMargin = Math.max(...sorted.map((r) => Math.abs(r.margin_pct)));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative h-full w-full"
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
              style={{ background: 'color-mix(in oklab, #22D3EE 14%, transparent)', color: '#22D3EE', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #22D3EE 28%, transparent)' }}
            >
              <FolderKanban className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Margem por Projeto</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Performance unitária · Receita · Custo · Variação</p>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">{sorted.length} projetos</span>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="grid grid-cols-[1fr_72px_72px_60px_60px_64px_28px] items-center gap-2 border-b border-[color:var(--ig-border-subtle)] px-2 pb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">
            <span>Projeto</span>
            <span className="text-right">Receita</span>
            <span className="text-right">Custo</span>
            <span className="text-right">Margem</span>
            <span className="text-right">Var.</span>
            <span className="text-center">Status</span>
            <span />
          </div>

          <div className="flex flex-col">
            {sorted.map((r, i) => {
              const meta = STATUS_META[r.status];
              const widthPct = (Math.abs(r.margin_pct) / maxMargin) * 100;
              return (
                <motion.div
                  key={r.project_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.03 }}
                  className={cn(
                    'group relative grid grid-cols-[1fr_72px_72px_60px_60px_64px_28px] items-center gap-2 rounded-md px-2 py-2',
                    'transition-colors hover:bg-[color:var(--ig-bg-raised)]/60',
                  )}
                >
                  <div
                    className="absolute inset-y-1 left-2 rounded-sm opacity-[0.06] group-hover:opacity-[0.12]"
                    style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${meta.color}, transparent)` }}
                  />
                  <div className="relative min-w-0">
                    <div className="truncate text-[12px] font-medium text-[color:var(--ig-fg-strong)]">{r.project_name}</div>
                    {r.client && (
                      <div className="text-[10px] text-[color:var(--ig-fg-muted)]">{r.client}</div>
                    )}
                  </div>
                  <div className="relative text-right text-[11px] tabular-nums text-[color:var(--ig-fg-default)]">{formatCompactBRL(r.revenue)}</div>
                  <div className="relative text-right text-[11px] tabular-nums text-[color:var(--ig-fg-muted)]">{formatCompactBRL(r.cost)}</div>
                  <div className="relative text-right text-[12px] font-semibold tabular-nums" style={{ color: meta.color }}>
                    {r.margin_pct.toFixed(1)}%
                  </div>
                  <div className={cn('relative text-right text-[11px] tabular-nums', r.variance_pct >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]')}>
                    {formatPct(r.variance_pct)}
                  </div>
                  <div className="relative flex justify-center">
                    <span
                      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                      style={{
                        color: meta.color,
                        borderColor: `color-mix(in oklab, ${meta.color} 32%, transparent)`,
                        background: `color-mix(in oklab, ${meta.color} 12%, transparent)`,
                      }}
                    >
                      {meta.icon}
                    </span>
                  </div>
                  <div className="relative flex justify-end">
                    <Link
                      href={`/projetos/${r.project_id}`}
                      title="Abrir DRE do projeto"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--ig-border-strong)] text-[color:var(--ig-fg-muted)] transition-all hover:border-[color:var(--ig-border-focus)] hover:text-[color:var(--ig-accent)]"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-[color:var(--ig-border-subtle)] px-5 py-2.5">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">DRE Gerencial · Realizado vs Plano</span>
          <Link href="/financeiro/lancamentos" className="text-[11px] font-medium text-[color:var(--ig-accent)] hover:underline">
            Ver lançamentos →
          </Link>
        </footer>
      </div>
    </motion.div>
  );
}
