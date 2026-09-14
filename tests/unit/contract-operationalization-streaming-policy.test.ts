/**
 * Regression proof for the CONTRACT_OPERATIONALIZATION long-request failure.
 *
 * The task ran with maxTokens 32_000 and stream:false. The Anthropic
 * TypeScript SDK refuses such a request before it ever leaves the process:
 *
 *   Client.calculateNonstreamingTimeout() estimates (60min * max_tokens)/128_000
 *   and throws "Streaming is required for operations that may take longer than
 *   10 minutes." as soon as that estimate passes 10 minutes — i.e. for any
 *   max_tokens above ~21_333.
 *
 * The fix is a TRANSPORT flag only: stream:true, so the adapter takes the
 * sdk.messages.stream(params, { signal }).finalMessage() branch it already
 * implements. Model, budget, risk posture, fallbacks and the structured output
 * contract are unchanged, and this file proves that.
 *
 * NO live Anthropic calls are made in this file.
 */
import { describe, expect, it } from 'vitest';
import { getApexAITaskPolicy, DEFAULT_PRODUCTION_MODEL } from '@/lib/ai/gateway/task-registry';
import { OPERATIONALIZATION_SCHEMA } from '@/lib/ai/contract-operationalization';

/** Mirror of the SDK guard in @anthropic-ai/sdk/src/client.ts. */
const SDK_NONSTREAMING_MAX_TOKENS = 128_000 / 6; // ≈ 21_333
const requiresStreaming = (maxTokens: number): boolean => maxTokens > SDK_NONSTREAMING_MAX_TOKENS;

describe('CONTRACT_OPERATIONALIZATION policy', () => {
  const policy = getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION');

  it('streams, because 32k output exceeds the SDK non-streaming ceiling', () => {
    expect(policy.maxTokens).toBe(32_000);
    expect(requiresStreaming(policy.maxTokens)).toBe(true);
    expect(policy.stream).toBe(true);
  });

  it('stays on Sonnet — streaming is not an excuse to change the model', () => {
    expect(DEFAULT_PRODUCTION_MODEL).toBe('claude-sonnet-5');
    expect(policy.model).toBe(DEFAULT_PRODUCTION_MODEL);
    expect(policy.provider).toBe('anthropic');
  });

  it('never falls back and keeps its high-risk posture', () => {
    expect(policy.fallbacks).toEqual([]);
    expect(policy.highRisk).toBe(true);
    /*
      'high' became 'medium' for this task alone. A real run returned
      successfully with no text block at all: under adaptive reasoning and a
      32k output ceiling, high effort is the variable competing hardest with
      the answer for that same ceiling, and an answer that never gets written
      is not a worse reading — it is no reading.

      The posture did not move: highRisk stays true, the model stays Sonnet,
      the output ceiling stays 32k, the timeout stays 450s, and reasoning stays
      ON — 'none' would switch it off, which is not the intent.
    */
    expect(policy.reasoningEffort).toBe('medium');
    expect(policy.reasoningEffort).not.toBe('none');
    /*
      180_000 became 450_000 when the verified Pro host ceiling moved from 300s
      to 600s. Only the clock changed: model, streaming, output ceiling,
      attempts and fallbacks are the ones asserted above and below, untouched.
      The budget that makes 450s safe lives in src/lib/platform/jobs/budget.ts,
      which cross-checks this number against the routes' own maxDuration.
    */
    expect(policy.timeoutMs).toBe(450_000);
  });

  it('leaves the structured output contract untouched', () => {
    expect(OPERATIONALIZATION_SCHEMA).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: { items: { type: 'array', items: expect.any(Object) } },
    });
  });
});

describe('CONTRACT_AMENDMENT_EXTRACTION policy', () => {
  const policy = getApexAITaskPolicy('CONTRACT_AMENDMENT_EXTRACTION');

  it('streams too: 24k output is also over the SDK ceiling', () => {
    expect(policy.maxTokens).toBe(24_000);
    expect(requiresStreaming(policy.maxTokens)).toBe(true);
    expect(policy.stream).toBe(true);
  });

  it('is otherwise unchanged', () => {
    expect(policy.model).toBe(DEFAULT_PRODUCTION_MODEL);
    expect(policy.highRisk).toBe(true);
    expect(policy.fallbacks).toEqual([]);
    expect(policy.timeoutMs).toBe(180_000);
  });
});

describe('tasks below the SDK ceiling', () => {
  it.each([
    ['CONTRACT_EXTRACTION', 16_000],
    ['CONTRACT_RISK_ANALYSIS', 4096],
    ['ASO_EXTRACTION', 1500],
  ] as const)('%s keeps stream:false', (task, maxTokens) => {
    const policy = getApexAITaskPolicy(task);
    expect(policy.maxTokens).toBe(maxTokens);
    expect(requiresStreaming(policy.maxTokens)).toBe(false);
    expect(policy.stream).toBe(false);
  });
});
