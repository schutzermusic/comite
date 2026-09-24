/**
 * READ MODELS da OS em Operações — lista, workspace e pacotes elegíveis.
 *
 * ─── De onde vem cada coisa ─────────────────────────────────────────────
 *
 * A OS, as linhas, as revisões e as divergências DA OS são lidas pelo
 * cliente AUTENTICADO: a RLS (230) é a fronteira. O que dá contexto e mora em
 * tabelas comerciais que `operations.view` não enxerga (título do trabalho,
 * cliente, número da PT/PC, aceite do pacote, divergência no nível do
 * engajamento que também segura a emissão) vem pelo service role — SEMPRE
 * filtrado pela organização ATIVA da sessão, depois de a rota decidir a
 * permissão. Nenhum desses campos é gravado: é composição de leitura.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/service-orders/read-model.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { platformServiceClient } from '@/lib/platform/server-client';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import type { ServiceOrderOrigin, ServiceOrderStatus } from '@/lib/commercial/types';
import { projectIdentity } from '../project-identity';
import type { PackageFact } from './comparison';
import { serviceOrderNextAction } from './next-action';
import type {
  EligiblePackage, PackageRevisionRef, ServiceOrderCounts, ServiceOrderDivergence,
  ServiceOrderItem, ServiceOrderListRow, ServiceOrderPackage,
} from './types';

type Session = { supabase: SupabaseClient; organizationId: string };

const OS_COLUMNS = 'id,engagement_id,os_number,title,origin,status,authorized_value,currency,'
  + 'scope_summary,site_label,planned_start,planned_finish,project_id,source_proposal_revision_id,'
  + 'source_context_acceptance_id,governing_technical_revision_id,governing_commercial_revision_id,'
  + 'governing_combined_revision_id,document_id,issued_at,issued_by,responsible_user_id,notes,created_at,updated_at';

export interface ServiceOrderRecord {
  id: string; engagement_id: string; os_number: string; title: string;
  origin: ServiceOrderOrigin; status: ServiceOrderStatus;
  authorized_value: string | null; currency: string | null;
  scope_summary: string | null; site_label: string | null;
  planned_start: string | null; planned_finish: string | null;
  project_id: string | null; source_proposal_revision_id: string | null;
  source_context_acceptance_id: string | null;
  governing_technical_revision_id: string | null;
  governing_commercial_revision_id: string | null;
  governing_combined_revision_id: string | null;
  document_id: string | null; issued_at: string | null; issued_by: string | null;
  responsible_user_id: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

const svc = () => platformServiceClient();

interface HistoryRow {
  id: string; transition: string; from_state: string | null; to_state: string | null;
  actor_user_id: string | null; note: string | null; provenance: Record<string, unknown> | null; occurred_at: string;
}

// ---------------------------------------------------------------------------
// Blocos de contexto (service role, sempre com a organização)
// ---------------------------------------------------------------------------

async function engagementsById(org: string, ids: string[]) {
  const map = new Map<string, { title: string | null; counterparty_name: string | null; status: string | null }>();
  if (!ids.length) return map;
  const { data } = await svc().from('commercial_engagements')
    .select('id,title,counterparty_name,status').eq('organization_id', org).in('id', ids);
  for (const row of data ?? []) map.set(row.id, row);
  return map;
}

export async function revisionRefs(org: string, ids: string[]): Promise<Map<string, PackageRevisionRef>> {
  const map = new Map<string, PackageRevisionRef>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return map;
  const { data } = await svc().from('commercial_proposal_revisions')
    .select('id,revision,status,proposal_id,commercial_proposals!inner(proposal_number,kind)')
    .eq('organization_id', org).in('id', unique);
  for (const row of (data ?? []) as unknown as Array<{
    id: string; revision: number; status: string; proposal_id: string;
    commercial_proposals: { proposal_number: string; kind: 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED' };
  }>) {
    map.set(row.id, {
      revisionId: row.id, proposalId: row.proposal_id, revision: row.revision, status: row.status,
      proposalNumber: row.commercial_proposals.proposal_number, kind: row.commercial_proposals.kind,
    });
  }
  return map;
}

export function packageLabel(refs: Array<PackageRevisionRef | null | undefined>): string | null {
  const parts = refs.filter((r): r is PackageRevisionRef => !!r)
    .map((r) => `${r.proposalNumber} R${String(r.revision).padStart(2, '0')}`);
  return parts.length ? parts.join(' + ') : null;
}

/**
 * Contagens com a MESMA regra do portão: divergência BLOCKING aberta da OS
 * ou do engajamento dela, menos as nomeadas numa exceção desta OS.
 */
export async function countsFor(org: string, orders: Array<{ id: string; engagement_id: string }>) {
  const counts = new Map<string, ServiceOrderCounts>();
  for (const o of orders) counts.set(o.id, { items: 0, unreviewedItems: 0, openDivergences: 0, blockingOpen: 0 });
  if (!orders.length) return counts;
  const ids = orders.map((o) => o.id);
  const engagementIds = Array.from(new Set(orders.map((o) => o.engagement_id)));

  const [items, divergences, exceptions] = await Promise.all([
    svc().from('internal_service_order_items').select('service_order_id,confirmation_state')
      .eq('organization_id', org).in('service_order_id', ids),
    svc().from('commercial_divergences').select('id,service_order_id,engagement_id,severity,state')
      .eq('organization_id', org).eq('state', 'OPEN')
      .or(`service_order_id.in.(${ids.join(',')}),engagement_id.in.(${engagementIds.join(',')})`),
    svc().from('internal_service_order_issue_exceptions').select('service_order_id,divergence_ids')
      .eq('organization_id', org).in('service_order_id', ids),
  ]);

  for (const row of items.data ?? []) {
    const c = counts.get(row.service_order_id);
    if (!c) continue;
    c.items += 1;
    if (row.confirmation_state === 'UNCONFIRMED') c.unreviewedItems += 1;
  }
  const waived = new Map<string, Set<string>>();
  for (const e of exceptions.data ?? []) {
    const set = waived.get(e.service_order_id) ?? new Set<string>();
    for (const id of (e.divergence_ids as string[]) ?? []) set.add(id);
    waived.set(e.service_order_id, set);
  }
  for (const o of orders) {
    const c = counts.get(o.id)!;
    for (const d of divergences.data ?? []) {
      const mine = d.service_order_id === o.id || (d.service_order_id === null && d.engagement_id === o.engagement_id);
      if (!mine) continue;
      c.openDivergences += 1;
      if (d.severity === 'BLOCKING' && !waived.get(o.id)?.has(d.id)) c.blockingOpen += 1;
    }
  }
  return counts;
}

async function projectsById(org: string, ids: string[]) {
  const map = new Map<string, ReturnType<typeof projectIdentity>>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return map;
  const { data } = await svc().from('projects').select('id,project,project_v2')
    .eq('organization_id', org).in('id', unique);
  for (const row of data ?? []) map.set(row.id, projectIdentity(row.id, row.project, row.project_v2));
  return map;
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
export async function listServiceOrders(session: Session): Promise<ServiceOrderListRow[]> {
  const { data, error } = await session.supabase.from('internal_service_orders')
    .select(OS_COLUMNS).eq('organization_id', session.organizationId)
    .order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error('Não foi possível consultar as ordens de serviço.');
  const orders = (data ?? []) as unknown as ServiceOrderRecord[];
  const org = session.organizationId;

  const [engagements, refs, counts, projects, owners] = await Promise.all([
    engagementsById(org, Array.from(new Set(orders.map((o) => o.engagement_id)))),
    revisionRefs(org, orders.flatMap((o) => [o.governing_technical_revision_id, o.governing_commercial_revision_id,
      o.governing_combined_revision_id, o.source_proposal_revision_id].filter(Boolean) as string[])),
    countsFor(org, orders),
    projectsById(org, orders.map((o) => o.project_id).filter(Boolean) as string[]),
    resolveOwnerNames(org, orders.map((o) => o.responsible_user_id)),
  ]);

  return orders.map((o) => {
    const eng = engagements.get(o.engagement_id);
    const pkg = [o.governing_technical_revision_id, o.governing_commercial_revision_id, o.governing_combined_revision_id]
      .map((id) => (id ? refs.get(id) : null));
    return {
      id: o.id, engagementId: o.engagement_id, osNumber: o.os_number, title: o.title,
      origin: o.origin, status: o.status, authorizedValue: o.authorized_value, currency: o.currency,
      plannedStart: o.planned_start, plannedFinish: o.planned_finish,
      customer: eng?.counterparty_name ?? null, engagementTitle: eng?.title ?? null,
      packageLabel: packageLabel(pkg) ?? packageLabel([o.source_proposal_revision_id ? refs.get(o.source_proposal_revision_id) : null]),
      projectId: o.project_id, projectName: o.project_id ? projects.get(o.project_id)?.name ?? o.project_id : null,
      ownerName: o.responsible_user_id ? owners[o.responsible_user_id] ?? null : null,
      issuedAt: o.issued_at, createdAt: o.created_at,
      counts: counts.get(o.id)!,
    };
  });
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServiceOrderWorkspace(session: Session, id: string) {
  const org = session.organizationId;
  // O id entra num filtro `.or()`: só UUID passa, nada de sintaxe de filtro.
  if (!UUID_RE.test(id)) return null;
  const { data: row, error } = await session.supabase.from('internal_service_orders')
    .select(OS_COLUMNS).eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) throw new Error('Não foi possível consultar a ordem de serviço.');
  if (!row) return null;
  const os = row as unknown as ServiceOrderRecord;

  const [itemsRes, divergencesRes, revisionsRes, exceptionsRes, engagements, counts] = await Promise.all([
    session.supabase.from('internal_service_order_items')
      .select('id,kind,position,title,detail,quantity,unit,planned_date,origin,source_document_kind,source_revision_id,'
        + 'source_fact_id,source_document_id,source_page,source_quote,ai_provider,ai_model,confidence,'
        + 'confirmation_state,confirmed_by,confirmed_at')
      .eq('organization_id', org).eq('service_order_id', id).order('position'),
    svc().from('commercial_divergences')
      .select('id,scope,field_path,left_source_kind,left_value,right_source_kind,right_value,severity,summary,'
        + 'detected_by,ai_model,confidence,state,resolved_source_kind,resolution_note,resolved_at,created_at,service_order_id')
      .eq('organization_id', org)
      .or(`service_order_id.eq.${id},and(service_order_id.is.null,engagement_id.eq.${os.engagement_id})`)
      .order('created_at', { ascending: false }),
    session.supabase.from('internal_service_order_revisions')
      .select('id,revision,kind,reason,actor_user_id,created_at,snapshot')
      .eq('organization_id', org).eq('service_order_id', id).order('revision', { ascending: false }),
    session.supabase.from('internal_service_order_issue_exceptions')
      .select('id,divergence_ids,reason,authorized_by,authorized_permission,created_at,evidence_document_id')
      .eq('organization_id', org).eq('service_order_id', id),
    engagementsById(org, [os.engagement_id]),
    countsFor(org, [os]),
  ]);

  const [refs, acceptance, governing, history, documents, project, events] = await Promise.all([
    revisionRefs(org, [os.governing_technical_revision_id, os.governing_commercial_revision_id,
      os.governing_combined_revision_id, os.source_proposal_revision_id].filter(Boolean) as string[]),
    os.source_context_acceptance_id
      ? svc().from('commercial_proposal_context_acceptances')
          .select('id,accepted_at,acceptance_source,acceptance_external_ref,recorded_by')
          .eq('organization_id', org).eq('id', os.source_context_acceptance_id).maybeSingle()
      : Promise.resolve({ data: null }),
    svc().from('commercial_engagement_authorizations')
      .select('id,source_kind,proposal_revision_id,authorized_value,currency,effective_from,effective_until,external_reference')
      .eq('organization_id', org).eq('engagement_id', os.engagement_id).eq('governing', true).eq('state', 'ACTIVE')
      .maybeSingle(),
    svc().from('commercial_engagement_history')
      .select('id,transition,from_state,to_state,actor_user_id,note,provenance,occurred_at')
      .eq('organization_id', org).eq('engagement_id', os.engagement_id)
      .order('occurred_at', { ascending: false }).limit(80),
    documentsFor(org, os),
    os.project_id ? projectsById(org, [os.project_id]) : Promise.resolve(new Map()),
    svc().from('domain_events').select('id,event_type,occurred_at,actor_user_id,payload')
      .eq('organization_id', org).eq('aggregate_type', 'internal_service_order').eq('aggregate_id', id)
      .order('occurred_at', { ascending: false }).limit(50),
  ]);

  /*
    OS importada (ou avulsa) não aponta revisões do pacote: o pacote regente é o
    do TRABALHO AUTORIZADO — o aceite que contém a revisão da fonte regente, a
    mesma que o confronto por regra usa. Só leitura; a OS não é alterada.
  */
  const osRevisions = [os.governing_technical_revision_id, os.governing_commercial_revision_id,
    os.governing_combined_revision_id].filter(Boolean) as string[];
  const governingRevision = (governing.data as { proposal_revision_id?: string | null } | null)?.proposal_revision_id ?? null;
  const derivedAcceptance = !osRevisions.length && governingRevision && UUID_RE.test(governingRevision)
    ? ((await svc().from('commercial_proposal_context_acceptances')
      .select('id,technical_revision_id,commercial_revision_id,combined_revision_id,accepted_at,acceptance_source,acceptance_external_ref')
      .eq('organization_id', org)
      .or(`technical_revision_id.eq.${governingRevision},commercial_revision_id.eq.${governingRevision},combined_revision_id.eq.${governingRevision}`)
      .order('accepted_at', { ascending: false }).limit(1).maybeSingle()).data as {
        id: string; technical_revision_id: string | null; commercial_revision_id: string | null; combined_revision_id: string | null;
        accepted_at: string | null; acceptance_source: string | null; acceptance_external_ref: string | null } | null)
    : null;
  const derivedRevisions = derivedAcceptance
    ? [derivedAcceptance.technical_revision_id, derivedAcceptance.commercial_revision_id, derivedAcceptance.combined_revision_id].filter(Boolean) as string[]
    : [];
  const derivedRefs = derivedRevisions.length ? await revisionRefs(org, derivedRevisions) : new Map<string, PackageRevisionRef>();

  // Os FATOS da PT e da PC regentes: o outro lado da comparação OS × PT × PC.
  const governingRevisions = osRevisions.length ? osRevisions : derivedRevisions;
  const packageFacts = governingRevisions.length
    ? ((await svc().from('commercial_extracted_facts')
      .select('id,document_context,fact_domain,label,value_text,value_numeric,value_date,unit,currency,source_page,source_quote,'
        + 'confidence,extraction_method,ai_model,confirmation_state')
      .eq('organization_id', org).eq('subject_kind', 'proposal_revision').in('subject_id', governingRevisions)
      .order('created_at', { ascending: true }).limit(400)).data ?? []) as unknown as PackageFact[]
    : [];

  const items = (itemsRes.data ?? []) as unknown as ServiceOrderItem[];
  const divergences = (divergencesRes.data ?? []) as unknown as ServiceOrderDivergence[];
  const revisions = (revisionsRes.data ?? []) as Array<{ id: string; revision: number; kind: string; reason: string | null;
    actor_user_id: string | null; created_at: string; snapshot: Record<string, unknown> }>;
  const exceptions = exceptionsRes.data ?? [];
  const historyRows = ((history.data ?? []) as HistoryRow[])
    .filter((h) => !h.provenance || !('service_order_id' in h.provenance) || h.provenance.service_order_id === id);

  const people = await resolveOwnerNames(org, [
    os.responsible_user_id, os.issued_by,
    ...items.map((i) => i.confirmed_by), ...revisions.map((r) => r.actor_user_id),
    ...exceptions.map((e) => e.authorized_by as string),
    ...historyRows.map((h) => h.actor_user_id),
    (acceptance.data as { recorded_by?: string } | null)?.recorded_by,
  ]);

  const pkg: ServiceOrderPackage = derivedAcceptance ? {
    acceptanceId: derivedAcceptance.id, acceptedAt: derivedAcceptance.accepted_at,
    acceptanceSource: derivedAcceptance.acceptance_source, acceptanceExternalRef: derivedAcceptance.acceptance_external_ref,
    technical: derivedAcceptance.technical_revision_id ? derivedRefs.get(derivedAcceptance.technical_revision_id) ?? null : null,
    commercial: derivedAcceptance.commercial_revision_id ? derivedRefs.get(derivedAcceptance.commercial_revision_id) ?? null : null,
    combined: derivedAcceptance.combined_revision_id ? derivedRefs.get(derivedAcceptance.combined_revision_id) ?? null : null,
    fromAuthorization: true,
  } : {
    acceptanceId: os.source_context_acceptance_id,
    acceptedAt: (acceptance.data as { accepted_at?: string } | null)?.accepted_at ?? null,
    acceptanceSource: (acceptance.data as { acceptance_source?: string } | null)?.acceptance_source ?? null,
    acceptanceExternalRef: (acceptance.data as { acceptance_external_ref?: string } | null)?.acceptance_external_ref ?? null,
    technical: os.governing_technical_revision_id ? refs.get(os.governing_technical_revision_id) ?? null : null,
    commercial: os.governing_commercial_revision_id ? refs.get(os.governing_commercial_revision_id) ?? null : null,
    combined: os.governing_combined_revision_id ? refs.get(os.governing_combined_revision_id) ?? null : null,
  };
  const c = counts.get(os.id)!;
  const eng = engagements.get(os.engagement_id) ?? null;

  return {
    order: os,
    engagement: eng ? { id: os.engagement_id, ...eng } : null,
    package: pkg,
    sourceRevision: os.source_proposal_revision_id ? refs.get(os.source_proposal_revision_id) ?? null : null,
    governingAuthorization: governing.data ?? null,
    items,
    divergences,
    packageFacts,
    revisions: revisions.map((r) => ({ ...r, actorName: r.actor_user_id ? people[r.actor_user_id] ?? null : null })),
    exceptions: exceptions.map((e) => ({ ...e, authorizedByName: people[e.authorized_by as string] ?? null })),
    history: historyRows.map((h) => ({ ...h, actorName: h.actor_user_id ? people[h.actor_user_id] ?? null : null })),
    events: events.data ?? [],
    documents,
    project: os.project_id ? project.get(os.project_id) ?? { id: os.project_id, name: os.project_id } : null,
    people,
    counts: c,
    nextAction: serviceOrderNextAction(os.status, os.project_id, c),
  };
}

export type ServiceOrderWorkspace = NonNullable<Awaited<ReturnType<typeof getServiceOrderWorkspace>>>;

/**
 * Documentos DA OS: o PDF carregado, os documentos das revisões do pacote e
 * a evidência de aceite. Mesmo acervo (`contract_documents`) — nenhuma cópia.
 */
async function documentsFor(org: string, os: ServiceOrderRecord) {
  const revisionIds = [os.governing_technical_revision_id, os.governing_commercial_revision_id,
    os.governing_combined_revision_id].filter(Boolean) as string[];
  const docIds = new Set<string>();
  if (os.document_id) docIds.add(os.document_id);
  if (revisionIds.length) {
    const { data } = await svc().from('commercial_proposal_revisions').select('document_id,acceptance_document_id')
      .eq('organization_id', org).in('id', revisionIds);
    for (const r of data ?? []) {
      if (r.document_id) docIds.add(r.document_id);
      if (r.acceptance_document_id) docIds.add(r.acceptance_document_id);
    }
  }
  if (!docIds.size) return [];
  const { data } = await svc().from('contract_documents')
    .select('id,title,document_type,status,version,created_at,content_sha256')
    .eq('organization_id', org).in('id', Array.from(docIds));
  return (data ?? []).map((d) => ({ ...d, role: d.id === os.document_id ? 'service_order' : 'package' }));
}

// ---------------------------------------------------------------------------
// Pacotes aceitos elegíveis para "Gerar a partir de proposta"
// ---------------------------------------------------------------------------
export async function listEligiblePackages(organizationId: string): Promise<EligiblePackage[]> {
  const { data: acceptances } = await svc().from('commercial_proposal_context_acceptances')
    .select('id,context_id,technical_revision_id,commercial_revision_id,combined_revision_id,accepted_at,complete')
    .eq('organization_id', organizationId).eq('complete', true)
    .order('accepted_at', { ascending: false }).limit(200);
  // A linha MAIS RECENTE de cada contexto é o aceite regente.
  const latest = new Map<string, NonNullable<typeof acceptances>[number]>();
  for (const a of acceptances ?? []) if (!latest.has(a.context_id)) latest.set(a.context_id, a);
  const rows = Array.from(latest.values());
  if (!rows.length) return [];

  const revisionIds = rows.flatMap((a) => [a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id])
    .filter(Boolean) as string[];
  const [refs, revisions, authorizations, orders, proposals] = await Promise.all([
    revisionRefs(organizationId, revisionIds),
    svc().from('commercial_proposal_revisions').select('id,total_value,currency')
      .eq('organization_id', organizationId).in('id', revisionIds),
    svc().from('commercial_engagement_authorizations').select('engagement_id,proposal_revision_id,governing,created_at')
      .eq('organization_id', organizationId).eq('state', 'ACTIVE').in('proposal_revision_id', revisionIds),
    svc().from('internal_service_orders').select('id,os_number,source_context_acceptance_id,status')
      .eq('organization_id', organizationId).in('source_context_acceptance_id', rows.map((a) => a.id)).neq('status', 'CANCELLED'),
    svc().from('commercial_proposals').select('id,title,counterparty_name,context_id')
      .eq('organization_id', organizationId).in('context_id', rows.map((a) => a.context_id)),
  ]);
  const values = new Map((revisions.data ?? []).map((r) => [r.id, r]));
  const engagementIds = Array.from(new Set((authorizations.data ?? []).map((a) => a.engagement_id)));
  const engagements = await engagementsById(organizationId, engagementIds);

  return rows.map((a) => {
    const ids = [a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id].filter(Boolean) as string[];
    const auth = (authorizations.data ?? [])
      .filter((x) => ids.includes(x.proposal_revision_id))
      .sort((x, y) => Number(y.governing) - Number(x.governing) || y.created_at.localeCompare(x.created_at))[0];
    const order = (orders.data ?? []).find((o) => o.source_context_acceptance_id === a.id);
    const valueRev = values.get(a.commercial_revision_id ?? a.combined_revision_id ?? a.technical_revision_id ?? '');
    const stale = ids.some((rid) => refs.get(rid)?.status !== 'ACCEPTED');
    const proposal = (proposals.data ?? []).find((p) => p.context_id === a.context_id);
    const eng = auth ? engagements.get(auth.engagement_id) : undefined;
    return {
      acceptanceId: a.id, contextId: a.context_id, acceptedAt: a.accepted_at,
      customer: proposal?.counterparty_name ?? eng?.counterparty_name ?? null,
      title: proposal?.title ?? eng?.title ?? null,
      technical: a.technical_revision_id ? refs.get(a.technical_revision_id) ?? null : null,
      commercial: a.commercial_revision_id ? refs.get(a.commercial_revision_id) ?? null : null,
      combined: a.combined_revision_id ? refs.get(a.combined_revision_id) ?? null : null,
      totalValue: valueRev?.total_value ?? null, currency: valueRev?.currency ?? null,
      engagementId: auth?.engagement_id ?? null, engagementTitle: eng?.title ?? null,
      engagementStatus: eng?.status ?? null,
      serviceOrderId: order?.id ?? null, serviceOrderNumber: order?.os_number ?? null,
      blocker: stale ? 'STALE' : !auth ? 'NO_ENGAGEMENT' : null,
    };
  });
}

/** Trabalhos autorizados onde uma OS pode ser IMPORTADA. */
export async function listImportTargets(organizationId: string) {
  const { data } = await svc().from('commercial_engagements')
    .select('id,title,counterparty_name,status,authorized_value,currency')
    .eq('organization_id', organizationId).in('status', ['AUTHORIZED', 'UNDER_ANALYSIS'])
    .order('created_at', { ascending: false }).limit(200);
  return data ?? [];
}
