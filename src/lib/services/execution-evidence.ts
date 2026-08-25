'use client';

/**
 * Carga da evidência de execução a partir dos registros operacionais reais.
 *
 * ─── Cada fonte degrada sozinha ────────────────────────────────────────────
 * As RLS de `time_entries` (041:130-201) e `attendance_punches` (045:83-95)
 * liberam a linha quando `person_id = current_user_person_id()`. Sem a
 * permissão ampla, o usuário recebe SILENCIOSAMENTE só as próprias linhas —
 * o que produziria taxas de autonomia falsas se contássemos isso como "toda a
 * evidência". Por isso cada fonte tem gate próprio ANTES da query e, sem
 * permissão, é declarada `unauthorized` e fica FORA do denominador.
 *
 * Nenhuma permissão é afrouxada e nenhuma tabela nova é criada: tudo aqui é
 * leitura do que os módulos vizinhos já gravam.
 */

import { createClient } from '@/utils/supabase/client';
import { listEntriesByProject, listSessionsByProject } from '@/lib/services/timesheet';
import {
  fromAttendancePunch,
  fromDailyAllowance,
  fromProjectDocument,
  fromTimeEntry,
  fromWorkSession,
  sortEvidence,
  EMPTY_SOURCE_STATUS,
  type EvidenceSourceStatus,
  type ExecutionEvidence,
} from '@/lib/projects/execution-evidence';
import type { AllocationWindow, GeofenceArea } from '@/lib/projects/execution-matching';

export interface EvidenceCapabilities {
  /** people.timesheet_view | people.timesheet_approve */
  timesheet: boolean;
  /** people.attendance_view | people.attendance_manage */
  attendance: boolean;
  /** people.allocations_view (diárias e alocações) */
  allocations: boolean;
}

export interface ProjectEvidenceBundle {
  evidence: ExecutionEvidence[];
  sourceStatus: EvidenceSourceStatus;
  allocations: AllocationWindow[];
  geofences: GeofenceArea[];
}

export const EMPTY_EVIDENCE_BUNDLE: ProjectEvidenceBundle = {
  evidence: [],
  sourceStatus: EMPTY_SOURCE_STATUS,
  allocations: [],
  geofences: [],
};

/** Janela de leitura: evidência antiga não muda decisão de execução corrente. */
const LOOKBACK_DAYS = 120;

function lookbackIso(now: Date): string {
  return new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface LoadEvidenceInput {
  projectId: string;
  capabilities: EvidenceCapabilities;
  now?: Date;
}

export async function loadProjectEvidence(input: LoadEvidenceInput): Promise<ProjectEvidenceBundle> {
  const now = input.now ?? new Date();
  const since = lookbackIso(now);
  const sinceDay = since.slice(0, 10);
  const supabase = createClient();
  const sourceStatus: EvidenceSourceStatus = { ...EMPTY_SOURCE_STATUS };
  const evidence: ExecutionEvidence[] = [];

  /* ─── Apontamento e sessões (041) ─── */
  if (input.capabilities.timesheet) {
    try {
      const [entries, sessions] = await Promise.all([
        listEntriesByProject(input.projectId),
        listSessionsByProject(input.projectId, since),
      ]);
      entries.forEach((e) => evidence.push(fromTimeEntry(e)));
      sessions.forEach((s) => evidence.push(fromWorkSession(s)));
      sourceStatus.time_entry = 'available';
      sourceStatus.work_session = 'available';
    } catch {
      sourceStatus.time_entry = 'unavailable';
      sourceStatus.work_session = 'unavailable';
    }
  } else {
    sourceStatus.time_entry = 'unauthorized';
    sourceStatus.work_session = 'unauthorized';
  }

  /* ─── Ponto + localização (045). Sem project_id: o vínculo é inferido. ─── */
  if (input.capabilities.attendance) {
    try {
      const { data, error } = await supabase
        .from('attendance_punches')
        .select(
          'id, person_id, type, occurred_at, status, ' +
            'location_evidence:location_evidence_id ( latitude, longitude, accuracy_meters, geofence_id )',
        )
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      for (const row of data ?? []) {
        const r = row as unknown as {
          id: string; person_id: string; type: string; occurred_at: string; status: string;
          location_evidence: {
            latitude: number; longitude: number;
            accuracy_meters: number | null; geofence_id: string | null;
          } | null;
        };
        evidence.push(
          fromAttendancePunch({
            id: r.id,
            personId: r.person_id,
            type: r.type,
            occurredAt: r.occurred_at,
            status: r.status,
            location: r.location_evidence
              ? {
                  latitude: r.location_evidence.latitude,
                  longitude: r.location_evidence.longitude,
                  accuracyMeters: r.location_evidence.accuracy_meters,
                  geofenceId: r.location_evidence.geofence_id,
                }
              : null,
          }),
        );
      }
      sourceStatus.attendance_punch = 'available';
    } catch {
      sourceStatus.attendance_punch = 'unavailable';
    }
  } else {
    sourceStatus.attendance_punch = 'unauthorized';
  }

  /* ─── Diárias de campo: já reconciliadas contra ponto e cerca na origem ─── */
  if (input.capabilities.allocations) {
    try {
      const { data, error } = await supabase
        .from('daily_allowances')
        .select('id, person_id, project_id, allowance_date, status')
        .eq('project_id', input.projectId)
        .gte('allowance_date', sinceDay)
        .order('allowance_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      for (const row of data ?? []) {
        const r = row as { id: string; person_id: string; project_id: string | null; allowance_date: string; status: string };
        evidence.push(
          fromDailyAllowance({
            id: r.id, personId: r.person_id, projectId: r.project_id,
            allowanceDate: r.allowance_date, status: r.status,
          }),
        );
      }
      sourceStatus.daily_allowance = 'available';
    } catch {
      sourceStatus.daily_allowance = 'unavailable';
    }
  } else {
    sourceStatus.daily_allowance = 'unauthorized';
  }

  /* ─── Documentos entregues (032): carregam timeline_item_id explícito ─── */
  try {
    const { data, error } = await supabase
      .from('project_files')
      .select('id, project_id, timeline_item_id, file_name, created_at')
      .eq('project_id', input.projectId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as { id: string; project_id: string; timeline_item_id: string | null; file_name: string; created_at: string };
      evidence.push(
        fromProjectDocument({
          id: r.id, projectId: r.project_id, timelineItemId: r.timeline_item_id,
          fileName: r.file_name, createdAt: r.created_at,
        }),
      );
    }
    sourceStatus.project_document = 'available';
  } catch {
    sourceStatus.project_document = 'unavailable';
  }

  /* ─── Contexto para o casamento ─── */
  const [allocations, geofences] = await Promise.all([
    loadAllocations(supabase, input.projectId, input.capabilities.allocations),
    loadGeofences(supabase, input.projectId),
  ]);

  return { evidence: sortEvidence(evidence), sourceStatus, allocations, geofences };
}

async function loadAllocations(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  allowed: boolean,
): Promise<AllocationWindow[]> {
  if (!allowed) return [];
  try {
    const { data, error } = await supabase
      .from('project_allocations')
      .select('person_id, project_id, start_date, end_date, status')
      .eq('project_id', projectId);
    if (error) return [];
    return (data ?? []).map((row) => {
      const r = row as { person_id: string; project_id: string; start_date: string; end_date: string | null; status: string };
      return {
        personId: r.person_id, projectId: r.project_id,
        startDate: r.start_date, endDate: r.end_date, status: r.status,
      };
    });
  } catch {
    return [];
  }
}

async function loadGeofences(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<GeofenceArea[]> {
  try {
    const { data, error } = await supabase
      .from('project_geofences')
      .select('id, project_id, center_lat, center_lng, radius_meters, accuracy_tolerance_meters, active')
      .eq('project_id', projectId);
    if (error) return [];
    return (data ?? []).map((row) => {
      const r = row as {
        id: string; project_id: string; center_lat: number; center_lng: number;
        radius_meters: number; accuracy_tolerance_meters: number | null; active: boolean;
      };
      return {
        id: r.id, projectId: r.project_id,
        centerLat: r.center_lat, centerLng: r.center_lng,
        radiusMeters: r.radius_meters,
        accuracyToleranceMeters: r.accuracy_tolerance_meters ?? 0,
        active: r.active,
      };
    });
  } catch {
    return [];
  }
}
