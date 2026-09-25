/**
 * DECISÕES — o ato (server-only).
 *
 * Decisões não decide: ela LEVA o ato ao mesmo lugar de onde a decisão veio,
 * pela mesma função canônica que o módulo de origem usa.
 *
 *   alçada declarada   decision_purchase_order_act (service role, p_actor = a
 *                      pessoa da sessão) → purchase_order_decide — a mesma
 *                      permissão, SoD, alçada, efeito e fato do ato em Compras;
 *                      o invólucro só acrescenta tela velha e idempotência.
 *   motor              approval_decide pela SESSÃO da pessoa: auth.uid() é o
 *                      ator. Nunca pelo service role — sem `sub`, o motor recusa,
 *                      e com ele seria decidir em nome de alguém.
 *
 * A caixa (`decision_inbox_for_viewer`) é só o PORTÃO de tela: diz se a
 * decisão está diante desta pessoa e qual submissão/etapa ela vê. Quem decide
 * se o ato vale continua sendo o banco, no instante do ato.
 */
if (typeof window !== 'undefined') {
  throw new Error('decisions/act.ts não pode ser importado no navegador');
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { governedRpc } from '@/lib/platform/governed-rpc';
import { platformServiceClient } from '@/lib/platform/server-client';
import { governedFailure } from '@/lib/operations/session';
import { procurementErrorMessage } from '@/lib/supply/procurement';
import { scheduleDecisionNotify, type NoticeTrigger } from './notify';
import {
  AUTHORITY_DECISION, ENGINE_DECISION, engineIdempotencyKey, isStaleEngineMessage, normalizeReason, parseDecisionKey, staleMessage,
} from './model';
import { NO_STORE, readResolved, viewerInboxRow, type DecisionsSession } from './read';
import type { DecisionAction, DecisionActOutcome, DecisionActResponse, DecisionSourceKind, ResolvedDecision } from './types';

type Row = Record<string, unknown>;

export const decisionActSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT'], { message: 'Ato inválido.' }),
  reason: z.string().max(1000, 'Justificativa com mais de 1.000 caracteres.').nullable().optional(),
  expectedFingerprint: z.string().max(200, 'Impressão digital inválida.').nullable().optional(),
  intentId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'Intenção inválida: 8 a 80 caracteres [A-Za-z0-9_-].'),
});

export const NOT_UNDER_AUTHORITY = 'Esta decisão não está sob a sua alçada.';
export const REPLAY_MESSAGE = 'Esta decisão já estava registrada por você — nada foi duplicado.';

// ---------------------------------------------------------------------------
// Regras puras (testadas em tests/unit/decisions-read.test.ts)
// ---------------------------------------------------------------------------

const OUTCOME_OF: Record<DecisionAction, NonNullable<ResolvedDecision['outcome']>> = {
  APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_ADJUSTMENT: 'ADJUSTMENT_REQUESTED',
};

/**
 * A decisão encerrada é o eco do PRÓPRIO ato desta pessoa? Mesmo ator e mesmo
 * desfecho → resposta idempotente (a regra de decision_purchase_order_act,
 * 240 §12). Desfecho de outra pessoa, ou outro desfecho, é tela velha.
 */
export function replayOf(resolved: Pick<ResolvedDecision, 'open' | 'closedBy' | 'outcome'> | null, actorId: string, action: DecisionAction): boolean {
  if (!resolved || resolved.open || resolved.closedBy?.id !== actorId) return false;
  return resolved.outcome === OUTCOME_OF[action];
}

/**
 * Recusas de elegibilidade do motor (`CODIGO: detalhe`, 42501). O texto é o
 * de `ELIGIBILITY_MESSAGE` (platform/approvals/approval-service.ts) — aquele
 * módulo é de cliente ('use client') e não pode ser importado numa rota.
 */
const ENGINE_ELIGIBILITY: Record<string, string> = {
  SOD_REQUESTER: 'Você solicitou esta aprovação e por isso não pode decidi-la.',
  SOD_SUBJECT_CREATOR: 'Você cadastrou o objeto e esta etapa não admite o autor.',
  SOD_INCOMPATIBLE_STEP: 'Você já decidiu outra etapa incompatível neste mesmo pedido.',
  NOT_ACTIVE_MEMBER: 'Sua conta não está ativa nesta organização.',
  NOT_NAMED_APPROVER: 'Esta etapa tem aprovador nomeado, e não é você.',
  MISSING_ROLE: 'Você não tem o papel que esta etapa exige.',
  MISSING_PERMISSION: 'Você não tem a permissão que esta etapa exige.',
  PERMISSION_DENIED_OVERRIDE: 'A permissão desta etapa está negada para você.',
  AUTHORITY_AMOUNT_UNKNOWN: 'O valor do objeto é desconhecido e esta etapa exige alçada.',
  AUTHORITY_CURRENCY_MISMATCH: 'A alçada está em outra moeda. Não há conversão automática.',
  AUTHORITY_LIMIT_EXCEEDED: 'O valor excede a alçada desta etapa.',
};

export type EngineFailure = { status: 403 | 409 | 422; code: 'STALE' | 'FORBIDDEN' | 'INTENT_REUSED' | 'REFUSED'; message: string };

/**
 * Erro do motor → resposta. Recusa de ESTADO (já decidido, expirado, objeto
 * mudou) é tela velha: 409 e recarregar, nunca "erro". 42501 é alçada: 403
 * com o motivo em português. O resto é regra de negócio: 422.
 */
export function engineFailure(message: string, code: string | null): EngineFailure {
  // Primeiro a chave reusada: a chave carrega a intenção digitada pela tela, e o texto dela não pode ser lido como estado.
  if (code === '23505' || /^Chave de idempotência .* já foi usada/.test(message)) {
    return { status: 422, code: 'INTENT_REUSED', message: 'Esta confirmação já foi usada com outro conteúdo. Abra a confirmação de novo.' };
  }
  // "A etapa … expirou em …" (etapa vencida) também é tela velha — o padrão do modelo cobre só o pedido expirado.
  if (isStaleEngineMessage(message) || /^A etapa ".*" expirou em /.test(message)) return { status: 409, code: 'STALE', message: staleMessage(null) };
  if (code === '42501') {
    const m = /^(?:ERROR:\s*)?([A-Z_]+):/.exec(message);
    return { status: 403, code: 'FORBIDDEN', message: (m && ENGINE_ELIGIBILITY[m[1]]) || 'Você não é elegível para esta etapa.' };
  }
  if (/exige justificativa/.test(message)) return { status: 422, code: 'REFUSED', message: 'Justificativa obrigatória.' };
  return { status: 422, code: 'REFUSED', message: 'O motor de aprovação recusou o ato.' };
}

/** A ação de auditoria: a MESMA do módulo de origem para compras por alçada; a do motor para o motor. */
export function auditActionFor(source: DecisionSourceKind, action: DecisionAction): string {
  if (source === 'PROCUREMENT_AUTHORITY') return AUTHORITY_DECISION[action] === 'APPROVE' ? 'supply.purchase_order.approve' : 'supply.purchase_order.reject';
  return `approval.decision.${ENGINE_DECISION[action].toLowerCase()}`;
}

/** O aviso do desfecho, só quando a decisão inteira terminou (o evento e a varredura cobrem o resto). */
export function noticeFor(key: string, action: DecisionAction): NoticeTrigger {
  if (action === 'APPROVE') return { key, kind: 'RESOLVED', outcome: 'APPROVED' };
  if (action === 'REJECT') return { key, kind: 'RESOLVED', outcome: 'REJECTED' };
  return { key, kind: 'ADJUSTMENT_REQUESTED' };
}

export function actMessage(subjectType: string, action: DecisionAction, outcome: Exclude<DecisionActOutcome, 'STALE'>, final: boolean): string {
  if (outcome === 'IDEMPOTENT_REPLAY') return REPLAY_MESSAGE;
  if (action === 'REQUEST_ADJUSTMENT') return subjectType === 'purchase_order' ? 'Ajuste solicitado a Compras.' : 'Ajuste solicitado.';
  if (action === 'REJECT') return 'Rejeição registrada.';
  if (!final) return 'Aprovação registrada — a decisão segue para o próximo estágio.';
  if (subjectType === 'purchase_order') return 'Compra aprovada.';
  if (subjectType === 'contract_billing_event') return 'Liberação de faturamento aprovada.';
  return 'Aprovação registrada.';
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

const fail = (status: number, error: string, code?: string) =>
  NextResponse.json({ ok: false, error, message: error, ...(code ? { code } : {}) }, { status, headers: NO_STORE });

function staleResponse(resolved: ResolvedDecision | null) {
  const message = staleMessage(resolved);
  return NextResponse.json({ ok: false, code: 'STALE', error: message, message, outcome: 'STALE', resolved, downstream: null },
    { status: 409, headers: NO_STORE });
}

const ok = (body: DecisionActResponse) => NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });

async function audit(org: string, source: DecisionSourceKind, subjectType: string, subjectId: string, key: string,
  action: DecisionAction, outcome: DecisionActOutcome, headers: Headers) {
  const res = await logAuditEventServer({
    organizationId: org, action: auditActionFor(source, action), entityType: subjectType, entityId: subjectId,
    metadata: { via: 'decisoes', decision_key: key, outcome, action },
  }, headers);
  if (!res.ok) console.error('[decisions] auditoria não gravada', res.reason, res.error);
}

/** Estado do objeto de origem DEPOIS do ato — o que a tela precisa dizer ("o pedido já está aprovado"). */
async function subjectStatus(org: string, subjectType: string, subjectId: string): Promise<string | null> {
  const sb = platformServiceClient();
  if (subjectType === 'purchase_order') {
    const { data } = await sb.from('purchase_orders').select('status').eq('organization_id', org).eq('id', subjectId).maybeSingle<Row>();
    return data ? String(data.status) : null;
  }
  if (subjectType === 'contract_billing_event') {
    const { data } = await sb.from('contract_billing_events').select('release_state').eq('organization_id', org).eq('id', subjectId).maybeSingle<Row>();
    return data ? String(data.release_state) : null;
  }
  return null;
}

/**
 * Desfecho FINAL do motor → o objeto de origem, NA HORA, pela mesma função
 * idempotente da rota de evento e do `sync` de Compras. Falha aqui não desfaz
 * nem esconde a decisão (ela já está gravada no motor): a rota de evento e a
 * reconciliação aplicam depois. Por isso a falha é registrada, não propagada.
 */
async function applyDownstream(org: string, subjectType: string, subjectId: string, requestId: string): Promise<{ applied: boolean; status: string | null }> {
  const fn = subjectType === 'purchase_order' ? 'purchase_order_apply_approval'
    : subjectType === 'contract_billing_event' ? 'contract_billing_apply_approval' : null;
  if (!fn) return { applied: false, status: null };
  let applied = false;
  try {
    const res = await governedRpc<Row | null>(fn, { p_approval_request_id: requestId });
    applied = res?.applied === true || res?.idempotent === true;
  } catch (error) {
    console.error('[decisions] aplicação a jusante adiada para a rota de evento/reconciliação', fn, requestId, error);
  }
  const status = await subjectStatus(org, subjectType, subjectId).catch(() => null);
  return { applied, status };
}

/**
 * Eco do próprio ato (mesmo ator, mesmo desfecho, decisão já encerrada):
 * responde "já registrado" — e, no motor, garante o reflexo a jusante, que é
 * idempotente. Nada é decidido de novo.
 */
async function replayResponse(org: string, key: string, action: DecisionAction,
  current: { raw: Row; resolved: ResolvedDecision }, headers: Headers): Promise<NextResponse> {
  const r = current.resolved;
  const final = current.raw.request_status === undefined || current.raw.request_status !== 'PENDING';
  const downstream = r.source === 'APPROVAL_ENGINE' && r.requestId && final
    ? await applyDownstream(org, r.subjectType, r.subjectId, r.requestId) : null;
  await audit(org, r.source, r.subjectType, r.subjectId, key, action, 'IDEMPOTENT_REPLAY', headers);
  return ok({ outcome: 'IDEMPOTENT_REPLAY', message: REPLAY_MESSAGE, resolved: r, downstream });
}

// ---------------------------------------------------------------------------
// O ato
// ---------------------------------------------------------------------------

export async function actOnDecision(session: DecisionsSession, key: string, body: unknown, headers: Headers): Promise<NextResponse> {
  if (!parseDecisionKey(key)) return fail(400, 'Chave de decisão inválida.');
  const input = decisionActSchema.safeParse(body);
  if (!input.success) return fail(400, input.error.issues[0]?.message ?? 'Campos inválidos.');
  const { action, intentId } = input.data;
  const reason = normalizeReason(input.data.reason);
  const expectedFingerprint = input.data.expectedFingerprint || null;
  const org = session.organizationId; const actor = session.user.id;

  try {
    const row = await viewerInboxRow(session, key);

    // Fora da caixa: não existe, já terminou, ou não é desta pessoa.
    if (!row) {
      const current = await readResolved(org, key);
      if (!current) return fail(404, 'Decisão não encontrada.');
      if (current.resolved.open) return fail(403, NOT_UNDER_AUTHORITY, 'FORBIDDEN');
      if (!replayOf(current.resolved, actor, action)) return staleResponse(current.resolved);
      return replayResponse(org, key, action, current, headers);
    }

    if (!(row.actions ?? []).includes(action)) return fail(422, 'Ato não disponível para esta decisão.');
    if ((row.reason_required ?? []).includes(action) && !reason) return fail(422, 'Justificativa obrigatória.');

    // ---------------- alçada declarada ----------------
    if (row.source_kind === 'PROCUREMENT_AUTHORITY') {
      const decision = AUTHORITY_DECISION[action];
      if (!decision) return fail(422, 'Ato não disponível para esta decisão.');
      // A mesma régua de Compras para devolver ("Devolver ao rascunho": motivo com 3+ caracteres).
      if (decision === 'REJECT' && (reason?.length ?? 0) < 3) return fail(422, 'Justificativa obrigatória — ao menos 3 caracteres.');
      let res: Row;
      try {
        res = await governedRpc<Row>('decision_purchase_order_act', {
          p_organization_id: org, p_actor: actor, p_po_id: row.subject_id, p_submission: row.submission,
          p_expected_fingerprint: expectedFingerprint, p_decision: decision, p_note: reason,
        });
      } catch (error) {
        return governedFailure(error, procurementErrorMessage);
      }
      const outcome = String(res?.outcome ?? '') as DecisionActOutcome;
      const fresh = await readResolved(org, key);
      if (outcome === 'STALE') return staleResponse(fresh?.resolved ?? null);
      if (outcome !== 'RECORDED' && outcome !== 'IDEMPOTENT_REPLAY') return fail(422, 'A decisão de compra não foi registrada.');
      await audit(org, row.source_kind, row.subject_type, row.subject_id, key, action, outcome, headers);
      if (outcome === 'RECORDED') scheduleDecisionNotify(org, [noticeFor(key, action)]);
      return ok({ outcome, message: actMessage(row.subject_type, action, outcome, true), resolved: fresh?.resolved ?? null, downstream: null });
    }

    // ---------------- motor de aprovação ----------------
    if (!row.step_id || !row.request_id) return fail(422, 'Ato não disponível para esta decisão.');
    const { data, error } = await session.supabase.rpc('approval_decide', {
      p_request_step_id: row.step_id,
      p_decision: ENGINE_DECISION[action],
      p_idempotency_key: engineIdempotencyKey(row.step_id, actor, action, intentId),
      p_reason: reason,
      p_delegation_id: null,
      p_expected_fingerprint: expectedFingerprint ?? row.fingerprint,
    });
    if (error) {
      const f = engineFailure(error.message ?? '', error.code ?? null);
      if (f.code !== 'STALE') return fail(f.status, f.message, f.code);
      const fresh = await readResolved(org, key);
      // Duplo clique com outra intenção: o motor diz "já decidido" — e foi esta pessoa, com este desfecho.
      if (fresh && replayOf(fresh.resolved, actor, action)) return replayResponse(org, key, action, fresh, headers);
      return staleResponse(fresh?.resolved ?? null);
    }
    const res = (data ?? {}) as Row;
    const outcome = String(res.status ?? '') as DecisionActOutcome;
    if (outcome !== 'RECORDED' && outcome !== 'IDEMPOTENT_REPLAY') return fail(422, 'O motor de aprovação não registrou a decisão.');
    const requestStatus = res.request_status ? String(res.request_status) : 'PENDING';
    const final = requestStatus !== 'PENDING';
    const downstream = final ? await applyDownstream(org, row.subject_type, row.subject_id, row.request_id) : null;
    await audit(org, row.source_kind, row.subject_type, row.subject_id, key, action, outcome, headers);
    if (outcome === 'RECORDED' && final) scheduleDecisionNotify(org, [noticeFor(key, action)]);
    const fresh = await readResolved(org, key);
    return ok({ outcome, message: actMessage(row.subject_type, action, outcome, final), resolved: fresh?.resolved ?? null, downstream });
  } catch (error) {
    console.error('[decisions] ato falhou', key, error);
    return fail(500, 'Não foi possível concluir o ato agora. Recarregue a decisão para ver o que está valendo.');
  }
}
