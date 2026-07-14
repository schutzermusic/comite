'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { GitBranch, Sparkles, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCompactBRL, formatPct } from './helpers';
import type { DreLine } from './types';

interface DreIntelligenceBridgeProps {
  rows: DreLine[];
  scenarioLabel: string;
}

interface BarSpec {
  key: string;
  label: string;
  type: 'subtotal' | 'positive' | 'negative';
  value: number;
  budget: number;
  forecast: number;
  varianceAbs: number;
  variancePct: number;
  yStart: number;
  yEnd: number;
  budgetY: number;
  forecastY: number;
}

export function DreIntelligenceBridge({ rows, scenarioLabel }: DreIntelligenceBridgeProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 320 });

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: Math.max(320, r.width), h: Math.max(220, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { bars, height, baseLine, totalWidth, barWidth, slotWidth, padX, padY, axisLabelH, gridValues, scaleY } = useMemo(() => {
    const stageOrder = [
      'gross_revenue',
      'deductions',
      'net_revenue',
      'direct_cost',
      'gross_margin',
      'opex',
      'ebitda',
      'financial',
      'taxes',
      'net_result',
    ];
    const ordered = stageOrder
      .map((k) => rows.find((r) => r.key === k))
      .filter((r): r is DreLine => Boolean(r));

    let running = 0;
    const stages: { key: string; label: string; type: 'subtotal' | 'positive' | 'negative'; value: number; budget: number; forecast: number; varianceAbs: number; variancePct: number; bottom: number; top: number; budgetTop: number; forecastTop: number }[] = [];

    for (const r of ordered) {
      const isSubtotal = r.isSubtotal;
      let bottom = 0;
      let top = 0;
      if (isSubtotal) {
        running = r.actual;
        bottom = 0;
        top = r.actual;
      } else {
        bottom = Math.min(running, running + r.actual);
        top = Math.max(running, running + r.actual);
        running += r.actual;
      }
      const type: 'subtotal' | 'positive' | 'negative' = isSubtotal
        ? 'subtotal'
        : r.actual >= 0
          ? 'positive'
          : 'negative';
      stages.push({
        key: r.key,
        label: r.label,
        type,
        value: r.actual,
        budget: r.budget,
        forecast: r.forecast,
        varianceAbs: r.variance_abs,
        variancePct: r.variance_pct,
        bottom,
        top,
        budgetTop: r.budget,
        forecastTop: r.forecast,
      });
    }

    // Escala definida apenas pelas posições das barras (totais acumulados, sempre positivos).
    // Budget/forecast são marcadores e não distorcem a escala vertical.
    const barValues = stages.flatMap((s) => [s.bottom, s.top]);
    const minV = Math.min(0, ...barValues);
    const maxV = Math.max(...barValues);
    const valueSpan = Math.max(1, maxV - minV);
    const padding = valueSpan * 0.03;
    // Se todos os valores são positivos, coloca zero exatamente na base (sem espaço extra abaixo)
    const yMin = minV >= 0 ? 0 : minV - padding * 0.5;
    const yMax = maxV + padding;

    const axisLabelH = 40;
    const padX = 14;
    const padY = 16; // espaço para labels de valor acima das barras
    const height = Math.max(180, size.h - axisLabelH - padY);

    const totalWidth = Math.max(320, size.w);
    const innerWidth = totalWidth - padX * 2;
    const n = Math.max(1, stages.length);
    const ratio = 0.86;
    const slotWidth = innerWidth / n;
    const barWidth = Math.max(20, slotWidth * ratio);

    const scaleY = (v: number) => padY + height - ((v - yMin) / (yMax - yMin)) * height;
    const baseLine = scaleY(0);

    // Intervalos do grid baseados na escala real dos dados
    const gridCount = 5;
    const gridValues = Array.from({ length: gridCount }, (_, i) => yMin + (yMax - yMin) * (i / (gridCount - 1)));

    const bars: BarSpec[] = stages.map((s) => ({
      key: s.key,
      label: s.label,
      type: s.type,
      value: s.value,
      budget: s.budget,
      forecast: s.forecast,
      varianceAbs: s.varianceAbs,
      variancePct: s.variancePct,
      yStart: scaleY(s.bottom),
      yEnd: scaleY(s.top),
      budgetY: scaleY(s.budgetTop),
      forecastY: scaleY(s.forecastTop),
    }));

    return { bars, height, baseLine, totalWidth, barWidth, slotWidth, padX, padY, axisLabelH, gridValues, scaleY };
  }, [rows, size.w, size.h]);

  const colors = {
    subtotal: isLight ? '#0F766E' : '#14B8A6',
    positive: isLight ? '#15803D' : '#34D399',
    negative: isLight ? '#B91C1C' : '#F87171',
    grid: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(170,200,190,0.08)',
    axis: isLight ? '#475569' : 'rgba(242,245,247,0.50)',
    budget: isLight ? '#4F46E5' : '#818CF8',
    forecast: isLight ? '#B45309' : '#F59E0B',
  };

  const hoverBar = bars.find((b) => b.key === hoverKey);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative h-full min-h-[460px] w-full overflow-hidden md:min-h-[500px] lg:min-h-0"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="flex h-full flex-col">
        <header className="flex flex-col gap-2 border-b border-[color:var(--ig-border-subtle)] px-4 py-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{
                backgroundColor: 'color-mix(in oklab, #14B8A6 14%, transparent)',
                color: '#14B8A6',
                boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #14B8A6 28%, transparent)',
              }}
            >
              <GitBranch className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">
                Bridge Inteligente do DRE
              </h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">
                Bridge analítico Receita → Resultado · {scenarioLabel}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.18em] xl:justify-end">
            <LegendDot color={colors.subtotal} label="Subtotal" />
            <LegendDot color={colors.positive} label="Contribuição (+)" />
            <LegendDot color={colors.negative} label="Contribuição (−)" />
            <LegendLine color={colors.budget} label="Orçado" />
            <LegendLine color={colors.forecast} label="Projeção" />
          </div>
        </header>

        <div ref={chartRef} className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 px-2 py-1.5">
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${totalWidth} ${padY + height + axisLabelH}`}
              className="block h-full w-full"
            >
              <defs>
                <linearGradient id="dre-pos-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.positive} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={colors.positive} stopOpacity="0.55" />
                </linearGradient>
                <linearGradient id="dre-neg-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.negative} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={colors.negative} stopOpacity="0.55" />
                </linearGradient>
                <linearGradient id="dre-sub-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.subtotal} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={colors.subtotal} stopOpacity="0.55" />
                </linearGradient>
                <filter id="dre-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Grid lines — alinhadas à escala real */}
              {gridValues.map((v, i) => {
                const y = scaleY(v);
                return (
                  <line key={i} x1={padX} y1={y} x2={totalWidth - padX} y2={y} stroke={colors.grid} strokeWidth="0.6" strokeDasharray="2 4" />
                );
              })}

              {/* Zero baseline */}
              <line x1={padX} y1={baseLine} x2={totalWidth - padX} y2={baseLine} stroke={colors.axis} strokeWidth="0.7" opacity="0.6" />

              {/* Connectors */}
              {bars.map((b, i) => {
                if (i === bars.length - 1) return null;
                const x = padX + i * slotWidth + (slotWidth - barWidth) / 2;
                const nextX = padX + (i + 1) * slotWidth + (slotWidth - barWidth) / 2;
                const x1 = x + barWidth;
                const x2 = nextX;
                const y = b.type === 'subtotal' || b.value >= 0 ? Math.min(b.yStart, b.yEnd) : Math.max(b.yStart, b.yEnd);
                return (
                  <line
                    key={`c-${b.key}`}
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={y}
                    stroke={colors.axis}
                    strokeWidth="0.8"
                    strokeDasharray="2 3"
                    opacity="0.45"
                  />
                );
              })}

              {/* Bars */}
              {bars.map((b, i) => {
                const x = padX + i * slotWidth + (slotWidth - barWidth) / 2;
                const y = Math.min(b.yStart, b.yEnd);
                const h = Math.max(2, Math.abs(b.yEnd - b.yStart));
                const fill = b.type === 'subtotal' ? 'url(#dre-sub-grad)' : b.type === 'positive' ? 'url(#dre-pos-grad)' : 'url(#dre-neg-grad)';
                const strokeColor = b.type === 'subtotal' ? colors.subtotal : b.type === 'positive' ? colors.positive : colors.negative;
                const isHover = hoverKey === b.key;
                return (
                  <g key={b.key} onMouseEnter={() => setHoverKey(b.key)} onMouseLeave={() => setHoverKey(null)} style={{ cursor: 'pointer' }}>
                    <rect x={x} y={y} width={barWidth} height={h} rx={3} fill={fill} stroke={strokeColor} strokeWidth={isHover ? 1.2 : 0.6} filter={isHover ? 'url(#dre-glow)' : undefined} />
                    <rect x={x} y={y} width={barWidth} height={2} fill="rgba(255,255,255,0.18)" rx={2} />

                    {/* Marcadores orçado/forecast — só em subtotais, clampados dentro da barra */}
                    {b.type === 'subtotal' && (() => {
                      const barTop = y;
                      const barBot = y + h;
                      const bY = Math.min(barBot - 1, Math.max(barTop + 1, b.budgetY));
                      const fY = Math.min(barBot - 1, Math.max(barTop + 1, b.forecastY));
                      const inset = barWidth * 0.08;
                      return (
                        <>
                          <line x1={x + inset} y1={bY} x2={x + barWidth - inset} y2={bY} stroke={colors.budget} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.75" />
                          <line x1={x + inset} y1={fY} x2={x + barWidth - inset} y2={fY} stroke={colors.forecast} strokeWidth="1.5" opacity="0.75" />
                        </>
                      );
                    })()}


                    {/* Value label — dentro da barra se couber, senão acima com clamp */}
                    {(() => {
                      const barH = Math.abs(b.yEnd - b.yStart);
                      const barTop = Math.min(b.yStart, b.yEnd);
                      const insideBar = barH >= 18;
                      const rawY = insideBar
                        ? barTop + barH / 2 + 4
                        : (b.type === 'subtotal' || b.value >= 0 ? barTop - 4 : barTop + barH + 12);
                      const clampedY = Math.max(padY - 2, rawY);
                      return (
                        <text
                          x={x + barWidth / 2}
                          y={clampedY}
                          textAnchor="middle"
                          className="tabular-nums"
                          fill={insideBar ? 'rgba(255,255,255,0.9)' : colors.axis}
                          fontSize="9.5"
                          fontWeight="600"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {formatCompactBRL(b.value)}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* X-axis labels */}
              {bars.map((b, i) => {
                const cx = padX + i * slotWidth + slotWidth / 2;
                return (
                  <g key={`l-${b.key}`} transform={`translate(${cx}, ${padY + height + 10})`}>
                    <text textAnchor="middle" fontSize="9.5" fill={colors.axis} fontWeight="500">
                      {b.label.length > 14 ? b.label.split(' ').map((w, wi) => (
                        <tspan key={wi} x="0" dy={wi === 0 ? 0 : 11}>{w}</tspan>
                      )) : b.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {hoverBar && <BridgeTooltip bar={hoverBar} />}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[color:var(--ig-border-subtle)] px-4 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">
            <Activity className="h-3 w-3" /> Bridge gerado a partir do Plano de Contas Gerencial
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--ig-fg-muted)]">
            <Sparkles className="h-3 w-3" style={{ color: '#A78BFA' }} />
            Hover em cada estágio para detalhar variação
          </div>
        </footer>
      </div>
    </motion.div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[color:var(--ig-fg-muted)]">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[color:var(--ig-fg-muted)]">
      <span className="h-px w-3.5" style={{ background: color }} />
      {label}
    </span>
  );
}

function BridgeTooltip({ bar }: { bar: BarSpec }) {
  const variancePos = bar.varianceAbs >= 0;
  const varianceColor = variancePos ? '#10B981' : '#EF4444';
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'pointer-events-none absolute right-2 top-2 w-[230px] rounded-xl',
        'border border-[color:var(--ig-border-strong)]',
        'bg-[color:var(--ig-bg-raised)]/95 p-3 backdrop-blur-md',
        'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]',
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ig-fg-subtle)]">{bar.label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">{formatCompactBRL(bar.value)}</div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10px]">
        <Row label="Orçado" value={formatCompactBRL(bar.budget)} />
        <Row label="Projeção" value={formatCompactBRL(bar.forecast)} />
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-canvas)]/40 px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--ig-fg-subtle)]">Variação vs Bdg</span>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: varianceColor }}>
          {variancePos ? '+' : ''}{formatCompactBRL(bar.varianceAbs)} · {formatPct(bar.variancePct)}
        </span>
      </div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-[color:var(--ig-bg-canvas)]/30 px-2 py-1">
      <span className="text-[color:var(--ig-fg-muted)]">{label}</span>
      <span className="font-medium tabular-nums text-[color:var(--ig-fg-strong)]">{value}</span>
    </div>
  );
}
