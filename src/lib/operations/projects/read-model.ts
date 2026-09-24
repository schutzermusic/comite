/**
 * PROJETO 360 — visão geral e timeline do projeto como VISÕES sobre domínios
 * canônicos. Nada aqui é gravado e nada é copiado para o projeto: cronograma,
 * medição, risco, equipe, OS e documentos continuam donos dos seus dados.
 *
 * Leituras do próprio projeto passam pelo cliente AUTENTICADO (RLS). A
 * história comercial e os fatos de domínio (sem leitura de navegador) vêm do
 * service role, sempre filtrados pela organização ativa e pelo projeto, e só
 * quando a pessoa tem alçada para vê-los.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/projects/read-model.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { platformServiceClient } from '@/lib/platform/server-client';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import type { MeasurementStatus } from '@/lib/projects/measurements/types';
import { MEASUREMENT_STATUS_LABEL } from '@/lib/projects/measurements/types';
import { projectIdentity } from '../project-identity';
import {
  isCriticalActivity, isMaterialOpenRisk, isOperationalMeasurementPending, isOverdueActivity, measurementLane,
  type ActivityLike, type MeasurementLane,
} from '../overview-rules';
import { countsFor } from '../service-orders/read-model';
import { serviceOrderNextAction } from '../service-orders/next-action';
import { deriveProjectHealth, physicalProgress } from './health';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import {
  domainEventTitle, measurementTone, measurementTransitionTitle, mergeTimeline, type ProjectTimelineEvent,
} from './timeline';

type Session = { supabase: SupabaseClient; organizationId: string };

export interface ProjectAccess {
  measurements: boolean;
  risks: boolean;
  financials: boolean;
  commercial: boolean;
  team: boolean;
}

type Activity = ActivityLike & {
  id: string; title: string; type: string; actual_start: string | null; percent_complete: number | null;
  duration_minutes: number | null; responsible_user_id: string | null; wbs_code: string | null;
};

export async function projectOverview(session: Session, projectId: string, access: ProjectAccess, today: string) {
  const org = session.organizationId;
  const sb = session.supabase;
  const { data: project } = await sb.from('projects').select('id,project,project_v2,responsible_person_id')
    .eq('organization_id', org).eq('id', projectId).maybeSingle();
  if (!project) return null;
  const identity = projectIdentity(project.id, project.project, project.project_v2);

  const [activitiesRes, measurementsRes, risksRes, ordersRes, allocationsRes, coverageRes, dependenciesRes] = await Promise.all([
    sb.from('project_timeline_items')
      .select('id,title,type,status,priority,delay_status,is_milestone,is_summary,planned_start,planned_finish,'
        + 'actual_start,actual_finish,percent_complete,duration_minutes,responsible_user_id,wbs_code')
      .eq('organization_id', org).eq('project_id', projectId).eq('is_active', true).is('deleted_at', null).limit(3000),
    access.measurements ? sb.from('project_measurements')
      .select('id,status,expected_at,occurrence_key,measured_value,accepted_value,currency,customer_due_at')
      .eq('organization_id', org).eq('project_id', projectId).not('status', 'in', '(CANCELLED,SUPERSEDED)')
      : Promise.resolve({ data: [] }),
    access.risks ? sb.from('risks').select('id,title,severity,status,responsible_id,due_date')
      .eq('organization_id', org).eq('reference_id', projectId).in('status', ['open', 'mitigating'])
      : Promise.resolve({ data: [] }),
    sb.from('internal_service_orders').select('id,engagement_id,os_number,title,status,project_id,issued_at')
      .eq('organization_id', org).eq('project_id', projectId),
    access.team ? sb.from('project_allocations').select('id,person_id,role_title,status,start_date,end_date,planned_percentage')
      .eq('organization_id', org).eq('project_id', projectId).in('status', ['active', 'pending_approval'])
      : Promise.resolve({ data: [], error: null }),
    // Material e cliente entram na saúde — a MESMA leitura da Visão Geral e do mapa (visão derivada do Supply; RLS dos requisitos).
    sb.from('supply_requirement_coverage').select('*').eq('organization_id', org).eq('project_id', projectId),
    sb.from('project_requirements').select('id,required_by').eq('organization_id', org).eq('project_id', projectId)
      .eq('requirement_type', 'CUSTOMER_DEPENDENCY').eq('status', 'CONFIRMED').is('satisfied_at', null),
  ]);

  const activities = (activitiesRes.data ?? []) as unknown as Activity[];
  const measurements = (measurementsRes.data ?? []) as Array<{ id: string; status: MeasurementStatus; expected_at: string | null;
    occurrence_key: string; measured_value: string | null; accepted_value: string | null; currency: string | null;
    customer_due_at: string | null }>;
  const risks = (risksRes.data ?? []) as Array<{ id: string; title: string; severity: string; status: string;
    responsible_id: string | null; due_date: string | null }>;
  const orders = (ordersRes.data ?? []) as Array<{ id: string; engagement_id: string; os_number: string; title: string;
    status: import('@/lib/commercial/types').ServiceOrderStatus; project_id: string | null; issued_at: string | null }>;
  const allocations = (allocationsRes.data ?? []) as Array<{ id: string; person_id: string; role_title: string | null;
    status: string; start_date: string; end_date: string | null; planned_percentage: number }>;

  const counts = await countsFor(org, orders);
  const open = activities.filter((a) => a.status !== 'completed' && a.status !== 'cancelled' && !a.actual_finish && !a.is_summary);
  const critical = open.filter((a) => isCriticalActivity(a, today));
  const overdue = open.filter((a) => isOverdueActivity(a, today));
  const blocked = open.filter((a) => a.delay_status === 'blocked' || a.status === 'blocked');
  const materialRisks = risks.filter(isMaterialOpenRisk);

  const soon = new Date(Date.parse(`${today}T12:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const shortages = ((coverageRes.data ?? []) as CoverageViewRow[]).filter((r) => fromViewRow(r).shortage > 0);
  const nearShort = shortages.filter((r) => r.required_by && r.required_by <= soon).length;
  const customerOverdue = ((dependenciesRes.data ?? []) as Array<{ required_by: string | null }>)
    .filter((d) => d.required_by && d.required_by < today).length;
  const health = deriveProjectHealth({
    materialShortNearNeed: nearShort, materialShort: shortages.length - nearShort, customerDependenciesOverdue: customerOverdue,
    openActivities: open.length, criticalActivities: critical.length, overdueActivities: overdue.length,
    blockedActivities: blocked.length,
    serviceOrdersBlocked: orders.filter((o) => (counts.get(o.id)?.blockingOpen ?? 0) > 0
      && (o.status === 'DRAFT' || o.status === 'PENDING_CONFIRMATION')).length,
    measurementsInCorrection: measurements.filter((m) => measurementLane(m.status) === 'CORRECTION').length,
    measurementsOverdue: measurements.filter((m) => m.status === 'PLANNED' && m.expected_at !== null && m.expected_at < today).length,
    criticalRisks: risks.filter((r) => r.severity === 'critical').length,
    highRisks: risks.filter((r) => r.severity === 'high').length,
    risksWithoutOwner: materialRisks.filter((r) => !r.responsible_id).length,
  }, activities.length > 0);

  const upcoming = activities
    .filter((a) => (a.is_milestone || a.type === 'milestone') && !a.actual_finish && a.status !== 'completed'
      && a.planned_finish && a.planned_finish >= today)
    .sort((a, b) => (a.planned_finish ?? '').localeCompare(b.planned_finish ?? '')).slice(0, 4);
  const nextActivities = open
    .filter((a) => (a.planned_start ?? a.planned_finish ?? '') >= today)
    .sort((a, b) => (a.planned_start ?? a.planned_finish ?? '').localeCompare(b.planned_start ?? b.planned_finish ?? ''))
    .slice(0, 5);

  const lanes: Partial<Record<MeasurementLane, number>> = {};
  for (const m of measurements) { const l = measurementLane(m.status); lanes[l] = (lanes[l] ?? 0) + 1; }
  const nextMeasurement = measurements
    .filter((m) => m.status === 'PLANNED' || m.status === 'IN_PREPARATION' || m.status === 'READY_FOR_SUBMISSION')
    .sort((a, b) => (a.expected_at ?? '9999').localeCompare(b.expected_at ?? '9999'))[0] ?? null;

  const people = await resolveOwnerNames(org, [
    ...critical.map((a) => a.responsible_user_id), ...risks.map((r) => r.responsible_id)]);
  const { data: personRows } = allocations.length
    ? await platformServiceClient().from('people').select('id,full_name').eq('organization_id', org)
        .in('id', Array.from(new Set(allocations.map((a) => a.person_id))))
    : { data: [] as Array<{ id: string; full_name: string }> };
  const personName = new Map((personRows ?? []).map((p) => [p.id, p.full_name]));

  // Financeiro: só com a MESMA decisão que mascara valores no cronograma (183).
  let financial: null | { currency: string; accepted: number; inFlight: number } = null;
  if (access.financials && access.measurements) {
    const currency = measurements.find((m) => m.currency)?.currency ?? 'BRL';
    const same = measurements.filter((m) => (m.currency ?? currency) === currency);
    financial = {
      currency,
      accepted: same.filter((m) => m.status === 'ACCEPTED').reduce((s, m) => s + Number(m.accepted_value ?? m.measured_value ?? 0), 0),
      inFlight: same.filter((m) => ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE'].includes(m.status))
        .reduce((s, m) => s + Number(m.measured_value ?? 0), 0),
    };
  }

  return {
    today,
    project: identity,
    health,
    progress: physicalProgress(activities),
    /** O período que o CRONOGRAMA diz — primeiro início e último término planejados das folhas. */
    span: (() => {
      const leaves = activities.filter((a) => !a.is_summary);
      const starts = leaves.map((a) => a.planned_start).filter((d): d is string => Boolean(d)).sort();
      const finishes = leaves.map((a) => a.planned_finish).filter((d): d is string => Boolean(d)).sort();
      return { start: starts[0] ?? null, finish: finishes[finishes.length - 1] ?? null };
    })(),
    schedule: {
      total: activities.filter((a) => !a.is_summary).length, open: open.length,
      critical: critical.length, overdue: overdue.length, blocked: blocked.length,
    },
    nextMilestones: upcoming.map((a) => ({ id: a.id, title: a.title, date: a.planned_finish, wbs: a.wbs_code })),
    nextActivities: nextActivities.map((a) => ({ id: a.id, title: a.title, start: a.planned_start, finish: a.planned_finish })),
    blockers: [
      ...critical.sort((a, b) => (a.planned_finish ?? '').localeCompare(b.planned_finish ?? '')).slice(0, 5).map((a) => ({
        id: `act:${a.id}`, kind: 'activity' as const, title: a.title,
        issue: a.delay_status === 'blocked' ? 'Bloqueada' : overdue.includes(a) ? 'Vencida' : a.priority === 'critical' ? 'Prioridade crítica' : 'Em atraso',
        due: a.planned_finish, owner: a.responsible_user_id ? people[a.responsible_user_id] ?? null : null,
        tone: (a.delay_status === 'blocked' || a.priority === 'critical') ? 'danger' as const : 'warning' as const,
      })),
      ...materialRisks.slice(0, 3).map((r) => ({
        id: `risk:${r.id}`, kind: 'risk' as const, title: r.title,
        issue: r.severity === 'critical' ? 'Risco crítico' : 'Risco alto', due: r.due_date?.slice(0, 10) ?? null,
        owner: r.responsible_id ? people[r.responsible_id] ?? null : null,
        tone: r.severity === 'critical' ? 'danger' as const : 'warning' as const,
      })),
    ],
    measurements: access.measurements ? {
      lanes, total: measurements.length,
      pending: measurements.filter((m) => isOperationalMeasurementPending(m.status, m.expected_at, today)).length,
      next: nextMeasurement ? { id: nextMeasurement.id, key: nextMeasurement.occurrence_key,
        expected: nextMeasurement.expected_at, status: MEASUREMENT_STATUS_LABEL[nextMeasurement.status] } : null,
    } : null,
    team: access.team ? {
      allocated: new Set(allocations.filter((a) => a.status === 'active').map((a) => a.person_id)).size,
      pending: allocations.filter((a) => a.status === 'pending_approval').length,
      people: allocations.filter((a) => a.status === 'active').slice(0, 6)
        .map((a) => ({ name: personName.get(a.person_id) ?? 'Pessoa', role: a.role_title, percent: Number(a.planned_percentage) })),
    } : null,
    serviceOrders: orders.map((o) => ({ id: o.id, osNumber: o.os_number, title: o.title, status: o.status,
      nextAction: serviceOrderNextAction(o.status, o.project_id, counts.get(o.id)!) })),
    financial,
  };
}

export type ProjectOverviewModel = NonNullable<Awaited<ReturnType<typeof projectOverview>>>;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
const COMMERCIAL_TRANSITIONS: Record<string, { title: string; kind: ProjectTimelineEvent['kind']; tone: ProjectTimelineEvent['tone'] }> = {
  authorized: { title: 'Trabalho autorizado', kind: 'authorization', tone: 'success' },
  authorization_attached: { title: 'Fonte de autorização anexada', kind: 'authorization', tone: 'neutral' },
  governing_source_changed: { title: 'Fonte regente trocada', kind: 'authorization', tone: 'warning' },
  execution_started: { title: 'Início de execução registrado', kind: 'authorization', tone: 'success' },
  execution_started_exceptionally: { title: 'Início excepcional registrado', kind: 'authorization', tone: 'warning' },
  service_order_generated_from_package: { title: 'OS gerada do pacote aceito', kind: 'service_order', tone: 'neutral' },
  service_order_issue_exception: { title: 'OS emitida sob exceção governada', kind: 'service_order', tone: 'warning' },
  divergence_resolved: { title: 'Divergência decidida', kind: 'service_order', tone: 'neutral' },
  project_created: { title: 'Projeto criado a partir da OS', kind: 'project', tone: 'accent' },
};

export async function projectTimeline(session: Session, projectId: string, access: ProjectAccess) {
  const org = session.organizationId;
  const sb = session.supabase;
  const svc = platformServiceClient();
  const { data: project } = await sb.from('projects').select('id').eq('organization_id', org).eq('id', projectId).maybeSingle();
  if (!project) return null;

  const [orders, links, measurementRows, delays, risks, allocations, files] = await Promise.all([
    sb.from('internal_service_orders').select('id,os_number').eq('organization_id', org).eq('project_id', projectId),
    access.commercial ? svc.from('engagement_project_links').select('engagement_id')
      .eq('organization_id', org).eq('project_id', projectId) : Promise.resolve({ data: [] }),
    access.measurements ? sb.from('project_measurements').select('id,occurrence_key')
      .eq('organization_id', org).eq('project_id', projectId) : Promise.resolve({ data: [] }),
    sb.from('project_delay_logs').select('id,timeline_item_id,reported_by,old_status,new_status,reason_text,new_forecast_finish,created_at')
      .eq('organization_id', org).eq('project_id', projectId).order('created_at', { ascending: false }).limit(100),
    access.risks ? sb.from('risks').select('id,title,severity,created_at,resolved_at,created_by')
      .eq('organization_id', org).eq('reference_id', projectId) : Promise.resolve({ data: [] }),
    access.team ? sb.from('project_allocations').select('id,person_id,role_title,status,created_at,created_by')
      .eq('organization_id', org).eq('project_id', projectId).limit(200) : Promise.resolve({ data: [] }),
    sb.from('project_files').select('id,file_name,document_type,created_at,created_by,measurement_id')
      .eq('organization_id', org).eq('project_id', projectId).order('created_at', { ascending: false }).limit(100),
  ]);

  const orderRows = (orders.data ?? []) as Array<{ id: string; os_number: string }>;
  const osNumber = new Map(orderRows.map((o) => [o.id, o.os_number]));
  const engagementIds = Array.from(new Set(((links.data ?? []) as Array<{ engagement_id: string }>).map((l) => l.engagement_id)));
  const measurementKey = new Map(((measurementRows.data ?? []) as Array<{ id: string; occurrence_key: string }>)
    .map((m) => [m.id, m.occurrence_key]));

  const [history, domainEvents, measurementHistory] = await Promise.all([
    engagementIds.length ? svc.from('commercial_engagement_history')
      .select('id,transition,actor_user_id,note,provenance,occurred_at')
      .eq('organization_id', org).in('engagement_id', engagementIds).order('occurred_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    access.commercial ? svc.from('domain_events').select('id,event_type,aggregate_id,occurred_at,actor_user_id,payload')
      .eq('organization_id', org)
      .or([orderRows.length ? `aggregate_id.in.(${orderRows.map((o) => o.id).join(',')})` : null,
        `payload->>project_id.eq.${projectId.replace(/[^A-Za-z0-9._-]/g, '')}`].filter(Boolean).join(','))
      .order('occurred_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    measurementKey.size ? sb.from('project_measurement_history')
      .select('id,measurement_id,from_state,to_state,transition,reason,actor_user_id,occurred_at')
      .eq('organization_id', org).in('measurement_id', Array.from(measurementKey.keys()))
      .order('occurred_at', { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
  ]);

  const actors = await resolveOwnerNames(org, [
    ...((history.data ?? []) as Array<{ actor_user_id: string | null }>).map((h) => h.actor_user_id),
    ...((domainEvents.data ?? []) as Array<{ actor_user_id: string | null }>).map((e) => e.actor_user_id),
    ...((measurementHistory.data ?? []) as Array<{ actor_user_id: string | null }>).map((h) => h.actor_user_id),
    ...((delays.data ?? []) as Array<{ reported_by: string | null }>).map((d) => d.reported_by),
    ...((risks.data ?? []) as Array<{ created_by: string | null }>).map((r) => r.created_by),
    ...((files.data ?? []) as Array<{ created_by: string | null }>).map((f) => f.created_by),
  ]);
  const who = (id: string | null | undefined) => (id ? actors[id] ?? null : null);
  const pid = encodeURIComponent(projectId);
  const events: ProjectTimelineEvent[] = [];

  for (const e of (domainEvents.data ?? []) as Array<{ id: string; event_type: string; aggregate_id: string; occurred_at: string;
    actor_user_id: string | null; payload: Record<string, unknown> }>) {
    const meta = domainEventTitle(e.event_type);
    const number = osNumber.get(e.aggregate_id) ?? (e.payload?.os_number as string | undefined);
    events.push({ id: `de:${e.id}`, at: e.occurred_at, kind: meta.kind, title: meta.title,
      detail: number ? `OS ${number}` : null, actor: who(e.actor_user_id), tone: meta.tone,
      href: osNumber.has(e.aggregate_id) ? `/operacoes/ordens-servico/${e.aggregate_id}` : null });
  }
  for (const h of (history.data ?? []) as Array<{ id: string; transition: string; actor_user_id: string | null; note: string | null;
    provenance: Record<string, unknown> | null; occurred_at: string }>) {
    const meta = COMMERCIAL_TRANSITIONS[h.transition];
    if (!meta) continue;
    const soId = h.provenance?.service_order_id as string | undefined;
    events.push({ id: `ceh:${h.id}`, at: h.occurred_at, kind: meta.kind, title: meta.title,
      detail: h.note ?? (soId && osNumber.get(soId) ? `OS ${osNumber.get(soId)}` : null),
      actor: who(h.actor_user_id), tone: meta.tone,
      href: soId && osNumber.has(soId) ? `/operacoes/ordens-servico/${soId}` : null });
  }
  for (const m of (measurementHistory.data ?? []) as Array<{ id: string; measurement_id: string; to_state: string | null;
    reason: string | null; actor_user_id: string | null; occurred_at: string }>) {
    events.push({ id: `pmh:${m.id}`, at: m.occurred_at, kind: 'measurement', title: measurementTransitionTitle(m.to_state),
      detail: [measurementKey.get(m.measurement_id), m.reason].filter(Boolean).join(' — ') || null,
      actor: who(m.actor_user_id), tone: measurementTone(m.to_state), href: `/projetos/${pid}?tab=measurements` });
  }
  for (const d of (delays.data ?? []) as Array<{ id: string; reported_by: string | null; new_status: string | null;
    reason_text: string | null; new_forecast_finish: string | null; created_at: string }>) {
    events.push({ id: `delay:${d.id}`, at: d.created_at, kind: 'schedule',
      title: d.new_status === 'blocked' ? 'Atividade bloqueada' : d.new_status === 'on_track' ? 'Atividade normalizada' : 'Atraso registrado',
      detail: [d.reason_text, d.new_forecast_finish ? `nova previsão ${d.new_forecast_finish}` : null].filter(Boolean).join(' · ') || null,
      actor: who(d.reported_by), tone: d.new_status === 'on_track' ? 'success' : d.new_status === 'blocked' ? 'danger' : 'warning',
      href: `/projetos/${pid}?tab=timeline` });
  }
  for (const r of (risks.data ?? []) as Array<{ id: string; title: string; severity: string; created_at: string;
    resolved_at: string | null; created_by: string | null }>) {
    events.push({ id: `risk:${r.id}`, at: r.created_at, kind: 'risk', title: 'Risco registrado', detail: r.title,
      actor: who(r.created_by), tone: r.severity === 'critical' || r.severity === 'high' ? 'danger' : 'warning',
      href: `/projetos/${pid}?tab=risks` });
    if (r.resolved_at) events.push({ id: `risk-res:${r.id}`, at: r.resolved_at, kind: 'risk', title: 'Risco resolvido',
      detail: r.title, actor: null, tone: 'success', href: `/projetos/${pid}?tab=risks` });
  }
  for (const a of (allocations.data ?? []) as Array<{ id: string; role_title: string | null; status: string; created_at: string }>) {
    events.push({ id: `alloc:${a.id}`, at: a.created_at, kind: 'team', title: 'Alocação de equipe',
      detail: a.role_title, actor: null, tone: 'neutral', href: `/projetos/${pid}?tab=team` });
  }
  for (const f of (files.data ?? []) as Array<{ id: string; file_name: string; document_type: string | null; created_at: string;
    created_by: string | null; measurement_id: string | null }>) {
    events.push({ id: `file:${f.id}`, at: f.created_at, kind: 'document',
      title: f.measurement_id ? 'Evidência de medição anexada' : 'Documento anexado', detail: f.file_name,
      actor: who(f.created_by), tone: 'neutral', href: `/projetos/${pid}?tab=documents` });
  }
  return mergeTimeline(events);
}
