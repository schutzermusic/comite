import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { OpenAIApexAdapter } from '@/lib/ai/gateway/openai-adapter';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';
import { CONTRACT_ONBOARDING_EXTRACTION_SCHEMA } from '@/lib/contracts/onboarding/document-first';
import type { ApexAIAdapterRequest, ApexAIProviderAdapter } from '@/lib/ai/gateway/types';

const savedKey = process.env.OPENAI_API_KEY;
const savedModel = process.env.APEX_AI_OPENAI_MODEL;
const savedReasoning = process.env.APEX_AI_OPENAI_REASONING;
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.APEX_AI_OPENAI_MODEL;
  else process.env.APEX_AI_OPENAI_MODEL = savedModel;
  if (savedReasoning === undefined) delete process.env.APEX_AI_OPENAI_REASONING;
  else process.env.APEX_AI_OPENAI_REASONING = savedReasoning;
});

const request: ApexAIAdapterRequest = {
  organizationId: 'tenant-1', task: 'CONTRACT_EXTRACTION', systemPrompt: 'Read facts only',
  userPrompt: 'Extract evidence', document: { mediaType: 'application/pdf', base64: 'JVBERi0=' },
  structuredOutput: { name: 'contract_onboarding_extraction', schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA },
  policy: {
    provider: 'openai', model: 'gpt-6-luna', maxTokens: 16_000, timeoutMs: 120_000,
    maxAttempts: 2, reasoningEffort: 'low', promptCache: false, stream: false,
    highRisk: true, fallbacks: [],
  },
};

function stub() {
  const create = vi.fn().mockResolvedValue({
    id: 'resp_123', _request_id: 'req_456', status: 'completed', incomplete_details: null,
    output_text: '{"facts":[]}',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"facts":[]}' }] }],
    usage: { input_tokens: 100, output_tokens: 20,
      input_tokens_details: { cached_tokens: 30, cache_write_tokens: 4 },
      output_tokens_details: { reasoning_tokens: 8 } },
  });
  const adapter = new OpenAIApexAdapter({ create } as unknown as OpenAI['responses']);
  return { create, adapter };
}

describe('OpenAI Apex adapter', () => {
  it('implements the provider interface and detects a missing API key', async () => {
    const adapter: ApexAIProviderAdapter = new OpenAIApexAdapter();
    delete process.env.OPENAI_API_KEY;
    expect(adapter.provider).toBe('openai');
    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.generate(request, new AbortController().signal))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('translates PDF, schema, reasoning and non-retention, then normalizes usage', async () => {
    process.env.OPENAI_API_KEY = 'test-only';
    const { create, adapter } = stub();
    const result = await adapter.generate(request, new AbortController().signal);
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'gpt-6-luna', instructions: 'Read facts only', reasoning: { effort: 'low' },
      store: false, max_output_tokens: 16_000,
      text: { format: { type: 'json_schema', name: 'contract_onboarding_extraction',
        schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA, strict: true } },
    });
    expect(params.input[0].content[0]).toEqual({ type: 'input_file', filename: 'document.pdf',
      file_data: 'data:application/pdf;base64,JVBERi0=', detail: 'auto' });
    expect(params.input[0].content[1]).toEqual({ type: 'input_text', text: 'Extract evidence' });
    expect(result).toMatchObject({
      text: '{"facts":[]}', stopReason: 'completed', responseId: 'resp_123', requestId: 'req_456',
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 8,
        cacheReadInputTokens: 30, cacheCreationInputTokens: 4 },
    });
  });

  it('resolves the canary policy and carries diagnostics through the gateway', async () => {
    process.env.OPENAI_API_KEY = 'test-only';
    delete process.env.APEX_AI_OPENAI_MODEL;
    delete process.env.APEX_AI_OPENAI_REASONING;
    const policy = getApexAITaskPolicy('CONTRACT_EXTRACTION');
    expect(policy).toMatchObject({ provider: 'openai', model: 'gpt-6-luna',
      reasoningEffort: 'low', highRisk: true, fallbacks: [] });
    const { adapter } = stub();
    const result = await new ApexAIGateway([adapter]).generate({ ...request });
    expect(result.provenance).toMatchObject({ provider: 'openai', model: 'gpt-6-luna',
      responseId: 'resp_123', requestId: 'req_456',
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 8,
        cacheReadInputTokens: 30 } });
  });

  it('does not retry a deterministic schema request error', async () => {
    process.env.OPENAI_API_KEY = 'test-only';
    const { adapter, create } = stub();
    create.mockRejectedValue(new OpenAI.BadRequestError(400, {}, 'schema error', new Headers()));
    await expect(new ApexAIGateway([adapter]).generate({ ...request }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('maps deterministic 400 errors without retry and transient errors with retry', () => {
    const { adapter } = stub();
    const headers = new Headers({ 'x-request-id': 'req_400' });
    const bad = adapter.normalizeError(new OpenAI.BadRequestError(400, {}, 'schema error', headers));
    expect(bad).toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
    expect(bad.message).not.toContain('schema error');
    expect(adapter.normalizeError(new OpenAI.AuthenticationError(401, {}, 'bad key', headers)).code)
      .toBe('AUTHENTICATION');
    expect(adapter.normalizeError(new OpenAI.RateLimitError(429, {}, 'busy', headers)))
      .toMatchObject({ code: 'RATE_LIMIT', retryable: true });
    expect(adapter.normalizeError(new OpenAI.ConflictError(409, {}, 'conflict', headers)))
      .toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
    expect(adapter.normalizeError(new OpenAI.InternalServerError(503, {}, 'down', headers)))
      .toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(adapter.normalizeError(new OpenAI.APIConnectionTimeoutError({})))
      .toMatchObject({ code: 'TIMEOUT', retryable: true });
  });

  it('keeps tenant isolation before an OpenAI provider invocation', async () => {
    process.env.OPENAI_API_KEY = 'test-only';
    const { create, adapter } = stub();
    await expect(new ApexAIGateway([adapter]).generate({ ...request, organizationId: '' }))
      .rejects.toMatchObject({ code: 'INVALID_TENANT_CONTEXT' });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the secret server-side and uses the existing domain schema', () => {
    const root = process.cwd();
    const adapter = readFileSync(resolve(root, 'src/lib/ai/gateway/openai-adapter.ts'), 'utf8');
    const domain = readFileSync(resolve(root, 'src/lib/ai/contract-onboarding-extractor.ts'), 'utf8');
    const example = readFileSync(resolve(root, '.env.example'), 'utf8');
    expect(adapter).toContain("typeof window !== 'undefined'");
    expect(domain).toContain('CONTRACT_ONBOARDING_EXTRACTION_SCHEMA');
    expect(domain).not.toContain("from 'openai'");
    expect(adapter).not.toContain('CONTRACT_ONBOARDING_EXTRACTION_SCHEMA');
    expect(example).not.toContain('NEXT_PUBLIC_OPENAI_API_KEY');
  });
});
