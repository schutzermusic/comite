/**
 * Projeção de exibição do agregado confiável.
 *
 * O PDF de carteira usa cada métrica em dois papéis: como TEXTO (rótulo de um
 * card) e como NÚMERO (altura de uma barra, fatia de um donut). Um `Official<T>`
 * não pode virar número sem decisão — que é justamente a proteção.
 *
 * `resolveForDisplay` faz essa decisão UMA vez, no topo do builder, de forma
 * auditável: cada métrica vira `{ text, value, available }`. O texto já traz
 * "Não apurado"/"Dados indisponíveis" quando é o caso, e `value` é `null` —
 * nunca `0` — para que gráficos possam se omitir em vez de desenhar uma barra
 * zerada que o olho lê como medição.
 *
 * A tela consome `TrustedPortfolioStats` direto; o PDF consome esta projeção do
 * MESMO objeto. Não há segundo cálculo, logo não há como divergirem.
 */

import {
  hasOfficialValue, isError,
  type Official,
} from './trusted';
import { officialCurrencyCompact, officialCount, officialPercent } from './format';
import type { TrustedPortfolioStats } from './portfolio';

export type DisplayMetric = {
  /** Já formatado, incluindo o rótulo do estado quando não há valor. */
  readonly text: string;
  /** Número cru, ou `null` quando não apurado. NUNCA 0 por ausência. */
  readonly value: number | null;
  /** Atalho para `value !== null`. */
  readonly available: boolean;
  /** Verdadeiro quando a indisponibilidade é uma FALHA, não uma ausência. */
  readonly failed: boolean;
};

const asMetric = (t: Official<number>, format: (t: Official<number>) => string): DisplayMetric => ({
  text: format(t),
  value: hasOfficialValue(t) ? t.value : null,
  available: hasOfficialValue(t),
  failed: isError(t),
});

const currency = (t: Official<number>) => asMetric(t, officialCurrencyCompact);
const count = (t: Official<number>) => asMetric(t, officialCount);
/** Percentual entra como razão 0..1 e sai como 0..100 no `value`. */
const percent = (t: Official<number>): DisplayMetric => ({
  text: officialPercent(t),
  value: hasOfficialValue(t) ? Math.round(t.value * 100) : null,
  available: hasOfficialValue(t),
  failed: isError(t),
});

export type DisplayPortfolioStats = {
  readonly contractCount: number;
  readonly totalValue: DisplayMetric;
  readonly billedValue: DisplayMetric;
  readonly remainingValue: DisplayMetric;
  readonly billedPct: DisplayMetric;
  readonly backlogPct: DisplayMetric;
  readonly expiring90: DisplayMetric;
  readonly within30: DisplayMetric;
  readonly highRisk: DisplayMetric;
  readonly highRiskExposure: DisplayMetric;
  readonly overdueObligations: DisplayMetric;
  readonly contractsWithOverdue: DisplayMetric;
  readonly pendingDocuments: DisplayMetric;
  readonly contractsWithPendingDocs: DisplayMetric;
  readonly contractsWithoutProject: DisplayMetric;
  readonly contractsWithoutBilling: DisplayMetric;
  readonly contractsInLegalReview: DisplayMetric;
  readonly contractsWithoutAi: DisplayMetric;
  /** Lista de métricas não apuradas, para o aviso de cobertura do relatório. */
  readonly unavailable: readonly { label: string; reason: 'missing' | 'error' }[];
};

const LABELS: Record<string, string> = {
  totalValue: 'Valor total contratado',
  billedValue: 'Faturado',
  remainingValue: 'Saldo a faturar',
  billedPct: 'Execução financeira',
  expiring90: 'Vencendo ≤90d',
  overdueObligations: 'Obrigações atrasadas',
  pendingDocuments: 'Documentos pendentes',
  contractsWithoutProject: 'Contratos sem projeto',
  contractsInLegalReview: 'Em revisão jurídica',
};

export function resolveForDisplay(stats: TrustedPortfolioStats): DisplayPortfolioStats {
  const out = {
    contractCount: stats.contractCount,
    totalValue: currency(stats.totalValue),
    billedValue: currency(stats.billedValue),
    remainingValue: currency(stats.remainingValue),
    billedPct: percent(stats.billedPct),
    backlogPct: percent(stats.backlogPct),
    expiring90: count(stats.expiring90),
    within30: count(stats.within30),
    highRisk: count(stats.highRisk),
    highRiskExposure: currency(stats.highRiskExposure),
    overdueObligations: count(stats.overdueObligations),
    contractsWithOverdue: count(stats.contractsWithOverdue),
    pendingDocuments: count(stats.pendingDocuments),
    contractsWithPendingDocs: count(stats.contractsWithPendingDocs),
    contractsWithoutProject: count(stats.contractsWithoutProject),
    contractsWithoutBilling: count(stats.contractsWithoutBilling),
    contractsInLegalReview: count(stats.contractsInLegalReview),
    contractsWithoutAi: count(stats.contractsWithoutAi),
  };

  /**
   * O relatório oficial declara o que NÃO conseguiu apurar. Um PDF que omite
   * suas próprias lacunas é tão enganoso quanto um que as preenche com ficção.
   */
  const unavailable = (Object.keys(LABELS) as (keyof typeof out)[])
    .filter((key) => key in out && !(out[key] as DisplayMetric).available)
    .map((key) => ({
      label: LABELS[key as string],
      reason: (out[key] as DisplayMetric).failed ? ('error' as const) : ('missing' as const),
    }));

  return { ...out, unavailable };
}
