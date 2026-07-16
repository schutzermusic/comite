import { authenticateMobile, json } from '@/lib/mobile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActivityBody {
  action?: 'start' | 'stop';
  projectId?: string;
  timelineItemId?: string;
  deviceId?: string;
  description?: string;
}

/**
 * Field-app activity control (spec §12): start/switch/stop the running
 * work session. "Trocar de projeto" = start with a new projectId, which
 * closes the previous running session first. One running session per
 * person is guaranteed by the DB partial unique index (migration 041).
 */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, orgId, personId, userId } = auth.auth;

  let body: ActivityBody = {};
  try {
    body = (await req.json()) as ActivityBody;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }
  if (body.action !== 'start' && body.action !== 'stop') {
    return json({ ok: false, error: 'action deve ser start ou stop' }, 400);
  }

  // close the currently running session, if any
  const { data: running } = await supabase
    .from('project_work_sessions')
    .select('id, started_at')
    .eq('person_id', personId)
    .eq('status', 'running')
    .maybeSingle();

  if (running) {
    const minutes = Math.max(
      1,
      Math.round((Date.now() - new Date(running.started_at as string).getTime()) / 60000),
    );
    await supabase
      .from('project_work_sessions')
      .update({ ended_at: new Date().toISOString(), duration_minutes: minutes, status: 'draft' })
      .eq('id', running.id);
  }

  if (body.action === 'stop') {
    return json({ ok: true, stoppedSessionId: running?.id ?? null, running: null });
  }

  // start
  if (!body.projectId) {
    return json({ ok: false, error: 'projectId é obrigatório para start' }, 400);
  }

  // attach the person's live allocation on this project, if any
  const today = new Date().toISOString().slice(0, 10);
  const { data: allocation } = await supabase
    .from('project_allocations')
    .select('id')
    .eq('person_id', personId)
    .eq('project_id', body.projectId)
    .in('status', ['active', 'pending_approval'])
    .lte('start_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .maybeSingle();

  const { data: session, error } = await supabase
    .from('project_work_sessions')
    .insert({
      organization_id: orgId,
      person_id: personId,
      project_id: body.projectId,
      allocation_id: allocation?.id ?? null,
      timeline_item_id: body.timelineItemId ?? null,
      description: body.description ?? null,
      // constraint aceita web_timer|manual_entry|manager_adjustment;
      // a origem mobile é indicada por device_id não-nulo.
      source: 'web_timer',
      status: 'running',
      device_id: body.deviceId ?? null,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, running: session });
}
