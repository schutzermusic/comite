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
import Ajv from 'ajv';

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

/**
 * O que a leitura procura. Além dos papéis de documento, existe o PDF que é
 * as duas propostas ao mesmo tempo (`COMBINED` em `commercial_proposals.kind`).
 * Lê-lo como "comercial" jogava fora escopo, entregáveis e exclusões; lê-lo
 * duas vezes pagava o provedor duas vezes pelo mesmo arquivo. A leitura
 * combinada pede a UNIÃO dos domínios numa passada só, e cada fato volta com
 * o papel ao qual o SEU domínio pertence (`factContextFor`) — técnica para
 * escopo, comercial para preço. Proveniência (página, trecho, confiança) não
 * muda em nada.
 */
export type ExtractionMode = DocumentContext | 'COMBINED_PROPOSAL';

export function domainsForMode(mode: ExtractionMode): FactDomain[] {
  return mode === 'COMBINED_PROPOSAL'
    ? [...CONTEXT_FACT_DOMAINS.TECHNICAL_PROPOSAL, ...CONTEXT_FACT_DOMAINS.COMMERCIAL_PROPOSAL]
    : CONTEXT_FACT_DOMAINS[mode];
}

/** O papel em que cada fato é gravado. Fora da leitura combinada, o próprio papel. */
export function factContextFor(mode: ExtractionMode, domain: FactDomain): DocumentContext {
  if (mode !== 'COMBINED_PROPOSAL') return mode;
  return CONTEXT_FACT_DOMAINS.TECHNICAL_PROPOSAL.includes(domain) ? 'TECHNICAL_PROPOSAL' : 'COMMERCIAL_PROPOSAL';
}

/** A leitura de uma proposta segue o tipo DECLARADO dela. */
export function extractionModeForProposal(kind: 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED'): ExtractionMode {
  return kind === 'TECHNICAL' ? 'TECHNICAL_PROPOSAL' : kind === 'COMMERCIAL' ? 'COMMERCIAL_PROPOSAL' : 'COMBINED_PROPOSAL';
}

const CONTEXT_BRIEF: Record<ExtractionMode, string> = {
  COMBINED_PROPOSAL:
    'A single proposal Insight sent to a customer that contains BOTH the technical and the commercial '
    + 'proposal. Read both parts. Technical part: scope, deliverables, requirements, explicit exclusions, '
    + 'dependencies, tests and inspections, documents, dates and milestones, named resources. Commercial '
    + 'part: total value, rates, unit prices, payment terms, measurement rules, billing milestones, billing '
    + 'prerequisites, validity period and acceptance conditions.',
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

Return only the JSON object specified by the schema: document and facts. No report, markdown,
summary, repeated PDF text or reasoning. Keep each excerpt to the shortest literal span that
supports the fact (prefer at most 240 characters). Do not repeat the same fact.

Do not infer a rule the document does not state. Do not merge two different clauses into one fact.
Do not translate values. When the document contradicts itself, return both readings as separate
facts and set confidence accordingly.`;

export function buildCommercialExtractionPrompt(context: ExtractionMode, fileName: string): string {
  const domains = domainsForMode(context);
  return [
    `Document role: ${context}.`,
    CONTEXT_BRIEF[context],
    `File name as uploaded: ${fileName}.`,
    `Allowed domains for this role: ${domains.join(', ')}.`,
    'Also classify the document itself in "document": role = one of TECHNICAL_PROPOSAL, '
    + 'COMMERCIAL_PROPOSAL, COMBINED_PROPOSAL, FORMAL_CONTRACT, CUSTOMER_PO, CUSTOMER_AUTHORIZATION, '
    + 'INTERNAL_SERVICE_ORDER, AMENDMENT or UNKNOWN, judged from what the document SAYS it is; '
    + 'revision_label = the revision identifier exactly as printed (e.g. "Rev. 03"), or "" if none; '
    + 'title as printed; page and a literal excerpt where you read the role/revision, or 0 and "".',
    'Return every fact you can anchor, and return the important ones you cannot anchor with page 0',
    'and an empty excerpt so a human knows the document is silent about them.',
  ].join('\n\n');
}

/** Esquema de saída estruturada. Plano de propósito: lista de fatos, nada aninhado. */
export const COMMERCIAL_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['document', 'facts'],
  properties: {
    /*
      CLASSIFICAÇÃO do documento — o que ELE diz ser, não o que o usuário
      declarou. A plataforma compara as duas coisas e AVISA quando divergem;
      não corrige sozinha, porque a proposta foi cadastrada por uma pessoa.
    */
    document: {
      type: 'object',
      additionalProperties: false,
      required: ['role', 'revision_label', 'title', 'page', 'excerpt'],
      properties: {
        role: { type: 'string' },
        revision_label: { type: 'string' },
        title: { type: 'string' },
        page: { type: 'integer' },
        excerpt: { type: 'string' },
      },
    },
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

export interface CommercialValidationIssue {
  path: string;
  expected: string;
  received: string;
}

export class CommercialExtractionValidationError extends Error {
  constructor(public readonly issues: CommercialValidationIssue[]) {
    super('Commercial extraction did not match its structured-output contract.');
    this.name = 'CommercialExtractionValidationError';
  }
}

const validateSchema = new Ajv({ allErrors: true }).compile(COMMERCIAL_EXTRACTION_SCHEMA);
const valueShape = (value: unknown): string => value === null ? 'null'
  : Array.isArray(value) ? 'array' : typeof value;

/** Validate the same provider-neutral schema sent to the gateway before staging or review. */
export function validateCommercialExtraction(raw: unknown): asserts raw is {
  document: Record<string, unknown>; facts: ProviderFact[];
} {
  if (!validateSchema(raw)) {
    const issues = (validateSchema.errors ?? []).map((issue) => {
      const path = issue.keyword === 'required'
        ? `${issue.instancePath}/${String(issue.params.missingProperty)}` : issue.instancePath || '/';
      const parts = issue.instancePath.split('/').slice(1);
      const parent = parts.reduce<unknown>((node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, raw);
      return { path, expected: issue.keyword === 'type' ? String(issue.params.type) : issue.keyword,
        received: issue.keyword === 'required' ? 'missing' : valueShape(parent) };
    });
    throw new CommercialExtractionValidationError(issues);
  }
  const facts = (raw as { facts: ProviderFact[] }).facts;
  const issues: CommercialValidationIssue[] = [];
  facts.forEach((fact, index) => {
    const path = `/facts/${index}`;
    if (!fact.label.trim()) issues.push({ path: `${path}/label`, expected: 'nonempty string', received: 'empty string' });
    if (fact.page < 0) issues.push({ path: `${path}/page`, expected: 'integer >= 0', received: 'negative integer' });
    if (fact.confidence < 0 || fact.confidence > 1)
      issues.push({ path: `${path}/confidence`, expected: 'number 0..1', received: 'out of range number' });
    if ((fact.page > 0) !== Boolean(fact.excerpt.trim()))
      issues.push({ path: `${path}/excerpt`, expected: 'page and quote together', received: 'unpaired provenance' });
    if (fact.value_numeric && !/^-?\d+(?:\.\d+)?$/.test(fact.value_numeric))
      issues.push({ path: `${path}/value_numeric`, expected: 'canonical decimal string', received: 'invalid string' });
    if (fact.value_date && !ISO_DATE.test(fact.value_date))
      issues.push({ path: `${path}/value_date`, expected: 'YYYY-MM-DD', received: 'invalid string' });
    if (fact.currency && !ISO_CURRENCY.test(fact.currency))
      issues.push({ path: `${path}/currency`, expected: 'ISO currency code', received: 'invalid string' });
  });
  if (issues.length) throw new CommercialExtractionValidationError(issues);
}

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
  /** O papel em que o fato é gravado — derivado do domínio na leitura combinada. */
  documentContext: DocumentContext;
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
  context: ExtractionMode,
  raw: unknown,
): { facts: NormalizedFact[]; discarded: number } {
  const allowed = new Set<string>(domainsForMode(context));
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
      documentContext: factContextFor(context, domain as FactDomain),
    });
  }

  return { facts, discarded };
}

/**
 * O papel do documento decide QUAL tarefa do portão de IA é usada — e as duas
 * já existem. Contrato e aditivo continuam nos caminhos que a plataforma já
 * provou em produção; os papéis comerciais entram por `COMMERCIAL_DOCUMENT_EXTRACTION`.
 */
export function apexTaskForContext(context: ExtractionMode):
  'CONTRACT_EXTRACTION' | 'CONTRACT_AMENDMENT_EXTRACTION' | 'COMMERCIAL_DOCUMENT_EXTRACTION' {
  if (context === 'FORMAL_CONTRACT') return 'CONTRACT_EXTRACTION';
  if (context === 'AMENDMENT') return 'CONTRACT_AMENDMENT_EXTRACTION';
  return 'COMMERCIAL_DOCUMENT_EXTRACTION';
}


export interface DocumentClassification {
  role: string;
  revisionLabel: string | null;
  revisionNumber: number | null;
  title: string | null;
  page: number | null;
  excerpt: string | null;
}

/** "Rev. 03", "R3", "Revisão 2" → 3 / 3 / 2. Nada reconhecível → nulo. */
export function parseRevisionLabel(label: string | null | undefined): number | null {
  const match = (label ?? '').match(/(?:rev(?:is[aã]o)?\.?|r)\s*[-_.:]?\s*0*(\d{1,3})/i);
  return match ? Number(match[1]) : null;
}

export function normalizeClassification(raw: unknown): DocumentClassification | null {
  const doc = (raw as { document?: Record<string, unknown> })?.document;
  if (!doc || typeof doc !== 'object') return null;
  const label = typeof doc.revision_label === 'string' && doc.revision_label.trim() ? doc.revision_label.trim() : null;
  return {
    role: typeof doc.role === 'string' && doc.role.trim() ? doc.role.trim().toUpperCase() : 'UNKNOWN',
    revisionLabel: label,
    revisionNumber: parseRevisionLabel(label),
    title: typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : null,
    page: Number.isInteger(doc.page) && (doc.page as number) > 0 ? (doc.page as number) : null,
    excerpt: typeof doc.excerpt === 'string' && doc.excerpt.trim() ? doc.excerpt.trim() : null,
  };
}

/**
 * O que a classificação diz contra o que foi declarado. Só AVISA: a proposta
 * e a revisão foram escolhidas por uma pessoa, e a correção é dela.
 */
export function classificationWarnings(
  classification: DocumentClassification | null,
  declared: { kind: 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED'; revision: number },
): string[] {
  if (!classification) return ['A leitura não classificou o documento — confira o papel e a revisão manualmente.'];
  const warnings: string[] = [];
  const expected = declared.kind === 'TECHNICAL' ? ['TECHNICAL_PROPOSAL', 'COMBINED_PROPOSAL']
    : declared.kind === 'COMMERCIAL' ? ['COMMERCIAL_PROPOSAL', 'COMBINED_PROPOSAL']
    : ['COMBINED_PROPOSAL', 'TECHNICAL_PROPOSAL', 'COMMERCIAL_PROPOSAL'];
  if (classification.role === 'UNKNOWN') {
    warnings.push('O documento não se identifica como proposta técnica nem comercial.');
  } else if (!expected.includes(classification.role)) {
    warnings.push(`O documento se apresenta como ${classification.role}, e foi anexado como proposta ${declared.kind.toLowerCase()}.`);
  }
  if (classification.revisionNumber !== null && classification.revisionNumber !== declared.revision
      && classification.revisionNumber !== declared.revision - 1) {
    warnings.push(`O documento indica ${classification.revisionLabel}; ele foi anexado à R${String(declared.revision).padStart(2, '0')}.`);
  }
  return warnings;
}
