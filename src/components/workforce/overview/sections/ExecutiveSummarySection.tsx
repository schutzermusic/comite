'use client';

/**
 * Seção 1 — Resumo executivo.
 *
 * A camada que responde "como estamos" antes de qualquer gráfico: a frase de
 * abertura, a faixa de KPIs e o radar de sinais.
 *
 * O radar mudou de regra. Ele mostrava um chip verde "Crescimento · alinhado
 * com receita" mesmo quando não havia receita nenhuma — folha e receita ambas
 * em zero passavam nos limiares e acendiam a luz verde. Agora o modelo só
 * emite sinal para indicador APURADO, e a ausência de sinais é apresentada
 * como ausência, não como saúde.
 */

import { AlertCircle, AlertTriangle, Building2, CheckCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudSignal } from '@/components/hud';
import { WorkforceOverviewCards } from '../../WorkforceOverviewCards';
import type { WorkforceKpi, WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface ExecutiveSummarySectionProps {
  model: WorkforceOverviewModel;
  onKpiClick?: (kpi: WorkforceKpi) => void;
}

const LEVEL_ICON = { ok: CheckCircle, warn: AlertTriangle, error: AlertCircle };
const CHIP_CLS = {
  ok: 'bg-ig-success/8 border-ig-success/20',
  warn: 'bg-ig-warning/8 border-ig-warning/20',
  error: 'bg-ig-danger/8 border-ig-danger/20',
};
const ICON_CLS = {
  ok: 'text-ig-success',
  warn: 'text-ig-warning',
  error: 'text-ig-danger',
};
const VALUE_CLS = {
  ok: 'text-ig-fg-muted',
  warn: 'text-ig-warning',
  error: 'text-ig-danger',
};

export function ExecutiveSummarySection({ model, onKpiClick }: ExecutiveSummarySectionProps) {
  const { executive, meta } = model;
  const { signals, alerts } = executive;

  const errorCount = signals.filter((s) => s.level === 'error').length;
  const warnCount = signals.filter((s) => s.level === 'warn').length;
  const allGood = signals.length > 0 && errorCount === 0 && warnCount === 0;
  const ccAlerts = alerts.filter((a) => a.type === 'abnormal_growth' || !a.type);

  return (
    <div className="space-y-4">
      {/* Frase de abertura — a mesma que abre os três documentos. */}
      <div className="rounded-2xl border border-ig-border-subtle bg-gradient-to-br from-ig-panel to-ig-bg-raised/40 px-5 py-4">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-ig-fg-subtle">
          Leitura do período
        </p>
        <p className="mt-1 text-[15px] font-medium leading-snug text-ig-fg-strong">
          {executive.headline}
        </p>
        {meta.comparison.windowLabel.measured && (
          <p className="mt-1.5 text-[11px] text-ig-fg-muted">
            Base de comparação: {meta.comparison.windowLabel.value}
          </p>
        )}
      </div>

      <WorkforceOverviewCards
        kpis={executive.kpis}
        periodLabel={meta.periodLabel}
        comparisonLabel={meta.comparison.label.measured ? meta.comparison.label.value : undefined}
        onKpiClick={onKpiClick}
      />

      {/* Radar de riscos */}
      <div className="overflow-hidden rounded-xl border border-ig-border-subtle">
        <div
          className={cn(
            'flex items-center justify-between border-b border-ig-border-subtle/70 px-4 py-2.5',
            signals.length === 0
              ? 'bg-ig-bg-raised/30'
              : allGood
                ? 'bg-ig-success/[0.04]'
                : errorCount > 0
                  ? 'bg-ig-danger/[0.04]'
                  : 'bg-ig-warning/[0.04]',
          )}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                signals.length === 0
                  ? 'bg-ig-fg-subtle'
                  : allGood
                    ? 'bg-ig-success'
                    : errorCount > 0
                      ? 'animate-pulse bg-ig-danger'
                      : 'animate-pulse bg-ig-warning',
              )}
            />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ig-fg-muted">
              Radar de Riscos
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {signals.length === 0 ? (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-ig-fg-subtle">
                <Info className="h-3.5 w-3.5" />
                Nenhum indicador apurado para avaliar
              </span>
            ) : allGood ? (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ig-success">
                <CheckCircle className="h-3.5 w-3.5" />
                Indicadores apurados dentro dos limites
              </span>
            ) : (
              <>
                {errorCount > 0 && (
                  <HudSignal
                    tone="critical"
                    size="sm"
                    icon={<AlertCircle />}
                    label={`Crítico${errorCount !== 1 ? 's' : ''}`}
                    value={errorCount}
                  />
                )}
                {warnCount > 0 && (
                  <HudSignal
                    tone="warning"
                    size="sm"
                    icon={<AlertTriangle />}
                    label={`Alerta${warnCount !== 1 ? 's' : ''}`}
                    value={warnCount}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {(signals.length > 0 || ccAlerts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 bg-ig-panel px-4 py-2.5">
            {signals.map((s) => {
              const Icon = LEVEL_ICON[s.level];
              return (
                <div
                  key={s.id}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]',
                    CHIP_CLS[s.level],
                  )}
                >
                  <Icon className={cn('h-3 w-3 shrink-0', ICON_CLS[s.level])} />
                  <span className="font-semibold text-ig-fg-strong">{s.label}</span>
                  <span className="text-ig-fg-subtle opacity-50">·</span>
                  <span className={cn('ig-tabular font-medium', VALUE_CLS[s.level])}>{s.detail}</span>
                </div>
              );
            })}

            {ccAlerts.length > 0 && (
              <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ig-warning/20 bg-ig-warning/8 px-2.5 py-1.5 text-[11px]">
                <Building2 className="h-3 w-3 shrink-0 text-ig-warning" />
                <span className="font-semibold text-ig-fg-strong">
                  {ccAlerts.length} centro{ccAlerts.length !== 1 ? 's' : ''}
                </span>
                <span className="text-ig-fg-subtle opacity-50">·</span>
                <span className="ig-tabular font-medium text-ig-warning">crescimento anormal</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
