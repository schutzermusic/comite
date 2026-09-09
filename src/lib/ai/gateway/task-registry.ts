import type { ApexAITask, ApexAITaskPolicy } from './types';

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
const positiveInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

function normal(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return {
    provider: 'anthropic',
    model: env('APEX_AI_ANTHROPIC_MODEL', 'claude-sonnet-5'),
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
    model: env('APEX_AI_ANTHROPIC_HIGH_RISK_MODEL', 'claude-opus-5'),
    reasoningEffort: 'high',
    highRisk: true,
    // Deliberately empty: high-risk work never silently downgrades.
    fallbacks: [],
    ...overrides,
  });
}

export function getApexAITaskPolicy(task: ApexAITask): ApexAITaskPolicy {
  const policies: Record<ApexAITask, ApexAITaskPolicy> = {
    CONTRACT_EXTRACTION: highRisk({ maxTokens: 16_000, timeoutMs: 120_000 }),
    CONTRACT_RISK_ANALYSIS: normal(),
    FINANCE_RISK_ANALYSIS: normal(),
    PROJECT_RISK_ANALYSIS: normal(),
    WORKFORCE_ADVISOR: normal({ maxTokens: 2048 }),
    PAYROLL_NARRATIVE: normal(),
    EXECUTIVE_SYNTHESIS: normal(),
    MEETING_MINUTES: normal(),
    COMPLEX_ESCALATION: highRisk({
      model: env('APEX_AI_ANTHROPIC_COMPLEX_MODEL', env('APEX_AI_ANTHROPIC_HIGH_RISK_MODEL', 'claude-opus-5')),
    }),
    PROJECT_SCHEDULE_EXTRACTION: highRisk({ maxTokens: 64_000, timeoutMs: 120_000, stream: true }),
    ASO_EXTRACTION: highRisk({ maxTokens: 1500 }),
  };
  return policies[task];
}
