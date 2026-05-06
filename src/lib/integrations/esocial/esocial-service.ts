import {
  MockEsocialCertificateSyncService,
  getEsocialDashboardData,
} from "@/lib/esocial/services";
import { esocialRawEvents, esocialSyncRuns } from "@/lib/esocial/mock-repository";
import type {
  EsocialCertificateValidationResult,
  EsocialSyncNowRequest,
  EsocialSyncNowResult,
} from "./types";
import { getEsocialIntegrationStatus, validateEsocialConfiguration } from "./esocial-config";

export class EsocialIntegrationService {
  private readonly certificateSync = new MockEsocialCertificateSyncService();

  getStatus() {
    return getEsocialIntegrationStatus();
  }

  async validateRequiredConfiguration(input: Parameters<typeof validateEsocialConfiguration>[0]) {
    return validateEsocialConfiguration(input);
  }

  async validateCertificate(): Promise<EsocialCertificateValidationResult> {
    const result = await this.certificateSync.validateCertificate();
    return {
      valid: result.status === "valid" || result.status === "expiring",
      simulated: true,
      status: result.status,
      expiresAt: result.expiresAt,
      safeMessage:
        "Validacao simulada no Next.js. A leitura real do .pfx/.p12 e da senha deve ocorrer no bridge PHP seguro.",
      warnings:
        result.status === "expiring"
          ? ["Certificado proximo da expiracao. Renovar antes de executar sync em producao."]
          : [],
    };
  }

  async testProviderConnectivity() {
    return {
      healthy: false,
      simulated: true,
      safeMessage:
        "Conectividade SOAP nao testada pelo Next.js. Aguardando service/worker PHP com nfephp-org/sped-esocial.",
    };
  }

  async runSyncByCompetence(input: EsocialSyncNowRequest): Promise<EsocialSyncNowResult> {
    const run = await this.certificateSync.runSyncByPeriod({
      environment: input.environment,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
    });

    return {
      run,
      simulated: true,
      safeMessage:
        "Sync automatico agendado em modo simulado. Nenhum SOAP real foi executado sem o conector PHP.",
    };
  }

  getSyncRuns() {
    return esocialSyncRuns;
  }

  getEvents() {
    return esocialRawEvents.map((event) => ({
      id: event.id,
      source: event.source,
      eventType: event.eventType,
      eventId: event.eventId,
      period: event.period,
      workerCpfMasked: event.workerCpfMasked,
      companyCnpjMasked: event.companyCnpjMasked,
      status: event.status,
      receivedAt: event.receivedAt,
      normalizedAt: event.normalizedAt,
      safeMetadata: event.safeMetadata,
    }));
  }

  getWorkforceSummary() {
    return getEsocialDashboardData().workforce;
  }

  getPayrollSummary() {
    return getEsocialDashboardData().payroll;
  }
}

export const esocialIntegrationService = new EsocialIntegrationService();
