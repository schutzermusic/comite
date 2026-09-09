if (typeof window !== 'undefined') {
  throw new Error('anthropic-adapter.ts must not be imported in the browser');
}

import Anthropic from '@anthropic-ai/sdk';
import { ApexAIError } from './errors';
import type {
  ApexAIAdapterRequest,
  ApexAIAdapterResponse,
  ApexAIProviderAdapter,
} from './types';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ApexAIError(
      'PROVIDER_NOT_CONFIGURED',
      'ANTHROPIC_API_KEY não está configurado; a capacidade de IA está indisponível.',
      false,
      { provider: 'anthropic' },
    );
  }
  client ??= new Anthropic({ apiKey, maxRetries: 0 });
  return client;
}

export class AnthropicApexAdapter implements ApexAIProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly capabilities = {
    structuredOutput: true,
    documentPdf: true,
    reasoningEffort: true,
    promptCache: true,
    streaming: true,
  } as const;

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async generate(request: ApexAIAdapterRequest, signal: AbortSignal): Promise<ApexAIAdapterResponse> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.policy.model,
      max_tokens: request.policy.maxTokens,
      thinking: request.policy.reasoningEffort === 'none' ? { type: 'disabled' } : { type: 'adaptive' },
      messages: [{
        role: 'user',
        content: [
          ...(request.document ? [{
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: request.document.mediaType,
              data: request.document.base64,
            },
          }] : []),
          { type: 'text' as const, text: request.userPrompt },
        ],
      }],
    };

    if (request.systemPrompt) {
      params.system = [{
        type: 'text',
        text: request.systemPrompt,
        ...(request.policy.promptCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }];
    }
    if (request.structuredOutput) {
      params.output_config = {
        effort: request.policy.reasoningEffort === 'none' ? undefined : request.policy.reasoningEffort,
        format: { type: 'json_schema', schema: request.structuredOutput.schema },
      };
    }

    const sdk = getClient();
    const response = request.policy.stream
      ? await sdk.messages.stream(params, { signal }).finalMessage()
      : await sdk.messages.create(params, { signal });

    return {
      text: response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
      },
    };
  }

  normalizeError(error: unknown): ApexAIError {
    if (error instanceof ApexAIError) return error;
    if (
      (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && /abort/i.test(`${error.name} ${error.message}`))
    ) {
      return new ApexAIError('TIMEOUT', 'O provedor de IA excedeu o tempo limite.', true, { provider: this.provider }, { cause: error });
    }
    if (error instanceof Anthropic.APIError) {
      const status = error.status;
      const code = status === 401 || status === 403
        ? 'AUTHENTICATION'
        : status === 429
          ? 'RATE_LIMIT'
          : status >= 500
            ? 'PROVIDER_UNAVAILABLE'
            : 'PROVIDER_ERROR';
      return new ApexAIError(
        code,
        `Anthropic respondeu ${status}: ${error.message}`,
        status === 408 || status === 409 || status === 429 || status >= 500,
        { provider: this.provider, status },
        { cause: error },
      );
    }
    return new ApexAIError(
      'PROVIDER_ERROR',
      error instanceof Error ? error.message : 'Falha inesperada no provedor Anthropic.',
      false,
      { provider: this.provider },
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}
