import type { InvestorPack, InvestorPortfolioClient } from './types';

export const REVENUE_IMPORT_VERSION = 'faturamentos-2026-julho-agosto-v1';

export type ManagementPortfolioInput = Pick<InvestorPortfolioClient,
  'id' | 'client' | 'contractsCount' | 'portfolioCents' | 'billedCents' | 'backlogCents' | 'blockedCents'>;

function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Import actuals and move the saved revenue schedule, retaining payroll and the report horizon. */
export function rebaseRevenueProjection(
  pack: InvestorPack,
  actuals: Record<string, number>,
  managementPortfolio: ManagementPortfolioInput[],
): InvestorPack {
  if (pack.status !== 'draft') throw new Error('A atualização exige uma projeção em rascunho.');
  if (pack.narrative.projectionVersion === REVENUE_IMPORT_VERSION) return pack;
  const lastActual = Object.keys(actuals).sort().at(-1);
  if (!lastActual) throw new Error('Informe as competências realizadas.');
  for (const [period, amount] of Object.entries(actuals)) {
    if (!Number.isSafeInteger(amount) || amount < 0 || !pack.months.some((month) => month.period === period)) {
      throw new Error(`Faturamento ou competência inválida: ${period}.`);
    }
  }
  const remaining = new Map(managementPortfolio.map((client) => {
    if (client.portfolioCents - client.billedCents !== client.backlogCents) {
      throw new Error(`Carteira não reconciliada: ${client.client}.`);
    }
    return [client.id, client.backlogCents];
  }));
  const future = pack.narrative.clientForecasts.filter((row) => row.period >= lastActual);
  for (const month of pack.months.filter((row) => row.period >= lastActual)) {
    const total = future.filter((row) => row.period === month.period).reduce((sum, row) => sum + row.amountCents, 0);
    if (total !== month.revenueForecastCents || month.revenueActualCents !== 0) {
      throw new Error(`A previsão por cliente diverge da base mensal: ${month.period}.`);
    }
  }
  const clientForecasts = future
    .map((row) => ({ ...row, period: nextPeriod(row.period), note: `${row.note} Previsão deslocada de ${row.period} em um mês após o fechamento de agosto/2026.` }))
    .filter((row) => row.period <= pack.periodEnd)
    .sort((a, b) => a.period.localeCompare(b.period))
    .flatMap((row) => {
      const available = remaining.get(row.clientId);
      if (available === undefined) throw new Error(`Cliente ausente da carteira: ${row.clientId}.`);
      const amountCents = Math.min(row.amountCents, available);
      remaining.set(row.clientId, available - amountCents);
      return amountCents > 0 ? [{ ...row, amountCents, note: row.note + (amountCents < row.amountCents ? ' Valor limitado ao backlog da visão gerencial.' : '') }] : [];
    });
  const totals = new Map<string, number>();
  clientForecasts.forEach((row) => totals.set(row.period, (totals.get(row.period) ?? 0) + row.amountCents));
  for (const period of totals.keys()) {
    if (!pack.months.some((month) => month.period === period)) throw new Error(`Competência de destino ausente: ${period}.`);
  }
  const oldClients = new Map(pack.narrative.portfolio.map((client) => [client.id, client]));
  const portfolio = managementPortfolio.map((client): InvestorPortfolioClient => ({
    status: client.backlogCents > 0 ? 'Ativo' : 'Concluído',
    receivableCents: 0,
    pipeline90Cents: 0,
    maturationCents: 0,
    ...oldClients.get(client.id),
    ...client,
    // Receivables were not supplied in the management snapshot; retain existing values.
    projectedThrough2028Cents: client.backlogCents - remaining.get(client.id)!,
    remainingAfter2028Cents: remaining.get(client.id)!,
  }));
  const sourceNote = 'Faturamento realizado conforme FATURAMENTOS - 2026 3.xlsx, aba Faturamentos, total JA FATURADO NO MÊS.';
  return {
    ...pack,
    referenceDate: '2026-09-17',
    months: pack.months.map((month) => Object.hasOwn(actuals, month.period) ? {
      ...month, revenueActualCents: actuals[month.period], revenueForecastCents: 0, note: sourceNote,
    } : month.period > lastActual ? {
      ...month, revenueForecastCents: totals.get(month.period) ?? 0,
      note: `${month.note} Faturamento deslocado em um mês, limitado ao backlog atualizado.`.trim(),
    } : month),
    narrative: {
      ...pack.narrative,
      projectionVersion: REVENUE_IMPORT_VERSION,
      portfolio,
      clientForecasts,
      assumptions: [
        ...pack.narrative.assumptions.filter((note) => note && !/Julho\/2026 foi reclassificado|As 11 empresas|Valores de outubro\/2026 a janeiro\/2027|A partir de 2027, a curva|Parcelas ENEL antes/.test(note)),
        'Julho e agosto/2026 realizados conforme FATURAMENTOS - 2026 3.xlsx, aba Faturamentos, células C23 e C50. Totais do Financeiro incluem os recebimentos classificados nessas seções.',
        'Curva de faturamento salva no sistema deslocada em um mês: agosto/2026 passa a setembro/2026. Folha preservada nas competências originais.',
        'Carteira, faturado, backlog, bloqueado e quantidade de contratos atualizados conforme Visão Gerencial de 17/09/2026. Recebíveis anteriores preservados; não informados para novos clientes.',
        'Previsões limitadas ao backlog por cliente, por ordem de competência, sem descontar novamente os realizados do saldo informado na Visão Gerencial.',
        'Horizonte preservado até dezembro/2028; parcelas deslocadas para 2029 e saldos sem cronograma ficam no backlog ainda não projetado. Valores bloqueados dependem de liberação.',
      ],
    },
  };
}
