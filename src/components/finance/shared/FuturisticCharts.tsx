'use client';

/**
 * Futuristic chart kit — pure SVG, theme-token driven.
 * No external chart library. Same public API as the previous ECharts kit
 * so all existing pages keep working.
 *
 * Visual direction: Bloomberg / Palantir / Pigment — neon edges, soft glow,
 * gradient strokes, hairline grids, glass-friendly panels, animated reveal.
 */

import React, { useId, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

/* --------------------------------------------------------------- */
/* Tokens                                                           */
/* --------------------------------------------------------------- */

type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'budget' | 'textStrong';

const PALETTE_DARK: Record<Tone, string> = {
  accent: '#22D3EE',
  success: '#34D399',
  danger: '#F87171',
  warning: '#FBBF24',
  info: '#818CF8',
  budget: '#A78BFA',
  textStrong: '#E6E9EE',
};
const PALETTE_LIGHT: Record<Tone, string> = {
  accent: '#0891B2',
  success: '#059669',
  danger: '#DC2626',
  warning: '#D97706',
  info: '#4F46E5',
  budget: '#7C3AED',
  textStrong: '#0F172A',
};

const AXIS_DARK = 'rgba(255,255,255,0.10)';
const AXIS_LIGHT = 'rgba(15,23,42,0.10)';
const GRID_DARK = 'rgba(255,255,255,0.05)';
const GRID_LIGHT = 'rgba(15,23,42,0.05)';
const TEXT_DARK = '#A8B0BD';
const TEXT_LIGHT = '#5B6473';

function useChartTheme() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  return useMemo(() => ({
    palette: isLight ? PALETTE_LIGHT : PALETTE_DARK,
    axis: isLight ? AXIS_LIGHT : AXIS_DARK,
    grid: isLight ? GRID_LIGHT : GRID_DARK,
    text: isLight ? TEXT_LIGHT : TEXT_DARK,
    textStrong: isLight ? PALETTE_LIGHT.textStrong : PALETTE_DARK.textStrong,
    panelTip: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(15,17,21,0.95)',
    isLight,
  }), [isLight]);
}

/* Re-export the existing token hook for any external users. */
export { useFinanceChartTokens } from './FinanceMiniChart';

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

const fmtCompact = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}k`;
  return `${s}${a}`;
};
const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(240, e.contentRect.width));
    });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, w] as const;
}

// Smooth a polyline using Catmull-Rom -> cubic Bezier
function smoothPath(points: [number, number][]) {
  if (points.length < 2) return '';
  const path: string[] = [`M ${points[0][0]},${points[0][1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const t = 0.5;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6 * t * 2;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6 * t * 2;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6 * t * 2;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6 * t * 2;
    path.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`);
  }
  return path.join(' ');
}

interface DefsProps { uid: string; tones?: Tone[]; palette: Record<Tone, string>; glow?: number }
function ChartDefs({ uid, tones = ['accent', 'success', 'danger', 'warning', 'info', 'budget'], palette, glow = 3 }: DefsProps) {
  return (
    <defs>
      <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={glow} result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`softglow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feComponentTransfer><feFuncA type="linear" slope="0.55" /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      {tones.map((t) => (
        <React.Fragment key={t}>
          <linearGradient id={`fill-${t}-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette[t]} stopOpacity={0.45} />
            <stop offset="100%" stopColor={palette[t]} stopOpacity={0.0} />
          </linearGradient>
          <linearGradient id={`stroke-${t}-${uid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={palette[t]} stopOpacity={0.9} />
            <stop offset="50%" stopColor={palette[t]} stopOpacity={1} />
            <stop offset="100%" stopColor={palette[t]} stopOpacity={0.9} />
          </linearGradient>
          <linearGradient id={`bar-${t}-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette[t]} stopOpacity={1} />
            <stop offset="100%" stopColor={palette[t]} stopOpacity={0.55} />
          </linearGradient>
          <radialGradient id={`bubble-${t}-${uid}`} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.55} />
            <stop offset="35%" stopColor={palette[t]} stopOpacity={0.95} />
            <stop offset="100%" stopColor={palette[t]} stopOpacity={0.5} />
          </radialGradient>
        </React.Fragment>
      ))}
      <pattern id={`grid-${uid}`} width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.06" />
      </pattern>
    </defs>
  );
}

interface TipState { x: number; y: number; html: React.ReactNode }

function Tooltip({ tip, theme }: { tip: TipState | null; theme: ReturnType<typeof useChartTheme> }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-30 px-2.5 py-1.5 rounded-lg border text-[11px] backdrop-blur-md"
      style={{
        left: tip.x, top: tip.y, transform: 'translate(-50%, calc(-100% - 8px))',
        background: theme.panelTip, borderColor: 'rgba(255,255,255,0.10)',
        boxShadow: '0 18px 40px -20px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset',
        color: theme.textStrong,
      }}
    >
      {tip.html}
    </div>
  );
}

/* --------------------------------------------------------------- */
/* LINE / AREA                                                      */
/* --------------------------------------------------------------- */

export interface LineSeries { name: string; data: number[]; tone?: Tone }

export function FinanceLineChart({
  categories, series, height = 240,
}: { categories: string[]; series: LineSeries[]; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [tip, setTip] = useState<TipState | null>(null);

  const padL = 56, padR = 18, padT = 24, padB = 32;
  const W = width, H = height;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);

  const allValues = series.flatMap((s) => s.data);
  const min = Math.min(0, ...allValues);
  const max = Math.max(...allValues, 1);
  const range = max - min || 1;
  const xStep = innerW / Math.max(1, categories.length - 1);
  const yScale = (v: number) => padT + innerH - ((v - min) / range) * innerH;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (range / yTicks) * i);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible" style={{ color: theme.text }}>
        <ChartDefs uid={uid} palette={theme.palette} />
        {/* grid */}
        {tickVals.map((v, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {/* axes */}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={theme.axis} />
        {/* y labels */}
        {tickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={yScale(v) + 3} textAnchor="end" fontSize="10" fill={theme.text}>{fmtCompact(v)}</text>
        ))}
        {/* x labels */}
        {categories.map((c, i) => (
          <text key={i} x={padL + i * xStep} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{c}</text>
        ))}

        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning'] as Tone[])[idx % 4];
          const pts = s.data.map((v, i) => [padL + i * xStep, yScale(v)] as [number, number]);
          const path = smoothPath(pts);
          const areaPath = `${path} L ${pts[pts.length - 1][0]},${H - padB} L ${pts[0][0]},${H - padB} Z`;
          return (
            <g key={s.name}>
              {idx === 0 && <path d={areaPath} fill={`url(#fill-${tone}-${uid})`} />}
              <path d={path} fill="none" stroke={`url(#stroke-${tone}-${uid})`} strokeWidth={1.8} strokeLinecap="round" filter={`url(#softglow-${uid})`} />
              {pts.map(([px, py], i) => (
                <circle
                  key={i} cx={px} cy={py} r={3.2}
                  fill={theme.palette[tone]} stroke="rgba(255,255,255,0.6)" strokeWidth={1}
                  onMouseEnter={() => setTip({ x: px, y: py, html: <span><b>{s.name}</b> · {categories[i]} · <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{fmtBRL(s.data[i])}</span></span> })}
                  onMouseLeave={() => setTip(null)}
                />
              ))}
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="absolute top-0 right-0 flex gap-3 text-[11px]">
        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning'] as Tone[])[idx % 4];
          return (
            <div key={s.name} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-[3px] rounded" style={{ background: theme.palette[tone] }} />
              <span style={{ color: theme.text }}>{s.name}</span>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} theme={theme} />
    </div>
  );
}

/* --------------------------------------------------------------- */
/* S-CURVE — cumulative line                                        */
/* --------------------------------------------------------------- */

export interface SCurveSeries { name: string; values: number[]; tone?: Tone; dashed?: boolean; emphasized?: boolean }

export function FinanceSCurveChart({
  categories, series, height = 280, showArea = true,
}: { categories: string[]; series: SCurveSeries[]; height?: number; showArea?: boolean }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const padL = 56, padR = 18, padT = 28, padB = 32;
  const W = width, H = height;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);

  const cumulatives = series.map((s) => {
    const out: number[] = []; let acc = 0;
    s.values.forEach((v) => { acc += v; out.push(acc); });
    return out;
  });
  const allValues = cumulatives.flat();
  const min = Math.min(0, ...allValues);
  const max = Math.max(...allValues, 1);
  const range = max - min || 1;
  const xStep = innerW / Math.max(1, categories.length - 1);
  const yScale = (v: number) => padT + innerH - ((v - min) / range) * innerH;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (range / yTicks) * i);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left - padL;
    const i = Math.max(0, Math.min(categories.length - 1, Math.round(x / xStep)));
    setHoverIdx(i);
    const cx = padL + i * xStep;
    setTip({
      x: cx, y: padT + 4,
      html: (
        <div className="space-y-0.5 min-w-[160px]">
          <div className="text-[10.5px] uppercase tracking-[0.12em]" style={{ color: theme.text }}>{categories[i]}</div>
          {series.map((s, idx) => (
            <div key={s.name} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: theme.palette[s.tone || 'accent'] }} />
                {s.name}
              </span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: theme.textStrong }}>{fmtBRL(cumulatives[idx][i])}</span>
            </div>
          ))}
        </div>
      ),
    });
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} onMouseMove={handleMove} onMouseLeave={() => { setTip(null); setHoverIdx(null); }} className="overflow-visible" style={{ color: theme.text }}>
        <ChartDefs uid={uid} palette={theme.palette} glow={3.5} />

        {/* hex grid background */}
        <rect x={padL} y={padT} width={innerW} height={innerH} fill={`url(#grid-${uid})`} />

        {/* grid h-lines */}
        {tickVals.map((v, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={theme.axis} />

        {/* y/x labels */}
        {tickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={yScale(v) + 3} textAnchor="end" fontSize="10" fill={theme.text}>{fmtCompact(v)}</text>
        ))}
        {categories.map((c, i) => (
          <text key={i} x={padL + i * xStep} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{c}</text>
        ))}

        {/* vertical guideline */}
        {hoverIdx !== null && (
          <line x1={padL + hoverIdx * xStep} x2={padL + hoverIdx * xStep} y1={padT} y2={H - padB}
            stroke={theme.palette.accent} strokeOpacity={0.45} strokeDasharray="3 3" />
        )}

        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning', 'danger'] as Tone[])[idx % 5];
          const pts = cumulatives[idx].map((v, i) => [padL + i * xStep, yScale(v)] as [number, number]);
          const path = smoothPath(pts);
          const areaPath = `${path} L ${pts[pts.length - 1][0]},${H - padB} L ${pts[0][0]},${H - padB} Z`;
          const isPrimary = s.emphasized || idx === 0;
          return (
            <g key={s.name}>
              {showArea && isPrimary && <path d={areaPath} fill={`url(#fill-${tone}-${uid})`} />}
              <path
                d={path}
                fill="none"
                stroke={`url(#stroke-${tone}-${uid})`}
                strokeWidth={s.emphasized ? 2.4 : 1.6}
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '5 4' : undefined}
                filter={isPrimary ? `url(#softglow-${uid})` : undefined}
              />
              {hoverIdx !== null && (
                <circle cx={padL + hoverIdx * xStep} cy={yScale(cumulatives[idx][hoverIdx])} r={4}
                  fill={theme.palette[tone]} stroke="rgba(255,255,255,0.7)" strokeWidth={1.2}
                  filter={`url(#glow-${uid})`} />
              )}
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="absolute top-0 right-0 flex flex-wrap gap-3 text-[11px]">
        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning', 'danger'] as Tone[])[idx % 5];
          return (
            <div key={s.name} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-[3px] rounded" style={{ background: theme.palette[tone], boxShadow: `0 0 6px ${theme.palette[tone]}` }} />
              <span style={{ color: theme.text }}>{s.name}</span>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} theme={theme} />
    </div>
  );
}

/* --------------------------------------------------------------- */
/* SPARKLINE                                                        */
/* --------------------------------------------------------------- */

export function FinanceSparkline({
  values, tone = 'accent', height = 40, area = true,
}: { values: number[]; tone?: Tone; height?: number; area?: boolean }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const W = width, H = height;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const xStep = W / Math.max(1, values.length - 1);
  const yScale = (v: number) => 4 + (H - 8) - ((v - min) / range) * (H - 8);
  const pts = values.map((v, i) => [i * xStep, yScale(v)] as [number, number]);
  const path = smoothPath(pts);
  const areaPath = `${path} L ${pts[pts.length - 1][0]},${H - 1} L ${pts[0][0]},${H - 1} Z`;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} tones={[tone]} />
        {area && <path d={areaPath} fill={`url(#fill-${tone}-${uid})`} />}
        <path d={path} fill="none" stroke={theme.palette[tone]} strokeWidth={1.6} filter={`url(#softglow-${uid})`} />
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* BAR / GROUPED                                                    */
/* --------------------------------------------------------------- */

export interface BarSeries { name: string; data: number[]; tone?: Tone }

export function FinanceBarChart({
  categories, series, horizontal = false, height = 260,
}: { categories: string[]; series: BarSeries[]; horizontal?: boolean; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [tip, setTip] = useState<TipState | null>(null);
  const W = width, H = height;
  const padL = horizontal ? 110 : 56, padR = 18, padT = 28, padB = 32;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);

  const allValues = series.flatMap((s) => s.data);
  const min = Math.min(0, ...allValues);
  const max = Math.max(...allValues, 1);
  const range = max - min || 1;

  const groupCount = categories.length;
  const seriesCount = series.length;
  const groupSize = (horizontal ? innerH : innerW) / Math.max(1, groupCount);
  const barW = Math.min(22, (groupSize * 0.7) / seriesCount);

  const valScale = (v: number) => ((v - min) / range) * (horizontal ? innerW : innerH);

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (range / yTicks) * i);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {!horizontal && tickVals.map((v, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={padT + innerH - valScale(v)} y2={padT + innerH - valScale(v)} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {horizontal && tickVals.map((v, i) => (
          <line key={i} x1={padL + valScale(v)} x2={padL + valScale(v)} y1={padT} y2={padT + innerH} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {/* axis labels */}
        {!horizontal && tickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={padT + innerH - valScale(v) + 3} textAnchor="end" fontSize="10" fill={theme.text}>{fmtCompact(v)}</text>
        ))}
        {horizontal && tickVals.map((v, i) => (
          <text key={i} x={padL + valScale(v)} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{fmtCompact(v)}</text>
        ))}
        {!horizontal && categories.map((c, i) => (
          <text key={i} x={padL + i * groupSize + groupSize / 2} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{c}</text>
        ))}
        {horizontal && categories.map((c, i) => (
          <text key={i} x={padL - 8} y={padT + i * groupSize + groupSize / 2 + 3} textAnchor="end" fontSize="11" fill={theme.text}>{c}</text>
        ))}

        {series.map((s, sIdx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as Tone[])[sIdx % 6];
          return (
            <g key={s.name}>
              {s.data.map((v, i) => {
                const len = valScale(Math.max(0, v) - Math.min(0, v));
                const offset = (groupSize - barW * seriesCount) / 2 + sIdx * barW;
                if (horizontal) {
                  const y = padT + i * groupSize + offset;
                  const x = padL + valScale(0);
                  return (
                    <rect
                      key={i}
                      x={x} y={y} width={Math.max(2, len)} height={barW - 2} rx={3} ry={3}
                      fill={`url(#bar-${tone}-${uid})`}
                      stroke={theme.palette[tone]} strokeOpacity={0.55} strokeWidth={0.6}
                      filter={`url(#softglow-${uid})`}
                      onMouseEnter={() => setTip({ x: x + len / 2, y, html: <span><b>{s.name}</b> · {categories[i]} · <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{fmtBRL(v)}</span></span> })}
                      onMouseLeave={() => setTip(null)}
                    />
                  );
                }
                const x = padL + i * groupSize + offset;
                const y = padT + innerH - valScale(Math.max(v, 0));
                return (
                  <rect
                    key={i}
                    x={x} y={y} width={barW - 2} height={Math.max(2, len)} rx={3} ry={3}
                    fill={`url(#bar-${tone}-${uid})`}
                    stroke={theme.palette[tone]} strokeOpacity={0.55} strokeWidth={0.6}
                    filter={`url(#softglow-${uid})`}
                    onMouseEnter={() => setTip({ x: x + barW / 2, y, html: <span><b>{s.name}</b> · {categories[i]} · <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{fmtBRL(v)}</span></span> })}
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="absolute top-0 right-0 flex flex-wrap gap-3 text-[11px]">
        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning'] as Tone[])[idx % 4];
          return (
            <div key={s.name} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: theme.palette[tone], boxShadow: `0 0 6px ${theme.palette[tone]}` }} />
              <span style={{ color: theme.text }}>{s.name}</span>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} theme={theme} />
    </div>
  );
}

/* --------------------------------------------------------------- */
/* STACKED BAR                                                      */
/* --------------------------------------------------------------- */

export interface StackedBarSeries { name: string; data: number[]; tone?: Tone }

export function FinanceStackedBarChart({
  categories, series, horizontal = false, percent = false, height = 280,
}: { categories: string[]; series: StackedBarSeries[]; horizontal?: boolean; percent?: boolean; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [tip, setTip] = useState<TipState | null>(null);
  const W = width, H = height;
  const padL = horizontal ? 120 : 56, padR = 18, padT = 28, padB = 32;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);

  const totals = categories.map((_, i) => series.reduce((a, s) => a + Math.abs(s.data[i] || 0), 0));
  const max = percent ? 100 : Math.max(...totals, 1);
  const groupCount = categories.length;
  const groupSize = (horizontal ? innerH : innerW) / Math.max(1, groupCount);
  const barW = Math.min(28, groupSize * 0.65);

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (max / yTicks) * i);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {!horizontal && tickVals.map((v, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={padT + innerH - (v / max) * innerH} y2={padT + innerH - (v / max) * innerH} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {horizontal && tickVals.map((v, i) => (
          <line key={i} x1={padL + (v / max) * innerW} x2={padL + (v / max) * innerW} y1={padT} y2={padT + innerH} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {!horizontal && tickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={padT + innerH - (v / max) * innerH + 3} textAnchor="end" fontSize="10" fill={theme.text}>{percent ? `${v.toFixed(0)}%` : fmtCompact(v)}</text>
        ))}
        {horizontal && tickVals.map((v, i) => (
          <text key={i} x={padL + (v / max) * innerW} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{percent ? `${v.toFixed(0)}%` : fmtCompact(v)}</text>
        ))}
        {!horizontal && categories.map((c, i) => (
          <text key={i} x={padL + i * groupSize + groupSize / 2} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{c}</text>
        ))}
        {horizontal && categories.map((c, i) => (
          <text key={i} x={padL - 8} y={padT + i * groupSize + groupSize / 2 + 3} textAnchor="end" fontSize="11" fill={theme.text}>{c}</text>
        ))}

        {categories.map((cat, i) => {
          let acc = 0;
          const total = totals[i];
          return series.map((s, sIdx) => {
            const v = Math.abs(s.data[i] || 0);
            const portion = percent ? (v / total) * 100 : v;
            const lenAxis = (portion / max) * (horizontal ? innerW : innerH);
            const tone = s.tone || (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as Tone[])[sIdx % 6];
            const isFirst = sIdx === 0;
            const isLast = sIdx === series.length - 1;
            let rx = 0;
            if (horizontal) {
              const x = padL + (acc / max) * innerW;
              const y = padT + i * groupSize + (groupSize - barW) / 2;
              acc += portion;
              return (
                <rect key={s.name}
                  x={x} y={y} width={Math.max(0, lenAxis)} height={barW}
                  rx={isLast ? 5 : isFirst ? 5 : 0}
                  fill={`url(#bar-${tone}-${uid})`}
                  stroke={theme.palette[tone]} strokeOpacity={0.45} strokeWidth={0.6}
                  filter={`url(#softglow-${uid})`}
                  onMouseEnter={() => setTip({ x: x + lenAxis / 2, y, html: <span><b>{s.name}</b> · {cat} · <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{percent ? `${portion.toFixed(1)}%` : fmtBRL(v)}</span></span> })}
                  onMouseLeave={() => setTip(null)}
                />
              );
            }
            const x = padL + i * groupSize + (groupSize - barW) / 2;
            const y = padT + innerH - (acc / max) * innerH - lenAxis;
            acc += portion;
            return (
              <rect key={s.name}
                x={x} y={y} width={barW} height={Math.max(0, lenAxis)}
                rx={isLast ? 5 : 0}
                fill={`url(#bar-${tone}-${uid})`}
                stroke={theme.palette[tone]} strokeOpacity={0.45} strokeWidth={0.6}
                filter={`url(#softglow-${uid})`}
                onMouseEnter={() => setTip({ x: x + barW / 2, y, html: <span><b>{s.name}</b> · {cat} · <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{percent ? `${portion.toFixed(1)}%` : fmtBRL(v)}</span></span> })}
                onMouseLeave={() => setTip(null)}
              />
            );
          });
        })}
      </svg>

      <div className="absolute top-0 right-0 flex flex-wrap gap-3 text-[11px]">
        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as Tone[])[idx % 6];
          return (
            <div key={s.name} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: theme.palette[tone], boxShadow: `0 0 6px ${theme.palette[tone]}` }} />
              <span style={{ color: theme.text }}>{s.name}</span>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} theme={theme} />
    </div>
  );
}

/* --------------------------------------------------------------- */
/* WATERFALL (basic + advanced — same impl)                         */
/* --------------------------------------------------------------- */

export interface WaterfallStep { label: string; value: number; type?: 'start' | 'end' | 'delta' }

export function FinanceAdvancedWaterfallChart({
  steps, height = 320,
}: { steps: WaterfallStep[]; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [tip, setTip] = useState<TipState | null>(null);
  const W = width, H = height;
  const padL = 56, padR = 18, padT = 32, padB = 44;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);

  // running cumulative
  const cumulative: number[] = [];
  let acc = 0;
  steps.forEach((s) => {
    if (s.type === 'start') { acc = s.value; cumulative.push(acc); }
    else if (s.type === 'end') { cumulative.push(acc); }
    else { acc += s.value; cumulative.push(acc); }
  });

  const allMin = Math.min(0, ...cumulative);
  const allMax = Math.max(...cumulative);
  const range = allMax - allMin || 1;
  const yScale = (v: number) => padT + innerH - ((v - allMin) / range) * innerH;

  const groupSize = innerW / steps.length;
  const barW = Math.min(34, groupSize * 0.7);

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => allMin + (range / yTicks) * i);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {tickVals.map((v, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {tickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={yScale(v) + 3} textAnchor="end" fontSize="10" fill={theme.text}>{fmtCompact(v)}</text>
        ))}

        {steps.map((s, i) => {
          const isStart = s.type === 'start';
          const isEnd = s.type === 'end';
          const tone: Tone = isStart ? 'info' : isEnd ? 'accent' : (s.value >= 0 ? 'success' : 'danger');
          const top = isStart || isEnd ? yScale(Math.max(0, cumulative[i])) : (s.value >= 0 ? yScale(cumulative[i]) : yScale(cumulative[i] - s.value));
          const bottom = isStart || isEnd ? yScale(Math.min(0, cumulative[i])) : (s.value >= 0 ? yScale(cumulative[i] - s.value) : yScale(cumulative[i]));
          const h = Math.max(2, bottom - top);
          const x = padL + i * groupSize + (groupSize - barW) / 2;
          // connector line
          const connectorY = yScale(cumulative[i]);
          const nextX = padL + (i + 1) * groupSize + (groupSize - barW) / 2;
          return (
            <g key={i}>
              <rect
                x={x} y={top} width={barW} height={h} rx={4}
                fill={`url(#bar-${tone}-${uid})`}
                stroke={theme.palette[tone]} strokeOpacity={0.55} strokeWidth={0.6}
                filter={`url(#softglow-${uid})`}
                onMouseEnter={() => setTip({ x: x + barW / 2, y: top, html: <span><b>{s.label}</b> · <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{fmtBRL(s.value)}</span> · acum: <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{fmtBRL(cumulative[i])}</span></span> })}
                onMouseLeave={() => setTip(null)}
              />
              <text x={x + barW / 2} y={top - 6} fontSize="10" fill={theme.textStrong} textAnchor="middle" style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{fmtCompact(s.value)}</text>
              {i < steps.length - 1 && (
                <line x1={x + barW} x2={nextX} y1={connectorY} y2={connectorY} stroke={theme.axis} strokeDasharray="2 3" strokeOpacity={0.6} />
              )}
              <text x={x + barW / 2} y={H - padB + 14} fontSize="10" fill={theme.text} textAnchor="middle">{s.label}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} theme={theme} />
    </div>
  );
}

// Legacy basic waterfall — same impl, derived from values+categories
export function FinanceWaterfallChart({
  categories, values, height = 280,
}: { categories: string[]; values: number[]; height?: number }) {
  const steps: WaterfallStep[] = categories.map((label, i) => ({
    label, value: values[i],
    type: i === 0 ? 'start' : (i === categories.length - 1 ? 'end' : 'delta'),
  }));
  return <FinanceAdvancedWaterfallChart steps={steps} height={height} />;
}

/* --------------------------------------------------------------- */
/* DONUT                                                            */
/* --------------------------------------------------------------- */

export interface DonutSlice { name: string; value: number; tone?: Tone }

export function FinanceDonutChart({
  data, height = 260, centerLabel, centerValue,
}: { data: DonutSlice[]; height?: number; centerLabel?: string; centerValue?: string }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [hovered, setHovered] = useState<number | null>(null);
  const W = width, H = height;
  const cx = Math.min(W * 0.34, W / 2 - 8);
  const cy = H / 2;
  const r = Math.min(cx - 16, H / 2 - 16);
  const inner = r * 0.66;

  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const a0 = angle;
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    angle = a1;
    return { ...d, a0, a1 };
  });

  const arcPath = (a0: number, a1: number, rOut: number, rIn: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + Math.cos(a0) * rOut, y0 = cy + Math.sin(a0) * rOut;
    const x1 = cx + Math.cos(a1) * rOut, y1 = cy + Math.sin(a1) * rOut;
    const x2 = cx + Math.cos(a1) * rIn, y2 = cy + Math.sin(a1) * rIn;
    const x3 = cx + Math.cos(a0) * rIn, y3 = cy + Math.sin(a0) * rIn;
    return `M ${x0},${y0} A ${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L ${x2},${y2} A ${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`;
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {/* outer rim */}
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={theme.axis} strokeOpacity={0.5} strokeDasharray="2 6" />
        {slices.map((s, i) => {
          const tone = s.tone || (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as Tone[])[i % 6];
          const isHovered = hovered === i;
          const rOut = isHovered ? r + 6 : r;
          return (
            <path key={i}
              d={arcPath(s.a0, s.a1, rOut, inner)}
              fill={`url(#bar-${tone}-${uid})`}
              stroke={theme.palette[tone]} strokeOpacity={0.6} strokeWidth={0.8}
              filter={isHovered ? `url(#glow-${uid})` : `url(#softglow-${uid})`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ transition: 'd 200ms' }}
            />
          );
        })}
        {/* center */}
        {centerValue && (
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight={700} fill={theme.textStrong} style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{centerValue}</text>
        )}
        {centerLabel && (
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill={theme.text}>{centerLabel}</text>
        )}
      </svg>

      {/* legend */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 max-h-full overflow-auto pr-1 text-[11px]" style={{ width: Math.min(180, W - cx - r - 24) }}>
        {data.map((d, i) => {
          const tone = d.tone || (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as Tone[])[i % 6];
          const pct = (d.value / total) * 100;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="flex items-center justify-between gap-2 text-left"
              style={{ opacity: hovered === null || hovered === i ? 1 : 0.45 }}
            >
              <span className="inline-flex items-center gap-1.5 truncate">
                <span className="w-2 h-2 rounded-full" style={{ background: theme.palette[tone], boxShadow: `0 0 6px ${theme.palette[tone]}` }} />
                <span style={{ color: theme.text }} className="truncate">{d.name}</span>
              </span>
              <span style={{ color: theme.textStrong, fontFamily: 'ui-monospace,Menlo,monospace' }}>{pct.toFixed(1)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* TREEMAP — squarified                                             */
/* --------------------------------------------------------------- */

export interface TreemapNode { name: string; value: number; tone?: Tone; deltaPct?: number; children?: TreemapNode[] }

interface Rect { x: number; y: number; w: number; h: number }

function squarify(items: TreemapNode[], r: Rect): { node: TreemapNode; rect: Rect }[] {
  const total = items.reduce((a, n) => a + n.value, 0) || 1;
  // Simple slice & dice with horizontal/vertical alternation by aspect ratio.
  const out: { node: TreemapNode; rect: Rect }[] = [];
  function place(list: TreemapNode[], rect: Rect) {
    if (list.length === 0) return;
    if (list.length === 1) { out.push({ node: list[0], rect }); return; }
    const sum = list.reduce((a, n) => a + n.value, 0);
    const horiz = rect.w >= rect.h;
    let acc = 0;
    let bestSplit = 0;
    let bestRatio = Infinity;
    for (let i = 1; i < list.length; i++) {
      const left = list.slice(0, i).reduce((a, n) => a + n.value, 0);
      const ratio = Math.abs((left / sum) - 0.5);
      if (ratio < bestRatio) { bestRatio = ratio; bestSplit = i; }
    }
    const leftList = list.slice(0, bestSplit);
    const rightList = list.slice(bestSplit);
    const leftSum = leftList.reduce((a, n) => a + n.value, 0);
    const frac = leftSum / sum;
    if (horiz) {
      const lw = rect.w * frac;
      place(leftList, { x: rect.x, y: rect.y, w: lw, h: rect.h });
      place(rightList, { x: rect.x + lw, y: rect.y, w: rect.w - lw, h: rect.h });
    } else {
      const lh = rect.h * frac;
      place(leftList, { x: rect.x, y: rect.y, w: rect.w, h: lh });
      place(rightList, { x: rect.x, y: rect.y + lh, w: rect.w, h: rect.h - lh });
    }
    return;
  }
  place([...items].sort((a, b) => b.value - a.value), r);
  return out;
}

export function FinanceTreemapChart({
  data, height = 320,
}: { data: TreemapNode[]; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [hover, setHover] = useState<number | null>(null);
  const cells = squarify(data, { x: 6, y: 6, w: width - 12, h: height - 12 });

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={width} height={height} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {cells.map((c, i) => {
          const tone = c.node.tone || (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as Tone[])[i % 6];
          const isH = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              <rect
                x={c.rect.x + 2} y={c.rect.y + 2} width={Math.max(0, c.rect.w - 4)} height={Math.max(0, c.rect.h - 4)} rx={8}
                fill={`url(#bar-${tone}-${uid})`}
                stroke={theme.palette[tone]} strokeOpacity={isH ? 1 : 0.55} strokeWidth={isH ? 1.4 : 0.8}
                filter={isH ? `url(#glow-${uid})` : `url(#softglow-${uid})`}
              />
              {c.rect.w > 70 && c.rect.h > 38 && (
                <>
                  <text x={c.rect.x + 12} y={c.rect.y + 18} fontSize="11" fontWeight={600} fill={theme.textStrong}>{c.node.name}</text>
                  <text x={c.rect.x + 12} y={c.rect.y + 33} fontSize="10" fill={theme.text} style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>
                    {fmtCompact(c.node.value)}
                    {c.node.deltaPct !== undefined && (
                      <tspan dx="6" fill={c.node.deltaPct >= 0 ? theme.palette.success : theme.palette.danger}>
                        {c.node.deltaPct >= 0 ? '+' : ''}{c.node.deltaPct.toFixed(1)}%
                      </tspan>
                    )}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* RADAR                                                            */
/* --------------------------------------------------------------- */

export interface RadarSeries { name: string; values: number[]; tone?: Tone }

export function FinanceRadarChart({
  indicators, series, height = 280, max = 100,
}: { indicators: string[]; series: RadarSeries[]; height?: number; max?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const W = width, H = height;
  const cx = W / 2, cy = H / 2 + 4;
  const radius = Math.min(W, H) / 2 - 38;
  const N = indicators.length;
  const ang = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;
  const grids = 4;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {/* concentric polygons */}
        {Array.from({ length: grids }, (_, gi) => {
          const r = (radius / grids) * (gi + 1);
          const pts = indicators.map((_, i) => `${cx + Math.cos(ang(i)) * r},${cy + Math.sin(ang(i)) * r}`).join(' ');
          return <polygon key={gi} points={pts} fill="none" stroke={theme.grid} strokeDasharray="2 3" />;
        })}
        {/* spokes */}
        {indicators.map((label, i) => {
          const x = cx + Math.cos(ang(i)) * radius;
          const y = cy + Math.sin(ang(i)) * radius;
          const lx = cx + Math.cos(ang(i)) * (radius + 14);
          const ly = cy + Math.sin(ang(i)) * (radius + 14);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={theme.grid} />
              <text x={lx} y={ly + 3} fontSize="10" fill={theme.text} textAnchor="middle">{label}</text>
            </g>
          );
        })}
        {/* series */}
        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'warning', 'danger', 'success'] as Tone[])[idx % 5];
          const pts = s.values.map((v, i) => {
            const r = (Math.min(v, max) / max) * radius;
            return [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r] as [number, number];
          });
          const path = pts.map((p, i) => (i === 0 ? `M ${p[0]},${p[1]}` : `L ${p[0]},${p[1]}`)).join(' ') + ' Z';
          return (
            <g key={s.name}>
              <path d={path} fill={theme.palette[tone]} fillOpacity={0.18} stroke={theme.palette[tone]} strokeWidth={1.6} filter={`url(#softglow-${uid})`} />
              {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={3} fill={theme.palette[tone]} stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="absolute top-0 right-0 flex flex-wrap gap-3 text-[11px]">
        {series.map((s, idx) => {
          const tone = s.tone || (['accent', 'info', 'warning', 'danger', 'success'] as Tone[])[idx % 5];
          return (
            <div key={s.name} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-[3px] rounded" style={{ background: theme.palette[tone], boxShadow: `0 0 6px ${theme.palette[tone]}` }} />
              <span style={{ color: theme.text }}>{s.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* BUBBLE / SCATTER                                                 */
/* --------------------------------------------------------------- */

export interface BubblePoint { id?: string; label: string; x: number; y: number; size: number; tone?: Tone; meta?: string }

export function FinanceBubbleChart({
  points, xAxisLabel, yAxisLabel, height = 320, xFormatter, yFormatter,
}: {
  points: BubblePoint[]; xAxisLabel: string; yAxisLabel: string; height?: number;
  xFormatter?: (v: number) => string; yFormatter?: (v: number) => string;
}) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const [tip, setTip] = useState<TipState | null>(null);
  const W = width, H = height;
  const padL = 60, padR = 18, padT = 28, padB = 44;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);

  const xVals = points.map((p) => p.x);
  const yVals = points.map((p) => p.y);
  const xMin = Math.min(...xVals, 0), xMax = Math.max(...xVals, 1);
  const yMin = Math.min(...yVals, 0), yMax = Math.max(...yVals, 1);
  const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1;
  const xS = (v: number) => padL + ((v - xMin) / xRange) * innerW;
  const yS = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH;

  const sizes = points.map((p) => p.size);
  const sMin = Math.min(...sizes), sMax = Math.max(...sizes);
  const rMin = 10, rMax = 30;
  const radius = (s: number) => sMax === sMin ? (rMin + rMax) / 2 : rMin + ((s - sMin) / (sMax - sMin)) * (rMax - rMin);

  const xTicks = 5, yTicks = 4;
  const xTickVals = Array.from({ length: xTicks + 1 }, (_, i) => xMin + (xRange / xTicks) * i);
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yRange / yTicks) * i);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} />
        {/* grid */}
        {yTickVals.map((v, i) => (
          <line key={`h${i}`} x1={padL} x2={W - padR} y1={yS(v)} y2={yS(v)} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {xTickVals.map((v, i) => (
          <line key={`v${i}`} x1={xS(v)} x2={xS(v)} y1={padT} y2={H - padB} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {/* axes labels */}
        {yTickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={yS(v) + 3} textAnchor="end" fontSize="10" fill={theme.text}>{yFormatter ? yFormatter(v) : fmtCompact(v)}</text>
        ))}
        {xTickVals.map((v, i) => (
          <text key={i} x={xS(v)} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{xFormatter ? xFormatter(v) : v.toFixed(0)}</text>
        ))}
        <text x={padL + innerW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={theme.text}>{xAxisLabel}</text>
        <text transform={`translate(${14}, ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill={theme.text}>{yAxisLabel}</text>

        {points.map((p, i) => {
          const tone = p.tone || (['accent', 'info', 'success', 'warning', 'danger'] as Tone[])[i % 5];
          const cx = xS(p.x), cy = yS(p.y), r = radius(p.size);
          return (
            <g key={p.id ?? i}>
              <circle cx={cx} cy={cy} r={r + 3} fill={theme.palette[tone]} fillOpacity={0.10} />
              <circle
                cx={cx} cy={cy} r={r}
                fill={`url(#bubble-${tone}-${uid})`}
                stroke={theme.palette[tone]} strokeOpacity={0.7} strokeWidth={1}
                filter={`url(#softglow-${uid})`}
                onMouseEnter={() => setTip({ x: cx, y: cy - r, html: (
                  <div className="space-y-0.5">
                    <div style={{ color: theme.textStrong }}><b>{p.label}</b></div>
                    <div>{xAxisLabel}: <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{xFormatter ? xFormatter(p.x) : p.x.toFixed(1)}</span></div>
                    <div>{yAxisLabel}: <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{yFormatter ? yFormatter(p.y) : p.y.toFixed(1)}</span></div>
                    <div>Size: <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{fmtCompact(p.size)}</span></div>
                    {p.meta && <div style={{ color: theme.text }}>{p.meta}</div>}
                  </div>
                ) })}
                onMouseLeave={() => setTip(null)}
              />
              <text x={cx} y={cy - r - 6} textAnchor="middle" fontSize="10" fill={theme.textStrong}>{p.label}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} theme={theme} />
    </div>
  );
}

/* --------------------------------------------------------------- */
/* TORNADO — sensitivity bars                                       */
/* --------------------------------------------------------------- */

export interface TornadoRow { label: string; low: number; high: number }

export function FinanceTornadoChart({
  rows, height = 260,
}: { rows: TornadoRow[]; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const W = width, H = height;
  const padL = 120, padR = 24, padT = 24, padB = 28;
  const innerW = Math.max(50, W - padL - padR);
  const innerH = Math.max(50, H - padT - padB);
  const max = Math.max(...rows.flatMap((r) => [Math.abs(r.low), Math.abs(r.high)]), 1);
  const center = padL + innerW / 2;
  const half = innerW / 2;
  const rowH = innerH / Math.max(1, rows.length);
  const barH = Math.min(20, rowH * 0.6);

  const xTicks = 4;
  const tickVals = Array.from({ length: xTicks * 2 + 1 }, (_, i) => -max + (max / xTicks) * i);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} tones={['danger', 'success']} />
        {tickVals.map((v, i) => (
          <line key={i} x1={center + (v / max) * half} x2={center + (v / max) * half} y1={padT} y2={padT + innerH} stroke={theme.grid} strokeDasharray="2 4" />
        ))}
        {tickVals.filter((_, i) => i % 2 === 0).map((v, i) => (
          <text key={i} x={center + (v / max) * half} y={H - padB + 14} textAnchor="middle" fontSize="10" fill={theme.text}>{v.toFixed(0)}%</text>
        ))}
        <line x1={center} x2={center} y1={padT} y2={padT + innerH} stroke={theme.axis} />

        {rows.map((r, i) => {
          const y = padT + i * rowH + (rowH - barH) / 2;
          const lowW = (Math.abs(r.low) / max) * half;
          const highW = (Math.abs(r.high) / max) * half;
          return (
            <g key={i}>
              <text x={padL - 8} y={y + barH / 2 + 3} textAnchor="end" fontSize="11" fill={theme.text}>{r.label}</text>
              <rect x={center - lowW} y={y} width={lowW} height={barH} rx={4}
                fill={`url(#bar-danger-${uid})`} stroke={theme.palette.danger} strokeOpacity={0.5} strokeWidth={0.6}
                filter={`url(#softglow-${uid})`} />
              <rect x={center} y={y} width={highW} height={barH} rx={4}
                fill={`url(#bar-success-${uid})`} stroke={theme.palette.success} strokeOpacity={0.5} strokeWidth={0.6}
                filter={`url(#softglow-${uid})`} />
              <text x={center - lowW - 6} y={y + barH / 2 + 3} textAnchor="end" fontSize="10" fill={theme.palette.danger} style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>−{Math.abs(r.low).toFixed(1)}%</text>
              <text x={center + highW + 6} y={y + barH / 2 + 3} fontSize="10" fill={theme.palette.success} style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>+{Math.abs(r.high).toFixed(1)}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* RADIAL PROGRESS                                                  */
/* --------------------------------------------------------------- */

export function FinanceRadialProgress({
  value, max = 100, label, sublabel, tone = 'accent', height = 200,
}: { value: number; max?: number; label?: string; sublabel?: string; tone?: Tone; height?: number }) {
  const uid = useId();
  const theme = useChartTheme();
  const [ref, width] = useContainerWidth();
  const W = width, H = height;
  const cx = W / 2, cy = H / 2 + 6;
  const r = Math.min(W, H) / 2 - 18;
  const startAngle = (220 * Math.PI) / 180;
  const endAngle = (-40 * Math.PI) / 180;
  const fullSweep = startAngle - endAngle; // > 0
  const pct = Math.min(1, Math.max(0, value / max));
  const valueAngle = startAngle - fullSweep * pct;

  const arc = (a0: number, a1: number) => {
    const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    const sweep = (a0 > a1 ? 1 : 0); // clockwise when a0 > a1 (since y-down)
    const large = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
    return `M ${x0},${y0} A ${r},${r} 0 ${large} ${sweep} ${x1},${y1}`;
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={W} height={H} className="overflow-visible">
        <ChartDefs uid={uid} palette={theme.palette} tones={[tone]} />
        <path d={arc(startAngle, endAngle)} fill="none" stroke={theme.grid} strokeWidth={12} strokeLinecap="round" />
        <path d={arc(startAngle, valueAngle)} fill="none" stroke={theme.palette[tone]} strokeWidth={12} strokeLinecap="round"
          filter={`url(#softglow-${uid})`} />
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="24" fontWeight={700} fill={theme.textStrong} style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{(pct * 100).toFixed(0)}%</text>
        {sublabel && <text x={cx} y={cy + 28} textAnchor="middle" fontSize="11" fill={theme.text}>{sublabel || label}</text>}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* RANK MATRIX — Bloomberg-style ranked diverging bars              */
/* --------------------------------------------------------------- */

export interface RankRow {
  id?: string;
  label: string;
  meta?: string;
  value: number;          // primary metric used for ranking & bar length
  secondaryLabel?: string;
  secondary?: string;     // pre-formatted secondary (e.g. "HC 84", "R$ 2.4M")
  tone?: Tone;            // override color; otherwise positive→success / negative→danger
  benchmark?: number;     // optional reference line on the bar
}

export interface FinanceRankMatrixProps {
  rows: RankRow[];
  height?: number;
  /** 'diverging' centers at zero; 'progress' is unidirectional from min(0) to max */
  mode?: 'diverging' | 'progress';
  /** Optional override for axis max; auto if not set */
  max?: number;
  /** Format for the value label printed at the end of the row */
  valueFormatter?: (v: number) => string;
  /** Header column titles */
  headers?: { rank?: string; label?: string; bar?: string; secondary?: string };
  /** Sort direction by value */
  sort?: 'desc' | 'asc' | 'none';
  /** Optional X axis tick formatter for the bar scale */
  axisFormatter?: (v: number) => string;
}

/**
 * Per-row bar (SVG, fills its column). Pure positional math in % so it
 * scales with the parent grid column without colliding with text columns.
 */
function RankBarRow({
  uid, value, mode, rangeMin, rangeMax, tone, benchmark,
  height = 18,
}: {
  uid: string; value: number; mode: 'diverging' | 'progress';
  rangeMin: number; rangeMax: number; tone: Tone; benchmark?: number; height?: number;
}) {
  const theme = useChartTheme();
  const range = (rangeMax - rangeMin) || 1;
  const pos = (v: number) => ((v - rangeMin) / range) * 100;
  const zero = pos(0);
  const v = pos(value);
  const x0 = mode === 'diverging' ? Math.min(zero, v) : 0;
  const x1 = mode === 'diverging' ? Math.max(zero, v) : v;
  const W = 1000;        // viewBox units
  const barH = height;
  return (
    <svg viewBox={`0 0 ${W} ${barH}`} preserveAspectRatio="none"
      width="100%" height={barH} className="block">
      <ChartDefs uid={uid} palette={theme.palette} tones={[tone]} />
      {mode === 'diverging' && (
        <line x1={(zero / 100) * W} x2={(zero / 100) * W} y1={0} y2={barH}
          stroke={theme.axis} strokeOpacity={0.85} />
      )}
      <rect
        x={(x0 / 100) * W} y={1}
        width={Math.max(2, ((x1 - x0) / 100) * W)} height={barH - 2}
        rx={3} ry={3}
        fill={`url(#bar-${tone}-${uid})`}
        stroke={theme.palette[tone]} strokeOpacity={0.55} strokeWidth={0.6}
        filter={`url(#softglow-${uid})`}
      />
      {benchmark !== undefined && (
        <line x1={(pos(benchmark) / 100) * W} x2={(pos(benchmark) / 100) * W}
          y1={-1} y2={barH + 1}
          stroke={theme.textStrong} strokeOpacity={0.55}
          strokeDasharray="2 2" strokeWidth={1.2} />
      )}
    </svg>
  );
}

export function FinanceRankMatrix({
  rows,
  mode = 'diverging',
  max,
  valueFormatter,
  headers,
  sort = 'desc',
  axisFormatter,
}: FinanceRankMatrixProps) {
  const uid = useId();
  const theme = useChartTheme();

  const sorted = useMemo(() => {
    if (sort === 'none') return rows;
    return [...rows].sort((a, b) => sort === 'desc' ? b.value - a.value : a.value - b.value);
  }, [rows, sort]);

  const absMax = max ?? Math.max(...sorted.map((r) => Math.abs(r.value)), 1);
  const rangeMin = mode === 'diverging' ? -absMax : Math.min(0, ...sorted.map((r) => r.value));
  const rangeMax = mode === 'diverging' ? absMax : absMax;

  const ticks = mode === 'diverging' ? 4 : 5;
  const tickStep = (rangeMax - rangeMin) / ticks;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => rangeMin + tickStep * i);

  // 5-column grid:
  //   rank (28px) · label/meta (1.6fr min 160) · bar (2.4fr min 200)
  //   value (84px) · secondary (auto, capped)
  const gridCols = 'minmax(28px, 32px) minmax(160px, 1.6fr) minmax(200px, 2.4fr) 90px minmax(0, 160px)';

  return (
    <div className="w-full" style={{ color: theme.text }}>
      {/* Header */}
      <div
        className="grid items-center gap-x-3 px-2 pb-1.5 border-b border-ig-border-subtle"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ig-text-tertiary text-right">
          {headers?.rank ?? '#'}
        </span>
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ig-text-tertiary truncate">
          {headers?.label ?? 'Item'}
        </span>
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ig-text-tertiary truncate">
          {headers?.bar ?? 'Primary'}
        </span>
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ig-text-tertiary text-right truncate">
          Δ
        </span>
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-ig-text-tertiary text-right truncate">
          {headers?.secondary ?? ''}
        </span>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-ig-border-subtle/40">
        {sorted.map((r, i) => {
          const tone: Tone = r.tone ?? (r.value >= 0 ? 'success' : 'danger');
          const formattedValue = valueFormatter
            ? valueFormatter(r.value)
            : `${r.value >= 0 ? '+' : ''}${r.value.toFixed(1)}`;
          return (
            <li
              key={r.id ?? i}
              className={
                'grid items-center gap-x-3 px-2 py-2 transition-colors hover:bg-ig-surface-subtle/30 ' +
                (i % 2 === 1 ? 'bg-ig-surface-subtle/15' : '')
              }
              style={{ gridTemplateColumns: gridCols }}
            >
              <span className="text-[10.5px] font-mono tabular-nums text-ig-text-tertiary text-right">
                {String(i + 1).padStart(2, '0')}
              </span>

              <div className="min-w-0">
                <div
                  className="text-[12.5px] font-medium text-ig-text-primary truncate leading-tight"
                  title={r.label}
                >
                  {r.label}
                </div>
                {r.meta && (
                  <div
                    className="text-[10.5px] text-ig-text-tertiary truncate leading-tight mt-0.5"
                    title={r.meta}
                  >
                    {r.meta}
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <RankBarRow
                  uid={uid}
                  value={r.value}
                  mode={mode}
                  rangeMin={rangeMin}
                  rangeMax={rangeMax}
                  tone={tone}
                  benchmark={r.benchmark}
                />
              </div>

              <span
                className="text-[11px] font-mono tabular-nums font-semibold text-right whitespace-nowrap"
                style={{ color: theme.palette[tone] }}
              >
                {formattedValue}
              </span>

              <div className="min-w-0 text-right">
                {r.secondaryLabel && (
                  <div className="text-[9px] uppercase tracking-[0.12em] text-ig-text-tertiary truncate leading-tight">
                    {r.secondaryLabel}
                  </div>
                )}
                {r.secondary && (
                  <div
                    className="text-[11.5px] font-mono tabular-nums text-ig-text-secondary truncate leading-tight"
                    title={r.secondary}
                  >
                    {r.secondary}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Bottom axis ticks (only beneath the bar column) */}
      <div
        className="grid items-center gap-x-3 px-2 pt-1.5 mt-0.5 border-t border-ig-border-subtle/60"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span />
        <span />
        <div className="relative h-3.5">
          {tickVals.map((v, i) => (
            <span
              key={i}
              className="absolute top-0 -translate-x-1/2 text-[9.5px] font-mono tabular-nums text-ig-text-tertiary"
              style={{ left: `${((v - rangeMin) / ((rangeMax - rangeMin) || 1)) * 100}%` }}
            >
              {axisFormatter
                ? axisFormatter(v)
                : (mode === 'diverging' ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}` : fmtCompact(v))}
            </span>
          ))}
        </div>
        <span />
        <span />
      </div>
    </div>
  );
}
