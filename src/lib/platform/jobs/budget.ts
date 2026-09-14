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
 * Depois disso, com as etapas já separadas, a operacionalização de JA10182283
 * parou em 180,2s — desta vez no tempo limite da APLICAÇÃO, com estado terminal
 * escrito e diagnóstico preservado. É a diferença entre os dois desfechos que
 * estes números guardam.
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
 * Teto de duração que ESTA aplicação configura, em segundos.
 *
 * ─── O que este número é, e o que ele não é ────────────────────────────────
 *
 * É a nossa ESCOLHA, declarada explicitamente em cada rota que pode acionar o
 * trabalhador. Não é o máximo da plataforma. A semântica da Vercel é:
 *
 *   · 300s é o PADRÃO em todos os planos;
 *   · no Hobby, 300s é também o teto — não há configuração acima disso;
 *   · no Pro e no Enterprise, o teto configurável é 800s.
 *
 * ─── Por que 600 e não 300 ─────────────────────────────────────────────────
 *
 * O projeto foi VERIFICADO no Pro antes desta mudança, e não deduzido de
 * comentário: a equipe `schutzermusics-projects` responde `billing.plan: pro`
 * na API da Vercel, o projeto `comite` roda `nodejs24.x` com Fluid Compute
 * ligado, e a documentação da plataforma dá 800s como máximo geral para Pro
 * nesse runtime. Verificar foi o passo que destravou o resto: o número antigo
 * era um teto de Hobby herdado, não um limite físico.
 *
 * Ficamos em 600, e não em 800, porque o teto existe para o caso de a nossa
 * própria contabilidade estar errada. 600 acomoda o orçamento inteiro com 55s
 * de sobra (ver `LONG_JOB_WORST_CASE_MS`) e ainda deixa 200s entre nós e o
 * limite do plano. Gastar essa folga agora seria trocar margem de segurança
 * por tempo que ninguém pediu.
 *
 * ─── O que continua valendo ────────────────────────────────────────────────
 *
 * Que NENHUMA rota dependa de um padrão não declarado. Quando a rota não diz o
 * seu tempo de vida, ninguém consegue afirmar que o orçamento cabe dentro dele.
 */
export const APEX_CONFIGURED_HOST_CEILING = 600;

/**
 * ORDEM DE RELEASE desta linha de trabalho — migration ANTES do código.
 *
 * O código novo escreve `contract_ai_analyses.execution_job_id`, coluna criada
 * pela migration 168. Publicá-lo contra um banco sem a coluna faz toda leitura
 * de contrato falhar na PRIMEIRA escrita: a análise nem chega a nascer.
 *
 * A ordem inversa é segura porque a 168 é aditiva — coluna anulável, sem
 * `NOT NULL`, sem `DEFAULT`, sem gatilho que a exija. O código antigo continua
 * funcionando entre os passos 1 e 2, e é essa janela que permite publicar sem
 * downtime.
 *
 * Está aqui, e não só num runbook, porque runbook se perde e teste não.
 */
export const RELEASE_ORDER = [
  'apply migration 168',
  'deploy application code',
  'run legacy recovery',
] as const;

/** Publicar o código novo contra um banco sem a 168 NUNCA é seguro. */
export const DEPLOY_BEFORE_MIGRATION_SAFE = false;

/**
 * Nome anterior, preservado para não espalhar renomeação por todo o módulo.
 * O nome novo é o que diz a verdade: é o teto que NÓS configuramos.
 */
export const HOST_MAX_DURATION_SECONDS = APEX_CONFIGURED_HOST_CEILING;

/**
 * Tempo limite de UMA tentativa de provedor na etapa longa (operacionalização).
 * Espelha `getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION').timeoutMs`; o
 * teste cruza os dois para que nunca divirjam.
 *
 * ─── Por que 450s ──────────────────────────────────────────────────────────
 *
 * A execução real de JA10182283 gastou 180,2s e parou — no tempo limite, e não
 * no fim da leitura. Isso mede o relógio, não o contrato: com 180s não se sabe
 * se faltava um segundo ou cinco minutos. 450s é o maior valor que cabe no teto
 * de 600s preservando a margem de persistência e a folga de hospedagem, e a sua
 * função é diagnóstica — descobrir quanto esta etapa realmente custa.
 *
 * Quem mata o processo continua sendo a APLICAÇÃO. Se a hospedagem matasse, não
 * sobraria ninguém para escrever o estado terminal, e a análise ficaria
 * eternamente `running` — o defeito que este arquivo inteiro existe para impedir.
 */
export const LONG_PROVIDER_TIMEOUT_MS = 450_000;

/**
 * Tentativas de provedor DENTRO de uma invocação. Uma, e por decisão.
 *
 * Duas tentativas de 450s são 900s teóricos dentro de uma função que vive 600s:
 * a segunda tentativa seria, por construção, morta pelo host. A aritmética muda
 * com o teto, a conclusão não. A repetição da etapa longa existe — mas no nível
 * do TRABALHO, onde cada tentativa ganha uma invocação inteira e um tempo de
 * vida novo, e não empilhada dentro da mesma.
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
 * mais tempo depois de morto — e é por isso que ela subiu JUNTO com o teto, e
 * não antes dele: 540s cobre os 495s do pior caso e continua abaixo dos 600s da
 * função, de modo que a concessão nunca sobreviva à invocação que a tomou.
 */
export const JOB_LEASE_SECONDS = 540;

/**
 * Tentativas de TRABALHO da operacionalização dedicada.
 *
 * Uma, no primeiro Portão de Dado Real. Cada tentativa é uma operação Sonnet
 * potencialmente cara sobre um contrato inteiro; três tentativas automáticas
 * gastariam três vezes antes de qualquer humano ver que algo está errado.
 *
 * O que queremos, enquanto não existe evidência real de latência e custo, é:
 *
 *   falha → estado terminal VISÍVEL → retentativa DELIBERADA
 *
 * Subir este número depois é barato e reversível. Descobrir o custo de três
 * chamadas longas por uma falha sistemática, não.
 */
export const OPERATIONALIZATION_JOB_MAX_ATTEMPTS = 1;

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
