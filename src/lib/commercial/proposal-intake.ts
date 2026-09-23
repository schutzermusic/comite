/**
 * "Nova proposta" pelo PDF — o que a Apex leu, virado em decisões de revisão.
 *
 * Cada campo da proposta sai daqui num de quatro estados:
 *
 *   CONFIRMED   — veio de um registro canônico (oportunidade, conta) ou duas
 *                 fontes independentes concordam, ou a pessoa aceitou.
 *   SUGGESTED   — a Apex leu, com página quando houver. Nunca vira verdade
 *                 sozinho: a pessoa aceita ou corrige.
 *   MISSING     — ninguém disse. Obrigatório bloqueia a criação.
 *   CONFLICTING — duas leituras discordam. A pessoa escolhe; a tela não
 *                 escolhe por ela.
 *
 * Puro e determinístico: nada de rede, nada de modelo. O que a leitura NÃO
 * devolve (número e cliente) vem do nome do arquivo e da oportunidade — e é
 * rotulado com essa origem.
 */

export type IntakeState = 'confirmed' | 'suggested' | 'missing' | 'conflicting';
export type IntakeSlot = 'PT' | 'PC' | 'COMBINED';

/** Formas mínimas do que a rota de leitura devolve (`normalizeCommercialFacts`). */
export interface IntakeFact {
  factDomain: string;
  label: string;
  valueText: string | null;
  valueNumeric: number | null;
  valueDate: string | null;
  currency: string | null;
  sourcePage: number | null;
  provenanceState: 'ANCHORED' | 'UNANCHORED';
}
export interface IntakeClassification {
  role: string;
  revisionLabel: string | null;
  revisionNumber: number | null;
  title: string | null;
  page: number | null;
}
export interface IntakeDocument {
  slot: IntakeSlot;
  fileName: string;
  classification: IntakeClassification | null;
  facts: IntakeFact[];
}
export interface IntakeOpportunity {
  id: string;
  title: string;
  counterparty_name: string;
  party_id?: string | null;
  currency?: string | null;
}

export interface IntakeOption { value: string; label: string; source: string }
export interface IntakeField {
  key: IntakeFieldKey;
  label: string;
  state: IntakeState;
  value: string;
  source: string | null;
  required: boolean;
  options?: IntakeOption[];
  note?: string;
}
export type IntakeFieldKey =
  | 'proposal_number' | 'revision' | 'kind' | 'counterparty_name' | 'opportunity_id' | 'title'
  | 'total_value' | 'currency' | 'validity_until' | 'payment_terms' | 'scope_summary' | 'measurement_rules';

const SLOT_ROLE: Record<IntakeSlot, string[]> = {
  PT: ['TECHNICAL_PROPOSAL', 'COMBINED_PROPOSAL'],
  PC: ['COMMERCIAL_PROPOSAL', 'COMBINED_PROPOSAL'],
  COMBINED: ['COMBINED_PROPOSAL', 'TECHNICAL_PROPOSAL', 'COMMERCIAL_PROPOSAL'],
};
export const SLOT_KIND: Record<IntakeSlot, 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED'> = {
  PT: 'TECHNICAL', PC: 'COMMERCIAL', COMBINED: 'COMBINED',
};
const ROLE_LABEL: Record<string, string> = {
  TECHNICAL_PROPOSAL: 'Proposta técnica', COMMERCIAL_PROPOSAL: 'Proposta comercial',
  COMBINED_PROPOSAL: 'Técnica + comercial', UNKNOWN: 'Não identificado',
};

const page = (f: { sourcePage: number | null }) => (f.sourcePage ? `Apex · p. ${f.sourcePage}` : 'Apex · sem página');

/**
 * "PC-2024-118 R02.pdf" → "PC-2024-118". O número NÃO vem da leitura; o nome
 * do arquivo é a melhor pista, e a tela diz isso.
 */
export function numberFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  const withoutRevision = base.replace(/[\s.-]*(?:rev(?:is[aã]o)?\.?|r)\s*[-_.]?\s*\d{1,3}\s*$/i, '').trim();
  const match = withoutRevision.match(/\b(?:P[TC]|PROP)[\s.-]*[\w./-]*\d[\w./-]*/i);
  if (match) return match[0].replace(/\s+/g, '-').toUpperCase();
  return /\d/.test(withoutRevision) && withoutRevision.length <= 40 ? withoutRevision : null;
}

/** O nome do arquivo sugere o papel? Só uma pista para escolher a vaga. */
export function slotFromFileName(fileName: string): IntakeSlot | null {
  const name = fileName.toUpperCase();
  if (/(^|[^A-Z])PT([^A-Z]|$)|T[EÉ]CNICA/.test(name)) return 'PT';
  if (/(^|[^A-Z])PC([^A-Z]|$)|COMERCIAL/.test(name)) return 'PC';
  return null;
}

const byDomain = (docs: IntakeDocument[], domain: string) =>
  docs.flatMap((d) => d.facts.filter((f) => f.factDomain === domain).map((f) => ({ ...f, slot: d.slot })));

function field(partial: Omit<IntakeField, 'source' | 'required'> & Partial<Pick<IntakeField, 'source' | 'required'>>): IntakeField {
  return { source: null, required: false, ...partial };
}

export function buildIntakeFields(
  docs: IntakeDocument[],
  opportunity: IntakeOpportunity | null,
): IntakeField[] {
  const fields: IntakeField[] = [];

  // Número — por arquivo; PT e PC são propostas distintas (número único por organização).
  const numbers = docs.map((d) => numberFromFileName(d.fileName)).filter((n): n is string => Boolean(n));
  fields.push(numbers.length
    ? field({ key: 'proposal_number', label: 'Número', state: 'suggested', value: numbers[0],
      source: 'Nome do arquivo', required: true,
      note: docs.length > 1 ? 'PT e PC recebem números próprios; o sufixo do tipo é acrescentado.' : undefined })
    : field({ key: 'proposal_number', label: 'Número', state: 'missing', value: '', required: true,
      note: 'A leitura não devolve o número da proposta.' }));

  // Revisão — impressa no documento; PT e PC devem concordar.
  const revs = docs.filter((d) => d.classification?.revisionNumber != null)
    .map((d) => ({ slot: d.slot, n: d.classification!.revisionNumber!, label: d.classification!.revisionLabel ?? '' }));
  const distinctRevs = [...new Set(revs.map((r) => r.n))];
  if (distinctRevs.length > 1) {
    fields.push(field({ key: 'revision', label: 'Revisão impressa', state: 'conflicting', value: '',
      options: revs.map((r) => ({ value: String(r.n), label: `${r.label || `R${r.n}`} (${r.slot})`, source: `Apex · ${r.slot}` })),
      note: 'A proposta nasce em R01 no sistema; a revisão impressa fica registrada na leitura.' }));
  } else if (distinctRevs.length === 1) {
    fields.push(field({ key: 'revision', label: 'Revisão impressa', state: revs.length > 1 ? 'confirmed' : 'suggested',
      value: revs[0].label || `R${revs[0].n}`, source: revs.length > 1 ? 'PT e PC concordam' : 'Apex',
      note: distinctRevs[0] !== 1 ? `O documento é ${revs[0].label || `R${revs[0].n}`}; no sistema a proposta nasce em R01.` : undefined }));
  } else {
    fields.push(field({ key: 'revision', label: 'Revisão impressa', state: 'missing', value: '',
      note: 'Nenhuma revisão impressa encontrada. A proposta nasce em R01.' }));
  }

  // Tipo — a vaga escolhida contra o que o documento diz ser.
  const kindConflicts = docs.filter((d) => d.classification && d.classification.role !== 'UNKNOWN'
    && !SLOT_ROLE[d.slot].includes(d.classification.role));
  const kindValue = docs.map((d) => d.slot).join(' + ');
  fields.push(kindConflicts.length
    ? field({ key: 'kind', label: 'Tipo', state: 'conflicting', value: '',
      options: [
        { value: 'declared', label: `Manter como ${kindValue}`, source: 'Sua escolha' },
        ...kindConflicts.map((d) => ({ value: d.classification!.role,
          label: `${d.fileName}: ${ROLE_LABEL[d.classification!.role] ?? d.classification!.role}`, source: 'Apex' })),
      ],
      note: 'O documento se apresenta como outro papel.' })
    : field({ key: 'kind', label: 'Tipo', state: docs.every((d) => d.classification) ? 'confirmed' : 'suggested',
      value: kindValue, source: docs.every((d) => d.classification) ? 'Arquivo e leitura concordam' : 'Sua escolha', required: true }));

  // Cliente e oportunidade — a leitura não identifica a parte; o registro canônico, sim.
  fields.push(opportunity
    ? field({ key: 'counterparty_name', label: 'Cliente', state: 'confirmed', value: opportunity.counterparty_name,
      source: 'Oportunidade', required: true })
    : field({ key: 'counterparty_name', label: 'Cliente', state: 'missing', value: '', required: true,
      note: 'Escolha a oportunidade para herdar o cliente do cadastro único.' }));
  fields.push(opportunity
    ? field({ key: 'opportunity_id', label: 'Oportunidade', state: 'confirmed', value: opportunity.id,
      source: opportunity.title })
    : field({ key: 'opportunity_id', label: 'Oportunidade', state: 'missing', value: '',
      note: 'Sem oportunidade a proposta não pode iniciar execução nem ser comparada PT × PC.' }));

  // Título — impresso.
  const title = docs.map((d) => d.classification?.title).find(Boolean);
  fields.push(title
    ? field({ key: 'title', label: 'Título', state: 'suggested', value: title, source: 'Apex · capa', required: true })
    : field({ key: 'title', label: 'Título', state: opportunity ? 'suggested' : 'missing', value: opportunity?.title ?? '',
      source: opportunity ? 'Oportunidade' : null, required: true }));

  // Valor e moeda.
  const values = byDomain(docs, 'VALUE').filter((f) => f.valueNumeric !== null);
  const distinctValues = [...new Map(values.map((v) => [`${v.valueNumeric}|${v.currency ?? ''}`, v])).values()];
  if (distinctValues.length > 1) {
    fields.push(field({ key: 'total_value', label: 'Valor total', state: 'conflicting', value: '',
      options: distinctValues.map((v) => ({ value: String(v.valueNumeric),
        label: `${v.label}: ${formatAmount(v.valueNumeric!, v.currency)}`, source: page(v) })),
      note: 'O documento traz mais de um valor. Escolha o que governa.' }));
  } else if (distinctValues.length === 1) {
    fields.push(field({ key: 'total_value', label: 'Valor total', state: 'suggested',
      value: String(distinctValues[0].valueNumeric), source: page(distinctValues[0]) }));
  } else {
    fields.push(field({ key: 'total_value', label: 'Valor total', state: 'missing', value: '',
      note: docs.some((d) => d.slot !== 'PT') ? 'Nenhum valor ancorado na PC.' : 'A PT não traz valor; envie a PC para ler o valor.' }));
  }
  const currencies = [...new Set(values.map((v) => v.currency).filter((c): c is string => Boolean(c)))];
  if (opportunity?.currency && currencies.length && !currencies.includes(opportunity.currency)) {
    fields.push(field({ key: 'currency', label: 'Moeda', state: 'conflicting', value: '',
      options: [
        { value: opportunity.currency, label: `${opportunity.currency} (oportunidade)`, source: 'Oportunidade' },
        ...currencies.map((c) => ({ value: c, label: `${c} (documento)`, source: 'Apex' })),
      ] }));
  } else if (currencies.length > 1) {
    fields.push(field({ key: 'currency', label: 'Moeda', state: 'conflicting', value: '',
      options: currencies.map((c) => ({ value: c, label: c, source: 'Apex' })) }));
  } else {
    const c = currencies[0] ?? opportunity?.currency ?? 'BRL';
    fields.push(field({ key: 'currency', label: 'Moeda',
      state: currencies[0] && opportunity?.currency ? 'confirmed' : currencies[0] || opportunity?.currency ? 'suggested' : 'suggested',
      value: c, source: currencies[0] ? (opportunity?.currency ? 'Documento e oportunidade concordam' : 'Apex') : opportunity?.currency ? 'Oportunidade' : 'Padrão', required: true }));
  }

  // Validade.
  const validity = byDomain(docs, 'VALIDITY');
  const validityDate = validity.find((v) => v.valueDate);
  fields.push(validityDate
    ? field({ key: 'validity_until', label: 'Validade', state: 'suggested', value: validityDate.valueDate!, source: page(validityDate) })
    : validity.length
      ? field({ key: 'validity_until', label: 'Validade', state: 'missing', value: '', source: page(validity[0]),
        note: `Lido como “${validity[0].valueText ?? validity[0].label}” — informe a data final.` })
      : field({ key: 'validity_until', label: 'Validade', state: 'missing', value: '' }));

  // Condição de pagamento, escopo e regras de medição — textos com proveniência.
  const joinFacts = (domain: string) => byDomain(docs, domain);
  const payment = joinFacts('PAYMENT_TERM');
  fields.push(payment.length
    ? field({ key: 'payment_terms', label: 'Condição de pagamento', state: 'suggested',
      value: payment.map((f) => f.valueText ?? f.label).join('; ').slice(0, 1000), source: page(payment[0]) })
    : field({ key: 'payment_terms', label: 'Condição de pagamento', state: 'missing', value: '' }));
  const scope = joinFacts('SCOPE');
  fields.push(scope.length
    ? field({ key: 'scope_summary', label: 'Escopo', state: 'suggested',
      value: scope.map((f) => f.valueText ?? f.label).join('\n').slice(0, 2000), source: page(scope[0]) })
    : field({ key: 'scope_summary', label: 'Escopo', state: 'missing', value: '',
      note: docs.some((d) => d.slot !== 'PC') ? undefined : 'O escopo vem da PT.' }));
  const measurement = joinFacts('MEASUREMENT_RULE');
  fields.push(measurement.length
    ? field({ key: 'measurement_rules', label: 'Regras de medição', state: 'suggested',
      value: measurement.map((f) => f.valueText ?? f.label).join('\n'), source: `${measurement.length} regra(s) · Apex`,
      note: 'Entram como fatos da revisão, com página, para confirmação no dossiê.' })
    : field({ key: 'measurement_rules', label: 'Regras de medição', state: 'missing', value: '' }));

  return fields;
}

export function formatAmount(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency ?? ''} ${value}`.trim();
  }
}

export function intakeSummary(fields: IntakeField[]) {
  const count = (s: IntakeState) => fields.filter((f) => f.state === s).length;
  const blocking = fields.filter((f) => f.state === 'conflicting' || (f.required && f.state === 'missing'));
  return { confirmed: count('confirmed'), suggested: count('suggested'), missing: count('missing'),
    conflicting: count('conflicting'), blocking };
}

/**
 * Os payloads de criação — um por documento. PT e PC viram propostas irmãs
 * sob a mesma oportunidade (é o que a comparação PT × PC lê).
 */
export function intakePayloads(fields: IntakeField[], docs: IntakeDocument[], extra: { party_id?: string | null }) {
  const v = Object.fromEntries(fields.map((f) => [f.key, f.value.trim()])) as Record<IntakeFieldKey, string>;
  const kindOverride = v.kind && !v.kind.includes('+') && ['TECHNICAL_PROPOSAL', 'COMMERCIAL_PROPOSAL', 'COMBINED_PROPOSAL'].includes(v.kind)
    ? v.kind : null;
  return docs.map((doc) => {
    const kind = docs.length === 1 && kindOverride
      ? ({ TECHNICAL_PROPOSAL: 'TECHNICAL', COMMERCIAL_PROPOSAL: 'COMMERCIAL', COMBINED_PROPOSAL: 'COMBINED' } as const)[kindOverride as 'TECHNICAL_PROPOSAL']
      : SLOT_KIND[doc.slot];
    const number = proposalNumberFor(doc, docs, v.proposal_number);
    const isTech = kind === 'TECHNICAL';
    return {
      slot: doc.slot,
      payload: {
        proposal_number: number,
        kind,
        title: v.title,
        counterparty_name: v.counterparty_name,
        opportunity_id: v.opportunity_id || null,
        party_id: extra.party_id ?? null,
        currency: v.currency || 'BRL',
        // A PT entra sem valor: quem rege valor é a PC (mesma regra do fechamento).
        total_value: isTech ? null : v.total_value || null,
        validity_until: v.validity_until || null,
        payment_terms: isTech ? null : v.payment_terms || null,
        scope_summary: v.scope_summary || null,
      },
    };
  });
}

/**
 * Número de cada proposta. Um documento: o número revisado. PT e PC: cada
 * arquivo com número próprio o mantém; se os nomes não distinguem, o tipo
 * vira prefixo — o número é único por organização.
 */
export function proposalNumberFor(doc: IntakeDocument, docs: IntakeDocument[], reviewed: string): string {
  if (docs.length === 1) return reviewed;
  const fromFiles = docs.map((d) => numberFromFileName(d.fileName));
  const own = numberFromFileName(doc.fileName);
  if (own && new Set(fromFiles).size === docs.length) return own;
  return reviewed.toUpperCase().startsWith(`${doc.slot}-`) ? reviewed : `${doc.slot}-${reviewed}`;
}
