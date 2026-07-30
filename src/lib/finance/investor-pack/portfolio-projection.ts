import type {
  InvestorClientForecast,
  InvestorPack,
  InvestorPackMonth,
  InvestorPortfolioClient,
} from './types';

export const PORTFOLIO_PROJECTION_VERSION = 'carteira-eventogramas-v12-folha-com-encargos';
export const MANAGEMENT_PROJECTION_START = '2026-10';
export const MANAGEMENT_PROJECTION_END = '2028-12';

const BRL = 100;
const money = (value: number) => Math.round(value * BRL);

export const PAYROLL_ACTUALS_WITH_CHARGES_CENTS: Record<string, number> = {
  '2025-01': money(1331022.91),
  '2025-02': money(1310101.05),
  '2025-03': money(1354501.90),
  '2025-04': money(1531002.29),
  '2025-05': money(1761893.50),
  '2025-06': money(1523207.92),
  '2025-07': money(1574251.96),
  '2025-08': money(1597750.18),
  '2025-09': money(1644127.33),
  '2025-10': money(1728097.81),
  '2025-11': money(1877160.31),
  '2025-12': money(1964681.62),
  '2026-01': money(3208000),
  '2026-02': money(3389000),
  '2026-03': money(3266000),
  '2026-04': money(3360000),
  '2026-05': money(2953000),
  '2026-06': money(3108000),
};

type PortfolioSeed = Omit<InvestorPortfolioClient, 'projectedThrough2028Cents' | 'remainingAfter2028Cents'>;

const PORTFOLIO: PortfolioSeed[] = [
  { id: 'axia', client: 'AXIA Energia', status: 'Ativo', contractsCount: 4, portfolioCents: money(42544856.72), billedCents: money(13587630.96), backlogCents: money(28957225.76), receivableCents: money(16901328.68), blockedCents: 0, pipeline90Cents: money(5611146.21335), maturationCents: 0 },
  { id: 'petrobras', client: 'Petrobras', status: 'Ativo', contractsCount: 2, portfolioCents: money(126739271.47), billedCents: money(1506178.20), backlogCents: money(125233093.27), receivableCents: money(2752843.23), blockedCents: 0, pipeline90Cents: money(5832120), maturationCents: 0 },
  { id: 'enel', client: 'Enel Green Power', status: 'Ativo', contractsCount: 4, portfolioCents: money(74695374.05), billedCents: money(46633200.10), backlogCents: money(28062173.95), receivableCents: money(25512835.0215), blockedCents: money(1606467.954), pipeline90Cents: money(5394112.24), maturationCents: money(1606467.954) },
  { id: 'cemig', client: 'CEMIG', status: 'Ativo', contractsCount: 2, portfolioCents: money(157646971.08), billedCents: money(15287450.14), backlogCents: money(142359520.94), receivableCents: money(15391505.90), blockedCents: 0, pipeline90Cents: money(104055.76), maturationCents: 0 },
  { id: 'ambar', client: 'Âmbar', status: 'Ativo', contractsCount: 1, portfolioCents: money(883317.21), billedCents: money(794985.49), backlogCents: money(88331.72), receivableCents: money(883317.20), blockedCents: money(88331.72), pipeline90Cents: 0, maturationCents: money(88331.72) },
  { id: 'hydro', client: 'Hydro Alunorte', status: 'Ativo', contractsCount: 1, portfolioCents: money(4965143.38), billedCents: money(828439.34), backlogCents: money(4136704.04), receivableCents: money(872409.82), blockedCents: 0, pipeline90Cents: 0, maturationCents: 0 },
  { id: 'belem', client: 'Belém Bioenergia', status: 'Ativo', contractsCount: 1, portfolioCents: money(1445844.71), billedCents: money(279135.36), backlogCents: money(1166709.35), receivableCents: money(1445844.71), blockedCents: 0, pipeline90Cents: 0, maturationCents: 0 },
  { id: 'flessak', client: 'Flessak', status: 'Ativo', contractsCount: 1, portfolioCents: money(803178.97), billedCents: money(80317.90), backlogCents: money(722861.07), receivableCents: money(803178.96), blockedCents: 0, pipeline90Cents: money(160635.79), maturationCents: 0 },
  { id: 'harbin', client: 'Harbin', status: 'Ativo', contractsCount: 1, portfolioCents: money(80000), billedCents: 0, backlogCents: money(80000), receivableCents: money(80000), blockedCents: 0, pipeline90Cents: money(80000), maturationCents: 0 },
  { id: 'arcelor', client: 'ArcelorMittal', status: 'Ativo', contractsCount: 1, portfolioCents: money(261601.20), billedCents: 0, backlogCents: money(261601.20), receivableCents: money(261601.20), blockedCents: 0, pipeline90Cents: money(261601.20), maturationCents: 0 },
  { id: 'andritz', client: 'Andritz', status: 'Ativo', contractsCount: 1, portfolioCents: money(80000), billedCents: 0, backlogCents: money(80000), receivableCents: money(80000), blockedCents: 0, pipeline90Cents: money(80000), maturationCents: 0 },
];

/** Backlog ainda disponível depois dos eventos explícitos da planilha. */
const ALLOCATION_POOLS: Record<string, number> = {
  cemig: money(142255465.18),
  petrobras: money(118474837.44),
  axia: money(19464145.85),
  hydro: money(4136704.04),
  belem: money(209351.52),
};

const EARLY_EVENTS: InvestorClientForecast[] = [
  { period: '2026-07', clientId: 'axia', client: 'AXIA Energia', amountCents: money(1039546.41), source: 'eventogram', note: 'Medições previstas no eventograma.' },
  { period: '2026-07', clientId: 'petrobras', client: 'Petrobras', amountCents: money(1775493.63), source: 'eventogram', note: 'BM e medições previstas.' },
  { period: '2026-07', clientId: 'enel', client: 'Enel Green Power', amountCents: money(1464636.93), source: 'eventogram', note: 'Medição prevista.' },
  { period: '2026-07', clientId: 'belem', client: 'Belém Bioenergia', amountCents: money(488486.88), source: 'eventogram', note: 'Medição prevista.' },
  { period: '2026-07', clientId: 'flessak', client: 'Flessak', amountCents: money(160635.79), source: 'eventogram', note: 'Parcela contratual.' },
  { period: '2026-07', clientId: 'belem', client: 'Belém Bioenergia', amountCents: money(50167.91), source: 'eventogram', note: 'Rebabitagem do mancal LOA e comissionamento.' },
  { period: '2026-08', clientId: 'axia', client: 'AXIA Energia', amountCents: money(4473092.98), source: 'eventogram', note: 'Medições previstas no eventograma.' },
  { period: '2026-08', clientId: 'petrobras', client: 'Petrobras', amountCents: money(905832.12), source: 'eventogram', note: 'BM e medições previstas.' },
  { period: '2026-08', clientId: 'enel', client: 'Enel Green Power', amountCents: money(5394112.24), source: 'eventogram', note: 'Medições previstas nos contratos JA10189705 e 4502694526.' },
  { period: '2026-08', clientId: 'cemig', client: 'CEMIG', amountCents: money(104055.76), source: 'eventogram', note: 'Itutinga; contrato principal inicia em outubro.' },
  { period: '2026-08', clientId: 'flessak', client: 'Flessak', amountCents: money(160635.79), source: 'eventogram', note: 'Parcela contratual.' },
  { period: '2026-08', clientId: 'harbin', client: 'Harbin', amountCents: money(80000), source: 'eventogram', note: 'Ensaios elétricos finais de montagem.' },
  { period: '2026-08', clientId: 'arcelor', client: 'ArcelorMittal', amountCents: money(261601.20), source: 'eventogram', note: 'Reparo em reator.' },
  { period: '2026-08', clientId: 'andritz', client: 'Andritz', amountCents: money(80000), source: 'eventogram', note: 'Locação de equipamento com operador.' },
  { period: '2026-09', clientId: 'axia', client: 'AXIA Energia', amountCents: money(3980440.52), source: 'eventogram', note: 'Medições previstas no eventograma.' },
  { period: '2026-09', clientId: 'belem', client: 'Belém Bioenergia', amountCents: money(209351.52), source: 'eventogram', note: 'Medição prevista.' },
  { period: '2026-09', clientId: 'flessak', client: 'Flessak', amountCents: money(160635.79), source: 'eventogram', note: 'Parcela contratual.' },
  { period: '2026-10', clientId: 'belem', client: 'Belém Bioenergia', amountCents: money(209351.52), source: 'eventogram', note: 'Instalação, testes e aceite final.' },
  { period: '2026-10', clientId: 'flessak', client: 'Flessak', amountCents: money(160635.79), source: 'eventogram', note: 'Parcela a 90 dias do evento 02.' },
  { period: '2026-11', clientId: 'ambar', client: 'Âmbar', amountCents: money(397492.74), source: 'eventogram', note: 'Eventos informados na planilha de recebíveis.' },
  { period: '2026-11', clientId: 'flessak', client: 'Flessak', amountCents: money(80317.90), source: 'eventogram', note: 'Parcela a 120 dias do evento 02.' },
  { period: '2026-12', clientId: 'petrobras', client: 'Petrobras', amountCents: money(4076930.08), source: 'eventogram', note: 'BM 005 — UTE TMA / reenrolamento do estator.' },
  { period: '2026-12', clientId: 'enel', client: 'Enel Green Power', amountCents: money(5887200), source: 'eventogram', note: 'Reparo, rebobinagem e montagem previstos.' },
  { period: '2026-12', clientId: 'ambar', client: 'Âmbar', amountCents: money(88331.72), source: 'eventogram', note: 'Transporte dos equipamentos para fábrica.' },
  { period: '2027-01', clientId: 'enel', client: 'Enel Green Power', amountCents: money(1248800), source: 'eventogram', note: 'Montagem final, comissionamento e databook.' },
];

/**
 * Base recorrente observada da ENEL, adicional aos eventos já informados no Excel.
 * A curva varia mensalmente e o total permanece limitado ao backlog disponível.
 */
const ENEL_RECURRING_EVENTS: InvestorClientForecast[] = [
  ['2026-09', 1267382.41],
  ['2026-10', 1346745.67],
  ['2026-11', 1223777.92],
  ['2027-02', 1284376.41],
  ['2027-03', 1337845.67],
  ['2027-04', 1218912.33],
  ['2027-05', 1306430.52],
  ['2027-06', 1242875.19],
  ['2027-07', 1295608.84],
  ['2027-08', 1228944.16],
  ['2027-09', 1314525.66],
].map(([period, amount]) => ({
    period: String(period),
    clientId: 'enel',
    client: 'Enel Green Power',
    amountCents: money(Number(amount)),
    source: 'backlog_allocation' as const,
    note: 'Saldo ENEL variável; parcelas finais de 2027 antecipadas para setembro–novembro/2026.',
  }));

function periodsBetween(start: string, end: string): string[] {
  const periods: string[] = [];
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth);) {
    periods.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return periods;
}

const SEASONAL_MONTHLY_TARGETS: Record<string, number> = {
  '2027-01': 12200000,
  '2027-02': 11800000,
  '2027-03': 11200000,
  '2027-04': 10500000,
  '2027-05': 10100000,
  '2027-06': 9500000,
  '2027-07': 9200000,
  '2027-08': 9600000,
  '2027-09': 10500000,
  '2027-10': 11500000,
  '2027-11': 12800000,
  '2027-12': 14050000,
  '2028-01': 13750000,
  '2028-02': 13000000,
  '2028-03': 12300000,
  '2028-04': 11500000,
  '2028-05': 10800000,
  '2028-06': 9800000,
  '2028-07': 9500000,
  '2028-08': 10000000,
  '2028-09': 11300000,
  '2028-10': 12600000,
  '2028-11': 14200000,
  '2028-12': 15000000,
};

function variableMonthlyTargets(periods: string[]): number[] {
  const wave = [0, 650000, 100000, 800000, 200000, 900000];
  return periods.map((period, index) =>
    money(SEASONAL_MONTHLY_TARGETS[period] ?? (10000000 + index * 75000 + wave[index % wave.length])),
  );
}

function eventogramTotal(period: string): number {
  return EARLY_EVENTS
    .filter((event) => event.period === period)
    .reduce((sum, event) => sum + event.amountCents, 0);
}

function committedTotal(period: string): number {
  return eventogramTotal(period) + ENEL_RECURRING_EVENTS
    .filter((event) => event.period === period)
    .reduce((sum, event) => sum + event.amountCents, 0);
}

function allocateVariableMatrix(periods: string[], rowTargets: number[], columnTargets: Record<string, number>): number[][] {
  const clientIds = Object.keys(columnTargets);
  const deadlines: Record<string, string> = {
    belem: '2026-11',
    enel: '2027-01',
    hydro: '2028-07',
    axia: '2028-12',
    cemig: '2028-12',
    petrobras: '2028-12',
  };
  const waves: Record<string, number[]> = {
    cemig: [0.75, 1.15, 0.88, 1.28, 0.94, 1.34],
    petrobras: [1.25, 0.82, 1.18, 0.76, 1.22, 0.91],
    axia: [0.92, 1.24, 0.78, 1.12, 0.86, 1.18],
    enel: [1.3, 0.85, 1.2, 0.95, 1.1, 0.8],
    hydro: [0.72, 1.18, 0.9, 1.26, 0.82, 1.1],
    belem: [1.2, 0.8],
  };
  const matrix = periods.map((period, rowIndex) => clientIds.map((clientId, clientIndex) => {
    if (period > deadlines[clientId]) return 0;
    const wave = waves[clientId][rowIndex % waves[clientId].length];
    const ramp = clientId === 'cemig' ? 0.72 + rowIndex * 0.032 : clientId === 'petrobras' ? 1.08 - rowIndex * 0.004 : 1;
    return Math.max(0.0001, wave * ramp * (1 + clientIndex * 0.004));
  }));

  for (let iteration = 0; iteration < 600; iteration += 1) {
    matrix.forEach((row, rowIndex) => {
      const sum = row.reduce((total, value) => total + value, 0);
      const factor = sum ? rowTargets[rowIndex] / sum : 0;
      row.forEach((value, clientIndex) => { row[clientIndex] = value * factor; });
    });
    clientIds.forEach((clientId, clientIndex) => {
      const sum = matrix.reduce((total, row) => total + row[clientIndex], 0);
      const factor = sum ? columnTargets[clientId] / sum : 0;
      matrix.forEach((row) => { row[clientIndex] *= factor; });
    });
  }

  const rounded = matrix.map((row) => row.map(Math.floor));
  const rowDeficits = rowTargets.map((target, rowIndex) => target - rounded[rowIndex].reduce((sum, value) => sum + value, 0));
  const colDeficits = clientIds.map((clientId, clientIndex) =>
    columnTargets[clientId] - rounded.reduce((sum, row) => sum + row[clientIndex], 0),
  );
  const candidates = matrix.flatMap((row, rowIndex) => row.map((value, clientIndex) => ({
    rowIndex,
    clientIndex,
    fraction: value - Math.floor(value),
  }))).filter(({ rowIndex, clientIndex }) => matrix[rowIndex][clientIndex] > 0)
    .sort((a, b) => b.fraction - a.fraction);

  let guard = 0;
  while (rowDeficits.some((value) => value > 0) && guard < 1000000) {
    const candidate = candidates.find(({ rowIndex, clientIndex }) => rowDeficits[rowIndex] > 0 && colDeficits[clientIndex] > 0);
    if (!candidate) break;
    rounded[candidate.rowIndex][candidate.clientIndex] += 1;
    rowDeficits[candidate.rowIndex] -= 1;
    colDeficits[candidate.clientIndex] -= 1;
    guard += 1;
  }
  const fallbackClientIndex = clientIds.indexOf('petrobras');
  rowDeficits.forEach((deficit, rowIndex) => {
    if (deficit > 0 && fallbackClientIndex >= 0) {
      rounded[rowIndex][fallbackClientIndex] += deficit;
      rowDeficits[rowIndex] = 0;
    }
  });
  return rounded;
}

export function buildGrowingClientForecasts(): InvestorClientForecast[] {
  const periods = periodsBetween(MANAGEMENT_PROJECTION_START, MANAGEMENT_PROJECTION_END);
  const baseTargets = variableMonthlyTargets(periods);
  const targets = periods.map((period, index) =>
    Math.max(baseTargets[index], committedTotal(period) + money(450000)),
  );
  const complements = periods.map((period, index) => Math.max(0, targets[index] - committedTotal(period)));
  const required = complements.reduce((sum, value) => sum + value, 0);
  const fixedPools = { ...ALLOCATION_POOLS };
  const nonPetrobras = Object.entries(fixedPools)
    .filter(([clientId]) => clientId !== 'petrobras')
    .reduce((sum, [, value]) => sum + value, 0);
  fixedPools.petrobras = required - nonPetrobras;
  const clientIds = Object.keys(fixedPools);
  const names = Object.fromEntries(PORTFOLIO.map((client) => [client.id, client.client]));
  const rows: InvestorClientForecast[] = [...EARLY_EVENTS, ...ENEL_RECURRING_EVENTS];
  const allocations = allocateVariableMatrix(periods, complements, fixedPools);

  periods.forEach((period, periodIndex) => {
    clientIds.forEach((clientId, clientIndex) => {
      const amountCents = allocations[periodIndex][clientIndex];
      if (amountCents <= 0) return;
      rows.push({
        period,
        clientId,
        client: names[clientId],
        amountCents,
        source: clientId === 'cemig' ? 'management_adjustment' : 'backlog_allocation',
        note: clientId === 'cemig'
          ? 'Complemento variável ancorado no eventograma CEMIG, com início em outubro/2026.'
          : 'Complemento variável por backlog, prazo contratual e perfil mensal do cliente.',
      });
    });
  });
  return rows;
}

export function buildInvestorPortfolio(): InvestorPortfolioClient[] {
  const forecasts = buildGrowingClientForecasts();
  return PORTFOLIO.map((client) => {
    const projectedThrough2028Cents = forecasts
      .filter((forecast) => forecast.clientId === client.id)
      .reduce((sum, forecast) => sum + forecast.amountCents, 0);
    return {
      ...client,
      projectedThrough2028Cents,
      remainingAfter2028Cents: Math.max(0, client.backlogCents - projectedThrough2028Cents),
    };
  });
}

function generatedMonth(period: string, forecasts: InvestorClientForecast[]): InvestorPackMonth {
  return {
    id: `portfolio-${period}`,
    period,
    revenueActualCents: 0,
    revenueForecastCents: forecasts
      .filter((forecast) => forecast.period === period)
      .reduce((sum, forecast) => sum + forecast.amountCents, 0),
    payrollActualCents: 0,
    payrollForecastCents: 0,
    note: period >= MANAGEMENT_PROJECTION_START
      ? 'Curva sazonal: vales entre junho e agosto e aceleração no início e no fim do ano.'
      : 'Medições previstas conforme carteira e eventogramas informados.',
  };
}

export function hydratePortfolioProjection(pack: InvestorPack): InvestorPack {
  if (pack.narrative.projectionVersion === PORTFOLIO_PROJECTION_VERSION) return pack;
  const clientForecasts = buildGrowingClientForecasts();
  const generatedPeriods = periodsBetween('2026-07', MANAGEMENT_PROJECTION_END);
  const byPeriod = new Map(pack.months.map((month) => [month.period, month]));
  Object.entries(PAYROLL_ACTUALS_WITH_CHARGES_CENTS).forEach(([period, payrollActualCents]) => {
    const existing = byPeriod.get(period);
    byPeriod.set(period, existing ? {
      ...existing,
      payrollActualCents,
      payrollForecastCents: 0,
    } : {
      id: `payroll-${period}`,
      period,
      revenueActualCents: 0,
      revenueForecastCents: 0,
      payrollActualCents,
      payrollForecastCents: 0,
      note: 'Custo de pessoal informado, incluindo benefícios e encargos.',
    });
  });
  generatedPeriods.forEach((period) => {
    const existing = byPeriod.get(period);
    const generated = generatedMonth(period, clientForecasts);
    byPeriod.set(period, existing ? {
      ...existing,
      revenueForecastCents: generated.revenueForecastCents,
      note: existing.note || generated.note,
    } : generated);
  });

  return {
    ...pack,
    periodEnd: MANAGEMENT_PROJECTION_END,
    months: [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)),
    narrative: {
      ...pack.narrative,
      projectionVersion: PORTFOLIO_PROJECTION_VERSION,
      portfolio: buildInvestorPortfolio(),
      clientForecasts,
      assumptions: [
        ...pack.narrative.assumptions.filter(Boolean),
        'Valores de outubro/2026 a janeiro/2027 preservam os eventos cadastrados na planilha de recebíveis e recebem complementos identificados separadamente.',
        'A partir de 2027, a curva segue a sazonalidade histórica: junho–agosto mais baixos e novembro–fevereiro mais fortes; 2028 permanece acima de 2027 na comparação anual.',
        'Folha fechada de janeiro/2025 a junho/2026 atualizada com custo de pessoal incluindo benefícios e encargos; jan–jun/2026 refletem valores apresentados em milhares.',
        'Parcelas ENEL antes previstas para outubro–dezembro/2027 foram antecipadas para setembro–novembro/2026; o saldo após janeiro/2027 segue variável até setembro/2027.',
        'As 11 empresas ativas são exibidas conforme seus eventogramas; CEMIG inicia em outubro/2026 e os complementos respeitam backlog, prazo e perfil mensal.',
        'Valores de recebíveis representam saldo informado na carteira; não equivalem necessariamente a caixa recebido.',
      ],
    },
  };
}

export function clientForecastTotalsByPeriod(forecasts: InvestorClientForecast[]): Map<string, number> {
  const totals = new Map<string, number>();
  forecasts.forEach((forecast) => totals.set(forecast.period, (totals.get(forecast.period) ?? 0) + forecast.amountCents));
  return totals;
}
