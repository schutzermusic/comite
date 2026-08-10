import { authenticateMobile, json } from '@/lib/mobile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Janela máxima consultável de uma vez (um trimestre). */
const MAX_RANGE_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNDO_WINDOW_MS = 5 * 60_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null): string | null {
  return value && DATE_RE.test(value) ? value : null;
}

function shiftDays(date: string, days: number): string {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Histórico de marcações do PRÓPRIO colaborador num período.
 *
 * Leitura autorizada pela policy `attendance_select` (person_id =
 * current_user_person_id()) — nenhum bypass de RLS: o cliente Supabase é
 * criado com o bearer da sessão do colaborador. Marcações canceladas vêm
 * junto de propósito: o colaborador precisa enxergar o que foi recusado.
 */
export async function GET(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, personId } = auth.auth;

  const params = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = parseDate(params.get('to')) ?? today;
  const from = parseDate(params.get('from')) ?? shiftDays(to, -30);

  if (from > to) {
    return json({ ok: false, error: 'O período inicial não pode ser depois do final.' }, 400);
  }
  const spanDays = Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS,
  );
  if (spanDays > MAX_RANGE_DAYS) {
    return json({ ok: false, error: 'Escolha um período de até 3 meses.' }, 400);
  }

  const { data, error } = await supabase
    .from('attendance_punches')
    .select('id, type, occurred_at, received_at, status, original_punch_id, correction_reason, review_note, notes, source')
    .eq('person_id', personId)
    .gte('occurred_at', `${from}T00:00:00`)
    .lte('occurred_at', `${to}T23:59:59.999`)
    .order('occurred_at', { ascending: true })
    .limit(1000);
  if (error) return json({ ok: false, error: error.message }, 500);

  const punches = data ?? [];
  // Só a última marcação viva, dentro da janela de 5 min, pode ser desfeita —
  // exatamente o critério aplicado em /api/mobile/bootstrap.
  const undoable = punches
    .filter((p) => p.status === 'accepted' || p.status === 'under_review')
    .at(-1);
  const canUndoLatest = Boolean(
    undoable && Date.now() - new Date(undoable.received_at as string).getTime() <= UNDO_WINDOW_MS,
  );

  return json({
    ok: true,
    from,
    to,
    punches: punches.map((punch) => ({
      ...punch,
      can_undo: punch.id === undoable?.id && canUndoLatest,
    })),
  });
}
