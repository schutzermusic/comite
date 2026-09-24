/**
 * COMPRAS — regras de leitura em código puro (234).
 *
 * O banco decide (requisição, versão de proposta, decisão, alçada, emissão);
 * aqui se compara e se EXPLICA: custo total posto, data de chegada contra a
 * necessidade, conformidade, homologação e confiabilidade. A recomendação é
 * uma sugestão com motivo — decidir é ato humano, registrado, que pode ir
 * contra ela com justificativa.
 */

export type RequisitionStatus = 'SUBMITTED' | 'SOURCING' | 'ORDERED' | 'CANCELLED' | 'CLOSED';
export const REQUISITION_STATUS_LABEL: Record<RequisitionStatus, string> = {
  SUBMITTED: 'Aguardando cotação', SOURCING: 'Em cotação', ORDERED: 'Pedido emitido', CANCELLED: 'Cancelada', CLOSED: 'Encerrada',
};

export type RfqStatus = 'OPEN' | 'DECIDED' | 'CANCELLED';
export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = { OPEN: 'Aberta', DECIDED: 'Decidida', CANCELLED: 'Cancelada' };

export type PurchaseOrderStatus = 'DRAFT' | 'APPROVAL_REQUIRED' | 'APPROVED' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED'
  | 'CLOSED' | 'CANCELLED';
export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Rascunho', APPROVAL_REQUIRED: 'Em aprovação', APPROVED: 'Aprovado', ISSUED: 'Emitido',
  PARTIALLY_RECEIVED: 'Recebido em parte', RECEIVED: 'Recebido', CLOSED: 'Encerrado', CANCELLED: 'Cancelado',
};
export const PO_STATUS_TONE: Record<PurchaseOrderStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent'> = {
  DRAFT: 'neutral', APPROVAL_REQUIRED: 'warning', APPROVED: 'info', ISSUED: 'accent', PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success', CLOSED: 'neutral', CANCELLED: 'neutral',
};

export type SupplierStatus = 'PROSPECT' | 'HOMOLOGATED' | 'SUSPENDED' | 'BLOCKED';
export const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, string> = {
  PROSPECT: 'Em avaliação', HOMOLOGATED: 'Homologado', SUSPENDED: 'Suspenso', BLOCKED: 'Bloqueado',
};

export type PoAction = 'submit' | 'approve' | 'reject' | 'sync' | 'issue' | 'cancel';
export const PO_ACTION_LABEL: Record<PoAction, string> = {
  submit: 'Submeter à aprovação', approve: 'Aprovar', reject: 'Devolver ao rascunho', sync: 'Sincronizar desfecho da aprovação',
  issue: 'Emitir ao fornecedor', cancel: 'Cancelar pedido',
};

/** Atos oferecidos pelo estado e pela alçada. O banco recusa o resto (SoD, alçada, impressão digital). */
export function purchaseOrderActions(
  po: { status: PurchaseOrderStatus; governance: 'POLICY' | 'AUTHORITY' | null; createdBy: string | null; submittedBy: string | null },
  caps: { source: boolean; approve: boolean; issue: boolean },
  viewerId: string,
): PoAction[] {
  const out: PoAction[] = [];
  if (po.status === 'DRAFT' && (caps.source || caps.issue)) out.push('submit');
  if (po.status === 'APPROVAL_REQUIRED') {
    const segregated = viewerId !== po.createdBy && viewerId !== po.submittedBy;
    if (po.governance === 'AUTHORITY' && caps.approve && segregated) out.push('approve', 'reject');
    if (po.governance === 'POLICY') out.push('sync');
  }
  if (po.status === 'APPROVED' && caps.issue) out.push('issue');
  if (['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED'].includes(po.status) && caps.issue) out.push('cancel');
  return out;
}

export interface ComparableQuote {
  id: string; supplierId: string; supplier: string; supplierStatus: SupplierStatus; version: number;
  status: 'RECEIVED' | 'SUPERSEDED' | 'WITHDRAWN'; currency: string; freight: number; tax: number;
  leadTimeDays: number | null; validityDate: string | null; deviations: string | null; paymentTerms: string | null;
  lines: Array<{ rfqLineId: string; unitPrice: number; quantity: number; leadTimeDays: number | null; compliant: boolean }>;
}
export interface ComparableRfqLine { id: string; quantity: number; requiredBy: string | null }

export interface QuoteEvaluation {
  quoteId: string; supplier: string;
  goods: number; landed: number; currency: string;
  eta: string | null; lateDays: number | null; complete: boolean; compliant: boolean;
  expired: boolean; supplierOk: boolean; eligible: boolean; reliability: number | null;
  flags: string[];
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/**
 * Avalia cada proposta VIGENTE contra a necessidade. Chegada = hoje + o maior
 * prazo das linhas (ou o prazo da proposta). Atraso = chegada − a necessidade
 * mais cedo das linhas cotadas.
 */
export function evaluateQuotes(
  rfqLines: ComparableRfqLine[], quotes: ComparableQuote[], today: string, reliability: Record<string, number | null> = {},
): QuoteEvaluation[] {
  const need = rfqLines.map((l) => l.requiredBy).filter(Boolean).sort()[0] ?? null;
  return quotes.filter((q) => q.status === 'RECEIVED').map((q) => {
    const goods = q.lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
    const landed = goods + q.freight + q.tax;
    const lead = Math.max(q.leadTimeDays ?? 0, ...q.lines.map((l) => l.leadTimeDays ?? 0));
    const hasLead = q.leadTimeDays !== null || q.lines.some((l) => l.leadTimeDays !== null);
    const eta = hasLead ? addDays(today, lead) : null;
    const lateDays = eta && need ? Math.max(0, diffDays(eta, need)) : null;
    const complete = rfqLines.every((r) => q.lines.some((l) => l.rfqLineId === r.id && l.quantity >= r.quantity));
    const compliant = q.lines.every((l) => l.compliant) && !q.deviations;
    const expired = Boolean(q.validityDate && q.validityDate < today);
    const supplierOk = q.supplierStatus === 'PROSPECT' || q.supplierStatus === 'HOMOLOGATED';
    const rel = reliability[q.supplierId] ?? null;
    const flags: string[] = [];
    if (lateDays) flags.push(`chega ${lateDays} dia(s) depois da necessidade`);
    if (eta === null) flags.push('sem prazo informado');
    if (!complete) flags.push('não cota tudo o que foi pedido');
    if (!compliant) flags.push('com desvio técnico/comercial');
    if (expired) flags.push('validade vencida');
    if (!supplierOk) flags.push(`fornecedor ${SUPPLIER_STATUS_LABEL[q.supplierStatus].toLowerCase()}`);
    if (q.supplierStatus === 'PROSPECT') flags.push('fornecedor ainda não homologado');
    if (rel !== null && rel < 0.8) flags.push(`pontualidade histórica de ${Math.round(rel * 100)}%`);
    return { quoteId: q.id, supplier: q.supplier, goods, landed, currency: q.currency, eta, lateDays, complete, compliant,
      expired, supplierOk, eligible: supplierOk && !expired && complete, reliability: rel, flags };
  });
}

/**
 * RECOMENDAÇÃO explicável: entre as elegíveis, a que chega a tempo com menor
 * custo total; conformes antes de não conformes; se nenhuma chega a tempo, a
 * de menor atraso. Diz por que ganhou e o que se perde com ela.
 */
export function recommendQuote(evals: QuoteEvaluation[]): { quoteId: string; rationale: string } | null {
  const eligible = evals.filter((e) => e.eligible);
  if (!eligible.length) return null;
  const onTime = eligible.filter((e) => (e.lateDays ?? 0) === 0);
  const pool = onTime.length ? onTime : eligible;
  const ranked = [...pool].sort((a, b) => Number(b.compliant) - Number(a.compliant)
    || (onTime.length ? 0 : (a.lateDays ?? 0) - (b.lateDays ?? 0))
    || a.landed - b.landed);
  const best = ranked[0];
  const cheapest = [...eligible].sort((a, b) => a.landed - b.landed)[0];
  const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: best.currency || 'BRL' });
  const parts = [onTime.length ? `menor custo total posto (${money(best.landed)}) entre as que chegam a tempo`
    : `nenhuma chega a tempo; esta é a de menor atraso (${best.lateDays} dia(s))`];
  if (cheapest.quoteId !== best.quoteId) {
    parts.push(`a mais barata (${cheapest.supplier}, ${money(cheapest.landed)}) ${cheapest.lateDays ? `atrasa ${cheapest.lateDays} dia(s)` : 'tem desvio ou restrição'}`);
  }
  if (!best.compliant) parts.push('atenção: tem desvio — justifique ao decidir');
  return { quoteId: best.quoteId, rationale: `${best.supplier}: ${parts.join('; ')}.` };
}

/** Recusas do banco de compras em português. */
const PROCUREMENT_ERRORS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/no uncovered shortage left to requisition \(([\d.]+) already requested\)/, (m) => `Essa falta já está requisitada (${Number(m[1])}).`],
  [/is not a confirmed material with an item/, () => 'Só requisito de material confirmado, com item, vira requisição.'],
  [/preqn_manual_justified/, () => 'Requisição manual exige justificativa.'],
  [/not invited/, () => 'Fornecedor suspenso, bloqueado ou inexistente não é convidado.'],
  [/already in a live RFQ/, () => 'Esta linha já está numa cotação aberta.'],
  [/Quote from a supplier not invited/, () => 'Proposta de fornecedor não convidado para esta cotação.'],
  [/Quote is (\w+) : decide on the current version/, () => 'Decida sobre a versão vigente da proposta.'],
  [/Quote validity expired/, () => 'A validade da proposta venceu — peça uma nova versão.'],
  [/Sourcing decision requires a rationale/, () => 'A decisão de compra exige justificativa.'],
  [/delivery location before approval/, () => 'Defina o local de entrega antes de submeter.'],
  [/segregation of duties/, () => 'Segregação de funções: quem criou ou submeteu o pedido não o aprova.'],
  [/authority not configured/, () => 'Não há alçada de compra declarada para você neste valor e escopo — nem política no motor de aprovação.'],
  [/decide it in the approvals inbox/, () => 'Este pedido é governado por política: decida na caixa de Aprovações.'],
  [/only an approved order is issued/, () => 'Só pedido aprovado é emitido.'],
  [/changed after approval/, () => 'O pedido mudou depois da aprovação — submeta de novo.'],
  [/Supplier is (\w+): the order is not issued/, () => 'Fornecedor suspenso ou bloqueado: o pedido não é emitido.'],
  [/has receipts: it is closed, not cancelled/, () => 'Pedido com recebimento não se cancela — encerra-se.'],
  [/already has a purchase order/, () => 'A requisição já tem pedido: cancele o pedido antes.'],
  [/cannot be self-declared/, () => 'Ninguém declara alçada para si mesmo.'],
  [/supp_restriction_has_reason/, () => 'Suspender ou bloquear exige motivo.'],
  [/uq_parties_org_document/, () => 'Já existe uma parte com este documento.'],
  [/parties_cnpj_len/, () => 'CNPJ precisa de 14 dígitos.'],
  [/Cancellation requires a reason|Rejection requires a reason/, () => 'Informe o motivo — fica no histórico.'],
  [/Actor lacks permission/, () => 'Sua alçada não permite este ato de compras.'],
];

export function procurementErrorMessage(message: string): string | null {
  for (const [re, fmt] of PROCUREMENT_ERRORS) {
    const m = message.match(re);
    if (m) return fmt(m);
  }
  return null;
}
