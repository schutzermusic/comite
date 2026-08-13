/**
 * Quadro informado manualmente.
 *
 * Dois contratos são travados aqui:
 *  • a validação recusa lançamento sem origem — é o que separa um número
 *    assinado de um palpite;
 *  • o valor manual vence o apurado na série E fica marcado como manual, para
 *    que a interface nunca o apresente como apuração.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  validateManualHeadcount,
  ManualHeadcountValidationError,
} from '@/lib/workforce/manual-headcount';
import { enrichSeriesWithEsocial, type WorkforceMonthlyRecord } from '@/lib/workforce/period';

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
});

describe('validateManualHeadcount', () => {
  const valido = { competence: '2025-03', headcount: 248, sourceNote: 'folha analítica Domínio' };

  it('aceita um lançamento completo', () => {
    expect(validateManualHeadcount(valido)).toEqual({
      competence: '2025-03',
      headcount: 248,
      sourceNote: 'folha analítica Domínio',
    });
  });

  it('exige a origem do número', () => {
    // Sem origem, o número vira folclore em poucos meses.
    expect(() => validateManualHeadcount({ ...valido, sourceNote: '' })).toThrow(
      ManualHeadcountValidationError,
    );
    expect(() => validateManualHeadcount({ ...valido, sourceNote: '  x ' })).toThrow(
      ManualHeadcountValidationError,
    );
  });

  it('recusa competência fora do formato mensal', () => {
    expect(() => validateManualHeadcount({ ...valido, competence: '2025' })).toThrow();
    expect(() => validateManualHeadcount({ ...valido, competence: '2025-13' })).toThrow();
    expect(() => validateManualHeadcount({ ...valido, competence: '2025-00' })).toThrow();
  });

  it('recusa quantidade não inteira, negativa ou absurda', () => {
    expect(() => validateManualHeadcount({ ...valido, headcount: 12.5 })).toThrow();
    expect(() => validateManualHeadcount({ ...valido, headcount: -1 })).toThrow();
    expect(() => validateManualHeadcount({ ...valido, headcount: 9_000_000 })).toThrow();
  });

  it('aceita zero — competência sem colaborador é um fato possível', () => {
    expect(validateManualHeadcount({ ...valido, headcount: 0 }).headcount).toBe(0);
  });
});

describe('aplicação do quadro manual na série', () => {
  const serie: WorkforceMonthlyRecord[] = [];
  const metricas = [
    // Caso real de 2025: guias completas, mas só um trabalhador no detalhe.
    {
      competence: '2025-03',
      gross_payroll_cents: 0,
      overtime_cents: 0,
      headcount: 1,
      admissions: 0,
      terminations: 0,
      absence_days: 0,
      absence_events: 0,
      cp_base_cents: 83_820_403,
    },
    // Competência sadia: o apurado não deve ser tocado sem lançamento.
    {
      competence: '2026-06',
      gross_payroll_cents: 0,
      overtime_cents: 0,
      headcount: 236,
      admissions: 0,
      terminations: 12,
      absence_days: 561,
      absence_events: 20,
      cp_base_cents: 156_991_912,
    },
  ];

  it('substitui o quadro apurado e marca a competência como manual', () => {
    const out = enrichSeriesWithEsocial(serie, metricas, [], {
      '2025-03': { headcount: 248, sourceNote: 'folha analítica Domínio' },
    });

    const marco = out.find((r) => r.competenceMonth === '2025-03')!;
    expect(marco.headcount).toBe(248);
    expect(marco.actuals?.headcountSource).toBe('manual');
    expect(marco.actuals?.headcountNote).toBe('folha analítica Domínio');

    // Custo médio deixa de ser R$ 838.204 por pessoa e vira R$ 3.379,85.
    expect(marco.payroll / marco.headcount).toBeCloseTo(3379.85, 2);
  });

  it('não toca competência sem lançamento', () => {
    const out = enrichSeriesWithEsocial(serie, metricas, [], {
      '2025-03': { headcount: 248, sourceNote: 'folha analítica Domínio' },
    });

    const junho = out.find((r) => r.competenceMonth === '2026-06')!;
    expect(junho.headcount).toBe(236);
    expect(junho.actuals?.headcountSource).toBe('esocial');
    expect(junho.actuals?.headcountNote).toBeUndefined();
  });

  it('sem nenhum ajuste, a série é exatamente a apurada', () => {
    const semAjuste = enrichSeriesWithEsocial(serie, metricas, []);
    expect(semAjuste.map((r) => r.headcount)).toEqual([1, 236]);
    expect(semAjuste.every((r) => r.actuals?.headcountSource === 'esocial')).toBe(true);
  });
});
