'use client';

/**
 * NÍVEL B — LINHA DO TEMPO E PREVISÃO ROLANTE.
 *
 * Duas leituras da mesma carteira:
 *
 *   · a RÉGUA ANUAL, mês a mês, com previsto e faturado lado a lado
 *   · as JANELAS rolantes (corrente, 3, 6 meses e horizonte completo)
 *
 * ─── A regra que governa as barras ────────────────────────────────────────
 *
 * Duas barras por mês, nunca uma empilhada sobre a outra. Empilhar somaria
 * previsto com faturado visualmente, e o olho leria a altura total como
 * "dinheiro do mês" — que é a soma que este módulo inteiro se recusa a fazer.
 * Lado a lado, a comparação é a informação.
 *
 * ─── E o que as barras NÃO desenham ───────────────────────────────────────
 *
 * Recebido não vira barra. Caixa é afirmação de Finanças e aparece como
 * número, no seu próprio lugar — uma barra verde ao lado das outras duas o
 * faria parecer mais uma etapa do mesmo funil de Contratos.
 */

import { useMemo } from 'react';
import type {
  BillingMonthPlanRow, } from '@/lib/contracts/billing/planning/month-plan-types';
import {
  buildForecast, monthShortLabel, monthKey,
  type MonthlyPortfolio,
} from '@/lib/contracts/billing/planning/monthly-planning';
import { money, moneyCompact, ABSENT } from './plan-format';

interface Props {
  readonly portfolio: MonthlyPortfolio;
  readonly rows: readonly BillingMonthPlanRow[];
  readonly asOf: Date;
  readonly selectedMonth: string;
  readonly onSelectMonth: (month: string) => void;
}

export function BillingForecastTimeline({
  portfolio, rows, asOf, selectedMonth, onSelectMonth,
}: Props) {
  const forecast = useMemo(() => buildForecast(rows, asOf), [rows, asOf]);

  // A escala é comum a TODAS as colunas. Uma escala por coluna faria dois
  // meses de valores muito diferentes desenharem barras do mesmo tamanho.
  const ceiling = Math.max(
    1,
    ...portfolio.months.map((m) => Math.max(m.totals.plannedTotal ?? 0, m.totals.billedTotal ?? 0)),
  );
  const height = (value: number | null) =>
    value === null || value <= 0 ? 2 : Math.max(2, Math.round((value / ceiling) * 88));

  const current = monthKey(asOf);

  return (
    <div className="space-y-4">
      {/* ── Janelas rolantes ───────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {forecast.map((w) => (
          <div key={w.horizon} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <p className="text-ig-label font-semibold text-ig-fg-subtle">{w.label}</p>
            <p className="mt-1 text-ig-body-sm font-semibold tabular-nums text-ig-fg-strong">
              {money(w.totals.plannedTotal)}
            </p>
            <p className="dossier-meta">previsto · {w.totals.count} marco(s)</p>
            <dl className="mt-2 space-y-0.5">
              <Line label="Elegível" value={w.totals.eligibleTotal} />
              <Line label="Faturado" value={w.totals.billedTotal} />
              <Line label="Variação" value={w.variance} />
            </dl>
          </div>
        ))}
      </div>

      {/* ── Régua anual ────────────────────────────────────────────────── */}
      {portfolio.months.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-ig-caption text-ig-fg-muted">
            <Legend grade="planned" label="Previsto contratual" />
            <Legend grade="billed" label="Faturado (evento gerado)" />
            <span>Recebido aparece como número, não como barra — caixa é afirmação de Finanças.</span>
          </div>
          <div className="ig-forecast-track" role="group" aria-label="Meses previstos">
            {portfolio.months.map((m) => (
              <button
                key={m.month}
                type="button"
                className="ig-forecast-col"
                data-position={m.month === current ? 'current' : m.position}
                aria-pressed={m.month === selectedMonth}
                onClick={() => onSelectMonth(m.month)}
                title={`${m.label}\nPrevisto: ${money(m.totals.plannedTotal)}\nFaturado: ${money(m.totals.billedTotal)}`}
              >
                <div className="ig-forecast-plot">
                  <i data-grade="planned" style={{ height: `${height(m.totals.plannedTotal)}px` }} />
                  <i data-grade="billed" style={{ height: `${height(m.totals.billedTotal)}px` }} />
                </div>
                <span className="ig-forecast-col-label">{monthShortLabel(m.month)}</span>
                <span className="ig-forecast-col-label">
                  {m.totals.plannedTotal === null ? '—' : moneyCompact(m.totals.plannedTotal)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-ig-caption text-ig-fg-muted">
          Nenhum marco contratual com data prevista neste recorte.
        </p>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ig-caption text-ig-fg-muted">{label}</dt>
      <dd className={`text-ig-caption tabular-nums ${value === null ? 'text-ig-fg-subtle' : 'font-semibold text-ig-fg-default'}`}>
        {value === null ? ABSENT : moneyCompact(value)}
      </dd>
    </div>
  );
}

function Legend({ grade, label }: { grade: 'planned' | 'billed'; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="ig-forecast-plot" style={{ height: 'auto' }}>
        <i data-grade={grade} style={{ height: 10, width: 8 }} />
      </span>
      {label}
    </span>
  );
}
