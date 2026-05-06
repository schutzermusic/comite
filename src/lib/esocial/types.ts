export const ESOCIAL_PROVIDER = "nfephp-org/sped-esocial";
export const ESOCIAL_GITHUB_URL = "https://github.com/nfephp-org/sped-esocial";

export type EsocialEnvironment = "homologation" | "production";
export type EsocialSyncStatus = "scheduled" | "running" | "completed" | "completed_with_warnings" | "failed";
export type EsocialEventStatus = "imported" | "normalized" | "duplicate" | "rejected" | "failed";
export type EsocialEventSource = "manual_xml" | "certificate_sync";
export type EsocialCertificateStatus = "not_configured" | "valid" | "expiring" | "expired" | "invalid";
export type EsocialStorageVisibility = "secure_private";

export type PayrollRubricCategory =
  | "base_salary"
  | "overtime"
  | "bonus"
  | "benefits"
  | "vacation"
  | "thirteenth_salary"
  | "termination"
  | "taxes_charges"
  | "deductions"
  | "other";

export interface EsocialIntegrationConfig {
  provider: typeof ESOCIAL_PROVIDER;
  githubUrl: typeof ESOCIAL_GITHUB_URL;
  environment: EsocialEnvironment;
  companyCnpjMasked: string;
  transmitterCnpjMasked: string;
  certificateStatus: EsocialCertificateStatus;
  certificateExpiresAt?: string;
  certificateAlias?: string;
  lastSyncAt?: string;
  nextScheduledSyncAt?: string;
  importedEventsCount: number;
  failedEventsCount: number;
  secureStoragePathLabel: string;
}

export interface EsocialSyncRun {
  id: string;
  source: EsocialEventSource;
  environment: EsocialEnvironment;
  status: EsocialSyncStatus;
  periodFrom: string;
  periodTo: string;
  startedAt: string;
  finishedAt?: string;
  filesProcessed: number;
  eventsImported: number;
  duplicatesIgnored: number;
  errorsCount: number;
  rejectedEventsCount: number;
  protocolCount: number;
  safeMessage: string;
}

export interface EsocialRawEvent {
  id: string;
  source: EsocialEventSource;
  eventType: string;
  eventId?: string;
  period?: string;
  workerCpfMasked?: string;
  companyCnpjMasked: string;
  status: EsocialEventStatus;
  rawXmlStorageKey: string;
  rawXmlSha256: string;
  receivedAt: string;
  normalizedAt?: string;
  safeMetadata: Record<string, string | number | boolean | null>;
}

export interface EsocialProtocol {
  id: string;
  syncRunId: string;
  protocolNumber: string;
  batchId?: string;
  eventIds: string[];
  status: "accepted" | "processing" | "rejected" | "error";
  responseXmlStorageKey: string;
  receivedAt: string;
  safeMessage?: string;
}

export interface EsocialWorker {
  id: string;
  cpfMasked: string;
  nameMasked: string;
  birthDate?: string;
  gender?: string;
  currentDepartmentId?: string;
  currentDepartmentName?: string;
  currentCostCenterId?: string;
  employmentType: "clt" | "pj" | "intern" | "director" | "unknown";
  status: "active" | "terminated" | "inactive";
}

export interface EsocialEmploymentLink {
  id: string;
  workerId: string;
  registrationNumber?: string;
  admissionDate: string;
  terminationDate?: string;
  jobTitle?: string;
  cboCode?: string;
  departmentId?: string;
  departmentName?: string;
  costCenterId?: string;
  employmentType: EsocialWorker["employmentType"];
}

export interface EsocialPayrollEvent {
  id: string;
  workerId: string;
  employmentLinkId?: string;
  eventType: string;
  period: string;
  competence: string;
  grossAmount: number;
  netAmount?: number;
  departmentId?: string;
  departmentName?: string;
  costCenterId?: string;
  sourceRawEventId: string;
}

export interface EsocialPayrollRubric {
  id: string;
  payrollEventId: string;
  code: string;
  description: string;
  amount: number;
  quantity?: number;
  referenceValue?: number;
  category: PayrollRubricCategory;
  incidenceInss?: string;
  incidenceIrrf?: string;
  incidenceFgts?: string;
}

export interface EsocialPayment {
  id: string;
  workerId: string;
  payrollEventId?: string;
  period: string;
  paidAt?: string;
  amount: number;
  paymentType: "salary" | "advance" | "termination" | "vacation" | "other";
}

export interface EsocialAbsence {
  id: string;
  workerId: string;
  startDate: string;
  endDate?: string;
  reasonCode: string;
  reasonLabel: string;
  days: number;
}

export interface EsocialTermination {
  id: string;
  workerId: string;
  employmentLinkId?: string;
  terminationDate: string;
  reasonCode?: string;
  reasonLabel?: string;
  terminationAmount?: number;
}

export interface PayrollMonthlySnapshot {
  id: string;
  competence: string;
  headcount: number;
  activeEmployees: number;
  admissions: number;
  terminations: number;
  grossPayroll: number;
  benefits: number;
  taxesCharges: number;
  overtimeAmount: number;
  averageCostPerEmployee: number;
  departments: PayrollDepartmentCost[];
}

export interface PayrollCostAllocation {
  id: string;
  competence: string;
  workerId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectId?: string;
  allocatedAmount: number;
  allocationPercent: number;
  source: "manual_rule" | "cost_center" | "project_timesheet" | "esocial_default";
}

export interface PayrollRubricClassification {
  id: string;
  rubricCode: string;
  rubricDescriptionPattern?: string;
  category: PayrollRubricCategory;
  isDefault: boolean;
  notes?: string;
}

export interface PayrollDepartmentCost {
  departmentId: string;
  departmentName: string;
  headcount: number;
  grossPayroll: number;
  totalCost: number;
  concentrationPercent: number;
}

export interface EsocialImportSummary {
  filesProcessed: number;
  eventsImported: number;
  duplicatesIgnored: number;
  errors: EsocialSafeError[];
  rejections: EsocialSafeError[];
  periodDetected: string;
  eventTypes: Record<string, number>;
}

export interface EsocialSafeError {
  id: string;
  eventType?: string;
  severity: "warning" | "error";
  safeMessage: string;
  safeCode?: string;
  occurredAt: string;
}

export interface WorkforceSummary {
  headcount: number;
  activeEmployees: number;
  admissions: number;
  terminations: number;
  turnoverPercent: number;
  averageTenureMonths: number;
  cltCount: number;
  pjCount: number;
  alerts: string[];
  sourceUpdatedAt?: string;
}

export interface PayrollCostSummary {
  competence: string;
  grossPayroll: number;
  benefits: number;
  taxesCharges: number;
  deductions: number;
  netPayments: number;
  overtimeAmount: number;
  totalCost: number;
  budgetVariancePercent: number;
  dreImpactAmount: number;
  sourceUpdatedAt?: string;
}

export interface RankingItem {
  id: string;
  label: string;
  secondaryLabel?: string;
  value: number;
  unit?: string;
}

export interface MonthlyPayrollTrendPoint {
  competence: string;
  grossPayroll: number;
  totalCost: number;
  headcount: number;
  overtimeAmount: number;
}

export interface ParsedEsocialEvent {
  eventType: string;
  eventId?: string;
  period?: string;
  workerCpfMasked?: string;
  companyCnpjMasked?: string;
  safeMetadata: Record<string, string | number | boolean | null>;
}
