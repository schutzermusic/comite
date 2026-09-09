export const APEX_AI_TASKS = [
  'CONTRACT_EXTRACTION',
  'CONTRACT_RISK_ANALYSIS',
  'FINANCE_RISK_ANALYSIS',
  'PROJECT_RISK_ANALYSIS',
  'WORKFORCE_ADVISOR',
  'PAYROLL_NARRATIVE',
  'EXECUTIVE_SYNTHESIS',
  'MEETING_MINUTES',
  'COMPLEX_ESCALATION',
  'PROJECT_SCHEDULE_EXTRACTION',
  'ASO_EXTRACTION',
  'CONTRACT_OPERATIONALIZATION',
] as const;

export type ApexAITask = (typeof APEX_AI_TASKS)[number];
export type ApexAIProvider = 'anthropic' | 'openai' | 'google';
export type ApexAIReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface ApexAICapabilities {
  structuredOutput: boolean;
  documentPdf: boolean;
  reasoningEffort: boolean;
  promptCache: boolean;
  streaming: boolean;
}

export interface ApexAIDocument {
  mediaType: 'application/pdf';
  base64: string;
}

export interface ApexAIStructuredOutput {
  name: string;
  schema: Record<string, unknown>;
}

/** Tenant context must come from a server-side authenticated boundary. */
export interface ApexAIRequest {
  organizationId: string;
  task: ApexAITask;
  systemPrompt?: string;
  userPrompt: string;
  document?: ApexAIDocument;
  structuredOutput?: ApexAIStructuredOutput;
}

export interface ApexAIUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ApexAIProvenance {
  provider: ApexAIProvider;
  model: string;
  task: ApexAITask;
  usage: ApexAIUsage;
  durationMs: number;
  attempts: number;
}

export interface ApexAIResponse<T = unknown> {
  text: string;
  output: T;
  stopReason: string | null;
  provenance: ApexAIProvenance;
}

export interface ApexAITaskPolicy {
  provider: ApexAIProvider;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  maxAttempts: number;
  reasoningEffort: ApexAIReasoningEffort;
  promptCache: boolean;
  stream: boolean;
  highRisk: boolean;
  fallbacks: ReadonlyArray<{ provider: ApexAIProvider; model: string }>;
}

export interface ApexAIAdapterRequest extends ApexAIRequest {
  policy: ApexAITaskPolicy;
}

export interface ApexAIAdapterResponse {
  text: string;
  stopReason: string | null;
  usage: ApexAIUsage;
}

export interface ApexAIProviderAdapter {
  readonly provider: ApexAIProvider;
  readonly capabilities: ApexAICapabilities;
  isConfigured(): boolean;
  generate(request: ApexAIAdapterRequest, signal: AbortSignal): Promise<ApexAIAdapterResponse>;
  normalizeError(error: unknown): import('./errors').ApexAIError;
}

/** Interface contract for a future OpenAI implementation. */
export interface OpenAIApexAdapter extends ApexAIProviderAdapter {
  readonly provider: 'openai';
}

/** Interface contract for a future Google implementation. */
export interface GoogleApexAdapter extends ApexAIProviderAdapter {
  readonly provider: 'google';
}
