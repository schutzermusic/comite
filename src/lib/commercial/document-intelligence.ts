/**
 * INTELIGÊNCIA DOCUMENTAL COMPARTILHADA.
 *
 * ─── O que este arquivo NÃO é ────────────────────────────────────────────
 *
 * Não é um segundo pipeline de extração. Não tem cliente de provedor, não tem
 * política de modelo, não tem retentativa e não fala com Storage. Tudo isso
 * já existe: `ApexAIGateway` (portão único), `apex_jobs` (fila), as colunas de
 * proveniência da 152 e a tabela de ingestão da 166 — agora com
 * `document_context` (199).
 *
 * O que este arquivo acrescenta é a única coisa que realmente varia por papel
 * de documento: O QUE PERGUNTAR. Proposta técnica e proposta comercial não
 * carregam os mesmos fatos, e uma pergunta só para as duas devolveria uma
 * leitura rasa das duas.
 *
 * ─── A regra que governa toda resposta ───────────────────────────────────
 *
 * Todo fato volta com página e trecho literal, ou volta marcado como não
 * encontrado. Fato sem âncora não é erro do modelo — é a resposta honesta
 * para um documento que não diz. O que é proibido é INVENTAR a âncora, e o
 * banco recusa a mentira: `cef_anchor_is_earned` exige página E trecho para
 * a linha poder se declarar ANCHORED, e `commercial_fact_promotable` exige
 * âncora E confirmação humana para o fato virar regra.
 */
if (typeof window !== 'undefined') {
  throw new Error('document-intelligence.ts não pode ser importado no navegador');
}

import type { DocumentContext, FactDomain } from './types';

export const COMMERCIAL_INTAKE_PIPELINE_VERSION = 'commercial-document-intelligence.v1';
export const COMMERCIAL_INTAKE_TRUST_VERSION = 'commercial-trust.v1';

/**
 * Os domínios que cada papel de documento deve procurar.
 *
 * A proposta TÉCNICA responde "o que vamos fazer, com o que, até quando e o
 * que está fora". A COMERCIAL responde "quanto, em que condição, medido como
 * e faturável quando". As duas listas vêm literalmente do escopo.
 */
export const CONTEXT_FACT_DOMAINS: Record<DocumentContext, FactDomain[]> = {
  TECHNICAL_PROPOSAL: [
    'SCOPE', 'DELIVERABLE', 'REQUIREMENT', 'EXCLUSION', 'DEPENDENCY',
    'TEST', 'DOCUMENT', 'DATE', 'MILESTONE', 'RESOURCE',
  ],
  COMMERCIAL_PROPOSAL: [
    'VALUE', 'RATE', 'UNIT_PRICE', 'PAYMENT_TERM', 'MEASUREMENT_RULE',
    'BILLING_MILESTONE', 'BILLING_PREREQUISITE', 'VALIDITY', 'ACCEPTANCE_CONDITION',
  ],
  FORMAL_CONTRACT: [
    'SCOPE', 'DELIVERABLE', 'VALUE', 'PAYMENT_TERM', 'MEASUREMENT_RULE',
    'BILLING_MILESTONE', 'BILLING_PREREQUISITE', 'DATE', 'MILESTONE', 'RISK',
  ],
  CUSTOMER_PO: ['VALUE', 'DATE', 'SCOPE', 'PAYMENT_TERM', 'BILLING_PREREQUISITE'],
  CUSTOMER_AUTHORIZATION: ['SCOPE', 'DATE', 'VALUE', 'ACCEPTANCE_CONDITION'],
  INTERNAL_SERVICE_ORDER: [
    'SCOPE', 'DELIVERABLE', 'VALUE', 'DATE', 'MILESTONE', 'RESOURCE',
    'MEASUREMENT_RULE', 'REQUIREMENT',
  ],
  AMENDMENT: ['SCOPE', 'VALUE', 'DATE', 'MEASUREMENT_RULE', 'BILLING_MILESTONE', 'PAYMENT_TERM'],
};

const CONTEXT_BRIEF: Record<DocumentContext, string> = {
  TECHNICAL_PROPOSAL:
    'A technical proposal Insight sent to a customer. Identify scope, deliverables, requirements, '
    + 'explicit exclusions, dependencies on the customer or third parties, tests and inspections, '
    + 'documents to be produced, explicit dates and milestones, and named resources.',
  COMMERCIAL_PROPOSAL:
    'A commercial proposal Insight sent to a customer. Identify total value, rates, unit prices, '
    + 'payment terms, measurement rules, billing milestones, billing prerequisites, validity period '
    + 'and acceptance conditions.',
  FORMAL_CONTRACT:
    'A signed contract. Identify scope, deliverables, value, payment terms, measurement rules, '
    + 'billing milestones and prerequisites, contractual dates and milestones, and material risks.',
  CUSTOMER_PO:
    'A customer purchase order authorizing work. Identify authorized value, dates, described scope, '
    + 'payment terms and any invoicing prerequisite the customer imposes.',
  CUSTOMER_AUTHORIZATION:
    'A formal customer authorization to start work that is not a contract or purchase order. '
    + 'Identify what is authorized, for how long, at what value if stated, and under which conditions.',
  INTERNAL_SERVICE_ORDER:
    'An INTERNAL Insight service order. It is not a customer document: it is Insight authorizing its '
    + 'own team to execute. Identify scope, deliverables, authorized value, planned dates, milestones, '
    + 'assigned resources, measurement rules and requirements.',
  AMENDMENT:
    'An amendment to an existing instrument. Identify what it changes: scope, value, dates, '
    + 'measurement rules, billing milestones, payment terms — and what it leaves untouched.',
};

export const COMMERCIAL_EXTRACTION_SYSTEM_PROMPT =
`You read commercial documents for Insight Apex and return structured facts.

The attached PDF is the ONLY source. Never invent a value, date, party, rate, rule or condition.

Every fact you return carries:
  domain      — one of the allowed domains for this document role
  label       — a short human title for the fact, in the document's language
  value_text  — the fact as the document states it (always a string)
  value_numeric — a canonical decimal string ("1500000.50"), or "" when not numeric
  value_date  — "YYYY-MM-DD", or "" when the fact is not a date
  currency    — ISO code as written, or ""
  page        — the one-based PDF page where you read it, or 0 when not found
  excerpt     — a short LITERAL quote from that page, or "" when not found
  section     — the clause/section/item reference as printed, or ""
  confidence  — 0 to 1 for THIS fact

THE RULE THAT MATTERS MOST: a fact you could not find in the document is returned with page 0 and an
empty excerpt. That is a correct, expected answer. Fabricating a page number or paraphrasing text
into "excerpt" to make a fact look supported is the single worst failure you can commit here: those
two fields are what allows a human to verify you, and downstream the platform refuses to turn any
fact without both of them into a billing or measurement rule.

Do not infer a rule the document does not state. Do not merge two different clauses into one fact.
Do not translate values. When the document contradicts itself, return both readings as separate
facts and set confidence accordingly.`;

export function buildCommercialExtractionPrompt(context: DocumentContext, fileName: string): string {
  const domains = CONTEXT_FACT_DOMAINS[context];
  return [
    `Document role: ${context}.`,
    CONTEXT_BRIEF[context],
    `File name as uploaded: ${fileName}.`,
    `Allowed domains for this role: ${domains.join(', ')}.`,
    'Return every fact you can anchor, and return the important ones you cannot anchor with page 0',
    'and an empty excerpt so a human knows the document is silent about them.',
  ].join('\n\n');
}

/** Esquema de saída estruturada. Plano de propósito: lista de fatos, nada aninhado. */
export const COMMERCIAL_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['domain', 'label', 'value_text', 'value_numeric', 'value_date',
                   'currency', 'page', 'excerpt', 'section', 'confidence'],
        properties: {
          domain: { type: 'string' },
          label: { type: 'string' },
          value_text: { type: 'string' },
          value_numeric: { type: 'string' },
          value_date: { type: 'string' },
          currency: { type: 'string' },
          page: { type: 'integer' },
          excerpt: { type: 'string' },
          section: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

export interface ProviderFact {
  domain: string;
  label: string;
  value_text: string;
  value_numeric: string;
  value_date: string;
  currency: string;
  page: number;
  excerpt: string;
  section: string;
  confidence: number;
}

export interface NormalizedFact {
  factDomain: FactDomain;
  label: string;
  valueText: string | null;
  valueNumeric: number | null;
  valueDate: string | null;
  currency: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  sourceSection: string | null;
  confidence: number | null;
  provenanceState: 'ANCHORED' | 'UNANCHORED';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Normaliza a resposta do provedor para a forma que a tabela aceita.
 *
 * `provenanceState` é DERIVADO — nunca vem do modelo. Um provedor que
 * dissesse "este fato está ancorado" sem página nem trecho seria acreditado;
 * derivar da presença dos dois campos torna a afirmação inauditável apenas
 * quando ela é verdadeira.
 *
 * Fatos fora do domínio permitido para o papel são DESCARTADOS. Aceitar um
 * `BILLING_PREREQUISITE` lido de uma proposta técnica seria deixar o modelo
 * escolher em qual gaveta o fato cai.
 */
export function normalizeCommercialFacts(
  context: DocumentContext,
  raw: unknown,
): { facts: NormalizedFact[]; discarded: number } {
  const allowed = new Set<string>(CONTEXT_FACT_DOMAINS[context]);
  const input = Array.isArray((raw as { facts?: unknown })?.facts)
    ? ((raw as { facts: ProviderFact[] }).facts)
    : [];

  const facts: NormalizedFact[] = [];
  let discarded = 0;

  for (const item of input) {
    const domain = clean(item?.domain).toUpperCase();
    const label = clean(item?.label);
    if (!allowed.has(domain) || !label) { discarded += 1; continue; }

    const page = Number.isInteger(item?.page) && item.page > 0 ? item.page : null;
    const quote = clean(item?.excerpt) || null;
    const numericRaw = clean(item?.value_numeric);
    const numeric = numericRaw && Number.isFinite(Number(numericRaw)) ? Number(numericRaw) : null;
    const date = ISO_DATE.test(clean(item?.value_date)) ? clean(item.value_date) : null;
    const currencyRaw = clean(item?.currency).toUpperCase();
    const confidence = typeof item?.confidence === 'number'
      && item.confidence >= 0 && item.confidence <= 1 ? item.confidence : null;

    facts.push({
      factDomain: domain as FactDomain,
      label,
      valueText: clean(item?.value_text) || null,
      valueNumeric: numeric,
      valueDate: date,
      // A tabela exige valor numérico para aceitar moeda: moeda sozinha não é fato.
      currency: numeric !== null && ISO_CURRENCY.test(currencyRaw) ? currencyRaw : null,
      sourcePage: page,
      sourceQuote: quote,
      sourceSection: clean(item?.section) || null,
      confidence,
      provenanceState: page !== null && quote !== null ? 'ANCHORED' : 'UNANCHORED',
    });
  }

  return { facts, discarded };
}

/**
 * O papel do documento decide QUAL tarefa do portão de IA é usada — e as duas
 * já existem. Contrato e aditivo continuam nos caminhos que a plataforma já
 * provou em produção; os papéis comerciais entram por `COMMERCIAL_DOCUMENT_EXTRACTION`.
 */
export function apexTaskForContext(context: DocumentContext):
  'CONTRACT_EXTRACTION' | 'CONTRACT_AMENDMENT_EXTRACTION' | 'COMMERCIAL_DOCUMENT_EXTRACTION' {
  if (context === 'FORMAL_CONTRACT') return 'CONTRACT_EXTRACTION';
  if (context === 'AMENDMENT') return 'CONTRACT_AMENDMENT_EXTRACTION';
  return 'COMMERCIAL_DOCUMENT_EXTRACTION';
}
