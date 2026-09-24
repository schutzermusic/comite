import { NextResponse } from 'next/server';
import {
  requireCommercialSession, isSessionError, hasOptionalPermission,
} from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { loadContextMembers, type ProposalRecord } from '@/lib/commercial/proposal-context-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O DOSSIÊ de uma proposta.
 *
 * Técnica e comercial, todas as revisões, a que está regendo, os documentos, os
 * fatos lidos do PDF com página e trecho, valor, condição de pagamento, regra de
 * medição, validade, estado do aceite, divergências abertas e a passagem para a
 * Ordem de Serviço interna.
 *
 * ─── A fronteira de permissão, dita em voz alta ──────────────────────────
 *
 * Divergência, OS interna e trabalho autorizado vivem sob `contracts.view`
 * (197/200). Quem tem só alçada comercial continua vendo a proposta inteira, e
 * essas três seções voltam marcadas como RESERVADAS — não vazias. A diferença
 * importa: "nenhuma divergência" e "você não pode ver as divergências" são
 * respostas opostas, e a segunda disfarçada de primeira é como um bloqueio vira
 * invisível.
 *
 * ─── O CONTEXTO (PT + PC) ─────────────────────────────────────────────────
 *
 * Abrir a PT ou a PC abre a MESMA proposta: o dossiê devolve os documentos do
 * contexto (`members`), as revisões de todos (`contextRevisions`, histórias
 * independentes), os fatos e PDFs de todos. `revisions` continua sendo só as
 * do documento aberto, para quem já consumia assim.
 *
 * Nada aqui escreve, e toda leitura passa pelo cliente autenticado.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const { data: proposalRow, error } = await session.supabase
    .from('commercial_proposals')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: 'Não foi possível ler a proposta.' }, { status: 500 });
  }
  if (!proposalRow) {
    return NextResponse.json({ ok: false, error: 'Proposta não encontrada.' }, { status: 404 });
  }
  const proposal = proposalRow as unknown as ProposalRecord & {
    opportunity_id: string | null; party_id: string | null; currency: string;
    owner_user_id: string | null; created_at: string;
  };
  const members = await loadContextMembers(session, proposal);
  const memberIds = members.map((m) => m.id);
  // A oportunidade do contexto: qualquer documento vinculado a responde.
  const contextOpportunityId = proposal.opportunity_id
    ?? members.map((m) => m.opportunity_id).find(Boolean) ?? null;

  const { data: revisionData } = await session.supabase
    .from('commercial_proposal_revisions')
    .select('id,proposal_id,revision,status,total_value,currency,validity_until,payment_terms,'
      + 'scope_summary,acceptance_conditions,document_id,internal_review_at,internally_approved_at,'
      + 'internally_approved_by,sent_at,sent_by,negotiation_at,accepted_at,acceptance_source,'
      + 'acceptance_document_id,acceptance_external_ref,acceptance_note,recorded_by,rejected_at,'
      + 'rejection_reason,expired_at,withdrawn_at,superseded_at,supersedes_id,superseded_by_id,'
      + 'created_by,created_at')
    .eq('organization_id', session.organizationId)
    .in('proposal_id', memberIds)
    .order('revision', { ascending: false });

  /*
    Estreitamento local: o cliente tipado devolve união com `GenericStringError`
    para estas tabelas. O erro de consulta já foi tratado acima; aqui a forma é
    a que a própria `select` acima declara.
  */
  const contextRevisions = (revisionData ?? []) as unknown as
    Array<Record<string, string | number | null>>;
  const revisions = contextRevisions.filter((r) => r.proposal_id === id);
  const revisionIds = contextRevisions.map((r) => String(r.id));
  const documentIds = contextRevisions
    .flatMap((r) => [r.document_id, r.acceptance_document_id])
    .filter((value): value is string => typeof value === 'string');

  /*
    Os FATOS lidos dos documentos desta proposta.
    Duas âncoras, porque a extração pode prender o fato à revisão (`subject_id`)
    ou ao arquivo (`document_id`) — e perder metade deles por escolher uma só
    faria a seção de proveniência mentir por omissão.
  */
  const factFilters: string[] = [];
  if (revisionIds.length) factFilters.push(`subject_id.in.(${revisionIds.join(',')})`);
  if (documentIds.length) factFilters.push(`document_id.in.(${documentIds.join(',')})`);

  const [facts, followups, opportunity] = await Promise.all([
    factFilters.length
      ? session.supabase.from('commercial_extracted_facts')
          .select('id,document_id,document_context,subject_kind,subject_id,fact_domain,fact_key,label,'
            + 'value_text,value_numeric,value_date,unit,currency,source_revision,source_page,'
            + 'source_section,source_quote,confidence,extraction_method,provenance_state,'
            + 'confirmation_state,corrected_value,confirmed_at')
          .eq('organization_id', session.organizationId)
          .or(factFilters.join(','))
          .limit(400)
      : Promise.resolve({ data: [] }),
    session.supabase.from('apex_followups')
      .select('id,source_kind,source_id,goal,expected_evidence,state,due_date,'
        + 'next_expected_event,next_expected_event_at,responsible_text,responsible_user_id,created_at')
      .eq('organization_id', session.organizationId)
      .eq('source_kind', 'commercial_proposal').in('source_id', memberIds)
      .order('due_date', { ascending: true, nullsFirst: false }),
    contextOpportunityId
      ? session.supabase.from('commercial_opportunities')
          .select('id,title,stage,counterparty_name,estimated_value,currency,expected_decision_date')
          .eq('organization_id', session.organizationId).eq('id', contextOpportunityId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  /*
    O PAR técnica ↔ comercial: os outros documentos do MESMO contexto, com
    as revisões e os fatos deles — compatível com quem lia `siblings`. E o
    blueprint das revisões do contexto, que é planejamento e nada mais.
  */
  const [blueprintData, startData] = await Promise.all([
    revisionIds.length
      ? session.supabase.from('commercial_execution_blueprints')
          .select('id,proposal_revision_id,status,generated_by,ai_model,created_at,'
            + 'items:commercial_execution_blueprint_items(id,category,title,detail,source_fact_id,confidence,state)')
          .eq('organization_id', session.organizationId).in('proposal_revision_id', revisionIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    contextOpportunityId
      ? session.supabase.from('commercial_execution_starts')
          .select('id,engagement_id,mode,authorization_type,authorization_date,authorization_reference,'
            + 'documentation_state,exception_reason,regularization_owner_user_id,regularization_due_date,'
            + 'regularized_at,service_order_id,project_id,confirmed_by,confirmed_at')
          .eq('organization_id', session.organizationId)
          .eq('opportunity_id', contextOpportunityId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  /*
    O LIVRO DE ACEITE do contexto (217): qual pacote exato PT + PC o cliente
    aceitou, com evidência, ator e hora. Sem a 217 a tabela não existe e a
    tela cai na regra derivada (todo documento com a regente aceita).
  */
  const acceptances = proposal.context_id
    ? ((await session.supabase.from('commercial_proposal_context_acceptances')
        .select('id,context_id,technical_revision_id,technical_status,commercial_revision_id,commercial_status,'
          + 'combined_revision_id,combined_status,complete,acceptance_source,acceptance_document_id,'
          + 'acceptance_external_ref,acceptance_note,recorded_by,accepted_at,origin')
        .eq('organization_id', session.organizationId).eq('context_id', proposal.context_id)
        .order('accepted_at', { ascending: false }).limit(20)).data ?? []) as unknown as
        Array<{ recorded_by: string | null }>
    : null;
  const siblings = members.filter((m) => m.id !== id)
    .map((m) => ({ id: m.id, proposal_number: m.proposal_number, kind: m.kind, title: m.title, currency: m.currency ?? 'BRL' }));
  const siblingRevisions = contextRevisions.filter((r) => r.proposal_id !== id);
  const siblingRevisionIds = new Set(siblingRevisions.map((r) => String(r.id)));

  // ---- a partir daqui, só com alçada de pós-venda ----
  const canSeeExecution = await hasOptionalPermission(session, 'contracts.view');

  let documents: unknown[] = [];
  let authorizations: unknown[] = [];
  let serviceOrders: unknown[] = [];
  let divergences: unknown[] = [];
  let engagements: unknown[] = [];

  if (canSeeExecution) {
    const [docs, auths] = await Promise.all([
      documentIds.length
        ? session.supabase.from('contract_documents')
            .select('id,title,file_path,document_type,status,created_at')
            .eq('organization_id', session.organizationId).in('id', documentIds)
        : Promise.resolve({ data: [] }),
      revisionIds.length
        ? session.supabase.from('commercial_engagement_authorizations')
            .select('id,engagement_id,source_kind,proposal_revision_id,authorized_value,currency,'
              + 'effective_from,effective_until,governing,state')
            .eq('organization_id', session.organizationId).in('proposal_revision_id', revisionIds)
        : Promise.resolve({ data: [] }),
    ]);
    documents = docs.data ?? [];
    authorizations = auths.data ?? [];

    const engagementIds = Array.from(new Set(
      (authorizations as Array<{ engagement_id: string }>).map((row) => row.engagement_id)));

    if (engagementIds.length) {
      const [engagementRows, orders, divs] = await Promise.all([
        session.supabase.from('commercial_engagements')
          .select('id,engagement_number,title,status,authorized_value,currency,authorized_at')
          .eq('organization_id', session.organizationId).in('id', engagementIds),
        session.supabase.from('internal_service_orders')
          .select('id,engagement_id,os_number,title,origin,status,authorized_value,currency,'
            + 'project_id,source_proposal_revision_id,issued_at,created_at')
          .eq('organization_id', session.organizationId).in('engagement_id', engagementIds),
        session.supabase.from('commercial_divergences')
          .select('id,engagement_id,service_order_id,scope,field_path,left_source_kind,left_value,'
            + 'right_source_kind,right_value,severity,summary,detected_by,state,resolved_source_kind')
          .eq('organization_id', session.organizationId).in('engagement_id', engagementIds),
      ]);
      engagements = engagementRows.data ?? [];
      serviceOrders = orders.data ?? [];
      divergences = divs.data ?? [];
    }
  }

  const owners = await resolveOwnerNames(session.organizationId, [
    ...members.map((m) => m.owner_user_id ?? null),
    ...(acceptances ?? []).map((a) => a.recorded_by),
    ...contextRevisions.flatMap((r) => [r.internally_approved_by, r.sent_by, r.recorded_by, r.created_by])
      .filter((value): value is string => typeof value === 'string'),
  ]);

  return NextResponse.json({
    ok: true,
    proposal,
    revisions,
    opportunity: opportunity.data ?? null,
    facts: facts.data ?? [],
    members: members.map((m) => ({ id: m.id, proposal_number: m.proposal_number, kind: m.kind, title: m.title,
      counterparty_name: m.counterparty_name, currency: m.currency ?? 'BRL', opportunity_id: m.opportunity_id ?? null,
      party_id: m.party_id ?? null, context_id: m.context_id ?? null, created_at: m.created_at ?? null })),
    contextRevisions,
    acceptances,
    followups: followups.data ?? [],
    documents,
    authorizations,
    engagements,
    serviceOrders,
    divergences,
    owners,
    siblings,
    siblingRevisions,
    siblingFacts: ((facts.data ?? []) as unknown as Array<{ subject_id: string | null }>)
      .filter((f) => f.subject_id && siblingRevisionIds.has(f.subject_id)),
    blueprints: blueprintData.data ?? [],
    executionStart: startData.data ?? null,
    /*
      A tela precisa distinguir "não existe" de "não posso ver". Sem esta
      bandeira, as duas situações renderizam o mesmo vazio.
    */
    executionVisibility: canSeeExecution ? 'visible' : 'restricted',
  });
}
