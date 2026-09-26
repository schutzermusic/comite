/**
 * INTELIGÊNCIA DE SUPPLY — o motor de sinais da Apex, em código puro (236).
 *
 * Determinístico e explicável: cada sinal diz O QUE está em risco, POR QUÊ
 * (evidência com a origem de cada número) e QUAL ato governado resolve.
 * Nenhum número é inventado: prazo de transferência vem do histórico entre
 * os locais — sem histórico, a estimativa padrão é declarada como tal; custo
 * de frete não cadastrado não é chutado; pontualidade vem dos recebimentos.
 *
 * O motor não escreve nada. A leitura é sincronizada no livro
 * `supply_signals` (abre, atualiza, resolve sozinha o que deixou de ser
 * verdade) e o que uma pessoa aceita vira o MESMO ato governado de sempre.
 */
import type { CoverageSummary } from './coverage';

export const ENGINE_VERSION = 'supply-signals.v1';
export const DEFAULT_TRANSIT_DAYS = 2;

export type SignalKind = 'SHORTAGE' | 'ALTERNATE_STOCK' | 'ETA_RISK' | 'LATE_INBOUND' | 'SUPPLIER_RELIABILITY'
  | 'DECISION_PENDING' | 'INSPECTION_AGING';
export type SignalSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ActionKind = 'RESERVE' | 'TRANSFER' | 'REQUISITION' | 'FOLLOW_UP' | 'OPEN';

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  SHORTAGE: 'Falta sem cobertura', ALTERNATE_STOCK: 'Estoque disponível', ETA_RISK: 'Chega depois da necessidade',
  LATE_INBOUND: 'Entrega atrasada', SUPPLIER_RELIABILITY: 'Fornecedor pouco pontual', DECISION_PENDING: 'Decisão de compra parada',
  INSPECTION_AGING: 'Inspeção esperando',
};
export const SIGNAL_SEVERITY_LABEL: Record<SignalSeverity, string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' };
const RANK: Record<SignalSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
/** Na mesma gravidade, primeiro o que custa menos ao projeto: usar o estoque antes de comprar. */
const KIND_ORDER: Record<SignalKind, number> = {
  ALTERNATE_STOCK: 0, SHORTAGE: 1, ETA_RISK: 2, LATE_INBOUND: 3, DECISION_PENDING: 4, SUPPLIER_RELIABILITY: 5, INSPECTION_AGING: 6,
};

export interface Evidence { label: string; value: string; source?: string }
export interface RecommendedAction { kind: ActionKind; label: string; payload: Record<string, unknown> }
export interface SupplySignal {
  signal_key: string; kind: SignalKind; severity: SignalSeverity;
  project_id: string | null; requirement_id: string | null; purchase_order_id: string | null; transfer_id: string | null;
  supplier_id: string | null; item_id: string | null; location_id: string | null;
  title: string; rationale: string; evidence: Evidence[]; recommended_action: RecommendedAction;
}

export interface RequirementFacts {
  id: string; projectId: string; project: string; itemId: string; itemCode: string; itemDescription: string; unit: string;
  title: string; requiredBy: string | null; activityStart: string | null; activity: string | null; coverage: CoverageSummary;
}
export interface StockFacts { itemId: string; locationId: string; locationName: string; locationKind: string; available: number }
export interface InboundFacts {
  requirementId: string; kind: 'PO' | 'TRANSFER'; refId: string; refNumber: string; supplierId: string | null;
  supplier: string | null; quantity: number; eta: string | null;
}
export interface OrderFacts {
  id: string; number: string; supplierId: string; supplier: string; status: string; eta: string | null; open: number;
  needDate: string | null; projectId: string | null; submittedAt: string | null; lateDays: number;
}
export interface RequisitionFacts {
  id: string; number: string; status: string; requestedAt: string; requirementIds: string[]; needDate: string | null;
  projectId: string | null; inRfq: boolean;
}
export interface InspectionFacts { receiptId: string; number: string; receivedAt: string; orderNumber: string; purchaseOrderId: string; location: string }
export interface TransitSample { fromId: string; toId: string; days: number }
/**
 * Linha de transferência PEDIDA/APROVADA sem reserva na origem (a regra 246 do
 * `pending_transfer_qty`): nada saiu da origem e o banco não segura o saldo —
 * mas ele está prometido. A Apex não o oferece de novo, nem o compra.
 */
export interface PendingTransferFacts {
  transferId: string; number: string; status: string; requirementId: string | null; itemId: string; fromLocationId: string; quantity: number;
}

export interface IntelligenceFacts {
  today: string;
  requirements: RequirementFacts[];
  stock: StockFacts[];
  /**
   * Transferências pedidas/aprovadas ainda não despachadas (sem as que movem reserva) da organização INTEIRA — de
   * requisito da cobertura, de outro requisito ou de nenhum (`requirementId` null): TODAS prometem a origem; o texto
   * de cada requisito usa só as dele. Ausente = nenhuma lida.
   */
  pendingTransfers?: PendingTransferFacts[];
  projectSites: Record<string, Array<{ id: string; name: string }>>;
  inbound: InboundFacts[];
  orders: OrderFacts[];
  requisitions: RequisitionFacts[];
  supplierPerformance: Record<string, { promised: number; onTime: number }>;
  transit: TransitSample[];
  inspections: InspectionFacts[];
}

const day = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** A necessidade efetiva: a data do requisito ou o início da atividade, o que vier primeiro. */
export function needDate(r: Pick<RequirementFacts, 'requiredBy' | 'activityStart'>): string | null {
  const dates = [r.requiredBy, r.activityStart].filter(Boolean) as string[];
  return dates.length ? dates.sort()[0] : null;
}

export function severityForNeed(daysToNeed: number | null): SignalSeverity {
  if (daysToNeed === null) return 'medium';
  if (daysToNeed <= 7) return 'critical';
  if (daysToNeed <= 14) return 'high';
  if (daysToNeed <= 30) return 'medium';
  return 'low';
}

/**
 * SIMULAÇÃO DE TRANSFERÊNCIA — prazo pelo histórico real do par de locais;
 * sem ele, pelo histórico de qualquer origem para o destino; sem nenhum, a
 * estimativa padrão declarada. Diz se chega antes da necessidade.
 */
export function simulateTransfer(input: { fromId: string; toId: string; today: string; need: string | null; transit: TransitSample[] }) {
  const pair = input.transit.filter((t) => t.fromId === input.fromId && t.toId === input.toId);
  const toAny = input.transit.filter((t) => t.toId === input.toId);
  const sample = pair.length ? pair : toAny;
  const days = sample.length ? Math.max(1, Math.ceil(sample.reduce((a, t) => a + t.days, 0) / sample.length)) : DEFAULT_TRANSIT_DAYS;
  const basis = pair.length ? `média de ${pair.length} transferência(s) entre estes locais`
    : toAny.length ? `média de ${toAny.length} transferência(s) para este destino`
      : `estimativa padrão de ${DEFAULT_TRANSIT_DAYS} dia(s) — sem histórico para este destino`;
  const eta = addDays(input.today, days);
  return { days, basis, eta, beforeNeed: input.need ? eta <= input.need : null, samples: sample.length };
}

function base(kind: SignalKind, key: string, severity: SignalSeverity, extra: Partial<SupplySignal>): SupplySignal {
  return { signal_key: key, kind, severity, project_id: null, requirement_id: null, purchase_order_id: null, transfer_id: null,
    supplier_id: null, item_id: null, location_id: null, title: '', rationale: '', evidence: [],
    recommended_action: { kind: 'OPEN', label: 'Abrir', payload: {} }, ...extra };
}

/** Todos os sinais da leitura, do mais grave ao menos grave. */
export function computeSignals(f: IntelligenceFacts): SupplySignal[] {
  const out: SupplySignal[] = [];
  const pendingLines = (f.pendingTransfers ?? []).filter((p) => p.quantity > 0);
  // O saldo que transferências já pedidas vão tirar da origem — de qualquer requisito ou de nenhum: prometido, não
  // oferecido de novo (a mesma conta de `promisedByOrigin`, a do Planejamento).
  const promised = new Map<string, number>();
  for (const p of pendingLines) promised.set(`${p.itemId}:${p.fromLocationId}`, (promised.get(`${p.itemId}:${p.fromLocationId}`) ?? 0) + p.quantity);
  const promisedAt = (s: StockFacts) => promised.get(`${s.itemId}:${s.locationId}`) ?? 0;
  /** Livre de fato: em mão − reservado − o prometido a transferências pedidas. */
  const freeOf = (s: StockFacts) => Math.max(0, s.available - promisedAt(s));
  const stockLeft = new Map(f.stock.map((s) => [`${s.itemId}:${s.locationId}`, freeOf(s)]));
  const usedFor = (s: StockFacts) => stockLeft.get(`${s.itemId}:${s.locationId}`) ?? 0;
  const freeSource = (s: StockFacts, base: string) => (promisedAt(s) > 0 ? `${base.replace(/\)$/, '')} − já pedido em transferência)` : base);
  // As de CADA requisito (a sem requisito só promete a origem): os números TR-… do texto dele.
  const pendingOf = new Map<string, PendingTransferFacts[]>();
  for (const p of pendingLines) if (p.requirementId) pendingOf.set(p.requirementId, [...(pendingOf.get(p.requirementId) ?? []), p]);
  const lateOrders = new Set<string>();

  for (const r of f.requirements) {
    const need = needDate(r);
    const toNeed = need ? diffDays(need, f.today) : null;
    const sev = severityForNeed(toNeed);
    const needText = need ? `${day(need)}${toNeed !== null ? (toNeed < 0 ? ` (vencida há ${-toNeed} dia(s))` : ` (em ${toNeed} dia(s))`) : ''}` : 'sem data';
    const activityText = r.activityStart && r.activityStart === need && r.activity ? ` — início de “${r.activity}”` : '';
    const common = { project_id: r.projectId, requirement_id: r.id, item_id: r.itemId };
    const cov = r.coverage;
    const coverageEvidence: Evidence[] = [
      { label: 'Requerido', value: `${fmt(cov.required)} ${r.unit}`, source: `Requisito “${r.title}”` },
      { label: 'Coberto', value: `${fmt(cov.covered)} ${r.unit}`, source: 'reservas e consumo' },
      { label: 'Entrando', value: `${fmt(cov.inbound)} ${r.unit}`, source: 'trânsito, pedidos e inspeção' },
      { label: 'Falta', value: `${fmt(cov.shortage)} ${r.unit}`, source: 'cobertura derivada' },
    ];
    // 246: transferência PEDIDA não é cobertura (a falta acima continua), mas já está prometida — dita, com o número.
    const pendingHere = pendingOf.get(r.id) ?? [];
    const pendingNums = Array.from(new Set(pendingHere.map((p) => p.number))).join(', ');
    if (cov.pendingTransfer > 0) {
      coverageEvidence.push({ label: 'Transferência pedida', value: `${fmt(cov.pendingTransfer)} ${r.unit}`,
        source: `${pendingNums || 'pedida/aprovada'} — sem despacho, ainda não cobre` });
    }
    const pendingText = cov.pendingTransfer > 0
      ? ` ${fmt(cov.pendingTransfer)} ${r.unit} já pedidos em transferência${pendingNums ? ` (${pendingNums})` : ''} ainda não saíram da origem: não entram nesta conta — se a transferência for cancelada, voltam para a falta.`
      : '';

    // ── Falta: primeiro o estoque que a empresa já tem, depois a compra ──
    // 246: o comprável do banco (falta − requisitado − pendente). O estoque só cabe nele: o banco não
    // reserva nem transfere por cima de solicitação aberta nem do que a transferência pedida vai trazer.
    let remaining = cov.purchasable;
    if (cov.shortage > 0 && remaining > 0) {
      const sites = f.projectSites[r.projectId] ?? [];
      const candidates = f.stock.filter((s) => s.itemId === r.itemId && usedFor(s) > 0 && s.locationKind !== 'QUARANTINE')
        .map((s) => ({ s, isDest: sites.length === 0 || sites.some((x) => x.id === s.locationId) }))
        .sort((a, b) => Number(b.isDest) - Number(a.isDest) || usedFor(b.s) - usedFor(a.s));
      const best = candidates[0];
      if (best) {
        const q = Math.min(remaining, usedFor(best.s));
        const free = freeOf(best.s);
        stockLeft.set(`${best.s.itemId}:${best.s.locationId}`, usedFor(best.s) - q);
        remaining -= q;
        if (best.isDest) {
          out.push(base('ALTERNATE_STOCK', `alt:${r.id}:${best.s.locationId}:${need ?? 'none'}`, sev, {
            ...common, location_id: best.s.locationId,
            title: `Reservar ${fmt(q)} ${r.unit} de ${r.itemCode} para ${r.project}`,
            rationale: `Faltam ${fmt(cov.shortage)} ${r.unit} para a necessidade de ${needText}${activityText}.${pendingText} ${best.s.locationName} tem ${fmt(free)} livre(s): reservar agora evita comprar o que a empresa já tem.`,
            evidence: [...coverageEvidence, { label: 'Livre no local', value: `${fmt(free)} ${r.unit}`, source: freeSource(best.s, `${best.s.locationName} (em mão − reservado)`) }],
            recommended_action: { kind: 'RESERVE', label: `Reservar ${fmt(q)} ${r.unit}`, payload: { requirement_id: r.id, location_id: best.s.locationId, quantity: q } },
          }));
        } else {
          const site = sites[0];
          const sim = simulateTransfer({ fromId: best.s.locationId, toId: site.id, today: f.today, need, transit: f.transit });
          out.push(base('ALTERNATE_STOCK', `alt:${r.id}:${best.s.locationId}:${need ?? 'none'}`, sim.beforeNeed === false ? 'critical' : sev, {
            ...common, location_id: best.s.locationId,
            title: `Transferir ${fmt(q)} ${r.unit} de ${r.itemCode} de ${best.s.locationName} para ${site.name}`,
            rationale: `Faltam ${fmt(cov.shortage)} ${r.unit} para ${r.project}, necessário em ${needText}${activityText}.${pendingText} ${best.s.locationName} tem ${fmt(free)} livre(s). A transferência chega em ~${sim.days} dia(s) (${sim.basis})${sim.beforeNeed === false ? ' — DEPOIS da necessidade: considere também antecipar' : sim.beforeNeed ? ', antes da necessidade' : ''}. Custo de frete não cadastrado: não estimado.`,
            evidence: [...coverageEvidence,
              { label: 'Livre na origem', value: `${fmt(free)} ${r.unit}`, source: freeSource(best.s, `${best.s.locationName} (em mão − reservado)`) },
              { label: 'Chegada estimada', value: day(sim.eta), source: sim.basis }],
            recommended_action: { kind: 'TRANSFER', label: `Pedir transferência de ${fmt(q)} ${r.unit}`, payload: {
              requirement_id: r.id, item_id: r.itemId, from_location_id: best.s.locationId, to_location_id: site.id, quantity: q,
              expected_arrival: sim.eta } },
          }));
        }
      }
      if (remaining > 0) {
        // A solicitação da falta pede o COMPRÁVEL do momento (o banco ignora a quantidade do sinal):
        // a carga é esse número; o título diz o que sobra se o estoque recomendado for usado antes.
        const stockFirst = remaining < cov.purchasable;
        const buyEvidence = cov.purchasable !== cov.shortage
          ? [...coverageEvidence, { label: 'Comprável', value: `${fmt(cov.purchasable)} ${r.unit}`, source: 'falta − requisitado − transferência pedida' }]
          : coverageEvidence;
        out.push(base('SHORTAGE', `shortage:${r.id}:${need ?? 'none'}`, sev, {
          ...common,
          title: `Comprar ${fmt(remaining)} ${r.unit} de ${r.itemCode} para ${r.project}`,
          rationale: `Nada reservado, em trânsito, em pedido ou em inspeção cobre ${fmt(remaining)} ${r.unit} da necessidade de ${needText}${activityText}${best ? '' : ', e não há estoque livre do item'}.${pendingText} Requisitar a compra agora dá tempo à cotação.`
            + (stockFirst ? ` A solicitação pede o comprável no momento em que for aberta (hoje ${fmt(cov.purchasable)} ${r.unit}): use antes o estoque recomendado.` : ''),
          evidence: buyEvidence,
          recommended_action: { kind: 'REQUISITION', label: `Requisitar compra de ${fmt(cov.purchasable)} ${r.unit}`, payload: {
            requirement_ids: [r.id], quantity: cov.purchasable, priority: sev === 'critical' ? 'critical' : 'high',
            delivery_location_id: (f.projectSites[r.projectId] ?? [])[0]?.id ?? null } },
        }));
      }
    }

    // ── O que está entrando chega depois da necessidade? ──
    if (need) {
      for (const i of f.inbound.filter((x) => x.requirementId === r.id && x.eta && x.eta > need)) {
        const lateBy = diffDays(i.eta as string, need);
        out.push(base('ETA_RISK', `eta:${r.id}:${i.refId}:${i.eta}`, lateBy > 7 || (toNeed !== null && toNeed <= 7) ? 'critical' : 'high', {
          ...common, purchase_order_id: i.kind === 'PO' ? i.refId : null, transfer_id: i.kind === 'TRANSFER' ? i.refId : null,
          supplier_id: i.supplierId,
          title: `${r.itemCode} para ${r.project} chega ${lateBy} dia(s) depois da necessidade`,
          rationale: `A necessidade é ${needText}${activityText}; ${fmt(i.quantity)} ${r.unit} chegam em ${day(i.eta)} pelo ${i.kind === 'PO' ? 'pedido' : 'transferência'} ${i.refNumber}${i.supplier ? ` (${i.supplier})` : ''}. Antecipe a entrega ou cubra com estoque.`,
          evidence: [{ label: 'Necessidade', value: day(need), source: r.activity ? `atividade “${r.activity}”` : `requisito “${r.title}”` },
            { label: 'Chegada prevista', value: day(i.eta), source: i.refNumber },
            { label: 'Quantidade', value: `${fmt(i.quantity)} ${r.unit}`, source: i.refNumber }],
          recommended_action: { kind: 'FOLLOW_UP', label: 'Acompanhar a antecipação', payload: {
            source_kind: i.kind === 'PO' ? 'purchase_order' : 'inventory_transfer', source_id: i.refId,
            goal: `Antecipar a entrega de ${r.itemCode} (${i.refNumber}) para até ${day(need)}`, due_date: need } },
        }));
      }
    }
  }

  // ── Pedidos: atraso, pontualidade do fornecedor, aprovação parada ──
  for (const o of f.orders) {
    const toNeed = o.needDate ? diffDays(o.needDate, f.today) : null;
    if ((o.status === 'ISSUED' || o.status === 'PARTIALLY_RECEIVED') && o.open > 0 && o.lateDays > 0) {
      lateOrders.add(o.id);
      out.push(base('LATE_INBOUND', `late:${o.id}:${o.eta}`, toNeed !== null && toNeed <= 7 ? 'critical' : o.lateDays > 7 ? 'high' : 'medium', {
        project_id: o.projectId, purchase_order_id: o.id, supplier_id: o.supplierId,
        title: `Pedido ${o.number} está ${o.lateDays} dia(s) atrasado`,
        rationale: `${o.supplier} prometeu para ${day(o.eta)} e ainda faltam ${fmt(o.open)} unidade(s)${o.needDate ? `; a necessidade é ${day(o.needDate)}` : ''}. Cobre o fornecedor e registre a nova data.`,
        evidence: [{ label: 'Prometido para', value: day(o.eta), source: o.number }, { label: 'Em aberto', value: fmt(o.open), source: o.number }],
        recommended_action: { kind: 'FOLLOW_UP', label: 'Acompanhar com o fornecedor', payload: {
          source_kind: 'purchase_order', source_id: o.id, goal: `Confirmar nova data de entrega do pedido ${o.number} (${o.supplier})`,
          due_date: o.needDate ?? f.today } },
      }));
    }
    const perf = f.supplierPerformance[o.supplierId];
    if ((o.status === 'ISSUED' || o.status === 'PARTIALLY_RECEIVED') && o.open > 0 && !lateOrders.has(o.id)
        && perf && perf.promised >= 3 && perf.onTime / perf.promised < 0.8) {
      out.push(base('SUPPLIER_RELIABILITY', `supplier:${o.id}`, toNeed !== null && toNeed <= 14 ? 'high' : 'medium', {
        project_id: o.projectId, purchase_order_id: o.id, supplier_id: o.supplierId,
        title: `${o.supplier} cumpriu ${perf.onTime} de ${perf.promised} datas prometidas`,
        rationale: `O pedido ${o.number} depende de um fornecedor que atrasou ${perf.promised - perf.onTime} de ${perf.promised} entregas recebidas${o.needDate ? `, e a necessidade é ${day(o.needDate)}` : ''}. Confirme a data agora, não no dia.`,
        evidence: [{ label: 'Pontualidade', value: `${Math.round((perf.onTime / perf.promised) * 100)}%`, source: 'recebimentos contra a data prometida' }],
        recommended_action: { kind: 'FOLLOW_UP', label: 'Confirmar a data com o fornecedor', payload: {
          source_kind: 'purchase_order', source_id: o.id, goal: `Confirmar a data de entrega do pedido ${o.number}`, due_date: o.eta ?? f.today } },
      }));
    }
    if (o.status === 'APPROVAL_REQUIRED' && toNeed !== null && toNeed <= 21) {
      const waiting = o.submittedAt ? Math.max(0, diffDays(f.today, o.submittedAt.slice(0, 10))) : 0;
      out.push(base('DECISION_PENDING', `decision:po:${o.id}`, severityForNeed(toNeed), {
        project_id: o.projectId, purchase_order_id: o.id, supplier_id: o.supplierId,
        title: `Pedido ${o.number} aguarda aprovação há ${waiting} dia(s)`,
        rationale: `A necessidade é ${day(o.needDate)} e o pedido ainda não pode ser emitido. Cada dia de aprovação é um dia a menos de prazo do fornecedor.`,
        evidence: [{ label: 'Necessidade', value: day(o.needDate), source: o.number }, { label: 'Em aprovação desde', value: day(o.submittedAt?.slice(0, 10) ?? null), source: o.number }],
        recommended_action: { kind: 'OPEN', label: 'Abrir aprovações', payload: { href: '/supply/compras' } },
      }));
    }
  }

  // ── Requisições paradas perto da necessidade ──
  for (const q of f.requisitions) {
    const toNeed = q.needDate ? diffDays(q.needDate, f.today) : null;
    if (toNeed === null || toNeed > 21) continue;
    const waiting = Math.max(0, diffDays(f.today, q.requestedAt.slice(0, 10)));
    out.push(base('DECISION_PENDING', `decision:req:${q.id}`, severityForNeed(toNeed), {
      project_id: q.projectId, requirement_id: q.requirementIds.length === 1 ? q.requirementIds[0] : null,
      title: `Requisição ${q.number} ${q.inRfq ? 'em cotação' : 'sem cotação'} há ${waiting} dia(s)`,
      rationale: `A necessidade é ${day(q.needDate)} (em ${toNeed} dia(s)) e ainda não há pedido emitido. ${q.inRfq ? 'Registre as propostas e decida.' : 'Abra a cotação com os fornecedores homologados.'}`,
      evidence: [{ label: 'Necessidade', value: day(q.needDate), source: q.number }, { label: 'Requisitada em', value: day(q.requestedAt.slice(0, 10)), source: q.number }],
      recommended_action: { kind: 'OPEN', label: q.inRfq ? 'Abrir cotações' : 'Abrir solicitações', payload: { href: '/supply/compras' } },
    }));
  }

  // ── Inspeção esquecida segura material que já chegou ──
  for (const i of f.inspections) {
    const age = Math.max(0, diffDays(f.today, i.receivedAt.slice(0, 10)));
    if (age < 2) continue;
    out.push(base('INSPECTION_AGING', `inspection:${i.receiptId}`, age > 5 ? 'high' : 'medium', {
      purchase_order_id: i.purchaseOrderId,
      title: `Recebimento ${i.number} em inspeção há ${age} dia(s)`,
      rationale: `O material do pedido ${i.orderNumber} está na quarentena (${i.location}): não cobre a demanda até a decisão. Inspecione e libere ou rejeite.`,
      evidence: [{ label: 'Recebido em', value: day(i.receivedAt.slice(0, 10)), source: i.number }],
      recommended_action: { kind: 'OPEN', label: 'Abrir inspeção', payload: { href: '/supply/recebimentos', receipt_id: i.receiptId } },
    }));
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
}
