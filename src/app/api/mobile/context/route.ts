import { authenticateMobile, json } from '@/lib/mobile/server';
import {
  fromAttendancePunch,
  fromTimeEntry,
  fromWorkSession,
  sortEvidence,
  type ExecutionEvidence,
} from '@/lib/projects/execution-evidence';
import { matchAll, type AllocationWindow, type GeofenceArea } from '@/lib/projects/execution-matching';
import { resolveExecutionContext } from '@/lib/projects/execution-derivation';
import type { TimelineItem } from '@/lib/types/project-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * P3A — "trabalho atual" resolvido para o colaborador autenticado.
 *
 * Existe para que o funcionário NÃO precise escolher a etapa do Gantt ao bater
 * ponto. O Apex resolve o contexto a partir da evidência que já existe (ponto,
 * localização, alocação, atribuição de equipe) e o app só exibe o resultado.
 *
 * ─── Fronteira de segurança ────────────────────────────────────────────────
 * Tudo é lido com o cliente autenticado da própria pessoa, sob as MESMAS RLS
 * de sempre: ela enxerga as próprias batidas e sessões porque
 * `person_id = current_user_person_id()`. Nada aqui usa service role e nenhuma
 * permissão é afrouxada — o endpoint devolve apenas o contexto de quem chama.
 *
 * Nunca AFIRMA quando não sabe: status `AMBIGUOUS` / `UNMATCHED` /
 * `NO_EVIDENCE` chegam ao app para que ele peça confirmação em vez de exibir
 * uma etapa inventada.
 */
export async function GET(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, personId } = auth.auth;

  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Alocações vigentes definem quais projetos sequer entram em consideração.
  const { data: allocationRows } = await supabase
    .from('project_allocations')
    .select('person_id, project_id, start_date, end_date, status')
    .eq('person_id', personId);

  const allocations: AllocationWindow[] = (allocationRows ?? []).map((r) => ({
    personId: r.person_id as string,
    projectId: r.project_id as string,
    startDate: r.start_date as string,
    endDate: (r.end_date as string | null) ?? null,
    status: r.status as string,
  }));

  const projectIds = [...new Set(allocations.map((a) => a.projectId))];
  if (projectIds.length === 0) {
    return json({
      status: 'NO_EVIDENCE',
      project: null,
      phase: null,
      activity: null,
      team: null,
      confidence: null,
      reasonCodes: ['NO_PROJECT_CONTEXT'],
      candidates: [],
    });
  }

  const [{ data: punchRows }, { data: sessionRows }, { data: entryRows }, { data: geofenceRows }] =
    await Promise.all([
      supabase
        .from('attendance_punches')
        .select(
          'id, person_id, type, occurred_at, status, ' +
            'location_evidence:location_evidence_id ( latitude, longitude, accuracy_meters, geofence_id )',
        )
        .eq('person_id', personId)
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(100),
      supabase
        .from('project_work_sessions')
        .select('*')
        .eq('person_id', personId)
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(50),
      supabase
        .from('time_entries')
        .select('*')
        .eq('person_id', personId)
        .gte('work_date', since.slice(0, 10))
        .limit(100),
      supabase
        .from('project_geofences')
        .select('id, project_id, center_lat, center_lng, radius_meters, accuracy_tolerance_meters, active')
        .in('project_id', projectIds),
    ]);

  const evidence: ExecutionEvidence[] = [];
  for (const row of punchRows ?? []) {
    const r = row as unknown as {
      id: string; person_id: string; type: string; occurred_at: string; status: string;
      location_evidence: {
        latitude: number; longitude: number;
        accuracy_meters: number | null; geofence_id: string | null;
      } | null;
    };
    evidence.push(
      fromAttendancePunch({
        id: r.id, personId: r.person_id, type: r.type,
        occurredAt: r.occurred_at, status: r.status,
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
  for (const row of sessionRows ?? []) {
    const r = row as Record<string, unknown>;
    evidence.push(
      fromWorkSession({
        id: r.id as string, organizationId: r.organization_id as string,
        personId: r.person_id as string, projectId: r.project_id as string,
        allocationId: (r.allocation_id as string | null) ?? null,
        timelineItemId: (r.timeline_item_id as string | null) ?? null,
        startedAt: r.started_at as string, endedAt: (r.ended_at as string | null) ?? null,
        durationMinutes: (r.duration_minutes as number | null) ?? null,
        description: (r.description as string | null) ?? null,
        source: r.source as never, status: r.status as never,
        timeEntryId: (r.time_entry_id as string | null) ?? null,
        createdAt: r.created_at as string, updatedAt: r.updated_at as string,
      }),
    );
  }
  for (const row of entryRows ?? []) {
    const r = row as Record<string, unknown>;
    evidence.push(
      fromTimeEntry({
        id: r.id as string, organizationId: r.organization_id as string,
        personId: r.person_id as string, projectId: r.project_id as string,
        allocationId: (r.allocation_id as string | null) ?? null,
        timelineItemId: (r.timeline_item_id as string | null) ?? null,
        workDate: r.work_date as string, minutes: r.minutes as number,
        description: (r.description as string | null) ?? null,
        sourceSessionId: (r.source_session_id as string | null) ?? null,
        status: r.status as never, exceptionFlags: [], autoApproved: Boolean(r.auto_approved),
        submittedAt: null, approvedBy: null, approvedAt: null, rejectionReason: null,
        hourlyCostCents: null, costCents: null,
        createdAt: r.created_at as string, updatedAt: r.updated_at as string,
      }),
    );
  }

  const geofences: GeofenceArea[] = (geofenceRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string, projectId: r.project_id as string,
      centerLat: r.center_lat as number, centerLng: r.center_lng as number,
      radiusMeters: r.radius_meters as number,
      accuracyToleranceMeters: (r.accuracy_tolerance_meters as number | null) ?? 0,
      active: Boolean(r.active),
    };
  });

  // Equipes da pessoa → etapas atribuídas a elas. É o caminho que dispensa
  // atribuição individual por linha do Gantt.
  const { data: memberRows } = await supabase
    .from('project_team_members')
    .select('team_id')
    .eq('person_id', personId)
    .is('removed_at', null);
  const teamIds = (memberRows ?? []).map((r) => (r as { team_id: string }).team_id);

  const { data: teamItemRows } = teamIds.length
    ? await supabase
        .from('project_timeline_team_assignments')
        .select('timeline_item_id, team_id, project_teams:team_id ( name )')
        .in('team_id', teamIds)
        .is('removed_at', null)
    : { data: [] as unknown[] };

  const teamItemsByPerson = new Map<string, Set<string>>();
  const teamNameByItem = new Map<string, string>();
  const teamItemIds = new Set<string>();
  for (const row of (teamItemRows ?? []) as Record<string, unknown>[]) {
    const itemId = row.timeline_item_id as string;
    teamItemIds.add(itemId);
    const name = (row.project_teams as { name?: string } | null)?.name;
    if (name) teamNameByItem.set(itemId, name);
  }
  if (teamItemIds.size > 0) teamItemsByPerson.set(personId, teamItemIds);

  // Resolve por projeto e fica com o contexto de maior confiança.
  let best: ReturnType<typeof resolveExecutionContext> | null = null;
  for (const projectId of projectIds) {
    const { data: itemRows } = await supabase
      .from('project_timeline_items')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .is('deleted_at', null);

    const items = (itemRows ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id, projectId: r.project_id, parentId: r.parent_id, wbsCode: r.wbs_code,
        title: r.title, status: r.status, isSummary: r.is_summary, isMilestone: r.is_milestone,
        isActive: r.is_active, deletedAt: null, percentComplete: Number(r.percent_complete ?? 0),
        plannedStart: r.planned_start, plannedFinish: r.planned_finish,
        actualStart: r.actual_start, actualFinish: r.actual_finish,
        forecastFinish: r.forecast_finish, durationMinutes: r.duration_minutes,
        responsibleUserId: r.responsible_user_id, assignments: [],
      } as unknown as TimelineItem;
    });

    const matches = matchAll(sortEvidence(evidence), {
      projectId, items, allocations, geofences, teamItemsByPerson, teamNameByItem,
    });
    const resolved = resolveExecutionContext({ personId, items, evidence, matches, now });
    if (!best || (resolved.confidence ?? 0) > (best.confidence ?? 0)) best = resolved;
  }

  if (!best) {
    return json({
      status: 'NO_EVIDENCE', project: null, phase: null, activity: null,
      team: null, confidence: null, reasonCodes: [], candidates: [],
    });
  }

  return json({
    status: best.status,
    project: best.projectId,
    phase: best.phaseTitle,
    activity: best.timelineItemTitle,
    activityId: best.timelineItemId,
    team: best.teamName,
    confidence: best.confidence,
    reasonCodes: best.reasonCodes,
    lastEvidenceAt: best.lastEvidenceAt,
    candidates: best.candidates,
  });
}
