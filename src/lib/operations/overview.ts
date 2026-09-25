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
  horizonOf, isCriticalActivity, isInProgressActivity, isMaterialOpenRisk, isOperationalMeasurementPending, isOverdueActivity,
  measurementLane, projectAtRisk, type ActivityLike, type Horizon, type MeasurementLane,
} from './overview-rules';
import {
  countHealthLevels, groupOverdueByProject, materialShortageTone, overdueActivityTone, readWasTruncated, tallyAttention,
  type AttentionKind, type AttentionTone,
} from './overview-aggregates';
import { listServiceOrders } from './service-orders/read-model';
import { serviceOrderNextAction } from './service-orders/next-action';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import { selectIn } from '@/lib/supabase/select-in';
import { deriveProjectHealth } from './projects/health';

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

type Session = { supabase: SupabaseClient; organizationId: string };

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  object: string;
  issue: string;
  impact: string | null;
  due: string | null;
  owner: string | null;
  tone: AttentionTone;
  href: string;
  actionLabel: string;
  /** Projeto do registro, quando há (a OS pode não ter; o risco pode não ser de projeto). */
  projectId: string | null;
  /** Id cru do registro: OS, atividade, medição, risco, requisito de material, requisito de dependência. */
  refId: string;
}

/**
 * O que a pessoa lê. `serviceOrders` (padrão: sim) — sem ele as OS nem são
 * lidas: os números de OS continuam números (a tela de Operações sempre tem
 * `operations.view`), e `serviceOrdersAccess: false` avisa quem compõe.
 */
export interface OverviewAccess { projects: boolean; measurements: boolean; risks: boolean; serviceOrders?: boolean }

type ActivityRow = ActivityLike & {
  id: string; project_id: string; title: string; type: string; actual_start: string | null;
  responsible_user_id: string | null; percent_complete: number | null; wbs_code: string | null;
};

type ReadResult = { data: unknown[] | null; error: { message: string } | null };
const skipped = (): Promise<ReadResult> => Promise.resolve({ data: [], error: null });

/** Leitura central conferida: erro SOBE (a rota responde 500 com estado de erro), nunca vira lista vazia nem 0. */
function rowsOf<T>(res: ReadResult, what: string): T[] {
  if (res.error) throw new Error(`Não foi possível ler ${what} da visão geral de Operações.`);
  return (res.data ?? []) as T[];
}

const ACTIVITIES_LIMIT = 5000;
const MEASUREMENTS_LIMIT = 5000;
const RISKS_LIMIT = 2000;

export async function operationsOverview(session: Session, access: OverviewAccess, today: string) {
  const org = session.organizationId;
  const sb = session.supabase;
  const serviceOrdersAccess = access.serviceOrders !== false;

  const [serviceOrders, projectsRes, activitiesRes, measurementsRes, risksRes, locationsRes, coverageRes, dependenciesRes] = await Promise.all([
    serviceOrdersAccess ? listServiceOrders(session) : Promise.resolve([]),
    access.projects ? sb.from('projects').select('id,project,project_v2').eq('organization_id', org)
      : skipped(),
    access.projects ? sb.from('project_timeline_items')
      .select('id,project_id,title,type,status,priority,delay_status,is_milestone,is_summary,planned_start,'
        + 'planned_finish,actual_start,actual_finish,responsible_user_id,percent_complete,wbs_code')
      .eq('organization_id', org).eq('is_active', true).is('deleted_at', null)
      .not('status', 'in', '(completed,cancelled)').limit(ACTIVITIES_LIMIT)
      : skipped(),
    access.measurements ? sb.from('project_measurements')
      .select('id,project_id,status,expected_at,occurrence_key,measured_value,currency,customer_due_at')
      .eq('organization_id', org).not('status', 'in', '(CANCELLED,SUPERSEDED,REJECTED)').limit(MEASUREMENTS_LIMIT)
      : skipped(),
    access.risks ? sb.from('risks')
      .select('id,title,severity,status,responsible_id,reference_id,origin,due_date')
      .eq('organization_id', org).in('status', ['open', 'mitigating']).limit(RISKS_LIMIT)
      : skipped(),
    access.projects ? sb.from('project_canonical_location').select('project_id,resolution_state')
      .eq('organization_id', org).is('superseded_at', null)
      : skipped(),
    // Demanda de material sem cobertura: a visão derivada do Supply (RLS dos requisitos).
    access.projects ? sb.from('supply_requirement_coverage').select('*').eq('organization_id', org)
      : skipped(),
    // Dependências do cliente confirmadas e ainda não atendidas (o requisito canônico do Planejamento).
    access.projects ? sb.from('project_requirements').select('id,project_id,title,required_by')
      .eq('organization_id', org).eq('requirement_type', 'CUSTOMER_DEPENDENCY').eq('status', 'CONFIRMED')
      .is('satisfied_at', null).limit(2000)
      : skipped(),
  ]);

  const projectRows = rowsOf<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>(
    projectsRes, 'os projetos');
  const activities = rowsOf<ActivityRow>(activitiesRes, 'o cronograma');
  const measurements = rowsOf<{ id: string; project_id: string; status: MeasurementStatus;
    expected_at: string | null; occurrence_key: string; customer_due_at: string | null }>(measurementsRes, 'as medições');
  const risks = rowsOf<{ id: string; title: string; severity: string; status: string;
    responsible_id: string | null; reference_id: string | null; origin: string; due_date: string | null }>(risksRes, 'os riscos');
  const locations = rowsOf<{ project_id: string; resolution_state: string }>(locationsRes, 'as localizações dos projetos');
  const coverageData = rowsOf<CoverageViewRow>(coverageRes, 'a cobertura de material');
  const dependencies = rowsOf<{ id: string; project_id: string; title: string; required_by: string | null }>(
    dependenciesRes, 'as dependências do cliente');

  const truncated = {
    activities: readWasTruncated(activities.length, ACTIVITIES_LIMIT),
    measurements: readWasTruncated(measurements.length, MEASUREMENTS_LIMIT),
    risks: readWasTruncated(risks.length, RISKS_LIMIT),
    coverage: readWasTruncated(coverageData.length),
  };

  const projects = new Map<string, ReturnType<typeof projectIdentity>>();
  for (const p of projectRows) {
    projects.set(p.id, projectIdentity(p.id, p.project, p.project_v2));
  }

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
  /*
    Contagem por tipo SEM corte: a fila abaixo corta atividade (25), material
    (15) e dependência (15); aqui entra CADA candidato, com o mesmo tom.
  */
  const candidates: Array<{ kind: AttentionKind; tone: AttentionTone }> = [];
  for (const o of serviceOrders) {
    const next = serviceOrderNextAction(o.status, o.projectId, o.counts);
    if (!next.needsDecision) continue;
    attention.push({
      id: `os:${o.id}`, kind: 'service_order', object: o.osNumber,
      issue: next.label, impact: o.customer ? `${o.customer} · ${o.title}` : o.title,
      due: o.plannedStart, owner: o.ownerName, tone: next.tone === 'danger' ? 'danger' : next.tone === 'warning' ? 'warning' : 'accent',
      href: `/operacoes/ordens-servico/${o.id}`, actionLabel: 'Abrir OS',
      projectId: o.projectId, refId: o.id,
    });
  }
  const overdueList = activities.filter((x) => isOverdueActivity(x, today))
    .sort((x, y) => (x.planned_finish ?? '').localeCompare(y.planned_finish ?? ''));
  for (const a of overdueList) candidates.push({ kind: 'activity', tone: overdueActivityTone(a) });
  for (const a of overdueList.slice(0, 25)) {
    const p = projects.get(a.project_id);
    attention.push({
      id: `act:${a.id}`, kind: 'activity', object: a.title,
      issue: a.delay_status === 'blocked' ? 'Atividade bloqueada e vencida' : 'Atividade vencida em aberto',
      impact: p ? `${p.name}${a.wbs_code ? ` · WBS ${a.wbs_code}` : ''}` : null,
      due: a.planned_finish, owner: a.responsible_user_id ? owners[a.responsible_user_id] ?? null : null,
      tone: overdueActivityTone(a),
      href: `/projetos/${encodeURIComponent(a.project_id)}?tab=timeline`, actionLabel: 'Abrir cronograma',
      projectId: a.project_id, refId: a.id,
    });
  }
  for (const m of measurements.filter((x) => x.status === 'RETURNED_FOR_CORRECTION' || x.status === 'CUSTOMER_CORRECTION_REQUESTED')) {
    const p = projects.get(m.project_id);
    attention.push({
      id: `meas:${m.id}`, kind: 'measurement', object: `Medição ${m.occurrence_key}`,
      issue: m.status === 'CUSTOMER_CORRECTION_REQUESTED' ? 'Cliente pediu correção' : 'Devolvida para correção',
      impact: p?.name ?? null, due: m.customer_due_at ?? m.expected_at, owner: null, tone: 'warning',
      href: `/projetos/${encodeURIComponent(m.project_id)}?tab=measurements`, actionLabel: 'Corrigir medição',
      projectId: m.project_id, refId: m.id,
    });
  }
  for (const r of risks.filter((x) => isMaterialOpenRisk(x) && !x.responsible_id)) {
    const p = r.reference_id ? projects.get(r.reference_id) : undefined;
    attention.push({
      id: `risk:${r.id}`, kind: 'risk', object: r.title, issue: 'Risco material sem responsável',
      impact: p?.name ?? null, due: r.due_date?.slice(0, 10) ?? null, owner: null,
      tone: r.severity === 'critical' ? 'danger' : 'warning',
      href: p ? `/projetos/${encodeURIComponent(p.id)}?tab=risks` : '/riscos', actionLabel: 'Atribuir dono',
      projectId: p?.id ?? null, refId: r.id,
    });
  }
  // Material: demanda confirmada com falta, perto da necessidade (14 dias) ou já vencida.
  const coverageRows = coverageData.map((r) => ({ row: r, cov: fromViewRow(r) }));
  const soon = addDays(today, 14);
  const materialDangerUntil = addDays(today, 7);
  const allShortages = coverageRows
    .filter(({ row, cov }) => cov.shortage > 0 && row.required_by && row.required_by <= soon)
    .sort((a, b) => String(a.row.required_by).localeCompare(String(b.row.required_by)));
  for (const { row } of allShortages) candidates.push({ kind: 'material', tone: materialShortageTone(row.required_by, materialDangerUntil) });
  const shortages = allShortages.slice(0, 15);
  // O nome do material é o título do requisito canônico — só exibição; sem ele a linha segue válida.
  const requirementTitles = new Map<string, string>();
  if (shortages.length) {
    let titles: Array<{ id: string; title: string }>;
    try {
      titles = await selectIn<{ id: string; title: string }>(shortages.map((s) => s.row.requirement_id),
        (c) => sb.from('project_requirements').select('id,title').eq('organization_id', org).in('id', c));
    } catch (cause) {
      throw new Error('Não foi possível ler os requisitos de material da visão geral de Operações.', { cause });
    }
    for (const r of titles) requirementTitles.set(r.id, r.title);
  }
  for (const { row, cov } of shortages) {
    const p = projects.get(row.project_id);
    const missing = `Falta ${formatQty(cov.shortage)} ${row.unit ?? ''}`.trim();
    attention.push({
      id: `mat:${row.requirement_id}`, kind: 'material', object: requirementTitles.get(row.requirement_id) ?? 'Material do requisito',
      issue: cov.inbound > 0 ? `${missing} — a entrada não cobre` : `${missing} — sem estoque nem pedido`,
      impact: p?.name ?? null, due: row.required_by, owner: null,
      tone: materialShortageTone(row.required_by, materialDangerUntil),
      href: `/supply/planejamento-materiais?req=${row.requirement_id}`, actionLabel: 'Cobrir falta',
      projectId: row.project_id, refId: row.requirement_id,
    });
  }
  const overdueDependencies = dependencies.filter((d) => d.required_by && d.required_by < today);
  for (let i = 0; i < overdueDependencies.length; i += 1) candidates.push({ kind: 'dependency', tone: 'danger' });
  for (const d of overdueDependencies.slice(0, 15)) {
    const p = projects.get(d.project_id);
    attention.push({
      id: `dep:${d.id}`, kind: 'dependency', object: d.title, issue: 'Dependência do cliente vencida',
      impact: p?.name ?? null, due: d.required_by, owner: null, tone: 'danger',
      href: `/projetos/${encodeURIComponent(d.project_id)}?tab=timeline`, actionLabel: 'Cobrar cliente',
      projectId: d.project_id, refId: d.id,
    });
  }
  // OS, medição e risco não têm corte por tipo: os candidatos são os próprios itens.
  for (const item of attention) {
    if (item.kind === 'service_order' || item.kind === 'measurement' || item.kind === 'risk') {
      candidates.push({ kind: item.kind, tone: item.tone });
    }
  }
  const attentionCounts = tallyAttention(candidates);
  const overdueByProject = groupOverdueByProject(overdueList, (id) => projects.get(id), owners);

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
  // Próximo marco DO CRONOGRAMA (adjacência temporal, não marco contratual).
  const nextMilestone = new Map<string, { date: string; id: string; title: string }>();
  for (const a of activities) {
    if (!a.is_milestone || !a.planned_finish || a.planned_finish < today) continue;
    const cur = nextMilestone.get(a.project_id);
    if (!cur || a.planned_finish < cur.date) nextMilestone.set(a.project_id, { date: a.planned_finish, id: a.id, title: a.title });
  }
  /*
    Saúde por projeto ativo — a MESMA derivação da página do projeto
    (`deriveProjectHealth`): cronograma (bloqueada, vencida), OS com bloqueio,
    material (falta perto da necessidade, sem cobertura), cliente vencido,
    medição e risco. A lista da Visão Geral, a cor do marcador no mapa e a
    saúde no projeto dizem a mesma coisa porque vêm da mesma regra.
  */
  const openByProject = new Map<string, ActivityRow[]>();
  for (const a of activities) {
    if (a.is_summary || a.actual_finish) continue;
    openByProject.set(a.project_id, [...(openByProject.get(a.project_id) ?? []), a]);
  }
  const projectHealth = activeProjects.map((p) => {
    const open = openByProject.get(p.id) ?? [];
    const mine = measurements.filter((m) => m.project_id === p.id);
    const projectRisks = risks.filter((r) => r.reference_id === p.id);
    const nearShort = nearShortByProject.get(p.id) ?? 0;
    const h = deriveProjectHealth({
      openActivities: open.length,
      criticalActivities: open.filter((a) => isCriticalActivity(a, today)).length,
      overdueActivities: open.filter((a) => isOverdueActivity(a, today)).length,
      blockedActivities: open.filter((a) => a.delay_status === 'blocked' || a.status === 'blocked').length,
      serviceOrdersBlocked: serviceOrders.filter((o) => o.projectId === p.id && o.counts.blockingOpen > 0
        && (o.status === 'DRAFT' || o.status === 'PENDING_CONFIRMATION')).length,
      measurementsInCorrection: mine.filter((m) => measurementLane(m.status) === 'CORRECTION').length,
      measurementsOverdue: mine.filter((m) => m.status === 'PLANNED' && m.expected_at !== null && m.expected_at < today).length,
      criticalRisks: projectRisks.filter((r) => r.severity === 'critical').length,
      highRisks: projectRisks.filter((r) => r.severity === 'high').length,
      risksWithoutOwner: projectRisks.filter(isMaterialOpenRisk).filter((r) => !r.responsible_id).length,
      materialShortNearNeed: nearShort,
      materialShort: (supplyByProject.get(p.id) ?? 0) - nearShort,
      customerDependenciesOverdue: customerByProject.get(p.id) ?? 0,
    }, open.length > 0);
    const tone: 'danger' | 'warning' | 'success' = h.level === 'critical' ? 'danger' : h.level === 'attention' ? 'warning' : 'success';
    const milestone = nextMilestone.get(p.id);
    return { projectId: p.id, project: p.name, client: p.client, tone, reasons: h.reasons.map((r) => r.text),
      nextMilestone: milestone?.date ?? null,
      // O nível CRU de `deriveProjectHealth` (critical | attention | healthy | unknown) — `tone` junta healthy e unknown.
      level: h.level,
      nextMilestoneId: milestone?.id ?? null, nextMilestoneTitle: milestone?.title ?? null };
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
        ? coverageData.filter((r) => fromViewRow(r).shortage > 0).length : null,
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

    /* ── Aditivos (Dashboard): tudo SEM corte, calculado antes de qualquer `slice` ── */
    /** A pessoa lê OS? Sem isso os números de OS acima são 0 por não terem sido lidos — não por não existirem. */
    serviceOrdersAccess,
    /** Por tipo da fila: total, perigo e aviso sobre TODOS os candidatos (a fila acima é cortada). */
    attentionCounts,
    /** Projetos (ativos ou não) com atividade-folha aberta vencida: bloqueadas ↓, críticas ↓, mais antiga ↑. */
    overdueByProject: access.projects ? overdueByProject : [],
    /** Atividades-folha abertas vencidas (sem corte). */
    overdueActivities: access.projects ? overdueList.length : null,
    /** Atividades-folha abertas em andamento (`in_progress` ou início real). */
    inProgressActivities: access.projects ? activities.filter((a) => isInProgressActivity(a)).length : null,
    /** Saúde de TODOS os projetos ativos (a lista `projectHealth` acima é cortada em 30). */
    healthCounts: access.projects ? countHealthLevels(projectHealth.map((p) => p.level)) : null,
    /** A leitura chegou no teto do PostgREST ou no `.limit()` — os números dela podem estar incompletos. */
    truncated,
  };
}

export type OperationsOverview = Awaited<ReturnType<typeof operationsOverview>>;
