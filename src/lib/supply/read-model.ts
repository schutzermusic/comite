/**
 * READ MODELS do Supply — Planejamento de Materiais e Visão Geral (torre de
 * controle). Tudo derivado da visão de cobertura e dos requisitos canônicos,
 * lidos pelo cliente autenticado (RLS). Nenhum total é guardado.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/read-model.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { projectIdentity } from '@/lib/operations/project-identity';
import { daysBetween } from '@/lib/operations/overview-rules';
import { fromViewRow, supplyRisk, type CoverageSummary, type CoverageViewRow, type SupplyRisk } from './coverage';

type Session = { supabase: SupabaseClient; organizationId: string };

export interface MaterialDemandRow {
  requirementId: string;
  projectId: string; project: string; client: string | null;
  activityId: string | null; activity: string | null;
  itemId: string | null; itemCode: string | null; itemDescription: string | null;
  title: string; priority: string; unit: string | null;
  requiredBy: string | null; daysToNeed: number | null;
  coverage: CoverageSummary;
  risk: SupplyRisk;
}

export async function materialDemand(session: Session, today: string, projectId?: string): Promise<MaterialDemandRow[]> {
  const org = session.organizationId;
  const sb = session.supabase;
  let query = sb.from('supply_requirement_coverage').select('*').eq('organization_id', org);
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('required_by', { ascending: true, nullsFirst: false }).limit(3000);
  if (error) throw new Error('Não foi possível ler a demanda de material.');
  const rows = (data ?? []) as CoverageViewRow[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.requirement_id);
  const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id).filter(Boolean))) as string[];
  const activityIds = Array.from(new Set(rows.map((r) => r.activity_id).filter(Boolean))) as string[];
  const [reqs, projects, items, acts] = await Promise.all([
    sb.from('project_requirements').select('id,title,priority').eq('organization_id', org).in('id', ids),
    sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', projectIds),
    itemIds.length ? sb.from('supply_items').select('id,code,description').eq('organization_id', org).in('id', itemIds)
      : Promise.resolve({ data: [] }),
    activityIds.length ? sb.from('project_timeline_items').select('id,title').eq('organization_id', org).in('id', activityIds)
      : Promise.resolve({ data: [] }),
  ]);
  const reqMap = new Map(((reqs.data ?? []) as Array<{ id: string; title: string; priority: string }>).map((r) => [r.id, r]));
  const projMap = new Map(((projects.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2)]));
  const itemMap = new Map(((items.data ?? []) as Array<{ id: string; code: string; description: string }>).map((i) => [i.id, i]));
  const actMap = new Map(((acts.data ?? []) as Array<{ id: string; title: string }>).map((a) => [a.id, a.title]));

  return rows.map((r) => {
    const coverage = fromViewRow(r);
    const daysToNeed = r.required_by ? daysBetween(today, r.required_by) : null;
    const item = r.item_id ? itemMap.get(r.item_id) : undefined;
    const req = reqMap.get(r.requirement_id);
    return {
      requirementId: r.requirement_id, projectId: r.project_id, project: projMap.get(r.project_id)?.name ?? r.project_id,
      client: projMap.get(r.project_id)?.client ?? null,
      activityId: r.activity_id, activity: r.activity_id ? actMap.get(r.activity_id) ?? null : null,
      itemId: r.item_id, itemCode: item?.code ?? null, itemDescription: item?.description ?? null,
      title: req?.title ?? item?.description ?? 'Material', priority: req?.priority ?? 'medium', unit: r.unit,
      requiredBy: r.required_by, daysToNeed, coverage, risk: supplyRisk(coverage, daysToNeed),
    };
  });
}

const RISK_RANK: Record<SupplyRisk, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function supplyOverview(session: Session, today: string) {
  const demand = await materialDemand(session, today);
  const short = demand.filter((d) => d.coverage.shortage > 0);
  const critical = short.filter((d) => d.risk === 'critical');
  const byProject = new Map<string, { projectId: string; project: string; client: string | null; shortages: number;
    critical: number; nextNeed: string | null; worst: SupplyRisk }>();
  for (const d of short) {
    const p = byProject.get(d.projectId) ?? { projectId: d.projectId, project: d.project, client: d.client, shortages: 0,
      critical: 0, nextNeed: null, worst: 'low' as SupplyRisk };
    p.shortages += 1;
    if (d.risk === 'critical') p.critical += 1;
    if (d.requiredBy && (!p.nextNeed || d.requiredBy < p.nextNeed)) p.nextNeed = d.requiredBy;
    if (RISK_RANK[d.risk] < RISK_RANK[p.worst]) p.worst = d.risk;
    byProject.set(d.projectId, p);
  }
  return {
    today,
    kpis: {
      demandLines: demand.length,
      uncovered: short.length,
      criticalShortages: critical.length,
      projectsExposed: Array.from(byProject.values()).filter((p) => p.worst === 'critical' || p.worst === 'high').length,
      covered: demand.filter((d) => d.coverage.status === 'COVERED').length,
    },
    projectRisks: Array.from(byProject.values()).sort((a, b) => RISK_RANK[a.worst] - RISK_RANK[b.worst] || b.shortages - a.shortages),
    criticalShortages: short.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || (a.requiredBy ?? '').localeCompare(b.requiredBy ?? ''))
      .slice(0, 25),
  };
}

export type SupplyOverviewModel = Awaited<ReturnType<typeof supplyOverview>>;

export async function listItems(session: Session, includeInactive: boolean) {
  let query = session.supabase.from('supply_items')
    .select('id,code,description,category,unit,manufacturer,brand,tracking,active,technical_attributes,updated_at')
    .eq('organization_id', session.organizationId).order('code').limit(5000);
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw new Error('Não foi possível consultar o cadastro de itens.');
  return data ?? [];
}
