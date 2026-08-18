/**
 * Linha de base da comparação.
 *
 * `resolvePeriodRange` já sabe achar a janela anterior de cada período e não
 * muda uma linha. O que falta é escolher ENTRE bases — período anterior ou
 * mesmo período do ano anterior — e dizer honestamente quando não existe base
 * nenhuma.
 *
 * ─── O truque ──────────────────────────────────────────────────────────────
 *
 * A base resolvida é devolvida como uma `WorkforcePeriodSelection` sintética
 * (`{ key: 'custom', … }`). O modelo então chama `selectWorkforceOverview` uma
 * SEGUNDA vez com ela e compara os dois resultados. Nenhum seletor precisa
 * aprender o que é comparação, `period.ts` fica intacto, e todo KPI ganha delta
 * de graça — inclusive os que `WorkforcePeriodMeta` nunca cobriu.
 *
 * ─── Orçamento / meta ──────────────────────────────────────────────────────
 *
 * Não existe fonte de orçamento de folha em nenhum lugar do repositório, então
 * não há um terceiro modo aqui. A ausência é deliberada: um campo `target?:
 * number` anulável seria preenchido por alguém, algum dia, com um número
 * plausível — e o cockpit voltaria a afirmar o que ninguém aprovou. Se a fonte
 * aparecer, ela entra como um novo `ComparisonMode`.
 */

import {
  resolvePeriodRange,
  shiftCompetenceMonth,
  type WorkforceMonthlyRecord,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';
import { measured, unmeasured, type ComparisonMode, type Measured } from './types';

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function monthLabel(competenceMonth: string): string {
  const [y, m] = competenceMonth.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]}/${y}`;
}

function windowLabel(months: string[]): string {
  if (months.length === 0) return '';
  if (months.length === 1) return monthLabel(months[0]);
  return `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`;
}

export interface ResolvedComparison {
  /** Seleção sintética que reproduz a janela de base sobre a mesma série. */
  selection: Measured<WorkforcePeriodSelection>;
  /** 'vs mês anterior' | 'vs mesmo período de 2025'. */
  label: Measured<string>;
  /** A janela que serviu de base: 'Jan/2025 – Mar/2025'. */
  windowLabel: Measured<string>;
}

const NO_BASELINE: ResolvedComparison = {
  selection: unmeasured<WorkforcePeriodSelection>('no-baseline'),
  label: unmeasured<string>('no-baseline'),
  windowLabel: unmeasured<string>('no-baseline'),
};

/**
 * Resolve a base pedida, ou declara que não há base.
 *
 * Nunca completa mês faltante com zero: uma janela do ano anterior que só
 * existe pela metade compara pela metade e DIZ quais meses casaram, porque
 * "folha caiu 40%" e "faltam quatro meses na base" são leituras opostas do
 * mesmo gráfico.
 */
export function resolveComparisonSelection(
  selection: WorkforcePeriodSelection,
  series: WorkforceMonthlyRecord[],
  mode: ComparisonMode,
): ResolvedComparison {
  if (mode === 'none' || series.length === 0) return NO_BASELINE;

  const range = resolvePeriodRange(selection, series);
  if (range.current.length === 0) return NO_BASELINE;

  if (mode === 'previous-period') {
    if (range.previous.length === 0) return NO_BASELINE;
    const months = range.previous.map((r) => r.competenceMonth);
    return {
      selection: measured<WorkforcePeriodSelection>({
        key: 'custom',
        customStart: months[0],
        customEnd: months[months.length - 1],
      }),
      label: measured(comparisonLabelFor(selection, range.previous.length)),
      windowLabel: measured(windowLabel(months)),
    };
  }

  // ── Mesmo período do ano anterior ────────────────────────────────────────
  const available = new Set(series.map((r) => r.competenceMonth));
  const wanted = range.current.map((r) => shiftCompetenceMonth(r.competenceMonth, 12));
  const matched = wanted.filter((m) => available.has(m));

  if (matched.length === 0) return NO_BASELINE;

  const previousYear = wanted[0].slice(0, 4);
  const partial = matched.length < wanted.length;

  return {
    selection: measured<WorkforcePeriodSelection>({
      key: 'custom',
      customStart: matched[0],
      customEnd: matched[matched.length - 1],
    }),
    label: measured(`vs mesmo período de ${previousYear}`),
    // Base parcial continua sendo base — mas o rótulo nomeia exatamente o que
    // entrou, para ninguém ler a lacuna como queda.
    windowLabel: measured(
      partial
        ? `${windowLabel(matched)} (${matched.length} de ${wanted.length} meses apurados)`
        : windowLabel(matched),
    ),
  };
}

/** Frase da comparação por período, no vocabulário do período escolhido. */
function comparisonLabelFor(selection: WorkforcePeriodSelection, months: number): string {
  switch (selection.key) {
    case 'current-month':
    case 'previous-month':
      return 'vs mês anterior';
    case 'current-quarter':
      return 'vs trimestre anterior';
    case 'current-year':
      return 'vs ano anterior';
    default:
      return months === 1 ? 'vs mês anterior' : 'vs período anterior';
  }
}

/**
 * Se o modo tem base sobre esta série — para o seletor desabilitar a opção com
 * o motivo à mostra, em vez de oferecer uma escolha que não produz efeito.
 */
export function comparisonModeAvailable(
  selection: WorkforcePeriodSelection,
  series: WorkforceMonthlyRecord[],
  mode: ComparisonMode,
): boolean {
  if (mode === 'none') return true;
  return resolveComparisonSelection(selection, series, mode).selection.measured;
}
