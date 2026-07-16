import { authenticateMobile, json } from '@/lib/mobile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns the field app's home state for the authenticated person:
 * today's punches, running work session, live project allocations and
 * the geofences of those projects. One round-trip to render the home
 * screen (spec §12.2) and enable offline caching.
 */
export async function GET(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, personId } = auth.auth;

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: person }, { data: punches }, { data: running }, { data: allocations }, { data: devices }] =
    await Promise.all([
      supabase.from('people').select('id, full_name, job_title, department, weekly_hours').eq('id', personId).maybeSingle(),
      supabase
        .from('attendance_punches')
        .select('id, type, occurred_at, status')
        .eq('person_id', personId)
        .neq('status', 'cancelled')
        .gte('occurred_at', `${today}T00:00:00`)
        .lte('occurred_at', `${today}T23:59:59`)
        .order('occurred_at', { ascending: true }),
      supabase
        .from('project_work_sessions')
        .select('id, project_id, started_at, timeline_item_id')
        .eq('person_id', personId)
        .eq('status', 'running')
        .maybeSingle(),
      supabase
        .from('project_allocations')
        .select('project_id, role_title, planned_percentage, start_date, end_date, status')
        .eq('person_id', personId)
        .in('status', ['active', 'pending_approval'])
        .lte('start_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`),
      supabase.from('registered_devices').select('id, device_public_id, status').eq('person_id', personId),
    ]);

  const projectIds = Array.from(new Set((allocations ?? []).map((a) => a.project_id as string)));
  let geofences: unknown[] = [];
  if (projectIds.length > 0) {
    const { data: gf } = await supabase
      .from('project_geofences')
      .select('id, project_id, name, center_lat, center_lng, radius_meters, accuracy_tolerance_meters')
      .in('project_id', projectIds)
      .eq('active', true);
    geofences = gf ?? [];
  }

  return json({
    ok: true,
    person,
    today,
    punches: punches ?? [],
    runningSession: running ?? null,
    allocations: allocations ?? [],
    geofences,
    devices: devices ?? [],
  });
}
