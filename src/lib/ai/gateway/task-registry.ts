import type { ApexAITask, ApexAITaskPolicy } from './types';

export const DEFAULT_PRODUCTION_MODEL = 'claude-sonnet-5';
export const EXPLICIT_ESCALATION_MODEL = 'claude-opus-5';

export const CURRENT_PRODUCTION_TASKS = [
  'CONTRACT_EXTRACTION',
  'CONTRACT_RISK_ANALYSIS',
  'FINANCE_RISK_ANALYSIS',
  'PROJECT_RISK_ANALYSIS',
  'WORKFORCE_ADVISOR',
  'PAYROLL_NARRATIVE',
  'EXECUTIVE_SYNTHESIS',
  'MEETING_MINUTES',
  'ASO_EXTRACTION',
  'PROJECT_SCHEDULE_EXTRACTION',
  'CONTRACT_OPERATIONALIZATION',
  'CONTRACT_AMENDMENT_EXTRACTION',
] as const;

export type ApexAIProductionTask = (typeof CURRENT_PRODUCTION_TASKS)[number];

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
const positiveInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

function normal(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return {
    provider: 'anthropic',
    model: env('APEX_AI_ANTHROPIC_MODEL', DEFAULT_PRODUCTION_MODEL),
    maxTokens: 4096,
    timeoutMs: positiveInt('APEX_AI_TIMEOUT_MS', 60_000),
    maxAttempts: positiveInt('APEX_AI_MAX_ATTEMPTS', 2),
    reasoningEffort: 'medium',
    promptCache: true,
    stream: false,
    highRisk: false,
    fallbacks: [],
    ...overrides,
  };
}

function highRisk(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return normal({
    // Production high-risk tasks default to Sonnet 5; Opus is never used automatically.
    model: env('APEX_AI_ANTHROPIC_HIGH_RISK_MODEL', env('APEX_AI_ANTHROPIC_MODEL', DEFAULT_PRODUCTION_MODEL)),
    reasoningEffort: 'high',
    highRisk: true,
    // Deliberately empty: high-risk work never silently downgrades or falls back automatically.
    fallbacks: [],
    ...overrides,
  });
}

function explicitEscalation(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return {
    provider: 'anthropic',
    model: env('APEX_AI_ANTHROPIC_ESCALATION_MODEL', env('APEX_AI_ANTHROPIC_COMPLEX_MODEL', EXPLICIT_ESCALATION_MODEL)),
    maxTokens: 16_000,
    timeoutMs: positiveInt('APEX_AI_TIMEOUT_MS', 120_000),
    maxAttempts: positiveInt('APEX_AI_MAX_ATTEMPTS', 2),
    reasoningEffort: 'high',
    promptCache: true,
    stream: false,
    highRisk: true,
    // Never an automatic fallback: explicit escalation targets fail closed without silent downgrade.
    fallbacks: [],
    ...overrides,
  };
}

export function getApexAITaskPolicy(task: ApexAITask): ApexAITaskPolicy {
  const policies: Record<ApexAITask, ApexAITaskPolicy> = {
    CONTRACT_EXTRACTION: highRisk({ maxTokens: 16_000, timeoutMs: 120_000 }),
    /*
      Operacionalização lê o contrato inteiro e devolve MUITO mais que
      cláusulas: obrigações de cada parte, condições de faturamento, garantias,
      seguros, reajuste, documentos exigidos e riscos materiais — cada um com
      página e trecho literal. Um contrato de 195 páginas produz saída longa, e
      truncá-la entregaria uma leitura parcial com cara de completa.
    */
    CONTRACT_OPERATIONALIZATION: highRisk({ maxTokens: 32_000, timeoutMs: 180_000 }),
    // Amendment interpretation is legally material, but remains on the normal
    // economical Sonnet route. There is deliberately no automatic Opus hop.
    CONTRACT_AMENDMENT_EXTRACTION: highRisk({ maxTokens: 24_000, timeoutMs: 180_000 }),
    CONTRACT_RISK_ANALYSIS: normal(),
    FINANCE_RISK_ANALYSIS: normal(),
    PROJECT_RISK_ANALYSIS: normal(),
    WORKFORCE_ADVISOR: normal({ maxTokens: 2048 }),
    PAYROLL_NARRATIVE: normal(),
    EXECUTIVE_SYNTHESIS: normal(),
    MEETING_MINUTES: normal(),
    PROJECT_SCHEDULE_EXTRACTION: highRisk({ maxTokens: 64_000, timeoutMs: 120_000, stream: true }),
    ASO_EXTRACTION: highRisk({ maxTokens: 1500 }),
    COMPLEX_ESCALATION: explicitEscalation(),
  };
  return policies[task];
}
