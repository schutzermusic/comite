/**
 * OS × PT × PC — a comparação que a revisão humana precisa ver, derivada e
 * pura (nada é gravado aqui).
 *
 * Cada linha da comparação cai em UMA situação:
 *  - `conflicting`: há divergência em aberto (regra, IA ou pessoa) — os dois
 *    valores lado a lado; só a decisão de qual fonte prevalece a fecha;
 *  - `uncertain`: linha LIDA do documento, ainda não confirmada, com leitura
 *    de baixa confiança — pode estar certa, mas ninguém deveria agir sobre ela;
 *  - `aligned`: a OS traz o que a proposta declara (vínculo direto ao fato,
 *    ou correspondência pelo título dentro da mesma dimensão);
 *  - `additional`: a OS traz algo que a proposta não declara;
 *  - `missing`: a proposta declara algo que a OS não traz (ou que foi retirado).
 *
 * A correspondência por título é uma AJUDA de leitura, dita como tal; a fonte
 * de verdade das diferenças materiais continua sendo o registro de
 * divergências confrontado com a fonte regente.
 */
import type { DivergenceScope, DivergenceSeverity } from '@/lib/commercial/types';
import type { ServiceOrderDivergence, ServiceOrderItem, ServiceOrderItemKind } from './types';

export type ComparisonStatus = 'aligned' | 'missing' | 'additional' | 'conflicting' | 'uncertain';
export type ComparisonDimension = 'scope' | 'deliverables' | 'resources' | 'dependencies' | 'exclusions' | 'dates' | 'commercial' | 'other';

export const DIMENSION_LABEL: Record<ComparisonDimension, string> = {
  scope: 'Escopo e atividades', deliverables: 'Entregáveis, testes e documentos', resources: 'Materiais, equipamentos e requisitos',
  dependencies: 'Dependências do cliente e premissas', exclusions: 'Exclusões', dates: 'Datas e marcos',
  commercial: 'Valor e condições comerciais', other: 'Riscos e outros',
};
export const DIMENSION_ORDER: ComparisonDimension[] = ['commercial', 'scope', 'deliverables', 'resources', 'dates', 'dependencies', 'exclusions', 'other'];
export const STATUS_LABEL: Record<ComparisonStatus, string> = {
  conflicting: 'Conflitante', uncertain: 'Incerto', missing: 'Faltando na OS', additional: 'Adicional na OS', aligned: 'Alinhado',
};

/** Um fato lido da PT ou da PC (commercial_extracted_facts do pacote regente). */
export interface PackageFact {
  id: string;
  document_context: string;
  fact_domain: string;
  label: string;
  value_text: string | null;
  value_numeric: string | number | null;
  value_date: string | null;
  unit: string | null;
  currency: string | null;
  source_page: number | null;
  source_quote: string | null;
  confidence: string | number | null;
  extraction_method: string;
  ai_model: string | null;
  confirmation_state: string;
}

export interface ComparisonSide {
  ref: string; label: string; value: string | null;
  page: number | null; quote: string | null; confidence: number | null; model: string | null;
}

export interface ComparisonRow {
  id: string;
  dimension: ComparisonDimension;
  status: ComparisonStatus;
  os: ComparisonSide | null;
  pt: ComparisonSide | null;
  pc: ComparisonSide | null;
  itemId?: string;
  itemState?: string;
  divergenceId?: string;
  severity?: DivergenceSeverity;
  note: string;
}

const KIND_DIMENSION: Record<ServiceOrderItemKind, ComparisonDimension> = {
  SCOPE: 'scope', ACTIVITY: 'scope', DELIVERABLE: 'deliverables', TEST: 'deliverables', DOCUMENT: 'deliverables',
  MATERIAL: 'resources', EQUIPMENT: 'resources', WORKFORCE: 'resources', RESOURCE: 'resources', TECHNICAL_REQUIREMENT: 'resources',
  CUSTOMER_DEPENDENCY: 'dependencies', ASSUMPTION: 'dependencies', EXCLUSION: 'exclusions', MILESTONE: 'dates',
  COMMERCIAL_REFERENCE: 'commercial', MEASUREMENT_CONDITION: 'commercial', RISK: 'other',
};
const DOMAIN_DIMENSION: Record<string, ComparisonDimension> = {
  SCOPE: 'scope', DELIVERABLE: 'deliverables', TEST: 'deliverables', DOCUMENT: 'deliverables',
  RESOURCE: 'resources', REQUIREMENT: 'resources', DEPENDENCY: 'dependencies', EXCLUSION: 'exclusions',
  DATE: 'dates', MILESTONE: 'dates',
  VALUE: 'commercial', RATE: 'commercial', UNIT_PRICE: 'commercial', PAYMENT_TERM: 'commercial', MEASUREMENT_RULE: 'commercial',
  BILLING_MILESTONE: 'commercial', BILLING_PREREQUISITE: 'commercial', VALIDITY: 'commercial', ACCEPTANCE_CONDITION: 'commercial',
  RISK: 'other', OTHER: 'other',
};
const SCOPE_DIMENSION: Record<DivergenceScope, ComparisonDimension> = {
  VALUE: 'commercial', MEASUREMENT_RULE: 'commercial', BILLING_CONDITION: 'commercial', PAYMENT_TERMS: 'commercial',
  COMMERCIAL_REFERENCE: 'commercial', DATES: 'dates', SCOPE: 'scope', DELIVERABLE: 'deliverables', EVIDENCE_REQUIREMENT: 'deliverables',
  TECHNICAL_REQUIREMENT: 'resources', MATERIAL: 'resources', CUSTOMER_DEPENDENCY: 'dependencies', EXCLUSION: 'exclusions',
  PACKAGE_REVISION: 'other', OTHER: 'other',
};
/** Divergência técnica compara com a PT; comercial, com a PC. */
const TECHNICAL_SCOPES = new Set<DivergenceScope>(['SCOPE', 'DATES', 'DELIVERABLE', 'EVIDENCE_REQUIREMENT', 'TECHNICAL_REQUIREMENT',
  'MATERIAL', 'CUSTOMER_DEPENDENCY', 'EXCLUSION']);

/** Leitura abaixo disto, ainda sem confirmação humana, é "incerta". */
export const UNCERTAIN_BELOW = 0.7;

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'para', 'com', 'por', 'no', 'na', 'nos', 'nas', 'um', 'uma']);
const tokens = (s: string) => new Set(s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)));

/** Semelhança de títulos (Jaccard dos termos) — só para sugerir o par, nunca para decidir. */
export function titleSimilarity(a: string, b: string): number {
  const x = tokens(a); const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter += 1;
  const union = x.size + y.size - inter;
  const containment = inter / Math.min(x.size, y.size);
  return Math.max(inter / union, containment >= 1 && Math.min(x.size, y.size) >= 2 ? 0.75 : 0);
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Valor de um lado da divergência como a pessoa lê: o de VALOR em moeda, o resto como veio. */
export function divergenceValueText(d: Pick<ServiceOrderDivergence, 'field_path'>, value: string | null, currency: string | null): string {
  if (value === null) return 'não declara';
  const n = num(value);
  return d.field_path === 'authorized_value' && n !== null && Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: currency ?? 'BRL' }) : value;
}
const factValue = (f: PackageFact): string | null => {
  if (f.value_numeric !== null && f.value_numeric !== undefined && f.value_numeric !== '') {
    const n = Number(f.value_numeric);
    return f.currency ? n.toLocaleString('pt-BR', { style: 'currency', currency: f.currency })
      : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}${f.unit ? ` ${f.unit}` : ''}`;
  }
  if (f.value_date) return f.value_date.split('-').reverse().join('/');
  return f.value_text && f.value_text !== f.label ? f.value_text : null;
};
const factSide = (f: PackageFact): ComparisonSide => ({
  ref: f.id, label: f.label, value: factValue(f), page: f.source_page, quote: f.source_quote,
  confidence: num(f.confidence), model: f.ai_model,
});
/** "3420000.0000 BRL" (como a leitura grava valor) vira moeda; o resto passa como veio. */
const moneyText = (text: string | null): string | null => {
  const m = text?.match(/^\s*(-?\d+(?:\.\d+)?)\s+([A-Z]{3})\s*$/);
  return m ? Number(m[1]).toLocaleString('pt-BR', { style: 'currency', currency: m[2] }) : text;
};
const itemSide = (i: ServiceOrderItem): ComparisonSide => ({
  ref: i.id, label: i.title,
  value: [i.detail && i.detail !== i.title ? moneyText(i.detail) : null,
    i.quantity ? `${Number(i.quantity).toLocaleString('pt-BR')} ${i.unit ?? ''}`.trim() : null,
    i.planned_date ? i.planned_date.split('-').reverse().join('/') : null].filter(Boolean).join(' · ') || null,
  page: i.source_page, quote: i.source_quote, confidence: num(i.confidence), model: i.ai_model,
});
const isPT = (f: PackageFact) => f.document_context === 'TECHNICAL_PROPOSAL';

export function buildServiceOrderComparison(input: {
  items: ServiceOrderItem[];
  facts?: PackageFact[] | null;
  divergences: ServiceOrderDivergence[];
  authorizedValue: string | null;
  currency: string | null;
}): ComparisonRow[] {
  const facts = (input.facts ?? []).filter((f) => f.confirmation_state !== 'REJECTED');
  const rows: ComparisonRow[] = [];
  const usedFacts = new Set<string>();

  // 1. Divergências em aberto: a pergunta material, com os dois valores.
  const currency = input.currency ?? 'BRL';
  const asMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency });
  for (const d of input.divergences.filter((x) => x.state === 'OPEN' || x.state === 'ACKNOWLEDGED')) {
    const isValue = d.field_path === 'authorized_value';
    const shown = (v: string | null) => divergenceValueText(d, v, currency);
    const left = { ref: `${d.id}:l`, label: shown(d.left_value), value: null, page: null, quote: null, confidence: null, model: null };
    const right = { ref: `${d.id}:r`, label: shown(d.right_value), value: null, page: null, quote: null, confidence: null, model: null };
    const osOnRight = d.right_source_kind === 'internal_service_order';
    const osSide = osOnRight ? right : d.left_source_kind === 'internal_service_order' ? left : null;
    const srcSide = osSide === right ? left : right;
    const technical = TECHNICAL_SCOPES.has(d.scope);
    // Valor: diga a diferença, não só os dois números.
    const osNum = num(osOnRight ? d.right_value : d.left_value);
    const srcNum = num(osOnRight ? d.left_value : d.right_value);
    const note = isValue && osNum !== null && srcNum !== null && srcNum !== 0
      ? `A OS declara ${asMoney(osNum)}; a fonte regente, ${asMoney(srcNum)} — ${asMoney(Math.abs(osNum - srcNum))} ${osNum > srcNum ? 'acima' : 'abaixo'} (${osNum > srcNum ? '+' : '−'}${Math.abs(((osNum - srcNum) / srcNum) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%).`
      : d.summary;
    rows.push({
      id: `div:${d.id}`, dimension: isValue ? 'commercial' : SCOPE_DIMENSION[d.scope] ?? 'other',
      status: 'conflicting', os: osSide, pt: technical ? srcSide : null, pc: technical ? null : srcSide,
      divergenceId: d.id, severity: d.severity, note,
    });
    if (d.field_path === 'authorized_value') {
      for (const f of facts.filter((x) => x.fact_domain === 'VALUE')) usedFacts.add(f.id);
    }
  }
  const valueInConflict = rows.some((r) => r.dimension === 'commercial' && r.status === 'conflicting');

  // 2. Linhas da OS: vínculo direto ao fato do pacote, ou par por semelhança.
  for (const i of input.items) {
    const dimension = KIND_DIMENSION[i.kind] ?? 'other';
    const linked = i.source_fact_id ? facts.find((f) => f.id === i.source_fact_id) ?? null : null;
    let pair = linked;
    if (!pair && i.origin !== 'proposal_package') {
      let best = 0;
      for (const f of facts) {
        if (usedFacts.has(f.id) || (DOMAIN_DIMENSION[f.fact_domain] ?? 'other') !== dimension) continue;
        const s = titleSimilarity(i.title, `${f.label} ${f.value_text ?? ''}`);
        if (s > best && s >= 0.45) { best = s; pair = f; }
      }
    }
    if (pair) usedFacts.add(pair.id);
    const confidence = num(i.confidence);
    const read = i.origin === 'document_extraction' || (i.ai_model !== null && i.origin !== 'manual' && i.origin !== 'proposal_package');
    const uncertain = read && i.confirmation_state === 'UNCONFIRMED' && confidence !== null && confidence < UNCERTAIN_BELOW;
    const rejected = i.confirmation_state === 'REJECTED';
    const status: ComparisonStatus = uncertain ? 'uncertain' : rejected ? (pair ? 'missing' : 'additional')
      : pair || i.origin === 'proposal_package' ? 'aligned' : 'additional';
    rows.push({
      id: `item:${i.id}`, dimension, status, os: rejected ? null : itemSide(i),
      pt: pair && isPT(pair) ? factSide(pair) : null, pc: pair && !isPT(pair) ? factSide(pair) : null,
      itemId: i.id, itemState: i.confirmation_state,
      note: uncertain ? `Leitura com ${Math.round((confidence ?? 0) * 100)}% de confiança — confirme ou retire antes de emitir.`
        : rejected ? 'Retirado da OS na revisão.'
          : status === 'additional' ? (i.origin === 'manual' ? 'Incluído à mão — a proposta não declara.' : 'A OS traz — a proposta aceita não declara.')
            : linked ? 'Veio do pacote aceito.'
              : pair ? `Bate com a ${isPT(pair) ? 'PT' : 'PC'} pelo título — ${i.confirmation_state === 'UNCONFIRMED' ? 'confira e confirme a leitura' : 'confira o conteúdo'}.`
                : 'Veio do pacote aceito.',
    });
  }

  // 3. O valor comercial é um CAMPO da OS, não uma linha: compara com o valor autorizado.
  const osValue = num(input.authorizedValue);
  for (const f of facts.filter((x) => x.fact_domain === 'VALUE' && !usedFacts.has(x.id))) {
    usedFacts.add(f.id);
    if (valueInConflict) continue;
    const same = osValue !== null && num(f.value_numeric) !== null && Math.abs((num(f.value_numeric) ?? 0) - osValue) < 0.005;
    rows.push({
      id: `fact:${f.id}`, dimension: 'commercial', status: osValue === null ? 'missing' : same ? 'aligned' : 'conflicting',
      os: osValue === null ? null : { ref: 'authorized_value', label: 'Valor autorizado', value: osValue.toLocaleString('pt-BR', { style: 'currency', currency: input.currency ?? 'BRL' }),
        page: null, quote: null, confidence: null, model: null },
      pt: isPT(f) ? factSide(f) : null, pc: isPT(f) ? null : factSide(f),
      note: osValue === null ? 'A OS ainda não declara valor autorizado.' : same ? 'O valor autorizado da OS é o da proposta aceita.'
        : 'Valor da OS difere do aceito — confronte com a fonte regente para registrar a divergência.',
    });
  }

  // 4. O que a proposta declara e a OS não traz.
  for (const f of facts.filter((x) => !usedFacts.has(x.id))) {
    rows.push({
      id: `fact:${f.id}`, dimension: DOMAIN_DIMENSION[f.fact_domain] ?? 'other', status: 'missing', os: null,
      pt: isPT(f) ? factSide(f) : null, pc: isPT(f) ? null : factSide(f), note: 'A proposta aceita declara — a OS não traz.',
    });
  }

  const rank: Record<ComparisonStatus, number> = { conflicting: 0, uncertain: 1, missing: 2, additional: 3, aligned: 4 };
  return rows.sort((a, b) => DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension) || rank[a.status] - rank[b.status]);
}

export function comparisonCounts(rows: ComparisonRow[]): Record<ComparisonStatus, number> {
  const out: Record<ComparisonStatus, number> = { conflicting: 0, uncertain: 0, missing: 0, additional: 0, aligned: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}
