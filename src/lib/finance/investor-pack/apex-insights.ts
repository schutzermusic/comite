/**
 * Apex — camada de leitura (storytelling) da Projeção Financeira.
 *
 * REGRA: aqui não existe nenhuma regra financeira nova. Tudo é leitura do
 * `InvestorPackSnapshot` já produzido por `calculateInvestorPack` — extremos,
 * contagens, participação relativa e média de valores que o snapshot já
 * calculou. Nenhum número é inventado: quando o dado não existe, o campo é
 * `null` e a apresentação mostra "N/D".
 *
 * Existe para que PDF, PPTX e HTML contem a MESMA história com os MESMOS
 * títulos, em vez de cada exportador improvisar o seu texto.
 */

import { formatInvestorRatio } from './apex-theme';
import { formatInvestorCurrency, formatInvestorPeriod } from './calculations';
import type { InvestorPackCurvePoint, InvestorPackSnapshot } from './types';

export type ApexVerdict = 'surplus' | 'balanced' | 'deficit' | 'unknown';

export interface ApexMonthRef {
  period: string;
  label: string;
  valueCents: number;
}

export interface ApexInsights {
  /** Classificação do período a partir da cobertura receita/folha do snapshot. */
  verdict: ApexVerdict;
  /** Título de capa/síntese derivado do veredito (mesmo texto nos 3 destinos). */
  verdictHeadline: string;
  /** Rótulo curto do veredito para chips/badges. */
  verdictLabel: string;
  /** "1,42x" ou "N/D". */
  coverageLabel: string;
  /** Cobertura em pontos percentuais acima/abaixo do ponto de equilíbrio. */
  coverageMarginPct: number | null;

  /** Competências com valor realizado informado. */
  realizedMonths: number;
  /** Competências com valor previsto informado. */
  forecastMonths: number;
  /** Participação do previsto na receita total do recorte (0..1). */
  forecastShare: number | null;

  /** Maior receita total do recorte. */
  peakRevenue: ApexMonthRef | null;
  /** Maior folha total do recorte. */
  peakPayroll: ApexMonthRef | null;
  /** Melhor e pior saldo mensal. */
  bestBalance: ApexMonthRef | null;
  worstBalance: ApexMonthRef | null;
  /** Mês de menor cobertura (receita/folha) entre os que têm folha informada. */
  tightestCoverage: { period: string; label: string; ratio: number } | null;

  /** Competências com saldo mensal negativo. */
  deficitMonths: ApexMonthRef[];
  /** Primeira competência em que o saldo acumulado fica negativo. */
  firstCumulativeDeficit: ApexMonthRef | null;
  /** Saldo acumulado ao fim do recorte. */
  closingBalanceCents: number;
  /** Média do saldo mensal no recorte (saldo total ÷ nº de competências). */
  averageBalanceCents: number | null;

  /** Cartões de leitura prontos para render (ordem = prioridade editorial). */
  cards: ApexInsightCard[];
}

export interface ApexInsightCard {
  kind: 'signal' | 'alert' | 'watch';
  label: string;
  value: string;
  detail: string;
}

function monthRef(point: InvestorPackCurvePoint, valueCents: number): ApexMonthRef {
  return { period: point.period, label: formatInvestorPeriod(point.period), valueCents };
}

function pickBy(
  points: InvestorPackCurvePoint[],
  value: (p: InvestorPackCurvePoint) => number,
  better: (candidate: number, current: number) => boolean,
): ApexMonthRef | null {
  let chosen: InvestorPackCurvePoint | null = null;
  for (const point of points) {
    if (!chosen || better(value(point), value(chosen))) chosen = point;
  }
  return chosen ? monthRef(chosen, value(chosen)) : null;
}

export function buildApexInsights(snapshot: InvestorPackSnapshot): ApexInsights {
  const { points, metrics } = snapshot;
  const ratio = metrics.coverageRatio;

  const verdict: ApexVerdict = ratio == null
    ? 'unknown'
    : ratio >= 1.15 ? 'surplus'
      : ratio >= 1 ? 'balanced'
        : 'deficit';

  const coverageLabel = formatInvestorRatio(ratio);

  const verdictHeadline = {
    surplus: `A receita do período cobre ${coverageLabel} o custo de folha informado`,
    balanced: `A receita cobre ${coverageLabel} a folha — operação no ponto de equilíbrio`,
    deficit: `A receita cobre apenas ${coverageLabel} da folha informada no período`,
    unknown: 'Cobertura não calculável: não há folha informada no recorte',
  }[verdict];

  const verdictLabel = {
    surplus: 'Cobertura folgada',
    balanced: 'Equilíbrio',
    deficit: 'Cobertura insuficiente',
    unknown: 'Dados insuficientes',
  }[verdict];

  const realizedMonths = points.filter((p) => p.revenueActualCents > 0 || p.payrollActualCents > 0).length;
  const forecastMonths = points.filter((p) => p.revenueForecastCents > 0 || p.payrollForecastCents > 0).length;
  const forecastShare = metrics.revenueTotalCents > 0
    ? metrics.revenueForecastCents / metrics.revenueTotalCents
    : null;

  const peakRevenue = pickBy(points, (p) => p.revenueTotalCents, (a, b) => a > b);
  const peakPayroll = pickBy(points, (p) => p.payrollTotalCents, (a, b) => a > b);
  const bestBalance = pickBy(points, (p) => p.balanceCents, (a, b) => a > b);
  const worstBalance = pickBy(points, (p) => p.balanceCents, (a, b) => a < b);

  let tightestCoverage: ApexInsights['tightestCoverage'] = null;
  for (const point of points) {
    if (point.payrollTotalCents <= 0) continue;
    const monthRatio = point.revenueTotalCents / point.payrollTotalCents;
    if (!tightestCoverage || monthRatio < tightestCoverage.ratio) {
      tightestCoverage = { period: point.period, label: formatInvestorPeriod(point.period), ratio: monthRatio };
    }
  }

  const deficitMonths = points
    .filter((p) => p.balanceCents < 0)
    .map((p) => monthRef(p, p.balanceCents));

  const firstNegative = points.find((p) => p.balanceCumulativeCents < 0) ?? null;
  const firstCumulativeDeficit = firstNegative ? monthRef(firstNegative, firstNegative.balanceCumulativeCents) : null;

  const closingBalanceCents = points.length ? points[points.length - 1].balanceCumulativeCents : 0;
  const averageBalanceCents = points.length ? Math.round(metrics.balanceCents / points.length) : null;

  const cards: ApexInsightCard[] = [];

  cards.push({
    kind: verdict === 'deficit' ? 'alert' : 'signal',
    label: 'Cobertura receita / folha',
    value: coverageLabel,
    detail: verdict === 'deficit'
      ? 'A receita informada no recorte não cobre integralmente a folha do mesmo período.'
      : 'Razão entre a receita total e a folha total do recorte informado.',
  });

  cards.push({
    kind: 'signal',
    label: 'Saldo acumulado no fecho',
    value: formatInvestorCurrency(closingBalanceCents, true),
    detail: `Diferença acumulada entre receita e folha ao fim de ${points.length} ${points.length === 1 ? 'competência' : 'competências'}.`,
  });

  if (tightestCoverage) {
    cards.push({
      kind: tightestCoverage.ratio < 1 ? 'alert' : 'watch',
      label: 'Mês mais apertado',
      value: `${tightestCoverage.label} · ${formatInvestorRatio(tightestCoverage.ratio)}`,
      detail: tightestCoverage.ratio < 1
        ? 'Nesta competência a folha supera a receita informada.'
        : 'Menor cobertura mensal do recorte.',
    });
  }

  if (peakRevenue && peakRevenue.valueCents > 0) {
    cards.push({
      kind: 'signal',
      label: 'Pico de receita',
      value: `${peakRevenue.label} · ${formatInvestorCurrency(peakRevenue.valueCents, true)}`,
      detail: 'Maior receita mensal (realizada + prevista) do recorte.',
    });
  }

  if (firstCumulativeDeficit) {
    cards.push({
      kind: 'alert',
      label: 'Saldo acumulado negativo desde',
      value: firstCumulativeDeficit.label,
      detail: 'A partir desta competência o acumulado do período fica negativo.',
    });
  } else if (deficitMonths.length) {
    cards.push({
      kind: 'watch',
      label: 'Competências com saldo negativo',
      value: `${deficitMonths.length} de ${points.length}`,
      detail: `Sem reverter o acumulado: ${deficitMonths.map((m) => m.label).join(', ')}.`,
    });
  }

  return {
    verdict,
    verdictHeadline,
    verdictLabel,
    coverageLabel,
    coverageMarginPct: ratio == null ? null : (ratio - 1) * 100,
    realizedMonths,
    forecastMonths,
    forecastShare,
    peakRevenue,
    peakPayroll,
    bestBalance,
    worstBalance,
    tightestCoverage,
    deficitMonths,
    firstCumulativeDeficit,
    closingBalanceCents,
    averageBalanceCents,
    cards,
  };
}

/** Frase de leitura do gráfico mensal (mesma nos 3 destinos). */
export function monthlyReading(insights: ApexInsights): string {
  const parts: string[] = [];
  if (insights.realizedMonths) parts.push(`${insights.realizedMonths} competência(s) com valor realizado`);
  if (insights.forecastMonths) parts.push(`${insights.forecastMonths} com previsão`);
  if (!parts.length) return 'Recorte sem competências informadas.';
  return `${parts.join(' e ')}. Realizado e previsto permanecem identificados separadamente em todas as séries.`;
}

/** Frase de leitura da Curva S. */
export function curveReading(insights: ApexInsights): string {
  if (insights.firstCumulativeDeficit) {
    return `A trajetória acumulada cruza para o campo negativo em ${insights.firstCumulativeDeficit.label} e fecha o recorte em ${formatInvestorCurrency(insights.closingBalanceCents, true)}.`;
  }
  return `A trajetória acumulada mantém-se positiva em todo o recorte e fecha em ${formatInvestorCurrency(insights.closingBalanceCents, true)}.`;
}
