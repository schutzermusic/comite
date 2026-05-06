import {
  esocialEmploymentLinks,
  esocialIntegrationConfig,
  esocialPayrollEvents,
  esocialPayrollRubrics,
  esocialPayments,
  esocialRawEvents,
  esocialSafeErrors,
  esocialSyncRuns,
  esocialWorkers,
  payrollMonthlySnapshots,
  payrollRubricClassifications,
} from "./mock-repository";
import { getSafeXmlStorageKey, maskCnpj, maskCpf, sanitizeLogMetadata } from "./security";
import type {
  EsocialCertificateStatus,
  EsocialEnvironment,
  EsocialImportSummary,
  EsocialIntegrationConfig,
  EsocialRawEvent,
  EsocialSyncRun,
  MonthlyPayrollTrendPoint,
  ParsedEsocialEvent,
  PayrollCostSummary,
  PayrollDepartmentCost,
  PayrollRubricCategory,
  RankingItem,
  WorkforceSummary,
} from "./types";

export interface EsocialXmlParser {
  parseEventXml(xml: string, fileName?: string): ParsedEsocialEvent;
  validateXmlStructure(xml: string): { valid: boolean; safeMessage?: string };
}

export interface EsocialNormalizer {
  normalizeWorkerData(events: ParsedEsocialEvent[]): void;
  normalizeEmploymentData(events: ParsedEsocialEvent[]): void;
  normalizePayrollData(events: ParsedEsocialEvent[]): void;
  normalizePaymentData(events: ParsedEsocialEvent[]): void;
}

export interface EsocialCertificateSyncService {
  loadA1CertificateFromConfig(): Promise<{ configured: boolean; safeMessage: string }>;
  validateCertificate(): Promise<{ status: EsocialCertificateStatus; expiresAt?: string; safeMessage: string }>;
  runSyncByPeriod(input: { environment: EsocialEnvironment; periodFrom: string; periodTo: string }): Promise<EsocialSyncRun>;
  fetchEventsAndProtocols(input: { periodFrom: string; periodTo: string }): Promise<{ events: EsocialRawEvent[]; protocols: number }>;
}

export interface EsocialBiService {
  generateWorkforceSummary(): WorkforceSummary;
  generatePayrollCostSummary(competence: string): PayrollCostSummary;
  generateOvertimeRanking(limit?: number): RankingItem[];
  generateTenureRanking(limit?: number): RankingItem[];
  generateDepartmentCostConcentration(): PayrollDepartmentCost[];
  generateMonthlyPayrollTrend(): MonthlyPayrollTrendPoint[];
}

const eventTypePattern = /<(?:eSocial[\s\S]*?)?<evt([A-Za-z0-9]+)\b|<evt([A-Za-z0-9]+)\b/;
const idPattern = /\bId=["']([^"']+)["']/;
const cpfPattern = /<cpfTrab>(\d{11})<\/cpfTrab>|<cpfBenef>(\d{11})<\/cpfBenef>/;
const cnpjPattern = /<nrInsc>(\d{14})<\/nrInsc>/;
const periodPattern = /<perApur>(\d{4}-\d{2})<\/perApur>|<perRef>(\d{4}-\d{2})<\/perRef>/;

export class MockEsocialXmlParser implements EsocialXmlParser {
  validateXmlStructure(xml: string): { valid: boolean; safeMessage?: string } {
    const trimmed = xml.trim();
    if (!trimmed.startsWith("<")) return { valid: false, safeMessage: "Arquivo nao parece ser XML." };
    if (!trimmed.includes("<eSocial")) return { valid: false, safeMessage: "Envelope eSocial nao encontrado." };
    if (!eventTypePattern.test(trimmed)) return { valid: false, safeMessage: "Tipo de evento eSocial nao identificado." };
    return { valid: true };
  }

  parseEventXml(xml: string, fileName = "event.xml"): ParsedEsocialEvent {
    const validation = this.validateXmlStructure(xml);
    if (!validation.valid) {
      throw new Error(validation.safeMessage ?? "XML eSocial invalido.");
    }

    const eventMatch = xml.match(eventTypePattern);
    const eventCode = eventMatch?.[1] ?? eventMatch?.[2] ?? "UNKNOWN";
    const eventType = eventCode.startsWith("S") ? eventCode : `S-${eventCode.replace(/^S/, "")}`;
    const cpf = xml.match(cpfPattern);
    const cnpj = xml.match(cnpjPattern);
    const period = xml.match(periodPattern);

    return {
      eventType,
      eventId: xml.match(idPattern)?.[1],
      period: period?.[1] ?? period?.[2],
      workerCpfMasked: maskCpf(cpf?.[1] ?? cpf?.[2]),
      companyCnpjMasked: maskCnpj(cnpj?.[1]),
      safeMetadata: sanitizeLogMetadata({
        fileName,
        eventType,
        period: period?.[1] ?? period?.[2] ?? null,
        rawXmlStorageKey: getSafeXmlStorageKey("manual_xml", fileName),
      }),
    };
  }
}

export class MockEsocialNormalizer implements EsocialNormalizer {
  normalizeWorkerData(): void {
    return undefined;
  }

  normalizeEmploymentData(): void {
    return undefined;
  }

  normalizePayrollData(): void {
    return undefined;
  }

  normalizePaymentData(): void {
    return undefined;
  }
}

export class MockEsocialCertificateSyncService implements EsocialCertificateSyncService {
  async loadA1CertificateFromConfig(): Promise<{ configured: boolean; safeMessage: string }> {
    const configured = Boolean(process.env.ESOCIAL_CERT_PATH && process.env.ESOCIAL_CERT_PASSWORD);
    return {
      configured,
      safeMessage: configured
        ? "Certificado A1 referenciado por variaveis de ambiente."
        : "Configure ESOCIAL_CERT_PATH e ESOCIAL_CERT_PASSWORD fora do repositorio.",
    };
  }

  async validateCertificate(): Promise<{ status: EsocialCertificateStatus; expiresAt?: string; safeMessage: string }> {
    return {
      status: esocialIntegrationConfig.certificateStatus,
      expiresAt: esocialIntegrationConfig.certificateExpiresAt,
      safeMessage: "Validacao mockada. Integracao SOAP real deve ocorrer no bridge PHP seguro.",
    };
  }

  async runSyncByPeriod(input: { environment: EsocialEnvironment; periodFrom: string; periodTo: string }): Promise<EsocialSyncRun> {
    return {
      id: `sync-dry-run-${input.periodFrom}-${input.periodTo}`,
      source: "certificate_sync",
      environment: input.environment,
      status: "scheduled",
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      startedAt: new Date().toISOString(),
      filesProcessed: 0,
      eventsImported: 0,
      duplicatesIgnored: 0,
      errorsCount: 0,
      rejectedEventsCount: 0,
      protocolCount: 0,
      safeMessage: "Sync preparado para bridge PHP. Nenhuma chamada SOAP foi executada pelo Next.js.",
    };
  }

  async fetchEventsAndProtocols(): Promise<{ events: EsocialRawEvent[]; protocols: number }> {
    return { events: esocialRawEvents, protocols: 1 };
  }
}

export class MockEsocialBiService implements EsocialBiService {
  generateWorkforceSummary(): WorkforceSummary {
    const activeEmployees = esocialWorkers.filter((worker) => worker.status === "active").length;
    const cltCount = esocialWorkers.filter((worker) => worker.employmentType === "clt").length;
    const pjCount = esocialWorkers.filter((worker) => worker.employmentType === "pj").length;
    const snapshot = payrollMonthlySnapshots[0];

    return {
      headcount: snapshot?.headcount ?? esocialWorkers.length,
      activeEmployees: snapshot?.activeEmployees ?? activeEmployees,
      admissions: snapshot?.admissions ?? 0,
      terminations: snapshot?.terminations ?? 0,
      turnoverPercent: snapshot ? (snapshot.terminations / Math.max(1, snapshot.activeEmployees)) * 100 : 0,
      averageTenureMonths: 38,
      cltCount,
      pjCount,
      alerts: [
        "3 eventos rejeitados aguardam saneamento cadastral.",
        "Centro de custo ausente em 1 vinculo novo.",
      ],
      sourceUpdatedAt: esocialIntegrationConfig.lastSyncAt,
    };
  }

  generatePayrollCostSummary(competence: string): PayrollCostSummary {
    const snapshot = payrollMonthlySnapshots.find((item) => item.competence === competence) ?? payrollMonthlySnapshots[0];
    const deductions = esocialPayrollRubrics
      .filter((rubric) => rubric.category === "deductions")
      .reduce((sum, rubric) => sum + Math.abs(rubric.amount), 0);
    const netPayments = esocialPayments.reduce((sum, payment) => sum + payment.amount, 0);

    return {
      competence: snapshot.competence,
      grossPayroll: snapshot.grossPayroll,
      benefits: snapshot.benefits,
      taxesCharges: snapshot.taxesCharges,
      deductions,
      netPayments,
      overtimeAmount: snapshot.overtimeAmount,
      totalCost: snapshot.grossPayroll + snapshot.benefits + snapshot.taxesCharges,
      budgetVariancePercent: 2.8,
      dreImpactAmount: snapshot.grossPayroll + snapshot.benefits + snapshot.taxesCharges,
      sourceUpdatedAt: esocialIntegrationConfig.lastSyncAt,
    };
  }

  generateOvertimeRanking(limit = 5): RankingItem[] {
    const byWorker = new Map<string, number>();
    for (const rubric of esocialPayrollRubrics.filter((item) => item.category === "overtime")) {
      const event = esocialPayrollEvents.find((item) => item.id === rubric.payrollEventId);
      if (!event) continue;
      byWorker.set(event.workerId, (byWorker.get(event.workerId) ?? 0) + (rubric.quantity ?? rubric.amount));
    }

    return [...byWorker.entries()]
      .map(([workerId, value]) => {
        const worker = esocialWorkers.find((item) => item.id === workerId);
        return {
          id: workerId,
          label: worker?.nameMasked ?? workerId,
          secondaryLabel: worker?.currentDepartmentName,
          value,
          unit: "h",
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  generateTenureRanking(limit = 5): RankingItem[] {
    const reference = new Date("2026-05-05T00:00:00-03:00").getTime();
    return esocialEmploymentLinks
      .map((link) => {
        const worker = esocialWorkers.find((item) => item.id === link.workerId);
        const admitted = new Date(`${link.admissionDate}T00:00:00-03:00`).getTime();
        const months = Math.max(0, Math.round((reference - admitted) / (1000 * 60 * 60 * 24 * 30.44)));
        return {
          id: link.id,
          label: worker?.nameMasked ?? link.workerId,
          secondaryLabel: link.departmentName,
          value: months,
          unit: "meses",
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  generateDepartmentCostConcentration(): PayrollDepartmentCost[] {
    return payrollMonthlySnapshots[0]?.departments ?? [];
  }

  generateMonthlyPayrollTrend(): MonthlyPayrollTrendPoint[] {
    return [
      { competence: "2026-01", grossPayroll: 3010000, totalCost: 4785900, headcount: 218, overtimeAmount: 72000 },
      { competence: "2026-02", grossPayroll: 3080000, totalCost: 4897200, headcount: 221, overtimeAmount: 76800 },
      { competence: "2026-03", grossPayroll: 3140000, totalCost: 4992600, headcount: 224, overtimeAmount: 83200 },
      { competence: "2026-04", grossPayroll: 3130000, totalCost: 4970300, headcount: 226, overtimeAmount: 88500 },
    ];
  }
}

export function classifyPayrollRubric(code: string, description: string): PayrollRubricCategory {
  const byCode = payrollRubricClassifications.find((item) => item.rubricCode === code);
  if (byCode) return byCode.category;

  const normalized = description.toLowerCase();
  if (normalized.includes("hora extra") || normalized.includes("extra")) return "overtime";
  if (normalized.includes("salario") || normalized.includes("salario base")) return "base_salary";
  if (normalized.includes("bonus") || normalized.includes("premio")) return "bonus";
  if (normalized.includes("vale") || normalized.includes("beneficio")) return "benefits";
  if (normalized.includes("ferias")) return "vacation";
  if (normalized.includes("13") || normalized.includes("decimo")) return "thirteenth_salary";
  if (normalized.includes("rescis")) return "termination";
  if (normalized.includes("inss") || normalized.includes("fgts") || normalized.includes("irrf")) return "taxes_charges";
  if (normalized.includes("desconto") || normalized.includes("deducao")) return "deductions";
  return "other";
}

export function getEsocialDashboardData(): {
  config: EsocialIntegrationConfig;
  syncRuns: EsocialSyncRun[];
  errors: typeof esocialSafeErrors;
  workforce: WorkforceSummary;
  payroll: PayrollCostSummary;
  overtimeRanking: RankingItem[];
  tenureRanking: RankingItem[];
  departmentConcentration: PayrollDepartmentCost[];
  monthlyTrend: MonthlyPayrollTrendPoint[];
  importSummary: EsocialImportSummary;
} {
  const bi = new MockEsocialBiService();
  return {
    config: esocialIntegrationConfig,
    syncRuns: esocialSyncRuns,
    errors: esocialSafeErrors,
    workforce: bi.generateWorkforceSummary(),
    payroll: bi.generatePayrollCostSummary("2026-04"),
    overtimeRanking: bi.generateOvertimeRanking(),
    tenureRanking: bi.generateTenureRanking(),
    departmentConcentration: bi.generateDepartmentCostConcentration(),
    monthlyTrend: bi.generateMonthlyPayrollTrend(),
    importSummary: {
      filesProcessed: 42,
      eventsImported: 39,
      duplicatesIgnored: 3,
      errors: [],
      rejections: [],
      periodDetected: "2026-04",
      eventTypes: { "S-1200": 18, "S-1210": 18, "S-2200": 2, "S-2299": 1 },
    },
  };
}
