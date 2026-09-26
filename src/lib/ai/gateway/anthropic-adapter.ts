if (typeof window !== 'undefined') {
  throw new Error('anthropic-adapter.ts must not be imported in the browser');
}

import Anthropic from '@anthropic-ai/sdk';
import { ApexAIError } from './errors';
import { describeContentBlocks } from './response-diagnostics';
import type {
  ApexAIAdapterRequest,
  ApexAIAdapterResponse,
  ApexAIProviderAdapter,
  ApexAISource,
  ApexAIWebSearch,
} from './types';

/** O pedaço do SDK que o adaptador usa — injetável para teste sem rede. */
export type AnthropicMessagesClient = Pick<Anthropic['messages'], 'create' | 'stream'>;

let client: Anthropic | null = null;

/** Teto absoluto de buscas por chamada, qualquer que seja a tarefa. */
const WEB_SEARCH_MAX_USES_CEILING = 10;

/**
 * A ferramenta de busca do SERVIDOR da Anthropic — só a busca; `web_fetch`
 * (ler uma página inteira) nunca é ligado aqui.
 *
 * A versão básica (`web_search_20250305`) e não a de filtragem dinâmica, de
 * propósito: na dinâmica, os resultados passam por uma execução de código no
 * provedor antes de chegar ao modelo, e a regra que protege quem usa o
 * resultado — "só vale candidato com fonte que a busca devolveu" — passaria a
 * depender de uma transcrição de código em vez dos blocos de resultado. Com a
 * básica, cada busca volta como `web_search_tool_result` com URL e título, e é
 * dali (e das citações do texto) que as fontes saem.
 */
function webSearchTool(search: ApexAIWebSearch): Anthropic.WebSearchTool20250305 {
  const domains = (list: string[] | undefined) => {
    const clean = (list ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
    return clean.length > 0 ? Array.from(new Set(clean)) : undefined;
  };
  const allowed = domains(search.allowedDomains);
  const blocked = domains(search.blockedDomains);
  const country = search.country?.trim().toUpperCase();
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: Math.min(Math.max(1, Math.trunc(search.maxUses)), WEB_SEARCH_MAX_USES_CEILING),
    ...(allowed ? { allowed_domains: allowed } : {}),
    ...(!allowed && blocked ? { blocked_domains: blocked } : {}),
    ...(country && /^[A-Z]{2}$/.test(country) ? { user_location: { type: 'approximate' as const, country } } : {}),
  };
}

/**
 * As fontes que a busca DEVOLVEU: cada resultado de `web_search_tool_result`
 * e cada citação `web_search_result_location` do texto. Endereço e título
 * apenas — o conteúdo (criptografado ou citado) não atravessa. Sem repetição,
 * na ordem em que apareceram.
 */
export function extractWebSources(blocks: readonly Anthropic.ContentBlock[]): { sources: ApexAISource[]; errors: string[] } {
  const byUrl = new Map<string, ApexAISource>();
  const errors: string[] = [];
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return;
    const key = url.trim();
    const cleanTitle = typeof title === 'string' && title.trim() ? title.trim() : null;
    const seen = byUrl.get(key);
    if (!seen) byUrl.set(key, { url: key, title: cleanTitle });
    else if (!seen.title && cleanTitle) seen.title = cleanTitle;
  };
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result') {
      // Sucesso = lista de resultados; falha = UM objeto de erro (HTTP 200, sem exceção).
      if (Array.isArray(block.content)) {
        for (const result of block.content) add(result.url, result.title);
      } else if (block.content && typeof block.content === 'object') {
        errors.push(String((block.content as { error_code?: unknown }).error_code ?? 'unknown'));
      }
    } else if (block.type === 'text') {
      for (const citation of block.citations ?? []) {
        if (citation.type === 'web_search_result_location') add(citation.url, citation.title);
      }
    }
  }
  return { sources: Array.from(byUrl.values()), errors };
}

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
    webSearch: true,
  } as const;

  /** Cliente injetado (testes). Ausente = o cliente do SDK, criado sob demanda com a chave do ambiente. */
  private readonly injected: AnthropicMessagesClient | null;

  constructor(messages?: AnthropicMessagesClient) {
    this.injected = messages ?? null;
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async generate(request: ApexAIAdapterRequest, signal: AbortSignal): Promise<ApexAIAdapterResponse> {
    if (request.webSearch && request.structuredOutput) {
      // O portão já recusa; a guarda existe para quem chamar o adaptador direto.
      throw new ApexAIError('INVALID_REQUEST', 'Busca na internet não se combina com saída estruturada.', false,
        { provider: this.provider, task: request.task });
    }
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
    if (request.webSearch) {
      params.tools = [webSearchTool(request.webSearch)];
      // Sem saída estruturada o esforço não viajava; na busca ele viaja, para a política valer.
      if (request.policy.reasoningEffort !== 'none') params.output_config = { effort: request.policy.reasoningEffort };
    }

    const messages = this.injected ?? getClient().messages;
    const response = request.policy.stream
      ? await messages.stream(params, { signal }).finalMessage()
      : await messages.create(params, { signal });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const web = request.webSearch ? extractWebSources(response.content) : null;
    const webSearchRequests = response.usage.server_tool_use?.web_search_requests;

    return {
      ...(web ? { sources: web.sources, ...(web.errors.length ? { searchErrors: web.errors } : {}) } : {}),
      text,
      /*
        A FORMA do que veio, para o caso de `text` estar vazio.

        Uma operacionalização real respondeu com sucesso e sem nenhum bloco de
        texto, e o portão só sabia dizer "veio vazia" — porque o `stop_reason`
        e o consumo de tokens eram registrados apenas no caminho de sucesso.
        Descrever os TIPOS de bloco aqui é o que permite distinguir "o
        orçamento de saída acabou antes do texto" de "o texto veio num bloco
        que este filtro não lê".

        `describeContentBlocks` recebe os blocos e devolve só tipos e
        contagens: nenhum conteúdo do modelo, do contrato ou do prompt
        atravessa esta fronteira.
      */
      shape: describeContentBlocks(response.content, text),
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
        ...(request.webSearch && typeof webSearchRequests === 'number' ? { webSearchRequests } : {}),
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
