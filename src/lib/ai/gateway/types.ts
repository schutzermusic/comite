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
  'CONTRACT_AMENDMENT_EXTRACTION',
  'MEASUREMENT_EVIDENCE_PREANALYSIS',
  'COMMERCIAL_DOCUMENT_EXTRACTION',
  'SITE_SURVEY_UNDERSTANDING',
  'SERVICE_ORDER_DIVERGENCE_REVIEW',
  'SUPPLIER_WEB_DISCOVERY',
] as const;

import type { ApexAIResponseShape } from './response-diagnostics';

export type ApexAITask = (typeof APEX_AI_TASKS)[number];
export type ApexAIProvider = 'anthropic' | 'openai' | 'google';
export type ApexAIReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface ApexAICapabilities {
  structuredOutput: boolean;
  documentPdf: boolean;
  reasoningEffort: boolean;
  promptCache: boolean;
  streaming: boolean;
  /**
   * Busca na internet executada PELO PROVEDOR (ferramenta de servidor), com as
   * fontes devolvidas junto. Opcional para não obrigar todo adaptador a
   * declará-la: ausente vale `false`, e o portão recusa (falha fechada).
   */
  webSearch?: boolean;
}

/**
 * Busca na internet pedida por uma tarefa. Só a BUSCA: leitura de página
 * (`web_fetch`) nunca é ligada pelo gateway.
 */
export interface ApexAIWebSearch {
  /** Teto de buscas nesta chamada (o adaptador limita a 1…10). */
  maxUses: number;
  /** Só estes domínios. Não combina com `blockedDomains`. */
  allowedDomains?: string[];
  /** Nunca estes domínios. Não combina com `allowedDomains`. */
  blockedDomains?: string[];
  /** País (ISO 3166-1 alfa-2) para a localização aproximada da busca, ex.: 'BR'. */
  country?: string;
}

/** Uma fonte que a busca do provedor DEVOLVEU (resultado ou citação) — endereço e título, nunca o conteúdo. */
export interface ApexAISource {
  url: string;
  title: string | null;
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
  /** Liga a busca na internet do provedor nesta chamada (e só nela). Ausente = nenhuma ferramenta. */
  webSearch?: ApexAIWebSearch;
}

export interface ApexAIUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /** Buscas na internet cobradas nesta chamada (só quando houve `webSearch`). */
  webSearchRequests?: number;
}

export interface ApexAIProvenance {
  provider: ApexAIProvider;
  model: string;
  task: ApexAITask;
  usage: ApexAIUsage;
  durationMs: number;
  attempts: number;
  responseId?: string;
  requestId?: string;
}

export interface ApexAIResponse<T = unknown> {
  text: string;
  output: T;
  stopReason: string | null;
  provenance: ApexAIProvenance;
  /**
   * As fontes que a busca na internet devolveu (resultados + citações), sem
   * repetição. Presente só quando a chamada pediu `webSearch`.
   */
  sources?: ApexAISource[];
  /**
   * Códigos de erro das buscas que o provedor devolveu como falha (ex.:
   * `max_uses_exceeded`, `unavailable`) — a busca falha sem exceção, dentro de
   * uma resposta 200. Só códigos, nunca conteúdo. Presente só com `webSearch`.
   */
  searchErrors?: string[];
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
  responseId?: string;
  requestId?: string;
  /**
   * A FORMA da resposta — tipos de bloco e contagens, nunca conteúdo.
   *
   * Opcional porque o portão não pode depender de todo adaptador saber
   * descrever-se: quando falta, o portão assume forma desconhecida em vez de
   * falhar. Ver `./response-diagnostics.ts`.
   */
  shape?: ApexAIResponseShape;
  /** Fontes da busca na internet (só com `webSearch`); ver `ApexAIResponse.sources`. */
  sources?: ApexAISource[];
  /** Códigos de erro das buscas que falharam (ver `ApexAIResponse.searchErrors`). */
  searchErrors?: string[];
}

export interface ApexAIProviderAdapter {
  readonly provider: ApexAIProvider;
  readonly capabilities: ApexAICapabilities;
  isConfigured(): boolean;
  generate(request: ApexAIAdapterRequest, signal: AbortSignal): Promise<ApexAIAdapterResponse>;
  normalizeError(error: unknown): import('./errors').ApexAIError;
}

/** OpenAI adapter contract, kept at the gateway boundary. */
export interface OpenAIApexAdapter extends ApexAIProviderAdapter {
  readonly provider: 'openai';
}

/** Interface contract for a future Google implementation. */
export interface GoogleApexAdapter extends ApexAIProviderAdapter {
  readonly provider: 'google';
}
