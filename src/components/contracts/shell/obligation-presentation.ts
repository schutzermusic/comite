import type { ResolvedObligation } from '@/lib/contracts/obligations/types';

export const OBLIGATION_GROUPS = [
  ['attention', 'Requer ação'],
  ['active', 'Em acompanhamento'],
  ['waiting', 'Aguardando gatilho ou agenda'],
  ['unknown', 'Sem prazo calculável'],
  ['untracked', 'Definidas · sem acompanhamento'],
  ['completed', 'Concluídas'],
  ['closed', 'Dispensadas ou canceladas'],
] as const;
export type ObligationGroup = typeof OBLIGATION_GROUPS[number][0];

/** Grouping is a view, never a new persisted lifecycle or an inferred completion. */
export function obligationGroup(obligation: Pick<ResolvedObligation, 'instances'>): ObligationGroup {
  const instances = obligation.instances;
  if (!instances.length) return 'untracked';
  if (instances.every((i) => i.state === 'SATISFIED')) return 'completed';
  const live = instances.filter((i) => !['SATISFIED', 'WAIVED', 'CANCELLED'].includes(i.state));
  if (!live.length) return 'closed';
  if (live.some((i) => i.urgency === 'OVERDUE' || i.urgency === 'DUE' || i.state === 'EXCEPTION' || i.blocksBilling === 'TRUE')) return 'attention';
  if (live.some((i) => i.dateState === 'UNKNOWN' || i.urgency === 'UNKNOWN')) return 'unknown';
  if (live.every((i) => i.state === 'NOT_ACTIVATED' || i.urgency === 'AWAITING_SCHEDULE_ANCHOR')) return 'waiting';
  return 'active';
}
