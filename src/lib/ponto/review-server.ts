/**
 * Revisão de marcações "under_review" (server-only). Fecha o loop do
 * ADR-008: punches fora do geofence / com falha de auth entram em revisão e
 * um humano (people.attendance_manage) decide. Junta a selfie (signed URL
 * temporária), a evidência de localização (distância/geofence) e a pessoa,
 * e resolve o punch com trilha de auditoria (reviewed_by/at/note).
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ponto/review-server.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/ai/server-clients';

const SELFIE_BUCKET = 'attendance-selfies';
const SIGNED_URL_TTL = 600; // 10 min

export class ReviewError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'review_error') {
    super(message);
  }
}

export interface ReviewItem {
  punchId: string;
  type: string;
  occurredAt: string;
  personId: string;
  personName: string;
  selfieUrl: string | null;
  selfiePurged: boolean;
  location: {
    latitude: number | null;
    longitude: number | null;
    accuracyMeters: number | null;
    distanceMeters: number | null;
    geofenceName: string | null;
    /** Centro/raio da cerca, para plotar o ponto contra o limite no mapa. */
    geofenceLat: number | null;
    geofenceLng: number | null;
    geofenceRadiusMeters: number | null;
    geofenceProjectId: string | null;
    /** Proveniência do fix — gps/network/unknown, offline e integridade. */
    source: string | null;
    capturedAtDevice: string | null;
    offlineCapture: boolean;
    integrityStatus: string | null;
  } | null;
  authMethod: string | null;
}

type PunchRow = {
  id: string;
  type: string;
  occurred_at: string;
  person_id: string;
  people: { full_name: string } | null;
  location_evidence: {
    latitude: number | null;
    longitude: number | null;
    accuracy_meters: number | null;
    distance_from_geofence_meters: number | null;
    source: string | null;
    captured_at_device: string | null;
    offline_capture: boolean | null;
    integrity_status: string | null;
    project_geofences: {
      name: string;
      center_lat: number | null;
      center_lng: number | null;
      radius_meters: number | null;
      project_id: string | null;
    } | null;
  } | null;
  authentication_evidence: {
    method: string | null;
    provider_reference: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
};

async function signSelfie(service: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await service.storage.from(SELFIE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Marcações pendentes de revisão da organização, com evidências. */
export async function listReviewItems(orgId: string, personIds?: string[]): Promise<ReviewItem[]> {
  if (personIds && personIds.length === 0) return [];
  const service = getServiceClient();
  let query = service
    .from('attendance_punches')
    .select(
      `id, type, occurred_at, person_id,
       people:person_id ( full_name ),
       location_evidence:location_evidence_id (
         latitude, longitude, accuracy_meters, distance_from_geofence_meters,
         source, captured_at_device, offline_capture, integrity_status,
         project_geofences:geofence_id ( name, center_lat, center_lng, radius_meters, project_id )
       ),
       authentication_evidence:authentication_evidence_id ( method, provider_reference, metadata )`,
    )
    .eq('organization_id', orgId)
    .eq('status', 'under_review');
  if (personIds) query = query.in('person_id', personIds);
  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .limit(200);
  if (error) throw new ReviewError(`Falha ao carregar revisões: ${error.message}`, 500, 'list_failed');

  const rows = (data ?? []) as unknown as PunchRow[];
  const items: ReviewItem[] = [];
  for (const r of rows) {
    const ae = r.authentication_evidence;
    const purged = !!ae?.metadata && (ae.metadata as { selfie_purged?: boolean }).selfie_purged === true;
    const path = ae?.provider_reference ?? null;
    items.push({
      punchId: r.id,
      type: r.type,
      occurredAt: r.occurred_at,
      personId: r.person_id,
      personName: r.people?.full_name ?? '—',
      selfieUrl: purged ? null : await signSelfie(service, path),
      selfiePurged: purged,
      location: r.location_evidence
        ? {
            latitude: r.location_evidence.latitude,
            longitude: r.location_evidence.longitude,
            accuracyMeters: r.location_evidence.accuracy_meters,
            distanceMeters: r.location_evidence.distance_from_geofence_meters,
            geofenceName: r.location_evidence.project_geofences?.name ?? null,
            geofenceLat: r.location_evidence.project_geofences?.center_lat ?? null,
            geofenceLng: r.location_evidence.project_geofences?.center_lng ?? null,
            geofenceRadiusMeters: r.location_evidence.project_geofences?.radius_meters ?? null,
            geofenceProjectId: r.location_evidence.project_geofences?.project_id ?? null,
            source: r.location_evidence.source,
            capturedAtDevice: r.location_evidence.captured_at_device,
            offlineCapture: r.location_evidence.offline_capture === true,
            integrityStatus: r.location_evidence.integrity_status,
          }
        : null,
      authMethod: ae?.method ?? null,
    });
  }
  return items;
}

/** Resolve uma marcação em revisão: accept -> accepted, reject -> cancelled. */
export async function resolvePunch(
  actorUserId: string,
  orgId: string,
  punchId: string,
  decision: 'accept' | 'reject',
  note: string | null,
): Promise<void> {
  const service = getServiceClient();
  const { data: punch, error } = await service
    .from('attendance_punches')
    .select('id, organization_id, status, person_id, type')
    .eq('id', punchId)
    .maybeSingle();
  if (error) throw new ReviewError(`Falha ao carregar marcação: ${error.message}`, 500);
  if (!punch) throw new ReviewError('Marcação não encontrada.', 404, 'not_found');
  if (punch.organization_id !== orgId) throw new ReviewError('Marcação de outra organização.', 403, 'cross_tenant');
  if (punch.status !== 'under_review') throw new ReviewError('Esta marcação não está em revisão.', 409, 'not_in_review');

  const newStatus = decision === 'accept' ? 'accepted' : 'cancelled';
  const { error: updErr } = await service
    .from('attendance_punches')
    .update({
      status: newStatus,
      reviewed_by: actorUserId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq('id', punchId)
    .eq('status', 'under_review'); // guarda contra corrida
  if (updErr) throw new ReviewError(`Falha ao resolver a marcação: ${updErr.message}`, 500, 'update_failed');

  await service.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: actorUserId,
    action: decision === 'accept' ? 'attendance.punch.review_accepted' : 'attendance.punch.review_rejected',
    entity_type: 'attendance_punch',
    entity_id: punchId,
    metadata: { person_id: punch.person_id, punch_type: punch.type, note: note?.trim() || null },
  });
}
