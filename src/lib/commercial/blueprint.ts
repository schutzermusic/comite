/**
 * Do FATO lido ao item de BLUEPRINT — um mapeamento, não uma interpretação.
 *
 * Cada domínio de fato cai numa categoria de blueprint fixa; o item carrega o
 * id do fato de origem e a confiança dele. Fato rejeitado não entra; fato não
 * confirmado entra marcado pela própria origem, e o blueprint continua sendo
 * planejamento até a revisão ser aceita e autorizada.
 */
import type { FactDomain } from './types';

export type BlueprintCategory =
  | 'SCOPE' | 'DELIVERABLE' | 'REQUIREMENT' | 'MEASUREMENT_RULE' | 'EVIDENCE_REQUIREMENT'
  | 'DATE' | 'DEPENDENCY' | 'BILLING_CONDITION' | 'RISK';

export const BLUEPRINT_CATEGORY_LABEL: Record<BlueprintCategory, string> = {
  SCOPE: 'Escopo',
  DELIVERABLE: 'Entregáveis',
  REQUIREMENT: 'Requisitos',
  MEASUREMENT_RULE: 'Modelo de medição',
  EVIDENCE_REQUIREMENT: 'Evidência esperada',
  DATE: 'Datas e marcos',
  DEPENDENCY: 'Dependências',
  BILLING_CONDITION: 'Condições comerciais',
  RISK: 'Riscos e exclusões',
};

export const DOMAIN_TO_CATEGORY: Partial<Record<FactDomain, BlueprintCategory>> = {
  SCOPE: 'SCOPE', DELIVERABLE: 'DELIVERABLE', REQUIREMENT: 'REQUIREMENT', TEST: 'REQUIREMENT',
  RESOURCE: 'REQUIREMENT', MEASUREMENT_RULE: 'MEASUREMENT_RULE', DOCUMENT: 'EVIDENCE_REQUIREMENT',
  ACCEPTANCE_CONDITION: 'EVIDENCE_REQUIREMENT', DATE: 'DATE', MILESTONE: 'DATE', VALIDITY: 'DATE',
  DEPENDENCY: 'DEPENDENCY', PAYMENT_TERM: 'BILLING_CONDITION', BILLING_MILESTONE: 'BILLING_CONDITION',
  BILLING_PREREQUISITE: 'BILLING_CONDITION', VALUE: 'BILLING_CONDITION', RATE: 'BILLING_CONDITION',
  UNIT_PRICE: 'BILLING_CONDITION', RISK: 'RISK', EXCLUSION: 'RISK',
};

export interface BlueprintFact {
  id: string; fact_domain: FactDomain; label: string; value_text: string | null;
  value_numeric: string | number | null; value_date: string | null; unit: string | null;
  currency: string | null; corrected_value: string | null; confidence: string | number | null;
  confirmation_state: string;
}

export function blueprintItemsFromFacts(facts: BlueprintFact[]) {
  return facts
    .filter((fact) => fact.confirmation_state !== 'REJECTED' && DOMAIN_TO_CATEGORY[fact.fact_domain])
    .map((fact) => {
      const value = fact.corrected_value ?? fact.value_text
        ?? (fact.value_numeric !== null && fact.value_numeric !== undefined
          ? `${fact.value_numeric}${fact.currency ? ` ${fact.currency}` : fact.unit ? ` ${fact.unit}` : ''}` : null)
        ?? fact.value_date;
      return {
        category: DOMAIN_TO_CATEGORY[fact.fact_domain]!,
        title: fact.label,
        detail: value,
        source_fact_id: fact.id,
        confidence: fact.confidence === null || fact.confidence === undefined ? null : Number(fact.confidence),
        suggested_payload: { confirmation_state: fact.confirmation_state, fact_domain: fact.fact_domain },
      };
    });
}
