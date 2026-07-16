/**
 * Geofence service (migration 050) — cercas por canteiro/projeto (D5).
 * CRUD de cercas circulares (centro + raio) consumidas pela avaliação de
 * ponto no app mobile (/api/mobile/punch). Live-first via Supabase RLS.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type { ProjectGeofence } from '@/lib/types/people';
import { getCurrentOrgAndUser, rlsFriendlyMessage } from './people';

export const GEOFENCES_TABLE = 'project_geofences';

type GeofenceRow = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  center_lat: number | string;
  center_lng: number | string;
  radius_meters: number | string;
  accuracy_tolerance_meters: number | string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function mapRow(row: GeofenceRow): ProjectGeofence {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    centerLat: Number(row.center_lat),
    centerLng: Number(row.center_lng),
    radiusMeters: Number(row.radius_meters),
    accuracyToleranceMeters: Number(row.accuracy_tolerance_meters),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listGeofences(projectId?: string): Promise<ProjectGeofence[]> {
  const supabase = createClient();
  let query = supabase.from(GEOFENCES_TABLE).select('*').order('name');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar geofences', error));
  return (data ?? []).map((r) => mapRow(r as GeofenceRow));
}

export interface GeofenceInput {
  projectId: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  accuracyToleranceMeters?: number;
  active?: boolean;
}

export async function createGeofence(input: GeofenceInput): Promise<ProjectGeofence> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const { data, error } = await supabase
    .from(GEOFENCES_TABLE)
    .insert({
      organization_id: orgId,
      project_id: input.projectId,
      name: input.name.trim(),
      center_lat: input.centerLat,
      center_lng: input.centerLng,
      radius_meters: input.radiusMeters,
      accuracy_tolerance_meters: input.accuracyToleranceMeters ?? 50,
      active: input.active ?? true,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar geofence', error));

  const gf = mapRow(data as GeofenceRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'geofence.created',
    entityType: 'project_geofence',
    entityId: gf.id,
    metadata: { project_id: gf.projectId, radius: gf.radiusMeters },
  });
  return gf;
}

export async function updateGeofence(
  id: string,
  patch: Partial<GeofenceInput>,
): Promise<ProjectGeofence> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const row: Record<string, unknown> = {
    name: patch.name?.trim(),
    center_lat: patch.centerLat,
    center_lng: patch.centerLng,
    radius_meters: patch.radiusMeters,
    accuracy_tolerance_meters: patch.accuracyToleranceMeters,
    active: patch.active,
  };
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);

  const { data, error } = await supabase
    .from(GEOFENCES_TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar geofence', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'geofence.updated',
    entityType: 'project_geofence',
    entityId: id,
    metadata: { fields: Object.keys(row) },
  });
  return mapRow(data as GeofenceRow);
}

/**
 * Geocodes a free-text address to coordinates via OpenStreetMap Nominatim
 * (gratuito, sem chave; CORS liberado). Uso de baixo volume — respeite a
 * política de uso do Nominatim. Retorna null quando nada é encontrado.
 */
export async function geocodeAddress(
  query: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Falha ao geocodificar (${res.status})`);
  const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!arr || arr.length === 0) return null;
  return {
    lat: Number(arr[0].lat),
    lng: Number(arr[0].lon),
    label: arr[0].display_name,
  };
}

export async function deleteGeofence(id: string): Promise<void> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const { error } = await supabase.from(GEOFENCES_TABLE).delete().eq('id', id);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao remover geofence', error));
  void logAuditEvent({
    organizationId: orgId,
    action: 'geofence.deleted',
    entityType: 'project_geofence',
    entityId: id,
  });
}
