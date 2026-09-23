/**
 * A resposta que chega vazia — recusada, e desta vez explicável.
 *
 * Uma operacionalização real de contrato rodou 313s, o provedor respondeu com
 * sucesso, e o Apex recusou porque o texto veio vazio. A recusa estava certa. O
 * que estava errado é que, naquele instante, tudo que permitiria EXPLICAR o
 * vazio — `stop_reason`, consumo de tokens, tipos de bloco — era registrado só
 * no caminho de sucesso, depois da validação que a chamada nunca alcançou.
 *
 * Restou "veio vazia", e duas causas possíveis indistinguíveis: o orçamento de
 * saída ter acabado antes do texto, ou o texto ter vindo num tipo de bloco que
 * o adaptador não lê. Correções diferentes, mesma mensagem.
 *
 * O que este arquivo guarda são as duas metades do conserto: que a recusa
 * continua FECHADA, e que ela passa a carregar formato e contagem suficientes
 * para nomear a causa — sem que nenhum conteúdo de modelo, contrato ou prompt
 * atravesse junto.
 *
 * Nenhuma chamada viva: todo provedor aqui é falso.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import { ApexAIError } from '@/lib/ai/gateway/errors';
import {
  describeContentBlocks, describeResponseDiagnostics, UNKNOWN_RESPONSE_SHAPE,
} from '@/lib/ai/gateway/response-diagnostics';
import { getApexAITaskPolicy, DEFAULT_PRODUCTION_MODEL } from '@/lib/ai/gateway';
import type {
  ApexAIAdapterRequest, ApexAIAdapterResponse, ApexAIProviderAdapter,
} from '@/lib/ai/gateway/types';

// ── Segredos de verdade que NENHUM caminho de diagnóstico pode tocar ──
const THINKING = 'O contrato prevê multa de 2% ao mês sobre o saldo em atraso.';
const CONTRACT_JSON = '{"obrigacoes":[{"titulo":"Seguro de risco de engenharia"}]}';
const PROMPT = 'Leia o contrato JA10182283 e estruture as obrigações.';
const PDF_B64 = 'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoK';

class ScriptedAdapter implements ApexAIProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly capabilities = {
    structuredOutput: true, documentPdf: true, reasoningEffort: true,
    promptCache: true, streaming: true,
  } as const;
  constructor(private readonly response: ApexAIAdapterResponse) {}
  isConfigured() { return true; }
  async generate(_r: ApexAIAdapterRequest, _s: AbortSignal) { return this.response; }
  normalizeError(error: unknown) {
    return error instanceof ApexAIError ? error : new ApexAIError('PROVIDER_ERROR', String(error), false);
  }
}

const run = (response: ApexAIAdapterResponse, structured = true) =>
  new ApexAIGateway([new ScriptedAdapter(response)]).generate({
    organizationId: 'org-validada',
    task: 'CONTRACT_OPERATIONALIZATION',
    userPrompt: PROMPT,
    document: { mediaType: 'application/pdf', base64: PDF_B64 },
    ...(structured ? { structuredOutput: { name: 'op', schema: { type: 'object' } } } : {}),
  });

const caught = async (p: Promise<unknown>): Promise<ApexAIError> => {
  try { await p; } catch (error) { return error as ApexAIError; }
  throw new Error('esperava uma recusa, e a chamada passou');
};

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════════════════════════════════════
// A · A política desta tarefa, e só dela
// ══════════════════════════════════════════════════════════════════════════
describe('CONTRACT_OPERATIONALIZATION — o esforço baixou, a postura não', () => {
  const policy = getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION');

  it('raciocina com esforço médio, e continua raciocinando', () => {
    expect(policy.reasoningEffort).toBe('medium');
    // 'none' desligaria o raciocínio — não é isso que se quer. O que muda é o
    // orçamento entre pensar e responder dentro do mesmo teto de saída.
    expect(policy.reasoningEffort).not.toBe('none');
  });

  it('tudo o mais permanece exatamente como estava', () => {
    expect(policy.highRisk).toBe(true);
    expect(policy.model).toBe(DEFAULT_PRODUCTION_MODEL);
    expect(policy.model).toBe('claude-sonnet-5');
    expect(policy.maxTokens).toBe(32_000);
    expect(policy.timeoutMs).toBe(450_000);
    expect(policy.stream).toBe(true);
    expect(policy.maxAttempts).toBe(1);
    expect(policy.fallbacks).toEqual([]);
  });

  it('nenhuma outra tarefa de alto risco foi arrastada junto', () => {
    for (const task of ['CONTRACT_AMENDMENT_EXTRACTION'] as const) {
      const other = getApexAITaskPolicy(task);
      expect(other.reasoningEffort, task).toBe('high');
      expect(other.highRisk, task).toBe(true);
    }
    // A extração de cláusulas segue com o seu próprio tempo e teto.
    expect(getApexAITaskPolicy('CONTRACT_EXTRACTION').timeoutMs).toBe(120_000);
    expect(getApexAITaskPolicy('CONTRACT_AMENDMENT_EXTRACTION').timeoutMs).toBe(180_000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B · O adaptador descreve a forma, nunca o conteúdo
// ══════════════════════════════════════════════════════════════════════════
describe('a forma de uma resposta', () => {
  it('captura tipos de bloco, contagem de texto e tamanho', () => {
    const shape = describeContentBlocks(
      [{ type: 'thinking', thinking: THINKING }, { type: 'text', text: CONTRACT_JSON }],
      CONTRACT_JSON,
    );
    expect(shape.contentBlockTypes).toEqual(['thinking', 'text']);
    expect(shape.textBlockCount).toBe(1);
    expect(shape.textLength).toBe(CONTRACT_JSON.length);
  });

  it('um bloco sem tipo legível vira "unknown", e não arrasta o objeto junto', () => {
    const shape = describeContentBlocks([{ segredo: THINKING }, null, { type: 7 }], '');
    expect(shape.contentBlockTypes).toEqual(['unknown', 'unknown', 'unknown']);
    expect(JSON.stringify(shape)).not.toContain('segredo');
    expect(JSON.stringify(shape)).not.toContain(THINKING);
  });

  it('a descrição não contém NADA do conteúdo descrito', () => {
    const shape = describeContentBlocks(
      [{ type: 'thinking', thinking: THINKING }, { type: 'text', text: CONTRACT_JSON }],
      CONTRACT_JSON,
    );
    const serialized = JSON.stringify(shape);
    for (const secret of [THINKING, CONTRACT_JSON, 'multa', 'Seguro']) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('o adaptador Anthropic monta a forma a partir do que o SDK devolveu', () => {
    // Sem rede: a montagem é a mesma função pura, alimentada com a estrutura
    // de blocos que o SDK produz.
    const content = [
      { type: 'thinking', thinking: THINKING },
      { type: 'text', text: '{"a":1}' },
      { type: 'text', text: '{"b":2}' },
    ];
    const text = '{"a":1}{"b":2}';
    expect(describeContentBlocks(content, text)).toEqual({
      contentBlockTypes: ['thinking', 'text', 'text'],
      textBlockCount: 2,
      textLength: 14,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C · Vazio por estouro do teto de saída
// ══════════════════════════════════════════════════════════════════════════
describe('resposta vazia com stop_reason = max_tokens', () => {
  const EMPTY_MAX_TOKENS: ApexAIAdapterResponse = {
    text: '',
    stopReason: 'max_tokens',
    usage: { inputTokens: 91_204, outputTokens: 32_000, cacheReadInputTokens: 88_000 },
    shape: { contentBlockTypes: ['thinking'], textBlockCount: 0, textLength: 0 },
  };

  it('falha FECHADA: vazio nunca vira sucesso', async () => {
    const error = await caught(run(EMPTY_MAX_TOKENS));
    expect(error).toBeInstanceOf(ApexAIError);
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Resposta da IA veio vazia.');
  });

  it('o motivo da parada sobrevive à recusa', async () => {
    const error = await caught(run(EMPTY_MAX_TOKENS));
    expect(error.context.diagnostics?.stopReason).toBe('max_tokens');
    expect(error.message).toContain('stop_reason=max_tokens');
  });

  it('o consumo de tokens sobrevive à recusa', async () => {
    const error = await caught(run(EMPTY_MAX_TOKENS));
    expect(error.context.diagnostics?.usage.outputTokens).toBe(32_000);
    expect(error.context.diagnostics?.usage.inputTokens).toBe(91_204);
    expect(error.context.diagnostics?.usage.cacheReadInputTokens).toBe(88_000);
    expect(error.message).toContain('out=32000');
  });

  it('os TIPOS de bloco sobrevivem, e dizem que não houve texto', async () => {
    const error = await caught(run(EMPTY_MAX_TOKENS));
    expect(error.context.diagnostics?.shape.contentBlockTypes).toEqual(['thinking']);
    expect(error.context.diagnostics?.shape.textBlockCount).toBe(0);
    expect(error.message).toContain('blocks=[thinking]');
    expect(error.message).toContain('text_blocks=0');
  });

  it('a duração da chamada sobrevive', async () => {
    const error = await caught(run(EMPTY_MAX_TOKENS));
    expect(error.context.diagnostics?.durationMs).toBeGreaterThanOrEqual(0);
    expect(error.message).toContain('duration_ms=');
  });

  it('o vazio é registrado como aviso, com diagnóstico e sem conteúdo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await caught(run(EMPTY_MAX_TOKENS));
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].join(' ');
    expect(logged).toContain('resposta vazia');
    expect(logged).toContain('max_tokens');
    expect(logged).toContain('CONTRACT_OPERATIONALIZATION');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D · Vazio SEM estouro — a outra causa, agora distinguível
// ══════════════════════════════════════════════════════════════════════════
describe('resposta vazia com parada limpa', () => {
  const EMPTY_CLEAN: ApexAIAdapterResponse = {
    text: '',
    stopReason: 'end_turn',
    usage: { inputTokens: 91_204, outputTokens: 512 },
    shape: { contentBlockTypes: ['thinking', 'tool_use'], textBlockCount: 0, textLength: 0 },
  };

  it('também falha fechada', async () => {
    const error = await caught(run(EMPTY_CLEAN));
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.retryable).toBe(false);
  });

  it('o diagnóstico SEPARA as duas causas — é para isto que ele existe', async () => {
    const error = await caught(run(EMPTY_CLEAN));
    const d = error.context.diagnostics;
    // Parou limpo e gastou pouco: não foi o teto de saída. O texto veio — ou
    // deixou de vir — num tipo de bloco que o adaptador não concatena.
    expect(d?.stopReason).toBe('end_turn');
    expect(d?.stopReason).not.toBe('max_tokens');
    expect(d?.usage.outputTokens).toBe(512);
    expect(d?.shape.contentBlockTypes).toContain('tool_use');
    expect(error.message).toContain('blocks=[thinking,tool_use]');
  });

  it('sem forma declarada, o portão assume desconhecida em vez de quebrar', async () => {
    const error = await caught(run({
      text: '', stopReason: null, usage: { inputTokens: 1, outputTokens: 0 },
    }));
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.context.diagnostics?.shape).toEqual(UNKNOWN_RESPONSE_SHAPE);
    expect(error.message).toContain('blocks=[none]');
    expect(error.message).toContain('stop_reason=null');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E · A fronteira que o diagnóstico não atravessa
// ══════════════════════════════════════════════════════════════════════════
describe('formato e contagem atravessam; conteúdo nunca', () => {
  const SECRETS = [THINKING, CONTRACT_JSON, PROMPT, PDF_B64, 'multa', 'Seguro'];

  const LEAKY: ApexAIAdapterResponse = {
    text: '',
    stopReason: 'max_tokens',
    usage: { inputTokens: 91_204, outputTokens: 32_000 },
    shape: { contentBlockTypes: ['thinking'], textBlockCount: 0, textLength: 0 },
  };

  it('nada do conteúdo chega à mensagem nem ao contexto do erro', async () => {
    const error = await caught(run(LEAKY));
    const exposed = `${error.message} ${JSON.stringify(error.context)}`;
    for (const secret of SECRETS) expect(exposed, secret).not.toContain(secret);
  });

  it('nada do conteúdo chega ao log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await caught(run(LEAKY));
    const logged = [...warn.mock.calls, ...info.mock.calls].flat().join(' ');
    for (const secret of SECRETS) expect(logged, secret).not.toContain(secret);
    // Nem o PDF, nem o prompt, em nenhuma forma.
    expect(logged).not.toContain('base64');
    expect(logged).not.toContain('userPrompt');
  });

  it('a linha de diagnóstico é só números, tipos e o motivo da parada', () => {
    const line = describeResponseDiagnostics({
      stopReason: 'max_tokens',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40 },
      durationMs: 313_211,
      shape: { contentBlockTypes: ['thinking'], textBlockCount: 0, textLength: 0 },
    });
    expect(line).toBe(
      'stop_reason=max_tokens blocks=[thinking] text_blocks=0 text_len=0 '
      + 'in=10 out=20 cache_read=30 cache_write=40 duration_ms=313211',
    );
    for (const secret of SECRETS) expect(line, secret).not.toContain(secret);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F · O caminho de sucesso, intacto
// ══════════════════════════════════════════════════════════════════════════
describe('uma resposta boa continua sendo uma resposta boa', () => {
  const GOOD: ApexAIAdapterResponse = {
    text: '{"itens":[]}',
    stopReason: 'end_turn',
    usage: { inputTokens: 91_204, outputTokens: 8_140, cacheReadInputTokens: 88_000 },
    shape: { contentBlockTypes: ['thinking', 'text'], textBlockCount: 1, textLength: 12 },
  };

  it('o JSON estruturado é parseado e devolvido', async () => {
    const result = await run(GOOD);
    expect(result.output).toEqual({ itens: [] });
    expect(result.text).toBe('{"itens":[]}');
  });

  it('o motivo da parada e o consumo continuam na proveniência', async () => {
    const result = await run(GOOD);
    expect(result.stopReason).toBe('end_turn');
    expect(result.provenance.usage.outputTokens).toBe(8_140);
    expect(result.provenance.usage.cacheReadInputTokens).toBe(88_000);
    expect(result.provenance.attempts).toBe(1);
    expect(result.provenance.model).toBe('claude-sonnet-5');
    expect(result.provenance.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('o log de sucesso ganha a forma, sem ganhar conteúdo', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await run(GOOD);
    const logged = info.mock.calls.flat().join(' ');
    expect(logged).toContain('"textBlockCount":1');
    expect(logged).toContain('"contentBlockTypes":["thinking","text"]');
    expect(logged).not.toContain('itens');
  });

  it('texto não estruturado continua passando sem parse', async () => {
    const result = await run({ ...GOOD, text: 'um resumo em prosa' }, false);
    expect(result.output).toBe('um resumo em prosa');
  });

  it('JSON inválido continua sendo recusado — agora com diagnóstico', async () => {
    const error = await caught(run({ ...GOOD, text: 'isto não é json' }));
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.message).toContain('não é JSON válido');
    expect(error.context.diagnostics?.stopReason).toBe('end_turn');
    expect(error.context.diagnostics?.usage.outputTokens).toBe(8_140);
  });

  it('uma recusa de política continua recusada, e explicável', async () => {
    const error = await caught(run({ ...GOOD, text: 'desculpe', stopReason: 'refusal' }));
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.message).toContain('recusada pela política do modelo');
    expect(error.context.diagnostics?.stopReason).toBe('refusal');
  });
});
