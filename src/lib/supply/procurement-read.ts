/**
 * READ MODEL de Compras e Fornecedores — lido pelo cliente autenticado (RLS).
 * Totais de pedido e comparação de propostas são derivados das linhas; nada
 * é somado e guardado.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/procurement-read.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPages, selectIn } from '@/lib/supabase/select-in';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '@/lib/operations/project-identity';
import {
  evaluateOrderableQuotes, lineInLiveRfq, lineOpenQuantity, lineReleases, lineRequiredBy, readOpenAllocations, readRequisitionReleases,
  quoteableQuantity, recommendQuote, REQUISITION_RELEASE_COLUMNS, REQUISITION_RELEASES_TABLE, rfqLineOrderable, rfqOrderedLines, type ComparableQuote,
  type PurchaseOrderStatus, type RequisitionStatus, type RfqStatus, type SupplierStatus,
} from './procurement';
import { onTimeRate } from './receiving';

type Session = { supabase: SupabaseClient; organizationId: string };
type Row = Record<string, unknown>;

/**
 * `.in(ids)` em lotes, no formato `{ data }` que a leitura já consome. Com a
 * lista inteira na URL o PostgREST devolvia 414 a partir de ~200 ids e a falha
 * virava lista vazia (0 linhas aguardando cotação com 216 requisições). Aqui
 * erro SOBE.
 */
const inChunks = async (ids: readonly string[], run: (chunk: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) =>
  ({ data: await selectIn<Row>(ids, run as (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) });
/**
 * Lista INTEIRA do inquilino, em páginas de 1 000 com ordem estável: o PostgREST corta cada resposta em 1 000 linhas,
 * seja qual for o `.limit()` — acima disso fornecedores, pedidos e locais sumiam da lista sem aviso. Erro sobe.
 */
const whole = (what: string, page: (f: number, t: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) =>
  selectAllPages<Row>(page as (f: number, t: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>)
    .catch((cause) => { throw new Error(`Não foi possível ler ${what}.`, { cause }); });
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface SupplierView {
  id: string; partyId: string; name: string; legalName: string; document: string | null; status: SupplierStatus;
  statusReason: string | null; categories: string[]; defaultPaymentTerms: string | null; defaultLeadTimeDays: number | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  orders: number; openOrders: number; onTimeRate: number | null;
  /** Linhas com data prometida já medidas — o tamanho da amostra da pontualidade. */
  deliveryLines: number;
  avgDelayDays: number | null; rejectionLines: number; receivedLines: number; lastReceiptAt: string | null;
}

export async function listSuppliers(session: Session): Promise<SupplierView[]> {
  const sb = session.supabase; const org = session.organizationId;
  const rows = await whole('os fornecedores', (f, t) => sb.from('supplier_profiles')
    .select('id,party_id,status,status_reason,categories,default_payment_terms,default_lead_time_days,contact_name,contact_email,contact_phone')
    .eq('organization_id', org).order('id').range(f, t));
  const partyIds = rows.map((r) => String(r.party_id));
  // Sem os pedidos ou a pontualidade, "0 pedidos" e "pontualidade desconhecida" seriam mentira: erro sobe.
  const [parties, ords, performance] = await Promise.all([
    inChunks(partyIds, (c) => sb.from('parties').select('id,legal_name,trade_name,document_number').eq('organization_id', org).in('id', c)),
    whole('os pedidos e a pontualidade dos fornecedores', (f, t) => sb.from('purchase_orders').select('id,supplier_id,status')
      .eq('organization_id', org).order('id').range(f, t)),
    whole('os pedidos e a pontualidade dos fornecedores', (f, t) => sb.from('supplier_delivery_performance')
      .select('supplier_id,promised_lines,on_time_lines,avg_delay_days,lines_with_rejection,received_lines,last_receipt_at')
      .eq('organization_id', org).order('supplier_id').range(f, t)),
  ]);
  const perf = new Map(performance.map((p) => [String(p.supplier_id),
    { promised_lines: num(p.promised_lines), on_time_lines: num(p.on_time_lines),
      avg_delay_days: p.avg_delay_days === null || p.avg_delay_days === undefined ? null : num(p.avg_delay_days),
      lines_with_rejection: num(p.lines_with_rejection), received_lines: num(p.received_lines), last_receipt_at: str(p.last_receipt_at) }]));
  const pm = new Map(((parties.data ?? []) as Row[]).map((p) => [String(p.id), p]));
  return rows.map((r) => {
    const p = pm.get(String(r.party_id));
    const mine = ords.filter((o) => o.supplier_id === r.id);
    return {
      id: String(r.id), partyId: String(r.party_id), name: String(p?.trade_name ?? p?.legal_name ?? 'Fornecedor'),
      legalName: String(p?.legal_name ?? '—'), document: str(p?.document_number), status: r.status as SupplierStatus,
      statusReason: str(r.status_reason), categories: (r.categories as string[]) ?? [],
      defaultPaymentTerms: str(r.default_payment_terms), defaultLeadTimeDays: r.default_lead_time_days === null ? null : num(r.default_lead_time_days),
      contactName: str(r.contact_name), contactEmail: str(r.contact_email), contactPhone: str(r.contact_phone),
      orders: mine.filter((o) => o.status !== 'CANCELLED').length,
      openOrders: mine.filter((o) => ['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(String(o.status))).length,
      // Pontualidade DERIVADA dos recebimentos (235); sem histórico, desconhecida — nunca inventada.
      onTimeRate: onTimeRate(perf.get(String(r.id))),
      deliveryLines: perf.get(String(r.id))?.promised_lines ?? 0,
      avgDelayDays: perf.get(String(r.id))?.avg_delay_days ?? null, rejectionLines: perf.get(String(r.id))?.lines_with_rejection ?? 0,
      receivedLines: perf.get(String(r.id))?.received_lines ?? 0, lastReceiptAt: perf.get(String(r.id))?.last_receipt_at ?? null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAuthorities(session: Session) {
  const sb = session.supabase; const org = session.organizationId;
  const { data, error } = await sb.from('procurement_approval_authorities')
    .select('id,project_id,category,grantee_kind,grantee_role_id,grantee_user_id,max_amount,currency,source_kind,source_reference,justification,effective_from,effective_until,active,declared_by,created_at,revocation_reason')
    .eq('organization_id', org).order('created_at', { ascending: false }).limit(500);
  // Sem esta checagem, uma falha virava "nenhuma alçada declarada" — e convidava a declarar de novo.
  if (error) throw new Error('Não foi possível ler as alçadas de compra.');
  const rows = (data ?? []) as Row[];
  const roleIds = Array.from(new Set(rows.map((r) => r.grantee_role_id).filter(Boolean))) as string[];
  const [roles, people] = await Promise.all([
    roleIds.length ? sb.from('roles').select('id,key,name').in('id', roleIds) : Promise.resolve({ data: [], error: null }),
    resolveOwnerNames(org, rows.flatMap((r) => [r.grantee_user_id as string | null, r.declared_by as string | null])),
  ]);
  if (roles.error) throw new Error('Não foi possível ler os papéis das alçadas de compra.');
  const rm = new Map(((roles.data ?? []) as Row[]).map((r) => [String(r.id), String(r.name ?? r.key)]));
  return rows.map((r) => ({
    id: String(r.id), grantee: r.grantee_kind === 'ROLE' ? `Papel: ${rm.get(String(r.grantee_role_id)) ?? 'papel'}`
      : `Pessoa: ${people[String(r.grantee_user_id)] ?? 'usuário'}`,
    maxAmount: r.max_amount === null ? null : num(r.max_amount), currency: String(r.currency), projectId: str(r.project_id),
    category: str(r.category), sourceKind: String(r.source_kind), sourceReference: String(r.source_reference),
    justification: String(r.justification), effectiveFrom: String(r.effective_from), effectiveUntil: str(r.effective_until),
    active: Boolean(r.active), declaredBy: people[String(r.declared_by)] ?? null, revocationReason: str(r.revocation_reason),
  }));
}

export async function procurementWorkspace(session: Session, today: string) {
  const sb = session.supabase; const org = session.organizationId;
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 90);
  const live = `requested_at.gte.${since.toISOString()}`;
  const [reqs, rfqs, pos, suppliers, authorities] = await Promise.all([
    sb.from('purchase_requisitions').select('id,requisition_number,project_id,source,status,priority,required_by,delivery_location_id,justification,requested_by,requested_at,close_reason')
      .eq('organization_id', org).or(`status.in.(SUBMITTED,SOURCING),${live}`).order('requested_at', { ascending: false }).limit(500),
    sb.from('procurement_rfqs').select('id,rfq_number,status,response_due,note,created_by,created_at,close_reason')
      .eq('organization_id', org).or(`status.eq.OPEN,created_at.gte.${since.toISOString()}`).order('created_at', { ascending: false }).limit(300),
    sb.from('purchase_orders').select('id,order_number,supplier_id,sourcing_decision_id,project_id,status,currency,freight_amount,tax_amount,payment_terms,delivery_location_id,expected_delivery,approval_governance,approval_request_id,approved_by,approved_at,submitted_by,issued_at,created_by,created_at,close_reason')
      .eq('organization_id', org).or(`status.in.(DRAFT,APPROVAL_REQUIRED,APPROVED,ISSUED,PARTIALLY_RECEIVED),created_at.gte.${since.toISOString()}`)
      .order('created_at', { ascending: false }).limit(500),
    listSuppliers(session),
    listAuthorities(session),
  ]);
  for (const r of [reqs, rfqs, pos]) if (r.error) throw new Error('Não foi possível ler compras.');
  const reqRows = (reqs.data ?? []) as Row[]; const rfqRows = (rfqs.data ?? []) as Row[]; const poRows = (pos.data ?? []) as Row[];
  const reqIds = reqRows.map((r) => String(r.id)); const rfqIds = rfqRows.map((r) => String(r.id)); const poIds = poRows.map((r) => String(r.id));

  const [reqLines, rfqLines, invited, quotes, decisions, poLines, history, approvals] = await Promise.all([
    inChunks(reqIds, (c) => sb.from('purchase_requisition_lines').select('id,requisition_id,item_id,quantity,required_by,estimated_unit_price,note')
      .eq('organization_id', org).in('requisition_id', c)),
    inChunks(rfqIds, (c) => sb.from('procurement_rfq_lines').select('id,rfq_id,requisition_line_id,item_id,quantity,required_by')
      .eq('organization_id', org).in('rfq_id', c)),
    inChunks(rfqIds, (c) => sb.from('procurement_rfq_suppliers').select('rfq_id,supplier_id').eq('organization_id', org).in('rfq_id', c)),
    inChunks(rfqIds, (c) => sb.from('supplier_quotes').select('id,rfq_id,supplier_id,version,status,currency,freight_amount,tax_amount,payment_terms,validity_date,lead_time_days,deviations,recorded_at')
      .eq('organization_id', org).in('rfq_id', c)),
    inChunks(rfqIds, (c) => sb.from('sourcing_decisions').select('id,rfq_id,quote_id,recommended_quote_id,follows_recommendation,rationale,decided_by,decided_at')
      .eq('organization_id', org).in('rfq_id', c)),
    inChunks(poIds, (c) => sb.from('purchase_order_lines').select('id,purchase_order_id,item_id,quantity,unit_price,expected_date,received_quantity')
      .eq('organization_id', org).in('purchase_order_id', c)),
    // Em lotes a ordem global se perde: reordena depois de somar.
    inChunks(poIds, (c) => sb.from('purchase_order_history').select('id,purchase_order_id,transition,from_status,to_status,reason,actor_user_id,actor_source,occurred_at')
      .eq('organization_id', org).in('purchase_order_id', c)).then((r) => ({
      data: [...r.data].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))) })),
    inChunks(poIds, (c) => sb.from('approval_requests').select('id,status,current_stage_no,subject_id').eq('organization_id', org)
      .eq('subject_type', 'purchase_order').in('subject_id', c)),
  ]);
  const reqLineRows = (reqLines.data ?? []) as Row[]; const rfqLineRows = (rfqLines.data ?? []) as Row[];
  const quoteRows = (quotes.data ?? []) as Row[]; const poLineRows = (poLines.data ?? []) as Row[];
  const quoteIds = quoteRows.map((q) => String(q.id));
  const reqLineIds = reqLineRows.map((l) => String(l.id));
  const poLineIds = poLineRows.map((l) => String(l.id));
  // 248: as linhas de requisição das cotações lidas que ficaram fora da janela das requisições — o estado e o
  // aberto delas decidem se a linha da cotação ainda vira pedido (`orderable`).
  const knownReqLines = new Set(reqLineIds);
  const outsideReqLineIds = Array.from(new Set(rfqLineRows.map((l) => str(l.requisition_line_id)).filter((id): id is string => !!id)))
    .filter((id) => !knownReqLines.has(id));
  const [quoteLines, openAllocations, releaseRows, lineRfqs, poAllocations, lineOrders, outsideReqLines] = await Promise.all([
    inChunks(quoteIds, (c) => sb.from('supplier_quote_lines').select('quote_id,rfq_line_id,unit_price,quantity,lead_time_days,compliant,note')
      .eq('organization_id', org).in('quote_id', c)),
    // 248: cada alocação com o saldo aberto (alocado − liberado); banco sem a 248, a tabela de alocações (aberto = alocado).
    readOpenAllocations(async (src) => (await inChunks([...reqLineIds, ...outsideReqLineIds], (c) => sb.from(src.table).select(src.columns)
      .eq('organization_id', org).in(src.lineColumn, c))).data),
    readRequisitionReleases(async () => (await inChunks(reqLineIds, (c) => sb.from(REQUISITION_RELEASES_TABLE).select(REQUISITION_RELEASE_COLUMNS)
      .eq('organization_id', org).in('requisition_line_id', c))).data),
    // Toda cotação de cada linha, de qualquer idade: a janela de 90 dias das cotações não decide se a linha está em cotação.
    inChunks(reqLineIds, (c) => sb.from('procurement_rfq_lines').select('rfq_id,requisition_line_id')
      .eq('organization_id', org).in('requisition_line_id', c)),
    inChunks(poLineIds, (c) => sb.from('purchase_order_line_requirements').select('line_id,requirement_id,quantity,received_quantity')
      .eq('organization_id', org).in('line_id', c)),
    // 248: as linhas de pedido de cada linha de requisição, de qualquer idade — cotação DECIDIDA só prende a linha
    // que o pedido (não cancelado) da decisão pediu.
    inChunks(reqLineIds, (c) => sb.from('purchase_order_lines').select('purchase_order_id,requisition_line_id')
      .eq('organization_id', org).in('requisition_line_id', c)),
    inChunks(outsideReqLineIds, (c) => sb.from('purchase_requisition_lines').select('id,requisition_id,quantity')
      .eq('organization_id', org).in('id', c)),
  ]);
  const quoteLineRows = (quoteLines.data ?? []) as Row[];
  const poAllocRows = (poAllocations.data ?? []) as Row[]; const lineRfqRows = (lineRfqs.data ?? []) as Row[];
  const lineOrderRows = (lineOrders.data ?? []) as Row[]; const outsideReqLineRows = (outsideReqLines.data ?? []) as Row[];

  const itemIds = new Set<string>([...reqLineRows, ...rfqLineRows, ...poLineRows].map((l) => String(l.item_id)));
  const projectIds = new Set<string>([...reqRows, ...poRows].map((r) => r.project_id).filter(Boolean) as string[]);
  const requirementIds = Array.from(new Set([...openAllocations.filter((a) => knownReqLines.has(a.requisitionLineId)).map((a) => a.requirementId),
    ...poAllocRows.map((a) => String(a.requirement_id))]));
  // Cotações, decisões, pedidos e requisições citados pelas linhas e pelo livro que ficaram fora das janelas lidas acima.
  const rfqStatus = new Map(rfqRows.map((q) => [String(q.id), String(q.status)]));
  const orderNumber = new Map(poRows.map((p) => [String(p.id), String(p.order_number)]));
  const reqStatus = new Map(reqRows.map((r) => [String(r.id), String(r.status)]));
  const olderRfqIds = Array.from(new Set(lineRfqRows.map((x) => String(x.rfq_id)))).filter((id) => !rfqStatus.has(id));
  const olderPoIds = Array.from(new Set([...releaseRows.map((r) => String(r.purchase_order_id ?? '')), ...lineOrderRows.map((l) => String(l.purchase_order_id))]
    .filter(Boolean))).filter((id) => !orderNumber.has(id));
  const outsideReqIds = Array.from(new Set(outsideReqLineRows.map((l) => String(l.requisition_id)))).filter((id) => !reqStatus.has(id));
  const [items, projects, requirements, locations, people, olderRfqs, olderPos, olderDecisions, outsideReqs] = await Promise.all([
    inChunks(Array.from(itemIds), (c) => sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org).in('id', c)),
    inChunks(Array.from(projectIds), (c) => sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', c)),
    inChunks(requirementIds, (c) => sb.from('project_requirements').select('id,title,project_id,required_by').eq('organization_id', org).in('id', c)),
    whole('os locais de entrega', (f, t) => sb.from('inventory_locations').select('id,name,kind,project_id,active')
      .eq('organization_id', org).order('id').range(f, t)),
    resolveOwnerNames(org, [...reqRows.map((r) => r.requested_by), ...poRows.flatMap((p) => [p.created_by, p.approved_by, p.submitted_by]),
      ...((history.data ?? []) as Row[]).map((h) => h.actor_user_id), ...((decisions.data ?? []) as Row[]).map((d) => d.decided_by)] as Array<string | null>),
    inChunks(olderRfqIds, (c) => sb.from('procurement_rfqs').select('id,status').eq('organization_id', org).in('id', c)),
    inChunks(olderPoIds, (c) => sb.from('purchase_orders').select('id,order_number,status,sourcing_decision_id').eq('organization_id', org).in('id', c)),
    inChunks(olderRfqIds, (c) => sb.from('sourcing_decisions').select('id,rfq_id').eq('organization_id', org).in('rfq_id', c)),
    inChunks(outsideReqIds, (c) => sb.from('purchase_requisitions').select('id,status').eq('organization_id', org).in('id', c)),
  ]);
  for (const q of olderRfqs.data) rfqStatus.set(String(q.id), String(q.status));
  for (const p of olderPos.data) orderNumber.set(String(p.id), String(p.order_number));
  for (const r of outsideReqs.data) reqStatus.set(String(r.id), String(r.status));
  // Em cotação viva (248): ABERTA, ou DECIDIDA cujo pedido não cancelado pediu a linha — a regra do banco.
  const ordersLine = rfqOrderedLines([...((decisions.data ?? []) as Row[]), ...olderDecisions.data], [...poRows, ...olderPos.data], lineOrderRows);
  const itemMap = new Map(((items.data ?? []) as Row[]).map((i) => [String(i.id), i]));
  const reqTitle = new Map(((requirements.data ?? []) as Row[]).map((r) => [String(r.id), String(r.title)]));
  const reqRow = new Map(((requirements.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  // Projetos citados só pelos requisitos (pedido de vários projetos) também ganham nome.
  const missingProjects = Array.from(new Set(((requirements.data ?? []) as Row[]).map((r) => String(r.project_id)))).filter((id) => !projectIds.has(id));
  const extraProjects = (await inChunks(missingProjects, (c) => sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', c))).data;
  const projMap = new Map(([...(projects.data ?? []), ...extraProjects] as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  const locRows = locations;
  const locName = new Map(locRows.map((l) => [String(l.id), String(l.name)]));
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  const who = (id: unknown) => (id ? people[String(id)] ?? null : null);
  const item = (id: unknown) => {
    const i = itemMap.get(String(id));
    return { itemId: String(id), itemCode: String(i?.code ?? '—'), itemDescription: String(i?.description ?? 'Item'), unit: String(i?.unit ?? '') };
  };

  const requisitions = reqRows.map((r) => ({
    id: String(r.id), number: String(r.requisition_number), status: r.status as RequisitionStatus, source: String(r.source),
    priority: String(r.priority), requiredBy: str(r.required_by), projectId: str(r.project_id),
    project: r.project_id ? projMap.get(String(r.project_id)) ?? String(r.project_id) : 'Vários projetos',
    deliveryLocation: r.delivery_location_id ? locName.get(String(r.delivery_location_id)) ?? null : null,
    justification: str(r.justification), requestedBy: who(r.requested_by), requestedAt: String(r.requested_at),
    closeReason: str(r.close_reason),
    lines: reqLineRows.filter((l) => l.requisition_id === r.id).map((l) => {
      const allocs = openAllocations.filter((a) => a.requisitionLineId === l.id);
      return {
        // `quantity` = o requisitado originalmente; `openQuantity` = o que ainda é demanda (248) — a cotação pede só ele.
        id: String(l.id), ...item(l.item_id), quantity: num(l.quantity), openQuantity: lineOpenQuantity(num(l.quantity), allocs),
        // A necessidade é a dos requisitos EM ABERTO (a do liberado não conta) — a mesma data que a cotação e a Apex usam.
        requiredBy: lineRequiredBy({ requiredBy: str(l.required_by) }, allocs, (id) => str(reqRow.get(id)?.required_by)),
        // Em cotação viva, de qualquer idade: ABERTA, ou DECIDIDA cujo pedido não cancelado pediu esta linha. A linha que a
        // proposta vencedora não cotou volta a poder ser cotada.
        inRfq: lineRfqRows.some((x) => x.requisition_line_id === l.id
          && lineInLiveRfq(rfqStatus.get(String(x.rfq_id)), ordersLine(String(x.rfq_id), String(l.id)))),
        releases: lineReleases(releaseRows.filter((x) => x.requisition_line_id === l.id), (id) => orderNumber.get(id)),
        // Os requisitos EM ABERTO primeiro (demanda viva); o liberado por inteiro vem depois, só como histórico (aberto 0).
        requirements: [...allocs.filter((a) => a.openQty > 0), ...allocs.filter((a) => !(a.openQty > 0))].map((a) => ({
          requirementId: a.requirementId, title: reqTitle.get(a.requirementId) ?? 'Requisito', quantity: a.allocatedQty, openQuantity: a.openQty })),
      };
    }),
  }));

  // 248: a linha da cotação vira pedido só com a requisição em busca e saldo aberto — a régua de `procurement_decide`.
  const reqLineFacts = new Map([...reqLineRows, ...outsideReqLineRows].map((l) => [String(l.id),
    { requisitionId: String(l.requisition_id), quantity: num(l.quantity) }]));
  const lineOpenOf = (requisitionLineId: string) => {
    const facts = reqLineFacts.get(requisitionLineId);
    return facts ? lineOpenQuantity(facts.quantity, openAllocations.filter((a) => a.requisitionLineId === requisitionLineId)) : 0;
  };
  const lineOrderable = (requisitionLineId: string | null) => {
    const facts = requisitionLineId ? reqLineFacts.get(requisitionLineId) : undefined;
    return !!facts && rfqLineOrderable(reqStatus.get(facts.requisitionId), lineOpenOf(requisitionLineId as string));
  };

  const decisionRows = (decisions.data ?? []) as Row[];
  const rfqsView = rfqRows.map((q) => {
    const lines = rfqLineRows.filter((l) => l.rfq_id === q.id).map((l) => ({ id: String(l.id), ...item(l.item_id),
      quantity: num(l.quantity), requiredBy: str(l.required_by), requisitionLineId: str(l.requisition_line_id),
      // Vira pedido se decidida agora? Fora do pedido: requisição cancelada/encerrada/pedida, ou linha sem saldo aberto.
      orderable: lineOrderable(str(l.requisition_line_id)),
      // 250: o que uma proposta pode cotar nesta linha agora — LEAST(linha da cotação, aberto da linha de requisição);
      // 0 fora do pedido. O banco recusa acima disso (nunca apara).
      quoteable: quoteableQuantity(num(l.quantity), lineOrderable(str(l.requisition_line_id)),
        l.requisition_line_id ? lineOpenOf(String(l.requisition_line_id)) : 0) }));
    const comparable: ComparableQuote[] = quoteRows.filter((x) => x.rfq_id === q.id).map((x) => {
      const s = supMap.get(String(x.supplier_id));
      return { id: String(x.id), supplierId: String(x.supplier_id), supplier: s?.name ?? 'Fornecedor', supplierStatus: s?.status ?? 'PROSPECT',
        version: num(x.version), status: x.status as ComparableQuote['status'], currency: String(x.currency),
        freight: num(x.freight_amount), tax: num(x.tax_amount), leadTimeDays: x.lead_time_days === null ? null : num(x.lead_time_days),
        validityDate: str(x.validity_date), deviations: str(x.deviations), paymentTerms: str(x.payment_terms),
        lines: quoteLineRows.filter((l) => l.quote_id === x.id).map((l) => ({ rfqLineId: String(l.rfq_line_id), unitPrice: num(l.unit_price),
          quantity: num(l.quantity), leadTimeDays: l.lead_time_days === null ? null : num(l.lead_time_days), compliant: Boolean(l.compliant) })) };
    });
    // Cotação aberta: completude, custo posto e necessidade só sobre as linhas que viram pedido (a decisão só pede elas).
    const evaluations = evaluateOrderableQuotes(String(q.status), lines, comparable, today,
      Object.fromEntries(Array.from(supMap.values()).map((s) => [s.id, s.onTimeRate])));
    const decision = decisionRows.find((d) => d.rfq_id === q.id);
    return {
      id: String(q.id), number: String(q.rfq_number), status: q.status as RfqStatus, responseDue: str(q.response_due),
      note: str(q.note), createdAt: String(q.created_at), closeReason: str(q.close_reason), lines,
      invited: ((invited.data ?? []) as Row[]).filter((i) => i.rfq_id === q.id).map((i) => ({ supplierId: String(i.supplier_id),
        supplier: supMap.get(String(i.supplier_id))?.name ?? 'Fornecedor' })),
      quotes: comparable, evaluations, recommendation: recommendQuote(evaluations),
      decision: decision ? { id: String(decision.id), quoteId: String(decision.quote_id), followsRecommendation: Boolean(decision.follows_recommendation),
        rationale: String(decision.rationale), decidedBy: who(decision.decided_by), decidedAt: String(decision.decided_at) } : null,
    };
  });

  const approvalRows = (approvals.data ?? []) as Row[];
  const historyRows = (history.data ?? []) as Row[];
  const purchaseOrders = poRows.map((p) => {
    const lines = poLineRows.filter((l) => l.purchase_order_id === p.id).map((l) => ({ id: String(l.id), ...item(l.item_id),
      quantity: num(l.quantity), unitPrice: num(l.unit_price), expectedDate: str(l.expected_date), received: num(l.received_quantity),
      // Por que esta linha existe: os requisitos que ela cobre (e quanto de cada).
      requirements: poAllocRows.filter((a) => a.line_id === l.id).map((a) => {
        const r = reqRow.get(String(a.requirement_id));
        return { requirementId: String(a.requirement_id), title: reqTitle.get(String(a.requirement_id)) ?? 'Requisito',
          projectId: r ? String(r.project_id) : null, project: r ? projMap.get(String(r.project_id)) ?? String(r.project_id) : null,
          requiredBy: r ? str(r.required_by) : null, quantity: num(a.quantity), received: num(a.received_quantity) };
      }) }));
    const goods = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    const req = approvalRows.find((a) => a.id === p.approval_request_id);
    return {
      id: String(p.id), number: String(p.order_number), status: p.status as PurchaseOrderStatus, supplierId: String(p.supplier_id),
      decisionId: str(p.sourcing_decision_id),
      supplier: supMap.get(String(p.supplier_id))?.name ?? 'Fornecedor', projectId: str(p.project_id),
      project: p.project_id ? projMap.get(String(p.project_id)) ?? String(p.project_id) : 'Vários projetos',
      currency: String(p.currency), goods, freight: num(p.freight_amount), tax: num(p.tax_amount),
      total: goods + num(p.freight_amount) + num(p.tax_amount), paymentTerms: str(p.payment_terms),
      deliveryLocationId: str(p.delivery_location_id),
      deliveryLocation: p.delivery_location_id ? locName.get(String(p.delivery_location_id)) ?? null : null,
      expectedDelivery: str(p.expected_delivery), governance: (p.approval_governance as 'POLICY' | 'AUTHORITY' | null) ?? null,
      approvalRequest: req ? { id: String(req.id), status: String(req.status), stage: req.current_stage_no === null ? null : num(req.current_stage_no) } : null,
      approvedBy: who(p.approved_by), approvedAt: str(p.approved_at), createdById: str(p.created_by), submittedById: str(p.submitted_by),
      createdBy: who(p.created_by), issuedAt: str(p.issued_at), createdAt: String(p.created_at), closeReason: str(p.close_reason),
      lines,
      history: historyRows.filter((h) => h.purchase_order_id === p.id).map((h) => ({ id: String(h.id), transition: String(h.transition),
        to: str(h.to_status), reason: str(h.reason), actor: h.actor_source === 'system' ? 'Motor de aprovação' : who(h.actor_user_id),
        at: String(h.occurred_at) })),
    };
  });

  return {
    today, requisitions, rfqs: rfqsView, purchaseOrders, suppliers, authorities,
    locations: locRows.filter((l) => l.active).map((l) => ({ id: String(l.id), name: String(l.name), kind: String(l.kind) })),
  };
}

export type ProcurementWorkspaceModel = Awaited<ReturnType<typeof procurementWorkspace>>;

/**
 * O FORNECEDOR 360: pedidos (com saldo, atraso e recebido), participação em
 * cotações (ganhou ou não) e recebimentos recentes (com rejeição) — tudo lido
 * dos registros canônicos, na RLS de quem pergunta.
 */
export async function supplierDetail(session: Session, supplierId: string, today: string) {
  const sb = session.supabase; const org = session.organizationId;
  const [pos, quotes] = await Promise.all([
    sb.from('purchase_orders').select('id,order_number,status,expected_delivery,currency,freight_amount,tax_amount,created_at,project_id')
      .eq('organization_id', org).eq('supplier_id', supplierId).order('created_at', { ascending: false }).limit(30),
    sb.from('supplier_quotes').select('id,rfq_id,version,status,recorded_at,lead_time_days,currency,freight_amount')
      .eq('organization_id', org).eq('supplier_id', supplierId).order('recorded_at', { ascending: false }).limit(30),
  ]);
  if (pos.error || quotes.error) throw new Error('Não foi possível ler o fornecedor.');
  const poRows = (pos.data ?? []) as Row[]; const quoteRows = (quotes.data ?? []) as Row[];
  const poIds = poRows.map((p) => String(p.id)); const rfqIds = Array.from(new Set(quoteRows.map((q) => String(q.rfq_id))));
  const [lines, receipts, rfqs, decisions, quoteLines] = await Promise.all([
    poIds.length ? sb.from('purchase_order_lines').select('purchase_order_id,quantity,received_quantity,unit_price,expected_date')
      .eq('organization_id', org).in('purchase_order_id', poIds) : Promise.resolve({ data: [] }),
    poIds.length ? sb.from('goods_receipts').select('id,receipt_number,purchase_order_id,received_at,inspection_status')
      .eq('organization_id', org).in('purchase_order_id', poIds).order('received_at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    rfqIds.length ? sb.from('procurement_rfqs').select('id,rfq_number,status').eq('organization_id', org).in('id', rfqIds) : Promise.resolve({ data: [] }),
    rfqIds.length ? sb.from('sourcing_decisions').select('rfq_id,quote_id').eq('organization_id', org).in('rfq_id', rfqIds) : Promise.resolve({ data: [] }),
    quoteRows.length ? sb.from('supplier_quote_lines').select('quote_id,unit_price,quantity').eq('organization_id', org)
      .in('quote_id', quoteRows.map((q) => String(q.id))) : Promise.resolve({ data: [] }),
  ]);
  // Listas pequenas (≤ 30 pedidos e propostas pelos limites acima), mas o erro de cada leitura conta: saldo, atraso,
  // rejeição e "ganhou" do fornecedor saem delas — vazio por falha pareceria histórico limpo.
  for (const r of [lines, receipts, rfqs, decisions, quoteLines]) if ('error' in r && r.error) throw new Error('Não foi possível ler o histórico do fornecedor.');
  const lineRows = (lines.data ?? []) as Row[]; const rcRows = (receipts.data ?? []) as Row[];
  const rcIds = rcRows.map((r) => String(r.id));
  const rcLineRes = rcIds.length ? await sb.from('goods_receipt_lines').select('receipt_id,accepted_quantity,rejected_quantity,inspection_rejected_quantity')
    .eq('organization_id', org).in('receipt_id', rcIds) : { data: [], error: null };
  if (rcLineRes.error) throw new Error('Não foi possível ler os recebimentos do fornecedor.');
  const rcLines = (rcLineRes.data ?? []) as Row[];
  const projectIds = Array.from(new Set(poRows.map((p) => p.project_id).filter(Boolean) as string[]));
  const projectRes = projectIds.length ? await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', projectIds)
    : { data: [], error: null };
  if (projectRes.error) throw new Error('Não foi possível ler as obras do fornecedor.');
  const projects = projectRes.data ?? [];
  const projName = new Map((projects as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  const rfqMap = new Map(((rfqs.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  const won = new Set(((decisions.data ?? []) as Row[]).map((d) => String(d.quote_id)));
  const decided = new Set(((decisions.data ?? []) as Row[]).map((d) => String(d.rfq_id)));
  const qLines = (quoteLines.data ?? []) as Row[];
  const poNumber = new Map(poRows.map((p) => [String(p.id), String(p.order_number)]));

  return {
    orders: poRows.map((p) => {
      const mine = lineRows.filter((l) => l.purchase_order_id === p.id);
      const ordered = mine.reduce((a, l) => a + num(l.quantity), 0);
      const received = mine.reduce((a, l) => a + num(l.received_quantity), 0);
      const promise = mine.filter((l) => num(l.quantity) > num(l.received_quantity)).map((l) => str(l.expected_date)).filter(Boolean).sort()[0]
        ?? str(p.expected_delivery);
      const open = ['ISSUED', 'PARTIALLY_RECEIVED'].includes(String(p.status)) && received < ordered;
      return {
        id: String(p.id), number: String(p.order_number), status: String(p.status), currency: String(p.currency),
        total: mine.reduce((a, l) => a + num(l.quantity) * num(l.unit_price), 0) + num(p.freight_amount) + num(p.tax_amount),
        ordered, received, promise, late: Boolean(open && promise && promise < today), createdAt: String(p.created_at),
        project: p.project_id ? projName.get(String(p.project_id)) ?? String(p.project_id) : 'Vários projetos',
      };
    }),
    quotes: quoteRows.map((q) => {
      const r = rfqMap.get(String(q.rfq_id));
      const goods = qLines.filter((l) => l.quote_id === q.id).reduce((a, l) => a + num(l.unit_price) * num(l.quantity), 0);
      return {
        id: String(q.id), rfqId: String(q.rfq_id), rfqNumber: String(r?.rfq_number ?? '—'), version: num(q.version), status: String(q.status),
        recordedAt: String(q.recorded_at), leadTimeDays: q.lead_time_days === null ? null : num(q.lead_time_days), currency: String(q.currency),
        value: goods + num(q.freight_amount),
        outcome: won.has(String(q.id)) ? 'won' as const : decided.has(String(q.rfq_id)) ? 'lost' as const : r?.status === 'OPEN' ? 'open' as const : 'closed' as const,
      };
    }),
    receipts: rcRows.map((r) => {
      const mine = rcLines.filter((l) => l.receipt_id === r.id);
      return {
        id: String(r.id), number: String(r.receipt_number), orderNumber: poNumber.get(String(r.purchase_order_id)) ?? '—',
        receivedAt: String(r.received_at), inspectionStatus: String(r.inspection_status),
        accepted: mine.reduce((a, l) => a + num(l.accepted_quantity), 0),
        rejected: mine.reduce((a, l) => a + num(l.rejected_quantity) + num(l.inspection_rejected_quantity), 0),
      };
    }),
  };
}

export type SupplierDetailModel = Awaited<ReturnType<typeof supplierDetail>>;
