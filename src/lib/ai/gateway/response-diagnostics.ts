/**
 * O que se pode dizer em voz alta sobre uma resposta de provedor.
 *
 * ─── O defeito que este módulo existe para corrigir ────────────────────────
 *
 * Uma operacionalização real de contrato rodou 313s, o provedor respondeu com
 * sucesso, e o Apex recusou o resultado porque o texto veio vazio. A recusa
 * estava certa. O que estava errado é que, naquele instante, TUDO que
 * permitiria explicar o vazio era descartado: o `stop_reason`, o consumo de
 * tokens e os tipos de bloco devolvidos só eram registrados no caminho de
 * SUCESSO, depois da validação que a chamada nunca alcançou.
 *
 * O resultado foi um diagnóstico impossível: sabia-se que veio vazio, e nada
 * mais. Não dava para distinguir "o orçamento de saída acabou antes do texto"
 * de "o texto veio num tipo de bloco que o adaptador não lê" — duas causas com
 * correções diferentes.
 *
 * ─── A linha que separa diagnóstico de vazamento ───────────────────────────
 *
 * Só FORMATO e CONTAGEM atravessam: quais tipos de bloco vieram, quantos eram
 * de texto, quantos caracteres ao todo, quantos tokens, por que parou. O
 * CONTEÚDO — raciocínio do modelo, JSON gerado, trecho de contrato, prompt,
 * PDF — nunca atravessa, em nenhum caminho, nem em log nem em persistência.
 *
 * A distinção não é de zelo, é de natureza: "vieram 2 blocos, tipos thinking e
 * text" descreve o ENVELOPE. "O contrato prevê multa de 2% ao mês" é o
 * conteúdo de um contrato de cliente, e conteúdo de contrato não vai para log
 * de infraestrutura por nenhum motivo.
 */

import type { ApexAIUsage } from './types';

/**
 * A forma da resposta, sem o conteúdo dela.
 *
 * Deliberadamente genérica: `contentBlockTypes` são strings porque o vocabulário
 * de blocos pertence a cada provedor, e o portão não deve aprender o de nenhum.
 */
export interface ApexAIResponseShape {
  /** Tipos dos blocos devolvidos, na ordem. Nunca o conteúdo deles. */
  readonly contentBlockTypes: readonly string[];
  /** Quantos blocos de texto vieram. Zero é exatamente o defeito a nomear. */
  readonly textBlockCount: number;
  /** Tamanho do texto concatenado, em caracteres. */
  readonly textLength: number;
}

/**
 * Tudo que se sabe, com segurança, sobre uma resposta que CHEGOU.
 *
 * Existe para o caminho de FALHA tanto quanto para o de sucesso: uma resposta
 * recusada é uma resposta que chegou, e recusá-la não é motivo para esquecer o
 * que ela dizia de si mesma.
 */
export interface ApexAIResponseDiagnostics {
  readonly stopReason: string | null;
  readonly usage: ApexAIUsage;
  readonly durationMs: number;
  readonly shape: ApexAIResponseShape;
}

/** Forma de uma resposta sobre a qual o adaptador não disse nada. */
export const UNKNOWN_RESPONSE_SHAPE: ApexAIResponseShape = {
  contentBlockTypes: [],
  textBlockCount: 0,
  textLength: 0,
};

/**
 * Descreve blocos de conteúdo por TIPO, e só.
 *
 * Recebe o formato mais frouxo possível de propósito — o adaptador entrega o
 * que o SDK dele devolveu, e nada aqui conhece o SDK de ninguém. Um bloco sem
 * `type` legível vira `'unknown'` em vez de arrastar o objeto junto.
 */
export function describeContentBlocks(
  blocks: readonly unknown[],
  text: string,
): ApexAIResponseShape {
  const contentBlockTypes = blocks.map((block) => {
    const type = (block as { type?: unknown } | null)?.type;
    return typeof type === 'string' ? type : 'unknown';
  });
  return {
    contentBlockTypes,
    textBlockCount: contentBlockTypes.filter((type) => type === 'text').length,
    textLength: text.length,
  };
}

/**
 * O diagnóstico como UMA linha legível, para log e para persistência.
 *
 * Ela acompanha a mensagem de erro porque log de hospedagem expira: o
 * diagnóstico da execução que motivou este módulo já não existia quando alguém
 * foi procurá-lo, algumas horas depois. O que está gravado ao lado da falha, na
 * linha da própria análise, sobrevive a isso.
 *
 * Nenhum termo daqui chega ao usuário: a interface de contratos nunca ecoa o
 * texto do erro — ela mostra uma mensagem de negócio constante e deixa o texto
 * técnico na persistência. Ver `src/lib/contracts/trust/analysis-errors.ts`.
 */
export function describeResponseDiagnostics(d: ApexAIResponseDiagnostics): string {
  const cacheRead = d.usage.cacheReadInputTokens ?? 0;
  const cacheWrite = d.usage.cacheCreationInputTokens ?? 0;
  return [
    `stop_reason=${d.stopReason ?? 'null'}`,
    `blocks=[${d.shape.contentBlockTypes.join(',') || 'none'}]`,
    `text_blocks=${d.shape.textBlockCount}`,
    `text_len=${d.shape.textLength}`,
    `in=${d.usage.inputTokens}`,
    `out=${d.usage.outputTokens}`,
    `cache_read=${cacheRead}`,
    `cache_write=${cacheWrite}`,
    `duration_ms=${d.durationMs}`,
  ].join(' ');
}
