'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCompactBRL, periodLabel } from './helpers';
import type { ForecastPoint } from './types';

interface ForecastScenarioChartProps {
  data: ForecastPoint[];
}

type SeriesKey = 'actual' | 'budget' | 'forecast' | 'board';

const SERIES: { key: SeriesKey; label: string; color: string; dashed?: boolean }[] = [
  { key: 'actual', label: 'Realizado', color: '#14B8A6' },
  { key: 'budget', label: 'Orçado', color: '#818CF8', dashed: true },
  { key: 'forecast', label: 'Forecast', color: '#F59E0B' },
  { key: 'board', label: 'Board Approved', color: '#A78BFA', dashed: true },
];

export function ForecastScenarioChart({ data }: ForecastScenarioChartProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState<SeriesKey | null>(null);

  const { paths, points, xPositions, yMin, yMax, scaleY } = useMemo(() => {
    const all = data.flatMap((p) => [p.actual, p.budget, p.forecast, p.board].filter((v): v is number => v !== undefined));
    const yMin = Math.min(...all) * 0.92;
    const yMax = Math.max(...all) * 1.08;

    const w = 760;
    const h = 240;
    const padX = 36;
    const padTop = 12;
    const padBottom = 24;
    const innerW = w - padX * 2;
    const innerH = h - padTop - padBottom;

    const xPositions = data.map((_, i) => padX + (i / (data.length - 1)) * innerW);
    const scaleY = (v: number) => padTop + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const buildPath = (key: SeriesKey) => {
      let d = '';
      let started = false;
      data.forEach((p, i) => {
        const v = p[key];
        if (v === undefined) {
          started = false;
          return;
        }
        const x = xPositions[i];
        const y = scaleY(v);
        if (!started) {
          d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
          started = true;
        } else {
          d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }
      });
      return d;
    };

    const buildArea = (key: SeriesKey) => {
      const path = buildPath(key);
      if (!path) return '';
      const firstX = path.match(/M\s([\d.]+)/)?.[1] ?? padX;
      const lastIdx = (() => {
        for (let i = data.length - 1; i >= 0; i--) {
          if (data[i][key] !== undefined) return i;
        }
        return data.length - 1;
      })();
      const lastX = xPositions[lastIdx];
      return `${path} L ${lastX.toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${firstX} ${(padTop + innerH).toFixed(1)} Z`;
    };

    const paths: Record<SeriesKey, { line: string; area: string }> = {
      actual: { line: buildPath('actual'), area: buildArea('actual') },
      budget: { line: buildPath('budget'), area: buildArea('budget') },
      forecast: { line: buildPath('forecast'), area: buildArea('forecast') },
      board: { line: buildPath('board'), area: buildArea('board') },
    };

    const points: Record<SeriesKey, { x: number; y: number; v: number }[]> = {
      actual: [],
      budget: [],
      forecast: [],
      board: [],
    };

    data.forEach((p, i) => {
      (['actual', 'budget', 'forecast', 'board'] as SeriesKey[]).forEach((k) => {
        const v = p[k];
        if (v !== undefined) {
          points[k].push({ x: xPositions[i], y: scaleY(v), v });
        }
      });
    });

    return { paths, points, xPositions, yMin, yMax, scaleY };
  }, [data]);

  const w = 760;
  const h = 240;
  const padTop = 12;
  const padBottom = 24;
  const innerH = h - padTop - padBottom;

  const colors = {
    grid: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(170,200,190,0.07)',
    axis: isLight ? '#475569' : 'rgba(242,245,247,0.50)',
  };

  const yTicks = 4;

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
        <header className="flex items-start justify-between border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklab, #F59E0B 14%, transparent)', color: '#F59E0B', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #F59E0B 28%, transparent)' }}
            >
              <LineChart className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Forecast vs Realizado</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Receita líquida · 12 meses · 4 cenários</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {SERIES.map((s) => {
              const active = focusKey === null || focusKey === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setFocusKey(focusKey === s.key ? null : s.key)}
                  className={cn(
                    'group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold transition-all',
                    active
                      ? 'border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/50'
                      : 'border-transparent opacity-50 hover:opacity-100',
                  )}
                  style={{ color: s.color }}
                >
                  <span
                    className={cn('h-2 w-3', s.dashed ? 'border-t-[2px] border-dashed' : '')}
                    style={s.dashed ? { borderColor: s.color } : { background: s.color, borderRadius: 2 }}
                  />
                  {s.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex-1 overflow-x-auto px-5 py-3">
          <div className="relative" style={{ minWidth: w }}>
            <svg
              width={w}
              height={h}
              onMouseMove={(e) => {
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const x = e.clientX - rect.left;
                let nearest = 0;
                let dist = Infinity;
                xPositions.forEach((px, i) => {
                  const d = Math.abs(px - x);
                  if (d < dist) { dist = d; nearest = i; }
                });
                setHoverIndex(nearest);
              }}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`fc-area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity="0.20" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>

              {/* Grid */}
              {Array.from({ length: yTicks + 1 }).map((_, i) => {
                const y = padTop + (innerH / yTicks) * i;
                const v = yMax - ((yMax - yMin) / yTicks) * i;
                return (
                  <g key={i}>
                    <line x1={36} y1={y} x2={w - 12} y2={y} stroke={colors.grid} strokeWidth="0.7" strokeDasharray="2 4" />
                    <text x={32} y={y + 3} textAnchor="end" fontSize="9" fill={colors.axis} fontFamily="ui-monospace, monospace">
                      {formatCompactBRL(v).replace('R$ ', '')}
                    </text>
                  </g>
                );
              })}

              {/* X-axis ticks */}
              {data.map((p, i) => (
                <text key={i} x={xPositions[i]} y={h - 6} textAnchor="middle" fontSize="9" fill={colors.axis}>
                  {periodLabel(p.period)}
                </text>
              ))}

              {/* Hover guideline */}
              {hoverIndex !== null && (
                <line
                  x1={xPositions[hoverIndex]}
                  y1={padTop}
                  x2={xPositions[hoverIndex]}
                  y2={h - padBottom}
                  stroke="color-mix(in oklab, var(--ig-fg-strong) 40%, transparent)"
                  strokeWidth="0.6"
                  strokeDasharray="2 3"
                />
              )}

              {/* Areas */}
              {SERIES.map((s) => {
                const dim = focusKey !== null && focusKey !== s.key;
                if (s.dashed) return null;
                return (
                  <path
                    key={`area-${s.key}`}
                    d={paths[s.key].area}
                    fill={`url(#fc-area-${s.key})`}
                    opacity={dim ? 0.1 : 1}
                    style={{ transition: 'opacity 0.3s' }}
                  />
                );
              })}

              {/* Lines */}
              {SERIES.map((s) => {
                const dim = focusKey !== null && focusKey !== s.key;
                return (
                  <path
                    key={`line-${s.key}`}
                    d={paths[s.key].line}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={focusKey === s.key ? 2.4 : 1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={s.dashed ? '6 3' : undefined}
                    opacity={dim ? 0.18 : 1}
                    style={{ transition: 'opacity 0.3s, stroke-width 0.2s' }}
                  />
                );
              })}

              {/* Hover dots */}
              {hoverIndex !== null && SERIES.map((s) => {
                const v = data[hoverIndex][s.key];
                if (v === undefined) return null;
                const dim = focusKey !== null && focusKey !== s.key;
                return (
                  <g key={`dot-${s.key}`} opacity={dim ? 0.2 : 1}>
                    <circle cx={xPositions[hoverIndex]} cy={scaleY(v)} r="6" fill={s.color} opacity="0.18" />
                    <circle cx={xPositions[hoverIndex]} cy={scaleY(v)} r="3" fill={s.color} />
                    <circle cx={xPositions[hoverIndex]} cy={scaleY(v)} r="3" fill="none" stroke={isLight ? '#fff' : '#0a0e14'} strokeWidth="1.2" />
                  </g>
                );
              })}
            </svg>

            {hoverIndex !== null && (
              <ChartTooltip
                point={data[hoverIndex]}
                left={xPositions[hoverIndex] > w / 2 ? undefined : xPositions[hoverIndex] + 12}
                right={xPositions[hoverIndex] > w / 2 ? w - xPositions[hoverIndex] + 12 : undefined}
              />
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-[color:var(--ig-border-subtle)] px-5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">
            <Sparkles className="h-3 w-3" /> Convergência Forecast → Board: Jul/26
          </div>
          <span className="font-mono text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">
            Gap acum.: <span className="text-[#F59E0B]">−R$ 28M</span>
          </span>
        </footer>
      </div>
    </motion.div>
  );
}

function ChartTooltip({ point, left, right }: { point: ForecastPoint; left?: number; right?: number }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-3 w-[180px] rounded-xl border border-[color:var(--ig-border-strong)]',
        'bg-[color:var(--ig-bg-raised)]/95 p-2.5 backdrop-blur-md',
        'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]',
      )}
      style={{ left, right }}
    >
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ig-fg-subtle)]">{periodLabel(point.period)}</div>
      <div className="flex flex-col gap-1">
        {SERIES.map((s) => {
          const v = point[s.key];
          if (v === undefined) return null;
          return (
            <div key={s.key} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-[color:var(--ig-fg-muted)]">
                <span className="h-1.5 w-1.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-mono font-semibold tabular-nums" style={{ color: s.color }}>{formatCompactBRL(v)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
