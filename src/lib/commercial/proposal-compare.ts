/**
 * COMPARAÇÃO DE PROPOSTAS — revisão contra revisão, técnica contra comercial.
 *
 * Tudo aqui é aritmética sobre o que está REGISTRADO: campos da revisão e
 * fatos extraídos com proveniência. Não há leitura semântica de texto livre:
 * dois parágrafos de escopo diferentes aparecem como "modificado", e quem
 * decide se a mudança importa é uma pessoa. Afirmar "escopo equivalente" a
 * partir de similaridade de texto seria exatamente a verdade inventada que o
 * resto do módulo recusa.
 *
 * Nada aqui escreve. Comparar não substitui a revisão regente: a aceita
 * continua regendo até alguém decidir o contrário, pelo caminho governado.
 */
import type { FactDomain } from './types';

export type ChangeKind = 'added' | 'removed' | 'modified' | 'unchanged';

export interface RevisionLike {
  id: string;
  revision: number;
  status: string;
  total_value: string | number | null;
  currency: string | null;
  validity_until: string | null;
  payment_terms: string | null;
  scope_summary: string | null;
  acceptance_conditions: string | null;
}

export interface FactLike {
  id: string;
  subject_id: string | null;
  fact_domain: FactDomain;
  fact_key?: string | null;
  label: string;
  value_text: string | null;
  value_numeric: string | number | null;
  value_date: string | null;
  unit: string | null;
  currency: string | null;
  corrected_value: string | null;
  confirmation_state: string;
  provenance_state: 'ANCHORED' | 'UNANCHORED';
  source_page: number | null;
}

export interface ComparisonChange {
  key: string;
  label: string;
  kind: ChangeKind;
  before: string | null;
  after: string | null;
  /** Mudança que mexe em preço, prazo, medição, faturamento ou escopo. */
  material: boolean;
  /** Um dos lados é leitura não confirmada — a comparação é provisória. */
  unconfirmed: boolean;
  delta?: string | null;
  domain?: FactDomain | null;
}

/** Domínios cuja alteração muda dinheiro, prazo ou o que será entregue. */
export const MATERIAL_DOMAINS: FactDomain[] = [
  'VALUE', 'RATE', 'UNIT_PRICE', 'PAYMENT_TERM', 'MEASUREMENT_RULE', 'BILLING_MILESTONE',
  'BILLING_PREREQUISITE', 'VALIDITY', 'ACCEPTANCE_CONDITION', 'SCOPE', 'DELIVERABLE',
  'EXCLUSION', 'DATE', 'MILESTONE',
];

const DOMAIN_LABEL: Partial<Record<FactDomain, string>> = {
  VALUE: 'Valor', RATE: 'Taxa', UNIT_PRICE: 'Preço unitário', PAYMENT_TERM: 'Pagamento',
  MEASUREMENT_RULE: 'Regra de medição', BILLING_MILESTONE: 'Marco de faturamento',
  BILLING_PREREQUISITE: 'Pré-requisito de faturamento', VALIDITY: 'Validade',
  ACCEPTANCE_CONDITION: 'Condição de aceite', SCOPE: 'Escopo', DELIVERABLE: 'Entregável',
  REQUIREMENT: 'Requisito', EXCLUSION: 'Exclusão', DEPENDENCY: 'Dependência', TEST: 'Ensaio',
  DOCUMENT: 'Documento', DATE: 'Data', MILESTONE: 'Marco', RESOURCE: 'Recurso', RISK: 'Risco',
  OTHER: 'Outro',
};

const norm = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const money = (value: string | number | null, currency: string | null): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: currency || 'BRL', maximumFractionDigits: 0,
  }).format(n);
};

const dayLabel = (value: string | null): string | null =>
  value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : null;

export function factValue(fact: FactLike): string | null {
  if (fact.corrected_value) return fact.corrected_value;
  if (fact.value_numeric !== null && fact.value_numeric !== undefined && fact.value_numeric !== '') {
    return fact.currency
      ? money(fact.value_numeric, fact.currency)
      : `${Number(fact.value_numeric).toLocaleString('pt-BR')}${fact.unit ? ` ${fact.unit}` : ''}`;
  }
  if (fact.value_date) return dayLabel(fact.value_date);
  return fact.value_text?.trim() || null;
}

const factIdentity = (fact: FactLike): string =>
  `${fact.fact_domain}:${norm(fact.fact_key) || norm(fact.label)}`;

const isUnconfirmed = (fact?: FactLike): boolean =>
  Boolean(fact && !['CONFIRMED', 'CORRECTED'].includes(fact.confirmation_state));

function fieldChange(
  key: string, label: string, before: string | null, after: string | null, material: boolean,
  delta?: string | null,
): ComparisonChange {
  const kind: ChangeKind = before === null && after === null ? 'unchanged'
    : before === null ? 'added'
    : after === null ? 'removed'
    : norm(before) === norm(after) ? 'unchanged' : 'modified';
  return { key, label, kind, before, after, material: material && kind !== 'unchanged', unconfirmed: false, delta: delta ?? null };
}

/**
 * Rev anterior → Rev atual. Campos da revisão primeiro (é o que o documento
 * declara em cabeçalho), depois os fatos pareados por domínio + chave.
 */
export function compareRevisions(
  previous: RevisionLike, current: RevisionLike, facts: FactLike[],
): ComparisonChange[] {
  const changes: ComparisonChange[] = [];
  const prevValue = previous.total_value === null ? null : Number(previous.total_value);
  const currValue = current.total_value === null ? null : Number(current.total_value);
  let delta: string | null = null;
  if (prevValue !== null && currValue !== null && Number.isFinite(prevValue) && Number.isFinite(currValue)
      && prevValue !== currValue) {
    const diff = currValue - prevValue;
    const pct = prevValue !== 0 ? ` (${diff > 0 ? '+' : ''}${((diff / prevValue) * 100).toFixed(1)}%)` : '';
    delta = `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), current.currency ?? previous.currency)}${pct}`;
  }
  changes.push(fieldChange('total_value', 'Valor total',
    money(previous.total_value, previous.currency), money(current.total_value, current.currency), true, delta));
  changes.push(fieldChange('payment_terms', 'Condição de pagamento',
    previous.payment_terms, current.payment_terms, true));

  let validityDelta: string | null = null;
  if (previous.validity_until && current.validity_until) {
    const days = Math.round((Date.parse(current.validity_until) - Date.parse(previous.validity_until)) / 86_400_000);
    if (days !== 0) validityDelta = `${days > 0 ? '+' : ''}${days} dias`;
  }
  changes.push(fieldChange('validity_until', 'Validade',
    dayLabel(previous.validity_until), dayLabel(current.validity_until), true, validityDelta));
  changes.push(fieldChange('scope_summary', 'Resumo de escopo', previous.scope_summary, current.scope_summary, true));
  changes.push(fieldChange('acceptance_conditions', 'Condições de aceite',
    previous.acceptance_conditions, current.acceptance_conditions, true));

  const byRevision = (revisionId: string) => {
    const map = new Map<string, FactLike>();
    for (const fact of facts) {
      if (fact.subject_id !== revisionId || fact.confirmation_state === 'REJECTED') continue;
      map.set(factIdentity(fact), fact);
    }
    return map;
  };
  const before = byRevision(previous.id);
  const after = byRevision(current.id);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key);
    const b = after.get(key);
    const domain = (b ?? a)!.fact_domain;
    const change = fieldChange(`fact:${key}`,
      `${DOMAIN_LABEL[domain] ?? domain} · ${(b ?? a)!.label}`,
      a ? factValue(a) : null, b ? factValue(b) : null, MATERIAL_DOMAINS.includes(domain));
    change.unconfirmed = isUnconfirmed(a) || isUnconfirmed(b);
    change.domain = domain;
    changes.push(change);
  }

  const order: Record<ChangeKind, number> = { modified: 0, added: 1, removed: 2, unchanged: 3 };
  return changes.sort((x, y) =>
    order[x.kind] - order[y.kind] || Number(y.material) - Number(x.material));
}

export interface CrossCheckFinding {
  key: string;
  label: string;
  severity: 'attention' | 'info';
  detail: string;
}

/**
 * Técnica × Comercial. Só afirma o que é conferível em número ou presença:
 * valores declarados diferentes, validades diferentes, regra de medição sem
 * entregável que a sustente, marcos de faturamento sem marcos técnicos. Não
 * afirma que os escopos "batem" — isso é leitura de gente.
 */
export function crossCheckTechnicalCommercial(input: {
  technical: RevisionLike | null;
  commercial: RevisionLike | null;
  facts: FactLike[];
}): CrossCheckFinding[] {
  const { technical, commercial, facts } = input;
  if (!technical || !commercial) return [];
  const findings: CrossCheckFinding[] = [];
  const of = (revisionId: string, domains: FactDomain[]) =>
    facts.filter((f) => f.subject_id === revisionId && domains.includes(f.fact_domain)
      && f.confirmation_state !== 'REJECTED');

  const tv = technical.total_value === null ? null : Number(technical.total_value);
  const cv = commercial.total_value === null ? null : Number(commercial.total_value);
  if (tv !== null && cv !== null && tv !== cv) {
    findings.push({ key: 'value', label: 'Valor', severity: 'attention',
      detail: `PT declara ${money(tv, technical.currency)}; PC declara ${money(cv, commercial.currency)}. O valor que rege é o da comercial.` });
  }
  if (technical.validity_until && commercial.validity_until && technical.validity_until !== commercial.validity_until) {
    findings.push({ key: 'validity', label: 'Validade', severity: 'attention',
      detail: `PT válida até ${dayLabel(technical.validity_until)}; PC até ${dayLabel(commercial.validity_until)}.` });
  }
  const measurement = of(commercial.id, ['MEASUREMENT_RULE']);
  const deliverables = of(technical.id, ['DELIVERABLE', 'MILESTONE']);
  if (measurement.length && !deliverables.length) {
    findings.push({ key: 'measurement', label: 'Medição sem entregável', severity: 'attention',
      detail: `A PC define ${measurement.length} regra(s) de medição; a PT não registra entregável ou marco que as sustente.` });
  }
  const billing = of(commercial.id, ['BILLING_MILESTONE']);
  const milestones = of(technical.id, ['MILESTONE', 'DATE']);
  if (billing.length && !milestones.length) {
    findings.push({ key: 'billing', label: 'Marcos de faturamento', severity: 'info',
      detail: `A PC define ${billing.length} marco(s) de faturamento; a PT não registra marco técnico com data.` });
  }
  if (!technical.scope_summary && !of(technical.id, ['SCOPE']).length) {
    findings.push({ key: 'scope', label: 'Escopo técnico', severity: 'attention',
      detail: 'A PT não tem escopo registrado — nem resumo, nem fato extraído.' });
  }
  const unconfirmed = facts.filter((f) =>
    (f.subject_id === technical.id || f.subject_id === commercial.id) && f.confirmation_state === 'UNCONFIRMED').length;
  if (unconfirmed) {
    findings.push({ key: 'unconfirmed', label: 'Fatos não confirmados', severity: 'info',
      detail: `${unconfirmed} fato(s) lido(s) ainda sem confirmação humana — a comparação é provisória.` });
  }
  return findings;
}

export interface MaterialHighlight {
  key: 'value' | 'payment' | 'validity' | 'scope' | 'measurement' | 'acceptance';
  label: string;
  detail: string;
  tone: 'up' | 'down' | 'neutral';
}

const days = (text: string | null) => {
  const m = (text ?? '').match(/(\d{1,3})\s*(?:\([^)]*\)\s*)?dias?/i);
  return m ? Number(m[1]) : null;
};

/**
 * O que mudou de material, numa linha de chips: "Valor −R$ 70 mil ·
 * Pagamento 30 → 45 dias · Validade +15 dias · Escopo alterado · Medição
 * alterada". Aritmética sobre `compareRevisions`; nada de leitura semântica.
 */
export function materialHighlights(changes: ComparisonChange[]): MaterialHighlight[] {
  const out: MaterialHighlight[] = [];
  const changed = (c: ComparisonChange) => c.kind !== 'unchanged';
  const value = changes.find((c) => c.key === 'total_value' && changed(c));
  if (value) {
    out.push({ key: 'value', label: 'Valor',
      detail: value.delta ?? `${value.before ?? '—'} → ${value.after ?? '—'}`,
      tone: value.delta?.startsWith('+') ? 'up' : value.delta ? 'down' : 'neutral' });
  }
  const payment = changes.find((c) => c.key === 'payment_terms' && changed(c));
  if (payment) {
    const a = days(payment.before);
    const b = days(payment.after);
    out.push({ key: 'payment', label: 'Pagamento',
      detail: a !== null && b !== null && a !== b ? `${a} → ${b} dias` : 'condição alterada', tone: 'neutral' });
  }
  const validity = changes.find((c) => c.key === 'validity_until' && changed(c));
  if (validity) {
    out.push({ key: 'validity', label: 'Validade', detail: validity.delta ?? `${validity.before ?? '—'} → ${validity.after ?? '—'}`,
      tone: validity.delta?.startsWith('+') ? 'up' : 'neutral' });
  }
  if (changes.some((c) => changed(c) && (c.key === 'scope_summary' || ['SCOPE', 'DELIVERABLE', 'EXCLUSION', 'REQUIREMENT'].includes(c.domain ?? '')))) {
    out.push({ key: 'scope', label: 'Escopo', detail: 'alterado', tone: 'neutral' });
  }
  if (changes.some((c) => changed(c) && ['MEASUREMENT_RULE', 'BILLING_MILESTONE', 'BILLING_PREREQUISITE'].includes(c.domain ?? ''))) {
    out.push({ key: 'measurement', label: 'Regra de medição', detail: 'alterada', tone: 'neutral' });
  }
  if (changes.some((c) => changed(c) && (c.key === 'acceptance_conditions' || c.domain === 'ACCEPTANCE_CONDITION'))) {
    out.push({ key: 'acceptance', label: 'Condições de aceite', detail: 'alteradas', tone: 'neutral' });
  }
  return out;
}
