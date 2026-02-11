/**
 * Portfolio Contracts Data - Official 2025-2026 Active Contracts
 */

// ============================================
// TYPES
// ============================================

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

// ============================================
// AGGREGATE TOTALS
// ============================================

export const PORTFOLIO_TOTALS: PortfolioTotals = {
  totalContracted: 540465533.75,
  totalInvoiced: 119478189.63,
  backlogToInvoice: 420987344.12,
  totalContracts: 52,
};

// ============================================
// COMPANY BREAKDOWN (21 Active Companies)
// ============================================

export const COMPANY_BREAKDOWN: CompanyData[] = [
  { company: "CEMIG S.A", totalContracted: 198827691.78, backlogToInvoice: 188474062.00, contractsCount: 1 },
  { company: "PETROBRAS", totalContracted: 188922698.70, backlogToInvoice: 169445777.72, contractsCount: 5 },
  { company: "ENEL GREEN POWER", totalContracted: 65899071.59, backlogToInvoice: 32776307.33, contractsCount: 6 },
  { company: "ELETROBRAS S.A", totalContracted: 31196749.41, backlogToInvoice: 8849196.83, contractsCount: 4 },
  { company: "ENEVA S.A", totalContracted: 21017204.25, backlogToInvoice: 3552200.00, contractsCount: 4 },
  { company: "ENERGIA PECEM", totalContracted: 8974958.51, backlogToInvoice: 8974958.51, contractsCount: 2 },
  { company: "HYDRO ALUNORTE", totalContracted: 4965143.38, backlogToInvoice: 4136704.04, contractsCount: 1 },
  { company: "FURNAS S.A", totalContracted: 3563986.93, backlogToInvoice: 0.00, contractsCount: 1 },
  { company: "CERAN/ CPFL", totalContracted: 2755977.06, backlogToInvoice: 0.00, contractsCount: 6 },
  { company: "GE VERNOVA", totalContracted: 2633365.73, backlogToInvoice: 37138.22, contractsCount: 3 },
  { company: "ENGIE S.A", totalContracted: 2371635.72, backlogToInvoice: 350000.00, contractsCount: 2 },
  { company: "BELÉM BIOENERGIA", totalContracted: 2085276.19, backlogToInvoice: 1256676.80, contractsCount: 3 },
  { company: "ÂMBAR ENERGIA", totalContracted: 1758120.89, backlogToInvoice: 1165119.84, contractsCount: 2 },
  { company: "POWER BUS", totalContracted: 1368159.75, backlogToInvoice: 0.00, contractsCount: 1 },
  { company: "SINOP ENERGIA", totalContracted: 1053612.00, backlogToInvoice: 297435.60, contractsCount: 3 },
  { company: "KLABIN S.A", totalContracted: 950000.00, backlogToInvoice: 665000.00, contractsCount: 1 },
  { company: "CELESC S.A", totalContracted: 716474.54, backlogToInvoice: 530050.54, contractsCount: 2 },
  { company: "ARCELOR MITTAL", totalContracted: 476716.69, backlogToInvoice: 476716.69, contractsCount: 2 },
  { company: "BRASKEM S.A", totalContracted: 411525.00, backlogToInvoice: 0.00, contractsCount: 1 },
  { company: "TIJOÁ", totalContracted: 379220.83, backlogToInvoice: 0.00, contractsCount: 1 },
  { company: "COPEL S.A", totalContracted: 137944.80, backlogToInvoice: 0.00, contractsCount: 1 },
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

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
  return data.filter(c => c.backlogToInvoice > 0);
}

export function companiesWithoutBacklog(data: CompanyData[]): CompanyData[] {
  return data.filter(c => c.backlogToInvoice === 0);
}

export function companiesWithMultipleContracts(data: CompanyData[]): CompanyData[] {
  return data.filter(c => c.contractsCount >= 3);
}

export function generateInsights(data: CompanyData[]): string[] {
  const insights: string[] = [];
  
  const sortedByContracted = sortCompanies(data, 'totalContracted', 'desc');
  if (sortedByContracted.length >= 2) {
    const top2Value = sortedByContracted[0].totalContracted + sortedByContracted[1].totalContracted;
    const top2Percent = ((top2Value / PORTFOLIO_TOTALS.totalContracted) * 100).toFixed(0);
    insights.push(
      `Alta concentração: ${sortedByContracted[0].company} + ${sortedByContracted[1].company} representam ${top2Percent}% do valor contratado.`
    );
  }
  
  const withBacklog = companiesWithBacklog(data);
  if (withBacklog.length < data.length / 2) {
    insights.push(
      `Backlog concentrado em ${withBacklog.length} de ${data.length} clientes; priorizar governança de faturamento.`
    );
  }
  
  return insights.slice(0, 2);
}

export function getCompanyByName(name: string): CompanyData | undefined {
  return COMPANY_BREAKDOWN.find(
    c => c.company.toLowerCase() === name.toLowerCase()
  );
}

export function searchCompanies(data: CompanyData[], query: string): CompanyData[] {
  if (!query.trim()) return data;
  const normalizedQuery = query.toLowerCase().trim();
  return data.filter(c => c.company.toLowerCase().includes(normalizedQuery));
}

// ============================================
// LEGACY ALIASES (for backward compatibility)
// ============================================

export const portfolioTotals = PORTFOLIO_TOTALS;
export const portfolioCompanies = COMPANY_BREAKDOWN;
export type PortfolioCompany = CompanyData;

// ============================================
// MOCK CONTRACT DATA
// ============================================

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
