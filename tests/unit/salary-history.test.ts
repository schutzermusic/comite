import { describe, expect, it } from 'vitest';
import {
  buildLevels,
  buildSalaryHistory,
  normalizePayrollName,
  type SalaryHistoryInput,
  type SalaryPoint,
} from '@/lib/workforce/salary-history';

function point(competence: string, grossCents: number): SalaryPoint {
  return {
    competence,
    batchId: `b-${competence}`,
    grossCents,
    netCents: null,
    lineCount: 1,
    costCenterLabel: null,
    contractType: 'clt',
  };
}

/** Monta a entrada a partir de uma série de (competência, bruto) por nome. */
function input(
  series: Record<string, [string, number][]>,
  people: { id: string; full_name: string; payroll_name_key: string | null }[],
  today = '2026-06',
): SalaryHistoryInput {
  const competences = [...new Set(Object.values(series).flat().map(([c]) => c))].sort();
  return {
    batches: competences.map((c) => ({ id: `b-${c}`, competence_month: c })),
    lines: Object.entries(series).flatMap(([name, points]) =>
      points.map(([competence, gross]) => ({
        batch_id: `b-${competence}`,
        employee_name: name,
        cost_center_label: 'Obra Norte',
        contract_type: 'clt',
        gross_amount_cents: gross,
        net_amount_cents: null,
      })),
    ),
    people,
    today,
  };
}

describe('normalizePayrollName', () => {
  it('espelha normalize_person_name() da migration 038', () => {
    // Os mesmos casos que o translate() do SQL cobre.
    expect(normalizePayrollName('  JOSÉ   DA  SILVA ')).toBe('jose da silva');
    expect(normalizePayrollName('Conceição Ñuñez')).toBe('conceicao nunez');
    expect(normalizePayrollName('ÁÀÂÃÄ ÉÈÊË ÍÌÎÏ ÓÒÔÕÖ ÚÙÛÜ Ç')).toBe('aaaaa eeee iiii ooooo uuuu c');
    expect(normalizePayrollName('   ')).toBeNull();
    expect(normalizePayrollName(null)).toBeNull();
  });
});

describe('patamares salariais', () => {
  it('não confunde 13º com reajuste', () => {
    // Doze meses a 5.000, dezembro dobrado pelo 13º, e janeiro de volta a 5.000.
    const series = [
      point('2025-10', 500_000),
      point('2025-11', 500_000),
      point('2025-12', 1_000_000),
      point('2026-01', 500_000),
      point('2026-02', 500_000),
    ];
    const levels = buildLevels(series);

    // UM patamar só. A leitura ingênua veria "aumento de 100%" e depois "corte
    // de 50%" — dois reajustes que nunca aconteceram.
    expect(levels).toHaveLength(1);
    expect(levels[0].grossCents).toBe(500_000);
    expect(levels[0].startCompetence).toBe('2025-10');
    expect(levels[0].endCompetence).toBe('2026-02');
  });

  it('não confunde o 13º pago METADE em novembro e METADE em dezembro', () => {
    // O caso que a regra do "mês isolado" não pega: nov e dez sobem juntos
    // para o mesmo valor, formando uma corrida de comprimento 2.
    const levels = buildLevels([
      point('2025-09', 500_000),
      point('2025-10', 500_000),
      point('2025-11', 750_000), // metade do 13º
      point('2025-12', 750_000), // outra metade
      point('2026-01', 500_000),
      point('2026-02', 500_000),
    ]);

    // UM patamar. Sem a janela de 13º seriam três: 5.000 → 7.500 → 5.000,
    // e o relógio de "meses no patamar" zeraria em janeiro de todo ano.
    expect(levels).toHaveLength(1);
    expect(levels[0].grossCents).toBe(500_000);
    expect(levels[0].startCompetence).toBe('2025-09');
    expect(levels[0].endCompetence).toBe('2026-02');
  });

  it('reajuste em novembro: o patamar novo começa em novembro, não em janeiro', () => {
    const levels = buildLevels([
      point('2025-09', 500_000),
      point('2025-10', 500_000),
      point('2025-11', 840_000), // 5.600 + metade do 13º
      point('2025-12', 840_000),
      point('2026-01', 560_000), // patamar novo se confirma
      point('2026-02', 560_000),
    ]);

    expect(levels).toHaveLength(2);
    expect(levels[0].grossCents).toBe(500_000);
    expect(levels[1].grossCents).toBe(560_000);
    // A janela de nov/dez pertence ao patamar NOVO: a data do reajuste é
    // novembro, que foi quando ele aconteceu.
    expect(levels[1].startCompetence).toBe('2025-11');
  });

  it('13º integral só em dezembro continua sendo absorvido', () => {
    const levels = buildLevels([
      point('2025-10', 500_000),
      point('2025-11', 500_000),
      point('2025-12', 1_000_000),
      point('2026-01', 500_000),
      point('2026-02', 500_000),
    ]);
    expect(levels).toHaveLength(1);
    expect(levels[0].grossCents).toBe(500_000);
  });

  it('não trata como 13º uma corrida de dois meses fora de nov/dez', () => {
    // Junho e julho no mesmo valor novo é reajuste, não sazonalidade.
    const levels = buildLevels([
      point('2026-04', 500_000),
      point('2026-05', 500_000),
      point('2026-06', 550_000),
      point('2026-07', 550_000),
    ]);
    expect(levels).toHaveLength(2);
    expect(levels[1].startCompetence).toBe('2026-06');
  });

  it('reconhece um reajuste de verdade — dois meses no valor novo', () => {
    const levels = buildLevels([
      point('2025-10', 500_000),
      point('2025-11', 500_000),
      point('2025-12', 550_000),
      point('2026-01', 550_000),
    ]);
    expect(levels).toHaveLength(2);
    expect(levels[0].grossCents).toBe(500_000);
    expect(levels[1].grossCents).toBe(550_000);
    expect(levels[1].startCompetence).toBe('2025-12');
    expect(levels[1].truncatedStart).toBe(false);
  });
});

describe('buildSalaryHistory', () => {
  const pessoas = [{ id: 'p1', full_name: 'José da Silva', payroll_name_key: 'jose da silva' }];

  it('classifica como "stale" quem está há 12 meses ou mais no mesmo patamar', () => {
    const competencias: [string, number][] = [];
    for (let m = 1; m <= 6; m += 1) competencias.push([`2025-${String(m).padStart(2, '0')}`, 500_000]);
    for (let m = 7; m <= 12; m += 1) competencias.push([`2025-${String(m).padStart(2, '0')}`, 600_000]);
    for (let m = 1; m <= 6; m += 1) competencias.push([`2026-${String(m).padStart(2, '0')}`, 600_000]);

    const result = buildSalaryHistory(input({ 'JOSE DA SILVA': competencias }, pessoas, '2026-07'));
    const jose = result.people[0];

    expect(jose.lastRaiseCompetence).toBe('2025-07');
    expect(jose.monthsSinceLastRaise).toBe(12);
    expect(jose.monthsIsLowerBound).toBe(false);
    expect(jose.lastRaisePercent).toBeCloseTo(20, 5);
    expect(jose.raiseStatus).toBe('stale');
    expect(result.counts.withoutRaise12m).toBe(1);
  });

  it('trata série curta como "não determinado" — nunca como "reajustado"', () => {
    // Quatro meses no mesmo valor, sem reajuste observado. O patamar pode ter
    // começado bem antes da janela; afirmar "reajustado recentemente" seria
    // inventar um aumento.
    const result = buildSalaryHistory(
      input(
        {
          'JOSE DA SILVA': [
            ['2026-03', 500_000],
            ['2026-04', 500_000],
            ['2026-05', 500_000],
            ['2026-06', 500_000],
          ],
        },
        pessoas,
        '2026-06',
      ),
    );

    const jose = result.people[0];
    expect(jose.monthsIsLowerBound).toBe(true);
    expect(jose.monthsSinceLastRaise).toBe(3);
    expect(jose.raiseStatus).toBe('indeterminate');
    expect(jose.lastRaiseCompetence).toBeNull();
    expect(result.counts.raisedWithin12m).toBe(0);
    expect(result.counts.indeterminate).toBe(1);
    // E a tela é avisada do porquê.
    expect(result.notes.join(' ')).toMatch(/menos de doze meses/i);
  });

  it('um piso de 12 meses já prova doze meses, mesmo truncado', () => {
    const competencias: [string, number][] = [];
    for (let m = 1; m <= 12; m += 1) competencias.push([`2025-${String(m).padStart(2, '0')}`, 500_000]);
    for (let m = 1; m <= 6; m += 1) competencias.push([`2026-${String(m).padStart(2, '0')}`, 500_000]);

    const result = buildSalaryHistory(input({ 'JOSE DA SILVA': competencias }, pessoas, '2026-07'));
    const jose = result.people[0];
    expect(jose.monthsIsLowerBound).toBe(true);
    expect(jose.monthsSinceLastRaise).toBe(18);
    expect(jose.raiseStatus).toBe('stale');
  });

  it('declara o nome sem pessoa em vez de descartá-lo', () => {
    const result = buildSalaryHistory(
      input(
        {
          'JOSE DA SILVA': [['2026-05', 500_000], ['2026-06', 500_000]],
          'MARIA APARECIDA': [['2026-05', 400_000], ['2026-06', 400_000]],
        },
        pessoas,
        '2026-06',
      ),
    );

    expect(result.counts.peopleMatched).toBe(1);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].employeeName).toBe('MARIA APARECIDA');
    expect(result.unmatched[0].competences).toEqual(['2026-05', '2026-06']);
    expect(result.notes.join(' ')).toMatch(/não têm pessoa correspondente/i);
  });

  it('soma linhas do mesmo nome no lote e sinaliza que somou', () => {
    const result = buildSalaryHistory({
      batches: [{ id: 'b1', competence_month: '2026-06' }],
      lines: [
        { batch_id: 'b1', employee_name: 'José da Silva', cost_center_label: 'Obra A', contract_type: 'clt', gross_amount_cents: 300_000, net_amount_cents: 250_000 },
        { batch_id: 'b1', employee_name: 'JOSE DA SILVA', cost_center_label: 'Obra B', contract_type: 'clt', gross_amount_cents: 200_000, net_amount_cents: 170_000 },
      ],
      people: pessoas,
      today: '2026-06',
    });

    const [ponto] = result.people[0].series;
    expect(ponto.grossCents).toBe(500_000);
    expect(ponto.lineCount).toBe(2);
  });

  it('não inventa reajuste quando o salário CAI', () => {
    const result = buildSalaryHistory(
      input(
        {
          'JOSE DA SILVA': [
            ['2026-01', 600_000],
            ['2026-02', 600_000],
            ['2026-03', 500_000],
            ['2026-04', 500_000],
          ],
        },
        pessoas,
        '2026-04',
      ),
    );
    // O patamar mudou, então há marco; mas o percentual sai negativo e a tela
    // pode dizer "redução" em vez de chamar aquilo de reajuste.
    expect(result.people[0].lastRaisePercent).toBeCloseTo(-16.6667, 3);
  });
});
