'use client';

/**
 * NÍVEL A — RESUMO EXECUTIVO DO MÊS.
 *
 * Responde, em uma tela: quanto se espera faturar neste mês, quanto se
 * esperava no anterior, quanto já virou evento e quanto está travado.
 *
 * ─── Por que quatro números e não um ───────────────────────────────────────
 *
 * PREVISTO, ELEGÍVEL, FATURADO e BLOQUEADO são quatro verdades distintas, e
 * um "total do mês" as fundiria — apresentando previsão contratual como
 * receita. Eles aparecem lado a lado, cada um com o seu grau visual, e a soma
 * é responsabilidade de quem lê, com os rótulos à vista.
 *
 * ─── Por que o mês vazio continua na régua ────────────────────────────────
 *
 * Um outubro sem nada previsto é informação — e quase sempre significa
 * "cronograma não mapeado", não "nada a faturar". Omitir a coluna faria a
 * régua pular de setembro para novembro como se outubro não existisse.
 */

import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import type {
  MonthBucket, MonthlyPortfolio,
} from '@/lib/contracts/billing/planning/monthly-planning';
import { moneyCompact, money, ABSENT } from './plan-format';

interface Props {
  readonly portfolio: MonthlyPortfolio;
  readonly selectedMonth: string;
  readonly onSelectMonth: (month: string) => void;
  readonly onStepMonth: (delta: number) => void;
}

export function BillingMonthCockpit({
  portfolio, selectedMonth, onSelectMonth, onStepMonth,
}: Props) {
  const selected = portfolio.months.find((m) => m.month === selectedMonth) ?? null;

  return (
    <div className="space-y-4">
      {/* ── Seletor de mês ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="portfolio-action"
            aria-label="Mês anterior"
            onClick={() => onStepMonth(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="inline-flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
            <CalendarRange className="h-4 w-4 text-ig-fg-muted" aria-hidden />
            {selected?.label ?? selectedMonth}
          </span>
          <button
            type="button"
            className="portfolio-action"
            aria-label="Próximo mês"
            onClick={() => onStepMonth(1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          {selectedMonth !== portfolio.currentMonth && (
            <button
              type="button"
              className="portfolio-action"
              onClick={() => onSelectMonth(portfolio.currentMonth)}
            >
              Voltar ao mês corrente
            </button>
          )}
        </div>
        <p className="dossier-meta">
          Carteira: {portfolio.totals.count} marco(s) contratual(is)
          {portfolio.undated.length > 0
            && ` · ${portfolio.undated.length} sem data prevista`}
        </p>
      </div>

      {/* ── Régua de meses ─────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {neighbours(portfolio, selectedMonth).map((bucket) => (
          <MonthCard
            key={bucket.month}
            bucket={bucket}
            selected={bucket.month === selectedMonth}
            onSelect={() => onSelectMonth(bucket.month)}
          />
        ))}
      </div>

      {/* ── Totais do mês aberto ───────────────────────────────────────── */}
      {selected && <MonthDetail bucket={selected} />}

      {/*
        Os marcos SEM data não entram em mês nenhum, e precisam ser ditos: é
        aqui que aparece o contrato cujo cronograma não chegou. Escondê-los
        faria a carteira mensal parecer completa quando não é.
      */}
      {portfolio.undated.length > 0 && (
        <p className="dossier-meta">
          {portfolio.undated.length} marco(s) contratual(is) sem data prevista não entram em
          nenhum mês — falta cronograma governado, medição agendada ou prazo no marco.
        </p>
      )}
    </div>
  );
}

/** Anterior, corrente/selecionado e o próximo — a pergunta do usuário. */
function neighbours(portfolio: MonthlyPortfolio, selected: string): MonthBucket[] {
  const index = portfolio.months.findIndex((m) => m.month === selected);
  if (index === -1) return portfolio.months.slice(0, 3);
  return portfolio.months.slice(Math.max(0, index - 1), index + 2);
}

function MonthCard({
  bucket, selected, onSelect,
}: {
  bucket: MonthBucket; selected: boolean; onSelect: () => void;
}) {
  const t = bucket.totals;
  // A barra compõe sobre o PREVISTO do mês. Sem previsto não há proporção a
  // desenhar, e uma barra cheia de nada mentiria sobre a composição.
  const base = t.plannedTotal ?? 0;
  const pct = (value: number | null) =>
    base > 0 && value !== null ? Math.min(100, (value / base) * 100) : 0;

  return (
    <button
      type="button"
      className="ig-month-card"
      data-selected={selected || undefined}
      data-position={bucket.position}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="ig-month-card-title">{bucket.label}</span>
        <span className="dossier-meta">{bucket.totals.count} marco(s)</span>
      </div>

      <dl className="space-y-1">
        <Figure grade="planned" label="Previsto" value={t.plannedTotal} />
        <Figure grade="eligible" label="Elegível" value={t.eligibleTotal} />
        <Figure grade="billed" label="Faturado" value={t.billedTotal} />
        <Figure grade="blocked" label="Bloqueado" value={t.blockedTotal} />
      </dl>

      {base > 0 && (
        <div className="ig-month-bar" role="presentation">
          <i data-grade="billed" style={{ width: `${pct(t.billedTotal)}%` }} />
          <i data-grade="eligible" style={{ width: `${pct(t.eligibleTotal)}%` }} />
          <i data-grade="blocked" style={{ width: `${pct(t.blockedTotal)}%` }} />
          <i data-grade="planned" style={{ flex: 1 }} />
        </div>
      )}
    </button>
  );
}

function Figure({
  grade, label, value,
}: {
  grade: 'planned' | 'eligible' | 'billed' | 'blocked';
  label: string;
  value: number | null;
}) {
  return (
    <div className="ig-month-figure" data-grade={grade}>
      <dt>{label}</dt>
      <dd data-absent={value === null || undefined}>
        {value === null ? ABSENT : moneyCompact(value)}
      </dd>
    </div>
  );
}

function MonthDetail({ bucket }: { bucket: MonthBucket }) {
  const t = bucket.totals;
  return (
    <div className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 sm:grid-cols-2 lg:grid-cols-5">
      <Metric label="Previsto contratual" value={money(t.plannedTotal)} hint={
        t.plannedUnknownCount > 0
          ? `${t.plannedUnknownCount} marco(s) sem valor registrado`
          : 'Direito contratual dos marcos do mês'} />
      <Metric label="Elegível para faturar" value={money(t.eligibleTotal)}
        hint="Previsto dos marcos já elegíveis" />
      <Metric label="Faturado" value={money(t.billedTotal)}
        hint="Valor dos eventos de faturamento gerados" />
      <Metric label="Recebido" value={money(t.receivedTotal)}
        hint="Liquidado conforme Finanças" />
      <Metric
        label="Variação (faturado − previsto)"
        value={bucket.variance === null ? ABSENT : money(bucket.variance)}
        hint={bucket.variance === null
          // Zero seria indistinguível de "faturou exatamente o previsto", que é
          // o oposto de "não há como comparar".
          ? 'Falta um dos lados — previsto ou faturado'
          : 'Diferença entre o apurado e o previsto do mês'}
      />
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-ig-label font-semibold text-ig-fg-subtle">{label}</p>
      <p className="mt-0.5 text-ig-body-sm font-semibold tabular-nums text-ig-fg-strong">{value}</p>
      <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{hint}</p>
    </div>
  );
}
