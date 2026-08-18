/**
 * Recorte e comparação do cockpit de Pessoas & Custos.
 *
 * O que estes testes travam não é o formato do filtro: é a honestidade dele.
 * Um recorte que soma menos e cala o que deixou de saber produz um número
 * plausível e errado — o modo de falha mais caro deste módulo, porque não
 * parece falha.
 */
import { describe, expect, it } from 'vitest';
import {
  applyWorkforceFilters,
  HEADCOUNT_SOURCE_LABEL,
} from '@/lib/workforce/overview/filters';
import {
  buildWorkforceUnits,
  describeUnitSelection,
} from '@/lib/workforce/overview/units';
import {
  comparisonModeAvailable,
  resolveComparisonSelection,
} from '@/lib/workforce/overview/comparison';
import { EMPTY_WORKFORCE_FILTERS } from '@/lib/workforce/overview/types';
import type { WorkforceActuals, WorkforceMonthlyRecord } from '@/lib/workforce/period';

function areas(): WorkforceActuals['areas'] {
  return [
    { code: 'OPER', label: 'Operações', headcount: 8, admissions: 2, terminations: 1, absenceDays: 6, payroll: 80 },
    { code: 'ADM', label: 'Administrativo', headcount: 4, admissions: 1, terminations: 0, absenceDays: 2, payroll: 40 },
  ];
}

function actuals(overrides: Partial<WorkforceActuals> = {}): WorkforceActuals {
  return {
    admissions: 3,
    terminations: 1,
    absenceDays: 8,
    absenceEvents: 5,
    overtimePct: 9.4,
    headcountSource: 'esocial',
    composition: { salary: 90, benefits: 15, charges: 25 },
    benefitsByType: { va: 8, vr: 3, health: 2, dental: 1, transport: 1, other: 0 },
    areas: areas(),
    ...overrides,
  };
}

/** Série vinda do eSocial: centros de custo sintetizados a partir das lotações. */
const esocialSeries: WorkforceMonthlyRecord[] = ['2026-03', '2026-04'].map((competenceMonth) => ({
  competenceMonth,
  headcount: 12,
  payroll: 120,
  revenue: 400,
  pj: 0,
  clt: 12,
  pjCost: 0,
  cltCost: 120,
  costCenters: [
    { id: 'esocial-OPER', name: 'Operações', payrollValue: 80, headcount: 8 },
    { id: 'esocial-ADM', name: 'Administrativo', payrollValue: 40, headcount: 4 },
  ],
  actuals: actuals(),
}));

/** Série vinda do lote de folha: centro de custo com valor, sem quadro. */
const batchSeries: WorkforceMonthlyRecord[] = ['2026-03', '2026-04'].map((competenceMonth) => ({
  competenceMonth,
  headcount: 12,
  payroll: 120,
  revenue: 400,
  pj: 0,
  clt: 12,
  pjCost: 0,
  cltCost: 120,
  costCenters: [
    { id: 'cc-obra', name: 'Obra Norte', payrollValue: 70, headcount: 0 },
    { id: 'cc-sede', name: 'Sede', payrollValue: 50, headcount: 0 },
  ],
}));

describe('recorte da série', () => {
  it('sem filtro devolve a mesma série por referência', () => {
    const result = applyWorkforceFilters(esocialSeries, EMPTY_WORKFORCE_FILTERS);
    expect(result.series).toBe(esocialSeries);
    expect(result.degradations).toEqual([]);
  });

  it('soma apenas as unidades selecionadas', () => {
    const { series } = applyWorkforceFilters(esocialSeries, {
      unitIds: ['esocial-OPER'],
      headcountSource: 'all',
    });

    expect(series).toHaveLength(2);
    expect(series[0].payroll).toBe(80);
    expect(series[0].headcount).toBe(8);
    expect(series[0].costCenters.map((c) => c.id)).toEqual(['esocial-OPER']);
  });

  it('recalcula movimentação a partir das áreas escolhidas, sem herdar o total', () => {
    const { series } = applyWorkforceFilters(esocialSeries, {
      unitIds: ['esocial-ADM'],
      headcountSource: 'all',
    });

    // O total da competência era 3 admissões / 1 desligamento; o ADM tem 1 / 0.
    expect(series[0].actuals?.admissions).toBe(1);
    expect(series[0].actuals?.terminations).toBe(0);
    expect(series[0].actuals?.absenceDays).toBe(2);
  });

  it('zera a receita e declara a degradação', () => {
    const { series, degradations } = applyWorkforceFilters(esocialSeries, {
      unitIds: ['esocial-OPER'],
      headcountSource: 'all',
    });

    expect(series[0].revenue).toBe(0);
    expect(degradations.map((d) => d.field)).toContain('revenue');
    expect(degradations.every((d) => d.reason === 'not-attributable')).toBe(true);
  });

  it('torna ausentes — nunca zero — os campos que não se repartem', () => {
    const { series, degradations } = applyWorkforceFilters(esocialSeries, {
      unitIds: ['esocial-OPER'],
      headcountSource: 'all',
    });

    // Ausente faz o seletor descartar o ponto; zero desenharia uma queda.
    expect(series[0].actuals?.overtimePct).toBeUndefined();
    expect(series[0].actuals?.composition).toBeUndefined();
    expect(series[0].actuals?.benefitsByType).toBeUndefined();

    const fields = degradations.map((d) => d.field);
    expect(fields).toContain('overtime');
    expect(fields).toContain('composition');
    expect(fields).toContain('benefits');
    expect(fields).toContain('absenceEvents');
  });

  it('declara a perda de quadro quando o centro vem do lote de folha', () => {
    const { series, degradations } = applyWorkforceFilters(batchSeries, {
      unitIds: ['cc-obra'],
      headcountSource: 'all',
    });

    expect(series[0].payroll).toBe(70);
    expect(series[0].headcount).toBe(0);
    expect(degradations.map((d) => d.field)).toContain('headcount');
  });

  it('descarta a competência que ficou fora do recorte em vez de zerá-la', () => {
    const mixed: WorkforceMonthlyRecord[] = [
      { ...batchSeries[0], competenceMonth: '2026-01', costCenters: [{ id: 'cc-outro', name: 'Outro', payrollValue: 10, headcount: 0 }] },
      ...batchSeries,
    ];

    const { series } = applyWorkforceFilters(mixed, {
      unitIds: ['cc-obra'],
      headcountSource: 'all',
    });

    expect(series.map((r) => r.competenceMonth)).toEqual(['2026-03', '2026-04']);
  });

  it('filtra por fonte do quadro e ignora competência que não declarou origem', () => {
    const mixed: WorkforceMonthlyRecord[] = [
      { ...esocialSeries[0], actuals: actuals({ headcountSource: 'manual' }) },
      esocialSeries[1],
      batchSeries[0], // sem `actuals` — não declarou origem
    ];

    const manual = applyWorkforceFilters(mixed, { unitIds: [], headcountSource: 'manual' });
    expect(manual.series).toHaveLength(1);
    expect(manual.series[0].actuals?.headcountSource).toBe('manual');

    const esocial = applyWorkforceFilters(mixed, { unitIds: [], headcountSource: 'esocial' });
    expect(esocial.series).toHaveLength(1);
  });

  it('tem legenda para cada fonte de quadro', () => {
    expect(Object.keys(HEADCOUNT_SOURCE_LABEL).sort()).toEqual(['all', 'esocial', 'manual']);
  });
});

describe('dimensão unificada de lotação e centro de custo', () => {
  it('colapsa lotação e centro sintetizado numa entrada só', () => {
    const units = buildWorkforceUnits(esocialSeries);
    expect(units.map((u) => u.id).sort()).toEqual(['esocial-ADM', 'esocial-OPER']);
  });

  it('ordena por folha acumulada', () => {
    const units = buildWorkforceUnits(esocialSeries);
    expect(units[0].id).toBe('esocial-OPER');
    expect(units[0].totalPayroll).toBe(160);
  });

  it('declara o que a unidade sabe responder', () => {
    const [oper] = buildWorkforceUnits(esocialSeries);
    expect(oper.origin).toBe('esocial-lotacao');
    expect(oper.carries).toEqual({ payroll: true, headcount: true, movement: true, absence: true });

    const [obra] = buildWorkforceUnits(batchSeries);
    expect(obra.origin).toBe('payroll-batch');
    expect(obra.carries.payroll).toBe(true);
    expect(obra.carries.headcount).toBe(false);
    expect(obra.carries.movement).toBe(false);
  });

  it('resume a seleção para a legenda do recorte', () => {
    const units = buildWorkforceUnits(esocialSeries);
    expect(describeUnitSelection(units, [])).toBe('Todas as lotações');
    expect(describeUnitSelection(units, ['esocial-OPER'])).toBe('Operações');
    expect(describeUnitSelection(units, ['esocial-OPER', 'esocial-ADM'])).toContain('·');
  });

  it('devolve vazio para série vazia', () => {
    expect(buildWorkforceUnits([])).toEqual([]);
  });
});

describe('linha de base da comparação', () => {
  const anual: WorkforceMonthlyRecord[] = [
    '2025-01', '2025-02', '2025-03', '2025-04',
    '2026-01', '2026-02', '2026-03', '2026-04',
  ].map((competenceMonth) => ({
    competenceMonth,
    headcount: 10,
    payroll: 100,
    revenue: 400,
    pj: 0,
    clt: 10,
    pjCost: 0,
    cltCost: 100,
    costCenters: [],
  }));

  it('resolve o período anterior como seleção sintética', () => {
    const result = resolveComparisonSelection({ key: 'current-month' }, anual, 'previous-period');
    expect(result.selection.measured).toBe(true);
    if (result.selection.measured) {
      expect(result.selection.value).toEqual({
        key: 'custom',
        customStart: '2026-03',
        customEnd: '2026-03',
      });
    }
    expect(result.label.measured && result.label.value).toBe('vs mês anterior');
  });

  it('resolve o mesmo período do ano anterior', () => {
    const result = resolveComparisonSelection({ key: 'current-month' }, anual, 'same-period-last-year');
    expect(result.selection.measured).toBe(true);
    if (result.selection.measured) {
      expect(result.selection.value.customStart).toBe('2025-04');
    }
    expect(result.label.measured && result.label.value).toBe('vs mesmo período de 2025');
  });

  it('nomeia a base parcial em vez de completar com zero', () => {
    // 2026 tem Jan–Abr; 2025 também. Recortando 2025 para dois meses, a base
    // do ano anterior cobre metade do período.
    const parcial = anual.filter((r) => !['2025-01', '2025-02'].includes(r.competenceMonth));
    const result = resolveComparisonSelection({ key: 'current-year' }, parcial, 'same-period-last-year');

    expect(result.selection.measured).toBe(true);
    expect(result.windowLabel.measured && result.windowLabel.value).toContain('2 de 4 meses apurados');
  });

  it('declara ausência de base em "Todo período"', () => {
    const result = resolveComparisonSelection({ key: 'all' }, anual, 'previous-period');
    expect(result.selection.measured).toBe(false);
    if (!result.selection.measured) expect(result.selection.reason).toBe('no-baseline');
  });

  it('declara ausência de base quando o ano anterior não existe na série', () => {
    const curta = anual.filter((r) => r.competenceMonth.startsWith('2026'));
    const result = resolveComparisonSelection({ key: 'current-month' }, curta, 'same-period-last-year');
    expect(result.selection.measured).toBe(false);
  });

  it('modo "sem comparação" nunca produz base', () => {
    const result = resolveComparisonSelection({ key: 'current-month' }, anual, 'none');
    expect(result.selection.measured).toBe(false);
  });

  it('série vazia não produz base em nenhum modo', () => {
    expect(resolveComparisonSelection({ key: 'current-month' }, [], 'previous-period').selection.measured).toBe(false);
    expect(resolveComparisonSelection({ key: 'current-month' }, [], 'same-period-last-year').selection.measured).toBe(false);
  });

  it('informa ao seletor quais modos têm base', () => {
    expect(comparisonModeAvailable({ key: 'all' }, anual, 'previous-period')).toBe(false);
    expect(comparisonModeAvailable({ key: 'current-month' }, anual, 'previous-period')).toBe(true);
    expect(comparisonModeAvailable({ key: 'all' }, anual, 'none')).toBe(true);
  });
});
