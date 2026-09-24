/**
 * TIMELINE DO PROJETO — um fluxo cronológico, montado de histórias canônicas.
 *
 * Não existe tabela de "eventos do projeto": cada domínio já guarda a sua
 * história (engajamento, medição, atraso de cronograma, risco, alocação,
 * documento, fatos de domínio de Operações e Supply). Esta função só NORMALIZA
 * e ORDENA — e cada item aponta para o registro que o sustenta.
 */

export type TimelineKind =
  | 'service_order' | 'project' | 'authorization' | 'measurement' | 'schedule' | 'risk'
  | 'team' | 'document' | 'supply' | 'finance';

export interface ProjectTimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  actor: string | null;
  href: string | null;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  service_order: 'OS', project: 'Projeto', authorization: 'Autorização', measurement: 'Medição',
  schedule: 'Cronograma', risk: 'Risco', team: 'Equipe', document: 'Documento', supply: 'Supply', finance: 'Financeiro',
};

/** Fatos de domínio conhecidos → título legível. Tipo desconhecido não some: vira o próprio nome. */
const DOMAIN_EVENT_TITLE: Record<string, { title: string; kind: TimelineKind; tone: ProjectTimelineEvent['tone'] }> = {
  'operations.service_order.created': { title: 'OS interna criada', kind: 'service_order', tone: 'neutral' },
  'operations.service_order.issued': { title: 'OS interna emitida', kind: 'service_order', tone: 'success' },
  'operations.service_order.project_linked': { title: 'Projeto vinculado à OS', kind: 'project', tone: 'accent' },
  'operations.service_order.amended': { title: 'OS emendada', kind: 'service_order', tone: 'warning' },
  'operations.service_order.cancelled': { title: 'OS cancelada', kind: 'service_order', tone: 'danger' },
};

export function domainEventTitle(eventType: string) {
  return DOMAIN_EVENT_TITLE[eventType] ?? {
    title: eventType.split('.').slice(1).join(' · ').replace(/_/g, ' '),
    kind: eventType.startsWith('supply.') || eventType.startsWith('inventory.') || eventType.startsWith('procurement.')
      || eventType.startsWith('receiving.') ? 'supply' as const : 'project' as const,
    tone: 'neutral' as const,
  };
}

const MEASUREMENT_TRANSITION: Record<string, string> = {
  SUBMITTED: 'Medição submetida', UNDER_REVIEW: 'Medição em análise', APPROVED_FOR_CUSTOMER: 'Medição aprovada para envio',
  AWAITING_CUSTOMER_ACCEPTANCE: 'Medição enviada ao cliente', ACCEPTED: 'Aceite do cliente registrado',
  REJECTED: 'Medição rejeitada', RETURNED_FOR_CORRECTION: 'Medição devolvida para correção',
  CUSTOMER_CORRECTION_REQUESTED: 'Cliente pediu correção', IN_PREPARATION: 'Medição em preparação',
  READY_FOR_SUBMISSION: 'Medição pronta para submissão', CANCELLED: 'Medição cancelada', SUPERSEDED: 'Medição substituída',
  PLANNED: 'Medição planejada',
};

export function measurementTransitionTitle(toState: string | null): string {
  return (toState && MEASUREMENT_TRANSITION[toState]) ?? 'Medição atualizada';
}

export function measurementTone(toState: string | null): ProjectTimelineEvent['tone'] {
  if (toState === 'ACCEPTED') return 'success';
  if (toState === 'REJECTED' || toState === 'CANCELLED') return 'danger';
  if (toState === 'RETURNED_FOR_CORRECTION' || toState === 'CUSTOMER_CORRECTION_REQUESTED') return 'warning';
  return 'neutral';
}

/** Ordena do mais recente, sem duplicar o mesmo fato vindo por duas histórias. */
export function mergeTimeline(events: ProjectTimelineEvent[], limit = 200): ProjectTimelineEvent[] {
  const seen = new Set<string>();
  return events
    .filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return Boolean(e.at); })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
