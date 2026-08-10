import { authenticateMobile, json } from '@/lib/mobile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, personId } = auth.auth;

  let body: { punchId?: string } = {};
  try {
    body = await req.json() as typeof body;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }
  if (!body.punchId) return json({ ok: false, error: 'punchId é obrigatório' }, 400);

  const { data: selected } = await supabase
    .from('attendance_punches')
    .select('id, type')
    .eq('id', body.punchId)
    .eq('person_id', personId)
    .maybeSingle();
  if (!selected) return json({ ok: false, error: 'Marcação não encontrada' }, 404);

  const { error } = await supabase.rpc('undo_own_attendance_punch', {
    p_punch_id: body.punchId,
  });
  if (error) return json({ ok: false, error: error.message }, 409);

  // Entrada e apontamento são iniciados juntos. Se a entrada acabou de ser
  // desfeita, a sessão ainda não consolidada também precisa ser descartada.
  if (selected.type === 'clock_in') {
    const { error: sessionError } = await supabase
      .from('project_work_sessions')
      .update({
        ended_at: new Date().toISOString(),
        status: 'discarded',
      })
      .eq('person_id', personId)
      .eq('status', 'running');
    if (sessionError) {
      return json({
        ok: true,
        warning: 'Marcação desfeita, mas a atividade do projeto precisa ser encerrada manualmente.',
      });
    }
  }

  return json({ ok: true });
}
