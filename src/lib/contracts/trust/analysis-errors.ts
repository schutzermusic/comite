/**
 * A falha de leitura do documento, dita em linguagem de negócio.
 *
 * Produção chegou a exibir, dentro do dossiê de um contrato real, o texto
 * literal de um erro de transporte do provedor — "Streaming is required for
 * operations that may take longer than 10 minutes…", com nome de SDK, arquivo
 * e link. Para quem opera o contrato isso não é informação: é ruído que só
 * comunica que algo quebrou por dentro, e expõe a implementação de quem lê o
 * documento.
 *
 * A regra deste módulo é de uma linha: **a interface nunca ecoa o texto do
 * erro técnico**. Não há lista de padrões a filtrar, porque filtrar por padrão
 * é uma corrida que se perde no primeiro erro novo — o próximo provedor, a
 * próxima versão, a próxima mensagem. A mensagem de negócio é constante, e o
 * texto técnico segue inteiro na persistência (`contract_ai_analyses.
 * error_message`), de onde log, auditoria e diagnóstico continuam lendo.
 *
 * Lógica pura, sem JSX.
 */

/** O que o usuário do contrato lê quando a leitura não terminou. */
export const ANALYSIS_FAILURE_MESSAGE = 'A leitura do documento não foi concluída.';

/** Convite à ação, quando a superfície tem espaço para ele. */
export const ANALYSIS_FAILURE_RETRY = 'Tente novamente.';

export const ANALYSIS_FAILURE_MESSAGE_WITH_RETRY =
  `${ANALYSIS_FAILURE_MESSAGE} ${ANALYSIS_FAILURE_RETRY}`;

/**
 * Mensagem segura para uma falha de análise.
 *
 * Recebe o erro cru só para saber se HOUVE erro — o conteúdo nunca atravessa.
 */
export function safeAnalysisFailureMessage(
  rawError: string | null | undefined,
  options: { withRetry?: boolean } = {},
): string | null {
  if (!rawError || !rawError.trim()) return null;
  return options.withRetry ? ANALYSIS_FAILURE_MESSAGE_WITH_RETRY : ANALYSIS_FAILURE_MESSAGE;
}

/**
 * Vocabulário que jamais pode aparecer na interface de contratos.
 *
 * Não é o filtro — é a REDE DE SEGURANÇA dos testes, que verificam que as
 * superfícies de negócio não contêm nenhum destes termos. A sanitização real
 * é não repassar o texto, acima.
 */
export const FORBIDDEN_UI_TERMS: readonly string[] = [
  'anthropic', 'claude', 'openai', 'sdk', 'streaming', 'stream',
  'client.ts', 'github.com', 'llm', 'model', 'token', 'api key',
];
