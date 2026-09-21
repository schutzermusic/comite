/**
 * A borda de leitura do planejamento mensal.
 *
 * Não recalcula nada e não escreve nada. A composição mora na visão (migration
 * 179), a derivação em `monthly-planning.ts`. Uma consulta, um instante: a
 * alternativa — a tela buscar marcos, cronograma, medições, notas e recebíveis
 * separadamente — produziria cinco instantes diferentes da mesma carteira.
 */

import { createClient } from '@/utils/supabase/client';
import {
  toMonthPlanRow,
  type BillingMonthPlanRawRow, type BillingMonthPlanRow,
} from './month-plan-types';
import type { BillingMilestoneAlert } from './alert-content';

const VIEW = 'contract_billing_month_plan';
const ALERTS = 'contract_billing_milestone_alerts';
const REPROGRAMMINGS = 'contract_billing_schedule_reprogrammings';

export class BillingMonthPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingMonthPlanError';
  }
}

function translate(message: string): string {
  // A visão pode não existir num ambiente que ainda não aplicou a 179. Dizer
  // isso é melhor que uma lista vazia, que se lê como "nada previsto".
  return message.includes('does not exist')
    ? 'O planejamento mensal de faturamento não está disponível neste ambiente '
      + '(migration 179 não aplicada).'
    : message;
}

/**
 * O planejamento da carteira.
 *
 * Ordenado por data prevista; marcos SEM data vêm por último e continuam na
 * lista — são eles que revelam o contrato cujo cronograma ainda não chegou, e
 * filtrá-los faria a carteira parecer completa.
 */
export async function listBillingMonthPlan(
  contractIds: readonly string[],
): Promise<BillingMonthPlanRow[]> {
  if (contractIds.length === 0) return [];

  const { data, error } = await createClient()
    .from(VIEW)
    .select('*')
    .in('contract_id', contractIds as string[])
    .order('planned_billing_date', { ascending: true, nullsFirst: false })
    .order('title', { ascending: true });

  if (error) throw new BillingMonthPlanError(translate(error.message));
  return ((data ?? []) as BillingMonthPlanRawRow[]).map(toMonthPlanRow);
}

interface AlertRawRow {
  id: string;
  organization_id: string;
  contract_id: string;
  milestone_id: string;
  project_id: string | null;
  planned_date: string;
  planned_date_basis: BillingMilestoneAlert['plannedDateBasis'];
  offset_days: number;
  kind: BillingMilestoneAlert['kind'];
  facts_snapshot: Record<string, unknown>;
  amount: number | string | null;
  currency: string | null;
  policy_source: BillingMilestoneAlert['policySource'];
  generated_at: string;
  as_of_date: string;
}

const toAlert = (raw: AlertRawRow): BillingMilestoneAlert => ({
  id: raw.id,
  organizationId: raw.organization_id,
  contractId: raw.contract_id,
  milestoneId: raw.milestone_id,
  projectId: raw.project_id,
  plannedDate: raw.planned_date,
  plannedDateBasis: raw.planned_date_basis,
  offsetDays: raw.offset_days,
  kind: raw.kind,
  amount: raw.amount === null ? null : Number(raw.amount),
  currency: raw.currency,
  policySource: raw.policy_source,
  generatedAt: raw.generated_at,
  asOfDate: raw.as_of_date,
  factsSnapshot: raw.facts_snapshot ?? {},
});

export async function listBillingAlerts(
  contractIds: readonly string[],
  limit = 100,
): Promise<BillingMilestoneAlert[]> {
  if (contractIds.length === 0) return [];
  const { data, error } = await createClient()
    .from(ALERTS)
    .select('*')
    .in('contract_id', contractIds as string[])
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) throw new BillingMonthPlanError(translate(error.message));
  return ((data ?? []) as AlertRawRow[]).map(toAlert);
}

export interface ScheduleReprogramming {
  readonly id: string;
  readonly milestoneId: string | null;
  readonly timelineItemId: string;
  readonly projectId: string;
  readonly previousPlannedFinish: string | null;
  readonly newPlannedFinish: string | null;
  readonly scheduleVersion: number | null;
  readonly observedAt: string;
}

/** O diário de reprogramação de um marco — a data anterior, preservada. */
export async function listReprogrammings(
  milestoneId: string,
): Promise<ScheduleReprogramming[]> {
  const { data, error } = await createClient()
    .from(REPROGRAMMINGS)
    .select('id, milestone_id, timeline_item_id, project_id, previous_planned_finish, new_planned_finish, schedule_version, observed_at')
    .eq('milestone_id', milestoneId)
    .order('observed_at', { ascending: false });

  if (error) throw new BillingMonthPlanError(translate(error.message));
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    milestoneId: r.milestone_id as string | null,
    timelineItemId: r.timeline_item_id as string,
    projectId: r.project_id as string,
    previousPlannedFinish: r.previous_planned_finish as string | null,
    newPlannedFinish: r.new_planned_finish as string | null,
    scheduleVersion: r.schedule_version as number | null,
    observedAt: r.observed_at as string,
  }));
}

/**
 * As propostas de mapeamento pendentes de revisão da carteira.
 *
 * Só `proposed`. Aceito não é proposta e já alimenta a data prevista sozinho;
 * rejeitado é decisão humana encerrada, e ressuscitá-lo na fila seria discutir
 * com o revisor.
 */
export interface MappingProposalRow {
  readonly id: string;
  readonly contractId: string;
  readonly ruleId: string;
  readonly projectId: string;
  readonly timelineItemId: string;
  readonly confidence: number | null;
  readonly note: string | null;
  readonly mappedAt: string;
}

export async function listPendingMappingProposals(
  contractIds: readonly string[],
): Promise<MappingProposalRow[]> {
  if (contractIds.length === 0) return [];
  const { data, error } = await createClient()
    .from('contract_measurement_rule_timeline_mappings')
    .select('id, contract_id, rule_id, project_id, timeline_item_id, confidence, note, mapped_at')
    .in('contract_id', contractIds as string[])
    .eq('review_state', 'proposed')
    .eq('mapping_source', 'system_proposed')
    .order('confidence', { ascending: false });

  if (error) throw new BillingMonthPlanError(translate(error.message));
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    contractId: r.contract_id as string,
    ruleId: r.rule_id as string,
    projectId: r.project_id as string,
    timelineItemId: r.timeline_item_id as string,
    confidence: r.confidence === null ? null : Number(r.confidence),
    note: r.note as string | null,
    mappedAt: r.mapped_at as string,
  }));
}
