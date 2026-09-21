/**
 * A borda de leitura dos EVENTOS DE MEDIÇÃO de um projeto.
 *
 * Uma consulta, um instante, `project_schedule_contract_events` (migration
 * 181). A alternativa — o Gantt perguntar por linha se aquela atividade é um
 * marco contratual — seria uma requisição por linha num cronograma de 69
 * atividades, e sessenta e nove instantes diferentes da mesma carteira.
 *
 * Não recalcula nada e não escreve nada. A composição mora na visão, a
 * derivação de estágio em `milestone-stage.ts`, e o aceite de mapeamento na
 * RPC governada — que esta borda expõe sem atalho nenhum.
 *
 * ─── Permissão ────────────────────────────────────────────────────────────
 *
 * A visão é `security_invoker`. Quem não passa na RLS da cadeia de Contratos
 * simplesmente não recebe linha: o cronograma aparece como sempre apareceu,
 * sem a sobreposição contratual. Esta borda NÃO tem caminho que contorne isso,
 * e é por isso que ela usa o cliente do navegador e não o service role.
 */

import { createClient } from '@/utils/supabase/client';
import {
  toMonthPlanRow,
  type BillingMonthPlanRawRow,
} from '@/lib/contracts/billing/planning/month-plan-types';
import type {
  AmbiguousAlternative, EventLinkState, ProjectContractEvent,
} from '@/lib/projects/contract-events';

const VIEW = 'project_schedule_contract_events';

export class ProjectContractEventsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectContractEventsError';
  }
}

/**
 * Ambiente sem a 181 aplicada devolve "does not exist". Dizer isso é melhor
 * que uma lista vazia, que se lê como "este projeto não tem evento contratual"
 * — uma afirmação sobre o contrato que a ausência da visão não sustenta.
 */
function translate(message: string): string {
  return message.includes('does not exist')
    ? 'Os eventos de medição do cronograma não estão disponíveis neste ambiente '
      + '(migration 181 não aplicada).'
    : message;
}

/**
 * A forma crua da visão 182.
 *
 * Exportada porque a normalização é a única coisa entre o banco e a tela, e
 * verificá-la exige alimentá-la com linhas reais — o que um teste não
 * consegue fazer através de `createClient()`.
 */
export interface ProjectContractEventRawRow extends BillingMonthPlanRawRow {
  link_state: EventLinkState;
  rule_id: string;
  mapping_id: string | null;
  mapping_source: string | null;
  review_state: 'proposed' | 'accepted' | 'rejected' | null;
  mapping_confidence: number | string | null;
  mapping_note: string | null;
  mapping_mapped_at: string | null;
  mapping_reviewed_at: string | null;
  proposed_timeline_item_id: string | null;
  proposed_timeline_title: string | null;
  proposed_timeline_wbs_code: string | null;
  proposed_timeline_finish: string | null;
  ambiguous_alternatives: AmbiguousAlternative[] | null;
  contract_total_value: number | string | null;
  contract_percent: number | string | null;
  can_view_values: boolean;
  generates_billing: boolean;
  mapped_timeline_item_id: string | null;
  mapped_timeline_title: string | null;
  mapped_timeline_wbs_code: string | null;
  mapped_timeline_is_active: boolean | null;
}

const num = (value: number | string | null): number | null =>
  value === null || value === '' ? null : Number(value);

export function toProjectContractEvent(raw: ProjectContractEventRawRow): ProjectContractEvent {
  return {
    linkState: raw.link_state,
    ruleId: raw.rule_id,
    mappingId: raw.mapping_id,
    mappingSource: raw.mapping_source,
    reviewState: raw.review_state,
    confidence: num(raw.mapping_confidence),
    note: raw.mapping_note,
    mappedAt: raw.mapping_mapped_at,
    reviewedAt: raw.mapping_reviewed_at,

    proposedTimelineItemId: raw.proposed_timeline_item_id,
    proposedTimelineTitle: raw.proposed_timeline_title,
    proposedTimelineWbsCode: raw.proposed_timeline_wbs_code,
    proposedTimelineFinish: raw.proposed_timeline_finish,
    ambiguousAlternatives: raw.ambiguous_alternatives ?? [],

    /*
      O portão de valor da 182, tal como o banco o decidiu.

      `?? true` NÃO é um padrão permissivo: a coluna é NOT NULL na visão, e o
      fallback só existe para um ambiente que ainda não aplicou a 182 — onde
      a visão antiga já entregava as quantias de qualquer forma. Onde a 182
      está aplicada, quem não passa no portão recebe `false` do próprio banco,
      e nenhuma linha de TypeScript pode transformá-lo em `true`.
    */
    canViewValues: raw.can_view_values ?? true,
    generatesBilling: raw.generates_billing
      ?? (num(raw.planned_amount) ?? 0) > 0,

    mappedTimelineItemId: raw.mapped_timeline_item_id ?? null,
    mappedTimelineTitle: raw.mapped_timeline_title ?? null,
    mappedTimelineWbsCode: raw.mapped_timeline_wbs_code ?? null,
    mappedTimelineIsActive: raw.mapped_timeline_is_active ?? true,

    contractTotalValue: num(raw.contract_total_value),
    contractPercent: num(raw.contract_percent),

    // A linha do planejamento passa pelo MESMO normalizador que a carteira de
    // Contratos usa. Um segundo normalizador aqui é como os dois módulos
    // passariam a arredondar o mesmo valor de formas diferentes.
    plan: toMonthPlanRow(raw),
  };
}

/** Os eventos de medição de UM projeto. Ordem de revisão fica com a tela. */
export async function listProjectContractEvents(
  projectId: string,
): Promise<ProjectContractEvent[]> {
  const { data, error } = await createClient()
    .from(VIEW)
    .select('*')
    .eq('project_id', projectId)
    .order('planned_billing_date', { ascending: true, nullsFirst: false })
    .order('title', { ascending: true });

  if (error) throw new ProjectContractEventsError(translate(error.message));
  return ((data ?? []) as ProjectContractEventRawRow[]).map(toProjectContractEvent);
}

/**
 * A REVISÃO HUMANA de um mapeamento proposto — o único caminho de proposta
 * para verdade, e o MESMO que a carteira de Contratos usa.
 *
 * A RPC `contract_measurement_rule_timeline_review` exige `auth.uid()` e
 * `contracts.edit`; aceitar a partir de Projetos não afrouxa nada, apenas
 * coloca o botão onde a pessoa está. Se ela não puder decidir, a RPC recusa —
 * e a tela mostra a recusa em vez de esconder o botão e fingir que não havia
 * decisão a tomar.
 */
export async function reviewScheduleMapping(
  mappingId: string,
  decision: 'accepted' | 'rejected',
  note?: string,
): Promise<void> {
  const { error } = await createClient().rpc('contract_measurement_rule_timeline_review', {
    p_mapping_id: mappingId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw new ProjectContractEventsError(error.message);
}

/**
 * O VÍNCULO MANUAL: a pessoa aponta a etapa do cronograma que representa o
 * marco contratual.
 *
 * ─── Quando este caminho é o único que existe ─────────────────────────────
 *
 * Marco SEM CORRESPONDÊNCIA não tem proposta — não há o que aceitar. Sem esta
 * chamada, "Evento 05 · Montagem e fechamento do enrolamento estatórico"
 * ficaria para sempre sem âncora de cronograma, e a previsão de faturamento
 * dele cairia no prazo do marco ou em nada.
 *
 * Serve também para resolver AMBIGUIDADE: escolher uma das candidatas é
 * vincular àquela, e a RPC rejeita as concorrentes no mesmo ato.
 *
 * ─── O teto ───────────────────────────────────────────────────────────────
 *
 * `contract_measurement_rule_timeline_link` exige `auth.uid()` e
 * `contracts.edit` — as mesmas exigências do fluxo de revisão. Vincular
 * manualmente não é um atalho para quem não poderia aceitar uma proposta: é o
 * mesmo ato de governança, por outro botão.
 */
export async function linkScheduleActivity(
  ruleId: string,
  timelineItemId: string,
  note?: string,
): Promise<void> {
  const { error } = await createClient().rpc('contract_measurement_rule_timeline_link', {
    p_rule_id: ruleId,
    p_timeline_item_id: timelineItemId,
    p_note: note ?? null,
  });
  if (error) throw new ProjectContractEventsError(error.message);
}

/**
 * Este projeto tem contrato GOVERNADAMENTE ligado?
 *
 * Pergunta separada da lista de eventos porque as duas ausências são
 * diferentes e pedem trabalhos diferentes: sem contrato ligado, alguém precisa
 * vincular o contrato; com contrato ligado e sem evento, alguém precisa
 * cadastrar os marcos de medição em Contratos. A lista vazia sozinha não
 * distingue as duas, e foi essa indistinção que produziu "Nenhuma medição
 * registrada" como resposta universal.
 *
 * `head: true` com `count` traz a resposta sem trazer linha nenhuma.
 */
export async function hasGovernedContractLink(projectId: string): Promise<boolean> {
  const { count, error } = await createClient()
    .from('project_contract_link_governed')
    .select('contract_id', { count: 'exact', head: true })
    .eq('project_id', projectId);

  // Erro NÃO é "não tem contrato". Diante da dúvida a tela prefere a frase
  // mais genérica a afirmar uma ausência que ninguém verificou.
  if (error) return true;
  return (count ?? 0) > 0;
}
