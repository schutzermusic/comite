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
  'operations.requirement.confirmed': { title: 'Requisito confirmado no plano', kind: 'schedule', tone: 'accent' },
  'operations.requirement.planned': { title: 'Requisito voltou a planejado', kind: 'schedule', tone: 'warning' },
  'operations.requirement.cancelled': { title: 'Requisito cancelado', kind: 'schedule', tone: 'warning' },
  'operations.requirement.superseded': { title: 'Requisito substituído', kind: 'schedule', tone: 'neutral' },
  'supply.inventory.reserved': { title: 'Material reservado no estoque', kind: 'supply', tone: 'success' },
  'supply.inventory.reservation_released': { title: 'Reserva de material liberada', kind: 'supply', tone: 'warning' },
  'supply.inventory.issued': { title: 'Material entregue à obra', kind: 'supply', tone: 'success' },
  'supply.inventory.returned': { title: 'Material devolvido da obra', kind: 'supply', tone: 'neutral' },
  'supply.transfer.requested': { title: 'Transferência de material solicitada', kind: 'supply', tone: 'neutral' },
  'supply.transfer.dispatched': { title: 'Transferência despachada', kind: 'supply', tone: 'accent' },
  'supply.transfer.partially_received': { title: 'Transferência recebida em parte', kind: 'supply', tone: 'warning' },
  'supply.transfer.received': { title: 'Transferência recebida', kind: 'supply', tone: 'success' },
  'supply.transfer.closed': { title: 'Transferência encerrada', kind: 'supply', tone: 'neutral' },
  'supply.requisition.submitted': { title: 'Compra requisitada', kind: 'supply', tone: 'neutral' },
  'supply.purchase_order.approved': { title: 'Pedido de compra aprovado', kind: 'supply', tone: 'accent' },
  'supply.purchase_order.issued': { title: 'Pedido de compra emitido', kind: 'supply', tone: 'success' },
  'supply.purchase_order.cancelled': { title: 'Pedido de compra cancelado', kind: 'supply', tone: 'danger' },
  'supply.goods_receipt.project_received': { title: 'Material recebido para o projeto', kind: 'supply', tone: 'success' },
  'supply.signal.executed': { title: 'Recomendação da Apex executada', kind: 'supply', tone: 'accent' },
  'supply.signal.dismissed': { title: 'Recomendação da Apex descartada', kind: 'supply', tone: 'neutral' },
  // Compras: a transição do pedido vira o sufixo do evento (234/237).
  'supply.requisition.cancelled': { title: 'Requisição de compra cancelada', kind: 'supply', tone: 'warning' },
  // 248: o que a emissão parcial não pediu, ou o cancelamento do pedido não devolveu à requisição, vai ao livro de liberações.
  'supply.requisition.released': { title: 'Saldo de requisição de compra liberado', kind: 'supply', tone: 'warning' },
  'supply.rfq.created': { title: 'Cotação aberta com fornecedores', kind: 'supply', tone: 'neutral' },
  'supply.quote.recorded': { title: 'Proposta de fornecedor registrada', kind: 'supply', tone: 'neutral' },
  'supply.sourcing.decided': { title: 'Fornecedor decidido', kind: 'supply', tone: 'accent' },
  'supply.purchase_order.created': { title: 'Pedido de compra criado', kind: 'supply', tone: 'neutral' },
  'supply.purchase_order.edited': { title: 'Pedido de compra editado', kind: 'supply', tone: 'neutral' },
  'supply.purchase_order.submitted': { title: 'Pedido de compra enviado para aprovação', kind: 'supply', tone: 'neutral' },
  'supply.purchase_order.rejected': { title: 'Pedido de compra recusado na aprovação', kind: 'supply', tone: 'danger' },
  'supply.purchase_order.returned': { title: 'Pedido de compra devolvido para ajuste', kind: 'supply', tone: 'warning' },
  'supply.purchase_order.partially_received': { title: 'Pedido de compra recebido em parte', kind: 'supply', tone: 'warning' },
  'supply.purchase_order.received': { title: 'Pedido de compra recebido', kind: 'supply', tone: 'success' },
  'supply.purchase_order.closed': { title: 'Pedido de compra encerrado', kind: 'supply', tone: 'neutral' },
  'supply.procurement_authority.declared': { title: 'Alçada de compra declarada', kind: 'supply', tone: 'neutral' },
  'supply.procurement_authority.revoked': { title: 'Alçada de compra revogada', kind: 'supply', tone: 'warning' },
  'supply.supplier.status_changed': { title: 'Situação do fornecedor alterada', kind: 'supply', tone: 'neutral' },
  // Recebimento, embarque e estoque.
  'supply.goods_receipt.posted': { title: 'Recebimento de material registrado', kind: 'supply', tone: 'success' },
  'supply.goods_receipt.inspected': { title: 'Inspeção de recebimento concluída', kind: 'supply', tone: 'accent' },
  'supply.goods_receipt.evidence_attached': { title: 'Evidência anexada ao recebimento', kind: 'supply', tone: 'neutral' },
  'supply.shipment.expected': { title: 'Embarque previsto', kind: 'supply', tone: 'neutral' },
  'supply.shipment.in_transit': { title: 'Embarque em trânsito', kind: 'supply', tone: 'accent' },
  'supply.shipment.arrived': { title: 'Embarque chegou ao destino', kind: 'supply', tone: 'success' },
  'supply.shipment.received': { title: 'Embarque recebido', kind: 'supply', tone: 'success' },
  'supply.shipment.cancelled': { title: 'Embarque cancelado', kind: 'supply', tone: 'danger' },
  'supply.transfer.approved': { title: 'Transferência aprovada', kind: 'supply', tone: 'accent' },
  'supply.transfer.rejected': { title: 'Transferência recusada', kind: 'supply', tone: 'danger' },
  'supply.transfer.cancelled': { title: 'Transferência cancelada', kind: 'supply', tone: 'danger' },
  'supply.inventory.adjusted': { title: 'Estoque ajustado', kind: 'supply', tone: 'neutral' },
  'supply.inventory.count_posted': { title: 'Contagem de estoque lançada', kind: 'supply', tone: 'neutral' },
  // Planejamento e medição.
  'operations.requirement.satisfied': { title: 'Necessidade atendida', kind: 'schedule', tone: 'success' },
  'projects.measurement.schedule_changed': { title: 'Data da medição replanejada', kind: 'measurement', tone: 'neutral' },
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
