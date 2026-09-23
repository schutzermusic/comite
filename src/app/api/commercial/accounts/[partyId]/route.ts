import { NextResponse } from 'next/server';
import {
  requireCommercialSession, isSessionError, hasOptionalPermission,
} from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import {
  buildPipelineSignals,
  type SignalFollowup, type SignalOpportunity, type SignalProposal, type SignalRevision,
} from '@/lib/commercial/pipeline-signals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A CONTA, vista por inteiro.
 *
 * ─── O que este endpoint recusa a ser ────────────────────────────────────
 *
 * Não é um cadastro de clientes do Comercial. A identidade continua sendo a de
 * `parties` — a mesma que Contratos, Projetos e Faturamento usam — e nada aqui
 * escreve nela. O que a rota faz é REUNIR, em volta de um `party_id`, o que já
 * existe espalhado: contatos, oportunidades, propostas, trabalho autorizado,
 * projetos e acompanhamentos.
 *
 * Um segundo cadastro é sempre a saída mais fácil e sempre a mesma dívida: duas
 * razões sociais para a mesma empresa, dois CNPJs divergentes e a nota fiscal
 * saindo pelo errado.
 *
 * Trabalho autorizado e projetos ficam sob `contracts.view` / `projects.view`
 * (197/200). Sem a alçada, a seção volta RESERVADA, e não vazia.
 */
export async function GET(_request: Request, context: { params: Promise<{ partyId: string }> }) {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;
  const { partyId } = await context.params;

  const { data: party, error } = await session.supabase
    .from('parties')
    .select('id,legal_name,trade_name,document_number,created_at')
    .eq('organization_id', session.organizationId)
    .eq('id', partyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: 'Não foi possível ler a conta.' }, { status: 500 });
  }
  if (!party) {
    return NextResponse.json({ ok: false, error: 'Conta não encontrada.' }, { status: 404 });
  }

  const [contacts, opportunities, proposals, surveys] = await Promise.all([
    session.supabase.from('commercial_contacts')
      .select('id,full_name,role_title,email,phone,is_primary,active,created_at')
      .eq('organization_id', session.organizationId).eq('party_id', partyId)
      .order('is_primary', { ascending: false }).order('full_name'),
    session.supabase.from('commercial_opportunities')
      .select('id,code,title,counterparty_name,stage,estimated_value,currency,probability,'
        + 'expected_decision_date,owner_user_id,engagement_id,closed_at,lost_reason,'
        + 'stage_entered_at,created_at')
      .eq('organization_id', session.organizationId).eq('party_id', partyId)
      .order('created_at', { ascending: false }).limit(200),
    session.supabase.from('commercial_proposals')
      .select('id,proposal_number,kind,title,opportunity_id,currency,created_at')
      .eq('organization_id', session.organizationId).eq('party_id', partyId)
      .order('created_at', { ascending: false }).limit(200),
    session.supabase.from('commercial_site_surveys')
      .select('id,code,title,status,opportunity_id,site_name,planned_visit_date,completed_at,created_at')
      .eq('organization_id', session.organizationId).eq('party_id', partyId)
      .order('created_at', { ascending: false }).limit(100),
  ]);

  const opportunityRows = (opportunities.data ?? []) as unknown as SignalOpportunity[];
  const proposalRows = (proposals.data ?? []) as unknown as SignalProposal[];
  const proposalIds = proposalRows.map((p) => p.id);
  const opportunityIds = opportunityRows.map((o) => o.id);

  const [revisions, followups] = await Promise.all([
    proposalIds.length
      ? session.supabase.from('commercial_proposal_revisions')
          .select('id,proposal_id,revision,status,total_value,currency,validity_until,accepted_at')
          .eq('organization_id', session.organizationId).in('proposal_id', proposalIds)
          .order('revision', { ascending: false })
      : Promise.resolve({ data: [] }),
    opportunityIds.length || proposalIds.length
      ? session.supabase.from('apex_followups')
          .select('id,source_kind,source_id,goal,state,due_date,next_expected_event,'
            + 'next_expected_event_at,responsible_text,responsible_user_id')
          .eq('organization_id', session.organizationId)
          .in('source_kind', ['commercial_opportunity', 'commercial_proposal'])
          .in('source_id', [...opportunityIds, ...proposalIds])
      : Promise.resolve({ data: [] }),
  ]);

  const revisionRows = (revisions.data ?? []) as unknown as SignalRevision[];
  const followupRows = (followups.data ?? []) as unknown as SignalFollowup[];

  const signals = buildPipelineSignals({
    opportunities: opportunityRows,
    followups: followupRows,
    proposals: proposalRows,
    revisions: revisionRows,
  });

  // ---- execução: trabalho autorizado e projetos ----
  const canSeeEngagements = await hasOptionalPermission(session, 'contracts.view');
  const canSeeProjects = await hasOptionalPermission(session, 'projects.view');

  let engagements: unknown[] = [];
  let projects: unknown[] = [];

  if (canSeeEngagements) {
    const { data } = await session.supabase.from('commercial_engagements')
      .select('id,engagement_number,title,status,origin,authorized_value,currency,authorized_at,created_at')
      .eq('organization_id', session.organizationId)
      .eq('counterparty_party_id', partyId)
      .order('created_at', { ascending: false }).limit(100);
    engagements = data ?? [];

    const engagementIds = (engagements as Array<{ id: string }>).map((row) => row.id);
    if (engagementIds.length && canSeeProjects) {
      const { data: links } = await session.supabase.from('engagement_project_links')
        .select('engagement_id,project_id')
        .eq('organization_id', session.organizationId).in('engagement_id', engagementIds);
      const linkRows = (links ?? []) as Array<{ engagement_id: string; project_id: string }>;
      const projectIds = Array.from(new Set(linkRows.map((row) => row.project_id)));

      /*
        `projects.project` é o documento jsonb do projeto — o nome e o código
        moram lá dentro, como em `project_measurement_review_queue` (201). O
        achatamento acontece aqui para a tela não precisar conhecer a forma
        interna de outro módulo.
      */
      const { data: projectRows } = projectIds.length
        ? await session.supabase.from('projects')
            .select('id,project')
            .eq('organization_id', session.organizationId).in('id', projectIds)
        : { data: [] };
      const byId = new Map((projectRows ?? []).map((row) => {
        const document = (row as { project: Record<string, unknown> | null }).project ?? {};
        return [String((row as { id: string }).id), {
          name: (document.nome as string) ?? null,
          code: (document.codigo as string) ?? null,
        }];
      }));
      projects = linkRows.map((row) => ({
        engagement_id: row.engagement_id,
        project_id: row.project_id,
        name: byId.get(row.project_id)?.name ?? null,
        code: byId.get(row.project_id)?.code ?? null,
      }));
    }
  }

  const { data: startRows } = opportunityIds.length
    ? await session.supabase.from('commercial_execution_starts')
        .select('id,opportunity_id,mode,documentation_state,regularization_due_date')
        .eq('organization_id', session.organizationId).in('opportunity_id', opportunityIds)
    : { data: [] };

  const owners = await resolveOwnerNames(session.organizationId,
    opportunityRows.map((row) => (row as unknown as { owner_user_id: string | null }).owner_user_id));

  return NextResponse.json({
    ok: true,
    party,
    contacts: contacts.data ?? [],
    opportunities: opportunityRows,
    proposals: proposalRows,
    revisions: revisionRows,
    followups: followupRows,
    engagements,
    projects,
    signals,
    owners,
    surveys: surveys.data ?? [],
    executionStarts: startRows ?? [],
    engagementVisibility: canSeeEngagements ? 'visible' : 'restricted',
    projectVisibility: canSeeProjects ? 'visible' : 'restricted',
  });
}
