/**
 * Apoio das provas vivas de DECISÕES (QA isolado).
 *
 * O pedido de compra nasce pelas funções governadas de Compras, com o papel
 * Compras como ator — o mesmo caminho da tela —, com DUAS propostas: a mais
 * barata chega depois da necessidade, a escolhida atende o cronograma. É o
 * cenário em que a decisão tem algo a explicar.
 */
import { expect } from '@playwright/test';
import type pg from 'pg';
import { apiAs, APP_URL, governed, one, qaEnv, qaLive, type QaRole } from './support';

export const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const plusDays = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

export interface DecisionPo { poId: string; orderNumber: string; projectId: string; projectName: string; itemCode: string;
  quoteA: string; quoteB: string; requirementId: string }

/**
 * Pedido em RASCUNHO pronto para submeter (governança decidida na submissão).
 * `qty × price` define o valor; a proposta escolhida é a B (prazo curto).
 */
export async function decisionPurchaseOrder(db: pg.Client, t: string, opts: {
  qty?: number; priceA?: number; priceB?: number; leadA?: number; leadB?: number; needInDays?: number; projectName?: string;
} = {}): Promise<DecisionPo> {
  const { qty = 400, priceA = 427.5, priceB = 456, leadA = 12, leadB = 3, needInDays = 6 } = opts;
  const g = await governed(db); const live = qaLive(); const compras = live.users.compras.id;
  const itemCode = `DEC-CABO-${t}`;
  const item = await g.item(itemCode, 'm', 'Cabos');
  const projectId = `qa-dec-${t.toLowerCase()}`;
  const projectName = opts.projectName ?? `SE Tucuruí ${t}`;
  await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`,
    [projectId, g.org, g.J({ id: projectId, nome: projectName, cliente: 'Cliente QA', status: 'em_andamento' }), g.actor]);
  const site = await g.location(`DEC-S-${t}`, 'PROJECT_SITE', { project_id: projectId });
  const requirementId = await g.material(projectId, item, qty, plusDays(needInDays));
  const rc = await g.act<{ requisition_id: string }>('purchase_requisition_from_shortage', g.org, compras, g.J({ requirement_ids: [requirementId] }));
  const lines = (await db.query(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id])).rows;
  const rfq = await g.act<{ rfq_id: string }>('procurement_rfq_create', g.org, compras, g.J({ requisition_line_ids: lines.map((l) => l.id),
    supplier_ids: [live.suppliers.a, live.suppliers.b] }));
  const rfqLines = (await db.query(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id])).rows;
  const quote = async (supplier: string, price: number, lead: number) =>
    (await g.act<{ quote_id: string }>('procurement_quote_record', g.org, compras, g.J({ rfq_id: rfq.rfq_id, supplier_id: supplier,
      lead_time_days: lead, validity_date: '2099-01-01', lines: rfqLines.map((l) => ({ rfq_line_id: l.id, unit_price: price })) }))).quote_id;
  const quoteA = await quote(live.suppliers.a, priceA, leadA);
  const quoteB = await quote(live.suppliers.b, priceB, leadB);
  const dec = await g.act<{ purchase_order_id: string }>('procurement_decide', g.org, compras, g.J({ rfq_id: rfq.rfq_id, quote_id: quoteB,
    recommended_quote_id: quoteB, rationale: 'Fornecedor B entrega em 3 dias e atende a necessidade; o A chegaria depois da montagem.' }));
  await g.act('purchase_order_update_draft', g.org, compras, dec.purchase_order_id, g.J({ delivery_location_id: site }));
  const po = await one<{ order_number: string }>(db, `SELECT order_number FROM public.purchase_orders WHERE id = $1`, [dec.purchase_order_id]);
  return { poId: dec.purchase_order_id, orderNumber: po.order_number, projectId, projectName, itemCode, quoteA, quoteB, requirementId };
}

/** Submete pelo MESMO endpoint da tela de Compras, com a sessão real de Compras. */
export async function submitPo(poId: string, role: QaRole = 'compras') {
  const res = await (await apiAs(role)).post(`/api/supply/procurement/purchase-orders/${poId}`, { data: { action: 'submit', note: 'Submetido pela prova de Decisões' } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).result as { governance: 'POLICY' | 'AUTHORITY'; approval?: { request_id?: string } };
}

/** O relógio real da plataforma: a mesma drenagem do cron. */
export async function drain() {
  const res = await fetch(`${APP_URL}/api/platform/jobs/drain`, { method: 'POST',
    headers: { Authorization: `Bearer ${qaEnv().QA_JOBS_SECRET}`, 'x-apex-trigger': 'qa-live' } });
  expect(res.status).toBe(200);
  return (await res.json()).counters as Record<string, number>;
}

export async function countFor(role: QaRole): Promise<number> {
  const res = await (await apiAs(role)).get('/api/decisions/count');
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).count as number;
}

export async function workspaceFor(role: QaRole, tab = 'minhas') {
  const res = await (await apiAs(role)).get(`/api/decisions?tab=${tab}`);
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

/** Mailpit do QA (captura local). */
const MAILPIT = 'http://127.0.0.1:55424';
/**
 * E-mails capturados para um endereço, com assunto; `bodyContains` (ex.: o nome
 * único do projeto desta execução) separa esta execução das anteriores — a
 * captura do QA acumula entre rodadas.
 */
export async function mailsTo(address: string, subjectContains: string, bodyContains?: string) {
  const q = encodeURIComponent(`to:"${address}" subject:"${subjectContains}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${q}&limit=200`);
  if (!res.ok) return [];
  const body = await res.json() as { messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }>; Created: string }> };
  const messages = body.messages ?? [];
  if (!bodyContains) return messages;
  const out = [];
  for (const m of messages) if ((await mailBody(m.ID)).HTML.includes(bodyContains)) out.push(m);
  return out;
}
export async function mailBody(id: string): Promise<{ HTML: string; Text: string; Subject: string }> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  return res.json();
}

export const keyForAuthority = (poId: string, submission = 1) => `purchase_order:${poId}:s${submission}`;
export const decisionPath = (key: string) => `/api/decisions/${encodeURIComponent(key)}`;
