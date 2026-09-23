import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import {
  buildPipelineSignals, sortPipelineSignals,
  type SignalFollowup, type SignalOpportunity, type SignalProposal, type SignalRevision,
} from '@/lib/commercial/pipeline-signals';
import { buildExecutionSignals } from '@/lib/commercial/execution-signals';
import { evaluateProposalReadiness } from '@/lib/commercial/proposal-readiness';
import type { SiteSurveyStatus } from '@/lib/commercial/site-survey';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O DOSSIÊ de uma oportunidade.
 *
 * Tudo o que a conversa tem: a conta, quem se fala nela, valor, etapa e há
 * quanto tempo, previsão de decisão, responsável, os acompanhamentos, as
 * propostas ligadas e a linha do tempo do que aconteceu.
 *
 * A linha do tempo é MONTADA de registros que já existem — eventos de etapa
 * (212), marcos das revisões de proposta (198) e acompanhamentos (156). Não há
 * tabela nova de "atividade": uma seria uma segunda versão da história,
 * alimentada por gravação paralela, e divergiria da primeira no dia em que
 * alguém esquecesse de escrever nela.
 *
 * Nada aqui escreve. A leitura inteira passa pelo cliente AUTENTICADO, e é a
 * RLS de cada tabela que decide o que aparece.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const { data: opportunity, error } = await session.supabase
    .from('commercial_opportunities')
    .select('id,code,title,counterparty_name,party_id,primary_contact_id,stage,estimated_value,'
      + 'currency,probability,expected_decision_date,owner_user_id,engagement_id,closed_at,'
      + 'lost_reason,source,notes,stage_entered_at,created_at,updated_at')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível ler a oportunidade.' }, { status: 500 });
  }
  if (!opportunity) {
    return NextResponse.json({ ok: false, error: 'Oportunidade não encontrada.' }, { status: 404 });
  }

  const row = opportunity as unknown as SignalOpportunity & {
    party_id: string | null; owner_user_id: string | null; primary_contact_id: string | null;
  };

  const [party, contacts, proposals, stageEvents, surveys, executionStart] = await Promise.all([
    row.party_id
      ? session.supabase.from('parties')
          .select('id,legal_name,trade_name,document_number')
          .eq('organization_id', session.organizationId).eq('id', row.party_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.party_id
      ? session.supabase.from('commercial_contacts')
          .select('id,full_name,role_title,email,phone,is_primary,active')
          .eq('organization_id', session.organizationId).eq('party_id', row.party_id)
          .eq('active', true).order('full_name')
      : Promise.resolve({ data: [] }),
    session.supabase.from('commercial_proposals')
      .select('id,proposal_number,kind,title,currency,opportunity_id,created_at')
      .eq('organization_id', session.organizationId).eq('opportunity_id', id),
    session.supabase.from('commercial_opportunity_stage_events')
      .select('id,from_stage,to_stage,reason,actor_user_id,occurred_at')
      .eq('organization_id', session.organizationId).eq('opportunity_id', id)
      .order('occurred_at', { ascending: false }).limit(60),
    session.supabase.from('commercial_site_surveys')
      .select('id,code,title,status,site_name,site_address,purpose,technical_responsible_user_id,'
        + 'planned_visit_date,started_at,completed_at,findings,checklist,open_questions,'
        + 'apex_generated_at,created_at')
      .eq('organization_id', session.organizationId).eq('opportunity_id', id)
      .order('created_at', { ascending: false }),
    session.supabase.from('commercial_execution_starts')
      .select('id,engagement_id,mode,authorization_type,authorization_date,authorization_reference,'
        + 'documentation_state,exception_reason,regularization_owner_user_id,regularization_due_date,'
        + 'regularized_at,service_order_id,project_id,confirmed_by,confirmed_at')
      .eq('organization_id', session.organizationId).eq('opportunity_id', id).maybeSingle(),
  ]);

  const proposalRows = (proposals.data ?? []) as unknown as Array<SignalProposal & { created_at: string }>;
  const proposalIds = proposalRows.map((p) => p.id);

  const [revisions, followups] = await Promise.all([
    proposalIds.length
      ? session.supabase.from('commercial_proposal_revisions')
          .select('id,proposal_id,revision,status,total_value,currency,validity_until,'
            + 'payment_terms,document_id,accepted_at,acceptance_source,internally_approved_at,'
            + 'sent_at,rejected_at,expired_at,superseded_at,superseded_by_id,created_at')
          .eq('organization_id', session.organizationId).in('proposal_id', proposalIds)
          .order('revision', { ascending: false })
      : Promise.resolve({ data: [] }),
    session.supabase.from('apex_followups')
      .select('id,source_kind,source_id,goal,expected_evidence,state,due_date,'
        + 'next_expected_event,next_expected_event_at,responsible_text,responsible_user_id,'
        + 'cadence_days,closed_at,created_at')
      .eq('organization_id', session.organizationId)
      .in('source_kind', ['commercial_opportunity', 'commercial_proposal'])
      .or(`source_id.eq.${id}${proposalIds.length ? `,source_id.in.(${proposalIds.join(',')})` : ''}`)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);

  const revisionRows = (revisions.data ?? []) as unknown as Array<SignalRevision & Record<string, unknown>>;
  const followupRows = (followups.data ?? []) as unknown as SignalFollowup[];

  const surveyRows = (surveys.data ?? []) as unknown as Array<{
    id: string; code: string; status: SiteSurveyStatus; planned_visit_date: string | null;
    site_name: string | null; site_address: string | null; findings: unknown; checklist: unknown;
    open_questions: unknown; technical_responsible_user_id: string | null;
  }>;
  const startRow = (executionStart.data ?? null) as unknown as {
    id: string; engagement_id: string; documentation_state: string; regularization_due_date: string | null;
    regularization_owner_user_id: string | null; confirmed_by: string | null;
  } | null;

  const readiness = evaluateProposalReadiness({
    opportunity: row as unknown as {
      party_id: string | null; primary_contact_id: string | null;
      estimated_value: string | null; expected_decision_date: string | null;
    },
    contacts: (contacts.data ?? []) as Array<{ id: string; is_primary: boolean }>,
    surveys: surveyRows,
  });

  /*
    O ESTADO do trabalho autorizado para os sinais de fluxo. A OS é legível
    com `commercial.view` (RLS da 200); o status do engajamento vive sob
    `contracts.view`, e aqui atravessa SÓ o status do engajamento para o qual
    esta oportunidade — já lida sob RLS — aponta.
  */
  const engagementId = (row.engagement_id as string | null) ?? startRow?.engagement_id ?? null;
  const [engagementStatus, orders] = engagementId
    ? await Promise.all([
        platformServiceClient().from('commercial_engagements').select('id,status')
          .eq('organization_id', session.organizationId).eq('id', engagementId).maybeSingle(),
        session.supabase.from('internal_service_orders')
          .select('id,os_number,status,project_id,origin,issued_at')
          .eq('organization_id', session.organizationId).eq('engagement_id', engagementId),
      ])
    : [{ data: null }, { data: [] }];
  const serviceOrders = (orders.data ?? []) as unknown as Array<{
    id: string; os_number: string; status: string; project_id: string | null;
  }>;

  const acceptedRevisions = revisionRows
    .filter((revision) => revision.status === 'ACCEPTED')
    .map((revision) => {
      const proposal = proposalRows.find((p) => p.id === revision.proposal_id);
      return { id: revision.id,
        label: `${proposal?.proposal_number ?? 'Proposta'} R${String(revision.revision).padStart(2, '0')}` };
    });

  const signals = sortPipelineSignals([
    ...buildPipelineSignals({
      opportunities: [row],
      followups: followupRows,
      proposals: proposalRows,
      revisions: revisionRows,
    }).filter((signal) => !(signal.kind === 'WON_WITHOUT_AUTHORIZED_WORK' && acceptedRevisions.length)),
    ...buildExecutionSignals({
      opportunity: row as unknown as {
        id: string; title: string; stage: SignalOpportunity['stage']; engagement_id: string | null;
      },
      surveys: surveyRows,
      readiness,
      proposalCount: proposalRows.length,
      acceptedRevisions,
      engagement: (engagementStatus.data as { id: string; status: string } | null) ?? null,
      serviceOrders,
      executionStart: startRow,
    }),
  ]);

  const owners = await resolveOwnerNames(session.organizationId, [
    row.owner_user_id,
    ...((stageEvents.data ?? []) as Array<{ actor_user_id: string | null }>)
      .map((event) => event.actor_user_id),
    ...followupRows.map((followup) =>
      (followup as unknown as { responsible_user_id: string | null }).responsible_user_id),
    ...surveyRows.map((survey) => survey.technical_responsible_user_id),
    startRow?.regularization_owner_user_id, startRow?.confirmed_by,
  ]);

  return NextResponse.json({
    ok: true,
    opportunity: row,
    party: party.data ?? null,
    contacts: contacts.data ?? [],
    proposals: proposalRows,
    revisions: revisionRows,
    followups: followupRows,
    stageEvents: stageEvents.data ?? [],
    surveys: surveyRows,
    readiness,
    executionStart: startRow,
    engagement: engagementStatus.data ?? null,
    serviceOrders,
    signals,
    owners,
  });
}
