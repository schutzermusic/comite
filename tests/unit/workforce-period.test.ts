import { describe, expect, it } from 'vitest';
import {
  selectAdmissionsVsDismissals,
  selectBenefitsByType,
  selectOvertimeTrend,
  selectPayrollComposition,
  selectPayrollSCurve,
  selectPayrollVsRevenue,
  selectTurnoverTrend,
  selectWorkforceEfficiency,
  selectWorkforceTrend,
  type WorkforceMonthlyRecord,
} from '@/lib/workforce/period';

const series: WorkforceMonthlyRecord[] = [
  ['2026-01', 10, 100, 400],
  ['2026-02', 11, 110, 420],
  ['2026-03', 12, 120, 440],
  ['2026-04', 13, 130, 460],
].map(([competenceMonth, headcount, payroll, revenue]) => ({
  competenceMonth: String(competenceMonth),
  headcount: Number(headcount),
  payroll: Number(payroll),
  revenue: Number(revenue),
  pj: 3,
  clt: Number(headcount) - 3,
  pjCost: 30,
  cltCost: Number(payroll) - 30,
  costCenters: [],
}));

describe('gráficos de Pessoas & Custos', () => {
  it('limita todas as séries temporais aos dois meses mais recentes', () => {
    const selection = { key: 'all' as const };
    const chartSeries = [
      selectWorkforceTrend(selection, series),
      selectPayrollComposition(selection, series),
      selectPayrollSCurve(selection, series),
      selectPayrollVsRevenue(selection, series),
      selectBenefitsByType(selection, series),
      selectAdmissionsVsDismissals(selection, series),
      selectTurnoverTrend(selection, series),
      selectOvertimeTrend(selection, series),
      selectWorkforceEfficiency(selection, series),
    ];

    chartSeries.forEach((points) => {
      expect(points).toHaveLength(2);
      expect(points.map((point) => point.period)).toEqual(['Mar/2026', 'Abr/2026']);
    });
  });

  it('inclui o mês anterior quando o filtro aponta para um único mês', () => {
    const selection = { key: 'previous-month' as const };

    expect(selectPayrollComposition(selection, series).map((point) => point.period))
      .toEqual(['Fev/2026', 'Mar/2026']);
  });
});
