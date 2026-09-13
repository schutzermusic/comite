/**
 * Orçamento de execução, declarado UMA vez.
 *
 * ─── O defeito que estes números existem para impedir ──────────────────────
 *
 * Uma função serverless tem um tempo de vida imposto pela hospedagem. Quando o
 * trabalho que roda dentro dela pode, na pior hipótese, durar mais que esse
 * tempo, o desfecho não é uma falha da aplicação: é o processo deixando de
 * existir. Nada é gravado, porque não sobrou ninguém para gravar — a análise
 * fica eternamente `running`, o trabalho fica eternamente `PROCESSING`, e o
 * diagnóstico some junto com o processo.
 *
 * Uma execução real gastou ~232s na primeira etapa de provedor e começou a
 * segunda com ~66s de vida restante. A segunda etapa pedia até 180s. O host
 * matou a execução. Nenhum caminho de `catch` rodou, porque o `catch` também
 * estava dentro do processo morto.
 *
 * ─── O invariante ──────────────────────────────────────────────────────────
 *
 *   pior caso do provedor  +  persistência/limpeza  <  teto da hospedagem
 *
 * E, como o trabalhador reivindica trabalho em laço, mais um:
 *
 *   instante da última reivindicação  +  pior caso do trabalho  <  teto
 *
 * Os dois são verificados em teste contra a política real da tarefa e contra o
 * `maxDuration` real das rotas. Números que só vivem em comentário envelhecem
 * em silêncio; estes falham a suíte quando alguém os desequilibra.
 *
 * ─── O que NÃO é solução ───────────────────────────────────────────────────
 *
 * Encurtar `maxTokens` para a resposta caber no tempo seria esconder um
 * problema de infraestrutura atrás de uma leitura truncada — e uma leitura
 * truncada de contrato tem exatamente a mesma aparência de uma completa.
 */

/**
 * Teto EFETIVO de duração da função, em segundos.
 *
 * 300s é o máximo suportado em todos os planos da Vercel para funções Node.js,
 * e é declarado explicitamente em cada rota que pode acionar o trabalhador. A
 * aplicação não depende de um padrão não documentado da hospedagem: quando a
 * rota não diz o seu tempo de vida, ninguém consegue afirmar que o orçamento
 * cabe dentro dele.
 */
export const HOST_MAX_DURATION_SECONDS = 300;

/**
 * Tempo limite de UMA tentativa de provedor na etapa longa (operacionalização).
 * Espelha `getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION').timeoutMs`; o
 * teste cruza os dois para que nunca divirjam.
 */
export const LONG_PROVIDER_TIMEOUT_MS = 180_000;

/**
 * Tentativas de provedor DENTRO de uma invocação. Uma, e por decisão.
 *
 * Duas tentativas de 180s são 360s teóricos dentro de uma função que vive 300s:
 * a segunda tentativa seria, por construção, morta pelo host. A repetição da
 * etapa longa existe — mas no nível do TRABALHO, onde cada tentativa ganha uma
 * invocação inteira e um tempo de vida novo, e não empilhada dentro da mesma.
 */
export const LONG_PROVIDER_MAX_ATTEMPTS = 1;

/**
 * Margem para o que acontece DEPOIS do provedor: normalização, gate de
 * confiança, escrita das interpretações, materialização e fecho do pedido
 * durável. É folga de persistência, não de rede.
 */
export const PERSISTENCE_MARGIN_MS = 45_000;

/** Pior caso de UMA execução da etapa longa, de ponta a ponta. */
export const LONG_JOB_WORST_CASE_MS =
  LONG_PROVIDER_TIMEOUT_MS * LONG_PROVIDER_MAX_ATTEMPTS + PERSISTENCE_MARGIN_MS;

/**
 * A concessão do trabalho, em segundos.
 *
 * Tem de cobrir o pior caso inteiro — provedor, persistência e limpeza — ou a
 * ceifa devolveria à fila um trabalho que ainda está legitimamente rodando, e
 * dois trabalhadores fariam a mesma operacionalização ao mesmo tempo.
 *
 * A concessão NÃO substitui o `maxDuration` da hospedagem: ela protege a fila
 * de um trabalho abandonado, e não a execução de ser morta. Alongá-la sem
 * alongar o tempo de vida da função só faria o trabalho ficar invisível por
 * mais tempo depois de morto.
 */
export const JOB_LEASE_SECONDS = 300;

/**
 * O último instante, dentro da passagem, em que ainda é seguro reivindicar
 * trabalho: depois dele, o pior caso não caberia mais no tempo de vida.
 */
export const LATEST_SAFE_CLAIM_MS =
  HOST_MAX_DURATION_SECONDS * 1000 - LONG_JOB_WORST_CASE_MS;

/**
 * O orçamento da passagem cabe no tempo de vida?
 *
 * `timeBudgetMs` é o instante em que o trabalhador PARA de reivindicar. Um
 * trabalho reivindicado no limite ainda roda o seu pior caso inteiro depois
 * disso — é essa soma que precisa caber, e não o orçamento sozinho.
 */
export function drainBudgetFitsHost(timeBudgetMs: number): boolean {
  return timeBudgetMs + LONG_JOB_WORST_CASE_MS < HOST_MAX_DURATION_SECONDS * 1000;
}
