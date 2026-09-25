/**
 * DECISÕES — o pedido de compra por dentro (server-only).
 *
 * O detalhe de uma decisão de compra lê o que Compras já lê — pedido, linhas,
 * requisitos, a decisão de fornecimento e as propostas — e AVALIA as propostas
 * com a MESMA função de Compras (`evaluateQuotes`), no dia de hoje: a chegada
 * depende do dia em que se aprova, não do dia em que se cotou. A cadeia
 * fornecedor → faturamento é feita só de vínculos gravados; elo que não existe
 * volta marcado como ausente, nunca inventado.
 *
 * Leitura pelo service role, sempre com `organization_id` da sessão e só para
 * o pedido que `decision_access_for_viewer` já liberou (quem chama garante).
 */
if (typeof window !== 'undefined') {
  throw new Error('decisions/detail-procurement.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';
import { href } from '@/components/ax/entity';
import { date as fmtDate, dateTime, money } from '@/components/ax/format';
import {
  evaluateQuotes, PO_STATUS_LABEL, SUPPLIER_STATUS_LABEL, type ComparableQuote, type ComparableRfqLine,
  type PurchaseOrderStatus, type QuoteEvaluation, type SupplierStatus,
} from '@/lib/supply/procurement';
import { onTimeRate } from '@/lib/supply/receiving';
import { MEASUREMENT_STATUS_LABEL } from '@/lib/projects/measurements/types';
import { RELEASE_LABEL } from '@/lib/contracts/billing/contract-to-cash-display';
import { nameBook } from './names';
import { procurementImpact, sourceLink } from './model';
import type {
  ChainNode, DecisionLine, Fact, ImpactFact, PersonRef, QuoteComparison, QuoteOption, TimelineEntry,
} from './types';

type Row = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const uniq = (ids: Array<string | null | undefined>) => Array.from(new Set(ids.filter((x): x is string => !!x)));

const FMT = {
  money: (v: number | null, c?: string | null) => money(v, c || 'BRL'),
  date: (v: string | null) => fmtDate(v),
};

/** Elo sem registro: dito, nunca preenchido. */
const MISSING = 'sem vínculo registrado';
const missing = (label: string): ChainNode => ({ label, detail: MISSING, missing: true });

/** Requisito que ainda vale (a mesma exclusão de decision_po_timing). */
const liveRequirement = (status: unknown) => !['CANCELLED', 'SUPERSEDED'].includes(String(status ?? ''));

// ---------------------------------------------------------------------------
// Regras puras (testadas em tests/unit/decisions-read.test.ts)
// ---------------------------------------------------------------------------

/** Prazo da proposta como Compras o usa: o maior entre cabeçalho e linhas; sem nenhum, desconhecido. */
export function quoteLeadDays(q: Pick<ComparableQuote, 'leadTimeDays' | 'lines'>): number | null {
  const hasLead = q.leadTimeDays !== null || q.lines.some((l) => l.leadTimeDays !== null);
  return hasLead ? Math.max(q.leadTimeDays ?? 0, ...q.lines.map((l) => l.leadTimeDays ?? 0)) : null;
}

/**
 * A frase da proposta contra a necessidade. "Sem prazo" e "sem necessidade"
 * são coisas diferentes e não viram a mesma frase: uma é o fornecedor que não
 * informou, a outra é o projeto que não registrou data.
 */
export function quoteVerdict(eta: string | null, lateDays: number | null): string {
  if (eta === null) return 'Sem prazo informado';
  if (lateDays === null) return 'Sem data de necessidade para comparar';
  if (lateDays === 0) return 'Atende o cronograma';
  return `Chega ${lateDays} ${lateDays === 1 ? 'dia' : 'dias'} após a necessidade`;
}

/**
 * As opções da comparação a partir da avaliação de Compras. "Menor custo" é
 * o menor custo total posto NA MOEDA da escolhida — comparar reais com dólares
 * sem conversão seria inventar. Escolhida primeiro; o resto por custo.
 */
export function quoteOptions(evals: QuoteEvaluation[], quotes: Array<Pick<ComparableQuote, 'id' | 'leadTimeDays' | 'lines'>>,
  meta: { chosenId: string | null; recommendedId: string | null }): QuoteOption[] {
  const chosen = evals.find((e) => e.quoteId === meta.chosenId) ?? null;
  const currency = chosen?.currency ?? evals[0]?.currency ?? null;
  const pool = evals.filter((e) => e.currency === currency);
  const cheapestId = pool.length ? [...pool].sort((a, b) => a.landed - b.landed)[0].quoteId : null;
  return evals.map((e): QuoteOption => {
    const q = quotes.find((x) => x.id === e.quoteId);
    return {
      quoteId: e.quoteId, supplier: e.supplier, landed: e.landed, currency: e.currency,
      leadDays: q ? quoteLeadDays(q) : null, eta: e.eta, lateDays: e.lateDays,
      chosen: e.quoteId === meta.chosenId, recommended: e.quoteId === meta.recommendedId, cheapest: e.quoteId === cheapestId,
      compliant: e.compliant, supplierOk: e.supplierOk, reliability: e.reliability, verdict: quoteVerdict(e.eta, e.lateDays),
    };
  }).sort((a, b) => Number(b.chosen) - Number(a.chosen) || a.landed - b.landed);
}

/**
 * Necessidade de um requisito: o que vier antes entre a data do requisito e o
 * início da atividade — a MESMA regra de `decision_po_timing` (240) e da
 * inteligência de Supply (236).
 */
export function requirementNeed(requiredBy: string | null, activityStart: string | null): string | null {
  const dates = [requiredBy, activityStart].filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return dates[0] ?? null;
}

const OUTCOME_WORD: Record<string, string> = {
  REJECTED: 'rejeição', RETURNED_FOR_CORRECTION: 'ajuste solicitado', CANCELLED: 'cancelamento', EXPIRED: 'expiração',
};

const TRANSITION_LABEL: Record<string, string> = {
  created: 'Pedido criado', edited: 'Rascunho editado', submitted: 'Submetido à aprovação', approved: 'Aprovado',
  rejected: 'Devolvido ao rascunho', approval_stale: 'Aprovação invalidada — o pedido mudou depois dela',
  issued: 'Emitido ao fornecedor', partially_received: 'Recebido em parte', received: 'Recebido',
  inspection_rejected: 'Reprovado na inspeção', cancelled: 'Cancelado', closed: 'Encerrado',
};

/**
 * Uma linha do histórico do pedido em português. `rejected` humano é o ato da
 * alçada declarada — o "Solicitar ajuste" de Decisões; `rejected` do sistema é
 * o desfecho do motor aplicado ao pedido.
 */
export function purchaseOrderHistoryEntry(h: {
  transition: string; reason: string | null; detail: Row | null; actor_user_id: string | null; actor_source: string; occurred_at: string;
}, person: (id: string | null) => PersonRef | null): TimelineEntry {
  const system = h.actor_source === 'system';
  let label = TRANSITION_LABEL[h.transition] ?? h.transition;
  if (h.transition === 'rejected') {
    const outcome = str(h.detail?.outcome);
    label = system
      ? `Devolvido ao rascunho pelo motor de aprovação${outcome && OUTCOME_WORD[outcome] ? ` (${OUTCOME_WORD[outcome]})` : ''}`
      : 'Ajuste solicitado — devolvido ao rascunho';
  }
  if (h.transition === 'approved' && system) label = 'Aprovado pelo motor de aprovação';
  return {
    at: h.occurred_at, label, actor: system ? null : person(h.actor_user_id),
    detail: h.reason ?? (system ? 'Aplicado pelo motor de aprovação' : null),
  };
}

export interface ChainInput {
  supplier: { id: string; name: string | null } | null;
  material: { itemId: string; code: string | null; description: string | null } | null;
  activity: { id: string; projectId: string; title: string; plannedStart: string | null } | null;
  milestone: { id: string; projectId: string; title: string; plannedFinish: string | null } | null;
  measurement: { id: string; expectedAt: string | null; status: string | null } | null;
  billing: { id: string; title: string | null; dueDate: string | null; amount: number | null; currency: string | null; releaseState: string | null } | null;
}

/**
 * A cadeia causal, na ordem Fornecedor → Material → Atividade → Marco →
 * Medição → Faturamento. Cada elo é um registro que existe; o que falta é
 * dito como falta.
 */
export function purchaseChain(c: ChainInput): ChainNode[] {
  return [
    c.supplier ? { label: 'Fornecedor', detail: c.supplier.name ?? 'Fornecedor sem nome', href: href.supplier(c.supplier.id) } : missing('Fornecedor'),
    c.material ? { label: 'Material', detail: [c.material.code, c.material.description].filter(Boolean).join(' · ') || 'Item', href: href.item(c.material.itemId) }
      : missing('Material'),
    c.activity ? { label: 'Atividade', detail: `${c.activity.title}${c.activity.plannedStart ? ` · início ${fmtDate(c.activity.plannedStart)}` : ''}`,
      href: href.projectSchedule(c.activity.projectId) } : missing('Atividade'),
    c.milestone ? { label: 'Marco', detail: `${c.milestone.title}${c.milestone.plannedFinish ? ` · ${fmtDate(c.milestone.plannedFinish)}` : ''}`,
      href: href.projectSchedule(c.milestone.projectId) } : missing('Marco'),
    c.measurement ? measurementNode(c.measurement) : missing('Medição'),
    c.billing ? billingNode(c.billing) : missing('Faturamento'),
  ];
}

export function measurementNode(m: { expectedAt: string | null; status: string | null }): ChainNode {
  const status = m.status ? MEASUREMENT_STATUS_LABEL[m.status as keyof typeof MEASUREMENT_STATUS_LABEL] ?? m.status : null;
  return { label: 'Medição', detail: [m.expectedAt ? `prevista para ${fmtDate(m.expectedAt)}` : null, status].filter(Boolean).join(' · ') || 'Medição registrada',
    href: href.measurements() };
}

export function billingNode(b: { id: string; title: string | null; dueDate: string | null; amount: number | null; currency: string | null; releaseState: string | null }): ChainNode {
  const release = b.releaseState ? RELEASE_LABEL[b.releaseState as keyof typeof RELEASE_LABEL] ?? b.releaseState : null;
  return {
    label: 'Faturamento',
    detail: [b.title, b.amount !== null ? money(b.amount, b.currency || 'BRL') : null, b.dueDate ? `vence ${fmtDate(b.dueDate)}` : null, release]
      .filter(Boolean).join(' · ') || 'Evento de faturamento',
    href: sourceLink('contract_billing_event', b.id, false).href,
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface PurchaseOrderDetail {
  facts: Fact[];
  lines: DecisionLine[];
  comparison: QuoteComparison | null;
  impact: ImpactFact[];
  chain: ChainNode[];
  history: TimelineEntry[];
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (r.error) throw new Error(`Não foi possível ler ${what}.`);
  return r.data;
}

/**
 * O pedido inteiro para quem decide. `submission` é a submissão que a chave
 * decide (s<n>): a nota e o autor mostrados são os DELA, não os da última.
 */
export async function purchaseOrderDetail(org: string, poId: string, opts: {
  today: string; submission: number | null;
  /** O evento de faturamento a jusante NÃO é o sujeito da decisão: valor só para quem a RLS de faturamento deixaria ler. */
  revealBilling?: (eventId: string) => Promise<boolean>;
}): Promise<PurchaseOrderDetail | null> {
  const sb = platformServiceClient();
  const po = must(await sb.from('purchase_orders')
    .select('id,order_number,supplier_id,sourcing_decision_id,project_id,status,currency,freight_amount,tax_amount,payment_terms,delivery_location_id,expected_delivery,approval_governance,submitted_by,submitted_at')
    .eq('organization_id', org).eq('id', poId).maybeSingle<Row>(), 'o pedido de compra');
  if (!po) return null;
  const supplierId = String(po.supplier_id);
  const currency = String(po.currency ?? 'BRL');

  const [lineR, histR, locR, decR] = await Promise.all([
    sb.from('purchase_order_lines').select('id,item_id,quantity,unit_price,expected_date')
      .eq('organization_id', org).eq('purchase_order_id', poId),
    sb.from('purchase_order_history').select('id,transition,reason,detail,actor_user_id,actor_source,occurred_at,seq')
      .eq('organization_id', org).eq('purchase_order_id', poId).order('seq', { ascending: true }),
    po.delivery_location_id
      ? sb.from('inventory_locations').select('id,name').eq('organization_id', org).eq('id', String(po.delivery_location_id)).maybeSingle<Row>()
      : Promise.resolve({ data: null, error: null }),
    po.sourcing_decision_id
      ? sb.from('sourcing_decisions').select('id,rfq_id,quote_id,recommended_quote_id,follows_recommendation,rationale,decided_by,decided_at')
        .eq('organization_id', org).eq('id', String(po.sourcing_decision_id)).maybeSingle<Row>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const lineRows = (must(lineR, 'as linhas do pedido') ?? []) as Row[];
  const histRows = (must(histR, 'o histórico do pedido') ?? []) as Row[];
  const location = locR.data as Row | null;
  const decision = must(decR as { data: Row | null; error: { message: string } | null }, 'a decisão de compra');
  const rfqId = decision ? str(decision.rfq_id) : null;

  const lineIds = lineRows.map((l) => String(l.id));
  const [itemR, allocR, rfqLineR, quoteR] = await Promise.all([
    lineRows.length ? sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org)
      .in('id', uniq(lineRows.map((l) => str(l.item_id)))) : Promise.resolve({ data: [], error: null }),
    lineIds.length ? sb.from('purchase_order_line_requirements').select('line_id,requirement_id,quantity')
      .eq('organization_id', org).in('line_id', lineIds) : Promise.resolve({ data: [], error: null }),
    rfqId ? sb.from('procurement_rfq_lines').select('id,quantity,required_by').eq('organization_id', org).eq('rfq_id', rfqId)
      : Promise.resolve({ data: [], error: null }),
    rfqId ? sb.from('supplier_quotes')
      .select('id,supplier_id,version,status,currency,freight_amount,tax_amount,payment_terms,validity_date,lead_time_days,deviations')
      .eq('organization_id', org).eq('rfq_id', rfqId) : Promise.resolve({ data: [], error: null }),
  ]);
  const itemMap = new Map(((must(itemR, 'os itens') ?? []) as Row[]).map((i) => [String(i.id), i]));
  const allocRows = (must(allocR, 'os requisitos do pedido') ?? []) as Row[];
  const rfqLineRows = (must(rfqLineR, 'as linhas da cotação') ?? []) as Row[];
  const quoteRows = (must(quoteR, 'as propostas') ?? []) as Row[];

  const reqIds = uniq(allocRows.map((a) => str(a.requirement_id)));
  const quoteIds = quoteRows.map((q) => String(q.id));
  const supplierIds = uniq([supplierId, ...quoteRows.map((q) => str(q.supplier_id))]);
  const [reqR, qLineR, supR, perfR] = await Promise.all([
    reqIds.length ? sb.from('project_requirements').select('id,title,project_id,activity_id,required_by,status,priority')
      .eq('organization_id', org).in('id', reqIds) : Promise.resolve({ data: [], error: null }),
    quoteIds.length ? sb.from('supplier_quote_lines').select('quote_id,rfq_line_id,unit_price,quantity,lead_time_days,compliant')
      .eq('organization_id', org).in('quote_id', quoteIds) : Promise.resolve({ data: [], error: null }),
    sb.from('supplier_profiles').select('id,status').eq('organization_id', org).in('id', supplierIds),
    sb.from('supplier_delivery_performance').select('supplier_id,promised_lines,on_time_lines')
      .eq('organization_id', org).in('supplier_id', supplierIds),
  ]);
  const reqRows = (must(reqR, 'os requisitos') ?? []) as Row[];
  const qLineRows = (must(qLineR, 'as linhas das propostas') ?? []) as Row[];
  const supStatus = new Map(((must(supR, 'os fornecedores') ?? []) as Row[]).map((s) => [String(s.id), String(s.status) as SupplierStatus]));
  const perf = new Map(((perfR.data ?? []) as Row[]).map((p) => [String(p.supplier_id),
    { promised_lines: num(p.promised_lines), on_time_lines: num(p.on_time_lines) }]));

  const activityIds = uniq(reqRows.map((r) => str(r.activity_id)));
  const submitted = histRows.filter((h) => h.transition === 'submitted');
  const submissionRow = (opts.submission ? submitted[opts.submission - 1] : undefined) ?? submitted[submitted.length - 1] ?? null;
  const [actR, book] = await Promise.all([
    activityIds.length ? sb.from('project_timeline_items').select('id,project_id,title,planned_start,planned_finish')
      .eq('organization_id', org).in('id', activityIds).is('deleted_at', null) : Promise.resolve({ data: [], error: null }),
    nameBook(org, {
      people: [str(po.submitted_by), str(decision?.decided_by), ...histRows.map((h) => str(h.actor_user_id))],
      projects: [str(po.project_id), ...reqRows.map((r) => str(r.project_id))],
      suppliers: supplierIds,
    }),
  ]);
  const activities = new Map(((must(actR, 'as atividades') ?? []) as Row[]).map((a) => [String(a.id), a]));
  const reqMap = new Map(reqRows.map((r) => [String(r.id), r]));
  const needOf = (r: Row) => requirementNeed(str(r.required_by), str(activities.get(String(r.activity_id))?.planned_start));

  // Linhas: a de maior valor primeiro — é a que o cartão e a cadeia citam.
  const lines: DecisionLine[] = lineRows.map((l) => {
    const it = itemMap.get(String(l.item_id));
    const reqs = allocRows.filter((a) => a.line_id === l.id).map((a) => reqMap.get(String(a.requirement_id)))
      .filter((r): r is Row => !!r && liveRequirement(r.status));
    const needs = reqs.map(needOf).filter((d): d is string => !!d).sort();
    const quantity = num(l.quantity); const unitPrice = num(l.unit_price);
    return {
      item: String(it?.code ?? '—'), description: str(it?.description), quantity, unit: str(it?.unit), unitPrice,
      subtotal: quantity * unitPrice, needBy: needs[0] ?? null,
      requirement: reqs.length ? `${String(reqs[0].title)}${reqs.length > 1 ? ` +${reqs.length - 1}` : ''}` : null,
    };
  }).sort((a, b) => b.subtotal - a.subtotal || a.item.localeCompare(b.item));
  const headLine = lineRows.find((l) => String(itemMap.get(String(l.item_id))?.code ?? '—') === lines[0]?.item) ?? null;

  // Fatos do pedido, cada um com a origem.
  const freight = num(po.freight_amount); const tax = num(po.tax_amount);
  const goods = lines.reduce((a, l) => a + l.subtotal, 0);
  const projectNames = po.project_id ? [book.project(String(po.project_id)) ?? String(po.project_id)]
    : uniq(reqRows.map((r) => str(r.project_id))).map((id) => book.project(id) ?? id);
  const status = String(po.status) as PurchaseOrderStatus;
  const facts: Fact[] = [
    { label: 'Pedido', value: `${String(po.order_number)} · ${PO_STATUS_LABEL[status] ?? status}`, source: 'purchase_orders', href: href.purchaseOrder(poId) },
  ];
  if (po.approval_governance) {
    facts.push({ label: 'Governança', value: po.approval_governance === 'POLICY' ? 'Política do motor de aprovação' : 'Alçada de compra declarada',
      source: 'purchase_orders.approval_governance' });
  }
  const supStat = supStatus.get(supplierId);
  facts.push({ label: 'Fornecedor', value: `${book.supplier(supplierId) ?? 'Fornecedor'}${supStat ? ` · ${SUPPLIER_STATUS_LABEL[supStat] ?? supStat}` : ''}`,
    source: 'supplier_profiles', href: href.supplier(supplierId) });
  facts.push({ label: 'Mercadorias', value: money(goods, currency), source: 'purchase_order_lines' });
  facts.push({ label: 'Frete', value: money(freight, currency), source: 'purchase_orders' });
  facts.push({ label: 'Impostos', value: money(tax, currency), source: 'purchase_orders' });
  facts.push({ label: 'Total', value: money(goods + freight + tax, currency), source: 'purchase_order_total' });
  if (po.payment_terms) facts.push({ label: 'Condição de pagamento', value: String(po.payment_terms), source: 'purchase_orders' });
  if (location) facts.push({ label: 'Local de entrega', value: String(location.name), source: 'inventory_locations' });
  if (po.expected_delivery) facts.push({ label: 'Entrega prevista', value: fmtDate(String(po.expected_delivery)), source: 'purchase_orders' });
  if (projectNames.length) facts.push({ label: projectNames.length > 1 ? 'Projetos' : 'Projeto', value: projectNames.join(', '), source: 'projects' });
  if (submissionRow) {
    const who = book.person(str(submissionRow.actor_user_id))?.name ?? 'Pessoa sem nome no diretório';
    facts.push({ label: 'Submetido por', value: `${who} em ${dateTime(String(submissionRow.occurred_at))}`, source: 'purchase_order_history' });
    if (submissionRow.reason) facts.push({ label: 'Nota da submissão', value: String(submissionRow.reason), source: 'purchase_order_history' });
  }

  // Comparação — a de Compras, refeita hoje.
  let comparison: QuoteComparison | null = null;
  let impact: ImpactFact[] = [];
  if (decision && rfqId) {
    const rfqLines: ComparableRfqLine[] = rfqLineRows.map((l) => ({ id: String(l.id), quantity: num(l.quantity), requiredBy: str(l.required_by) }));
    const quotes: ComparableQuote[] = quoteRows.map((x) => ({
      id: String(x.id), supplierId: String(x.supplier_id), supplier: book.supplier(String(x.supplier_id)) ?? 'Fornecedor',
      supplierStatus: supStatus.get(String(x.supplier_id)) ?? 'PROSPECT', version: num(x.version),
      status: x.status as ComparableQuote['status'], currency: String(x.currency), freight: num(x.freight_amount), tax: num(x.tax_amount),
      leadTimeDays: x.lead_time_days === null || x.lead_time_days === undefined ? null : num(x.lead_time_days),
      validityDate: str(x.validity_date), deviations: str(x.deviations), paymentTerms: str(x.payment_terms),
      lines: qLineRows.filter((l) => l.quote_id === x.id).map((l) => ({ rfqLineId: String(l.rfq_line_id), unitPrice: num(l.unit_price),
        quantity: num(l.quantity), leadTimeDays: l.lead_time_days === null || l.lead_time_days === undefined ? null : num(l.lead_time_days),
        compliant: Boolean(l.compliant) })),
    }));
    const reliability = Object.fromEntries(supplierIds.map((id) => [id, onTimeRate(perf.get(id))]));
    const evals = evaluateQuotes(rfqLines, quotes, opts.today, reliability);
    const options = quoteOptions(evals, quotes, { chosenId: str(decision.quote_id), recommendedId: str(decision.recommended_quote_id) });
    // A necessidade contra a qual `evaluateQuotes` mede o atraso — a mesma data vai para a evidência.
    const needBy = rfqLines.map((l) => l.requiredBy).filter((d): d is string => !!d).sort()[0] ?? null;
    comparison = {
      needBy, evaluatedOn: opts.today, options, rationale: str(decision.rationale),
      followsRecommendation: decision.follows_recommendation === null || decision.follows_recommendation === undefined
        ? null : Boolean(decision.follows_recommendation),
      decidedBy: book.person(str(decision.decided_by)), decidedAt: str(decision.decided_at),
    };
    impact = procurementImpact(options, needBy, FMT);
  }

  // Cadeia: o requisito vivo de necessidade mais cedo, com atividade.
  const anchor = reqRows.filter((r) => liveRequirement(r.status) && r.activity_id && activities.has(String(r.activity_id)))
    .sort((a, b) => (needOf(a) ?? '9999').localeCompare(needOf(b) ?? '9999'))[0] ?? null;
  const act = anchor ? activities.get(String(anchor.activity_id)) ?? null : null;
  const headItem = headLine ? itemMap.get(String(headLine.item_id)) : undefined;
  const chain = await chainLinks(org, opts.revealBilling ?? (async () => false), {
    supplier: { id: supplierId, name: book.supplier(supplierId) },
    material: headLine ? { itemId: String(headLine.item_id), code: str(headItem?.code), description: str(headItem?.description) } : null,
    activity: act ? { id: String(act.id), projectId: String(act.project_id), title: String(act.title), plannedStart: str(act.planned_start) } : null,
  });

  const history = histRows.map((h) => purchaseOrderHistoryEntry({
    transition: String(h.transition), reason: str(h.reason), detail: (h.detail ?? null) as Row | null,
    actor_user_id: str(h.actor_user_id), actor_source: String(h.actor_source), occurred_at: String(h.occurred_at),
  }, book.person));

  return { facts, lines, comparison, impact, chain, history };
}

/**
 * Marco → Medição → Faturamento a partir da atividade. Sem atividade não há
 * como achar o marco seguinte: os elos seguintes ficam ausentes — e ditos.
 */
async function chainLinks(org: string, revealBilling: (eventId: string) => Promise<boolean>,
  base: Pick<ChainInput, 'supplier' | 'material' | 'activity'>): Promise<ChainNode[]> {
  const sb = platformServiceClient();
  const activity = base.activity;
  let milestone: ChainInput['milestone'] = null;
  let measurement: ChainInput['measurement'] = null;
  let billing: ChainInput['billing'] = null;
  if (activity?.plannedStart) {
    const { data } = await sb.from('project_timeline_items').select('id,project_id,title,planned_finish')
      .eq('organization_id', org).eq('project_id', activity.projectId).eq('is_milestone', true).is('deleted_at', null)
      .gte('planned_finish', activity.plannedStart).order('planned_finish', { ascending: true }).limit(1);
    const m = ((data ?? []) as Row[])[0];
    if (m) milestone = { id: String(m.id), projectId: String(m.project_id), title: String(m.title), plannedFinish: str(m.planned_finish) };
  }
  if (activity) {
    const anchors = uniq([activity.id, milestone?.id]);
    const { data } = await sb.from('project_measurements').select('id,expected_at,status')
      .eq('organization_id', org).eq('project_id', activity.projectId).in('timeline_item_id', anchors)
      .order('expected_at', { ascending: true, nullsFirst: false }).limit(1);
    const m = ((data ?? []) as Row[])[0];
    if (m) measurement = { id: String(m.id), expectedAt: str(m.expected_at), status: str(m.status) };
  }
  if (measurement) {
    const { data } = await sb.from('contract_billing_events').select('id,title,due_date,amount,currency,release_state')
      .eq('organization_id', org).eq('source_measurement_id', measurement.id).order('created_at', { ascending: false }).limit(1);
    const b = ((data ?? []) as Row[])[0];
    if (b) {
      // Presença do elo é fato da cadeia; título, valor e estado só para quem lê faturamento (mesma regra da RLS).
      billing = await revealBilling(String(b.id))
        ? { id: String(b.id), title: str(b.title), dueDate: str(b.due_date), amount: b.amount === null ? null : num(b.amount),
            currency: str(b.currency), releaseState: str(b.release_state) }
        : { id: String(b.id), title: null, dueDate: null, amount: null, currency: null, releaseState: null };
    }
  }
  return purchaseChain({ ...base, milestone, measurement, billing });
}
