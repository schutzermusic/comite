/**
 * READ MODEL da Visão Geral de Operações — uma superfície de EXCEÇÃO.
 *
 * Tudo é lido pelo cliente AUTENTICADO: projeto, cronograma, medição e risco
 * têm RLS própria, e a Visão Geral não fura nenhuma. Quando a pessoa não tem
 * leitura de uma área, a seção volta `restricted` — e a tela diz "restrito",
 * nunca "0", porque zero seria uma afirmação falsa sobre a operação.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/overview.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MeasurementStatus } from '@/lib/projects/measurements/types';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity, isActiveProjectStatus } from './project-identity';
import {
  horizonOf, isCriticalActivity, isMaterialOpenRisk, isOperationalMeasurementPending, isOverdueActivity,
  measurementLane, projectAtRisk, type ActivityLike, type Horizon, type MeasurementLane,
} from './overview-rules';
import { listServiceOrders } from './service-orders/read-model';
import { serviceOrderNextAction } from './service-orders/next-action';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

type Session = { supabase: SupabaseClient; organizationId: string };

export interface AttentionItem {
  id: string;
  kind: 'service_order' | 'activity' | 'measurement' | 'risk' | 'material' | 'dependency';
  object: string;
  issue: string;
  impact: string | null;
  due: string | null;
  owner: string | null;
  tone: 'danger' | 'warning' | 'accent';
  href: string;
  actionLabel: string;
}

export interface OverviewAccess { projects: boolean; measurements: boolean; risks: boolean }

type ActivityRow = ActivityLike & {
  id: string; project_id: string; title: string; type: string; actual_start: string | null;
  responsible_user_id: string | null; percent_complete: number | null; wbs_code: string | null;
};

export async function operationsOverview(session: Session, access: OverviewAccess, today: string) {
  const org = session.organizationId;
  const sb = session.supabase;

  const [serviceOrders, projectsRes, activitiesRes, measurementsRes, risksRes, locationsRes, coverageRes, dependenciesRes] = await Promise.all([
    listServiceOrders(session),
    access.projects ? sb.from('projects').select('id,project,project_v2').eq('organization_id', org)
      : Promise.resolve({ data: [] }),
    access.projects ? sb.from('project_timeline_items')
      .select('id,project_id,title,type,status,priority,delay_status,is_milestone,is_summary,planned_start,'
        + 'planned_finish,actual_start,actual_finish,responsible_user_id,percent_complete,wbs_code')
      .eq('organization_id', org).eq('is_active', true).is('deleted_at', null)
      .not('status', 'in', '(completed,cancelled)').limit(5000)
      : Promise.resolve({ data: [] }),
    access.measurements ? sb.from('project_measurements')
      .select('id,project_id,status,expected_at,occurrence_key,measured_value,currency,customer_due_at')
      .eq('organization_id', org).not('status', 'in', '(CANCELLED,SUPERSEDED,REJECTED)').limit(5000)
      : Promise.resolve({ data: [] }),
    access.risks ? sb.from('risks')
      .select('id,title,severity,status,responsible_id,reference_id,origin,due_date')
      .eq('organization_id', org).in('status', ['open', 'mitigating']).limit(2000)
      : Promise.resolve({ data: [] }),
    access.projects ? sb.from('project_canonical_location').select('project_id,resolution_state')
      .eq('organization_id', org).is('superseded_at', null)
      : Promise.resolve({ data: [] }),
    // Demanda de material sem cobertura: a visão derivada do Supply (RLS dos requisitos).
    access.projects ? sb.from('supply_requirement_coverage').select('*').eq('organization_id', org)
      : Promise.resolve({ data: [] }),
    // Dependências do cliente confirmadas e ainda não atendidas (o requisito canônico do Planejamento).
    access.projects ? sb.from('project_requirements').select('id,project_id,title,required_by')
      .eq('organization_id', org).eq('requirement_type', 'CUSTOMER_DEPENDENCY').eq('status', 'CONFIRMED')
      .is('satisfied_at', null).limit(2000)
      : Promise.resolve({ data: [] }),
  ]);

  const projects = new Map<string, ReturnType<typeof projectIdentity>>();
  for (const p of (projectsRes.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>) {
    projects.set(p.id, projectIdentity(p.id, p.project, p.project_v2));
  }
  const activities = (activitiesRes.data ?? []) as unknown as ActivityRow[];
  const measurements = (measurementsRes.data ?? []) as Array<{ id: string; project_id: string; status: MeasurementStatus;
    expected_at: string | null; occurrence_key: string; customer_due_at: string | null }>;
  const risks = (risksRes.data ?? []) as Array<{ id: string; title: string; severity: string; status: string;
    responsible_id: string | null; reference_id: string | null; origin: string; due_date: string | null }>;

  // ── Projetos ativos e em risco ──────────────────────────────────────────
  const activeProjects = Array.from(projects.values()).filter((p) => isActiveProjectStatus(p.status));
  const criticalByProject = new Map<string, number>();
  for (const a of activities) {
    if (isCriticalActivity(a, today)) criticalByProject.set(a.project_id, (criticalByProject.get(a.project_id) ?? 0) + 1);
  }
  const riskByProject = new Map<string, number>();
  for (const r of risks) {
    if (r.reference_id && projects.has(r.reference_id) && isMaterialOpenRisk(r)) {
      riskByProject.set(r.reference_id, (riskByProject.get(r.reference_id) ?? 0) + 1);
    }
  }
  const projectsAtRisk = activeProjects.filter((p) =>
    projectAtRisk(criticalByProject.get(p.id) ?? 0, riskByProject.get(p.id) ?? 0));

  // ── Medições ────────────────────────────────────────────────────────────
  const lanes: Record<MeasurementLane, number> = {
    PREPARE_EVIDENCE: 0, INTERNAL_REVIEW: 0, CORRECTION: 0, SEND_TO_CUSTOMER: 0,
    AWAITING_CUSTOMER: 0, BILLING_ELIGIBLE: 0, CLOSED: 0,
  };
  for (const m of measurements) lanes[measurementLane(m.status)] += 1;
  const measurementPending = measurements.filter((m) => isOperationalMeasurementPending(m.status, m.expected_at, today));

  // ── OS ──────────────────────────────────────────────────────────────────
  const osAwaitingIssue = serviceOrders.filter((o) => o.status === 'DRAFT' || o.status === 'PENDING_CONFIRMATION');

  // ── Fila "O que precisa de decisão" ─────────────────────────────────────
  const owners = await resolveOwnerNames(org, [
    ...activities.map((a) => a.responsible_user_id), ...risks.map((r) => r.responsible_id)]);
  const attention: AttentionItem[] = [];
  for (const o of serviceOrders) {
    const next = serviceOrderNextAction(o.status, o.projectId, o.counts);
    if (!next.needsDecision) continue;
    attention.push({
      id: `os:${o.id}`, kind: 'service_order', object: o.osNumber,
      issue: next.label, impact: o.customer ? `${o.customer} · ${o.title}` : o.title,
      due: o.plannedStart, owner: o.ownerName, tone: next.tone === 'danger' ? 'danger' : next.tone === 'warning' ? 'warning' : 'accent',
      href: `/operacoes/ordens-servico/${o.id}`, actionLabel: 'Abrir OS',
    });
  }
  for (const a of activities.filter((x) => isOverdueActivity(x, today))
    .sort((x, y) => (x.planned_finish ?? '').localeCompare(y.planned_finish ?? '')).slice(0, 25)) {
    const p = projects.get(a.project_id);
    attention.push({
      id: `act:${a.id}`, kind: 'activity', object: a.title,
      issue: a.delay_status === 'blocked' ? 'Atividade bloqueada e vencida' : 'Atividade vencida em aberto',
      impact: p ? `${p.name}${a.wbs_code ? ` · WBS ${a.wbs_code}` : ''}` : null,
      due: a.planned_finish, owner: a.responsible_user_id ? owners[a.responsible_user_id] ?? null : null,
      tone: a.priority === 'critical' || a.delay_status === 'blocked' ? 'danger' : 'warning',
      href: `/projetos/${encodeURIComponent(a.project_id)}?tab=timeline`, actionLabel: 'Abrir cronograma',
    });
  }
  for (const m of measurements.filter((x) => x.status === 'RETURNED_FOR_CORRECTION' || x.status === 'CUSTOMER_CORRECTION_REQUESTED')) {
    const p = projects.get(m.project_id);
    attention.push({
      id: `meas:${m.id}`, kind: 'measurement', object: `Medição ${m.occurrence_key}`,
      issue: m.status === 'CUSTOMER_CORRECTION_REQUESTED' ? 'Cliente pediu correção' : 'Devolvida para correção',
      impact: p?.name ?? null, due: m.customer_due_at ?? m.expected_at, owner: null, tone: 'warning',
      href: `/projetos/${encodeURIComponent(m.project_id)}?tab=measurements`, actionLabel: 'Corrigir medição',
    });
  }
  for (const r of risks.filter((x) => isMaterialOpenRisk(x) && !x.responsible_id)) {
    const p = r.reference_id ? projects.get(r.reference_id) : undefined;
    attention.push({
      id: `risk:${r.id}`, kind: 'risk', object: r.title, issue: 'Risco material sem responsável',
      impact: p?.name ?? null, due: r.due_date?.slice(0, 10) ?? null, owner: null,
      tone: r.severity === 'critical' ? 'danger' : 'warning',
      href: p ? `/projetos/${encodeURIComponent(p.id)}?tab=risks` : '/riscos', actionLabel: 'Atribuir dono',
    });
  }
  // Material: demanda confirmada com falta, perto da necessidade (14 dias) ou já vencida.
  const coverageRows = ((coverageRes.data ?? []) as CoverageViewRow[]).map((r) => ({ row: r, cov: fromViewRow(r) }));
  const soon = addDays(today, 14);
  const shortages = coverageRows
    .filter(({ row, cov }) => cov.shortage > 0 && row.required_by && row.required_by <= soon)
    .sort((a, b) => String(a.row.required_by).localeCompare(String(b.row.required_by))).slice(0, 15);
  // O nome do material é o título do requisito canônico — só exibição; sem ele a linha segue válida.
  const requirementTitles = new Map<string, string>();
  if (shortages.length) {
    const { data } = await sb.from('project_requirements').select('id,title').eq('organization_id', org)
      .in('id', shortages.map((s) => s.row.requirement_id));
    for (const r of (data ?? []) as Array<{ id: string; title: string }>) requirementTitles.set(r.id, r.title);
  }
  for (const { row, cov } of shortages) {
    const p = projects.get(row.project_id);
    const missing = `Falta ${formatQty(cov.shortage)} ${row.unit ?? ''}`.trim();
    attention.push({
      id: `mat:${row.requirement_id}`, kind: 'material', object: requirementTitles.get(row.requirement_id) ?? 'Material do requisito',
      issue: cov.inbound > 0 ? `${missing} — a entrada não cobre` : `${missing} — sem estoque nem pedido`,
      impact: p?.name ?? null, due: row.required_by, owner: null,
      tone: row.required_by && row.required_by <= addDays(today, 7) ? 'danger' : 'warning',
      href: `/supply/planejamento-materiais?req=${row.requirement_id}`, actionLabel: 'Cobrir falta',
    });
  }
  const dependencies = (dependenciesRes.data ?? []) as Array<{ id: string; project_id: string; title: string; required_by: string | null }>;
  const overdueDependencies = dependencies.filter((d) => d.required_by && d.required_by < today);
  for (const d of overdueDependencies.slice(0, 15)) {
    const p = projects.get(d.project_id);
    attention.push({
      id: `dep:${d.id}`, kind: 'dependency', object: d.title, issue: 'Dependência do cliente vencida',
      impact: p?.name ?? null, due: d.required_by, owner: null, tone: 'danger',
      href: `/projetos/${encodeURIComponent(d.project_id)}?tab=timeline`, actionLabel: 'Cobrar cliente',
    });
  }

  const toneRank = { danger: 0, warning: 1, accent: 2 } as const;
  attention.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || (a.due ?? '9999').localeCompare(b.due ?? '9999'));

  // ── Horizonte de execução ───────────────────────────────────────────────
  const horizon: Record<Horizon, Array<{ id: string; title: string; project: string; projectId: string;
    date: string | null; milestone: boolean; critical: boolean }>> = { 7: [], 14: [], 30: [] };
  for (const a of activities) {
    const h = horizonOf(a, today);
    if (!h) continue;
    horizon[h].push({
      id: a.id, title: a.title, project: projects.get(a.project_id)?.name ?? a.project_id, projectId: a.project_id,
      date: (!a.actual_start && a.planned_start && a.planned_start >= today) ? a.planned_start : a.planned_finish,
      milestone: a.is_milestone, critical: isCriticalActivity(a, today),
    });
  }
  for (const k of [7, 14, 30] as Horizon[]) horizon[k].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));

  // ── Matriz de risco por projeto ─────────────────────────────────────────
  const osByProject = new Map<string, number>();
  for (const o of serviceOrders) if (o.projectId && o.counts.openDivergences > 0) {
    osByProject.set(o.projectId, (osByProject.get(o.projectId) ?? 0) + 1);
  }
  const measurementByProject = new Map<string, number>();
  for (const m of measurementPending) measurementByProject.set(m.project_id, (measurementByProject.get(m.project_id) ?? 0) + 1);
  const supplyByProject = new Map<string, number>();
  const nearShortByProject = new Map<string, number>();
  for (const { row, cov } of coverageRows) {
    if (cov.shortage <= 0) continue;
    supplyByProject.set(row.project_id, (supplyByProject.get(row.project_id) ?? 0) + 1);
    if (row.required_by && row.required_by <= soon) nearShortByProject.set(row.project_id, (nearShortByProject.get(row.project_id) ?? 0) + 1);
  }
  const customerByProject = new Map<string, number>();
  for (const d of overdueDependencies) customerByProject.set(d.project_id, (customerByProject.get(d.project_id) ?? 0) + 1);
  const riskMatrix = activeProjects.map((p) => ({
    projectId: p.id, project: p.name, client: p.client,
    schedule: criticalByProject.get(p.id) ?? 0,
    supply: supplyByProject.get(p.id) ?? 0,
    customer: customerByProject.get(p.id) ?? 0,
    measurement: measurementByProject.get(p.id) ?? 0,
    risk: riskByProject.get(p.id) ?? 0,
    contract: osByProject.get(p.id) ?? 0,
  })).filter((row) => row.schedule + row.supply + row.customer + row.measurement + row.risk + row.contract > 0)
    .sort((a, b) => (b.schedule * 2 + b.supply * 2 + b.customer * 2 + b.risk * 2 + b.measurement + b.contract)
      - (a.schedule * 2 + a.supply * 2 + a.customer * 2 + a.risk * 2 + a.measurement + a.contract));

  // Saúde por projeto ativo: a pior trava decide (mesma leitura para a lista e para o mapa).
  const nextMilestone = new Map<string, string>();
  for (const a of activities) {
    if (!a.is_milestone || !a.planned_finish || a.planned_finish < today) continue;
    const cur = nextMilestone.get(a.project_id);
    if (!cur || a.planned_finish < cur) nextMilestone.set(a.project_id, a.planned_finish);
  }
  const projectHealth = activeProjects.map((p) => {
    const critical = criticalByProject.get(p.id) ?? 0;
    const nearShort = nearShortByProject.get(p.id) ?? 0;
    const customer = customerByProject.get(p.id) ?? 0;
    const blockingOs = serviceOrders.filter((o) => o.projectId === p.id && o.counts.blockingOpen > 0).length;
    const tone: 'danger' | 'warning' | 'success' = critical + nearShort + customer + blockingOs > 0 ? 'danger'
      : (supplyByProject.get(p.id) ?? 0) + (measurementByProject.get(p.id) ?? 0) + (riskByProject.get(p.id) ?? 0) > 0 ? 'warning' : 'success';
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const reasons = [critical ? count(critical, 'atividade crítica', 'atividades críticas') : null,
      nearShort ? count(nearShort, 'falta de material perto da necessidade', 'faltas de material perto da necessidade') : null,
      customer ? count(customer, 'dependência do cliente vencida', 'dependências do cliente vencidas') : null,
      blockingOs ? 'OS com divergência bloqueante' : null,
      (measurementByProject.get(p.id) ?? 0) ? 'medição pendente' : null].filter(Boolean) as string[];
    return { projectId: p.id, project: p.name, client: p.client, tone, reasons, nextMilestone: nextMilestone.get(p.id) ?? null };
  }).sort((a, b) => ({ danger: 0, warning: 1, success: 2 }[a.tone] - { danger: 0, warning: 1, success: 2 }[b.tone]));

  // Necessidades de material nos próximos 30 dias (marcadores da linha do tempo).
  const horizonEnd = addDays(today, 30);
  const needs = coverageRows.filter(({ row }) => row.required_by && row.required_by >= today && row.required_by <= horizonEnd)
    .map(({ row, cov }) => ({ requirementId: row.requirement_id, projectId: row.project_id,
      project: projects.get(row.project_id)?.name ?? row.project_id, date: row.required_by as string, short: cov.shortage > 0 }))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60);

  // Fluxo da OS (ponte Comercial → Operações).
  const osFlow = {
    draft: serviceOrders.filter((o) => o.status === 'DRAFT').length,
    review: serviceOrders.filter((o) => o.status === 'PENDING_CONFIRMATION').length,
    issued: serviceOrders.filter((o) => o.status === 'ISSUED' && !o.projectId).length,
    linked: serviceOrders.filter((o) => ['ISSUED', 'IN_EXECUTION'].includes(o.status) && Boolean(o.projectId)).length,
    blocked: osAwaitingIssue.filter((o) => o.counts.blockingOpen > 0).length,
  };

  const locations = (locationsRes.data ?? []) as Array<{ project_id: string; resolution_state: string }>;

  return {
    today,
    access,
    kpis: {
      activeProjects: access.projects ? activeProjects.length : null,
      serviceOrdersAwaitingIssue: osAwaitingIssue.length,
      serviceOrdersBlocked: osAwaitingIssue.filter((o) => o.counts.blockingOpen > 0).length,
      criticalActivities: access.projects ? activities.filter((a) => isCriticalActivity(a, today)).length : null,
      projectsAtRisk: access.projects ? projectsAtRisk.length : null,
      measurementPending: access.measurements ? measurementPending.length : null,
      materialUncovered: access.projects
        ? ((coverageRes.data ?? []) as CoverageViewRow[]).filter((r) => fromViewRow(r).shortage > 0).length : null,
    },
    measurementLanes: access.measurements ? lanes : null,
    attention: attention.slice(0, 40),
    attentionTotal: attention.length,
    horizon: access.projects ? horizon : null,
    riskMatrix: access.projects ? riskMatrix.slice(0, 20) : null,
    projectHealth: access.projects ? projectHealth.slice(0, 30) : null,
    needs: access.projects ? needs : null,
    osFlow,
    customerDependenciesOverdue: access.projects ? overdueDependencies.length : null,
    map: access.projects ? {
      located: locations.filter((l) => l.resolution_state === 'RESOLVED').length,
      unresolved: locations.filter((l) => l.resolution_state !== 'RESOLVED').length,
      activeProjects: activeProjects.length,
    } : null,
  };
}

export type OperationsOverview = Awaited<ReturnType<typeof operationsOverview>>;
