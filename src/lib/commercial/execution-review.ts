/**
 * O PAINEL DE REVISÃO do "Fechar negócio e iniciar execução".
 *
 * Uma leitura só, com tudo o que a pessoa precisa conferir antes de
 * confirmar: cliente, PT e PC regentes, valor, escopo, datas, regra de
 * medição, divergências, base de autorização, contrato, OS e projeto — e o
 * que JÁ existe, para que o fechamento reuse em vez de duplicar.
 *
 * ─── A fronteira de leitura ──────────────────────────────────────────────
 *
 * Oportunidade, proposta, revisões, fatos, OS e início de execução são lidos
 * pelo cliente AUTENTICADO (RLS). Trabalho autorizado, fontes, divergências e
 * vínculos de projeto vivem sob `contracts.view`. Quem tem
 * `commercial.execution.start` — a alçada de CRIAR esses objetos — recebe o
 * ESTADO deles pelo servidor, e só dos objetos presos a esta oportunidade ou
 * a estas revisões, que a leitura autenticada acabou de provar visíveis.
 * Quem não tem nenhuma das duas alçadas recebe a seção marcada "restrita".
 */
if (typeof window !== 'undefined') {
  throw new Error('execution-review.ts não pode ser importado no navegador');
}

import type { CommercialSession } from './server-session';
import { hasOptionalPermission } from './server-session';
import { platformServiceClient } from '@/lib/platform/server-client';
import { resolveOwnerNames } from './owner-directory';
import { governingRevision } from './pipeline-signals';

type Row = Record<string, unknown>;

export async function buildExecutionReview(
  session: CommercialSession,
  input: { opportunityId?: string | null; proposalId?: string | null },
) {
  const org = session.organizationId;
  const sb = session.supabase;

  let opportunityId = input.opportunityId ?? null;
  if (!opportunityId && input.proposalId) {
    const { data } = await sb.from('commercial_proposals').select('opportunity_id')
      .eq('organization_id', org).eq('id', input.proposalId).maybeSingle();
    opportunityId = (data as { opportunity_id?: string | null } | null)?.opportunity_id ?? null;
  }

  const opportunity = opportunityId
    ? ((await sb.from('commercial_opportunities')
        .select('id,title,code,counterparty_name,party_id,stage,estimated_value,currency,engagement_id,owner_user_id')
        .eq('organization_id', org).eq('id', opportunityId).maybeSingle()).data as Row | null)
    : null;

  const proposalQuery = sb.from('commercial_proposals')
    .select('id,proposal_number,kind,title,counterparty_name,party_id,currency,opportunity_id')
    .eq('organization_id', org);
  const { data: proposalData } = opportunity
    ? await proposalQuery.eq('opportunity_id', opportunity.id as string)
    : input.proposalId ? await proposalQuery.eq('id', input.proposalId) : { data: [] };
  const proposals = (proposalData ?? []) as Array<Row & { id: string; kind: string }>;
  if (!opportunity && !proposals.length) return null;

  const proposalIds = proposals.map((p) => p.id);
  const { data: revisionData } = proposalIds.length
    ? await sb.from('commercial_proposal_revisions')
        .select('id,proposal_id,revision,status,total_value,currency,validity_until,payment_terms,'
          + 'scope_summary,acceptance_conditions,accepted_at,acceptance_source,sent_at,created_at')
        .eq('organization_id', org).in('proposal_id', proposalIds).order('revision', { ascending: false })
    : { data: [] };
  const revisions = (revisionData ?? []) as unknown as Array<Row & {
    id: string; proposal_id: string; revision: number; status: string;
  }>;
  const governing = governingRevision(revisions);
  const governingIds = Array.from(governing.values()).map((r) => r.id);

  const partyId = (opportunity?.party_id as string | null) ?? (proposals[0]?.party_id as string | null) ?? null;
  const [party, facts, surveys, start] = await Promise.all([
    partyId
      ? sb.from('parties').select('id,legal_name,trade_name,document_number')
          .eq('organization_id', org).eq('id', partyId).maybeSingle()
      : Promise.resolve({ data: null }),
    governingIds.length
      ? sb.from('commercial_extracted_facts')
          .select('id,subject_id,fact_domain,label,value_text,value_numeric,value_date,unit,currency,'
            + 'source_page,source_quote,provenance_state,confirmation_state,corrected_value')
          .eq('organization_id', org).in('subject_id', governingIds)
          .in('fact_domain', ['SCOPE', 'DELIVERABLE', 'DATE', 'MILESTONE', 'MEASUREMENT_RULE',
            'BILLING_MILESTONE', 'BILLING_PREREQUISITE', 'PAYMENT_TERM', 'DEPENDENCY', 'RISK', 'EXCLUSION'])
          .neq('confirmation_state', 'REJECTED').limit(200)
      : Promise.resolve({ data: [] }),
    opportunity
      ? sb.from('commercial_site_surveys').select('id,code,status,site_name,site_address')
          .eq('organization_id', org).eq('opportunity_id', opportunity.id as string)
      : Promise.resolve({ data: [] }),
    opportunity
      ? sb.from('commercial_execution_starts').select('*')
          .eq('organization_id', org).eq('opportunity_id', opportunity.id as string).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // ── Trabalho autorizado e o que pende dele ─────────────────────────────
  const canSeeContracts = await hasOptionalPermission(session, 'contracts.view');
  const canStart = await hasOptionalPermission(session, 'commercial.execution.start');
  const reader = canSeeContracts ? sb : canStart ? platformServiceClient() : null;

  let engagement: Row | null = null;
  let authorizations: Row[] = [];
  let divergences: Row[] = [];
  let serviceOrders: Row[] = [];
  let projectLinks: Row[] = [];
  let contract: Row | null = null;

  if (reader) {
    let engagementId = (opportunity?.engagement_id as string | null)
      ?? ((start.data as Row | null)?.engagement_id as string | null) ?? null;
    if (!engagementId && revisions.length) {
      const { data } = await reader.from('commercial_engagement_authorizations').select('engagement_id')
        .eq('organization_id', org).eq('state', 'ACTIVE')
        .in('proposal_revision_id', revisions.map((r) => r.id)).limit(1);
      engagementId = ((data ?? [])[0] as { engagement_id?: string } | undefined)?.engagement_id ?? null;
    }
    if (engagementId) {
      const [eng, auths, divs, orders, links] = await Promise.all([
        reader.from('commercial_engagements')
          .select('id,engagement_number,title,status,authorized_value,currency,authorized_at,origin')
          .eq('organization_id', org).eq('id', engagementId).maybeSingle(),
        reader.from('commercial_engagement_authorizations')
          .select('id,source_kind,contract_id,proposal_revision_id,external_reference,authorized_value,currency,governing,state,created_at')
          .eq('organization_id', org).eq('engagement_id', engagementId),
        reader.from('commercial_divergences')
          .select('id,scope,severity,summary,state,left_source_kind,left_value,right_source_kind,right_value,service_order_id')
          .eq('organization_id', org).eq('engagement_id', engagementId).eq('state', 'OPEN'),
        reader.from('internal_service_orders')
          .select('id,os_number,title,origin,status,authorized_value,currency,project_id,planned_start,planned_finish,issued_at')
          .eq('organization_id', org).eq('engagement_id', engagementId),
        reader.from('engagement_project_links').select('project_id,created_at')
          .eq('organization_id', org).eq('engagement_id', engagementId),
      ]);
      engagement = (eng.data as Row | null) ?? null;
      authorizations = (auths.data ?? []) as Row[];
      divergences = (divs.data ?? []) as Row[];
      serviceOrders = (orders.data ?? []) as Row[];
      projectLinks = (links.data ?? []) as Row[];
      const contractId = authorizations.find((a) => a.governing && a.contract_id)?.contract_id as string | undefined
        ?? authorizations.find((a) => a.contract_id)?.contract_id as string | undefined;
      if (contractId) {
        contract = ((await reader.from('contracts').select('id,contract_number,title,status')
          .eq('organization_id', org).eq('id', contractId).maybeSingle()).data as Row | null) ?? null;
      }
    }
  }

  // Projetos que podem ser vinculados — só os que a sessão já enxerga.
  const canSeeProjects = await hasOptionalPermission(session, 'projects.view')
    || await hasOptionalPermission(session, 'projects.view_all');
  const { data: projectData } = canSeeProjects
    ? await sb.from('projects').select('id,project,created_at').eq('organization_id', org)
        .order('created_at', { ascending: false }).limit(60)
    : { data: [] };
  const linkedIds = new Set(projectLinks.map((l) => l.project_id as string));
  const projects = ((projectData ?? []) as Array<{ id: string; project: Row | null }>).map((p) => ({
    id: p.id,
    name: String(p.project?.nome ?? p.project?.name ?? p.id),
    client: (p.project?.cliente as string | undefined) ?? null,
    code: (p.project?.codigo as string | undefined) ?? null,
    linked: linkedIds.has(p.id),
  }));

  const startRow = (start.data as Row | null) ?? null;
  const owners = await resolveOwnerNames(org, [
    opportunity?.owner_user_id as string | null,
    startRow?.confirmed_by as string | null, startRow?.internal_authorizer_user_id as string | null,
    startRow?.regularization_owner_user_id as string | null,
  ]);

  const permissions = {
    canStart,
    canStartExceptional: await hasOptionalPermission(session, 'commercial.execution.start_exceptional'),
    canRecordAcceptance: await hasOptionalPermission(session, 'commercial.proposals.record_acceptance'),
    canManageServiceOrders: await hasOptionalPermission(session, 'commercial.service_orders.manage'),
    canBindProject: await hasOptionalPermission(session, 'commercial.service_orders.bind_project')
      && await hasOptionalPermission(session, 'projects.create'),
    canRegularize: await hasOptionalPermission(session, 'commercial.engagements.manage'),
  };

  return {
    opportunity,
    party: party.data ?? null,
    proposals,
    revisions,
    governing: Object.fromEntries(governing),
    facts: facts.data ?? [],
    surveys: surveys.data ?? [],
    executionStart: startRow,
    engagement,
    authorizations,
    divergences,
    serviceOrders,
    projectLinks,
    contract,
    projects,
    owners,
    permissions,
    visibility: {
      execution: reader ? (canSeeContracts ? 'full' : 'status') : 'restricted',
      projects: canSeeProjects ? 'visible' : 'restricted',
    },
  };
}

export type ExecutionReview = NonNullable<Awaited<ReturnType<typeof buildExecutionReview>>>;
