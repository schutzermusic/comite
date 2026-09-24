/**
 * MAPA DE OPERAÇÕES — read model geográfico sobre coordenadas que JÁ existem.
 *
 * Nenhuma coordenada nova é guardada:
 *   • projeto   → `project_canonical_location` (versão vigente, RESOLVED);
 *   • obra      → `project_geofences` (centro + raio reais);
 *   • equipe    → `location_evidence` (último fix por pessoa em 24 h), SÓ com
 *                 alçada de ponto (`people.attendance_view`);
 *   • estoque   → locais de estoque, quando o domínio existir (wave G).
 * Veículo não aparece: a plataforma não tem domínio de frota com posição — e
 * o mapa não inventa um.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/map.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { projectIdentity, isActiveProjectStatus } from './project-identity';
import { isCriticalActivity, isMaterialOpenRisk, isOverdueActivity, type ActivityLike } from './overview-rules';
import { countsFor } from './service-orders/read-model';

type Session = { supabase: SupabaseClient; organizationId: string };

export type MapHealth = 'critical' | 'attention' | 'healthy' | 'unknown';

export interface MapProject {
  id: string; name: string; client: string | null; status: string | null; active: boolean;
  lat: number | null; lng: number | null; precision: string | null; siteLabel: string | null;
  municipality: string | null; stateCode: string | null; locationState: string | null;
  health: MapHealth;
  alerts: string[];
  criticalActivities: number; overdueActivities: number; materialRisks: number;
  serviceOrders: number; serviceOrdersBlocked: number;
  supplyShortages: number;
  nextMilestone: { title: string; date: string | null } | null;
  geofences: Array<{ id: string; name: string; lat: number; lng: number; radius: number }>;
}

export interface MapTeamPoint { personId: string; name: string; lat: number; lng: number; at: string; integrity: string; projectId: string | null }

/** Nível do pino: a mesma leitura da saúde do projeto, resumida em cor + texto. */
export function mapHealth(p: { criticalActivities: number; overdueActivities: number; materialRisks: number;
  serviceOrdersBlocked: number; supplyShortages: number }, hasSchedule: boolean): MapHealth {
  if (p.serviceOrdersBlocked > 0 || p.materialRisks > 0 || p.overdueActivities > 3 || p.supplyShortages > 0) return 'critical';
  if (p.criticalActivities > 0 || p.overdueActivities > 0) return 'attention';
  return hasSchedule ? 'healthy' : 'unknown';
}

export async function operationsMap(session: Session, access: { team: boolean; risks: boolean }, today: string) {
  const org = session.organizationId;
  const sb = session.supabase;
  const soon = new Date(`${today}T12:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 14);
  const horizon = soon.toISOString().slice(0, 10);

  const [projects, locations, fences, activities, orders, risks, requirements] = await Promise.all([
    sb.from('projects').select('id,project,project_v2').eq('organization_id', org),
    sb.from('project_canonical_location')
      .select('project_id,resolution_state,latitude,longitude,precision,site_label,municipality,state_code')
      .eq('organization_id', org).is('superseded_at', null),
    sb.from('project_geofences').select('id,project_id,name,center_lat,center_lng,radius_meters,active')
      .eq('organization_id', org).eq('active', true),
    sb.from('project_timeline_items')
      .select('project_id,title,status,priority,delay_status,is_milestone,is_summary,planned_start,planned_finish,actual_finish')
      .eq('organization_id', org).eq('is_active', true).is('deleted_at', null).not('status', 'in', '(completed,cancelled)').limit(8000),
    sb.from('internal_service_orders').select('id,project_id,status,engagement_id').eq('organization_id', org).not('project_id', 'is', null),
    access.risks ? sb.from('risks').select('reference_id,severity,status,responsible_id')
      .eq('organization_id', org).in('status', ['open', 'mitigating']) : Promise.resolve({ data: [] }),
    sb.from('project_requirements').select('project_id,requirement_type,status,required_by')
      .eq('organization_id', org).eq('status', 'CONFIRMED').in('requirement_type', ['MATERIAL', 'EXTERNAL_SERVICE'])
      .lte('required_by', horizon),
  ]);

  const locByProject = new Map(((locations.data ?? []) as Array<{ project_id: string; resolution_state: string; latitude: number | null;
    longitude: number | null; precision: string | null; site_label: string | null; municipality: string | null; state_code: string | null }>)
    .map((l) => [l.project_id, l]));
  const fencesByProject = new Map<string, MapProject['geofences']>();
  for (const f of (fences.data ?? []) as Array<{ id: string; project_id: string; name: string; center_lat: number; center_lng: number; radius_meters: number }>) {
    const list = fencesByProject.get(f.project_id) ?? [];
    list.push({ id: f.id, name: f.name, lat: f.center_lat, lng: f.center_lng, radius: f.radius_meters });
    fencesByProject.set(f.project_id, list);
  }
  const acts = (activities.data ?? []) as Array<ActivityLike & { project_id: string; title: string }>;
  const orderRows = (orders.data ?? []) as Array<{ id: string; project_id: string; status: string; engagement_id: string }>;
  const riskRows = (risks.data ?? []) as Array<{ reference_id: string | null; severity: string; status: string; responsible_id: string | null }>;
  const reqRows = (requirements.data ?? []) as Array<{ project_id: string }>;

  // OS bloqueada: a MESMA regra do portão (bloqueante aberta da OS ou do engajamento, fora de exceção).
  const counts = await countsFor(org, orderRows.filter((o) => o.status === 'DRAFT' || o.status === 'PENDING_CONFIRMATION'));

  const out: MapProject[] = ((projects.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => {
      const identity = projectIdentity(p.id, p.project, p.project_v2);
      const mine = acts.filter((a) => a.project_id === p.id);
      const critical = mine.filter((a) => isCriticalActivity(a, today)).length;
      const overdue = mine.filter((a) => isOverdueActivity(a, today)).length;
      const materialRisks = riskRows.filter((r) => r.reference_id === p.id && isMaterialOpenRisk(r)).length;
      const osMine = orderRows.filter((o) => o.project_id === p.id);
      const osBlocked = osMine.filter((o) => (counts.get(o.id)?.blockingOpen ?? 0) > 0).length;
      // Requisito de material confirmado, com necessidade em até 14 dias: sem alocação de Supply ainda,
      // está — de verdade — sem cobertura. A wave F troca pela cobertura derivada.
      const shortages = reqRows.filter((r) => r.project_id === p.id).length;
      const loc = locByProject.get(p.id);
      const fencesMine = fencesByProject.get(p.id) ?? [];
      const resolved = loc?.resolution_state === 'RESOLVED' && loc.latitude !== null && loc.longitude !== null;
      const milestone = mine.filter((a) => a.is_milestone && a.planned_finish && a.planned_finish >= today)
        .sort((a, b) => (a.planned_finish ?? '').localeCompare(b.planned_finish ?? ''))[0];
      const signals = { criticalActivities: critical, overdueActivities: overdue, materialRisks, serviceOrdersBlocked: osBlocked, supplyShortages: shortages };
      const alerts: string[] = [];
      if (osBlocked) alerts.push(`${osBlocked} OS com divergência bloqueante`);
      if (overdue) alerts.push(`${overdue} atividade(s) vencida(s)`);
      if (materialRisks) alerts.push(`${materialRisks} risco(s) alto/crítico`);
      if (shortages) alerts.push(`${shortages} material(is) sem cobertura em 14 dias`);
      return {
        id: p.id, name: identity.name, client: identity.client, status: identity.status, active: isActiveProjectStatus(identity.status),
        lat: resolved ? loc!.latitude : fencesMine[0]?.lat ?? null,
        lng: resolved ? loc!.longitude : fencesMine[0]?.lng ?? null,
        precision: resolved ? loc!.precision : fencesMine.length ? 'geofence' : null,
        siteLabel: loc?.site_label ?? fencesMine[0]?.name ?? null,
        municipality: loc?.municipality ?? null, stateCode: loc?.state_code ?? null, locationState: loc?.resolution_state ?? null,
        health: mapHealth(signals, mine.length > 0),
        alerts, ...signals,
        serviceOrders: osMine.length,
        supplyShortages: shortages,
        nextMilestone: milestone ? { title: milestone.title, date: milestone.planned_finish } : null,
        geofences: fencesMine,
      };
    });

  let team: MapTeamPoint[] | null = null;
  if (access.team) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: evidence } = await sb.from('location_evidence')
      .select('person_id,latitude,longitude,captured_at_device,integrity_status,geofence_id')
      .eq('organization_id', org).gte('captured_at_device', since).order('captured_at_device', { ascending: false }).limit(2000);
    const latest = new Map<string, { person_id: string; latitude: number; longitude: number; captured_at_device: string;
      integrity_status: string; geofence_id: string | null }>();
    for (const e of (evidence ?? []) as Array<{ person_id: string; latitude: number; longitude: number; captured_at_device: string;
      integrity_status: string; geofence_id: string | null }>) if (!latest.has(e.person_id)) latest.set(e.person_id, e);
    const ids = Array.from(latest.keys());
    const { data: people } = ids.length ? await sb.from('people').select('id,full_name').eq('organization_id', org).in('id', ids)
      : { data: [] as Array<{ id: string; full_name: string }> };
    const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));
    const fenceProject = new Map(((fences.data ?? []) as Array<{ id: string; project_id: string }>).map((f) => [f.id, f.project_id]));
    team = Array.from(latest.values()).map((e) => ({
      personId: e.person_id, name: names.get(e.person_id) ?? 'Pessoa', lat: e.latitude, lng: e.longitude,
      at: e.captured_at_device, integrity: e.integrity_status, projectId: e.geofence_id ? fenceProject.get(e.geofence_id) ?? null : null,
    }));
  }

  return {
    today,
    projects: out,
    team,
    layers: { projects: true, sites: true, team: access.team, warehouses: false, vehicles: false },
    unlocated: out.filter((p) => p.active && (p.lat === null || p.lng === null)).map((p) => ({ id: p.id, name: p.name,
      state: p.locationState })),
  };
}

export type OperationsMapModel = Awaited<ReturnType<typeof operationsMap>>;
