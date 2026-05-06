export * from "@/lib/esocial/types";

import type {
  EsocialEnvironment,
  EsocialIntegrationConfig,
  EsocialSafeError,
  EsocialSyncRun,
  PayrollCostSummary,
  WorkforceSummary,
} from "@/lib/esocial/types";

export type EsocialSyncFrequency = "manual" | "daily" | "weekly" | "monthly";
export type EsocialBridgeMode = "http" | "queue" | "cli" | "webhook";
export type EsocialConnectorMode = "mocked_pending_php_bridge" | "php_bridge_ready" | "php_bridge_error";

export interface EsocialCertificateConfigInput {
  companyCnpj: string;
  transmitterCnpj?: string;
  environment: EsocialEnvironment;
  certificateFileName?: string;
  certificatePasswordProvided: boolean;
}

export interface EsocialScheduleConfig {
  automaticSyncEnabled: boolean;
  frequency: EsocialSyncFrequency;
  nextScheduledSyncAt?: string;
  competence: string;
}

export interface EsocialIntegrationStatus {
  config: EsocialIntegrationConfig;
  schedule: EsocialScheduleConfig;
  connectorMode: EsocialConnectorMode;
  providerConnectivity: "not_tested" | "healthy" | "unavailable" | "awaiting_php_bridge";
  certificatePasswordSaved: boolean;
  safeStatusMessage: string;
}

export interface EsocialCertificateValidationResult {
  valid: boolean;
  simulated: boolean;
  status: EsocialIntegrationConfig["certificateStatus"];
  expiresAt?: string;
  safeMessage: string;
  warnings: string[];
}

export interface EsocialSyncNowRequest {
  environment: EsocialEnvironment;
  competence: string;
  periodFrom: string;
  periodTo: string;
}

export interface EsocialSyncNowResult {
  run: EsocialSyncRun;
  simulated: boolean;
  safeMessage: string;
}

export interface EsocialConsumerPayload {
  workforceSummary: WorkforceSummary;
  payrollSummary: PayrollCostSummary;
  errors: EsocialSafeError[];
}
