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

export type PoAction = 'submit' | 'approve' | 'reject' | 'sync' | 'issue' | 'cancel' | 'close';
export const PO_ACTION_LABEL: Record<PoAction, string> = {
  submit: 'Submeter à aprovação', approve: 'Aprovar', reject: 'Devolver ao rascunho', sync: 'Sincronizar desfecho da aprovação',
  issue: 'Emitir ao fornecedor', cancel: 'Cancelar pedido', close: 'Encerrar pedido',
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
  // Encerrar (235): recebido → encerrado; com saldo, só com motivo (o saldo deixa de ser esperado).
  if (['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status) && caps.issue) out.push('close');
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

const finiteOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * O que a requisição da FALTA registrou (246, o retorno de
 * `purchase_requisition_from_shortage`) para a auditoria da rota: quanto foi
 * requisitado, se foi por exceção de cobertura e quanto havia pendente em
 * transferência. Retorno sem os números (réplica de uma requisição anterior à
 * 246, ou o banco ainda sem a 246): `null`, nunca 0.
 */
export function requisitionAuditFigures(out: Record<string, unknown>): {
  requisitionedQty: number | null; override: boolean; pendingTransferQty: number | null;
} {
  const requirements = Array.isArray(out.requirements) ? out.requirements as Array<Record<string, unknown>> : null;
  return {
    requisitionedQty: finiteOrNull(out.requisitioned_qty),
    override: out.override === true,
    pendingTransferQty: requirements ? requirements.reduce((acc, r) => acc + (finiteOrNull(r.pending_transfer_qty) ?? 0), 0) : null,
  };
}

const figuresOrNull = <T>(v: unknown, map: (r: Record<string, unknown>) => T): T[] | null => (Array.isArray(v)
  ? (v as Array<Record<string, unknown>>).map(map) : null);

/**
 * O que um ato do PEDIDO registrou (248) para a auditoria da rota. Todo ato:
 * estado, governança e `replayed` (a réplica idempotente é marcada, não
 * contada como ato novo). Cancelar: o desfecho no motor de aprovação e, por
 * requisito (item e unidade; nunca somas entre itens), o que voltou a ser
 * requisitado e o que foi liberado, mais a transição de cada requisição.
 * Emitir: o que a emissão parcial liberou. Retorno sem as listas (banco sem a
 * 248): `null`, nunca `[]` — lista vazia é "nada mudou".
 */
export function purchaseOrderAuditMetadata(action: string, out: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = { status: out.status ?? null, governance: out.governance ?? null, replayed: out.replayed === true };
  if (action === 'cancel') {
    meta.approvalRequestStatus = out.approval_request_status ?? null;
    meta.requirements = figuresOrNull(out.requirements, (r) => ({
      requirementId: r.requirement_id ?? null, itemId: r.item_id ?? null, unit: r.unit ?? null,
      reopenedQty: finiteOrNull(r.reopened_qty), releasedQty: finiteOrNull(r.released_qty), cause: r.cause ?? null }));
    meta.requisitions = figuresOrNull(out.requisitions, (r) => ({
      requisitionId: r.requisition_id ?? null, number: r.requisition_number ?? null, from: r.status_from ?? null, to: r.status_to ?? null }));
  }
  if (action === 'issue') {
    meta.released = figuresOrNull(out.released, (r) => ({
      requirementId: r.requirement_id ?? null, itemId: r.item_id ?? null, unit: r.unit ?? null, releasedQty: finiteOrNull(r.released_qty) }));
  }
  return meta;
}

/**
 * O que a DECISÃO de compra registrou (248) para a auditoria da rota: o
 * pedido, se seguiu a recomendação, `replayed` e as linhas cotadas que NÃO
 * entraram no pedido (`not_ordered`: requisição cancelada/encerrada/pedida, ou
 * linha sem saldo aberto), com a requisição, o estado dela e o aberto cru.
 * Retorno sem a lista (réplica, ou banco sem a 248): `null`, nunca `[]`.
 */
export function decideAuditMetadata(
  input: { quoteId?: string | null; recommendedQuoteId?: string | null }, out: Record<string, unknown>,
): Record<string, unknown> {
  return {
    purchase_order_id: out.purchase_order_id ?? null,
    follows_recommendation: !input.recommendedQuoteId || input.recommendedQuoteId === input.quoteId,
    replayed: out.replayed === true,
    not_ordered: figuresOrNull(out.not_ordered, (r) => ({
      quote_line_id: r.quote_line_id ?? null, requisition_line_id: r.requisition_line_id ?? null, requisition_id: r.requisition_id ?? null,
      requisition_number: r.requisition_number ?? null, requisition_status: r.requisition_status ?? null, open_qty: finiteOrNull(r.open_qty) })),
  };
}

/* ── Saldo aberto da requisição (248) ───────────────────────────────────────
   Alocação = linha de `purchase_requisition_line_requirements`. O que não
   pôde voltar a ser requisitado vai ao livro append-only
   `procurement_requisition_releases` (nunca cobertura ativa):
     aberto(a) = alocado(a) − Σ liberado(a)   (visão `purchase_requisition_open_allocations`)
   Linha com alocação: Σ aberto; linha sem alocação (manual): a quantidade dela.
   Alocação ou linha com aberto 0 NÃO existe como demanda viva — nenhuma
   lista, laço, vivacidade, data ou conjunto de requisitos a inclui. */

export type ReleaseStage = 'PO_ISSUED' | 'PO_CANCELLED';
export type ReleaseCause = 'NOT_ORDERED' | 'COVERED' | 'REQUIREMENT_INACTIVE';
/** Uma liberação da linha: na emissão (não pedida) ou no cancelamento do pedido, com o número dele. */
export interface RequisitionRelease { stage: ReleaseStage; cause: ReleaseCause; quantity: number; orderNumber: string | null }

/** Uma alocação da requisição com o seu saldo aberto. Números crus, sem arredondar. */
export interface OpenAllocation {
  allocationId: string | null; requisitionLineId: string; requirementId: string;
  allocatedQty: number; releasedQty: number; openQty: number;
}

/** De onde vêm as alocações: a visão da 248 ou, com o banco ainda sem ela, a tabela (aberto = alocado). */
export interface AllocationSource {
  table: string; columns: string; lineColumn: 'requisition_line_id' | 'line_id'; idColumn: 'allocation_id' | 'id'; before248: boolean;
}
export const OPEN_ALLOCATIONS_248: AllocationSource = {
  table: 'purchase_requisition_open_allocations', lineColumn: 'requisition_line_id', idColumn: 'allocation_id', before248: false,
  columns: 'allocation_id,requisition_id,requisition_line_id,requirement_id,allocated_qty,released_qty,open_qty',
};
export const ALLOCATIONS_BEFORE_248: AllocationSource = {
  table: 'purchase_requisition_line_requirements', lineColumn: 'line_id', idColumn: 'id', before248: true, columns: 'id,line_id,requirement_id,quantity',
};
export const REQUISITION_RELEASES_TABLE = 'procurement_requisition_releases';
export const REQUISITION_RELEASE_COLUMNS = 'id,requisition_line_id,allocation_id,requirement_id,purchase_order_id,stage,cause,quantity,created_at';

const qtyOf = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/** A linha da visão (ou, antes da 248, da tabela de alocações — nada liberado ainda) tipada. */
export function openAllocationOf(r: Record<string, unknown>, source: AllocationSource): OpenAllocation {
  if (source.before248) {
    const q = qtyOf(r.quantity);
    return { allocationId: r.id ? String(r.id) : null, requisitionLineId: String(r.line_id), requirementId: String(r.requirement_id),
      allocatedQty: q, releasedQty: 0, openQty: q };
  }
  return { allocationId: r.allocation_id ? String(r.allocation_id) : null, requisitionLineId: String(r.requisition_line_id),
    requirementId: String(r.requirement_id), allocatedQty: qtyOf(r.allocated_qty), releasedQty: qtyOf(r.released_qty), openQty: qtyOf(r.open_qty) };
}

/**
 * A 248 ainda não aplicada: a visão ou o livro não existem. O PostgREST
 * responde PGRST205 "Could not find the table 'public.<nome>'…"; o Postgres,
 * 42P01 `relation "<nome>" does not exist`. Só ESSA recusa, e só para o objeto
 * nomeado, cai para a leitura anterior; coluna ausente, permissão ou qualquer
 * outro erro continua erro.
 */
export function isMissing248Relation(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : null;
  if (code && code !== 'PGRST205' && code !== '42P01') return false;
  const message = typeof e.message === 'string' ? e.message : '';
  return message.includes(`relation "${relation}" does not exist`) || message.includes(`relation "public.${relation}" does not exist`)
    || message.includes(`Could not find the table '${relation}'`) || message.includes(`Could not find the table 'public.${relation}'`);
}

/** Por quanto tempo, depois de o banco recusar a visão ou o livro da 248, a leitura vai direto à anterior. */
export const REQUISITION_248_RETRY_MS = 60_000;
let requisition248MissingUntil = 0;

/**
 * As alocações com o saldo aberto, pela visão da 248 — e, se o banco ainda
 * não a tem, a MESMA leitura na tabela de alocações, com aberto = alocado (sem
 * o livro não há liberação: é a conta exata do banco anterior). Lembrado por
 * `REQUISITION_248_RETRY_MS`. `read` recebe a fonte (tabela, colunas, coluna
 * da linha) e SOBE qualquer erro; só o da relação ausente é tolerado.
 */
export async function readOpenAllocations(
  read: (source: AllocationSource) => PromiseLike<Array<Record<string, unknown>>>, now: () => number = Date.now,
): Promise<OpenAllocation[]> {
  const before = async () => (await read(ALLOCATIONS_BEFORE_248)).map((r) => openAllocationOf(r, ALLOCATIONS_BEFORE_248));
  if (now() < requisition248MissingUntil) return before();
  try {
    return (await read(OPEN_ALLOCATIONS_248)).map((r) => openAllocationOf(r, OPEN_ALLOCATIONS_248));
  } catch (error) {
    if (!isMissing248Relation(error, OPEN_ALLOCATIONS_248.table)) throw error;
    requisition248MissingUntil = now() + REQUISITION_248_RETRY_MS;
    return before();
  }
}

/** As linhas do livro de liberações; o banco ainda sem a 248 → nenhuma (o livro não existe). Qualquer outro erro SOBE. */
export async function readRequisitionReleases(
  read: () => PromiseLike<Array<Record<string, unknown>>>, now: () => number = Date.now,
): Promise<Array<Record<string, unknown>>> {
  if (now() < requisition248MissingUntil) return [];
  try {
    return await read();
  } catch (error) {
    if (!isMissing248Relation(error, REQUISITION_RELEASES_TABLE)) throw error;
    requisition248MissingUntil = now() + REQUISITION_248_RETRY_MS;
    return [];
  }
}

/** Esquece que o banco estava sem a 248 (testes; e depois de aplicar a migração). */
export function resetRequisition248Fallback(): void {
  requisition248MissingUntil = 0;
}

/** Saldo aberto da linha: com alocação, Σ aberto; sem alocação (manual), a quantidade da linha. */
export function lineOpenQuantity(lineQuantity: number, allocations: ReadonlyArray<Pick<OpenAllocation, 'openQty'>>): number {
  return allocations.length ? allocations.reduce((s, a) => s + a.openQty, 0) : lineQuantity;
}

/**
 * A necessidade da linha: a mais cedo entre os requisitos com saldo aberto
 * (a liberada não traz a data dela); sem alocação, a data da própria linha.
 */
export function lineRequiredBy(
  line: { requiredBy: string | null }, allocations: ReadonlyArray<Pick<OpenAllocation, 'requirementId' | 'openQty'>>,
  requiredByOf: (requirementId: string) => string | null | undefined,
): string | null {
  if (!allocations.length) return line.requiredBy;
  return allocations.filter((a) => a.openQty > 0).map((a) => requiredByOf(a.requirementId) ?? null)
    .filter((d): d is string => !!d).sort()[0] ?? null;
}

/**
 * "Em cotação" (`inRfq`): a linha está numa cotação VIVA — a mesma regra do
 * banco (248, `procurement_rfq_create` e o estado derivado do cancelamento):
 *  • a cotação está ABERTA; ou
 *  • a cotação está DECIDIDA e o pedido NÃO cancelado da decisão tem uma
 *    linha para esta linha da requisição (`ordersLine`, `rfqOrderedLines`).
 * A linha que a proposta vencedora não cotou (o pedido nasceu sem ela) volta a
 * poder ser cotada; a de pedido cancelado também. O estado vem da cotação lida
 * de fato (de qualquer idade); sem ele, não se presume cotação viva.
 */
export function lineInLiveRfq(rfqStatus: string | null | undefined, ordersLine: boolean): boolean {
  return rfqStatus === 'OPEN' || (rfqStatus === 'DECIDED' && ordersLine);
}

/**
 * O `ordersLine` de `lineInLiveRfq`, lido das linhas cruas: a decisão de cada
 * cotação → o pedido dela NÃO cancelado → a linha do pedido para a linha da
 * requisição (`purchase_order_lines.requisition_line_id`). Pedido sem decisão
 * (ou de decisão não lida) não prende linha nenhuma.
 */
export function rfqOrderedLines(
  decisions: ReadonlyArray<{ id?: unknown; rfq_id?: unknown }>,
  orders: ReadonlyArray<{ id?: unknown; status?: unknown; sourcing_decision_id?: unknown }>,
  orderLines: ReadonlyArray<{ purchase_order_id?: unknown; requisition_line_id?: unknown }>,
): (rfqId: string, requisitionLineId: string) => boolean {
  const rfqOfDecision = new Map(decisions.map((d) => [String(d.id), String(d.rfq_id)]));
  const rfqOfOrder = new Map<string, string>();
  for (const o of orders) {
    const rfq = o.sourcing_decision_id && o.status !== 'CANCELLED' ? rfqOfDecision.get(String(o.sourcing_decision_id)) : undefined;
    if (rfq) rfqOfOrder.set(String(o.id), rfq);
  }
  const ordered = new Set<string>();
  for (const l of orderLines) {
    const rfq = rfqOfOrder.get(String(l.purchase_order_id));
    if (rfq && l.requisition_line_id) ordered.add(`${rfq}|${String(l.requisition_line_id)}`);
  }
  return (rfqId, requisitionLineId) => ordered.has(`${rfqId}|${requisitionLineId}`);
}

/**
 * A linha da cotação ainda pode virar pedido (248) — a régua de
 * `procurement_decide`: a requisição dela está SUBMITTED/SOURCING e a linha
 * tem saldo aberto > 0. Requisição ou saldo não lidos: não vira pedido.
 */
export function rfqLineOrderable(requisitionStatus: string | null | undefined, openQuantity: number | null | undefined): boolean {
  return (requisitionStatus === 'SUBMITTED' || requisitionStatus === 'SOURCING') && (openQuantity ?? 0) > 0;
}

/**
 * A comparação pela régua de `evaluateQuotes`, sobre o que o banco vai pedir
 * (248). Numa cotação ABERTA só as linhas que ainda viram pedido
 * (`rfqLineOrderable`) contam na completude, no custo posto e na necessidade:
 * a proposta que cota só as linhas vivas é completa, e o preço da linha
 * morta não entra no custo. Sem nenhuma linha que vire pedido, nenhuma
 * proposta é elegível (o banco recusa a decisão). Cotação decidida ou
 * cancelada: a comparação é o registro do que se decidiu — todas as linhas.
 */
export function evaluateOrderableQuotes(
  rfqStatus: string | null | undefined, rfqLines: ReadonlyArray<ComparableRfqLine & { orderable: boolean }>,
  quotes: ComparableQuote[], today: string, reliability: Record<string, number | null> = {},
): QuoteEvaluation[] {
  if (rfqStatus !== 'OPEN') return evaluateQuotes([...rfqLines], quotes, today, reliability);
  const live = rfqLines.filter((l) => l.orderable);
  const liveIds = new Set(live.map((l) => l.id));
  const evaluations = evaluateQuotes(live, quotes.map((q) => ({ ...q, lines: q.lines.filter((l) => liveIds.has(l.rfqLineId)) })),
    today, reliability);
  return live.length ? evaluations
    : evaluations.map((e) => ({ ...e, eligible: false, flags: [...e.flags, 'nenhuma linha desta cotação pode virar pedido'] }));
}

const RELEASE_STAGES = new Set<string>(['PO_ISSUED', 'PO_CANCELLED']);
const RELEASE_CAUSES = new Set<string>(['NOT_ORDERED', 'COVERED', 'REQUIREMENT_INACTIVE']);

/**
 * As liberações de uma linha, do livro: uma por (etapa, causa, pedido), na
 * ordem em que aconteceram — a mesma linha tem um item e uma unidade, então
 * somar as alocações dela é somar a mesma coisa. Quantidade crua.
 */
export function lineReleases(
  rows: ReadonlyArray<Record<string, unknown>>, orderNumberOf: (purchaseOrderId: string) => string | null | undefined,
): RequisitionRelease[] {
  const out = new Map<string, RequisitionRelease & { at: string }>();
  for (const r of [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))) {
    const stage = String(r.stage); const cause = String(r.cause); const po = r.purchase_order_id ? String(r.purchase_order_id) : null;
    const quantity = qtyOf(r.quantity);
    if (!RELEASE_STAGES.has(stage) || !RELEASE_CAUSES.has(cause) || quantity <= 0) continue;
    const key = `${stage}|${cause}|${po ?? ''}`;
    const cur = out.get(key);
    if (cur) cur.quantity += quantity;
    else out.set(key, { stage: stage as ReleaseStage, cause: cause as ReleaseCause, quantity, orderNumber: po ? orderNumberOf(po) ?? null : null,
      at: String(r.created_at ?? '') });
  }
  return Array.from(out.values()).map(({ at: _at, ...r }) => r);
}

/** Quantidade por extenso, sem arredondar (só o ruído do ponto flutuante some). */
const exactQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 10 });

/**
 * A nota do liberado ("40 m não pedidos no OC-…" / "40 m liberados no
 * cancelamento do OC-…"), uma frase por etapa e pedido; nada liberado → `null`.
 */
export function releaseNote(releases: ReadonlyArray<Pick<RequisitionRelease, 'stage' | 'quantity' | 'orderNumber'>>, unit: string | null): string | null {
  const byOrder = new Map<string, { stage: ReleaseStage; quantity: number; orderNumber: string | null }>();
  for (const r of releases) {
    if (!(r.quantity > 0)) continue;
    const key = `${r.stage}|${r.orderNumber ?? ''}`;
    const cur = byOrder.get(key);
    if (cur) cur.quantity += r.quantity;
    else byOrder.set(key, { stage: r.stage, quantity: r.quantity, orderNumber: r.orderNumber });
  }
  const parts = Array.from(byOrder.values()).map((r) => {
    const q = `${exactQty(r.quantity)}${unit ? ` ${unit}` : ''}`;
    const order = r.orderNumber ?? 'pedido';
    return r.stage === 'PO_ISSUED' ? `${q} não pedidos no ${order}` : `${q} liberados no cancelamento do ${order}`;
  });
  return parts.length ? parts.join('; ') : null;
}

/** O estado da requisição dito numa frase ("foi cancelada", "já tem pedido emitido"). */
function requisitionStateText(status: string): string {
  if (status === 'CANCELLED') return 'foi cancelada';
  if (status === 'CLOSED') return 'foi encerrada';
  if (status === 'ORDERED') return 'já tem pedido emitido';
  const label = REQUISITION_STATUS_LABEL[status as RequisitionStatus];
  return `está ${label ? label.toLowerCase() : status}`;
}

/** Recusas do banco de compras em português. */
const PROCUREMENT_ERRORS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/no uncovered shortage left to requisition \(([\d.]+) already requested\)/, (m) => `Essa falta já está requisitada (${Number(m[1])}).`],
  // 246: o comprável é zero porque transferência(s) PEDIDA(S) cobrem o resto — resolver a transferência ou exceção governada.
  [/is covered by pending internal transfer\(s\) (.+?): dispatch or cancel the transfer/, (m) => {
    const numbers = m[1].trim();
    return `Essa falta está coberta por transferência pendente${numbers ? ` (${numbers})` : ''}: despache ou cancele a transferência, `
      + 'ou registre uma exceção de cobertura.';
  }],
  [/Coverage exception requires procurement\.coverage_override/,
    () => 'A exceção de cobertura exige a alçada procurement.coverage_override (comprar também o que a transferência pendente vai trazer).'],
  [/Coverage exception requires a reason of at least (\d+) characters/,
    (m) => `A exceção de cobertura exige um motivo com pelo menos ${Number(m[1])} caracteres — fica no registro da exceção.`],
  [/is not a confirmed material with an item/, () => 'Só requisito de material confirmado, com item, vira requisição.'],
  [/preqn_manual_justified/, () => 'Requisição manual exige justificativa.'],
  [/not invited/, () => 'Fornecedor suspenso, bloqueado ou inexistente não é convidado.'],
  [/already in a live RFQ/, () => 'Esta linha já está numa cotação aberta.'],
  // 248: a cotação pede só o saldo aberto; requisição fora de cotação e linha toda liberada não entram.
  [/Requisition is ([A-Z_]+): it is not sourced/, (m) => `A requisição ${requisitionStateText(m[1])}: não vai para cotação.`],
  [/Requisition line is fully released: nothing left to source/,
    () => 'Esta linha da requisição foi liberada por inteiro: não há saldo a cotar.'],
  // 248: proposta antiga de requisição cancelada/encerrada não vira pedido; pedido dela não é emitido.
  [/No line of this quotation can become an order: its requisitions were cancelled or closed/,
    () => 'Nenhuma linha desta proposta vira pedido: as requisições dela foram canceladas ou encerradas.'],
  [/Requisition (\S+) is ([A-Z_]+): this order can no longer be issued/,
    (m) => `A requisição ${m[1]} ${requisitionStateText(m[2])}: este pedido não pode mais ser emitido.`],
  [/Requisition is CLOSED: nothing to cancel/, () => 'A requisição já foi encerrada: não há o que cancelar.'],
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
