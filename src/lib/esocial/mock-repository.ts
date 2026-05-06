import {
  ESOCIAL_GITHUB_URL,
  ESOCIAL_PROVIDER,
  type EsocialAbsence,
  type EsocialEmploymentLink,
  type EsocialIntegrationConfig,
  type EsocialPayment,
  type EsocialPayrollEvent,
  type EsocialPayrollRubric,
  type EsocialProtocol,
  type EsocialRawEvent,
  type EsocialSafeError,
  type EsocialSyncRun,
  type EsocialTermination,
  type EsocialWorker,
  type PayrollCostAllocation,
  type PayrollMonthlySnapshot,
  type PayrollRubricClassification,
} from "./types";
import { maskCnpj, safeStorageLabel } from "./security";

const now = "2026-05-05T09:30:00-03:00";

export const esocialIntegrationConfig: EsocialIntegrationConfig = {
  provider: ESOCIAL_PROVIDER,
  githubUrl: ESOCIAL_GITHUB_URL,
  environment: "homologation",
  companyCnpjMasked: maskCnpj(process.env.ESOCIAL_COMPANY_CNPJ ?? "12345678000190"),
  transmitterCnpjMasked: maskCnpj(process.env.ESOCIAL_TRANSMITTER_CNPJ ?? "12345678000190"),
  certificateStatus: "expiring",
  certificateExpiresAt: "2026-06-18",
  certificateAlias: "A1 configurado via ESOCIAL_CERT_PATH",
  lastSyncAt: now,
  nextScheduledSyncAt: "2026-05-06T02:15:00-03:00",
  importedEventsCount: 1842,
  failedEventsCount: 7,
  secureStoragePathLabel: safeStorageLabel(process.env.ESOCIAL_STORAGE_PATH ?? "/secure/esocial-vault"),
};

export const esocialSyncRuns: EsocialSyncRun[] = [
  {
    id: "sync-20260505-001",
    source: "certificate_sync",
    environment: "homologation",
    status: "completed_with_warnings",
    periodFrom: "2026-04",
    periodTo: "2026-04",
    startedAt: "2026-05-05T09:12:00-03:00",
    finishedAt: now,
    filesProcessed: 0,
    eventsImported: 128,
    duplicatesIgnored: 11,
    errorsCount: 2,
    rejectedEventsCount: 3,
    protocolCount: 4,
    safeMessage: "Consulta finalizada com rejeicoes cadastrais em eventos S-1200.",
  },
  {
    id: "imp-20260504-002",
    source: "manual_xml",
    environment: "homologation",
    status: "completed",
    periodFrom: "2026-04",
    periodTo: "2026-04",
    startedAt: "2026-05-04T17:05:00-03:00",
    finishedAt: "2026-05-04T17:08:00-03:00",
    filesProcessed: 42,
    eventsImported: 39,
    duplicatesIgnored: 3,
    errorsCount: 0,
    rejectedEventsCount: 0,
    protocolCount: 0,
    safeMessage: "Importacao XML normalizada para Pessoas & Custos e Folha & Alocacao.",
  },
  {
    id: "sync-20260503-001",
    source: "certificate_sync",
    environment: "homologation",
    status: "completed",
    periodFrom: "2026-03",
    periodTo: "2026-04",
    startedAt: "2026-05-03T02:15:00-03:00",
    finishedAt: "2026-05-03T02:31:00-03:00",
    filesProcessed: 0,
    eventsImported: 286,
    duplicatesIgnored: 18,
    errorsCount: 0,
    rejectedEventsCount: 0,
    protocolCount: 9,
    safeMessage: "Sincronizacao agendada concluida.",
  },
];

export const esocialSafeErrors: EsocialSafeError[] = [
  {
    id: "err-s1200-001",
    eventType: "S-1200",
    severity: "error",
    safeCode: "REGRA_REMUN_PERIODO",
    safeMessage: "Rubrica sem classificacao gerencial para a competencia 2026-04.",
    occurredAt: now,
  },
  {
    id: "err-s2200-001",
    eventType: "S-2200",
    severity: "warning",
    safeCode: "CADASTRO_INCOMPLETO",
    safeMessage: "Vinculo importado sem centro de custo mapeado.",
    occurredAt: "2026-05-05T09:28:00-03:00",
  },
  {
    id: "rej-s1210-001",
    eventType: "S-1210",
    severity: "error",
    safeCode: "RETORNO_LOTE",
    safeMessage: "Retorno de lote indica evento rejeitado. CPF/CNPJ omitidos do log.",
    occurredAt: "2026-05-05T09:27:00-03:00",
  },
];

export const esocialRawEvents: EsocialRawEvent[] = [
  {
    id: "raw-s1200-001",
    source: "certificate_sync",
    eventType: "S-1200",
    eventId: "ID1123452026040001",
    period: "2026-04",
    workerCpfMasked: "123.***.***-09",
    companyCnpjMasked: esocialIntegrationConfig.companyCnpjMasked,
    status: "normalized",
    rawXmlStorageKey: "esocial/certificate_sync/2026-05-05/s1200-id1123452026040001.xml.enc",
    rawXmlSha256: "sha256:mocked-safe-metadata-only",
    receivedAt: now,
    normalizedAt: now,
    safeMetadata: { competence: "2026-04", rubrics: 8, grossAmount: 18420 },
  },
  {
    id: "raw-s2200-001",
    source: "manual_xml",
    eventType: "S-2200",
    eventId: "ID1123452026040044",
    period: "2026-04",
    workerCpfMasked: "987.***.***-10",
    companyCnpjMasked: esocialIntegrationConfig.companyCnpjMasked,
    status: "normalized",
    rawXmlStorageKey: "esocial/manual_xml/2026-05-04/s2200-id1123452026040044.xml.enc",
    rawXmlSha256: "sha256:mocked-safe-metadata-only",
    receivedAt: "2026-05-04T17:05:00-03:00",
    normalizedAt: "2026-05-04T17:06:00-03:00",
    safeMetadata: { admissionDate: "2026-04-15", department: "Operacoes" },
  },
];

export const esocialProtocols: EsocialProtocol[] = [
  {
    id: "prot-001",
    syncRunId: "sync-20260505-001",
    protocolNumber: "1.2.202605.000000001",
    batchId: "lot-20260505-001",
    eventIds: ["raw-s1200-001"],
    status: "accepted",
    responseXmlStorageKey: "esocial/protocols/2026-05-05/1-2-202605-000000001.xml.enc",
    receivedAt: now,
    safeMessage: "Protocolo armazenado em cofre privado.",
  },
];

export const esocialWorkers: EsocialWorker[] = [
  {
    id: "wrk-001",
    cpfMasked: "123.***.***-09",
    nameMasked: "C. Mendes",
    birthDate: "1988-08-11",
    currentDepartmentId: "dep-tech",
    currentDepartmentName: "Tecnologia",
    currentCostCenterId: "CC-001",
    employmentType: "clt",
    status: "active",
  },
  {
    id: "wrk-002",
    cpfMasked: "987.***.***-10",
    nameMasked: "R. Souza",
    birthDate: "1992-02-21",
    currentDepartmentId: "dep-ops",
    currentDepartmentName: "Operacoes",
    currentCostCenterId: "CC-002",
    employmentType: "clt",
    status: "active",
  },
  {
    id: "wrk-003",
    cpfMasked: "456.***.***-40",
    nameMasked: "D. Lopes",
    birthDate: "1985-10-09",
    currentDepartmentId: "dep-ops",
    currentDepartmentName: "Operacoes",
    currentCostCenterId: "CC-002",
    employmentType: "pj",
    status: "active",
  },
];

export const esocialEmploymentLinks: EsocialEmploymentLink[] = [
  {
    id: "link-001",
    workerId: "wrk-001",
    registrationNumber: "000145",
    admissionDate: "2021-03-15",
    jobTitle: "Eng. Manager",
    cboCode: "1425-05",
    departmentId: "dep-tech",
    departmentName: "Tecnologia",
    costCenterId: "CC-001",
    employmentType: "clt",
  },
  {
    id: "link-002",
    workerId: "wrk-002",
    registrationNumber: "000178",
    admissionDate: "2026-04-15",
    jobTitle: "Analista de Operacoes",
    cboCode: "2521-05",
    departmentId: "dep-ops",
    departmentName: "Operacoes",
    costCenterId: "CC-002",
    employmentType: "clt",
  },
];

export const esocialPayrollEvents: EsocialPayrollEvent[] = [
  {
    id: "pay-001",
    workerId: "wrk-001",
    employmentLinkId: "link-001",
    eventType: "S-1200",
    period: "2026-04",
    competence: "2026-04",
    grossAmount: 38000,
    netAmount: 24820,
    departmentId: "dep-tech",
    departmentName: "Tecnologia",
    costCenterId: "CC-001",
    sourceRawEventId: "raw-s1200-001",
  },
  {
    id: "pay-002",
    workerId: "wrk-002",
    employmentLinkId: "link-002",
    eventType: "S-1200",
    period: "2026-04",
    competence: "2026-04",
    grossAmount: 18000,
    netAmount: 12650,
    departmentId: "dep-ops",
    departmentName: "Operacoes",
    costCenterId: "CC-002",
    sourceRawEventId: "raw-s1200-001",
  },
];

export const esocialPayrollRubrics: EsocialPayrollRubric[] = [
  { id: "rub-001", payrollEventId: "pay-001", code: "1000", description: "Salario base", amount: 32000, category: "base_salary" },
  { id: "rub-002", payrollEventId: "pay-001", code: "1018", description: "Horas extras 50%", amount: 2500, quantity: 12, category: "overtime" },
  { id: "rub-003", payrollEventId: "pay-001", code: "3000", description: "Vale refeicao", amount: 1200, category: "benefits" },
  { id: "rub-004", payrollEventId: "pay-001", code: "9201", description: "INSS", amount: -908, category: "deductions" },
  { id: "rub-005", payrollEventId: "pay-002", code: "1000", description: "Salario base", amount: 16000, category: "base_salary" },
  { id: "rub-006", payrollEventId: "pay-002", code: "1018", description: "Horas extras 50%", amount: 900, quantity: 6, category: "overtime" },
];

export const esocialPayments: EsocialPayment[] = [
  { id: "pmt-001", workerId: "wrk-001", payrollEventId: "pay-001", period: "2026-04", paidAt: "2026-05-05", amount: 24820, paymentType: "salary" },
  { id: "pmt-002", workerId: "wrk-002", payrollEventId: "pay-002", period: "2026-04", paidAt: "2026-05-05", amount: 12650, paymentType: "salary" },
];

export const esocialAbsences: EsocialAbsence[] = [
  { id: "abs-001", workerId: "wrk-002", startDate: "2026-04-22", endDate: "2026-04-23", reasonCode: "03", reasonLabel: "Atestado medico", days: 2 },
];

export const esocialTerminations: EsocialTermination[] = [
  { id: "term-001", workerId: "wrk-004", employmentLinkId: "link-004", terminationDate: "2026-04-28", reasonCode: "02", reasonLabel: "Rescisao sem justa causa", terminationAmount: 28400 },
];

export const payrollMonthlySnapshots: PayrollMonthlySnapshot[] = [
  {
    id: "snap-202604",
    competence: "2026-04",
    headcount: 226,
    activeEmployees: 222,
    admissions: 8,
    terminations: 4,
    grossPayroll: 3130000,
    benefits: 431800,
    taxesCharges: 1408500,
    overtimeAmount: 88500,
    averageCostPerEmployee: 22081,
    departments: [
      { departmentId: "dep-tech", departmentName: "Tecnologia", headcount: 84, grossPayroll: 1240000, totalCost: 1970000, concentrationPercent: 39.8 },
      { departmentId: "dep-ops", departmentName: "Operacoes", headcount: 62, grossPayroll: 820000, totalCost: 1299000, concentrationPercent: 26.2 },
      { departmentId: "dep-com", departmentName: "Comercial", headcount: 38, grossPayroll: 510000, totalCost: 810000, concentrationPercent: 16.4 },
    ],
  },
];

export const payrollCostAllocations: PayrollCostAllocation[] = [
  { id: "alloc-001", competence: "2026-04", departmentId: "dep-tech", costCenterId: "CC-001", projectId: "PRJ-2026-001", allocatedAmount: 412000, allocationPercent: 0.21, source: "project_timesheet" },
  { id: "alloc-002", competence: "2026-04", departmentId: "dep-ops", costCenterId: "CC-002", projectId: "PRJ-2026-005", allocatedAmount: 575000, allocationPercent: 0.44, source: "cost_center" },
];

export const payrollRubricClassifications: PayrollRubricClassification[] = [
  { id: "cls-001", rubricCode: "1000", category: "base_salary", isDefault: true, notes: "Salario contratual" },
  { id: "cls-002", rubricCode: "1018", category: "overtime", isDefault: true, notes: "Hora extra com adicional" },
  { id: "cls-003", rubricCode: "3000", category: "benefits", isDefault: true, notes: "Beneficios flexiveis/VR/VA" },
  { id: "cls-004", rubricCode: "9201", category: "deductions", isDefault: true, notes: "Desconto previdenciario" },
];
