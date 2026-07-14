'use client';

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Grid3x3, ArrowDownUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL, formatPct } from './helpers';
import type { CostCenterHeatmapData } from './types';

interface CostCenterHeatmapProps {
  data: CostCenterHeatmapData;
}

function variancePalette(pct: number, hasData: boolean): { bg: string; fg: string; ring: string } {
  if (!hasData) {
    return {
      bg: 'color-mix(in oklab, var(--ig-bg-raised) 70%, transparent)',
      fg: 'var(--ig-fg-subtle)',
      ring: 'var(--ig-border-subtle)',
    };
  }
  const abs = Math.abs(pct);
  // Negative variance (under budget) is favorable for costs → green
  // Positive variance (over budget) is unfavorable → amber/red
  let color: string;
  let intensity: number;
  if (pct > 25) { color = '#EF4444'; intensity = 0.85; }
  else if (pct > 10) { color = '#EF4444'; intensity = 0.55; }
  else if (pct > 0) { color = '#F59E0B'; intensity = 0.40; }
  else if (pct < -10) { color = '#10B981'; intensity = 0.55; }
  else if (pct < 0) { color = '#10B981'; intensity = 0.35; }
  else { color = '#64748B'; intensity = 0.20; }

  return {
    bg: `color-mix(in oklab, ${color} ${Math.round(intensity * 100)}%, transparent)`,
    fg: abs > 10 ? '#F2F5F7' : color,
    ring: `color-mix(in oklab, ${color} 40%, transparent)`,
  };
}

export function CostCenterHeatmap({ data }: CostCenterHeatmapProps) {
  const [hover, setHover] = useState<{ cc: string; cat: string } | null>(null);

  const getCell = (cc: string, cat: string) => data.cells.find((c) => c.cc === cc && c.category === cat);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
              style={{ background: 'color-mix(in oklab, #F43F5E 14%, transparent)', color: '#F43F5E', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #F43F5E 28%, transparent)' }}
            >
              <Grid3x3 className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Mapa de Calor por Centro de Custo</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Desvio % vs Orçado por categoria × centro de custo</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <ScaleSwatch color="#10B981" label="≤ −10%" />
            <ScaleSwatch color="#10B981" label="−10–0%" muted />
            <ScaleSwatch color="#F59E0B" label="0–10%" />
            <ScaleSwatch color="#EF4444" label="10–25%" />
            <ScaleSwatch color="#EF4444" label="> 25%" intense />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div
            className="grid h-full w-full gap-[3px]"
            style={{
              gridTemplateColumns: `minmax(96px, 0.9fr) repeat(${data.costCenters.length}, minmax(0, 1fr))`,
              gridTemplateRows: `auto repeat(${data.categories.length}, minmax(0, 1fr))`,
            }}
          >
            <div />
            {data.costCenters.map((cc) => (
              <div key={cc} className="truncate px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
                {cc}
              </div>
            ))}

            {data.categories.map((cat) => (
              <React.Fragment key={cat}>
                <div className="flex min-w-0 items-center px-2 text-[11px] font-medium text-[color:var(--ig-fg-default)]">
                  <span className="truncate">{cat}</span>
                </div>
                {data.costCenters.map((cc) => {
                  const cell = getCell(cc, cat);
                  const hasData = !!cell && (cell.actual !== 0 || cell.budget !== 0);
                  const variance = cell?.variance_pct ?? 0;
                  const palette = variancePalette(variance, hasData);
                  const isHover = hover?.cc === cc && hover?.cat === cat;
                  return (
                    <button
                      key={`${cc}-${cat}`}
                      type="button"
                      onMouseEnter={() => setHover({ cc, cat })}
                      onMouseLeave={() => setHover(null)}
                      className={cn(
                        'group relative flex h-full min-h-0 w-full items-center justify-center rounded-md border text-[11px] font-semibold tabular-nums transition-all',
                        'hover:scale-[1.04]',
                      )}
                      style={{
                        background: palette.bg,
                        color: palette.fg,
                        borderColor: palette.ring,
                        boxShadow: isHover ? `0 6px 18px -8px ${palette.ring}` : undefined,
                      }}
                    >
                      {hasData ? formatPct(variance, 0) : <span className="text-[10px] opacity-40">—</span>}
                      <span
                        className="absolute inset-x-1 top-0 h-px opacity-60"
                        style={{ background: 'rgba(255,255,255,0.20)' }}
                      />
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-[color:var(--ig-border-subtle)] px-5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">
            <ArrowDownUp className="h-3 w-3" /> Apenas cells com movimentação
          </div>
          {hover && (() => {
            const cell = getCell(hover.cc, hover.cat);
            if (!cell || (cell.actual === 0 && cell.budget === 0)) return null;
            return (
              <div className="flex items-center gap-3 text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">
                <span>{hover.cc} · {hover.cat}</span>
                <span>Real: <span className="text-[color:var(--ig-fg-strong)]">{formatCompactBRL(cell.actual)}</span></span>
                <span>Bdg: <span className="text-[color:var(--ig-fg-strong)]">{formatCompactBRL(cell.budget)}</span></span>
              </div>
            );
          })()}
        </footer>
      </div>
    </motion.div>
  );
}

function ScaleSwatch({ color, label, muted, intense }: { color: string; label: string; muted?: boolean; intense?: boolean }) {
  const opacity = intense ? 0.85 : muted ? 0.30 : 0.55;
  return (
    <span className="flex items-center gap-1 text-[color:var(--ig-fg-muted)]">
      <span className="h-2.5 w-3 rounded-sm border" style={{ background: `color-mix(in oklab, ${color} ${opacity * 100}%, transparent)`, borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }} />
      {label}
    </span>
  );
}
