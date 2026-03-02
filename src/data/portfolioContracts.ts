/**
 * Portfolio contracts synchronized from Excel source.
 */

import {
  EXCEL_SYNC_META,
  excelCompanyBreakdown,
  excelPortfolioTotals,
} from '@/data/contractsFromExcel.generated';

export interface CompanyData {
  company: string;
  totalContracted: number;
  backlogToInvoice: number;
  contractsCount: number;
}

export interface ContractData {
  id: string;
  name: string;
  value: number;
  state: string;
  startDate: string;
  endDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'SUSPENDED';
}

export interface PortfolioTotals {
  totalContracted: number;
  totalInvoiced: number;
  backlogToInvoice: number;
  totalContracts: number;
}

export const PORTFOLIO_TOTALS: PortfolioTotals = {
  totalContracted: excelPortfolioTotals.totalContracted,
  totalInvoiced: excelPortfolioTotals.totalInvoiced,
  backlogToInvoice: excelPortfolioTotals.backlogToInvoice,
  totalContracts: excelPortfolioTotals.totalContracts,
};

export const COMPANY_BREAKDOWN: CompanyData[] = excelCompanyBreakdown.map((row) => ({
  company: row.company,
  totalContracted: row.totalContracted,
  backlogToInvoice: row.backlogToInvoice,
  contractsCount: row.contractsCount,
}));

export const PORTFOLIO_SYNC_META = EXCEL_SYNC_META;

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBRLCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return `R$ ${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(1)}K`;
  }
  return `R$ ${value.toFixed(0)}`;
}

export function getCompanyPercentage(company: CompanyData): number {
  return (company.totalContracted / PORTFOLIO_TOTALS.totalContracted) * 100;
}

export function getTopCompanies(n: number): CompanyData[] {
  return [...COMPANY_BREAKDOWN]
    .sort((a, b) => b.totalContracted - a.totalContracted)
    .slice(0, n);
}

export function sortCompanies(
  data: CompanyData[],
  field: keyof CompanyData,
  direction: 'asc' | 'desc' = 'desc'
): CompanyData[] {
  return [...data].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'desc' ? bVal - aVal : aVal - bVal;
    }
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    }
    return 0;
  });
}

export function companiesWithBacklog(data: CompanyData[]): CompanyData[] {
  return data.filter((c) => c.backlogToInvoice > 0);
}

export function companiesWithoutBacklog(data: CompanyData[]): CompanyData[] {
  return data.filter((c) => c.backlogToInvoice === 0);
}

export function companiesWithMultipleContracts(data: CompanyData[]): CompanyData[] {
  return data.filter((c) => c.contractsCount >= 3);
}

export function generateInsights(data: CompanyData[]): string[] {
  const insights: string[] = [];

  const sortedByContracted = sortCompanies(data, 'totalContracted', 'desc');
  if (sortedByContracted.length >= 2) {
    const top2Value = sortedByContracted[0].totalContracted + sortedByContracted[1].totalContracted;
    const top2Percent = ((top2Value / PORTFOLIO_TOTALS.totalContracted) * 100).toFixed(0);
    insights.push(
      `Alta concentracao: ${sortedByContracted[0].company} + ${sortedByContracted[1].company} representam ${top2Percent}% do valor contratado.`
    );
  }

  const withBacklog = companiesWithBacklog(data);
  if (withBacklog.length < data.length / 2) {
    insights.push(
      `Backlog concentrado em ${withBacklog.length} de ${data.length} clientes; priorizar governanca de faturamento.`
    );
  }

  return insights.slice(0, 2);
}

export function getCompanyByName(name: string): CompanyData | undefined {
  return COMPANY_BREAKDOWN.find((c) => c.company.toLowerCase() === name.toLowerCase());
}

export function searchCompanies(data: CompanyData[], query: string): CompanyData[] {
  if (!query.trim()) return data;
  const normalizedQuery = query.toLowerCase().trim();
  return data.filter((c) => c.company.toLowerCase().includes(normalizedQuery));
}

export const portfolioTotals = PORTFOLIO_TOTALS;
export const portfolioCompanies = COMPANY_BREAKDOWN;
export type PortfolioCompany = CompanyData;

export function generateMockContracts(company: string, count: number, totalValue: number): ContractData[] {
  const contracts: ContractData[] = [];
  const states = ['MG', 'RJ', 'SP', 'PA', 'MA', 'RS', 'SC', 'PR', 'BA', 'CE'];
  const statuses: ContractData['status'][] = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'COMPLETED'];

  let remainingValue = totalValue;

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const value = isLast ? remainingValue : Math.round(remainingValue * (0.15 + Math.random() * 0.35));
    remainingValue -= value;

    const startYear = 2023 + Math.floor(Math.random() * 2);
    const startMonth = Math.floor(Math.random() * 12) + 1;
    const endYear = startYear + 1 + Math.floor(Math.random() * 2);
    const endMonth = Math.floor(Math.random() * 12) + 1;

    contracts.push({
      id: `${company.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
      name: `Contrato ${company} #${i + 1}`,
      value,
      state: states[Math.floor(Math.random() * states.length)],
      startDate: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
      endDate: `${endYear}-${String(endMonth).padStart(2, '0')}-28`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
    });
  }

  return contracts.sort((a, b) => b.value - a.value);
}
