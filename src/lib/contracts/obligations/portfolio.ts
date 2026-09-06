/**
 * A carteira de obrigações — o que precisa de atenção, em uma lista só.
 *
 * Lógica pura, sem JSX e sem I/O: recebe o resolvido de cada contrato e
 * devolve a lista ordenada por urgência. É a mesma resposta do resolvedor,
 * apenas achatada para caber numa tela.
 *
 * Nenhuma faixa é escondida quando está zerada. Uma torre que some com
 * "em atraso: 0" obriga o operador a lembrar que a faixa existe.
 */
import type {
  ContractObligationsAsOf, ObligationResponsibleSide, ObligationUrgency, Tristate,
} from './types';

export interface ObligationAttentionRow {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly contractId: string;
  readonly contractTitle: string;
  readonly title: string;
  readonly occurrenceKey: string;
  readonly responsibleSide: ObligationResponsibleSide;
  /** Quem o contrato obriga — texto ou Party, o que houver. */
  readonly obligor: string | null;
  readonly dueDate: string | null;
  readonly dueConfidence: 'known' | 'unknown';
  readonly dueBasis: string | null;
  readonly urgency: ObligationUrgency;
  readonly evidenceComplete: Tristate;
  readonly blocksBilling: Tristate;
  readonly hasEffectiveException: boolean;
  readonly escalationSeverity: 'low' | 'medium' | 'high' | 'critical' | null;
  readonly provenance: { clauseId: string | null; documentId: string | null; page: number | null };
}

export interface ObligationPortfolio {
  readonly rows: readonly ObligationAttentionRow[];
  readonly counts: Record<ObligationUrgency, number>;
  /** Contratos onde o bloqueio de faturamento não pôde ser determinado. */
  readonly billingUnknownContracts: readonly string[];
  readonly billingBlockedContracts: readonly string[];
  /** Contratos sem NENHUMA obrigação estruturada — lacuna, não saúde. */
  readonly contractsWithoutObligations: readonly string[];
  readonly asOf: string;
}

/** Atrasada antes de vencendo, vencendo antes de desconhecida, e assim por diante. */
const URGENCY_RANK: Record<ObligationUrgency, number> = {
  OVERDUE: 0, DUE: 1, UNKNOWN: 2, UPCOMING: 3, NOT_APPLICABLE: 4,
};

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function buildObligationPortfolio(
  resolved: readonly (ContractObligationsAsOf & { contractTitle: string })[],
  asOf: string,
): ObligationPortfolio {
  const rows: ObligationAttentionRow[] = [];
  const billingUnknownContracts: string[] = [];
  const billingBlockedContracts: string[] = [];
  const contractsWithoutObligations: string[] = [];
  const counts: Record<ObligationUrgency, number> = {
    OVERDUE: 0, DUE: 0, UPCOMING: 0, UNKNOWN: 0, NOT_APPLICABLE: 0,
  };

  for (const contract of resolved) {
    if (contract.obligations.length === 0) {
      contractsWithoutObligations.push(contract.contractTitle);
      continue;
    }
    if (contract.billingBlock.state === 'TRUE') billingBlockedContracts.push(contract.contractTitle);
    if (contract.billingBlock.state === 'UNKNOWN') billingUnknownContracts.push(contract.contractTitle);

    for (const obligation of contract.obligations) {
      // Definição que não vigora na data não entra na lista de atenção: ela
      // não pede nada de ninguém hoje. Vigência DESCONHECIDA entra, porque
      // "não se sabe se vale" é exatamente o que precisa de atenção.
      if (obligation.effective === 'FALSE') continue;

      const obligor = obligation.definition.parties.find((p) => p.role === 'obligor');
      for (const instance of obligation.instances) {
        counts[instance.urgency] += 1;
        if (instance.urgency === 'NOT_APPLICABLE') continue;

        const applicable = instance.escalations.filter((e) => e.applicable);
        rows.push({
          instanceId: instance.id,
          definitionId: obligation.definition.id,
          contractId: contract.contractId,
          contractTitle: contract.contractTitle,
          title: obligation.definition.title,
          occurrenceKey: instance.occurrenceKey,
          responsibleSide: obligation.definition.responsibleSide,
          obligor: obligor?.partyLegalName ?? obligor?.partyText ?? null,
          dueDate: instance.dueDate,
          dueConfidence: instance.dueConfidence,
          dueBasis: instance.dueBasis,
          urgency: instance.urgency,
          evidenceComplete: instance.evidenceComplete,
          blocksBilling: instance.blocksBilling,
          hasEffectiveException: instance.exceptions.some((e) => e.effective),
          escalationSeverity: applicable.length
            ? applicable.reduce((worst, e) => SEVERITY_RANK[e.severity] < SEVERITY_RANK[worst] ? e.severity : worst,
                applicable[0].severity)
            : null,
          provenance: {
            clauseId: obligation.definition.provenance.clauseId,
            documentId: obligation.definition.provenance.documentId,
            page: obligation.definition.provenance.page,
          },
        });
      }
    }
  }

  rows.sort((a, b) =>
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    // Sem prazo vai para o fim da própria faixa, não para o topo.
    (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
    a.contractTitle.localeCompare(b.contractTitle));

  return { rows, counts, billingUnknownContracts, billingBlockedContracts, contractsWithoutObligations, asOf };
}
