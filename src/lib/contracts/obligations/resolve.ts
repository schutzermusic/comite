/**
 * Resolvedor canônico de obrigações — `resolveContractObligationsAsOf`.
 *
 * ─── Por que UM resolvedor ─────────────────────────────────────────────────
 *
 * Cinco telas precisam responder "esta obrigação está atrasada?", e cinco
 * respostas independentes acabam divergindo — foi isso que a torre de
 * obrigações da lista legada já mostrava. Aqui a pergunta é respondida uma vez,
 * a partir dos fatos gravados, e todo mundo lê a mesma resposta.
 *
 * ─── Lógica pura ───────────────────────────────────────────────────────────
 *
 * Nada aqui faz I/O. A leitura do banco entrega as linhas; este arquivo as
 * interpreta. É o que permite testar cada regra — véspera, dia do vencimento,
 * dispensa vencida, dependência não resolvida — sem um banco por perto.
 *
 * ─── A regra que governa todas as outras ───────────────────────────────────
 *
 * Ausência nunca vira afirmação. Prazo desconhecido não vira "no prazo";
 * `blocks_billing` não apurado não vira "não bloqueia"; evidência ausente não
 * vira dispensa; vencimento passado não vira cumprimento. Onde não se sabe, a
 * resposta é `UNKNOWN` — e `UNKNOWN` é uma resposta, não uma falha.
 */
import type {
  ContractObligationsAsOf, ObligationDependencyState, ObligationEscalation,
  ObligationEvidence, ObligationEvidenceRequirement, ObligationException,
  ObligationInstanceState, ObligationInstanceView, ObligationUrgency,
  ResolvedObligation, Tristate,
} from './types';

const DAY = 86_400_000;

/** Compara datas ISO (YYYY-MM-DD) sem fuso: o dia é o dia, em qualquer máquina. */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** Estados em que a ocorrência já não pede nada de ninguém. */
const CLOSED: ReadonlySet<ObligationInstanceState> = new Set(['SATISFIED', 'WAIVED', 'CANCELLED']);

/**
 * Vigência da definição na data de referência.
 *
 * `effectiveFrom` nulo é DESCONHECIDO. Tratá-lo como "desde sempre" faria uma
 * obrigação cuja data de início ninguém leu aparecer como vigente hoje — que é
 * precisamente a afirmação que não se pode fazer.
 */
export function definitionEffectiveAsOf(
  definition: { effectiveFrom: string | null; effectiveTo: string | null; status: string },
  asOf: string,
): Tristate {
  if (definition.status === 'removed') {
    // Removida é histórica: não vigora hoje, e isso SE SABE.
    if (definition.effectiveFrom === null) return 'UNKNOWN';
    return definition.effectiveFrom <= asOf ? 'FALSE' : 'UNKNOWN';
  }
  if (definition.effectiveFrom === null) return 'UNKNOWN';
  if (definition.effectiveFrom > asOf) return 'FALSE';
  if (definition.effectiveTo !== null && definition.effectiveTo < asOf) return 'FALSE';
  return 'TRUE';
}

/**
 * Urgência de uma ocorrência.
 *
 * Ordem deliberada: estado fechado vence tudo (uma obrigação cumprida com
 * atraso já foi tratada, e mantê-la em "atrasada" faria a lista nunca esvaziar);
 * depois a não-ativação; e só então o prazo. Prazo desconhecido é `UNKNOWN`,
 * nunca "no prazo".
 */
export function urgencyOf(
  instance: Pick<ObligationInstanceView, 'state' | 'dueDate' | 'dueConfidence' | 'activationState'>,
  asOf: string,
): ObligationUrgency {
  if (CLOSED.has(instance.state)) return 'NOT_APPLICABLE';
  if (instance.state === 'NOT_ACTIVATED' && instance.activationState !== 'activated') return 'UNKNOWN';
  if (instance.dueConfidence !== 'known' || instance.dueDate === null) return 'UNKNOWN';
  const days = dayDiff(asOf, instance.dueDate);
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'DUE';
  return 'UPCOMING';
}

/**
 * Uma dispensa produz efeito nesta data?
 *
 * Mesma regra do banco (`contract_obligation_exception_is_effective`), repetida
 * aqui porque a interface precisa dela sem ida ao servidor. Os dois lados são
 * cobertos por teste justamente para não divergirem.
 */
export function exceptionEffectiveAsOf(
  exception: Omit<ObligationException, 'effective'>,
  asOf: string,
): boolean {
  const hasAuthority =
    (exception.authorityReference ?? '').trim() !== '' ||
    exception.sourceDocumentId !== null ||
    exception.sourceAmendmentId !== null;
  if (!hasAuthority) return false;
  if (exception.approvalState !== 'not_required' && exception.approvalState !== 'approved') return false;
  if (exception.effectiveFrom !== null && exception.effectiveFrom > asOf) return false;
  if (exception.effectiveTo !== null && exception.effectiveTo < asOf) return false;
  return true;
}

/**
 * A evidência exigida está completa?
 *
 * PRESENÇA NÃO É APROVAÇÃO. Quando o contrato exige aceite formal, um arquivo
 * anexado e não aceito deixa a resposta em `FALSE` — e quando o aceite está
 * pendente, a completude fica `UNKNOWN` em vez de `TRUE`.
 */
export function evidenceCompleteness(
  requirements: readonly ObligationEvidenceRequirement[],
  evidence: readonly ObligationEvidence[],
): Tristate {
  if (requirements.length === 0) return 'UNKNOWN';   // ninguém apurou o que é exigido

  let anyUnknown = false;
  for (const requirement of requirements) {
    const provided = evidence.filter((item) => item.requirementId === requirement.id);
    if (provided.length === 0) {
      // Obrigatória e ausente é FALSO. Sem saber se é obrigatória, é DESCONHECIDO.
      if (requirement.mandatory === true) return 'FALSE';
      anyUnknown = true;
      continue;
    }
    if (requirement.requiredCount !== null && provided.length < requirement.requiredCount) {
      if (requirement.mandatory === true) return 'FALSE';
      anyUnknown = true;
      continue;
    }
    if (requirement.requiresFormalAcceptance) {
      const accepted = provided.some((item) => item.acceptanceState === 'accepted');
      const rejected = provided.some((item) => item.acceptanceState === 'rejected');
      if (rejected) return 'FALSE';
      if (!accepted) { anyUnknown = true; continue; }
    }
  }
  return anyUnknown ? 'UNKNOWN' : 'TRUE';
}

/**
 * Escalonamento aplicável na data de referência.
 *
 * Sem prazo conhecido não há escalonamento por prazo — e isso não é falha da
 * regra, é a consequência honesta de não se saber a data.
 */
export function escalationApplicable(
  rule: Omit<ObligationEscalation, 'applicable'>,
  instance: Pick<ObligationInstanceView, 'state' | 'dueDate' | 'dueConfidence'>,
  asOf: string,
): boolean {
  if (CLOSED.has(instance.state)) return false;
  if (instance.dueConfidence !== 'known' || instance.dueDate === null) return false;
  const daysToDue = dayDiff(asOf, instance.dueDate);
  switch (rule.triggerKind) {
    case 'on_due_date':     return daysToDue === 0;
    case 'days_before_due': return daysToDue >= 0 && daysToDue <= (rule.offsetDays ?? 0);
    case 'days_after_due':  return daysToDue <= -(rule.offsetDays ?? 0) && daysToDue < 0;
  }
}

/**
 * Esta ocorrência bloqueia faturamento?
 *
 * As regras, na ordem em que se aplicam:
 *   · definição não-bloqueadora  → FALSE (esta obrigação não é pré-requisito)
 *   · definição não apurada      → UNKNOWN (nunca FALSE por omissão)
 *   · cumprida ou cancelada      → FALSE (não há pendência)
 *   · dispensa efetiva           → FALSE
 *   · aplicabilidade indeterminada (não ativada, ou prazo desconhecido)
 *                                → UNKNOWN
 *   · pendente e aplicável       → TRUE
 */
export function instanceBlocksBilling(
  definitionBlocks: boolean | null,
  instance: Pick<ObligationInstanceView, 'state' | 'activationState' | 'dueDate' | 'dueConfidence'>,
  effectiveExceptions: readonly ObligationException[],
  asOf: string,
): Tristate {
  if (definitionBlocks === false) return 'FALSE';
  if (definitionBlocks === null) return 'UNKNOWN';

  if (instance.state === 'SATISFIED' || instance.state === 'CANCELLED') return 'FALSE';
  if (instance.state === 'WAIVED' || effectiveExceptions.some((e) => e.effective)) return 'FALSE';

  // Não ativada não é "não aplicável": pode simplesmente não se saber se já
  // valeu. Afirmar que não bloqueia seria liberar faturamento por ignorância.
  if (instance.state === 'NOT_ACTIVATED' || instance.activationState === 'unknown') return 'UNKNOWN';
  void asOf;
  return 'TRUE';
}

/** Combina três estados: um TRUE domina; senão um UNKNOWN domina; senão FALSE. */
function anyTrue(values: readonly Tristate[]): Tristate {
  if (values.includes('TRUE')) return 'TRUE';
  if (values.includes('UNKNOWN')) return 'UNKNOWN';
  return 'FALSE';
}

export interface ResolverInput {
  readonly contractId: string;
  readonly asOf: string;
  readonly obligations: readonly {
    readonly definition: ResolvedObligation['definition'];
    readonly evidenceRequirements: readonly ObligationEvidenceRequirement[];
    readonly instances: readonly (Omit<ObligationInstanceView,
      'urgency' | 'evidenceComplete' | 'blocksBilling' | 'exceptions' | 'escalations' | 'dependencies'> & {
      readonly exceptions: readonly Omit<ObligationException, 'effective'>[];
      readonly escalations: readonly Omit<ObligationEscalation, 'applicable'>[];
      readonly dependencies: readonly ObligationDependencyState[];
    })[];
  }[];
}

export function resolveContractObligationsAsOf(input: ResolverInput): ContractObligationsAsOf {
  const { asOf } = input;
  const blockingInstanceIds: string[] = [];
  const unknownDefinitionIds: string[] = [];
  const counts = { definitions: 0, instances: 0, overdue: 0, due: 0, upcoming: 0, unknown: 0 };

  const obligations: ResolvedObligation[] = input.obligations.map((entry) => {
    const { definition } = entry;
    counts.definitions += 1;
    const effective = definitionEffectiveAsOf(definition, asOf);

    const instances: ObligationInstanceView[] = entry.instances.map((instance) => {
      counts.instances += 1;

      const exceptions: ObligationException[] = instance.exceptions.map((exception) => ({
        ...exception,
        effective: exceptionEffectiveAsOf(exception, asOf),
      }));
      const urgency = urgencyOf(instance, asOf);
      const evidenceComplete = evidenceCompleteness(entry.evidenceRequirements, instance.evidence);
      const escalations: ObligationEscalation[] = instance.escalations.map((rule) => ({
        ...rule,
        applicable: escalationApplicable(rule, instance, asOf),
      }));

      // Uma definição que não vigora na data não pode bloquear nada; se a
      // vigência é DESCONHECIDA, o bloqueio herda o desconhecimento.
      const own = instanceBlocksBilling(definition.blocksBilling, instance, exceptions, asOf);
      const blocksBilling: Tristate =
        effective === 'FALSE' ? 'FALSE' : effective === 'UNKNOWN' && own !== 'FALSE' ? 'UNKNOWN' : own;

      // Dependência não resolvida contamina: não se pode afirmar que uma
      // obrigação está pronta quando não se sabe se o que ela exige aconteceu.
      const dependencyUnknown = instance.dependencies.some((d) => d.satisfied === 'UNKNOWN');
      const finalBlock: Tristate =
        blocksBilling === 'FALSE' && dependencyUnknown && definition.blocksBilling === true
          ? 'UNKNOWN' : blocksBilling;

      if (finalBlock === 'TRUE') blockingInstanceIds.push(instance.id);
      if (finalBlock === 'UNKNOWN') unknownDefinitionIds.push(definition.id);

      if (urgency === 'OVERDUE') counts.overdue += 1;
      else if (urgency === 'DUE') counts.due += 1;
      else if (urgency === 'UPCOMING') counts.upcoming += 1;
      else if (urgency === 'UNKNOWN') counts.unknown += 1;

      return { ...instance, urgency, evidenceComplete, exceptions, escalations, blocksBilling: finalBlock };
    });

    return {
      definition,
      evidenceRequirements: entry.evidenceRequirements,
      instances,
      effective,
      blocksBilling: anyTrue(instances.map((i) => i.blocksBilling)),
    };
  });

  return {
    contractId: input.contractId,
    asOf,
    obligations,
    billingBlock: {
      state: anyTrue(obligations.map((o) => o.blocksBilling)),
      blockingInstanceIds,
      unknownDefinitionIds: [...new Set(unknownDefinitionIds)],
    },
    counts,
  };
}
