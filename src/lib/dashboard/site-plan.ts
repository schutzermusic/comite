/**
 * PLANEJAR — `GET /api/dashboard/site/[projectId]/plan`.
 *
 * O cronograma CANÔNICO do projeto (`project_timeline_items` ativos, não
 * apagados) com as dependências (`project_timeline_dependencies`) no formato
 * do Gantt do protótipo, e as NECESSIDADES de cada atividade
 * (`project_requirements` confirmados + a cobertura AO VIVO do Supply). Nada é
 * gravado nem estimado:
 *  • `critical` = prioridade `critical` no cronograma (não é caminho crítico calculado);
 *  • `overdue` / `blocked` = os MESMOS predicados da fila (`isOverdueActivity`;
 *    `delay_status`/`status` = blocked, em folha aberta);
 *  • `needBy` = a menor data declarada (`required_by`) dos requisitos
 *    confirmados e ainda não atendidos da atividade;
 *  • `atRisk` = algum requisito da atividade com falta na cobertura viva.
 *
 * Leituras pelo cliente AUTENTICADO, organização + projeto, paginadas; o que
 * chegar no teto marca `truncated`. Necessidades que não carregaram viram
 * `error` em cada atividade (nunca "sem necessidade") e o plano sai `truncated`.
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/site-plan.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import { isOverdueActivity } from '@/lib/operations/overview-rules';
import {
  READINESS_LABEL, REQUIREMENT_TYPE_LABEL, SUPPLY_COVERED_TYPES, requirementReadiness, type RequirementType,
} from '@/lib/operations/planning/readiness';
import { TIMELINE_STATUS_LABELS, type TimelineItemStatus } from '@/lib/types/project-timeline';
import { lagToDays } from '@/lib/projects/gantt-dependencies';
import type { ActivityNeed, GanttActivity, GanttLink, SectionState, SitePlanData, SitePlanResponse } from './types';
import { addDays, daysFrom, isoDay } from './rules';
import {
  readPaged, readProjectCoverage, num, str, runSiteSection, SUPPLY_COVERED_REQUIREMENT_TYPES, type SiteContext, type Timings,
} from './site-common';
import { isOpenActivity, readSiteActivities, type SiteActivity } from './site';

type Row = Record<string, unknown>;

/* ══════════════════════════════════════════════════════════════════════════
   REGRAS PURAS (exportadas para teste)
   ══════════════════════════════════════════════════════════════════════════ */

export interface PlanRequirement {
  id: string;
  activity_id: string | null;
  requirement_type: string;
  title: string;
  quantity: number | null;
  unit: string | null;
  required_by: string | null;
  satisfied_at: string | null;
}

export interface PlanDependency { predecessor_id: string; successor_id: string; type: string; lag_minutes: number | null }

export interface PlanInput {
  projectId: string;
  today: string;
  activities: readonly SiteActivity[];
  activitiesTruncated: boolean;
  dependencies: readonly PlanDependency[];
  dependenciesTruncated: boolean;
  /** Requisitos confirmados + cobertura viva por requisito; `error` = a leitura falhou. */
  needs: SectionState<{ requirements: readonly PlanRequirement[]; coverage: ReadonlyMap<string, CoverageViewRow>; truncated: boolean }>;
}

/** "1.10" depois de "1.9": compara WBS por partes numéricas. */
export function compareWbs(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pa = a.split('.'); const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = Number(pa[i]); const nb = Number(pb[i]);
    const d = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : pa[i].localeCompare(pb[i], 'pt-BR');
    if (d) return d;
  }
  return 0;
}

const rowCompare = (x: SiteActivity, y: SiteActivity) =>
  (x.row_order ?? Number.MAX_SAFE_INTEGER) - (y.row_order ?? Number.MAX_SAFE_INTEGER)
  || compareWbs(x.wbs_code, y.wbs_code)
  || (x.planned_start ?? '9999').localeCompare(y.planned_start ?? '9999')
  || x.id.localeCompare(y.id);

/**
 * A ordem do Gantt: a árvore (`parent_id`) percorrida em profundidade, irmãos
 * na ordem do cronograma (`row_order` → WBS → início). Pai inexistente no
 * conjunto = raiz; ciclo não trava (cada linha sai uma vez). Devolve a linha
 * com o nível (0 = raiz).
 */
export function ganttOrder(all: readonly SiteActivity[]): Array<{ a: SiteActivity; level: number; parentId: string | null }> {
  const ids = new Set(all.map((a) => a.id));
  const children = new Map<string | null, SiteActivity[]>();
  for (const a of all) {
    const parent = a.parent_id && ids.has(a.parent_id) && a.parent_id !== a.id ? a.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }
  for (const list of children.values()) list.sort(rowCompare);
  const out: Array<{ a: SiteActivity; level: number; parentId: string | null }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, level: number) => {
    for (const a of children.get(parent) ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ a, level, parentId: parent });
      walk(a.id, level + 1);
    }
  };
  walk(null, 0);
  // Linhas presas num ciclo (nenhuma raiz as alcança): entram no fim, como raiz.
  for (const a of [...all].sort(rowCompare)) if (!seen.has(a.id)) { seen.add(a.id); out.push({ a, level: 0, parentId: null }); walk(a.id, 1); }
  return out;
}

const DEP_TYPES = new Set(['FS', 'SS', 'FF', 'SF']);

/** Dependências → setas do Gantt; só entre atividades do conjunto; tipo desconhecido = FS (o padrão do cronograma). */
export function ganttLinks(deps: readonly PlanDependency[], ids: ReadonlySet<string>): GanttLink[] {
  const out: GanttLink[] = [];
  const seen = new Set<string>();
  for (const d of deps) {
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id) || d.predecessor_id === d.successor_id) continue;
    const type = (DEP_TYPES.has(d.type) ? d.type : 'FS') as GanttLink['type'];
    const k = `${d.predecessor_id}>${d.successor_id}:${type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ from: d.predecessor_id, to: d.successor_id, type, lagDays: lagToDays(d.lag_minutes ?? 0) });
  }
  return out;
}

const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const NEED_RANK: Record<ActivityNeed['status'], number> = { short: 0, partial: 1, unknown: 2, covered: 3 };

/**
 * Uma necessidade da atividade. Material e serviço externo: pela cobertura
 * VIVA (falta > 0 → `short`; coberto em mãos → `covered`; coberto só com
 * entrada → `partial`; sem cobertura calculável → `unknown`). O resto: pelo
 * ato "atendido" (`requirementReadiness`): atendido → `covered`; pendente ou
 * vencido → `unknown` (não há cobertura a calcular), com o rótulo dizendo qual.
 */
export function activityNeed(r: PlanRequirement, cov: CoverageViewRow | undefined, projectId: string, today: string): ActivityNeed {
  const supplyCovered = SUPPLY_COVERED_TYPES.includes(r.requirement_type as RequirementType);
  const base = {
    id: r.id, title: r.title || 'Requisito', type: r.requirement_type,
    typeLabel: REQUIREMENT_TYPE_LABEL[r.requirement_type as RequirementType] ?? 'Outro',
    qty: r.quantity, unit: r.unit, requiredBy: isoDay(r.required_by),
    href: supplyCovered ? `/supply/planejamento-materiais?req=${encodeURIComponent(r.id)}` : `/projetos/${encodeURIComponent(projectId)}?tab=timeline`,
  };
  if (supplyCovered) {
    if (!cov) return { ...base, status: 'unknown', statusLabel: 'Cobertura não calculada', coverage: null };
    const s = fromViewRow(cov);
    const coverage = { required: s.required, covered: s.covered, shortage: s.shortage };
    if (s.shortage > 0) {
      return { ...base, status: 'short', statusLabel: `Falta ${formatQty(s.shortage)}${r.unit ? ` ${r.unit}` : ''}`, coverage };
    }
    if (s.status === 'COVERED') return { ...base, status: 'covered', statusLabel: 'Coberto', coverage };
    return { ...base, status: 'partial', statusLabel: 'Coberto com entrada', coverage };
  }
  const readiness = requirementReadiness({
    requirement_type: r.requirement_type as RequirementType, status: 'CONFIRMED', quantity: r.quantity,
    required_by: r.required_by, satisfied_at: r.satisfied_at,
  }, today, null);
  if (readiness === 'READY') return { ...base, status: 'covered', statusLabel: 'Atendido', coverage: null };
  return { ...base, status: 'unknown', statusLabel: readiness ? READINESS_LABEL[readiness] : 'Pendente', coverage: null };
}

/** Janela do Gantt: [primeiro início − 3 d, último término + 7 d], com "hoje" quando está perto do plano; 21 d a 2 anos. */
export const PLAN_MIN_SPAN_DAYS = 21;
export const PLAN_MAX_SPAN_DAYS = 730;

export function planWindow(dates: readonly (string | null)[], today: string): { start: string; end: string } {
  const valid = dates.map((d) => isoDay(d)).filter((d): d is string => !!d).sort();
  let first = valid[0] ?? today;
  let last = valid[valid.length - 1] ?? today;
  // "Hoje" entra quando está a até 30 dias do plano (a linha do Hoje é parte do Gantt; um plano de 2019 não estica até hoje).
  if (daysFrom(addDays(first, -30), today) >= 0 && daysFrom(today, addDays(last, 30)) >= 0) {
    if (today < first) first = today;
    if (today > last) last = today;
  }
  let start = addDays(first, -3);
  let end = addDays(last, 7);
  if (daysFrom(start, end) > PLAN_MAX_SPAN_DAYS) {
    // Plano longo: a janela fica ancorada perto de hoje (ou do começo, se hoje está fora dele).
    const anchor = today >= start && today <= end ? addDays(today, -90) : start;
    start = anchor > start ? anchor : start;
    end = addDays(start, PLAN_MAX_SPAN_DAYS);
  }
  if (daysFrom(start, end) < PLAN_MIN_SPAN_DAYS) end = addDays(start, PLAN_MIN_SPAN_DAYS);
  return { start, end };
}

/**
 * A atividade em foco ao abrir: folha aberta em RISCO (necessidade mais cedo)
 * → VENCIDA (término mais antigo) → CRÍTICA (início mais cedo) → a PRÓXIMA a
 * começar (ou, sem próxima, a em andamento que termina primeiro).
 */
export function planFocus(rows: readonly GanttActivity[], today: string): string | null {
  const open = rows.filter((r) => !r.isSummary && r.status !== 'completed' && r.status !== 'cancelled');
  const by = (list: GanttActivity[], key: (r: GanttActivity) => string | null) =>
    [...list].sort((x, y) => (key(x) ?? '9999').localeCompare(key(y) ?? '9999') || x.id.localeCompare(y.id))[0] ?? null;
  const pick = by(open.filter((r) => r.atRisk), (r) => r.needBy ?? r.start)
    ?? by(open.filter((r) => r.overdue), (r) => r.finish)
    ?? by(open.filter((r) => r.critical), (r) => r.start)
    ?? by(open.filter((r) => r.start !== null && r.start >= today), (r) => r.start)
    ?? by(open.filter((r) => r.status === 'in_progress'), (r) => r.finish);
  return pick?.id ?? null;
}

/** O plano inteiro, a partir das leituras. */
export function buildPlanData(input: PlanInput): SitePlanData {
  const { projectId, today } = input;
  const ordered = ganttOrder(input.activities);
  const ids = new Set(ordered.map((o) => o.a.id));
  const needsOk = input.needs.state === 'ok' ? input.needs.data : null;

  // Necessidades por atividade (só as de atividades do conjunto).
  const byActivity = new Map<string, ActivityNeed[]>();
  const needByOf = new Map<string, string>();
  const atRisk = new Set<string>();
  if (needsOk) {
    for (const r of needsOk.requirements) {
      if (!r.activity_id || !ids.has(r.activity_id)) continue;
      const need = activityNeed(r, needsOk.coverage.get(r.id), projectId, today);
      byActivity.set(r.activity_id, [...(byActivity.get(r.activity_id) ?? []), need]);
      if (need.status === 'short') atRisk.add(r.activity_id);
      const due = isoDay(r.required_by);
      if (due && !r.satisfied_at) {
        const cur = needByOf.get(r.activity_id);
        if (!cur || due < cur) needByOf.set(r.activity_id, due);
      }
    }
  }

  const activities: GanttActivity[] = ordered.map(({ a, level, parentId }) => ({
    id: a.id,
    parentId,
    wbs: a.wbs_code,
    title: a.title || 'Atividade do cronograma',
    level,
    start: a.planned_start,
    finish: a.planned_finish,
    percent: a.percent_complete !== null ? Math.max(0, Math.min(100, a.percent_complete)) : a.status === 'completed' ? 100 : null,
    status: a.status,
    statusLabel: TIMELINE_STATUS_LABELS[a.status as TimelineItemStatus] ?? 'Sem status',
    isSummary: a.is_summary,
    isMilestone: a.is_milestone,
    critical: a.priority === 'critical',
    overdue: isOverdueActivity(a, today),
    blocked: !a.is_summary && isOpenActivity(a) && (a.delay_status === 'blocked' || a.status === 'blocked'),
    needBy: needByOf.get(a.id) ?? null,
    atRisk: atRisk.has(a.id),
    href: `/projetos/${encodeURIComponent(projectId)}?tab=timeline`,
  }));

  const needsByActivity: Record<string, SectionState<ActivityNeed[]>> = {};
  for (const g of activities) {
    if (input.needs.state === 'ok') {
      needsByActivity[g.id] = {
        state: 'ok',
        data: [...(byActivity.get(g.id) ?? [])].sort((x, y) => NEED_RANK[x.status] - NEED_RANK[y.status]
          || (x.requiredBy ?? '9999').localeCompare(y.requiredBy ?? '9999') || x.id.localeCompare(y.id)),
        ...(input.needs.data.truncated ? { truncated: true } : {}),
      };
    } else {
      needsByActivity[g.id] = input.needs;
    }
  }

  return {
    window: planWindow([...activities.flatMap((g) => [g.start, g.finish, g.needBy])], today),
    activities,
    links: ganttLinks(input.dependencies, ids),
    focus: planFocus(activities, today),
    needsByActivity,
    truncated: input.activitiesTruncated || input.dependenciesTruncated || input.needs.state !== 'ok'
      || (input.needs.state === 'ok' && input.needs.data.truncated),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   LEITURAS
   ══════════════════════════════════════════════════════════════════════════ */

const DEPENDENCIES_CAP = 10_000;
const REQUIREMENTS_CAP = 5_000;

async function readDependencies(sb: SupabaseClient, org: string, projectId: string) {
  const { rows, truncated } = await readPaged<Row>('as dependências do cronograma', (from, to) => sb.from('project_timeline_dependencies')
    .select('id,predecessor_id,successor_id,type,lag_minutes').eq('organization_id', org).eq('project_id', projectId)
    .order('id').range(from, to), DEPENDENCIES_CAP);
  return {
    dependencies: rows.flatMap((d): PlanDependency[] => {
      const from = str(d.predecessor_id); const to = str(d.successor_id);
      return from && to ? [{ predecessor_id: from, successor_id: to, type: String(d.type ?? 'FS'), lag_minutes: num(d.lag_minutes) }] : [];
    }),
    truncated,
  };
}

/** Requisitos CONFIRMADOS do projeto + a cobertura viva dos de material/serviço (a mesma visão do Supply, RLS dos requisitos). */
async function readNeeds(sb: SupabaseClient, org: string, projectId: string) {
  const reqs = await readPaged<Row>('os requisitos do projeto', (from, to) => sb.from('project_requirements')
    .select('id,activity_id,requirement_type,title,quantity,unit,required_by,satisfied_at').eq('organization_id', org)
    .eq('project_id', projectId).eq('status', 'CONFIRMED').order('id').range(from, to), REQUIREMENTS_CAP);
  const supplyIds = reqs.rows.filter((r) => (SUPPLY_COVERED_REQUIREMENT_TYPES as readonly string[]).includes(String(r.requirement_type)))
    .map((r) => String(r.id));
  const cov = await readProjectCoverage<CoverageViewRow>(sb, org, projectId, supplyIds, reqs.truncated);
  return {
    requirements: reqs.rows.map((r): PlanRequirement => ({
      id: String(r.id), activity_id: str(r.activity_id), requirement_type: String(r.requirement_type ?? 'OTHER'),
      title: String(r.title ?? ''), quantity: num(r.quantity), unit: str(r.unit), required_by: isoDay(r.required_by),
      satisfied_at: str(r.satisfied_at),
    })),
    coverage: new Map(cov.rows.map((c) => [c.requirement_id, c])),
    truncated: reqs.truncated || cov.truncated,
  };
}

type PlanOk = Extract<SitePlanResponse, { ok: true }>;

/** Monta o Planejar do local. `timings` recebe a duração de cada leitura (cabeçalho `Server-Timing`). */
export async function buildSitePlan(site: SiteContext, timings?: Timings): Promise<PlanOk> {
  const { session, gates: g, today, project } = site;
  const sb = session.supabase;
  const org = session.organizationId;
  const pid = project.id;

  const [activities, dependencies, needs] = await Promise.all([
    runSiteSection(g.projects, 'o cronograma do projeto', () => readSiteActivities(sb, org, pid), timings, 'activities'),
    runSiteSection(g.projects, 'as dependências do cronograma', () => readDependencies(sb, org, pid), timings, 'dependencies'),
    // Necessidades: o portão de necessidades do Dashboard (`projects.view` — o da cobertura).
    runSiteSection(g.projects, 'as necessidades das atividades', () => readNeeds(sb, org, pid), timings, 'needs'),
  ]);

  let plan: SectionState<SitePlanData>;
  if (activities.state !== 'ok') plan = activities;
  else if (dependencies.state !== 'ok') {
    // Sem as dependências o Gantt mentiria sobre a sequência: o plano inteiro não carregou.
    plan = dependencies.state === 'error' ? { state: 'error', message: 'Não foi possível ler as dependências do cronograma.' } : dependencies;
  } else {
    const data = buildPlanData({
      projectId: pid, today,
      activities: activities.data.activities, activitiesTruncated: activities.data.truncated,
      dependencies: dependencies.data.dependencies, dependenciesTruncated: dependencies.data.truncated,
      needs,
    });
    plan = { state: 'ok', data, ...(data.truncated ? { truncated: true } : {}) };
  }

  return { ok: true, today, project: { id: pid, name: project.identity.name }, plan };
}
