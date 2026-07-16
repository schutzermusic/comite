import { authenticateMobile, json } from '@/lib/mobile/server';
import { evaluateGeofence, type Geofence } from '@/lib/mobile/geo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PunchBody {
  type?: 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
  clientEventId?: string;
  deviceId?: string;
  occurredAt?: string;
  timezone?: string;
  offline?: boolean;
  location?: { lat: number; lng: number; accuracy?: number; source?: 'gps' | 'network' | 'unknown' };
  auth?: {
    method: 'device_biometric' | 'device_credential' | 'facial_verification' | 'manager_override';
    result: 'success' | 'failure';
    assuranceLevel?: 'basic' | 'standard' | 'enhanced';
  };
}

/**
 * Idempotent mobile punch ingest (spec §14, §20.6). Deduplicates by
 * client_event_id, evaluates the project geofence, persists location and
 * authentication evidence, and creates the (immutable) attendance punch.
 * Punches outside the fence or with failed auth are flagged
 * 'under_review' rather than rejected — a human decides (ADR-008).
 */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, orgId, personId, userId } = auth.auth;

  let body: PunchBody = {};
  try {
    body = (await req.json()) as PunchBody;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }
  if (!body.type) return json({ ok: false, error: 'type é obrigatório' }, 400);

  // 1) idempotency — replay returns the existing punch
  if (body.clientEventId) {
    const { data: existing } = await supabase
      .from('attendance_punches')
      .select('*')
      .eq('person_id', personId)
      .eq('client_event_id', body.clientEventId)
      .maybeSingle();
    if (existing) return json({ ok: true, punch: existing, idempotent: true });
  }

  // 2) device trust (optional but recorded)
  let deviceBlocked = false;
  if (body.deviceId) {
    const { data: device } = await supabase
      .from('registered_devices')
      .select('id, status')
      .eq('id', body.deviceId)
      .maybeSingle();
    deviceBlocked = device?.status === 'blocked' || device?.status === 'revoked';
    if (device) {
      await supabase
        .from('registered_devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', device.id);
    }
  }

  // 3) geofence evaluation + location evidence
  let locationEvidenceId: string | null = null;
  let geofenceResult: ReturnType<typeof evaluateGeofence> | null = null;
  if (body.location) {
    const { data: allocations } = await supabase
      .from('project_allocations')
      .select('project_id')
      .eq('person_id', personId)
      .in('status', ['active', 'pending_approval']);
    const projectIds = Array.from(new Set((allocations ?? []).map((a) => a.project_id as string)));

    let geofences: Geofence[] = [];
    if (projectIds.length > 0) {
      const { data: gf } = await supabase
        .from('project_geofences')
        .select('id, project_id, name, center_lat, center_lng, radius_meters, accuracy_tolerance_meters')
        .in('project_id', projectIds)
        .eq('active', true);
      geofences = (gf ?? []) as Geofence[];
    }

    geofenceResult = evaluateGeofence(
      body.location.lat,
      body.location.lng,
      body.location.accuracy ?? null,
      geofences,
    );

    const { data: locEv, error: locErr } = await supabase
      .from('location_evidence')
      .insert({
        organization_id: orgId,
        person_id: personId,
        latitude: body.location.lat,
        longitude: body.location.lng,
        accuracy_meters: body.location.accuracy ?? null,
        captured_at_device: body.occurredAt ?? new Date().toISOString(),
        geofence_id: geofenceResult.geofenceId,
        distance_from_geofence_meters: geofenceResult.distanceMeters,
        source: body.location.source ?? 'gps',
        offline_capture: Boolean(body.offline),
        device_id: body.deviceId ?? null,
        integrity_status: geofenceResult.integrityStatus,
      })
      .select('id')
      .single();
    if (locErr) return json({ ok: false, error: locErr.message }, 500);
    locationEvidenceId = locEv.id as string;
  }

  // 4) authentication evidence
  let authEvidenceId: string | null = null;
  if (body.auth) {
    const { data: authEv, error: authErr } = await supabase
      .from('authentication_evidence')
      .insert({
        organization_id: orgId,
        person_id: personId,
        device_id: body.deviceId ?? null,
        method: body.auth.method,
        result: body.auth.result,
        assurance_level: body.auth.assuranceLevel ?? 'basic',
      })
      .select('id')
      .single();
    if (authErr) return json({ ok: false, error: authErr.message }, 500);
    authEvidenceId = authEv.id as string;
  }

  // 5) punch — flag for review when out of fence / bad auth / blocked device
  const authFailed = body.auth?.result === 'failure';
  const outsideFence = geofenceResult != null && !geofenceResult.inside;
  const needsReview = deviceBlocked || authFailed || outsideFence;

  const { data: punch, error: punchErr } = await supabase
    .from('attendance_punches')
    .insert({
      organization_id: orgId,
      person_id: personId,
      type: body.type,
      occurred_at: body.occurredAt ?? new Date().toISOString(),
      timezone: body.timezone ?? 'America/Sao_Paulo',
      source: 'mobile',
      status: needsReview ? 'under_review' : 'accepted',
      client_event_id: body.clientEventId ?? null,
      device_id: body.deviceId ?? null,
      location_evidence_id: locationEvidenceId,
      authentication_evidence_id: authEvidenceId,
      created_by: userId,
    })
    .select('*')
    .single();
  if (punchErr) {
    // unique client_event_id race → return the winning row
    if (punchErr.code === '23505' && body.clientEventId) {
      const { data: existing } = await supabase
        .from('attendance_punches')
        .select('*')
        .eq('person_id', personId)
        .eq('client_event_id', body.clientEventId)
        .maybeSingle();
      if (existing) return json({ ok: true, punch: existing, idempotent: true });
    }
    return json({ ok: false, error: punchErr.message }, 500);
  }

  return json({
    ok: true,
    punch,
    geofence: geofenceResult,
    needsReview,
  });
}
