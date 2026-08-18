/**
 * Cobertura de uma competência do eSocial: o que dá para afirmar e o que não dá.
 *
 * POR QUE ISTO É UM MÓDULO, E NÃO UM DETALHE
 *
 * O pacote do eSocial Download é entregue dentro de uma janela de retenção. Na
 * prática isso produz meses de duas naturezas bem diferentes, que se parecem
 * muito quando viram número na tela:
 *
 *   • mês completo   — folha detalhada (S-1200) + totalizadores;
 *   • mês só apurado — os totalizadores chegaram, o detalhe da folha já tinha
 *                      expirado. Janeiro/2025 da base real mostra R$ 5.820 de
 *                      folha e R$ 83.027 de INSS: os dois são verdade, mas o
 *                      primeiro é o resíduo de um detalhe que não existe mais.
 *
 * Exibir os dois com a mesma tipografia é o que transforma dado incompleto em
 * conclusão errada. Este módulo classifica a competência e escolhe a massa que
 * pode ser mostrada — preferindo sempre a base apurada pelo próprio governo,
 * que existe em toda competência fechada.
 */

/** Piso de cobertura da tabela de rubricas para publicar composição de folha. */
export const MIN_RUBRIC_COVERAGE = 0.9;

/**
 * Abaixo disto, o detalhe declarado no S-1200 é pequeno demais em relação à base
 * apurada para representar a folha do mês.
 */
const MIN_DETAIL_RATIO = 0.5;

export interface CompetenceMetricsLike {
  competence: string;
  gross_payroll_cents: number;
  rubric_total_cents?: number | null;
  rubric_mapped_cents?: number | null;
  cp_base_cents?: number | null;
  fgts_base_cents?: number | null;
  headcount: number;
  payslip_gross_cents?: number | null;
  payslip_line_count?: number | null;
}

export type PayrollSource =
  /** Soma das rubricas classificadas como provento pela tabela S-1010. */
  | 'rubricas'
  /** Rubricas provisórias inferidas das colunas do contracheque. */
  | 'payslip_pdf'
  /** Base de cálculo apurada pelo eSocial — completa, porém sem composição. */
  | 'base_esocial'
  | 'indisponivel';

export type DetailLevel = 'complete' | 'partial' | 'missing';

export interface CompetenceCoverage {
  competence: string;
  /** Massa salarial em reais que pode ser exibida para o mês. */
  payroll: number;
  payrollSource: PayrollSource;
  /** Fração do valor declarado no S-1200 com rubrica classificada (0..1). */
  rubricCoverage: number;
  /** A folha detalhada representa o mês? */
  detail: DetailLevel;
  /**
   * Horas extras, benefícios e descontos só significam algo quando a tabela de
   * rubricas cobre a folha. Fora disso, zero não é ausência: é desconhecimento.
   */
  compositionReliable: boolean;
  /** Origem da classificação da composição, nunca confundida com S-1010. */
  classificationBasis: 's1010' | 'payslip_pdf' | null;
  /** Frase pronta para a interface. Vazia quando o mês está completo. */
  note?: string;
}

export function competenceCoverage(m: CompetenceMetricsLike): CompetenceCoverage {
  const rubricTotal = m.rubric_total_cents ?? 0;
  const rubricMapped = m.rubric_mapped_cents ?? 0;
  // A base do INSS é a referência preferida; a do FGTS cobre o mês quando o
  // S-5011 não veio. Ambas são apuradas pelo eSocial, não por nós.
  const baseCents = m.cp_base_cents ?? m.fgts_base_cents ?? 0;

  const rubricCoverage = rubricTotal > 0 ? rubricMapped / rubricTotal : 0;
  const officialCompositionReliable = rubricTotal > 0 && rubricCoverage >= MIN_RUBRIC_COVERAGE;
  const hasPayslipFallback = (m.payslip_line_count ?? 0) > 0 && (m.payslip_gross_cents ?? 0) > 0;

  const detail: DetailLevel =
    rubricTotal === 0
      ? 'missing'
      : baseCents > 0 && rubricTotal < baseCents * MIN_DETAIL_RATIO
        ? 'partial'
        : 'complete';

  // A folha só sai das rubricas quando elas estão classificadas E representam o
  // mês. Caso contrário vale a base apurada, que nunca está pela metade.
  const useRubricas = officialCompositionReliable && detail === 'complete' && m.gross_payroll_cents > 0;
  const usePayslip = !useRubricas && hasPayslipFallback;
  const payrollCents = useRubricas ? m.gross_payroll_cents : usePayslip ? (m.payslip_gross_cents ?? 0) : baseCents;
  const compositionReliable = useRubricas || usePayslip;

  return {
    competence: m.competence,
    payroll: payrollCents / 100,
    payrollSource: useRubricas ? 'rubricas' : usePayslip ? 'payslip_pdf' : payrollCents > 0 ? 'base_esocial' : 'indisponivel',
    rubricCoverage,
    detail,
    compositionReliable,
    classificationBasis: useRubricas ? 's1010' : usePayslip ? 'payslip_pdf' : null,
    note: usePayslip
      ? 'Classificação provisória por holerite/PDF. A tabela oficial S-1010 segue pendente.'
      : coverageNote(detail, officialCompositionReliable, payrollCents > 0),
  };
}

function coverageNote(
  detail: DetailLevel,
  compositionReliable: boolean,
  hasBase: boolean,
): string | undefined {
  if (detail === 'missing') {
    return hasBase
      ? 'Só os totalizadores desta competência estão no acervo: a folha detalhada (S-1200) já tinha saído da janela de retenção do eSocial. Os valores de guia são reais; a composição da folha não está disponível.'
      : 'Competência sem folha detalhada e sem totalizadores.';
  }
  if (detail === 'partial') {
    return 'A folha detalhada cobre apenas parte desta competência. A massa exibida vem da base apurada pelo eSocial, que é completa.';
  }
  if (!compositionReliable) {
    return 'A tabela de rubricas (S-1010) não cobre esta folha, então as verbas não puderam ser classificadas. Horas extras, benefícios e descontos ficam indisponíveis até a tabela completa ser importada.';
  }
  return undefined;
}

/** Resumo do acervo inteiro, para o aviso no topo do cockpit. */
export interface CoverageSummary {
  total: number;
  complete: number;
  partial: number;
  missing: number;
  /** Competências cuja composição de folha é confiável. */
  withComposition: number;
}

export function summarizeCoverage(metrics: CompetenceMetricsLike[]): CoverageSummary {
  const summary: CoverageSummary = {
    total: metrics.length,
    complete: 0,
    partial: 0,
    missing: 0,
    withComposition: 0,
  };
  for (const m of metrics) {
    const c = competenceCoverage(m);
    summary[c.detail === 'complete' ? 'complete' : c.detail === 'partial' ? 'partial' : 'missing'] += 1;
    if (c.compositionReliable) summary.withComposition += 1;
  }
  return summary;
}
