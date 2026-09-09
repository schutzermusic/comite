import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import { ApexAIError } from '@/lib/ai/gateway/errors';
import {
  getApexAITaskPolicy,
  CURRENT_PRODUCTION_TASKS,
  DEFAULT_PRODUCTION_MODEL,
  EXPLICIT_ESCALATION_MODEL,
} from '@/lib/ai/gateway';
import type {
  ApexAIAdapterRequest,
  ApexAIAdapterResponse,
  ApexAIProviderAdapter,
} from '@/lib/ai/gateway/types';
import { generatePayrollNarrative } from '@/lib/ai/payroll/payroll-narrative';
import type { PayrollParseResult } from '@/lib/types/payroll-closing';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

class FakeAdapter implements ApexAIProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly capabilities = {
    structuredOutput: true, documentPdf: true, reasoningEffort: true,
    promptCache: true, streaming: true,
  } as const;
  calls: ApexAIAdapterRequest[] = [];
  failures = 0;

  isConfigured() { return true; }
  async generate(request: ApexAIAdapterRequest, _signal: AbortSignal): Promise<ApexAIAdapterResponse> {
    this.calls.push(request);
    if (this.failures-- > 0) throw new ApexAIError('RATE_LIMIT', 'busy', true);
    return {
      text: '{"ok":true}',
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 4 },
    };
  }
  normalizeError(error: unknown) {
    return error instanceof ApexAIError
      ? error
      : new ApexAIError('PROVIDER_ERROR', String(error), false);
  }
}

describe('ApexAIGateway routing', () => {
  it('routes by typed task policy and returns observable provenance', async () => {
    const adapter = new FakeAdapter();
    const gateway = new ApexAIGateway([adapter]);
    const result = await gateway.generate<{ ok: boolean }>({
      organizationId: 'org-validated',
      task: 'FINANCE_RISK_ANALYSIS',
      userPrompt: 'facts',
      structuredOutput: { name: 'test', schema: { type: 'object' } },
    });

    expect(adapter.calls[0].policy.provider).toBe('anthropic');
    expect(adapter.calls[0].policy.model).toBe('claude-sonnet-5');
    expect(result.output).toEqual({ ok: true });
    expect(result.provenance).toMatchObject({
      provider: 'anthropic', model: 'claude-sonnet-5', task: 'FINANCE_RISK_ANALYSIS',
      usage: { inputTokens: 12, outputTokens: 4 }, attempts: 1,
    });
  });

  it('routes ALL current production tasks to claude-sonnet-5 with 0 using Opus and zero automatic fallbacks', () => {
    expect(DEFAULT_PRODUCTION_MODEL).toBe('claude-sonnet-5');
    expect(CURRENT_PRODUCTION_TASKS).toHaveLength(11);

    const tasksUsingSonnet: string[] = [];
    const tasksUsingOpus: string[] = [];

    for (const task of CURRENT_PRODUCTION_TASKS) {
      const policy = getApexAITaskPolicy(task);
      if (policy.model === 'claude-sonnet-5') tasksUsingSonnet.push(task);
      if (policy.model.includes('opus')) tasksUsingOpus.push(task);

      // Verify no automatic fallback to Opus or any other model
      expect(policy.fallbacks).toEqual([]);
      expect(policy.model).toBe('claude-sonnet-5');
    }

    expect(tasksUsingSonnet).toHaveLength(11);
    expect(tasksUsingOpus).toHaveLength(0);
  });

  it('proves every specific production task routes to claude-sonnet-5', () => {
    const expectedTasks = [
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
    ] as const;

    for (const task of expectedTasks) {
      const policy = getApexAITaskPolicy(task);
      expect(policy.provider).toBe('anthropic');
      expect(policy.model).toBe('claude-sonnet-5');
      expect(policy.fallbacks).toEqual([]);
    }
  });

  it('keeps Opus available ONLY as explicit escalation, never as automatic fallback', () => {
    const escalation = getApexAITaskPolicy('COMPLEX_ESCALATION');
    expect(escalation.model).toBe('claude-opus-5');
    expect(escalation.fallbacks).toEqual([]);
    expect(escalation.highRisk).toBe(true);

    // Verify no production task has Opus as fallback
    for (const task of CURRENT_PRODUCTION_TASKS) {
      const policy = getApexAITaskPolicy(task);
      expect(policy.model).not.toBe('claude-opus-5');
      expect(policy.fallbacks.some(f => f.model.includes('opus'))).toBe(false);
    }
  });

  it('routes CONTRACT_EXTRACTION via gateway to claude-sonnet-5', async () => {
    const adapter = new FakeAdapter();
    const gateway = new ApexAIGateway([adapter]);
    const result = await gateway.generate<{ ok: boolean }>({
      organizationId: 'org-test',
      task: 'CONTRACT_EXTRACTION',
      userPrompt: 'extract clauses',
      document: { mediaType: 'application/pdf', base64: 'fake' },
      structuredOutput: { name: 'clauses', schema: { type: 'object' } },
    });

    expect(adapter.calls[0].policy.model).toBe('claude-sonnet-5');
    expect(result.provenance.model).toBe('claude-sonnet-5');
    expect(result.provenance.task).toBe('CONTRACT_EXTRACTION');
  });

  it('requires explicit tenant context before provider access', async () => {
    const adapter = new FakeAdapter();
    await expect(new ApexAIGateway([adapter]).generate({
      organizationId: '', task: 'WORKFORCE_ADVISOR', userPrompt: 'x',
    })).rejects.toMatchObject({ code: 'INVALID_TENANT_CONTEXT' });
    expect(adapter.calls).toHaveLength(0);
  });

  it('retries only normalized retryable failures', async () => {
    process.env.APEX_AI_MAX_ATTEMPTS = '2';
    const adapter = new FakeAdapter();
    adapter.failures = 1;
    const result = await new ApexAIGateway([adapter]).generate({
      organizationId: 'org-validated', task: 'PROJECT_RISK_ANALYSIS', userPrompt: 'x',
    });
    expect(adapter.calls).toHaveLength(2);
    expect(result.provenance.attempts).toBe(2);
  });

  it('AI disabled fails closed before any provider call', async () => {
    process.env.APEX_AI_ENABLED = 'false';
    const adapter = new FakeAdapter();
    await expect(new ApexAIGateway([adapter]).generate({
      organizationId: 'org-validated', task: 'PAYROLL_NARRATIVE', userPrompt: 'x',
    })).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(adapter.calls).toHaveLength(0);
  });
});

describe('provider isolation and persisted provenance', () => {
  it('keeps provider SDK usage inside the adapter boundary', () => {
    const domainFiles = [
      'src/lib/ai/risk-scanner.ts',
      'src/lib/ai/risk-call.ts',
      'src/lib/ai/contract-clause-extractor.ts',
      'src/lib/ai/payroll/payroll-narrative.ts',
      'src/lib/ai/workforce/workforce-advisor.ts',
      'src/lib/projects/ms-project-ai-extractor.ts',
      'src/lib/workforce/aso-ai-extractor.ts',
      'src/ai/flows/automated-minute-generation.ts',
    ];
    for (const file of domainFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toContain('@anthropic-ai/sdk');
      expect(source, file).not.toMatch(/new Anthropic|messages\.(create|stream)/);
      expect(source, file).not.toMatch(/claude-(?:sonnet|opus)-\d/);
    }
    expect(readFileSync(resolve(process.cwd(), 'src/lib/ai/gateway/anthropic-adapter.ts'), 'utf8'))
      .toContain('@anthropic-ai/sdk');
  });

  it('migration requires provider/model on every persisted AI-output class', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/152_apex_ai_gateway_provenance.sql'),
      'utf8',
    );
    for (const target of [
      'risks_ai_provenance_check',
      'contract_ai_analyses_provenance_check',
      'contract_clauses_ai_provenance_check',
      'payroll_generated_reports_ai_provenance_check',
      'aso_documents_ai_provenance_check',
      'project_schedule_imports_ai_provenance_check',
    ]) expect(migration).toContain(target);
  });
});

describe('deterministic operation with AI disabled', () => {
  it('preserves the payroll narrative fallback', async () => {
    process.env.APEX_AI_ENABLED = 'false';
    const parse: PayrollParseResult = {
      competence_month: '2026-08', total_amount_cents: 100_000,
      previous_month_amount_cents: 90_000, variation_amount_cents: 10_000,
      variation_percentage: 11.11, cost_centers: [], employees: [], bank_lines: [],
      comparison: {
        current_total_cents: 100_000, previous_total_cents: 90_000,
        variation_cents: 10_000, variation_percentage: 11.11,
        top_increases: [], top_decreases: [],
      }, flags: [],
      detected_sheets: ['Folha'], reconciled: true,
    };
    const result = await generatePayrollNarrative(parse, 'org-validated');
    expect(result.generated_by_ai).toBe(false);
    expect(result.executive_summary).toContain('2026-08');
    expect(result.ai_metadata).toBeUndefined();
  });
});
