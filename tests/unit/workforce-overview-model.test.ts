/**
 * Modelo único da Visão Geral.
 *
 * O teste central deste arquivo é o de série vazia: ele percorre TODOS os
 * indicadores do modelo e exige que nenhum deles se declare apurado. É o
 * guardião da regra que já custou caro uma vez — quando a tela mostrava 847
 * funcionários e R$ 12,85 mi de folha vindos de seed, indistinguíveis de
 * apuração depois de formatados.
 *
 * Um `?? 0` novo em qualquer canto de `model.ts` quebra aqui.
 */
import { describe, expect, it } from 'vitest';
import { buildWorkforceOverviewModel } from '@/lib/workforce/overview/model';
import { EMPTY_ESOCIAL_LINK } from '@/lib/workforce/compliance';
import type { Measured } from '@/lib/workforce/overview/types';
import type { WorkforceActuals, WorkforceMonthlyRecord } from '@/lib/workforce/period';

function actuals(overrides: Partial<WorkforceActuals> = {}): WorkforceActuals {
  return {
    admissions: 3,
    terminations: 1,
    absenceDays: 8,
    absenceEvents: 5,
    overtimePct: 9.4,
    headcountSource: 'esocial',
    composition: { salary: 900, benefits: 150, charges: 250 },
    benefitsByType: { va: 80, vr: 30, health: 20, dental: 10, transport: 10, other: 0 },
    areas: [
      { code: 'OPER', label: 'Operações', headcount: 8, admissions: 2, terminations: 1, absenceDays: 6, payroll: 800 },
      { code: 'ADM', label: 'Administrativo', headcount: 4, admissions: 1, terminations: 0, absenceDays: 2, payroll: 500 },
    ],
    ...overrides,
  };
}

const series: WorkforceMonthlyRecord[] = ['2026-01', '2026-02', '2026-03', '2026-04'].map((competenceMonth) => ({
  competenceMonth,
  headcount: 12,
  payroll: 1300,
  revenue: 5000,
  pj: 0,
  clt: 12,
  pjCost: 0,
  cltCost: 1300,
  costCenters: [
    { id: 'esocial-OPER', name: 'Operações', payrollValue: 800, headcount: 8 },
    { id: 'esocial-ADM', name: 'Administrativo', payrollValue: 500, headcount: 4 },
  ],
  actuals: actuals(),
}));

function build(overrides: Partial<Parameters<typeof buildWorkforceOverviewModel>[0]> = {}) {
  return buildWorkforceOverviewModel({
    period: { key: 'all' },
    comparison: 'previous-period',
    rawSeries: series,
    approvedBatches: [],
    esocialLink: EMPTY_ESOCIAL_LINK,
    ...overrides,
  });
}

/** Coleta recursivamente todo nó `Measured<T>` do modelo, com seu caminho. */
function collectMeasured(node: unknown, path = '$'): { path: string; node: Measured<unknown> }[] {
  if (node === null || typeof node !== 'object') return [];

  if ('measured' in (node as Record<string, unknown>) && typeof (node as { measured: unknown }).measured === 'boolean') {
    return [{ path, node: node as Measured<unknown> }];
  }

  if (Array.isArray(node)) {
    return node.flatMap((item, i) => collectMeasured(item, `${path}[${i}]`));
  }

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    collectMeasured(value, `${path}.${key}`),
  );
}

describe('série vazia — nada pode se declarar apurado', () => {
  const model = build({ rawSeries: [] });

  it('não tem dado', () => {
    expect(model.scope.hasData).toBe(false);
  });

  it('nenhum KPI de negócio se declara apurado', () => {
    // A conformidade é a exceção legítima: o ciclo folha → eSocial → guias
    // existe para toda competência, e "nada foi feito" é uma apuração real
    // sobre o ciclo, não um número inventado sobre a empresa.
    const businessKpis = model.executive.kpis.filter((k) => k.id !== 'compliance');

    for (const kpi of businessKpis) {
      expect(kpi.value.measured, `KPI "${kpi.id}" não deveria estar apurado`).toBe(false);
      expect(kpi.delta.measured, `delta de "${kpi.id}" não deveria estar apurado`).toBe(false);
    }
  });

  it('o risco de folha se declara não apurável', () => {
    expect(model.executive.risk.score.measured).toBe(false);
    if (!model.executive.risk.score.measured) {
      expect(model.executive.risk.score.reason).toBe('not-comparable');
    }
    expect(model.executive.risk.status.measured).toBe(false);
  });

  it('não emite sinal de radar nenhum — inclusive nenhum verde', () => {
    // O radar antigo acendia "Crescimento · alinhado com receita" em verde com
    // folha e receita ambas em zero: os dois passavam nos limiares.
    expect(model.executive.signals).toEqual([]);
  });

  it('eficiência, dinâmica, custo e concentração ficam ausentes', () => {
    expect(model.efficiency.revenuePerEmployee.measured).toBe(false);
    expect(model.efficiency.costPerEmployee.measured).toBe(false);
    expect(model.efficiency.payrollAsRevenuePct.measured).toBe(false);
    expect(model.dynamics.latestTurnoverPct.measured).toBe(false);
    expect(model.dynamics.latestOvertimePct.measured).toBe(false);
    expect(model.dynamics.maxAbsenteeismPct.measured).toBe(false);
    expect(model.costStructure.benefitsTotal.measured).toBe(false);
    expect(model.costStructure.directPct.measured).toBe(false);
    expect(model.concentration.top3.measured).toBe(false);
  });

  it('não semeia o simulador com zero', () => {
    expect(model.simulator.currentRevenue.measured).toBe(false);
    expect(model.simulator.currentPayroll.measured).toBe(false);
    expect(model.simulator.currentHeadcount.measured).toBe(false);
  });

  it('a varredura completa do modelo não encontra indicador apurado', () => {
    // Única exceção declarada, localizada pelo id do KPI e não pela posição no
    // array: o score de conformidade (ver o teste acima). Excluir o ramo
    // `$.compliance` inteiro mascararia justamente os indicadores de SST e de
    // série salarial, que precisam continuar ausentes sem permissão.
    const complianceKpiIndex = model.executive.kpis.findIndex((k) => k.id === 'compliance');
    const allowed = `$.executive.kpis[${complianceKpiIndex}].value`;

    const apurados = collectMeasured(model)
      .filter((m) => m.node.measured)
      .filter((m) => m.path !== allowed);

    expect(apurados.map((m) => m.path)).toEqual([]);
  });

  it('os indicadores de conformidade sem permissão ficam ausentes', () => {
    const { kpis } = model.compliance;
    expect(kpis.catsInMonth.measured).toBe(false);
    expect(kpis.asoExpired.measured).toBe(false);
    expect(kpis.workersWithoutAso.measured).toBe(false);
    expect(kpis.withoutRaise12m.measured).toBe(false);
    if (!kpis.catsInMonth.measured) expect(kpis.catsInMonth.reason).toBe('no-permission');
  });

  it('a frase de abertura diz que não há competência', () => {
    expect(model.executive.headline).toContain('Nenhuma competência apurada');
  });
});

describe('série apurada', () => {
  const model = build();

  it('apura os indicadores que têm fonte', () => {
    expect(model.scope.hasData).toBe(true);
    const byId = new Map(model.executive.kpis.map((k) => [k.id, k]));
    expect(byId.get('headcount')?.value.measured).toBe(true);
    expect(byId.get('payroll')?.value.measured).toBe(true);
    expect(byId.get('payroll-rev')?.value.measured).toBe(true);
  });

  it('não expõe PJ/CLT — o campo não tem fonte em nenhum caminho do código', () => {
    const ids = model.executive.kpis.map((k) => k.id);
    expect(ids).not.toContain('clt-pj');
    expect(ids).not.toContain('pj');
    expect(JSON.stringify(model.executive.kpis)).not.toMatch(/PJ/);
  });

  it('mantém ausente o indicador sem fonte, mesmo com o resto apurado', () => {
    const semRubricas = build({
      rawSeries: series.map((r) => ({
        ...r,
        actuals: actuals({ overtimePct: undefined, composition: undefined, benefitsByType: undefined }),
      })),
    });

    expect(semRubricas.dynamics.latestOvertimePct.measured).toBe(false);
    expect(semRubricas.costStructure.directPct.measured).toBe(false);
    // …enquanto o que tem fonte continua apurado.
    expect(semRubricas.executive.kpis.find((k) => k.id === 'headcount')?.value.measured).toBe(true);
  });

  it('declara ausência de base em "Todo período"', () => {
    expect(model.meta.comparison.label.measured).toBe(false);
    for (const kpi of model.executive.kpis) {
      expect(kpi.delta.measured, `delta de "${kpi.id}"`).toBe(false);
    }
  });

  it('calcula delta quando há base', () => {
    const comMes = build({ period: { key: 'current-month' } });
    expect(comMes.meta.comparison.label.measured).toBe(true);
    const headcount = comMes.executive.kpis.find((k) => k.id === 'headcount');
    expect(headcount?.value.measured).toBe(true);
  });

  it('propaga o recorte para todos os indicadores e declara as degradações', () => {
    const recortado = build({
      filters: { unitIds: ['esocial-OPER'], headcountSource: 'all' },
    });

    expect(recortado.scope.degradations.length).toBeGreaterThan(0);
    // Receita não se reparte por lotação → a razão e o risco caem juntos.
    expect(recortado.efficiency.payrollAsRevenuePct.measured).toBe(false);
    expect(recortado.executive.risk.score.measured).toBe(false);
    // …mas a folha da unidade continua apurada.
    const payroll = recortado.executive.kpis.find((k) => k.id === 'payroll');
    expect(payroll?.value.measured).toBe(true);
    if (payroll?.value.measured) expect(payroll.value.value).toBe(800);
  });

  it('a legenda do recorte nomeia a unidade escolhida', () => {
    const recortado = build({ filters: { unitIds: ['esocial-OPER'], headcountSource: 'all' } });
    expect(recortado.meta.filtersLabel).toContain('Operações');
  });

  it('monta a dimensão de unidades a partir da série completa, não da recortada', () => {
    const recortado = build({ filters: { unitIds: ['esocial-OPER'], headcountSource: 'all' } });
    expect(recortado.scope.allUnits).toHaveLength(2);
    expect(recortado.scope.unitsInScope).toHaveLength(1);
  });
});
