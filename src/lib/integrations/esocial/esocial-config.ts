import { esocialIntegrationConfig } from "@/lib/esocial/mock-repository";
import { maskCnpj } from "@/lib/esocial/security";
import type {
  EsocialCertificateConfigInput,
  EsocialIntegrationStatus,
  EsocialScheduleConfig,
} from "./types";

export const defaultEsocialScheduleConfig: EsocialScheduleConfig = {
  automaticSyncEnabled: true,
  frequency: "daily",
  nextScheduledSyncAt: esocialIntegrationConfig.nextScheduledSyncAt,
  competence: "2026-04",
};

export function getEsocialIntegrationStatus(): EsocialIntegrationStatus {
  return {
    config: esocialIntegrationConfig,
    schedule: defaultEsocialScheduleConfig,
    connectorMode: "mocked_pending_php_bridge",
    providerConnectivity: "awaiting_php_bridge",
    certificatePasswordSaved: false,
    safeStatusMessage:
      "Modo simulado: configuracao e agendamento prontos; SOAP/certificado real aguardam o conector PHP interno.",
  };
}

export function validateEsocialConfiguration(input: EsocialCertificateConfigInput): {
  ok: boolean;
  safeErrors: string[];
} {
  const safeErrors: string[] = [];
  if (input.companyCnpj.replace(/\D/g, "").length !== 14) {
    safeErrors.push("CNPJ da empresa deve ter 14 digitos.");
  }
  if (input.transmitterCnpj && input.transmitterCnpj.replace(/\D/g, "").length !== 14) {
    safeErrors.push("CNPJ do transmissor deve ter 14 digitos.");
  }
  if (!input.certificateFileName?.match(/\.(pfx|p12)$/i)) {
    safeErrors.push("Certificado A1 deve ser um arquivo .pfx ou .p12.");
  }
  if (!input.certificatePasswordProvided) {
    safeErrors.push("Senha do certificado deve ser informada no fluxo seguro.");
  }

  return { ok: safeErrors.length === 0, safeErrors };
}

export function getMaskedCertificateConfig(input: EsocialCertificateConfigInput) {
  return {
    companyCnpjMasked: maskCnpj(input.companyCnpj),
    transmitterCnpjMasked: maskCnpj(input.transmitterCnpj ?? input.companyCnpj),
    environment: input.environment,
    certificateFileName: input.certificateFileName ? input.certificateFileName.replace(/^.*[\\/]/, "") : undefined,
    certificatePasswordProvided: input.certificatePasswordProvided,
  };
}
