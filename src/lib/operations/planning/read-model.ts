/**
 * READ MODELS do Planejamento — requisitos, prontidão por atividade,
 * exceções de plano e necessidades por data. Tudo derivado; nada gravado.
 *
 * Lidos pelo cliente autenticado: `project_requirements` e o cronograma têm
 * RLS própria. A cobertura de material vem do Supply (`coverageFor`) quando
 * existir alocação; sem ela, o material está — de verdade — sem cobertura.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/planning/read-model.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '../project-identity';
import { daysBetween, isCriticalActivity } from '../overview-rules';
import {
  criticalReasons, dimensionOf, needByOf, planningConstraints, requirementReadiness, worstReadiness,
  type Coverage, type PlanningConstraint, type Readiness, type ReadinessDimension, type RequirementStatus,
  type RequirementType,
} from './readiness';

type Session = { supabase: SupabaseClient; organizationId: string };

export interface RequirementRow {
  id: string; project_id: string; activity_id: string | null; requirement_type: RequirementType; title: string;
  description: string | null; quantity: string | null; unit: string | null; resource_label: string | null;
  required_by: string | null; delivery_location_label: string | null; priority: string; constraints_note: string | null;
  source: string; service_order_id: string | null; service_order_item_id: string | null; item_id: string | null;
  ai_model: string | null; status: RequirementStatus; confirmed_at: string | null; confirmed_by: string | null;
  cancellation_reason: string | null; superseded_by_id: string | null;
  satisfied_at: string | null; satisfied_by: string | null; satisfaction_note: string | null;
  created_at: string; updated_at: string;
}

const REQ_COLUMNS = 'id,project_id,activity_id,requirement_type,title,description,quantity,unit,resource_label,required_by,'
  + 'delivery_location_label,priority,constraints_note,source,service_order_id,service_order_item_id,item_id,ai_model,status,'
  + 'confirmed_at,confirmed_by,cancellation_reason,superseded_by_id,satisfied_at,satisfied_by,satisfaction_note,created_at,updated_at';

/**
 * Cobertura por requisito. Ponto único que o Supply (232+) preenche; até lá,
 * nenhum requisito tem alocação e a resposta honesta é "nada coberto".
 */
export type CoverageLoader = (session: Session, requirementIds: string[]) => Promise<Map<string, Coverage>>;
export const noCoverage: CoverageLoader = async () => new Map();

export interface EnrichedRequirement extends RequirementRow {
  readiness: Readiness | null;
  coverage: Coverage | null;
  activityTitle: string | null;
  activityStart: string | null;
  /** Data em que a frente PRECISA: a menor entre a data declarada e o início da atividade. */
  needBy: string | null;
  daysToNeed: number | null;
  constraints: PlanningConstraint[];
}

function enrich(rows: RequirementRow[], activities: Map<string, { title: string; planned_start: string | null }>,
  coverage: Map<string, Coverage>, today: string): EnrichedRequirement[] {
  return rows.map((r) => {
    const cov = coverage.get(r.id) ?? null;
    const readiness = requirementReadiness(r, today, cov);
    const act = r.activity_id ? activities.get(r.activity_id) ?? null : null;
    const needBy = needByOf(r.required_by, act?.planned_start ?? null);
    return { ...r, readiness, coverage: cov, activityTitle: act?.title ?? null, activityStart: act?.planned_start ?? null,
      needBy, daysToNeed: needBy ? daysBetween(today, needBy) : null,
      constraints: planningConstraints(r, act, today, readiness, daysBetween) };
  });
}

type ActivityRow = { id: string; project_id: string; title: string; wbs_code: string | null; planned_start: string | null;
  planned_finish: string | null; actual_finish: string | null; status: string; priority: string; delay_status: string;
  is_milestone: boolean; is_summary: boolean; percent_complete: number | null };

/** Horizonte das frentes: o que começa nos próximos dias entra mesmo sem requisito — é aí que falta planejar. */
export const FRONT_HORIZON_DAYS = 30;

/** Planejamento de UM projeto: requisitos, atividades para vincular, OS importáveis e prontidão por atividade. */
export async function projectPlanning(session: Session, projectId: string, today: string, loadCoverage: CoverageLoader = noCoverage) {
  const org = session.organizationId;
  const sb = session.supabase;
  const [reqs, acts, orders] = await Promise.all([
    sb.from('project_requirements').select(REQ_COLUMNS).eq('organization_id', org).eq('project_id', projectId)
      .order('required_by', { ascending: true, nullsFirst: false }),
    sb.from('project_timeline_items').select('id,title,wbs_code,planned_start,planned_finish,is_summary,is_milestone,status')
      .eq('organization_id', org).eq('project_id', projectId).eq('is_active', true).is('deleted_at', null)
      .order('row_order').limit(3000),
    sb.from('internal_service_orders').select('id,os_number,title,status').eq('organization_id', org).eq('project_id', projectId),
  ]);
  if (reqs.error) throw new Error('Não foi possível consultar os requisitos.');
  const rows = (reqs.data ?? []) as unknown as RequirementRow[];
  const activityRows = (acts.data ?? []) as Array<{ id: string; title: string; wbs_code: string | null; planned_start: string | null;
    planned_finish: string | null; is_summary: boolean; is_milestone: boolean; status: string }>;
  const activities = new Map(activityRows.map((a) => [a.id, a]));
  const coverage = await loadCoverage(session, rows.map((r) => r.id));
  const enriched = enrich(rows, activities, coverage, today);
  const people = await resolveOwnerNames(org, [...rows.map((r) => r.confirmed_by), ...rows.map((r) => r.satisfied_by)]);

  const byActivity = new Map<string, Partial<Record<ReadinessDimension, Readiness>>>();
  for (const r of enriched) {
    if (!r.activity_id || !r.readiness) continue;
    const cell = byActivity.get(r.activity_id) ?? {};
    const d = dimensionOf(r.requirement_type);
    cell[d] = worstReadiness([cell[d] ?? null, r.readiness]) ?? undefined;
    byActivity.set(r.activity_id, cell);
  }

  return {
    today,
    requirements: enriched.map((r) => ({ ...r,
      confirmedByName: r.confirmed_by ? people[r.confirmed_by] ?? null : null,
      satisfiedByName: r.satisfied_by ? people[r.satisfied_by] ?? null : null })),
    activities: activityRows.filter((a) => !a.is_summary).map((a) => ({ id: a.id, title: a.title, wbs: a.wbs_code,
      start: a.planned_start, finish: a.planned_finish, milestone: a.is_milestone })),
    readinessByActivity: Array.from(byActivity.entries()).map(([activityId, cells]) => ({
      activityId, title: activities.get(activityId)?.title ?? 'Atividade', start: activities.get(activityId)?.planned_start ?? null,
      cells, overall: worstReadiness(Object.values(cells)) })),
    serviceOrders: ((orders.data ?? []) as Array<{ id: string; os_number: string; title: string; status: string }>)
      .filter((o) => ['ISSUED', 'IN_EXECUTION', 'SUSPENDED'].includes(o.status)),
  };
}

export type ProjectPlanningModel = Awaited<ReturnType<typeof projectPlanning>>;

/** Planejamento do PORTFÓLIO: necessidades por data e exceções de plano. */
export async function portfolioPlanning(session: Session, today: string, loadCoverage: CoverageLoader = noCoverage) {
  const org = session.organizationId;
  const sb = session.supabase;
  // Requisitos vivos e as atividades abertas (folhas) do cronograma canônico — o mesmo recorte da Visão Geral.
  const [{ data, error }, openActs] = await Promise.all([
    sb.from('project_requirements').select(REQ_COLUMNS)
      .eq('organization_id', org).in('status', ['PLANNED', 'CONFIRMED']).order('required_by', { ascending: true, nullsFirst: false })
      .limit(3000),
    sb.from('project_timeline_items')
      .select('id,project_id,title,wbs_code,planned_start,planned_finish,actual_finish,status,priority,delay_status,is_milestone,is_summary,percent_complete')
      .eq('organization_id', org).eq('is_active', true).is('deleted_at', null).eq('is_summary', false)
      .not('status', 'in', '(completed,cancelled)').limit(5000),
  ]);
  if (error) throw new Error('Não foi possível consultar os requisitos.');
  if (openActs.error) throw new Error('Não foi possível consultar o cronograma.');
  const rows = (data ?? []) as unknown as RequirementRow[];
  const openActivities = (openActs.data ?? []) as unknown as ActivityRow[];
  const openById = new Map(openActivities.map((a) => [a.id, a]));
  // Requisito pode pender de atividade já concluída: busca só as que faltam.
  const missingIds = Array.from(new Set(rows.map((r) => r.activity_id).filter((id): id is string => Boolean(id) && !openById.has(id!))));
  const closedActs = missingIds.length
    ? ((await sb.from('project_timeline_items').select('id,title,planned_start').eq('organization_id', org).in('id', missingIds)).data ?? []) as
      Array<{ id: string; title: string; planned_start: string | null }>
    : [];
  const activities = new Map<string, { title: string; planned_start: string | null }>([
    ...openActivities.map((a) => [a.id, a] as const), ...closedActs.map((a) => [a.id, a] as const)]);

  const liveByActivity = new Map<string, RequirementRow[]>();
  for (const r of rows) if (r.activity_id) liveByActivity.set(r.activity_id, [...(liveByActivity.get(r.activity_id) ?? []), r]);
  const horizonEnd = new Date(Date.parse(`${today}T12:00:00Z`) + FRONT_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const frontActivities = openActivities.filter((a) => liveByActivity.has(a.id) || isCriticalActivity(a, today)
    || (a.planned_start !== null && a.planned_start >= today && a.planned_start <= horizonEnd));

  const projectIds = Array.from(new Set([...rows.map((r) => r.project_id), ...frontActivities.map((a) => a.project_id),
    ...openActivities.filter((a) => isCriticalActivity(a, today)).map((a) => a.project_id)]));
  const projects = projectIds.length
    ? await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', projectIds)
    : { data: [] };
  const projectMap = new Map(((projects.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2)]));
  const coverage = await loadCoverage(session, rows.map((r) => r.id));
  const enriched = enrich(rows, activities, coverage, today).map((r) => ({ ...r,
    project: projectMap.get(r.project_id)?.name ?? r.project_id, client: projectMap.get(r.project_id)?.client ?? null }));
  const enrichedById = new Map(enriched.map((r) => [r.id, r]));

  // FRENTES: atividade → requisitos → prontidão por dimensão. O pior requisito decide a frente.
  const fronts = frontActivities.map((a) => {
    const reqs = (liveByActivity.get(a.id) ?? []).map((r) => enrichedById.get(r.id)!).filter(Boolean);
    const cells: Partial<Record<ReadinessDimension, Readiness>> = {};
    for (const r of reqs) {
      if (!r.readiness) continue;
      const d = dimensionOf(r.requirement_type);
      cells[d] = worstReadiness([cells[d] ?? null, r.readiness]) ?? undefined;
    }
    const needs = reqs.map((r) => r.needBy).filter((d): d is string => Boolean(d)).sort();
    return {
      activityId: a.id, projectId: a.project_id, project: projectMap.get(a.project_id)?.name ?? a.project_id,
      client: projectMap.get(a.project_id)?.client ?? null, title: a.title, wbs: a.wbs_code, start: a.planned_start,
      finish: a.planned_finish, status: a.status, percent: a.percent_complete, milestone: a.is_milestone,
      started: a.status === 'in_progress' || (a.planned_start !== null && a.planned_start < today),
      daysToStart: a.planned_start ? daysBetween(today, a.planned_start) : null,
      critical: isCriticalActivity(a, today), criticalReasons: criticalReasons(a, today),
      requirementIds: reqs.map((r) => r.id), cells, overall: worstReadiness(Object.values(cells)),
      firstNeed: needs[0] ?? null, constraints: reqs.reduce((n, r) => n + r.constraints.length, 0),
    };
  }).sort((x, y) => (x.start ?? '9999').localeCompare(y.start ?? '9999'));

  const matrix = Array.from(new Set(enriched.map((r) => r.project_id))).map((pid) => {
    const mine = enriched.filter((r) => r.project_id === pid);
    const cells: Partial<Record<ReadinessDimension, Readiness>> = {};
    for (const r of mine) { const d = dimensionOf(r.requirement_type); cells[d] = worstReadiness([cells[d] ?? null, r.readiness]) ?? undefined; }
    return { projectId: pid, project: mine[0].project, client: mine[0].client, cells, overall: worstReadiness(Object.values(cells)),
      open: mine.length };
  });

  return {
    today,
    requirements: enriched,
    fronts,
    /** Mesma contagem da Visão Geral ("Atividades críticas"): folhas abertas com prioridade crítica, atraso ou término vencido. */
    criticalActivities: openActivities.filter((a) => isCriticalActivity(a, today)).length,
    constraints: enriched.flatMap((r) => r.constraints.map((c) => ({ ...c, requirementId: r.id, projectId: r.project_id, project: r.project,
      requirement: r.title, activity: r.activityTitle, needBy: r.needBy })))
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : b.severity === 'danger' ? 1 : a.severity === 'warning' ? -1 : 1)),
    matrix,
  };
}

export type PortfolioPlanningModel = Awaited<ReturnType<typeof portfolioPlanning>>;
