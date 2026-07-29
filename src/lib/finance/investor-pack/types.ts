export type InvestorPackStatus = 'draft' | 'published' | 'archived';
export type InvestorPackConfidentiality = 'confidential' | 'restricted' | 'public';

export interface InvestorPackMonth {
  id: string;
  period: string;
  revenueActualCents: number;
  revenueForecastCents: number;
  payrollActualCents: number;
  payrollForecastCents: number;
  note: string;
}

export interface InvestorPackNarrative {
  executiveSummary: string;
  highlights: string[];
  risks: string[];
  assumptions: string[];
  closingMessage: string;
}

export interface InvestorPack {
  id: string;
  organizationId: string | null;
  title: string;
  company: string;
  recipient: string;
  periodStart: string;
  periodEnd: string;
  currency: 'BRL';
  referenceDate: string;
  confidentiality: InvestorPackConfidentiality;
  status: InvestorPackStatus;
  version: number;
  parentPackId: string | null;
  authorName: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  months: InvestorPackMonth[];
  narrative: InvestorPackNarrative;
}

export interface InvestorPackCurvePoint extends InvestorPackMonth {
  revenueTotalCents: number;
  payrollTotalCents: number;
  revenueCumulativeCents: number;
  payrollCumulativeCents: number;
  balanceCents: number;
  balanceCumulativeCents: number;
}

export interface InvestorPackMetrics {
  revenueActualCents: number;
  revenueForecastCents: number;
  revenueTotalCents: number;
  payrollActualCents: number;
  payrollForecastCents: number;
  payrollTotalCents: number;
  balanceCents: number;
  coverageRatio: number | null;
}

export interface InvestorPackSnapshot {
  pack: InvestorPack;
  points: InvestorPackCurvePoint[];
  metrics: InvestorPackMetrics;
  warnings: string[];
  sourceLabel: 'Dados informados manualmente na Projeção Financeira';
}

export interface InvestorPackValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
