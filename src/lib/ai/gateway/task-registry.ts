import type { ApexAITask, ApexAITaskPolicy } from './types';

export const DEFAULT_PRODUCTION_MODEL = 'claude-sonnet-5';
export const EXPLICIT_ESCALATION_MODEL = 'claude-opus-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

export const CURRENT_PRODUCTION_TASKS = [
  'CONTRACT_EXTRACTION',
  'CONTRACT_RISK_ANALYSIS',
  'FINANCE_RISK_ANALYSIS',
  'PROJECT_RISK_ANALYSIS',
  'WORKFORCE_ADVISOR',
  'PAYROLL_NARRATIVE',
  'EXECUTIVE_SYNTHESIS',
  'MEETING_MINUTES',
  'ASO_EXTRACTION',
  'PROJECT_SCHEDULE_EXTRACTION',
  'CONTRACT_OPERATIONALIZATION',
  'CONTRACT_AMENDMENT_EXTRACTION',
  'MEASUREMENT_EVIDENCE_PREANALYSIS',
  'COMMERCIAL_DOCUMENT_EXTRACTION',
  'SITE_SURVEY_UNDERSTANDING',
  'SERVICE_ORDER_DIVERGENCE_REVIEW',
] as const;

export type ApexAIProductionTask = (typeof CURRENT_PRODUCTION_TASKS)[number];

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
const positiveInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
const openAIReasoning = (): ApexAITaskPolicy['reasoningEffort'] => {
  const value = process.env.APEX_AI_OPENAI_REASONING?.trim();
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high' ? value : 'low';
};

function normal(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return {
    provider: 'anthropic',
    model: env('APEX_AI_ANTHROPIC_MODEL', DEFAULT_PRODUCTION_MODEL),
    maxTokens: 4096,
    timeoutMs: positiveInt('APEX_AI_TIMEOUT_MS', 60_000),
    maxAttempts: positiveInt('APEX_AI_MAX_ATTEMPTS', 2),
    reasoningEffort: 'medium',
    promptCache: true,
    stream: false,
    highRisk: false,
    fallbacks: [],
    ...overrides,
  };
}

function highRisk(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return normal({
    // Production high-risk tasks default to Sonnet 5; Opus is never used automatically.
    model: env('APEX_AI_ANTHROPIC_HIGH_RISK_MODEL', env('APEX_AI_ANTHROPIC_MODEL', DEFAULT_PRODUCTION_MODEL)),
    reasoningEffort: 'high',
    highRisk: true,
    // Deliberately empty: high-risk work never silently downgrades or falls back automatically.
    fallbacks: [],
    ...overrides,
  });
}

function explicitEscalation(overrides: Partial<ApexAITaskPolicy> = {}): ApexAITaskPolicy {
  return {
    provider: 'anthropic',
    model: env('APEX_AI_ANTHROPIC_ESCALATION_MODEL', env('APEX_AI_ANTHROPIC_COMPLEX_MODEL', EXPLICIT_ESCALATION_MODEL)),
    maxTokens: 16_000,
    timeoutMs: positiveInt('APEX_AI_TIMEOUT_MS', 120_000),
    maxAttempts: positiveInt('APEX_AI_MAX_ATTEMPTS', 2),
    reasoningEffort: 'high',
    promptCache: true,
    stream: false,
    highRisk: true,
    // Never an automatic fallback: explicit escalation targets fail closed without silent downgrade.
    fallbacks: [],
    ...overrides,
  };
}

export function getApexAITaskPolicy(task: ApexAITask): ApexAITaskPolicy {
  const policies: Record<ApexAITask, ApexAITaskPolicy> = {
    CONTRACT_EXTRACTION: highRisk({
      provider: 'openai', model: env('APEX_AI_OPENAI_MODEL', DEFAULT_OPENAI_MODEL),
      reasoningEffort: openAIReasoning(), promptCache: false,
      maxTokens: 16_000, timeoutMs: 120_000,
    }),
    /*
      Operacionalização lê o contrato inteiro e devolve MUITO mais que
      cláusulas: obrigações de cada parte, condições de faturamento, garantias,
      seguros, reajuste, documentos exigidos e riscos materiais — cada um com
      página e trecho literal. Um contrato de 195 páginas produz saída longa, e
      truncá-la entregaria uma leitura parcial com cara de completa.
    */
    // O SDK da Anthropic recusa requisições não-stream cujo max_tokens
    // ultrapasse ~21.3k (128k tokens/hora => >10 min de execução estimada).
    // Com 32k de saída, streaming é obrigatório: sdk.messages.stream(...).finalMessage().
    //
    // `maxAttempts: 1` é fixo, e não configurável por ambiente, porque é um
    // limite de INFRAESTRUTURA e não de gosto: duas tentativas de 450s são 900s
    // teóricos dentro de uma função que vive 600s, e a segunda seria morta pelo
    // host antes de qualquer caminho de erro da aplicação. A repetição desta
    // etapa existe no nível do TRABALHO
    // (`contracts.contract_operationalization.execute`), e ali também é UMA:
    // `OPERATIONALIZATION_JOB_MAX_ATTEMPTS` vale 1. Uma versão anterior deste
    // comentário dizia `p_max_attempts: 3` — número que o runtime nunca teve, e
    // que fazia esta linha prometer uma retentativa automática inexistente.
    //
    // `timeoutMs` era 180_000 e a operacionalização real de JA10182283 parou
    // exatamente ali: no relógio, não no fim da leitura. 450_000 é o valor
    // diagnóstico que cabe no teto de 600s do host preservando a margem de
    // persistência. Ver src/lib/platform/jobs/budget.ts.
    //
    // `reasoningEffort: 'medium'` — e SÓ para esta tarefa.
    //
    // A execução real de JA10182283 não estourou o tempo: rodou 313s, o
    // provedor respondeu, e a resposta não trouxe nenhum bloco de texto. Num
    // pedido com raciocínio adaptativo e teto de saída de 32k, o esforço alto é
    // a variável que mais disputa esse mesmo teto com a resposta — e uma
    // resposta que não chega a ser escrita não é uma leitura pior, é leitura
    // nenhuma.
    //
    // Baixar o esforço NÃO baixa a postura: `highRisk` continua verdadeiro, o
    // modelo continua Sonnet, o teto de saída continua 32k, o tempo limite
    // continua 450s, e o raciocínio continua LIGADO — 'none' o desligaria, e
    // não é isso que se quer. É o orçamento entre pensar e responder que muda.
    CONTRACT_OPERATIONALIZATION: highRisk({
      maxTokens: 32_000, timeoutMs: 450_000, stream: true, maxAttempts: 1,
      reasoningEffort: 'medium',
    }),
    // Amendment interpretation is legally material, but remains on the normal
    // economical Sonnet route. There is deliberately no automatic Opus hop.
    // 24k também ultrapassa o limite não-stream do SDK; streaming pelo mesmo motivo.
    CONTRACT_AMENDMENT_EXTRACTION: highRisk({ maxTokens: 24_000, timeoutMs: 180_000, stream: true }),
    CONTRACT_RISK_ANALYSIS: normal(),
    FINANCE_RISK_ANALYSIS: normal(),
    PROJECT_RISK_ANALYSIS: normal(),
    WORKFORCE_ADVISOR: normal({ maxTokens: 2048 }),
    PAYROLL_NARRATIVE: normal(),
    EXECUTIVE_SYNTHESIS: normal(),
    MEETING_MINUTES: normal(),
    PROJECT_SCHEDULE_EXTRACTION: highRisk({ maxTokens: 64_000, timeoutMs: 120_000, stream: true }),
    ASO_EXTRACTION: highRisk({ maxTokens: 1500 }),
    /*
      PRÉ-ANÁLISE DE EVIDÊNCIA DE MEDIÇÃO.

      `highRisk` porque o parecer é lido por quem decide se um pacote de medição
      vai ao cliente — e um "atendido" errado aqui é um pacote errado saindo com
      a assinatura da empresa. A postura alta NÃO é sobre o modelo custar mais:
      é sobre não haver fallback silencioso e o raciocínio ficar alto.

      O teto de saída é modesto de propósito. O pedido é UM documento contra, no
      máximo, sete exigências, e cada achado é um parágrafo com trecho e página.
      Um teto largo aqui só compraria espaço para o modelo divagar sobre um PDF
      que ele deveria estar conferindo.
    */
    MEASUREMENT_EVIDENCE_PREANALYSIS: highRisk({ maxTokens: 8_000, timeoutMs: 120_000 }),
    /*
      LEITURA DE DOCUMENTO COMERCIAL — proposta técnica, proposta comercial,
      pedido de compra, autorização do cliente e OS interna.

      Uma tarefa só para os cinco papéis, e não cinco tarefas, porque a
      POSTURA é a mesma: alto risco sem fallback silencioso, saída estruturada,
      e cada fato obrigado a apontar página e trecho. O que muda entre papéis
      é a PERGUNTA, e pergunta mora no prompt
      (`src/lib/commercial/document-intelligence.ts`), não na política.

      `highRisk` porque o que sai daqui vira, depois de confirmação humana,
      regra de medição e condição de faturamento. Um "valor total" lido errado
      não produz um texto ruim: produz uma cobrança errada.

      A extração comercial retorna somente fatos estruturados e curtos. O teto
      menor evita respostas narrativas extensas; uma saída truncada é recusada
      pelo gateway e exige revisão, nunca vira regra de negócio parcial.
    */
    COMMERCIAL_DOCUMENT_EXTRACTION: highRisk({
      provider: 'openai', model: env('APEX_AI_OPENAI_MODEL', DEFAULT_OPENAI_MODEL),
      reasoningEffort: openAIReasoning(), promptCache: false,
      maxTokens: 8_000, timeoutMs: 180_000, stream: false,
    }),
    /*
      LEITURA DE LEVANTAMENTO TÉCNICO — notas, checklist, equipamentos,
      riscos, perguntas em aberto e a lista de arquivos de campo.

      NÃO é `highRisk`, e a razão é estrutural: a saída grava só em
      `commercial_site_surveys.apex_candidate`, uma coluna que nenhuma regra
      de medição, OS ou faturamento lê. Ela vira escopo apenas quando alguém a
      transcreve para a proposta. Raciocínio alto mesmo assim — a pergunta é
      "o que falta saber", e errar para menos é pior que errar para mais.
    */
    SITE_SURVEY_UNDERSTANDING: normal({ maxTokens: 8_000, timeoutMs: 120_000, reasoningEffort: 'high' }),
    /*
      CONFRONTO ASSISTIDO OS × PT × PC.

      Compara FATOS já lidos (com página e trecho) da OS carregada contra os do
      pacote aceito, e devolve divergências CANDIDATAS. Nada aqui decide: a
      candidata abre para decisão humana (`internal_service_order_record_divergence`,
      `detected_by = 'ai'`), e quem resolve diz qual fonte prevalece. `highRisk`
      porque uma candidata BLOCKING segura a emissão da OS até alguém decidir —
      errar para mais atrasa; errar para menos deixaria passar execução fora do
      aceito. Sem PDF: a entrada é texto curto e estruturado.
    */
    SERVICE_ORDER_DIVERGENCE_REVIEW: highRisk({ maxTokens: 6_000, timeoutMs: 120_000 }),
    /*
      APEX BUSCA FORNECEDORES NA INTERNET (`src/lib/supply/supplier-discovery.ts`).

      A única tarefa com busca na internet, e por isso a única que depende de
      um SEGUNDO interruptor: `APEX_AI_WEB_SEARCH_ENABLED=true` (desligado por
      padrão; ver .env.example). Fora de `CURRENT_PRODUCTION_TASKS` pelo mesmo
      motivo — ela não roda em nenhuma instalação que não a ligou.

      NÃO é `highRisk`, e a razão é estrutural: nada daqui é gravado. Os
      candidatos voltam à tela, marcados como não verificados, e só viram
      cadastro (PROSPECT) se uma pessoa com `suppliers.manage` aceitar um deles
      pela rota governada de fornecedores. Ninguém é contatado automaticamente.

      `maxAttempts: 1` e `fallbacks: []`, fixos: cada tentativa é uma busca
      cobrada, e repetir uma busca de 2 minutos em silêncio seria gastar o dobro
      para, no melhor caso, a mesma resposta. Quem quiser de novo pede de novo.
      O teto de saída é curto (a lista é limitada a 8 candidatos) e o esforço é
      baixo para o raciocínio não disputar esse teto com a resposta — a triagem
      séria é a do servidor, que descarta todo candidato sem fonte vista na
      busca.
    */
    SUPPLIER_WEB_DISCOVERY: normal({
      maxTokens: 6_000, timeoutMs: 120_000, maxAttempts: 1, reasoningEffort: 'low', fallbacks: [],
    }),
    COMPLEX_ESCALATION: explicitEscalation(),
  };
  return policies[task];
}
