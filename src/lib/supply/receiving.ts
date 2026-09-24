/**
 * RECEBIMENTO & LOGÍSTICA — regras de leitura em código puro (235).
 *
 * O banco posta o recebimento (livro, reserva, pedido, inspeção); aqui se
 * classifica o que está ENTRANDO nas filas que a operação usa: esperado
 * hoje, próximos, em trânsito, atrasado, parcial, divergência e concluído.
 */

export type InboundQueue = 'today' | 'upcoming' | 'in_transit' | 'late' | 'partial' | 'discrepancy' | 'done';
export const INBOUND_QUEUE_LABEL: Record<InboundQueue, string> = {
  today: 'Esperado hoje', upcoming: 'Próximos', in_transit: 'Em trânsito', late: 'Atrasados', partial: 'Parciais',
  discrepancy: 'Divergências', done: 'Concluídos',
};

export type InspectionStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'PARTIALLY_REJECTED' | 'REJECTED';
export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  NOT_REQUIRED: 'Sem inspeção', PENDING: 'Em inspeção', APPROVED: 'Aprovado', PARTIALLY_REJECTED: 'Rejeitado em parte', REJECTED: 'Rejeitado',
};

export type ShipmentStatus = 'EXPECTED' | 'IN_TRANSIT' | 'ARRIVED' | 'RECEIVED' | 'CANCELLED';
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  EXPECTED: 'Previsto', IN_TRANSIT: 'Em trânsito', ARRIVED: 'Chegou', RECEIVED: 'Recebido', CANCELLED: 'Cancelado',
};

/** Uma entrada esperada: pedido de compra (com ou sem embarque) ou transferência. */
export interface InboundFacts {
  kind: 'PO' | 'TRANSFER';
  status: string;                   // estado do pedido / da transferência
  expectedDate: string | null;      // ETA do embarque ou data prevista do pedido/transferência
  inTransit: boolean;               // embarque em trânsito ou transferência despachada
  hasReceipt: boolean;              // já recebeu algo
  openQuantity: number;             // ainda esperado
  discrepancy: boolean;             // rejeição no recebimento/inspeção ou inspeção pendente
}

/**
 * A fila de uma entrada. Ordem de precedência: concluído → divergência →
 * atrasado → em trânsito → parcial → hoje → próximos. Atrasado vence em
 * trânsito: o que passou da data precisa de alguém, mesmo andando.
 */
export function inboundQueue(f: InboundFacts, today: string): InboundQueue {
  const closed = f.openQuantity <= 0 || ['RECEIVED', 'CLOSED', 'CANCELLED'].includes(f.status);
  if (closed) return f.discrepancy ? 'discrepancy' : 'done';
  if (f.discrepancy) return 'discrepancy';
  if (f.expectedDate && f.expectedDate < today) return 'late';
  if (f.inTransit) return 'in_transit';
  if (f.hasReceipt) return 'partial';
  if (f.expectedDate === today) return 'today';
  return 'upcoming';
}

export function daysLate(expectedDate: string | null, today: string): number {
  if (!expectedDate || expectedDate >= today) return 0;
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${expectedDate}T12:00:00Z`)) / 86_400_000);
}

export type InboundRisk = 'critical' | 'high' | 'medium';

/**
 * Risco de uma ENTRADA para o requisito que ela cobre — a pergunta da torre
 * de controle: "isto chega antes de a obra precisar?".
 *
 * Entrada atrasada chega, no melhor caso, hoje. Chegar depois da necessidade
 * é alto (crítico se a necessidade está a 7 dias ou menos, ou já passou);
 * atrasada mas ainda a tempo é alto perto da necessidade e médio longe dela;
 * folga de até 3 dias é médio. Sem data prometida, a 14 dias da necessidade,
 * é médio: ninguém sabe quando chega. Fora disso, sem risco (null).
 */
export function inboundRisk(eta: string | null, requiredBy: string | null, today: string):
  { risk: InboundRisk | null; slackDays: number | null; late: boolean } {
  const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  const needIn = requiredBy ? days(today, requiredBy) : null;
  if (!eta) return { risk: needIn !== null && needIn <= 14 ? 'medium' : null, slackDays: null, late: false };
  const late = eta < today;
  const slack = requiredBy ? days(late ? today : eta, requiredBy) : null;
  if (slack !== null && slack < 0) return { risk: needIn !== null && needIn <= 7 ? 'critical' : 'high', slackDays: slack, late };
  if (late) return { risk: needIn !== null && needIn <= 7 ? 'high' : 'medium', slackDays: slack, late };
  if (slack !== null && slack <= 3) return { risk: 'medium', slackDays: slack, late };
  return { risk: null, slackDays: slack, late };
}

/** Pontualidade do fornecedor a partir da visão derivada (nunca estimada). */
export function onTimeRate(perf: { promised_lines: number; on_time_lines: number } | null | undefined): number | null {
  if (!perf || !perf.promised_lines) return null;
  return perf.on_time_lines / perf.promised_lines;
}

const RECEIVING_ERRORS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/only an issued order is received/, () => 'Só pedido emitido recebe material — pedido em rascunho, aprovação ou encerrado não.'],
  [/exceeds the open quantity of the order line \(([\d.]+) open\)/, (m) => `Recebimento acima do que falta chegar (${Number(m[1])} em aberto).`],
  [/grl_rejection_reason/, () => 'Quantidade rejeitada exige motivo.'],
  [/needs a received or rejected quantity/, () => 'Informe o recebido ou o rejeitado da linha.'],
  [/one distinct serial per received unit/, () => 'Informe um número de série distinto por unidade recebida.'],
  [/Shipment does not belong to this order/, () => 'O embarque não é deste pedido ou já foi encerrado.'],
  [/moves forward only/, () => 'O embarque só avança: previsto → em trânsito → chegou. "Recebido" vem do recebimento.'],
  [/Shipment tracks an issued order/, () => 'Embarque só para pedido emitido.'],
  [/Inspection must decide every/, () => 'A inspeção decide todas as unidades recebidas: aprovado + rejeitado = recebido.'],
  [/decides each received serial exactly once/, () => 'Cada número de série recebido é aprovado ou rejeitado exatamente uma vez.'],
  [/Rejection at inspection requires a reason/, () => 'Rejeitar na inspeção exige motivo.'],
  [/releases to an active location outside quarantine/, () => 'Libere a inspeção para um local ativo fora da quarentena.'],
  [/inspection is (\w+): nothing to decide/, () => 'Esta inspeção já foi decidida.'],
  [/awaiting inspection/, () => 'Há recebimento em inspeção neste pedido — decida antes de encerrar.'],
  [/Closing with ([\d.]+) still open requires a reason/, (m) => `Encerrar com ${Number(m[1])} em aberto exige motivo (o saldo deixa de ser esperado).`],
  [/gre_path_in_tenant/, () => 'Arquivo fora da área deste inquilino.'],
  [/Receiving location not found|Location .* is inactive/, () => 'Local de recebimento inexistente ou inativo.'],
];

export function receivingErrorMessage(message: string): string | null {
  for (const [re, fmt] of RECEIVING_ERRORS) {
    const m = message.match(re);
    if (m) return fmt(m);
  }
  return null;
}
