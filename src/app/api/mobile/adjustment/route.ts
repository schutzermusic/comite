import { authenticateMobile, json } from '@/lib/mobile/server';
import {
  isAdjustmentReason,
  type AdjustmentRequest,
  type AdjustmentStatus,
  type PunchType,
} from '@/lib/ponto/attendance-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Solicitações de ajuste de ponto do colaborador.
 *
 * NÃO existe tabela nova: o ajuste reusa a cadeia de correção imutável já
 * definida na migration 045 (ADR-005) — uma solicitação é um NOVO punch
 * com `original_punch_id` apontando para o registro afetado (quando há),
 * `correction_reason` com o motivo e `status='under_review'`. Com isso a
 * fila de revisão do gestor (`/api/ponto/review`) já resolve a solicitação
 * com trilha de auditoria, e nenhuma marcação existente é sobrescrita.
 *
 * O par que identifica uma solicitação do colaborador é
 * `source='web' AND correction_reason IS NOT NULL` — marcações normais do
 * portal entram por /api/mobile/punch com `source='mobile'` e correções do
 * gestor com `source='manager_adjustment'`.
 */

const PUNCH_TYPES: readonly PunchType[] = ['clock_in', 'break_start', 'break_end', 'clock_out'];
const MAX_NOTE_LENGTH = 500;
const MAX_BACKDATE_DAYS = 90;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_OPEN_REQUESTS = 20;

interface AdjustmentBody {
  type?: string;
  occurredAt?: string;
  reason?: string;
  note?: string;
  originalPunchId?: string;
}

interface AdjustmentRow {
  id: string;
  type: string;
  occurred_at: string;
  created_at: string;
  status: string;
  correction_reason: string | null;
  notes: string | null;
  review_note: string | null;
  original_punch_id: string | null;
}

/** Traduz o status fiscal do punch para o que o colaborador entende. */
function toAdjustmentStatus(punchStatus: string): AdjustmentStatus {
  switch (punchStatus) {
    case 'under_review':
      return 'under_review';
    case 'accepted':
      return 'approved';
    case 'cancelled':
      return 'rejected';
    case 'corrected':
      return 'approved';
    default:
      return 'sent';
  }
}

function toAdjustmentRequest(row: AdjustmentRow): AdjustmentRequest {
  return {
    id: row.id,
    type: row.type as PunchType,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    status: toAdjustmentStatus(row.status),
    reason: isAdjustmentReason(row.correction_reason) ? row.correction_reason : null,
    note: row.notes,
    managerNote: row.review_note,
    originalPunchId: row.original_punch_id,
  };
}

const SELECT_COLUMNS =
  'id, type, occurred_at, created_at, status, correction_reason, notes, review_note, original_punch_id';

export async function GET(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, personId } = auth.auth;

  const { data, error } = await supabase
    .from('attendance_punches')
    .select(SELECT_COLUMNS)
    .eq('person_id', personId)
    .eq('source', 'web')
    .not('correction_reason', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({
    ok: true,
    requests: ((data ?? []) as AdjustmentRow[]).map(toAdjustmentRequest),
  });
}

export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, orgId, personId, userId } = auth.auth;

  let body: AdjustmentBody = {};
  try {
    body = (await req.json()) as AdjustmentBody;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }

  const type = body.type as PunchType | undefined;
  if (!type || !PUNCH_TYPES.includes(type)) {
    return json({ ok: false, error: 'Escolha qual marcação precisa de ajuste.' }, 400);
  }
  if (!isAdjustmentReason(body.reason)) {
    return json({ ok: false, error: 'Escolha um motivo para a solicitação.' }, 400);
  }

  const occurredAt = typeof body.occurredAt === 'string' ? new Date(body.occurredAt) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
    return json({ ok: false, error: 'Informe a data e o horário corretos.' }, 400);
  }
  const now = Date.now();
  if (occurredAt.getTime() > now + MAX_FUTURE_SKEW_MS) {
    return json({ ok: false, error: 'Não é possível solicitar ajuste para um horário futuro.' }, 400);
  }
  if (now - occurredAt.getTime() > MAX_BACKDATE_DAYS * 24 * 60 * 60 * 1000) {
    return json({ ok: false, error: 'Só é possível ajustar registros dos últimos 90 dias.' }, 400);
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : null;

  // A marcação original, quando informada, precisa ser do próprio colaborador.
  let originalPunchId: string | null = null;
  if (body.originalPunchId) {
    const { data: original } = await supabase
      .from('attendance_punches')
      .select('id')
      .eq('id', body.originalPunchId)
      .eq('person_id', personId)
      .maybeSingle();
    if (!original) {
      return json({ ok: false, error: 'A marcação informada não foi encontrada.' }, 404);
    }
    originalPunchId = original.id as string;
  }

  // Duplicidade: mesma marcação, mesmo horário, ainda em análise.
  const { data: duplicate } = await supabase
    .from('attendance_punches')
    .select('id')
    .eq('person_id', personId)
    .eq('source', 'web')
    .eq('type', type)
    .eq('status', 'under_review')
    .eq('occurred_at', occurredAt.toISOString())
    .not('correction_reason', 'is', null)
    .maybeSingle();
  if (duplicate) {
    return json(
      { ok: false, error: 'Você já enviou essa solicitação e ela ainda está em análise.', code: 'duplicate' },
      409,
    );
  }

  const { count: openCount } = await supabase
    .from('attendance_punches')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId)
    .eq('source', 'web')
    .eq('status', 'under_review')
    .not('correction_reason', 'is', null);
  if ((openCount ?? 0) >= MAX_OPEN_REQUESTS) {
    return json(
      { ok: false, error: 'Você já tem muitas solicitações em análise. Aguarde a resposta do gestor.' },
      429,
    );
  }

  const { data: created, error: insertError } = await supabase
    .from('attendance_punches')
    .insert({
      organization_id: orgId,
      person_id: personId,
      type,
      occurred_at: occurredAt.toISOString(),
      timezone: 'America/Sao_Paulo',
      source: 'web',
      status: 'under_review',
      original_punch_id: originalPunchId,
      correction_reason: body.reason,
      notes: note,
      created_by: userId,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (insertError) return json({ ok: false, error: insertError.message }, 500);

  return json({ ok: true, request: toAdjustmentRequest(created as AdjustmentRow) }, 201);
}
