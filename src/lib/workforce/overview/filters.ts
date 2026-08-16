/**
 * Recorte da série apurada — a única porta por onde os filtros entram.
 *
 * Os doze seletores de `period.ts` têm assinatura idêntica
 * `(selection, seriesOverride?)` e leem EXCLUSIVAMENTE de `seriesOverride`.
 * Isso permite aplicar qualquer recorte transformando a série uma vez e
 * passando o resultado adiante, sem tocar em nenhum seletor — a mesma
 * disciplina do `visibleProjection` da Projeção Financeira, onde tela e
 * exports consomem um único objeto já filtrado e por isso não conseguem
 * divergir.
 *
 * ─── O que o recorte destrói ───────────────────────────────────────────────
 *
 * Nem todo campo de `WorkforceMonthlyRecord` se reparte por lotação. Recortar
 * calando a diferença produziria o pior resultado possível: um número menor,
 * plausível e errado. Cada campo não atribuível vira ausência declarada e
 * entra em `degradations`, que a interface renderiza em prosa acima da seção.
 *
 *   folha, centros de custo, áreas   → soma/filtra pelos selecionados
 *   admissões/desligamentos/faltas   → recalcula a partir das áreas escolhidas
 *   receita                          → NÃO atribuível (vem do contas a receber)
 *   composição / benefícios / H.E.   → NÃO atribuíveis (são totais da folha)
 *   eventos de afastamento           → NÃO atribuível (só o total de dias abre)
 *
 * Os quatro campos do meio já são tratados corretamente pelos seletores, que
 * filtram por `!== undefined` — devolvê-los ausentes faz o gráfico sumir em vez
 * de mentir, que é exatamente o comportamento desejado, e custa zero.
 */

import type { WorkforceMonthlyRecord } from '@/lib/workforce/period';
import type { Degradation, WorkforceOverviewFilters } from './types';

export interface FilteredSeries {
  series: WorkforceMonthlyRecord[];
  degradations: Degradation[];
}

const DEGRADATION_LABEL: Record<Degradation['field'], string> = {
  revenue:
    'A receita vem do contas a receber e não se reparte por lotação — Folha/Receita, receita por colaborador e o risco de folha ficam não apurados neste recorte.',
  headcount:
    'O resumo por centro de custo do lote de folha não traz quadro — headcount, custo médio e turnover ficam não apurados para as unidades selecionadas.',
  composition:
    'A composição da folha (salário, benefícios e encargos) é apurada para a competência inteira e não se reparte por lotação.',
  benefits:
    'Os benefícios por tipo são apurados para a competência inteira e não se repartem por lotação.',
  overtime:
    'O percentual de horas extras é apurado sobre a massa da competência e não se reparte por lotação.',
  absenceEvents:
    'Só os dias de afastamento abrem por lotação; a contagem de eventos é da competência inteira.',
};

const degradation = (field: Degradation['field']): Degradation => ({
  field,
  reason: 'not-attributable',
  humanLabel: DEGRADATION_LABEL[field],
});

/**
 * Aplica o recorte, devolvendo a série derivada e o que ela deixou de saber.
 *
 * Sem filtro, devolve o array de entrada POR REFERÊNCIA — o cockpit não
 * filtrado, que é o caso comum, não paga nada por este caminho existir.
 */
export function applyWorkforceFilters(
  series: WorkforceMonthlyRecord[],
  filters: WorkforceOverviewFilters,
): FilteredSeries {
  const hasUnitFilter = filters.unitIds.length > 0;
  const hasSourceFilter = filters.headcountSource !== 'all';

  if (!hasUnitFilter && !hasSourceFilter) {
    return { series, degradations: [] };
  }

  const selected = new Set(filters.unitIds);
  const degradations: Degradation[] = [];
  const mark = (field: Degradation['field']) => {
    if (!degradations.some((d) => d.field === field)) degradations.push(degradation(field));
  };

  let out = series;

  // ── Fonte do quadro ────────────────────────────────────────────────────
  //
  // Competência sem `actuals` não declarou origem: fica de fora de qualquer
  // recorte por fonte, porque "não declarou" não é o mesmo que "é a outra".
  if (hasSourceFilter) {
    out = out.filter((r) => r.actuals?.headcountSource === filters.headcountSource);
  }

  // ── Lotação / centro de custo ──────────────────────────────────────────
  if (hasUnitFilter) {
    out = out
      .map((record) => {
        const costCenters = record.costCenters.filter((cc) => selected.has(cc.id));
        const areas = (record.actuals?.areas ?? []).filter((a) =>
          selected.has(`esocial-${a.code}`),
        );

        const payroll = costCenters.reduce((sum, cc) => sum + cc.payrollValue, 0);
        const ccHeadcount = costCenters.reduce((sum, cc) => sum + cc.headcount, 0);
        const areaHeadcount = areas.reduce((sum, a) => sum + a.headcount, 0);
        const headcount = areaHeadcount > 0 ? areaHeadcount : ccHeadcount;

        // Folha recortada mas sem quadro: os centros vieram do lote, onde o
        // resumo por centro de custo grava `headcount: 0`.
        if (payroll > 0 && headcount === 0) mark('headcount');

        const actuals = record.actuals
          ? {
              ...record.actuals,
              admissions: areas.reduce((s, a) => s + a.admissions, 0),
              terminations: areas.reduce((s, a) => s + a.terminations, 0),
              absenceDays: areas.reduce((s, a) => s + a.absenceDays, 0),
              // Os quatro campos abaixo são totais da competência. Ausentes, os
              // seletores descartam o ponto; zerados, desenhariam uma queda.
              absenceEvents: 0,
              overtimePct: undefined,
              composition: undefined,
              benefitsByType: undefined,
              areas,
            }
          : undefined;

        if (record.actuals) {
          if (record.actuals.absenceEvents > 0) mark('absenceEvents');
          if (record.actuals.overtimePct !== undefined) mark('overtime');
          if (record.actuals.composition) mark('composition');
          if (record.actuals.benefitsByType) mark('benefits');
        }

        return {
          ...record,
          headcount,
          payroll,
          // A receita é da empresa, não da lotação. Zerar aqui é o que faz
          // `selectPayrollRisk` devolver `comparable: false` — o caminho por
          // onde o risco de folha se declara não apurável sozinho.
          revenue: 0,
          pj: 0,
          clt: headcount,
          pjCost: 0,
          cltCost: payroll,
          costCenters,
          actuals,
        } satisfies WorkforceMonthlyRecord;
      })
      // Competência que não sobrou nada do recorte não é competência zerada:
      // é competência fora do recorte, e não pode ocupar um ponto no eixo.
      .filter((r) => r.payroll > 0 || r.headcount > 0 || (r.actuals?.areas.length ?? 0) > 0);

    if (series.some((r) => r.revenue > 0)) mark('revenue');
  }

  return { series: out, degradations };
}

/** Legenda humana do recorte de fonte, para compor `meta.filtersLabel`. */
export const HEADCOUNT_SOURCE_LABEL: Record<WorkforceOverviewFilters['headcountSource'], string> = {
  all: 'Todas as fontes de quadro',
  esocial: 'Quadro apurado pelo eSocial',
  manual: 'Quadro informado manualmente',
};
