/**
 * READ MODEL de Compras e Fornecedores — lido pelo cliente autenticado (RLS).
 * Totais de pedido e comparação de propostas são derivados das linhas; nada
 * é somado e guardado.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/procurement-read.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '@/lib/operations/project-identity';
import {
  evaluateQuotes, recommendQuote, type ComparableQuote, type PurchaseOrderStatus, type RequisitionStatus, type RfqStatus,
  type SupplierStatus,
} from './procurement';
import { onTimeRate } from './receiving';

type Session = { supabase: SupabaseClient; organizationId: string };
type Row = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface SupplierView {
  id: string; partyId: string; name: string; legalName: string; document: string | null; status: SupplierStatus;
  statusReason: string | null; categories: string[]; defaultPaymentTerms: string | null; defaultLeadTimeDays: number | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  orders: number; openOrders: number; onTimeRate: number | null;
  /** Linhas com data prometida já medidas — o tamanho da amostra da pontualidade. */
  deliveryLines: number;
}

export async function listSuppliers(session: Session): Promise<SupplierView[]> {
  const sb = session.supabase; const org = session.organizationId;
  const { data, error } = await sb.from('supplier_profiles')
    .select('id,party_id,status,status_reason,categories,default_payment_terms,default_lead_time_days,contact_name,contact_email,contact_phone')
    .eq('organization_id', org).limit(2000);
  if (error) throw new Error('Não foi possível ler os fornecedores.');
  const rows = (data ?? []) as Row[];
  const partyIds = rows.map((r) => String(r.party_id));
  const [parties, orders, performance] = await Promise.all([
    partyIds.length ? sb.from('parties').select('id,legal_name,trade_name,document_number').eq('organization_id', org).in('id', partyIds)
      : Promise.resolve({ data: [] }),
    sb.from('purchase_orders').select('supplier_id,status').eq('organization_id', org).limit(5000),
    sb.from('supplier_delivery_performance').select('supplier_id,promised_lines,on_time_lines').eq('organization_id', org),
  ]);
  const perf = new Map(((performance.data ?? []) as Row[]).map((p) => [String(p.supplier_id),
    { promised_lines: num(p.promised_lines), on_time_lines: num(p.on_time_lines) }]));
  const pm = new Map(((parties.data ?? []) as Row[]).map((p) => [String(p.id), p]));
  const ords = (orders.data ?? []) as Row[];
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
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAuthorities(session: Session) {
  const sb = session.supabase; const org = session.organizationId;
  const { data } = await sb.from('procurement_approval_authorities')
    .select('id,project_id,category,grantee_kind,grantee_role_id,grantee_user_id,max_amount,currency,source_kind,source_reference,justification,effective_from,effective_until,active,declared_by,created_at,revocation_reason')
    .eq('organization_id', org).order('created_at', { ascending: false }).limit(500);
  const rows = (data ?? []) as Row[];
  const roleIds = Array.from(new Set(rows.map((r) => r.grantee_role_id).filter(Boolean))) as string[];
  const [roles, people] = await Promise.all([
    roleIds.length ? sb.from('roles').select('id,key,name').in('id', roleIds) : Promise.resolve({ data: [] }),
    resolveOwnerNames(org, rows.flatMap((r) => [r.grantee_user_id as string | null, r.declared_by as string | null])),
  ]);
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
    reqIds.length ? sb.from('purchase_requisition_lines').select('id,requisition_id,item_id,quantity,required_by,estimated_unit_price,note')
      .eq('organization_id', org).in('requisition_id', reqIds) : Promise.resolve({ data: [] }),
    rfqIds.length ? sb.from('procurement_rfq_lines').select('id,rfq_id,requisition_line_id,item_id,quantity,required_by')
      .eq('organization_id', org).in('rfq_id', rfqIds) : Promise.resolve({ data: [] }),
    rfqIds.length ? sb.from('procurement_rfq_suppliers').select('rfq_id,supplier_id').eq('organization_id', org).in('rfq_id', rfqIds)
      : Promise.resolve({ data: [] }),
    rfqIds.length ? sb.from('supplier_quotes').select('id,rfq_id,supplier_id,version,status,currency,freight_amount,tax_amount,payment_terms,validity_date,lead_time_days,deviations,recorded_at')
      .eq('organization_id', org).in('rfq_id', rfqIds) : Promise.resolve({ data: [] }),
    rfqIds.length ? sb.from('sourcing_decisions').select('id,rfq_id,quote_id,recommended_quote_id,follows_recommendation,rationale,decided_by,decided_at')
      .eq('organization_id', org).in('rfq_id', rfqIds) : Promise.resolve({ data: [] }),
    poIds.length ? sb.from('purchase_order_lines').select('id,purchase_order_id,item_id,quantity,unit_price,expected_date,received_quantity')
      .eq('organization_id', org).in('purchase_order_id', poIds) : Promise.resolve({ data: [] }),
    poIds.length ? sb.from('purchase_order_history').select('id,purchase_order_id,transition,from_status,to_status,reason,actor_user_id,actor_source,occurred_at')
      .eq('organization_id', org).in('purchase_order_id', poIds).order('occurred_at', { ascending: true }) : Promise.resolve({ data: [] }),
    poIds.length ? sb.from('approval_requests').select('id,status,current_stage_no,subject_id').eq('organization_id', org)
      .eq('subject_type', 'purchase_order').in('subject_id', poIds) : Promise.resolve({ data: [] }),
  ]);
  const reqLineRows = (reqLines.data ?? []) as Row[]; const rfqLineRows = (rfqLines.data ?? []) as Row[];
  const quoteRows = (quotes.data ?? []) as Row[]; const poLineRows = (poLines.data ?? []) as Row[];
  const quoteIds = quoteRows.map((q) => String(q.id));
  const reqLineIds = reqLineRows.map((l) => String(l.id));
  const poLineIds = poLineRows.map((l) => String(l.id));
  const [quoteLines, allocations, poAllocations] = await Promise.all([
    quoteIds.length ? sb.from('supplier_quote_lines').select('quote_id,rfq_line_id,unit_price,quantity,lead_time_days,compliant,note')
      .eq('organization_id', org).in('quote_id', quoteIds) : Promise.resolve({ data: [] }),
    reqLineIds.length ? sb.from('purchase_requisition_line_requirements').select('line_id,requirement_id,quantity')
      .eq('organization_id', org).in('line_id', reqLineIds) : Promise.resolve({ data: [] }),
    poLineIds.length ? sb.from('purchase_order_line_requirements').select('line_id,requirement_id,quantity,received_quantity')
      .eq('organization_id', org).in('line_id', poLineIds) : Promise.resolve({ data: [] }),
  ]);
  const quoteLineRows = (quoteLines.data ?? []) as Row[]; const allocRows = (allocations.data ?? []) as Row[];
  const poAllocRows = (poAllocations.data ?? []) as Row[];

  const itemIds = new Set<string>([...reqLineRows, ...rfqLineRows, ...poLineRows].map((l) => String(l.item_id)));
  const projectIds = new Set<string>([...reqRows, ...poRows].map((r) => r.project_id).filter(Boolean) as string[]);
  const requirementIds = Array.from(new Set([...allocRows, ...poAllocRows].map((a) => String(a.requirement_id))));
  const [items, projects, requirements, locations, people] = await Promise.all([
    itemIds.size ? sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org).in('id', Array.from(itemIds))
      : Promise.resolve({ data: [] }),
    projectIds.size ? sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', Array.from(projectIds))
      : Promise.resolve({ data: [] }),
    requirementIds.length ? sb.from('project_requirements').select('id,title,project_id,required_by').eq('organization_id', org).in('id', requirementIds)
      : Promise.resolve({ data: [] }),
    sb.from('inventory_locations').select('id,name,kind,project_id,active').eq('organization_id', org).limit(2000),
    resolveOwnerNames(org, [...reqRows.map((r) => r.requested_by), ...poRows.flatMap((p) => [p.created_by, p.approved_by, p.submitted_by]),
      ...((history.data ?? []) as Row[]).map((h) => h.actor_user_id), ...((decisions.data ?? []) as Row[]).map((d) => d.decided_by)] as Array<string | null>),
  ]);
  const itemMap = new Map(((items.data ?? []) as Row[]).map((i) => [String(i.id), i]));
  const reqTitle = new Map(((requirements.data ?? []) as Row[]).map((r) => [String(r.id), String(r.title)]));
  const reqRow = new Map(((requirements.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  // Projetos citados só pelos requisitos (pedido de vários projetos) também ganham nome.
  const missingProjects = Array.from(new Set(((requirements.data ?? []) as Row[]).map((r) => String(r.project_id)))).filter((id) => !projectIds.has(id));
  const extraProjects = missingProjects.length ? (await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', missingProjects)).data ?? [] : [];
  const projMap = new Map(([...(projects.data ?? []), ...extraProjects] as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  const locRows = (locations.data ?? []) as Row[];
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
    lines: reqLineRows.filter((l) => l.requisition_id === r.id).map((l) => ({
      id: String(l.id), ...item(l.item_id), quantity: num(l.quantity), requiredBy: str(l.required_by),
      inRfq: rfqLineRows.some((x) => x.requisition_line_id === l.id && rfqRows.find((q) => q.id === x.rfq_id)?.status !== 'CANCELLED'),
      requirements: allocRows.filter((a) => a.line_id === l.id).map((a) => ({ requirementId: String(a.requirement_id),
        title: reqTitle.get(String(a.requirement_id)) ?? 'Requisito', quantity: num(a.quantity) })),
    })),
  }));

  const decisionRows = (decisions.data ?? []) as Row[];
  const rfqsView = rfqRows.map((q) => {
    const lines = rfqLineRows.filter((l) => l.rfq_id === q.id).map((l) => ({ id: String(l.id), ...item(l.item_id),
      quantity: num(l.quantity), requiredBy: str(l.required_by), requisitionLineId: str(l.requisition_line_id) }));
    const comparable: ComparableQuote[] = quoteRows.filter((x) => x.rfq_id === q.id).map((x) => {
      const s = supMap.get(String(x.supplier_id));
      return { id: String(x.id), supplierId: String(x.supplier_id), supplier: s?.name ?? 'Fornecedor', supplierStatus: s?.status ?? 'PROSPECT',
        version: num(x.version), status: x.status as ComparableQuote['status'], currency: String(x.currency),
        freight: num(x.freight_amount), tax: num(x.tax_amount), leadTimeDays: x.lead_time_days === null ? null : num(x.lead_time_days),
        validityDate: str(x.validity_date), deviations: str(x.deviations), paymentTerms: str(x.payment_terms),
        lines: quoteLineRows.filter((l) => l.quote_id === x.id).map((l) => ({ rfqLineId: String(l.rfq_line_id), unitPrice: num(l.unit_price),
          quantity: num(l.quantity), leadTimeDays: l.lead_time_days === null ? null : num(l.lead_time_days), compliant: Boolean(l.compliant) })) };
    });
    const evaluations = evaluateQuotes(lines, comparable, today,
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
