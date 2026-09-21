/**
 * A TRADUÇÃO do evento de medição para a tela do cronograma — texto e tom.
 *
 * Sem JSX e sem estado, para que os testes possam provar as frases sem montar
 * componente. O que se prova aqui é o VOCABULÁRIO: que "Gera faturamento"
 * nunca vire "Vai faturar", que ausência escreva "Não apurado" e nunca
 * "R$ 0,00", e que o estágio venha da máquina canônica em vez de um rótulo
 * escrito à mão nesta camada.
 */

import {
  BILLING_PLAN_STATE_LABEL, BILLING_PLAN_STATE_TONE,
  PLANNED_DATE_BASIS_LABEL, deriveBillingPlanState,
} from '@/lib/contracts/billing/planning/monthly-planning';
import {
  LINK_STATE_LABEL, eventNumberLabel, generatesBilling, previousDate,
  wasReprogrammed, type ProjectContractEvent,
} from '@/lib/projects/contract-events';
import { ABSENT, date, money } from '@/components/contracts/billing/month/plan-format';
import { chipTone } from '@/components/contracts/billing/month/plan-format';

export { ABSENT, date, money };

/**
 * O texto de RESTRIÇÃO. Distinto de `ABSENT` ("Não apurado") de propósito.
 *
 * As duas frases descrevem a mesma célula vazia e pedem ações opostas: "não
 * apurado" é trabalho de cadastro, "restrito" é trabalho de permissão. Um
 * único texto para os dois casos manda metade das pessoas para o lugar errado.
 */
export const RESTRICTED = 'Restrito';

/**
 * A quantia do evento, ou a razão de ela não estar ali.
 *
 * Único ponto da tela de cronograma que decide entre valor, "Restrito" e
 * "Não apurado". Cada componente resolvendo isso por conta própria é como a
 * mesma ausência apareceria com três textos diferentes.
 */
export function amountText(
  event: ProjectContractEvent,
  value: number | null = event.plan.plannedAmount,
): string {
  if (!event.canViewValues) return RESTRICTED;
  return money(value, event.plan.currency);
}

/** "EVENTO DE MEDIÇÃO · MARCO 02" — o rótulo da linha derivada. */
export function rowLabel(event: ProjectContractEvent): string {
  return `EVENTO DE MEDIÇÃO · ${eventNumberLabel(event)}`;
}

/** O estágio do marco, pela máquina canônica. Nunca reescrito aqui. */
export function stageChip(event: ProjectContractEvent): {
  label: string; tone: ReturnType<typeof chipTone>;
} {
  const state = deriveBillingPlanState(event.plan);
  return {
    label: BILLING_PLAN_STATE_LABEL[state],
    tone: chipTone(BILLING_PLAN_STATE_TONE[state]),
  };
}

/**
 * A CONSEQUÊNCIA DE FATURAMENTO, dita sem prometer nada.
 *
 * "Gera faturamento" é característica do MARCO — o contrato prevê pagamento
 * quando ele ocorrer. Não é previsão de que vai faturar, e a frase evita o
 * futuro de propósito: o evento de faturamento só nasce pelo fluxo governado
 * de Contratos, e nada em Projetos o cria.
 */
export function billingConsequence(event: ProjectContractEvent): string {
  if (event.plan.billingEventId !== null) return 'Evento de faturamento gerado';
  return generatesBilling(event)
    ? 'Gera faturamento'
    : 'Sem valor de faturamento registrado';
}

/**
 * O texto do tooltip do marcador no Gantt (§6 do pedido).
 *
 * Uma string, e não um popover, de propósito: o Gantt virtualiza as linhas e
 * um popover por marcador seria um nó de React montado e desmontado a cada
 * frame de rolagem. O detalhe completo mora no drawer, a um clique.
 */
export function markerTooltip(event: ProjectContractEvent): string {
  const plan = event.plan;
  const lines = [
    'Evento de medição',
    `Marco contratual: ${plan.title}`,
    `Contrato: ${plan.contractNumber ?? ABSENT}`,
    `Data prevista: ${date(plan.plannedBillingDate)}`
      + (plan.plannedBillingDate
        ? ` (${PLANNED_DATE_BASIS_LABEL[plan.plannedBillingDateBasis]})`
        : ''),
    `Valor previsto: ${amountText(event)}`,
    `Estágio: ${stageChip(event).label}`,
    billingConsequence(event),
  ];
  if (wasReprogrammed(event)) {
    lines.push(`Reprogramado de ${date(previousDate(event))}`);
  }
  lines.push(LINK_STATE_LABEL[event.linkState]);
  return lines.join('\n');
}

/**
 * A linha de procedência da sobreposição.
 *
 * "Origem: Contrato" existe para que ninguém leia a linha derivada como uma
 * atividade que alguém esqueceu de preencher. Ela não é do cronograma; ela é
 * o contrato aparecendo ao lado do cronograma.
 */
export const PROVENANCE = 'Origem: Contrato';
