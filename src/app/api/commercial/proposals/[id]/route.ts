import { NextResponse } from 'next/server';
import {
  requireCommercialSession, isSessionError, hasOptionalPermission,
} from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';

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
 * Nada aqui escreve, e toda leitura passa pelo cliente autenticado.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const { data: proposalRow, error } = await session.supabase
    .from('commercial_proposals')
    .select('id,opportunity_id,proposal_number,kind,title,counterparty_name,party_id,currency,'
      + 'owner_user_id,created_at')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: 'Não foi possível ler a proposta.' }, { status: 500 });
  }
  if (!proposalRow) {
    return NextResponse.json({ ok: false, error: 'Proposta não encontrada.' }, { status: 404 });
  }
  const proposal = proposalRow as unknown as {
    id: string; opportunity_id: string | null; proposal_number: string; kind: string;
    title: string; counterparty_name: string; party_id: string | null; currency: string;
    owner_user_id: string | null; created_at: string;
  };

  const { data: revisionData } = await session.supabase
    .from('commercial_proposal_revisions')
    .select('id,proposal_id,revision,status,total_value,currency,validity_until,payment_terms,'
      + 'scope_summary,acceptance_conditions,document_id,internal_review_at,internally_approved_at,'
      + 'internally_approved_by,sent_at,sent_by,negotiation_at,accepted_at,acceptance_source,'
      + 'acceptance_document_id,acceptance_external_ref,acceptance_note,recorded_by,rejected_at,'
      + 'rejection_reason,expired_at,withdrawn_at,superseded_at,supersedes_id,superseded_by_id,'
      + 'created_by,created_at')
    .eq('organization_id', session.organizationId)
    .eq('proposal_id', id)
    .order('revision', { ascending: false });

  /*
    Estreitamento local: o cliente tipado devolve união com `GenericStringError`
    para estas tabelas. O erro de consulta já foi tratado acima; aqui a forma é
    a que a própria `select` acima declara.
  */
  const revisions = (revisionData ?? []) as unknown as
    Array<Record<string, string | number | null>>;
  const revisionIds = revisions.map((r) => String(r.id));
  const documentIds = revisions
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
          .select('id,document_id,document_context,subject_kind,subject_id,fact_domain,label,'
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
      .eq('source_kind', 'commercial_proposal').eq('source_id', id)
      .order('due_date', { ascending: true, nullsFirst: false }),
    proposal.opportunity_id
      ? session.supabase.from('commercial_opportunities')
          .select('id,title,stage,counterparty_name,estimated_value,currency,expected_decision_date')
          .eq('organization_id', session.organizationId).eq('id', proposal.opportunity_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

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
    proposal.owner_user_id,
    ...revisions.flatMap((r) => [r.internally_approved_by, r.sent_by, r.recorded_by, r.created_by])
      .filter((value): value is string => typeof value === 'string'),
  ]);

  return NextResponse.json({
    ok: true,
    proposal,
    revisions,
    opportunity: opportunity.data ?? null,
    facts: facts.data ?? [],
    followups: followups.data ?? [],
    documents,
    authorizations,
    engagements,
    serviceOrders,
    divergences,
    owners,
    /*
      A tela precisa distinguir "não existe" de "não posso ver". Sem esta
      bandeira, as duas situações renderizam o mesmo vazio.
    */
    executionVisibility: canSeeExecution ? 'visible' : 'restricted',
  });
}
