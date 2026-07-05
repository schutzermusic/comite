'use client';

import React, { useMemo, useState } from 'react';
import { ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { HudKpiStrip, HudButton, type KpiItem } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  type FinanceKpi,
  type FinanceKpiTone,
  type FinanceKpiBreakdownRow,
} from '@/lib/finance/kpi';
import {
  FinanceDetailDrawer,
  FinanceDrawerSection,
  FinanceDrawerKeyValue,
} from './FinanceDetailDrawer';
import { fmtBRL, fmtPct } from './types';

export interface FinanceKpiGridProps {
  kpis: FinanceKpi[];
  /** Number of visual columns (matches HudKpiStrip API). Defaults to kpi count up to 6. */
  columns?: 2 | 3 | 4 | 5 | 6;
  /** Alignment forwarded to HudKpiStrip. Defaults to center for connected strips. */
  align?: 'left' | 'center';
  className?: string;
}

const TONE_TO_VARIANT: Record<FinanceKpiTone, KpiItem['variant']> = {
  default: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

const TONE_TO_PILL: Record<FinanceKpiTone, 'pos' | 'neg' | 'warn' | 'info' | 'neutral'> = {
  default: 'neutral',
  success: 'pos',
  warning: 'warn',
  danger: 'neg',
  info: 'info',
};

/**
 * Adapter that:
 *  1. Converts a FinanceKpi[] (the canonical Finance contract) into the
 *     legacy KpiItem[] consumed by HudKpiStrip.
 *  2. Wires the per-KPI click into a generic FinanceDetailDrawer that surfaces
 *     the FinanceKpi metadata (details, drilldown, deep link).
 *
 * This is the single integration point each modernized Finance page uses.
 * Replacing mock data with real data requires zero changes here — only the
 * upstream selectors change.
 */
export function FinanceKpiGrid({ kpis, columns, align = 'center', className }: FinanceKpiGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(
    () => kpis.find((k) => k.id === activeId) ?? null,
    [activeId, kpis],
  );

  const items = useMemo<KpiItem[]>(
    () =>
      kpis.map((k) => {
        const tone: FinanceKpiTone = k.tone ?? 'default';
        return {
          id: k.id,
          label: k.title,
          value: k.formattedValue ?? k.value,
          format: k.formattedValue ? 'raw' : (k.format ?? 'compactCurrency'),
          fractionDigits: k.fractionDigits,
          delta: k.delta,
          deltaLabel: k.deltaLabel ?? k.helper,
          variant: TONE_TO_VARIANT[tone],
          tintValue: tone !== 'default',
          // Todo KPI é clicável (padrão Contratos): custom onClick quando o
          // caller define; senão o drawer de detalhe genérico (mesmo sem drilldown).
          onClick: () => {
            if (k.onClick) k.onClick();
            else setActiveId(k.id);
          },
          active: activeId === k.id,
        };
      }),
    [kpis, activeId],
  );

  const resolvedColumns = (columns ?? (Math.max(2, Math.min(6, kpis.length)) as 2 | 3 | 4 | 5 | 6));

  return (
    <>
      <HudKpiStrip
        kpis={items}
        columns={resolvedColumns}
        align={align}
        className={className}
      />

      <FinanceDetailDrawer
        open={!!active}
        onClose={() => setActiveId(null)}
        title={active?.title ?? ''}
        subtitle={active?.helper}
        metaPills={active ? buildPills(active) : []}
        primaryActions={
          active?.deepLink ? (
            <HudButton
              variant="primary"
              size="sm"
              leftIcon={<ExternalLink className="w-4 h-4" />}
              onClick={() => {
                if (active.deepLink) window.location.href = active.deepLink.href;
              }}
            >
              {active.deepLink.label}
            </HudButton>
          ) : undefined
        }
      >
        {active && (
          <>
            <FinanceDrawerSection title="Resumo">
              <FinanceDrawerKeyValue
                rows={[
                  { label: 'Valor atual', value: formatKpiValue(active) },
                  ...(active.delta !== undefined
                    ? [{ label: 'Variação', value: fmtPct(active.delta), tone: deltaTone(active.delta) }]
                    : []),
                  ...(active.helper ? [{ label: 'Contexto', value: active.helper }] : []),
                  ...(active.category ? [{ label: 'Categoria', value: active.category }] : []),
                  ...(active.source ? [{ label: 'Origem', value: active.source }] : []),
                  ...(active.asOf ? [{ label: 'Atualizado em', value: active.asOf }] : []),
                ]}
              />
            </FinanceDrawerSection>

            {active.details && (
              <FinanceDrawerSection title="Descrição">
                <p className="text-[12.5px] leading-snug text-ig-text-secondary">{active.details}</p>
              </FinanceDrawerSection>
            )}

            {active.drilldown && active.drilldown.length > 0 && (
              <FinanceDrawerSection title="Detalhamento">
                <DrilldownList rows={active.drilldown} />
              </FinanceDrawerSection>
            )}

            {active.trendSeries && active.trendSeries.length > 0 && (
              <FinanceDrawerSection title="Tendência">
                <TrendSparkline series={active.trendSeries} />
              </FinanceDrawerSection>
            )}
          </>
        )}
      </FinanceDetailDrawer>
    </>
  );
}

function formatKpiValue(kpi: FinanceKpi): string {
  if (kpi.formattedValue) return kpi.formattedValue;
  if (typeof kpi.value === 'string') return kpi.value;
  switch (kpi.format) {
    case 'currency':
    case 'compactCurrency':
      return fmtBRL(kpi.value);
    case 'percent':
      return fmtPct(kpi.value, kpi.fractionDigits ?? 1);
    case 'number':
      return new Intl.NumberFormat('pt-BR').format(kpi.value);
    default:
      return new Intl.NumberFormat('pt-BR').format(kpi.value);
  }
}

function deltaTone(delta: number | undefined): 'pos' | 'neg' | 'neutral' {
  if (delta === undefined || delta === 0) return 'neutral';
  return delta > 0 ? 'pos' : 'neg';
}

function buildPills(kpi: FinanceKpi) {
  const pills: { label: string; tone?: 'pos' | 'neg' | 'warn' | 'info' | 'neutral' }[] = [];
  pills.push({ label: formatKpiValue(kpi), tone: kpi.tone ? TONE_TO_PILL[kpi.tone] : 'info' });
  if (kpi.delta !== undefined) {
    pills.push({ label: `Δ ${fmtPct(kpi.delta)}`, tone: deltaTone(kpi.delta) });
  }
  if (kpi.trend) {
    pills.push({
      label: kpi.trend === 'up' ? 'Em alta' : kpi.trend === 'down' ? 'Em queda' : 'Estável',
      tone: kpi.trend === 'up' ? 'pos' : kpi.trend === 'down' ? 'neg' : 'neutral',
    });
  }
  return pills;
}

function DrilldownList({ rows }: { rows: FinanceKpiBreakdownRow[] }) {
  const total = rows.reduce((acc, r) => acc + Math.abs(r.value), 0) || 1;
  return (
    <ul className="divide-y divide-ig-border-subtle/60">
      {rows.map((row, idx) => {
        const share = (Math.abs(row.value) / total) * 100;
        return (
          <li key={idx} className="py-2 flex items-center justify-between gap-3 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] text-ig-text-primary truncate">{row.label}</div>
              <div className="mt-1 h-1 rounded-full bg-ig-surface-subtle overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    row.tone === 'danger' ? 'bg-ig-danger' :
                    row.tone === 'warning' ? 'bg-ig-warning' :
                    row.tone === 'success' ? 'bg-ig-success' :
                    row.tone === 'info' ? 'bg-ig-info' :
                    'bg-ig-accent',
                  )}
                  style={{ width: `${Math.min(share, 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[12.5px] tabular-nums">
                {row.formattedValue ?? new Intl.NumberFormat('pt-BR').format(row.value)}
              </div>
              <div className="text-[10.5px] text-ig-text-tertiary">{share.toFixed(1)}%</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TrendSparkline({ series }: { series: NonNullable<FinanceKpi['trendSeries']> }) {
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 320;
  const h = 64;
  const step = w / Math.max(1, series.length - 1);
  const path = series
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.value - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  const last = series[series.length - 1];
  const first = series[0];
  const delta = first ? ((last.value - first.value) / Math.abs(first.value || 1)) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="flex-1 h-16 min-w-0" preserveAspectRatio="none">
        <path d={path} stroke="currentColor" className="text-ig-accent" fill="none" strokeWidth={1.5} />
      </svg>
      <div className="text-right">
        <div className="text-[12px] tabular-nums">{last?.value.toLocaleString('pt-BR')}</div>
        <div className={cn('text-[11px] flex items-center gap-1 justify-end', delta >= 0 ? 'text-ig-success' : 'text-ig-danger')}>
          {delta === 0 ? <Minus className="w-3 h-3" /> : delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {fmtPct(delta)}
        </div>
      </div>
    </div>
  );
}
