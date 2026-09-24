/**
 * FILA GLOBAL de Medições & Evidências (Operações) — um RECORTE da medição
 * canônica, pela pergunta "quem tem o próximo passo". Mesmos ids, mesmo
 * estado, mesma história: a linha abre a aba Medições do projeto no marco.
 *
 * Global = fila do portfólio. Aba do projeto = contexto. Nenhum dos dois tem
 * estado próprio, e por isso nenhum dos dois pode discordar do outro.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/measurements-queue.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MeasurementStatus, ReadinessState } from '@/lib/projects/measurements/types';
import { MEASUREMENT_STATUS_LABEL } from '@/lib/projects/measurements/types';
import { measurementHref } from '@/lib/projects/cross-module-links';
import { projectIdentity } from './project-identity';
import { isOperationalMeasurementPending, measurementLane, type MeasurementLane } from './overview-rules';

export interface MeasurementQueueRow {
  id: string;
  projectId: string;
  project: string;
  client: string | null;
  occurrenceKey: string;
  activity: string | null;
  status: MeasurementStatus;
  statusLabel: string;
  lane: MeasurementLane;
  expectedAt: string | null;
  customerDueAt: string | null;
  readiness: ReadinessState | null;
  pendingForOperations: boolean;
  /** Nulo quando a pessoa não tem leitura financeira — nunca zero. */
  value: number | null;
  currency: string | null;
  href: string;
}

export async function measurementsQueue(
  session: { supabase: SupabaseClient; organizationId: string }, canSeeValues: boolean, today: string,
): Promise<MeasurementQueueRow[]> {
  const org = session.organizationId;
  const sb = session.supabase;
  const { data, error } = await sb.from('project_measurements')
    .select('id,project_id,occurrence_key,timeline_item_id,milestone_id,status,expected_at,customer_due_at,measured_value,accepted_value,currency')
    .eq('organization_id', org).not('status', 'in', '(CANCELLED,SUPERSEDED)')
    .order('expected_at', { ascending: true, nullsFirst: false }).limit(2000);
  if (error) throw new Error('Não foi possível consultar as medições.');
  const rows = (data ?? []) as Array<{ id: string; project_id: string; occurrence_key: string; timeline_item_id: string | null;
    milestone_id: string | null; status: MeasurementStatus; expected_at: string | null; customer_due_at: string | null;
    measured_value: string | null; accepted_value: string | null; currency: string | null }>;
  if (!rows.length) return [];

  const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
  const itemIds = Array.from(new Set(rows.map((r) => r.timeline_item_id).filter(Boolean))) as string[];
  const [projects, items, readiness] = await Promise.all([
    sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', projectIds),
    itemIds.length ? sb.from('project_timeline_items').select('id,title').eq('organization_id', org).in('id', itemIds)
      : Promise.resolve({ data: [] }),
    sb.from('project_measurement_readiness_cache').select('measurement_id,overall').eq('organization_id', org)
      .in('measurement_id', rows.map((r) => r.id)),
  ]);
  const projectMap = new Map(((projects.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2)]));
  const itemTitle = new Map(((items.data ?? []) as Array<{ id: string; title: string }>).map((i) => [i.id, i.title]));
  const ready = new Map(((readiness.data ?? []) as Array<{ measurement_id: string; overall: ReadinessState }>)
    .map((r) => [r.measurement_id, r.overall]));

  return rows.map((r) => {
    const p = projectMap.get(r.project_id);
    return {
      id: r.id, projectId: r.project_id, project: p?.name ?? r.project_id, client: p?.client ?? null,
      occurrenceKey: r.occurrence_key, activity: r.timeline_item_id ? itemTitle.get(r.timeline_item_id) ?? null : null,
      status: r.status, statusLabel: MEASUREMENT_STATUS_LABEL[r.status], lane: measurementLane(r.status),
      expectedAt: r.expected_at, customerDueAt: r.customer_due_at,
      readiness: ready.get(r.id) ?? null,
      pendingForOperations: isOperationalMeasurementPending(r.status, r.expected_at, today),
      value: canSeeValues ? Number(r.status === 'ACCEPTED' ? (r.accepted_value ?? r.measured_value ?? 0) : (r.measured_value ?? 0)) || null : null,
      currency: canSeeValues ? r.currency : null,
      href: measurementHref(r.project_id, r.milestone_id),
    };
  });
}
