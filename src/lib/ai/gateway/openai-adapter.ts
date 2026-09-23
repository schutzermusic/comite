if (typeof window !== 'undefined') {
  throw new Error('openai-adapter.ts must not be imported in the browser');
}

import OpenAI from 'openai';
import { ApexAIError } from './errors';
import type { ApexAIAdapterRequest, ApexAIAdapterResponse, OpenAIApexAdapter as OpenAIAdapterContract } from './types';

type ResponsesClient = Pick<OpenAI['responses'], 'create'>;

/** All OpenAI SDK details stay at this server-only provider boundary. */
export class OpenAIApexAdapter implements OpenAIAdapterContract {
  readonly provider = 'openai' as const;
  readonly capabilities = {
    structuredOutput: true,
    documentPdf: true,
    reasoningEffort: true,
    promptCache: false,
    streaming: false,
  } as const;

  private client: ResponsesClient | null = null;

  constructor(client?: ResponsesClient) {
    if (client) this.client = client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  private getClient(): ResponsesClient {
    if (!this.isConfigured()) {
      throw new ApexAIError('PROVIDER_NOT_CONFIGURED', 'OPENAI_API_KEY não está configurado.', false, {
        provider: this.provider,
      });
    }
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }).responses;
    return this.client;
  }

  async generate(request: ApexAIAdapterRequest, signal: AbortSignal): Promise<ApexAIAdapterResponse> {
    const response = await this.getClient().create({
      model: request.policy.model,
      instructions: request.systemPrompt,
      input: [{
        role: 'user',
        content: [
          ...(request.document ? [{
            type: 'input_file' as const,
            filename: 'document.pdf',
            file_data: `data:${request.document.mediaType};base64,${request.document.base64}`,
            detail: 'auto' as const,
          }] : []),
          { type: 'input_text' as const, text: request.userPrompt },
        ],
      }],
      max_output_tokens: request.policy.maxTokens,
      reasoning: { effort: request.policy.reasoningEffort },
      store: false,
      ...(request.structuredOutput ? { text: { format: {
        type: 'json_schema' as const,
        name: request.structuredOutput.name,
        schema: request.structuredOutput.schema,
        strict: true,
      } } } : {}),
    }, { signal });

    const text = response.output_text;
    const contentBlockTypes = response.output.flatMap((item): string[] => item.type === 'message'
      ? item.content.map((content) => content.type) : [item.type]);
    const refusal = response.output.some((item) => item.type === 'message'
      && item.content.some((content) => content.type === 'refusal'));
    const stopReason = refusal ? 'refusal'
      : response.status === 'incomplete'
        ? `incomplete:${response.incomplete_details?.reason ?? 'unknown'}`
        : response.status ?? null;

    return {
      text,
      stopReason,
      responseId: response.id,
      requestId: response._request_id ?? undefined,
      shape: {
        contentBlockTypes,
        textBlockCount: contentBlockTypes.filter((type) => type === 'output_text').length,
        textLength: text.length,
      },
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? undefined,
        cacheReadInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? undefined,
        cacheCreationInputTokens: response.usage?.input_tokens_details?.cache_write_tokens ?? undefined,
      },
    };
  }

  normalizeError(error: unknown): ApexAIError {
    if (error instanceof ApexAIError) return error;
    if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIUserAbortError
      || (error instanceof DOMException && error.name === 'AbortError')) {
      return new ApexAIError('TIMEOUT', 'O provedor de IA excedeu o tempo limite.', true,
        { provider: this.provider }, { cause: error });
    }
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      const code = status === 401 || status === 403 ? 'AUTHENTICATION'
        : status === 429 ? 'RATE_LIMIT'
          : status === 408 || status === 504 ? 'TIMEOUT'
            : status === 400 || status === 404 || status === 422 ? 'INVALID_REQUEST'
              : status === 409 ? 'PROVIDER_ERROR'
              : status === 503 || status === undefined ? 'PROVIDER_UNAVAILABLE'
                : status >= 500 ? 'PROVIDER_ERROR' : 'INVALID_REQUEST';
      const retryable = status === 408 || status === 409 || status === 429 || status >= 500 || status === undefined;
      return new ApexAIError(code, `OpenAI respondeu ${status ?? 'sem status'}.`, retryable,
        { provider: this.provider, status, requestId: error.requestID ?? undefined }, { cause: error });
    }
    return new ApexAIError('PROVIDER_ERROR', 'Falha inesperada no provedor OpenAI.', false,
      { provider: this.provider }, error instanceof Error ? { cause: error } : undefined);
  }
}
