/**
 * Seletores de Pessoas & Custos.
 *
 * Depois da remoção dos dados de demonstração, estes testes têm duas funções:
 * garantir o recorte de janela dos gráficos e — mais importante — travar a
 * regra de que indicador sem fonte fica AUSENTE. Um seletor que voltasse a
 * preencher lacuna com modelo derivado quebraria aqui.
 */
import { describe, expect, it } from 'vitest';
import {
  selectAdmissionsVsDismissals,
  selectAbsenteeismByArea,
  selectBenefitsByType,
  selectCostCenterConcentration,
  selectMonthlyIndicatorMatrix,
  selectOvertimeTrend,
  selectPayrollComposition,
  selectPayrollRisk,
  selectPayrollSCurve,
  selectPayrollVsRevenue,
  selectTurnoverByArea,
  selectTurnoverTrend,
  selectWorkforceAlerts,
  selectWorkforceEfficiency,
  selectWorkforceOverview,
  selectWorkforceTrend,
  type WorkforceActuals,
  type WorkforceMonthlyRecord,
} from '@/lib/workforce/period';

/** Série com valor de folha, mas SEM nada apurado pelo eSocial. */
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

function actuals(overrides: Partial<WorkforceActuals> = {}): WorkforceActuals {
  return {
    admissions: 2,
    terminations: 1,
    absenceDays: 4,
    absenceEvents: 1,
    coverage: {
      competence: '2026-04',
      payroll: 130,
      payrollSource: 'rubricas',
      rubricCoverage: 1,
      detail: 'complete',
      compositionReliable: true,
      classificationBasis: 's1010',
    },
    composition: { salary: 90, benefits: 15, charges: 25 },
    benefitsByType: { va: 8, vr: 3, health: 2, dental: 1, transport: 1, other: 0 },
    overtimePct: 7.5,
    areas: [
      {
        code: 'OPER',
        label: 'Operações',
        headcount: 10,
        admissions: 2,
        terminations: 1,
        absenceDays: 4,
        payroll: 130,
      },
    ],
    ...overrides,
  };
}

/** Mesma série, agora com as duas competências finais apuradas. */
const apurada: WorkforceMonthlyRecord[] = series.map((r) =>
  r.competenceMonth >= '2026-03' ? { ...r, actuals: actuals() } : r,
);

describe('recorte de janela dos gráficos', () => {
  it('limita aos dois meses mais recentes as séries que só dependem da folha', () => {
    const selection = { key: 'all' as const };
    const chartSeries = [
      selectWorkforceTrend(selection, series),
      selectPayrollSCurve(selection, series),
      selectPayrollVsRevenue(selection, series),
      selectWorkforceEfficiency(selection, series),
    ];

    chartSeries.forEach((points) => {
      expect(points).toHaveLength(2);
      expect(points.map((point) => point.period)).toEqual(['Mar/2026', 'Abr/2026']);
    });
  });

  it('inclui o mês anterior quando o filtro aponta para um único mês', () => {
    const selection = { key: 'previous-month' as const };
    expect(selectPayrollVsRevenue(selection, series).map((p) => p.period)).toEqual([
      'Fev/2026',
      'Mar/2026',
    ]);
  });
});

describe('indicador sem fonte fica ausente, nunca zerado', () => {
  const selection = { key: 'all' as const };

  it('não inventa composição de folha sem classificação de verba', () => {
    // Antes: rateio por senoide (68,5% salário, 14,8% encargos) sobre a massa.
    expect(selectPayrollComposition(selection, series)).toEqual([]);
    expect(selectBenefitsByType(selection, series)).toEqual([]);
  });

  it('não inventa movimentação de pessoal sem os eventos declarados', () => {
    // Antes: churn = headcount × 1,5% × (1 + 0,3·sen(i)).
    expect(selectAdmissionsVsDismissals(selection, series)).toEqual([]);
    expect(selectTurnoverTrend(selection, series)).toEqual([]);
  });

  it('não inventa horas extras sem a tabela de rubricas', () => {
    // Antes: 8,5 + 3,2·sen(i) + 1,5·cos(i) — a origem do "11,2%" da tela.
    expect(selectOvertimeTrend(selection, series)).toEqual([]);
  });

  it('não inventa absenteísmo nem turnover por área sem afastamento declarado', () => {
    // Antes: taxa fixa por centro de custo, ou derivada do hash do id.
    expect(selectAbsenteeismByArea(selection, series)).toEqual([]);
    expect(selectTurnoverByArea(selection, series)).toEqual([]);
  });

  it('não inventa centro de custo: sem rateio no lote, não há área', () => {
    // Antes: catálogo fixo (Engenharia, Operações, Comercial…) com gerentes.
    expect(selectCostCenterConcentration(selection, series).costCenters).toEqual([]);
  });

  it('série vazia não quebra nem produz número', () => {
    const { rows, total } = selectMonthlyIndicatorMatrix(selection, []);
    expect(rows).toEqual([]);
    expect(total.headcount).toBe(0);
    expect(total.payroll).toBe(0);
    expect(total.turnoverPct).toBeNull();
  });

  it('nenhum seletor lança com série vazia, em nenhum período', () => {
    // Regressão real: com a série de demonstração, a janela nunca vinha vazia e
    // o código assumia isso. Sem mock, o primeiro render — antes de o eSocial
    // responder — passa exatamente por aqui, e a tela quebrava com
    // "Cannot read properties of null (reading 'months')".
    const periods = [
      { key: 'current-month' as const },
      { key: 'previous-month' as const },
      { key: 'current-quarter' as const },
      { key: 'current-year' as const },
      { key: 'all' as const },
      { key: 'custom' as const, customStart: '2026-01', customEnd: '2026-04' },
    ];

    for (const p of periods) {
      expect(() => {
        selectWorkforceOverview(p, []);
        selectPayrollRisk(p, []);
        selectWorkforceTrend(p, []);
        selectCostCenterConcentration(p, []);
        selectWorkforceAlerts(p, []);
        selectPayrollSCurve(p, []);
        selectPayrollVsRevenue(p, []);
        selectWorkforceEfficiency(p, []);
        selectMonthlyIndicatorMatrix(p, []);
      }, `período ${p.key}`).not.toThrow();
    }

    expect(selectWorkforceOverview({ key: 'all' }, []).metrics.headcount.total).toBe(0);
    expect(selectWorkforceOverview({ key: 'all' }, []).meta.periodLabel).toBe(
      'Sem competência apurada',
    );
  });
});

describe('com competência apurada, os indicadores aparecem', () => {
  const selection = { key: 'all' as const };

  it('usa a composição classificada, e só das competências apuradas', () => {
    const composition = selectPayrollComposition(selection, apurada);
    expect(composition.map((p) => p.period)).toEqual(['Mar/2026', 'Abr/2026']);
    expect(composition[0]).toMatchObject({ salary: 90, benefits: 15, charges: 25 });
  });

  it('abre benefícios pelos tipos declarados na tabela de rubricas', () => {
    expect(selectBenefitsByType(selection, apurada)[0]).toMatchObject({ va: 8, vr: 3, health: 2 });
  });

  it('usa admissões e desligamentos declarados', () => {
    expect(selectAdmissionsVsDismissals(selection, apurada)).toEqual([
      { period: 'Mar/2026', admissions: 2, dismissals: 1, net: 1 },
      { period: 'Abr/2026', admissions: 2, dismissals: 1, net: 1 },
    ]);
  });

  it('casa turnover com o headcount da própria competência', () => {
    const turnover = selectTurnoverTrend(selection, apurada);
    // Abr/2026 tem headcount 13 e 1 desligamento → 7,69%.
    expect(turnover.find((t) => t.period === 'Abr/2026')?.turnoverPct).toBeCloseTo(7.69, 2);
  });

  it('usa as horas extras apuradas sobre as rubricas', () => {
    expect(selectOvertimeTrend(selection, apurada).map((o) => o.overtimePct)).toEqual([7.5, 7.5]);
  });

  it('abre absenteísmo e turnover pela lotação declarada', () => {
    expect(selectAbsenteeismByArea(selection, apurada)[0]).toMatchObject({ area: 'Operações' });
    expect(selectTurnoverByArea(selection, apurada)[0]).toMatchObject({
      area: 'Operações',
      dismissals: 2,
    });
  });
});
