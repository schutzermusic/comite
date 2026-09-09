if (typeof window !== 'undefined') {
  throw new Error('apex-ai-gateway.ts must not be imported in the browser');
}

import { ApexAIError } from './errors';
import { getApexAITaskPolicy } from './task-registry';
import type {
  ApexAICapabilities,
  ApexAIProvider,
  ApexAIProviderAdapter,
  ApexAIRequest,
  ApexAIResponse,
} from './types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApexAIGateway {
  private readonly adapters = new Map<ApexAIProvider, ApexAIProviderAdapter>();

  constructor(adapters: readonly ApexAIProviderAdapter[]) {
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }

  async generate<T = unknown>(request: ApexAIRequest): Promise<ApexAIResponse<T>> {
    if (process.env.APEX_AI_ENABLED?.toLowerCase() === 'false') {
      throw new ApexAIError('AI_DISABLED', 'Apex AI Gateway está desabilitado.', false, { task: request.task });
    }
    if (!request.organizationId?.trim()) {
      throw new ApexAIError(
        'INVALID_TENANT_CONTEXT',
        'organizationId validado no servidor é obrigatório para chamadas de IA.',
        false,
        { task: request.task },
      );
    }

    const policy = getApexAITaskPolicy(request.task);
    const routes = [{ provider: policy.provider, model: policy.model }, ...policy.fallbacks];
    let lastError: ApexAIError | null = null;

    for (const route of routes) {
      const { provider } = route;
      const adapter = this.adapters.get(provider);
      if (!adapter || !adapter.isConfigured()) {
        lastError = new ApexAIError(
          'PROVIDER_NOT_CONFIGURED',
          `Provedor ${provider} não está configurado para ${request.task}.`,
          false,
          { task: request.task, provider },
        );
        continue;
      }
      this.assertCapabilities(adapter.capabilities, request, policy);

      for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
        try {
          const raw = await adapter.generate({
            ...request,
            policy: { ...policy, provider, model: route.model },
          }, controller.signal);
          if (!raw.text.trim()) {
            throw new ApexAIError('INVALID_RESPONSE', 'Resposta da IA veio vazia.', false, {
              task: request.task,
              provider,
            });
          }
          if (raw.stopReason === 'refusal') {
            throw new ApexAIError('INVALID_RESPONSE', 'A análise foi recusada pela política do modelo.', false, {
              task: request.task,
              provider,
            });
          }

          let output: unknown = raw.text;
          if (request.structuredOutput) {
            try {
              output = JSON.parse(raw.text);
            } catch (error) {
              throw new ApexAIError(
                'INVALID_RESPONSE',
                'A resposta estruturada da IA não é JSON válido.',
                false,
                { task: request.task, provider },
                error instanceof Error ? { cause: error } : undefined,
              );
            }
          }

          const provenance = {
            provider,
            model: route.model,
            task: request.task,
            usage: raw.usage,
            durationMs: Date.now() - startedAt,
            attempts: attempt,
          } as const;
          console.info('[apex-ai-gateway]', JSON.stringify(provenance));
          return { text: raw.text, output: output as T, stopReason: raw.stopReason, provenance };
        } catch (error) {
          lastError = error instanceof ApexAIError ? error : adapter.normalizeError(error);
          if (!lastError.retryable || attempt === policy.maxAttempts) break;
          await sleep(Math.min(250 * (2 ** (attempt - 1)), 1000));
        } finally {
          clearTimeout(timer);
        }
      }

      // A provider change can only happen when the task policy explicitly lists one.
    }

    throw lastError ?? new ApexAIError('PROVIDER_NOT_CONFIGURED', 'Nenhum provedor de IA disponível.', false, {
      task: request.task,
    });
  }

  private assertCapabilities(
    capabilities: ApexAICapabilities,
    request: ApexAIRequest,
    policy: ReturnType<typeof getApexAITaskPolicy>,
  ): void {
    const missing = request.document && !capabilities.documentPdf
      ? 'documentPdf'
      : request.structuredOutput && !capabilities.structuredOutput
        ? 'structuredOutput'
        : policy.reasoningEffort !== 'none' && !capabilities.reasoningEffort
          ? 'reasoningEffort'
          : policy.promptCache && !capabilities.promptCache
            ? 'promptCache'
            : policy.stream && !capabilities.streaming
              ? 'streaming'
              : null;
    if (missing) {
      throw new ApexAIError(
        'CAPABILITY_UNSUPPORTED',
        `O provedor não suporta a capacidade ${missing} exigida por ${request.task}.`,
        false,
        { task: request.task },
      );
    }
  }
}
