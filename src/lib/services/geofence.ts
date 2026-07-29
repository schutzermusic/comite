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
  municipality_code: string | null;
  municipality_name: string | null;
  state_code: string | null;
  municipality_source: 'manual' | 'reverse_geocoding' | 'migration' | null;
  municipality_verified_at: string | null;
  municipality_verified_by: string | null;
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
    municipalityCode: row.municipality_code,
    municipalityName: row.municipality_name,
    stateCode: row.state_code,
    municipalitySource: row.municipality_source,
    municipalityVerifiedAt: row.municipality_verified_at,
    municipalityVerifiedBy: row.municipality_verified_by,
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
  municipalityCode?: string | null;
  municipalityName?: string | null;
  stateCode?: string | null;
  municipalitySource?: 'manual' | 'reverse_geocoding' | 'migration' | null;
  verifyMunicipality?: boolean;
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
      municipality_code: input.municipalityCode ?? null,
      municipality_name: input.municipalityName ?? null,
      state_code: input.stateCode ?? null,
      municipality_source: input.municipalitySource ?? null,
      municipality_verified_at: input.verifyMunicipality ? new Date().toISOString() : null,
      municipality_verified_by: input.verifyMunicipality ? userId : null,
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
  const { orgId, userId } = await getCurrentOrgAndUser(supabase);
  const row: Record<string, unknown> = {
    name: patch.name?.trim(),
    center_lat: patch.centerLat,
    center_lng: patch.centerLng,
    radius_meters: patch.radiusMeters,
    accuracy_tolerance_meters: patch.accuracyToleranceMeters,
    active: patch.active,
    municipality_code: patch.municipalityCode,
    municipality_name: patch.municipalityName,
    state_code: patch.stateCode,
    municipality_source: patch.municipalitySource,
  };
  if (patch.verifyMunicipality !== undefined) {
    row.municipality_verified_at = patch.verifyMunicipality ? new Date().toISOString() : null;
    row.municipality_verified_by = patch.verifyMunicipality ? userId : null;
  }
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

/** Resolve o identificador oficial sem expor o código técnico no formulário. */
export async function resolveMunicipalityCode(
  municipalityName: string,
  stateCode: string,
): Promise<string | null> {
  const uf = stateCode.trim().toUpperCase();
  const name = municipalityName.trim();
  if (!name || !/^[A-Z]{2}$/.test(uf)) return null;

  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Não foi possível validar o município informado');

  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
  const municipalities = (await res.json()) as Array<{ id: number; nome: string }>;
  const match = municipalities.find((municipality) => normalize(municipality.nome) === normalize(name));
  return match ? String(match.id) : null;
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
