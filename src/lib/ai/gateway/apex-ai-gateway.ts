if (typeof window !== 'undefined') {
  throw new Error('apex-ai-gateway.ts must not be imported in the browser');
}

import { ApexAIError } from './errors';
import {
  UNKNOWN_RESPONSE_SHAPE,
  describeResponseDiagnostics,
  type ApexAIResponseDiagnostics,
} from './response-diagnostics';
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

          /*
            ─── O QUE A RESPOSTA DIZ DE SI MESMA, ANTES DE JULGÁ-LA ──────────

            Uma execução real de operacionalização durou 313s, o provedor
            respondeu com sucesso, e o Apex recusou por texto vazio. A recusa
            estava certa; o que estava errado é que o `stop_reason`, o consumo
            de tokens e os tipos de bloco eram registrados só ADIANTE, no
            caminho de sucesso — que aquela chamada nunca alcançou. Sobrou
            "veio vazia", e nada com que explicar o vazio.

            O diagnóstico nasce aqui, entre RECEBER e VALIDAR, porque é o único
            ponto em que ele vale para os dois desfechos. Ele carrega formato e
            contagem; conteúdo do modelo, do contrato ou do prompt não entra —
            ver `./response-diagnostics.ts`.
          */
          const diagnostics: ApexAIResponseDiagnostics = {
            stopReason: raw.stopReason,
            usage: raw.usage,
            durationMs: Date.now() - startedAt,
            shape: raw.shape ?? UNKNOWN_RESPONSE_SHAPE,
          };
          const reject = (message: string, options?: ErrorOptions) => new ApexAIError(
            'INVALID_RESPONSE',
            `${message} [${describeResponseDiagnostics(diagnostics)}]`,
            false,
            { task: request.task, provider, diagnostics },
            options,
          );

          if (!raw.text.trim()) {
            /*
              Falha FECHADA: resposta vazia nunca é sucesso, e nada aqui tenta
              adivinhar o que o modelo queria dizer. O que mudou é só que a
              recusa passa a ser explicável.

              O diagnóstico vai junto na MENSAGEM, e não apenas no log, porque
              log de hospedagem expira: o da execução que motivou isto já não
              existia quando foram procurá-lo horas depois. Gravado ao lado da
              falha, na linha da própria análise, ele sobrevive. A interface
              nunca o exibe — ela mostra mensagem de negócio constante e deixa
              o texto técnico na persistência.
            */
            console.warn('[apex-ai-gateway] resposta vazia', JSON.stringify({
              task: request.task, provider, model: route.model, attempt, ...diagnostics,
            }));
            throw reject('Resposta da IA veio vazia.');
          }
          if (raw.stopReason === 'refusal') {
            throw reject('A análise foi recusada pela política do modelo.');
          }

          let output: unknown = raw.text;
          if (request.structuredOutput) {
            try {
              output = JSON.parse(raw.text);
            } catch (error) {
              // Mesmo tratamento: a resposta CHEGOU, e o que ela dizia de si
              // mesma é o que permite separar truncagem de saída malformada.
              throw reject(
                'A resposta estruturada da IA não é JSON válido.',
                error instanceof Error ? { cause: error } : undefined,
              );
            }
          }

          const provenance = {
            provider,
            model: route.model,
            task: request.task,
            usage: raw.usage,
            durationMs: diagnostics.durationMs,
            attempts: attempt,
          } as const;
          // A forma vai junto no log de sucesso: é a linha de base contra a
          // qual uma resposta vazia futura passa a ser comparável.
          console.info('[apex-ai-gateway]', JSON.stringify({ ...provenance, shape: diagnostics.shape }));
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
