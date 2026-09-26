/**
 * ENVIO DA COTAÇÃO AO FORNECEDOR — `POST /api/supply/procurement/rfqs/[id]/send` (server-only).
 *
 * A cotação (RFQ) nasce pela função governada `procurement_rfq_create`; este
 * módulo só ENVIA o pedido de cotação, por e-mail, a quem já foi convidado —
 * e só quando uma pessoa com `procurement.source` pede (nada é enviado sozinho).
 *
 *  • só cotação ABERTA da organização ativa; só fornecedor CONVIDADO;
 *  • o e-mail diz o item, a quantidade, a unidade, a necessidade, o prazo de
 *    resposta e como responder — NUNCA preço interno, estimativa, nem os
 *    outros fornecedores;
 *  • o transporte é o compartilhado (`sendAppEmail`): chave de idempotência
 *    `rfq:<rfqId>:supplier:<supplierId>` e o envio fica em `email_dispatches`
 *    com `related_entity = procurement_rfq_supplier:<id do convite>` — é dali
 *    que o Dashboard lê "enviada em" (`readRfqDispatches`);
 *  • desfecho por fornecedor: SENT (o provedor aceitou) · SIMULATED (coletor
 *    local de QA ou transporte desligado — nada chegou ao fornecedor) ·
 *    NO_CONTACT (sem e-mail cadastrado) · ALREADY_SENT (já há envio REAL
 *    registrado) · FAILED (não enviado: recusa de regra — fornecedor
 *    suspenso/bloqueado, prospecto achado na internet ainda não verificado,
 *    proposta já registrada — ou falha do transporte);
 *  • nunca e-mail a quem já mandou proposta nesta cotação, nem a prospecto
 *    cadastrado pela busca da Apex na internet (o contato veio de uma página,
 *    não de uma pessoa): primeiro alguém verifica e homologa em Compras;
 *  • auditoria `supply.rfq.sent` com o desfecho de CADA convite (fornecedor,
 *    convite, desfecho) — o ator é o da sessão; sem endereço nem conteúdo.
 *
 * Leitura pelo service role DEPOIS do portão da rota — `procurement.source`
 * (o ato) E a leitura de cotações (procurement.view OU supply.view, a RLS de
 * `procurement_rfqs`): quem envia vê o que a tela de Compras já mostraria.
 * Nome do fornecedor só com a leitura de partes (`names`); sem ela, "Restrito".
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/rfq-send.ts não pode ser importado no navegador');
}

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { platformServiceClient } from '@/lib/platform/server-client';
import {
  EmailPermanentError, sendAppEmail, type AppEmailMessage, type AppEmailResult,
} from '@/lib/notifications/email';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { selectIn } from '@/lib/supabase/select-in';

type Row = Record<string, unknown>;

export const RFQ_DISPATCH_TYPE = 'procurement_rfq_supplier';

export type RfqSendOutcome = 'SENT' | 'SIMULATED' | 'NO_CONTACT' | 'ALREADY_SENT' | 'FAILED';
export interface RfqSendResult { supplierId: string; name: string; outcome: RfqSendOutcome; message: string }
export type RfqSendResponse = { ok: true; results: RfqSendResult[] } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRfqId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Corpo da rota: sem `supplierIds` = todos os convidados ainda sem envio. */
export const rfqSendSchema = z.object({
  supplierIds: z.array(z.string().uuid('Fornecedor inválido.')).min(1, 'Informe ao menos um fornecedor.').max(30).optional(),
});

/** Estável por fornecedor da cotação: uma repetição nunca vira segundo e-mail no provedor. */
export function rfqIdempotencyKey(rfqId: string, supplierId: string): string {
  return `rfq:${rfqId}:supplier:${supplierId}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   O e-mail (puro)
   ══════════════════════════════════════════════════════════════════════════ */

export interface RfqEmailInput {
  organization: string;
  rfqNumber: string;
  supplierName: string;
  contactName: string | null;
  responseDue: string | null;
  lines: Array<{ code: string | null; description: string; quantity: number; unit: string | null; requiredBy: string | null }>;
  buyer: { name: string | null; email: string | null };
}

const dmy = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
const qtyText = (n: number, unit: string | null) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * O pedido de cotação em português. Só o que o fornecedor precisa para
 * cotar: nada de preço interno, estimativa, orçamento ou concorrentes.
 */
export function rfqEmail(input: RfqEmailInput): Omit<AppEmailMessage, 'to'> {
  const greeting = `Olá, ${input.contactName?.trim() || input.supplierName}.`;
  const due = dmy(input.responseDue);
  const itemLine = (l: RfqEmailInput['lines'][number]) => {
    const need = dmy(l.requiredBy);
    return `${l.code ? `${l.code} — ` : ''}${l.description}: ${qtyText(l.quantity, l.unit)}${need ? ` · necessário até ${need}` : ''}`;
  };
  const replyTo = input.buyer.email
    ? `Responda a ${input.buyer.name?.trim() || 'quem enviou este pedido'} (${input.buyer.email}) citando o número ${input.rfqNumber}.`
    : `Responda ao contato de compras de ${input.organization} citando o número ${input.rfqNumber}.`;
  const ask = 'Na resposta, informe para cada item: preço unitário, frete, impostos, prazo de entrega em dias, condição de pagamento e '
    + 'validade da proposta. Se não atender algum item, ou se houver desvio técnico, diga qual.';
  const subject = `Pedido de cotação ${input.rfqNumber} — ${input.organization}`;
  const text = [
    greeting, '',
    `${input.organization} solicita cotação para os itens abaixo (pedido de cotação ${input.rfqNumber}).`, '',
    'Itens:', ...input.lines.map((l) => `- ${itemLine(l)}`), '',
    `Prazo para resposta: ${due ?? 'o quanto antes'}.`, '',
    ask, '',
    replyTo, '',
    `— Enviado pelo INSIGHT APEX em nome de ${input.organization}.`,
  ].join('\n');
  const html = [
    `<p>${esc(greeting)}</p>`,
    `<p>${esc(input.organization)} solicita cotação para os itens abaixo (pedido de cotação <strong>${esc(input.rfqNumber)}</strong>).</p>`,
    `<ul>${input.lines.map((l) => `<li>${esc(itemLine(l))}</li>`).join('')}</ul>`,
    `<p>Prazo para resposta: <strong>${esc(due ?? 'o quanto antes')}</strong>.</p>`,
    `<p>${esc(ask)}</p>`,
    `<p>${esc(replyTo)}</p>`,
    `<p style="color:#667085">— Enviado pelo INSIGHT APEX em nome de ${esc(input.organization)}.</p>`,
  ].join('\n');
  return { subject, text, html };
}

/** O desfecho do transporte, dito como é: coletor local e transporte desligado não chegam ao fornecedor. */
export function outcomeOf(result: AppEmailResult): { outcome: 'SENT' | 'SIMULATED'; message: string } {
  if (result.outcome === 'SENT' && result.provider !== 'capture') {
    return { outcome: 'SENT', message: 'Pedido de cotação enviado para o e-mail cadastrado.' };
  }
  if (result.provider === 'capture') {
    return { outcome: 'SIMULATED', message: 'Registrado — ambiente de teste: o e-mail ficou no coletor local e não foi ao fornecedor.' };
  }
  return { outcome: 'SIMULATED', message: 'Simulado — o envio de e-mail está desligado nesta instalação.' };
}

const spTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit',
    minute: '2-digit' });
};

/* ══════════════════════════════════════════════════════════════════════════
   O livro de envios
   ══════════════════════════════════════════════════════════════════════════ */

/** Transportes que não entregam ao fornecedor: o coletor local de QA grava `sent` com este provedor — não é envio. */
export const NON_DELIVERING_PROVIDERS = ['capture', 'none'] as const;

/**
 * Quando cada convite JÁ foi enviado (o envio aceito mais antigo). O livro
 * `email_dispatches` só é legível por admin/auditoria; aqui o service role lê
 * SÓ `related_entity_id` e `created_at` dos convites que o chamador já leu (sob
 * a RLS de compras, no Dashboard) ou que a rota já validou — nunca endereço
 * nem assunto. Simulado não conta como enviado — nem o `sent` do coletor
 * local (`provider = capture`), que não chegou ao fornecedor.
 */
export async function readRfqDispatches(
  organizationId: string, invitationIds: readonly string[], db: SupabaseClient = platformServiceClient(),
): Promise<Map<string, string>> {
  const ids = invitationIds.filter((id) => UUID.test(id));
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await selectIn<{ related_entity_id: string; created_at: string }>(ids, (c) => db.from('email_dispatches')
    .select('related_entity_id,created_at').eq('organization_id', organizationId).eq('related_entity_type', RFQ_DISPATCH_TYPE)
    .eq('status', 'sent').not('provider', 'in', `(${NON_DELIVERING_PROVIDERS.join(',')})`)
    .in('related_entity_id', c).order('created_at', { ascending: true }).limit(1000));
  for (const r of rows) {
    const cur = out.get(r.related_entity_id);
    if (!cur || r.created_at < cur) out.set(r.related_entity_id, r.created_at);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   O ato
   ══════════════════════════════════════════════════════════════════════════ */

export interface RfqSendInput {
  organizationId: string;
  actor: { id: string; email: string | null };
  rfqId: string;
  supplierIds?: string[];
  /** A pessoa lê o cadastro de partes (o nome do fornecedor); sem isto, o nome volta "Restrito". Padrão: lê. */
  names?: boolean;
  headers?: Headers;
}

const fail = (status: number, error: string) => ({ status, body: { ok: false as const, error } });

/**
 * O prospecto cadastrado a partir da busca da Apex na internet (a marca que o
 * cadastro grava nas notas — `prospectBody`): o e-mail dele veio de uma página,
 * não de uma pessoa. Enquanto é PROSPECTO, não recebe pedido de cotação.
 */
export const WEB_DISCOVERY_NOTE = /Encontrado pela busca da Apex na internet/i;

/**
 * Envia o pedido de cotação aos convidados (todos, ou os pedidos). Recusa com
 * status: 404 cotação de outra organização/inexistente; 422 cotação não aberta,
 * fornecedor não convidado, nada a enviar. Falha de UM fornecedor não derruba
 * os outros (vira FAILED nele). Quem já mandou proposta nesta cotação não
 * recebe o pedido (nem pedido explicitamente): a proposta está em Compras.
 */
export async function sendRfqInvitations(input: RfqSendInput): Promise<{ status: number; body: RfqSendResponse }> {
  const db = platformServiceClient();
  const org = input.organizationId;
  const rfqRes = await db.from('procurement_rfqs').select('id,rfq_number,status,response_due')
    .eq('organization_id', org).eq('id', input.rfqId).maybeSingle();
  if (rfqRes.error) throw new Error('Não foi possível ler a cotação.');
  const rfq = rfqRes.data as { id: string; rfq_number: string; status: string; response_due: string | null } | null;
  if (!rfq) return fail(404, 'Cotação não encontrada nesta organização.');
  if (rfq.status !== 'OPEN') return fail(422, 'Só cotação aberta é enviada ao fornecedor.');

  const invitedRes = await db.from('procurement_rfq_suppliers').select('id,supplier_id').eq('organization_id', org).eq('rfq_id', rfq.id)
    .limit(100);
  if (invitedRes.error) throw new Error('Não foi possível ler os convidados da cotação.');
  const invited = (invitedRes.data ?? []) as Array<{ id: string; supplier_id: string }>;
  const wanted = input.supplierIds ? Array.from(new Set(input.supplierIds)) : null;
  if (wanted) {
    const invitedIds = new Set(invited.map((i) => i.supplier_id));
    if (wanted.some((id) => !invitedIds.has(id))) return fail(422, 'Só fornecedor convidado para esta cotação recebe o pedido.');
  }
  const targets = wanted ? invited.filter((i) => wanted.includes(i.supplier_id)) : invited;
  if (!targets.length) return fail(422, 'Esta cotação não tem fornecedor convidado.');

  const [linesRes, profiles, orgRes, sent, people, quotedRes] = await Promise.all([
    db.from('procurement_rfq_lines').select('id,item_id,quantity,required_by').eq('organization_id', org).eq('rfq_id', rfq.id).limit(200),
    selectIn<{ id: string; party_id: string; status: string; contact_name: string | null; contact_email: string | null; notes: string | null }>(
      targets.map((t) => t.supplier_id), (c) => db.from('supplier_profiles').select('id,party_id,status,contact_name,contact_email,notes')
        .eq('organization_id', org).in('id', c)),
    db.from('organizations').select('name').eq('id', org).maybeSingle(),
    readRfqDispatches(org, targets.map((t) => t.id), db),
    resolveOwnerNames(org, [input.actor.id]).catch(() => ({} as Record<string, string>)),
    // Só QUEM já mandou proposta (nunca preço): esse não recebe o pedido de novo.
    db.from('supplier_quotes').select('supplier_id').eq('organization_id', org).eq('rfq_id', rfq.id).neq('status', 'WITHDRAWN').limit(500),
  ]);
  if (linesRes.error) throw new Error('Não foi possível ler os itens da cotação.');
  if (quotedRes.error) throw new Error('Não foi possível ler as propostas da cotação.');
  const quoted = new Set(((quotedRes.data ?? []) as Array<{ supplier_id: string }>).map((q) => q.supplier_id));
  const lineRows = (linesRes.data ?? []) as Array<{ id: string; item_id: string; quantity: unknown; required_by: string | null }>;
  const [items, parties] = await Promise.all([
    selectIn<{ id: string; code: string | null; description: string | null; unit: string | null }>(lineRows.map((l) => l.item_id),
      (c) => db.from('supply_items').select('id,code,description,unit').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; legal_name: string | null; trade_name: string | null }>(profiles.map((p) => p.party_id),
      (c) => db.from('parties').select('id,legal_name,trade_name').eq('organization_id', org).in('id', c)),
  ]);
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const partyName = new Map(parties.map((p) => [p.id, p.trade_name?.trim() || p.legal_name?.trim() || null]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const organization = String((orgRes.data as Row | null)?.name ?? '').trim() || 'Nossa empresa';
  const lines = lineRows.map((l) => {
    const item = itemMap.get(l.item_id);
    return { code: item?.code ?? null, description: item?.description ?? 'Item', quantity: Number(l.quantity ?? 0), unit: item?.unit ?? null,
      requiredBy: l.required_by };
  });

  const results: RfqSendResult[] = [];
  const audited: Array<{ supplier_id: string; invitation_id: string; outcome: RfqSendOutcome }> = [];
  const canReadNames = input.names !== false;
  for (const t of targets) {
    const p = profileMap.get(t.supplier_id);
    const realName = (p ? partyName.get(p.party_id) : null) ?? 'Fornecedor';
    const name = canReadNames ? realName : 'Restrito';
    const push = (outcome: RfqSendOutcome, message: string) => {
      results.push({ supplierId: t.supplier_id, name, outcome, message });
      audited.push({ supplier_id: t.supplier_id, invitation_id: t.id, outcome });
    };
    const already = sent.get(t.id);
    if (already) { push('ALREADY_SENT', `Já enviado em ${spTime(already) ?? 'data registrada'}.`); continue; }
    if (quoted.has(t.supplier_id)) { push('FAILED', 'Proposta já registrada nesta cotação — o pedido não é reenviado.'); continue; }
    if (!p) { push('FAILED', 'Cadastro do fornecedor não encontrado.'); continue; }
    if (p.status === 'SUSPENDED' || p.status === 'BLOCKED') {
      push('FAILED', 'Fornecedor suspenso ou bloqueado não recebe pedido de cotação.');
      continue;
    }
    if (p.status !== 'HOMOLOGATED' && WEB_DISCOVERY_NOTE.test(p.notes ?? '')) {
      push('FAILED', 'Prospecto encontrado pela busca da Apex na internet: o contato não foi verificado — verifique e homologue em Compras antes de enviar.');
      continue;
    }
    const to = p.contact_email?.trim() ?? '';
    if (!to) { push('NO_CONTACT', 'Sem e-mail cadastrado — atualize o contato do fornecedor.'); continue; }
    const msg = rfqEmail({
      organization, rfqNumber: rfq.rfq_number, supplierName: realName, contactName: p.contact_name, responseDue: rfq.response_due, lines,
      buyer: { name: people[input.actor.id] ?? null, email: input.actor.email },
    });
    try {
      const result = await sendAppEmail({ ...msg, to }, {
        idempotencyKey: rfqIdempotencyKey(rfq.id, t.supplier_id), organizationId: org, related: { type: RFQ_DISPATCH_TYPE, id: t.id },
      });
      const o = outcomeOf(result);
      push(o.outcome, o.message);
    } catch (error) {
      push('FAILED', error instanceof EmailPermanentError
        ? 'O envio foi recusado (endereço inválido ou transporte não configurado).'
        : 'Não foi possível enviar agora — tente de novo em instantes.');
    }
  }

  const outcomes = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  // Quem enviou o quê a quem: o ator é o da sessão (a auditoria o grava); aqui, cada convite com o seu desfecho.
  const audit = await logAuditEventServer({ organizationId: org, action: 'supply.rfq.sent', entityType: 'procurement_rfq', entityId: rfq.id,
    metadata: { rfq_number: rfq.rfq_number, suppliers: targets.length, outcomes, results: audited } }, input.headers).catch(() => null);
  if (!audit || !audit.ok) console.warn('[supply/rfq-send] auditoria do envio não gravou', { rfqId: rfq.id });
  return { status: 200, body: { ok: true, results } };
}
